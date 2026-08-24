// Hono-based server for Email Agent dashboard
// Provides REST API endpoints and serves static files

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { EMAIL_ACCOUNTS } from './config';
import { authManager } from './auth';
import { gmailService, extractMessageBody } from './gmail';
import { importanceScorer } from './importance';
import { llmService } from './llm';
import type { Email } from './gmail';
import type { EmailLike, LlmImportanceResult } from './llm';
import type { EmailListItem } from './types';

// Create Hono app
const app = new Hono();

// Middleware to ensure account is authenticated (except auth endpoints)
app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  if (path.startsWith('/api/auth') || path.startsWith('/api/oauth2callback') || path.startsWith('/api/health') || path.startsWith('/api/config')) {
    await next();
    return;
  }
  const accountId = c.req.query('account') || EMAIL_ACCOUNTS[0].id;
  // Attempt to obtain a valid token (refreshes expired tokens). Only 401 when
  // the account has no token or the refresh fails (revoked/invalid).
  try {
    await authManager.getAccessToken(accountId);
  } catch {
    throw new HTTPException(401, { message: `Account ${accountId} not authenticated` });
  }
  await next();
});

// Shared EmailLike conversion for the single-email, refresh, summary and draft routes.
function toEmailLike(email: Email): EmailLike {
  const headers = Object.fromEntries(
    email.payload.headers.map((h) => [h.name.toLowerCase(), h.value])
  )
  return {
    id: email.id,
    from: headers['from'] || 'Unknown',
    to: headers['to'] || '',
    subject: headers['subject'] || '(No Subject)',
    snippet: email.snippet,
    // Feed the real decoded body to the LLM prompts, falling back to the
    // snippet when the message has no extractable plain-text body.
    body: extractMessageBody(email.payload).text ?? email.snippet,
    date: new Date(parseInt(email.internalDate, 10)).toISOString(),
  }
}

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public LLM config for the dashboard (no auth — exposes no account data)
app.get('/api/config', (c) => {
  const info = llmService.getActiveModelInfo()
  return c.json({
    model: info.model,
    llmEnabled: info.llmEnabled,
    defaultModel: info.defaultModel,
    defaultAccount: EMAIL_ACCOUNTS[0].id,
  })
});

// Get authentication status for all accounts
app.get('/api/auth/status', async (c) => {
  const status = await Promise.all(
    EMAIL_ACCOUNTS.map(async (acc) => ({
      id: acc.id,
      email: acc.email,
      authenticated: authManager.isConnected(acc.id),
      needsAuth: authManager.getAccountsNeedingAuth().includes(acc.id),
    }))
  );
  return c.json({ accounts: status });
});

// Get authorization URL for an account
app.get('/api/auth/:accountId/url', (c) => {
  const { accountId } = c.req.param();
  if (!EMAIL_ACCOUNTS.some(acc => acc.id === accountId)) {
    throw new HTTPException(400, { message: 'Invalid account ID' });
  }
  const url = authManager.getAuthUrl(accountId);
  return c.json({ authUrl: url });
});

// Sign out an account
app.get('/api/auth/:accountId/signout', (c) => {
  const { accountId } = c.req.param();
  if (!EMAIL_ACCOUNTS.some(acc => acc.id === accountId)) {
    throw new HTTPException(400, { message: 'Invalid account ID' });
  }
  authManager.signOut(accountId);
  return c.json({ success: true, message: `Signed out ${accountId}` });
});

