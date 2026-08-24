// Gmail API client wrapper
// Handles email operations: fetch, modify, reply

import type { gmail_v1 } from 'googleapis';
import { getGmailForAccount } from './auth';
import { z } from 'zod';

// Email schema
export const EmailSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()),
  snippet: z.string(),
  historyId: z.string(),
  internalDate: z.string(), // timestamp as string
  payload: z.object({
    headers: z.array(z.object({
      name: z.string(),
      value: z.string(),
    })),
    parts: z.array(z.any()).optional(),
    body: z.object({
      size: z.number(),
      data: z.string().optional(),
      attachmentId: z.string().optional(),
    }).optional(),
    mimeType: z.string(),
    filename: z.string().optional(),
  }),
});

// Thread schema
export const ThreadSchema = z.object({
  id: z.string(),
  messages: z.array(EmailSchema),
});

// Type definitions
export type Email = z.infer<typeof EmailSchema>;
export type Thread = z.infer<typeof ThreadSchema>;

// Metadata for a message attachment (or inline image) discovered while
// walking the payload. `contentId` is only set (and `inline` only true) when
// the part carries a Content-ID header.
export interface EmailAttachment {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
  contentId?: string;
  inline: boolean;
}

interface MessagePartBodyLike {
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: { name: string; value: string }[] | undefined;
  body?:
    | { data?: string | undefined; attachmentId?: string | undefined; size?: number | undefined }
    | null
    | undefined;
  parts?: unknown[] | undefined;
}

/**
 * Extract the full decoded text/plain and text/html bodies from a Gmail
 * message payload, plus attachment metadata. Recursively walks
 * `payload.parts` plus the top-level `payload.body` (non-multipart case).
 * Concatenates multiple parts of the same type; ignores all other mimeTypes
 * (multipart/*, image/*, ...) but still recurses into their `parts`. Empty
 * decoded strings become null. Parts carrying a `body.attachmentId` (other
 * than text/plain or text/html bodies) become attachments; a Content-ID
 * header marks them inline with the surrounding angle brackets stripped.
 */
export function extractMessageBody(payload: MessagePartBodyLike): {
  text: string | null;
  html: string | null;
  attachments: EmailAttachment[];
} {
  let text = '';
  let html = '';
  const attachments: EmailAttachment[] = [];

  const decode = (data: string): string => Buffer.from(data, 'base64url').toString('utf-8');

  const walk = (node: MessagePartBodyLike): void => {
    const mimeType = node.mimeType;
    const body = node.body;
    const data = body?.data;
    if (data) {
      if (mimeType === 'text/plain') {
        text += decode(data);
      } else if (mimeType === 'text/html') {
        html += decode(data);
      }
    }
    const attachmentId = body?.attachmentId;
    if (attachmentId && mimeType !== 'text/plain' && mimeType !== 'text/html') {
      const attachment: EmailAttachment = {
        filename: node.filename ?? '',
        mimeType: mimeType ?? '',
        attachmentId,
        size: body?.size ?? 0,
        inline: false,
      };
      const contentIdHeader = node.headers?.find(
        (h) => h.name.toLowerCase() === 'content-id'
      );
      if (contentIdHeader) {
        attachment.contentId = contentIdHeader.value.replace(/^<|>$/g, '');
        attachment.inline = true;
      }
      attachments.push(attachment);
    }
    if (Array.isArray(node.parts)) {
      for (const part of node.parts) {
        walk(part as MessagePartBodyLike);
      }
    }
  };

  walk(payload);

  return {
    text: text === '' ? null : text,
    html: html === '' ? null : html,
    attachments,
  };
}

// Label IDs for common operations
const LABEL_IDS = {
  INBOX: 'INBOX',
  UNREAD: 'UNREAD',
  STARRED: 'STARRED',
  IMPORTANT: 'IMPORTANT',
  TRASH: 'TRASH',
  SPAM: 'SPAM',
  CATEGORY_PERSONAL: 'CATEGORY_PERSONAL',
  CATEGORY_SOCIAL: 'CATEGORY_SOCIAL',
  CATEGORY_PROMOTIONS: 'CATEGORY_PROMOTIONS',
  CATEGORY_UPDATES: 'CATEGORY_UPDATES',
  CATEGORY_FORUMS: 'CATEGORY_FORUMS',
};

