// Shared UI types for the Email Agent SPA (mirrors server contracts)

export interface EmailListItem {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  subject: string;
  date: string; // ISO date string
  importanceScore: number;
  isImportant: boolean;
  labels: string[];
  isUnread: boolean;
  llmScore?: number;
  llmReason?: string;
}

export interface AccountStatus {
  id: string;
  email?: string;
  label?: string;
  authenticated: boolean;
  needsAuth: boolean;
  refreshTokenPresent?: boolean;
  expiryDate?: number | null;
  daysRemaining?: number | null;
  hasValidToken?: boolean;
  fileExists?: boolean;
  lastRefreshAt?: number | null;
}

// --- API response envelopes (server returns bare objects, not ApiResponse) ---

export interface AuthStatusResponse {
  accounts: AccountStatus[];
}

export interface AuthUrlResponse {
  authUrl?: string;
}

export interface SignoutResponse {
  success: boolean;
  message?: string;
}

export interface StatsResponse {
  unreadCount?: number;
  importantCount?: number;
  totalInbox?: number;
  accountId?: string;
}

export interface EmailsResponse {
emails?: EmailListItem[];
count?: number;
  accountId?: string;
  nextCursor?: string | null;
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
  contentId?: string;
  inline: boolean;
}

export interface EmailBody {
  snippet?: string;
  text?: string | null;
  html?: string | null;
  attachments?: EmailAttachment[];
}

export interface EmailDetailResponse {
  email?: {
    id: string;
    threadId?: string;
    snippet?: string;
    subject?: string;
    from?: string;
    to?: string;
    date?: string;
    importanceScore?: number;
    isImportant?: boolean;
    labels?: string[];
    isUnread?: boolean;
    llmScore?: number;
    llmReason?: string;
    body?: EmailBody;
  };
}

export interface SummaryResponse {
  emailId?: string;
  summary?: string;
  keyPoints?: string[];
  suggestedAction?: string;
  model?: string;
}

export interface ActionResponse {
  success: boolean;
  message?: string;
  action?: string;
  emailId?: string;
}

export interface ImportanceScore {
  emailId: string;
  llmScore?: number;
  reason?: string;
  isImportant?: boolean;
}

export interface ImportanceResponse {
  scores?: ImportanceScore[];
  requested?: number;
  scored?: number;
  failed?: number;
  model?: string;
  completed?: boolean;
}

export interface ConfigUpdateResponse {
  success: boolean;
  model?: string;
}

export interface ReplyResponse {
  success: boolean;
  message?: string;
  emailId?: string;
}

export interface DraftResponse {
  messageId?: string;
  reply?: string;
  model?: string;
}

export interface ConfigResponse {
  model?: string | null;
  llmEnabled?: boolean;
  defaultModel?: string | null;
  defaultAccount?: string;
}

// --- UI domain types ---

export type Filter = 'all' | 'unread' | 'important' | 'starred';

export type Tone = 'professional' | 'friendly' | 'concise' | 'formal';

export type EmailAction =
  | 'read'
  | 'unread'
  | 'star'
  | 'unstar'
  | 'archive'
  | 'unarchive'
  | 'important'
  | 'unimportant'
  | 'trash'
  | 'untrash';

export type SnoozeDuration = '3h' | 'tomorrow' | 'nextWeek';

export interface SnoozeResponse {
  success: boolean;
  emailId?: string;
  duration?: SnoozeDuration;
  snoozeUntil?: number;
}

export type ToastVariant = 'info' | 'success' | 'error';

export interface ThreadMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  labels?: string[];
  isUnread?: boolean;
  body?: EmailBody;
}

export interface ThreadResponse {
  threadId: string;
  count?: number;
  messages?: ThreadMessage[];
}

export interface LabelApplyResponse {
  success: boolean;
  applied?: number;
  failed?: number;
}

export interface LabelInfo {
  id: string;
  name?: string;
  type?: string;
  labelListVisibility?: string | null;
}