// Handle OAuth callback
app.get('/api/oauth2callback', zValidator('query', z.object({
  code: z.string(),
  state: z.string(),
})), async (c) => {
  const { code, state } = c.req.valid('query');
  try {
    await authManager.handleCallback(code, state);
    return c.redirect(`/?auth=success&account=${encodeURIComponent(state)}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    return c.redirect(`/?auth=failed&reason=${encodeURIComponent(reason)}`);
  }
});

// Get emails for an account with optional filtering
app.get('/api/emails', zValidator('query', z.object({
  account: z.string().optional(),
  accountId: z.string().optional(),
  query: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(100).optional(),
  importantOnly: z.coerce.boolean().optional(),
  unreadOnly: z.coerce.boolean().optional(),
})), async (c) => {
  const {
    account,
    accountId = EMAIL_ACCOUNTS[0].id,
    query,
    maxResults = 20,
    importantOnly = false,
    unreadOnly = false,
  } = c.req.valid('query');
  // The dashboard sends `account`, not `accountId` — honor whichever is present.
  const resolvedAccountId = account ?? accountId;
  const accountEmail = EMAIL_ACCOUNTS.find((acc) => acc.id === resolvedAccountId)?.email ?? '';

  if (!EMAIL_ACCOUNTS.some(acc => acc.id === resolvedAccountId)) {
    throw new HTTPException(400, { message: 'Invalid account ID' });
  }

  try {
    // Build Gmail query
    let gmailQuery = 'in:inbox';
    if (query) gmailQuery += ` ${query}`;
    if (unreadOnly) gmailQuery += ' is:unread';
    // Note: important filtering will be done after fetching since Gmail's importance 
    // might not match our custom scoring

    // Get message IDs
    const messageIds = await gmailService.listMessages(resolvedAccountId, {
      query: gmailQuery,
      maxResults: Math.min(maxResults * 2, 100), // Get extra to account for filtering
    });

    // Fetch full messages
    const emails = await Promise.all(
      messageIds.slice(0, maxResults).map(id => gmailService.getMessage(resolvedAccountId, id))
    );

    // Score importance and convert to UI format
    const emailLikes: EmailLike[] = [];
    const emailItems: EmailListItem[] = await Promise.all(
      emails.map(async (email) => {
        const importance = importanceScorer.scoreEmail(email, accountEmail);

        // Extract headers
        const subject = email.payload.headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
        const from = email.payload.headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown';
        const to = email.payload.headers.find(h => h.name.toLowerCase() === 'to')?.value || '';
        const dateTimestamp = parseInt(email.internalDate, 10);
        const date = new Date(dateTimestamp).toISOString();

        // Check labels
        const labelIds = email.labelIds || [];
        const isUnread = labelIds.includes('UNREAD');
        const isImportant = importance.isImportant || labelIds.includes('IMPORTANT') || (importantOnly && importance.score > 0);

        emailLikes.push({ id: email.id, from, to, subject, snippet: email.snippet, date, isImportant });

        return {
          id: email.id,
          threadId: email.threadId,
          snippet: email.snippet || '',
          from,
          subject,
          date,
          importanceScore: importance.score,
          isImportant,
          labels: labelIds,
          isUnread,
        };
      })
    );

    // Kick off LLM importance scoring (fire-and-forget) and attach cached results
    llmService.enqueueImportance(emailLikes, accountEmail);
    for (const item of emailItems) {
      const imp = llmService.getImportance(item.id);
      if (imp !== null) {
        item.llmScore = imp.llmScore;
        item.llmReason = imp.reason;
        item.isImportant = item.isImportant || imp.isImportant;
      }
    }

    // Filter by importance if requested
    const filteredEmails = importantOnly 
      ? emailItems.filter(e => e.isImportant)
      : emailItems;

    return c.json({ 
      emails: filteredEmails.slice(0, maxResults),
      count: filteredEmails.length,
      accountId: resolvedAccountId
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    const msg = error instanceof Error ? error.message : 'Failed to fetch emails';
    throw new HTTPException(500, { message: msg });
  }
});

// Get a single email by ID
app.get('/api/email/:id', async (c) => {
  const { id } = c.req.param();
  const accountId = c.req.query('account') || EMAIL_ACCOUNTS[0].id;

  try {
    const email = await gmailService.getMessage(accountId, id);
    const accountEmail = EMAIL_ACCOUNTS.find(acc => acc.id === accountId)?.email ?? '';
    const importance = importanceScorer.scoreEmail(email, accountEmail);

    // Extract all headers for display
    const headers = Object.fromEntries(
      email.payload.headers.map(h => [h.name.toLowerCase(), h.value])
    );

    // Await-scored LLM importance (cached or fresh); never throws, but guard anyway
    let imp: LlmImportanceResult | null = null;
    try {
      const results = await llmService.ensureImportance([toEmailLike(email)], accountEmail);
      imp = results.get(id) ?? null;
    } catch {
      // ensureImportance never throws — best-effort guard per contract.
    }

    const extracted = extractMessageBody(email.payload);

    const emailObj = {
      id: email.id,
      threadId: email.threadId,
      snippet: email.snippet,
      subject: headers['subject'] || '(No Subject)',
      from: headers['from'] || 'Unknown',
      to: headers['to'] || '',
      date: new Date(parseInt(email.internalDate, 10)).toISOString(),
      importanceScore: importance.score,
      isImportant: importance.isImportant,
      importanceReasons: importance.reasons,
      labels: email.labelIds || [],
      isUnread: (email.labelIds || []).includes('UNREAD'),
      body: {
        snippet: email.snippet,
        text: extracted.text,
        html: extracted.html,
        attachments: extracted.attachments,
      }
    };

    return c.json({
      email: imp === null ? emailObj : { ...emailObj, llmScore: imp.llmScore, llmReason: imp.reason }
    });
  } catch (error) {
    console.error('Error fetching email:', error);
    throw new HTTPException(404, { message: 'Email not found' });
  }
});

// Download an attachment's raw bytes for a message
app.get('/api/email/:id/attachment/:attachmentId', async (c) => {
  const { id, attachmentId } = c.req.param();
  const accountId = c.req.query('account') || EMAIL_ACCOUNTS[0].id;
  const mimeType = c.req.query('mimeType');
  const filename = c.req.query('filename');
  const inline = c.req.query('inline');

  if (!EMAIL_ACCOUNTS.some(acc => acc.id === accountId)) {
    throw new HTTPException(400, { message: 'Invalid account ID' });
  }

  try {
    const attachment = await gmailService.getAttachment(accountId, id, attachmentId);
    const headers = {
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Disposition': inline === '1' ? 'inline' : `attachment; filename="${filename || 'attachment'}"`,
    };
    return c.body(Buffer.from(attachment.data, 'base64'), 200, headers);
  } catch (error) {
    console.error('Error fetching attachment:', error);
    throw new HTTPException(404, { message: 'Attachment not found' });
  }
});

// Perform action on an email
app.post('/api/email/:id/action', zValidator('json', z.object({
  action: z.enum(['read', 'unread', 'star', 'unstar', 'archive', 'important', 'unimportant', 'trash']),
  accountId: z.string().optional(),
})), async (c) => {
  const { id } = c.req.param();
  const { action, accountId = EMAIL_ACCOUNTS[0].id } = c.req.valid('json');

  if (!EMAIL_ACCOUNTS.some(acc => acc.id === accountId)) {
    throw new HTTPException(400, { message: 'Invalid account ID' });
  }

  try {
    let success = false;
    switch (action) {
      case 'read':
        await gmailService.markAsRead(accountId, id);
        success = true;
        break;
      case 'unread':
        await gmailService.markAsUnread(accountId, id);
        success = true;
        break;
      case 'star':
        await gmailService.star(accountId, id);
        success = true;
        break;
      case 'unstar':
        await gmailService.unstar(accountId, id);
        success = true;
        break;
      case 'archive':
        await gmailService.archive(accountId, id);
        success = true;
        break;
      case 'important':
        await gmailService.markImportant(accountId, id);
        success = true;
        break;
      case 'unimportant':
        await gmailService.unmarkImportant(accountId, id);
        success = true;
        break;
      case 'trash':
        await gmailService.trash(accountId, id);
        success = true;
        break;
    }

    if (success) {
      return c.json({ 
        success: true, 
        message: `Email ${action}ed successfully`,
        action,
        emailId: id
      });
    } else {
      throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error('Error performing email action:', error);
    throw new HTTPException(500, { message: `Failed to ${action} email` });
  }
});

// Get available labels
app.get('/api/labels', async (c) => {
  const accountId = c.req.query('account') || EMAIL_ACCOUNTS[0].id;
  try {
    const labels = await gmailService.listLabels(accountId);
    return c.json({ labels });
  } catch (error) {
    console.error('Error fetching labels:', error);
    throw new HTTPException(500, { message: 'Failed to fetch labels' });
  }
});

// Get dashboard stats
app.get('/api/stats', async (c) => {
  const accountId = c.req.query('account') || EMAIL_ACCOUNTS[0].id;
  try {
    const accountEmail = EMAIL_ACCOUNTS.find((acc) => acc.id === accountId)?.email ?? '';
    // Get unread count
    const [unreadCount, totalInbox, messageIds] = await Promise.all([
      gmailService.countMessages(accountId, 'is:unread in:inbox'),
      gmailService.countMessages(accountId, 'in:inbox'),
      // Same source set as /api/emails (in:inbox, newest 50) so the important
      // badge matches what the Important filter page actually shows.
      gmailService.listMessages(accountId, {
        query: 'in:inbox',
        maxResults: 100,
      }),
    ]);

    let importantCount = 0;
    if (messageIds.length > 0) {
      const emails = await Promise.all(
        messageIds.slice(0, 50).map(id => gmailService.getMessage(accountId, id))
      );
      importantCount = emails.reduce((count, email) => {
        const importance = importanceScorer.scoreEmail(email, accountEmail);
        const labelImportant = (email.labelIds || []).includes('IMPORTANT');
        // Mirror /api/emails: include LLM-cached importance too, so the badge
        // matches the count on the Important filter page.
        const cached = llmService.getImportance(email.id);
        const isImportant = importance.isImportant || labelImportant || (cached?.isImportant ?? false);
        return count + (isImportant ? 1 : 0);
      }, 0);
    }

    return c.json({
      unreadCount,
      importantCount,
      totalInbox,
      accountId
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    throw new HTTPException(500, { message: 'Failed to fetch stats' });
  }
});

// Reply to an email
app.post('/api/email/:id/reply', zValidator('json', z.object({
  body: z.string().min(1),
  accountId: z.string().optional(),
})), async (c) => {
  const { id } = c.req.param();
  const { body, accountId = EMAIL_ACCOUNTS[0].id } = c.req.valid('json');

  if (!EMAIL_ACCOUNTS.some(acc => acc.id === accountId)) {
    throw new HTTPException(400, { message: 'Invalid account ID' });
  }

  try {
    // Get the email to find thread info
    const email = await gmailService.getMessage(accountId, id);
    const result = await gmailService.sendReply(accountId, email.threadId, body);
    return c.json({ success: true, message: 'Reply sent', emailId: result });
  } catch (error) {
    console.error('Error sending reply:', error);
    const msg = error instanceof Error ? error.message : 'Failed to send reply';
    throw new HTTPException(500, { message: msg });
  }
});

// Re-score a batch of emails with the LLM (dashboard refresh button)
app.post('/api/importance/refresh', zValidator('json', z.object({
  ids: z.array(z.string()).min(1).max(100),
  accountId: z.string().optional(),
})), async (c) => {
  const { ids, accountId: bodyAccountId } = c.req.valid('json');
  if (!llmService.isEnabled()) {
    return c.json({ error: 'LLM disabled' }, 503);
  }
  const accountId = bodyAccountId ?? c.req.query('account') ?? EMAIL_ACCOUNTS[0].id;
  if (!EMAIL_ACCOUNTS.some(acc => acc.id === accountId)) {
    throw new HTTPException(400, { message: 'Invalid account ID' });
  }
  const accountEmail = EMAIL_ACCOUNTS.find(acc => acc.id === accountId)?.email ?? '';

  try {
    const emails = await Promise.all(
      ids.map(async (messageId) => {
        try {
          return await gmailService.getMessage(accountId, messageId);
        } catch {
          return null; // Skip ids that fail to fetch
        }
      })
    );
    const found = emails.filter((email): email is Email => email !== null);
    const results = await llmService.ensureImportance(found.map((email) => toEmailLike(email)), accountEmail);
    const scores = [...results.entries()].map(([emailId, imp]) => ({
      emailId,
      llmScore: imp.llmScore,
      reason: imp.reason,
      isImportant: imp.isImportant,
    }));
    return c.json({
      scores,
      model: llmService.getActiveModelInfo().model,
      completed: true,
    });
  } catch (error) {
    console.error('Error refreshing importance:', error);
    const msg = error instanceof Error ? error.message : 'Failed to refresh importance';
    throw new HTTPException(500, { message: msg });
  }
});

// LLM summary for a single email
app.get('/api/summary/:id', async (c) => {
  const { id } = c.req.param();
  const accountId = c.req.query('account') || EMAIL_ACCOUNTS[0].id;
  // Gate before the Gmail fetch so a disabled LLM 503s without network
  if (!llmService.isEnabled()) {
    return c.json({ error: 'LLM disabled' }, 503);
  }

  try {
    const email = await gmailService.getMessage(accountId, id);
    const result = await llmService.summarize(toEmailLike(email));
    if (result === null) {
      return c.json({ error: 'LLM summary failed' }, 502);
    }
    return c.json({
      emailId: id,
      summary: result.summary,
      keyPoints: result.keyPoints,
      suggestedAction: result.suggestedAction,
      model: result.model,
    });
  } catch (error) {
    console.error('Error fetching email for summary:', error);
    return c.json({ error: 'Email not found' }, 404);
  }
});

// Streaming summary — SSE with `delta` text events and a terminal
// `done` (structured result) or `error` event. Clients that cannot
// consume SSE fall back to the non-stream endpoint above.
app.get('/api/summary/:id/stream', async (c) => {
  const { id } = c.req.param();
  const accountId = c.req.query('account') || EMAIL_ACCOUNTS[0].id;
  if (!llmService.isEnabled()) {
    return c.json({ error: 'LLM disabled' }, 503);
  }

  let email;
  try {
    email = await gmailService.getMessage(accountId, id);
  } catch (error) {
    console.error('Error fetching email for summary stream:', error);
    return c.json({ error: 'Email not found' }, 404);
  }

  return streamSSE(c, async (sse) => {
    // Serialize writes — onDelta fires synchronously from the stream reader.
    let tail = Promise.resolve();
    const enqueue = (event: string, data: string) => {
      tail = tail.then(() => sse.writeSSE({ event, data }));
    };
    try {
      const result = await llmService.summarizeStream(toEmailLike(email), (delta) => {
        enqueue('delta', JSON.stringify({ t: delta }));
      });
      await tail;
      if (result === null) {
        await sse.writeSSE({ event: 'error', data: 'LLM summary failed' });
        return;
      }
      await sse.writeSSE({
        event: 'done',
        data: JSON.stringify({
          emailId: id,
          summary: result.summary,
          keyPoints: result.keyPoints,
          suggestedAction: result.suggestedAction,
          model: result.model,
        }),
      });
    } catch (error) {
      await tail.catch(() => {});
      const msg = error instanceof Error ? error.message : 'Summary stream failed';
      await sse.writeSSE({ event: 'error', data: msg }).catch(() => {});
    }
  });
});
// Draft an LLM reply for a single email (does NOT send)
app.post('/api/reply/draft', zValidator('json', z.object({
  messageId: z.string(),
  tone: z.enum(['professional', 'friendly', 'concise', 'formal']),
  accountId: z.string().optional(),
})), async (c) => {
  const { messageId, tone, accountId: bodyAccountId } = c.req.valid('json');
  if (!llmService.isEnabled()) {
    return c.json({ error: 'LLM disabled' }, 503);
  }
  const accountId = bodyAccountId ?? c.req.query('account') ?? EMAIL_ACCOUNTS[0].id;

  try {
    const email = await gmailService.getMessage(accountId, messageId);
    const result = await llmService.draftReply(toEmailLike(email), tone);
    if (result === null) {
      return c.json({ error: 'LLM draft failed' }, 502);
    }
    return c.json({
      messageId,
      reply: result.reply,
      model: result.model,
    });
  } catch (error) {
    console.error('Error fetching email for draft:', error);
    return c.json({ error: 'Email not found' }, 404);
  }
});

// Serve the React SPA at the root. Built output lives in web/dist/.
// Hashed assets are immutable by content-addressing; index.html is not hashed
// so it must revalidate to discover new asset hashes.
app.get('/', serveStatic({
  root: './web/dist',
  onFound: (_path, c) => {
    c.header('Cache-Control', 'no-cache');
  },
}));
app.get(
  '/assets/*',
  serveStatic({
    root: './web/dist',
    onFound: (_path, c) => {
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }),
);
app.get('/favicon.ico', (c) => c.body(null, 204));

// Legacy: keep dashboard.html reachable for reference/A-B during transition.
app.get('/dashboard.html', serveStatic({
  path: './dashboard.html',
  onFound: (_path, c) => {
    c.header('Cache-Control', 'no-cache');
  },
}));

// Serve static files (dashboard.html, CSS, JS, etc.)
app.get('/*', serveStatic({ root: './' }));

export default app;