class GmailService {
  /**
   * Get Gmail instance for an account
   */
  private async getGmail(accountId: string): Promise<gmail_v1.Gmail> {
    return await getGmailForAccount(accountId);
  }

  /**
   * Extract header value from email payload
   */
  getHeader(headers: { name: string; value: string }[], name: string): string | null {
    const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : null;
  }

  /**
   * Get plain text body from email payload
   */
  getBody(payload: any): string {
    // If no parts, it's a simple message
    if (!payload.parts) {
      if (payload.body && payload.body.data) {
        // Decode base64url
        const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
        return decoded;
      }
      return '';
    }

    // Handle multipart messages
    let text = '';
    let html = '';

    const walkParts = (parts: any[]) => {
      for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          text += Buffer.from(part.body.data, 'base64url').toString('utf-8');
        } else if (part.mimeType === 'text/html' && part.body?.data) {
          html += Buffer.from(part.body.data, 'base64url').toString('utf-8');
        } else if (part.parts) {
          walkParts(part.parts);
        }
      }
    };

    walkParts(payload.parts);

    // Prefer text/plain, fallback to HTML (stripped)
    return text || html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  }

  /**
   * List messages (emails) for an account with optional query
   */
  async listMessages(
    accountId: string,
    options: {
      query?: string;
      maxResults?: number;
      labelIds?: string[];
    } = {}
  ): Promise<string[]> {
    const gmail = await this.getGmail(accountId);
    const params: Record<string, unknown> = {
      userId: 'me',
      maxResults: options.maxResults ?? 100,
    };
    if (options.query) params['q'] = options.query;
    if (options.labelIds) params['labelIds'] = options.labelIds;
    const res = await gmail.users.messages.list(params);

    return (res.data.messages ?? []).map(m => m.id!);
  }

  /**
   * Get the total number of messages matching a query (uses resultSizeEstimate)
   */
  async countMessages(
    accountId: string,
    query?: string
  ): Promise<number> {
    const gmail = await this.getGmail(accountId);
    const params: Record<string, unknown> = { userId: 'me', maxResults: 1 };
    if (query) params['q'] = query;
    const res = await gmail.users.messages.list(params);
    return res.data.resultSizeEstimate ?? 0;
  }

  /**
   * Get a specific message by ID
   */
  async getMessage(accountId: string, messageId: string): Promise<Email> {
    const gmail = await this.getGmail(accountId);
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    // Validate and parse with Zod
    const parsed = EmailSchema.parse(res.data);
    return parsed;
  }

  /**
   * Get an attachment's raw bytes for a message. `data` is standard base64
   * (not base64url) — decode with Buffer.from(data, 'base64') at the call site.
   */
  async getAttachment(
    accountId: string,
    messageId: string,
    attachmentId: string
  ): Promise<{ data: string; size: number }> {
    const gmail = await this.getGmail(accountId);
    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });
    return {
      data: res.data.data ?? '',
      size: res.data.size ?? 0,
    };
  }

  /**
   * Get a thread by ID
   */
  async getThread(accountId: string, threadId: string): Promise<Thread> {
    const gmail = await this.getGmail(accountId);
    const res = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });

    const parsed = ThreadSchema.parse(res.data);
    return parsed;
  }

  /**
   * Get recent unread emails from inbox
   */
  async getUnreadInbox(
    accountId: string,
    maxResults: number = 20
  ): Promise<Email[]> {
    const messageIds = await this.listMessages(accountId, {
      query: 'is:unread in:inbox',
      maxResults,
    });

    const emails = await Promise.all(
      messageIds.map(id => this.getMessage(accountId, id))
    );

    return emails;
  }

  /**
   * Mark message as read
   */
  async markAsRead(accountId: string, messageId: string): Promise<void> {
    const gmail = await this.getGmail(accountId);
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: [LABEL_IDS.UNREAD],
      },
    });
  }

  /**
   * Mark message as unread
   */
  async markAsUnread(accountId: string, messageId: string): Promise<void> {
    const gmail = await this.getGmail(accountId);
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [LABEL_IDS.UNREAD],
      },
    });
  }

  /**
   * Archive message (remove from inbox)
   */
  async archive(accountId: string, messageId: string): Promise<void> {
    const gmail = await this.getGmail(accountId);
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: [LABEL_IDS.INBOX],
      },
    });
  }

  /**
   * Star message
   */
  async star(accountId: string, messageId: string): Promise<void> {
    const gmail = await this.getGmail(accountId);
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [LABEL_IDS.STARRED],
      },
    });
  }

  /**
   * Unstar message
   */
  async unstar(accountId: string, messageId: string): Promise<void> {
    const gmail = await this.getGmail(accountId);
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: [LABEL_IDS.STARRED],
      },
    });
  }

  /**
   * Mark as important
   */
  async markImportant(accountId: string, messageId: string): Promise<void> {
    const gmail = await this.getGmail(accountId);
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [LABEL_IDS.IMPORTANT],
      },
    });
  }

  /**
   * Remove important marker
   */
  async unmarkImportant(accountId: string, messageId: string): Promise<void> {
    const gmail = await this.getGmail(accountId);
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: [LABEL_IDS.IMPORTANT],
      },
    });
  }

  /**
   * Move to trash
   */
  async trash(accountId: string, messageId: string): Promise<void> {
    const gmail = await this.getGmail(accountId);
    await gmail.users.messages.trash({
      userId: 'me',
      id: messageId,
    });
  }

  /**
   * Send a simple reply
   */
  async sendReply(
    accountId: string,
    threadId: string,
    replyText: string,
    options: {
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
    } = {}
  ): Promise<string> {
    const gmail = await this.getGmail(accountId);

    // Get the thread to extract recipients and subject
    const thread = await this.getThread(accountId, threadId);
    const latestMessage = thread.messages[thread.messages.length - 1];
    if (!latestMessage) throw new Error('Thread has no messages');
    const headers = latestMessage.payload.headers;

    const originalSubject = this.getHeader(headers, 'Subject') ?? '';
    const originalFrom = this.getHeader(headers, 'From') ?? '';
    const originalCc = this.getHeader(headers, 'Cc') ?? '';

    // Determine reply recipients
    const replyTo = options.to || this.extractEmail(originalFrom);
    const replyCc = options.cc || (options.cc !== undefined ? options.cc : originalCc);
    // Typically don't reply-all to BCC, and To/CC from original might need munging
    // For simplicity, we'll reply to the sender only unless overridden

    // Create email message
    const emailLines = [
      `To: ${replyTo}`,
      replyCc ? `Cc: ${replyCc}` : '',
      `Subject: Re: ${originalSubject.startsWith('Re: ') ? originalSubject : 'Re: ' + originalSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '', // blank line separating headers from body
      replyText,
    ].filter(Boolean).join('\r\n');

    // Encode as base64url
    const encodedMessage = Buffer.from(emailLines)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send the message
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: threadId,
      },
    });

    return res.data.id!;
  }

  /**
   * Compose-and-send a brand-new message (no thread).
   */
  async sendCompose(
    accountId: string,
    message: {
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
    },
  ): Promise<string> {
    const gmail = await this.getGmail(accountId);

    const emailLines = [
      `To: ${message.to}`,
      message.cc ? `Cc: ${message.cc}` : '',
      message.bcc ? `Bcc: ${message.bcc}` : '',
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      message.body,
    ]
      .filter(Boolean)
      .join('\r\n');

    const encodedMessage = Buffer.from(emailLines)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });

    return res.data.id!;
  }
  /**
   * Extract email address from "Name <email@domain.com>" or just "email@domain.com"
   */
  private extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    if (match?.[1]) return match[1];
    return from.trim();
  }

  /**
   * List labels for the account
   */
  async listLabels(accountId: string): Promise<gmail_v1.Schema$Label[]> {
    const gmail = await this.getGmail(accountId);
    const res = await gmail.users.labels.list({ userId: 'me' });
    return res.data.labels ?? [];
  }

  /**
   * Create a label
   */
  async createLabel(
    accountId: string,
    name: string,
    labelListVisibility: string = 'labelShow',
    messageListVisibility: string = 'show'
  ): Promise<gmail_v1.Schema$Label> {
    const gmail = await this.getGmail(accountId);
    const res = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name,
        labelListVisibility,
        messageListVisibility,
      },
    });
    return res.data;
  }
}

// Export singleton instance
export const gmailService = new GmailService();