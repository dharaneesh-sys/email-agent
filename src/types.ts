// Shared TypeScript interfaces for the email agent

import { z } from 'zod';

// Import the Zod schemas from config to derive types
// We'll re-export them here for consistency
import { EmailSchema, EmailImportanceSchema } from './config';

// Re-export the Zod types as TypeScript interfaces
export type Email = z.infer<typeof EmailSchema>;
export type EmailImportance = z.infer<typeof EmailImportanceSchema>;

// Account configuration
export interface EmailAccount {
  id: string;
  email: string;
  label: string;
  authToken?: string; // For runtime auth state
}

// Server API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Email list item (simplified for UI)
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
  llmScore?: number; // LLM importance score, attached when cached scoring exists
  llmReason?: string; // LLM importance reason, attached when cached scoring exists
}

// Thread summary for UI
export interface ThreadSummary {
  id: string;
  messageCount: number;
  latestMessage: EmailListItem;
  participants: string[];
  lastActivity: string; // ISO date
}

// Action result types
export interface EmailActionResult {
  success: boolean;
  messageId: string;
  action: string;
}

// Filter criteria for email listing
export interface EmailFilter {
  query?: string;
  labelIds?: string[];
  maxResults?: number;
  includeImportantOnly?: boolean;
  includeUnreadOnly?: boolean;
}

// Sync status
export interface SyncStatus {
  lastSync: string; // ISO timestamp
  isSyncing: boolean;
  accounts: Record<string, {
    lastSync: string;
    emailCount: number;
    unreadCount: number;
  }>;
}

// Configuration exposed to frontend (safe subset)
export interface ClientConfig {
  pollIntervalMinutes: number;
  maxEmailsPerPoll: number;
}