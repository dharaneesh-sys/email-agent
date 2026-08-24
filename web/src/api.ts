// Typed API client — every endpoint from the behavior contract.
// Non-ok responses throw ApiError; callers decide toast/degrade behavior.

import type {
  ActionResponse,
  AuthStatusResponse,
  AuthUrlResponse,
  ConfigResponse,
  DraftResponse,
  EmailAttachment,
  EmailDetailResponse,
  EmailsResponse,
  ImportanceResponse,
  ReplyResponse,
  SignoutResponse,
  StatsResponse,
  SummaryResponse,
  ThreadResponse,
  Tone,
  SnoozeResponse,
  SnoozeDuration,
} from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(path, init);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as T;
}

export const api = {
  authStatus: () => get<AuthStatusResponse>('/api/auth/status'),
  authUrl: (accountId: string) =>
    get<AuthUrlResponse>(`/api/auth/${encodeURIComponent(accountId)}/url`),
  // Server exposes signout as GET (dashboard used GET) — keep parity.
  signout: (accountId: string) =>
    get<SignoutResponse>(`/api/auth/${encodeURIComponent(accountId)}/signout`),
  stats: (account: string) =>
    get<StatsResponse>(`/api/stats?account=${encodeURIComponent(account)}`),
  emails: (account: string, query: string, cursor?: string | null) => {
    let url = `/api/emails?account=${encodeURIComponent(account)}&query=${encodeURIComponent(query)}&maxResults=50`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      return get<EmailsResponse>(url);
    },
  emailDetail: (id: string, account: string) =>
    get<EmailDetailResponse>(
      `/api/email/${encodeURIComponent(id)}?account=${encodeURIComponent(account)}`,
    ),
  summary: (id: string, account: string) =>
    get<SummaryResponse>(
      `/api/summary/${encodeURIComponent(id)}?account=${encodeURIComponent(account)}`,
    ),
  action: (id: string, action: string, accountId: string) =>
    post<ActionResponse>(`/api/email/${encodeURIComponent(id)}/action`, {
      action,
      accountId,
    }),
  importanceRefresh: (ids: string[], accountId: string) =>
    post<ImportanceResponse>('/api/importance/refresh', { ids, accountId }),
  draftReply: (messageId: string, tone: Tone, accountId: string) =>
    post<DraftResponse>('/api/reply/draft', { messageId, tone, accountId }),
  sendReply: (id: string, body: string, accountId: string) =>
    post<ReplyResponse>(`/api/email/${encodeURIComponent(id)}/reply`, {
      body,
      accountId,
    }),
  compose: (message: { to: string; cc?: string; bcc?: string; subject: string; body: string }, accountId: string) =>
    post<ReplyResponse>('/api/email/compose', { ...message, accountId }),
  thread: (threadId: string, account: string) =>
    get<ThreadResponse>(
      `/api/thread/${encodeURIComponent(threadId)}?account=${encodeURIComponent(account)}`,
    ),
  config: () => get<ConfigResponse>('/api/config'),
  snooze: (id: string, duration: SnoozeDuration, accountId: string) =>
    post<SnoozeResponse>(`/api/email/${encodeURIComponent(id)}/snooze`, { duration, accountId }),
  unsnooze: (id: string, accountId: string) =>
    post<SnoozeResponse>(`/api/email/${encodeURIComponent(id)}/unsnooze`, { accountId }),
};

export function attachmentUrl(id: string, attachment: EmailAttachment, account: string): string {
  const params = new URLSearchParams({
    account,
    mimeType: attachment.mimeType,
    filename: attachment.filename,
    inline: attachment.inline ? '1' : '0',
  });
  return `/api/email/${encodeURIComponent(id)}/attachment/${encodeURIComponent(attachment.attachmentId)}?${params.toString()}`;
}
