// Scheduler module for periodic email checking
// Can be run via cron to pre-fetch and cache emails

import { EMAIL_ACCOUNTS } from './config';
import { authManager } from './auth';
import { gmailService, getSnoozeStore } from './gmail';
import { importanceScorer } from './importance';

interface SyncResult {
  accountId: string;
  emailCount: number;
  importantCount: number;
  unreadCount: number;
  timestamp: string;
  error?: string;
}

async function syncAccount(account: { id: string; email: string; label: string }): Promise<SyncResult> {
  try {
    // Check if we have a valid token
    if (!authManager.hasValidToken(account.id)) {
      return {
        accountId: account.id,
        emailCount: 0,
        importantCount: 0,
        unreadCount: 0,
        timestamp: new Date().toISOString(),
        error: 'Not authenticated'
      };
    }
    
    // Get recent unread emails (last 24 hours)
    const { ids: messageIds } = await gmailService.listMessages(account.id, {
      query: 'is:unread in:inbox newer_than:24h',
      maxResults: 50
    });
    
    // Fetch full messages
    const emails = await Promise.all(
      messageIds.map(id => gmailService.getMessage(account.id, id))
    );
    
    // Calculate importance scores
    let importantCount = 0;
    for (const email of emails) {
      const importance = importanceScorer.scoreEmail(email, account.email);
      if (importance.isImportant) {
        importantCount++;
      }
    }
    
    return {
      accountId: account.id,
      emailCount: emails.length,
      importantCount,
      unreadCount: messageIds.length,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Error syncing account ${account.id}: ${msg}`);
    return {
      accountId: account.id,
      emailCount: 0,
      importantCount: 0,
      unreadCount: 0,
      timestamp: new Date().toISOString(),
      error: msg,
    };
  }
}

async function runSync(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting email sync...`);
  
  const results = await Promise.all(
    EMAIL_ACCOUNTS.map(account => syncAccount(account))
  );
  
  let totalEmails = 0;
  let totalImportant = 0;
  let totalUnread = 0;
  let failedAccounts = 0;
  
  for (const result of results) {
    if (result.error) {
      failedAccounts++;
      console.error(`  ❌ ${result.accountId}: ${result.error}`);
    } else {
      console.log(`  ✅ ${result.accountId}: ${result.emailCount} emails (${result.importantCount} important, ${result.unreadCount} unread)`);
      totalEmails += result.emailCount;
      totalImportant += result.importantCount;
      totalUnread += result.unreadCount;
    }
  }
  
  console.log(`[${new Date().toISOString()}] Sync complete: ${totalEmails} total emails, ${totalImportant} important, ${totalUnread} unread. ${failedAccounts} accounts failed.`);
  
  // Optionally, we could write results to a file or database for the server to pick up
  // For now, we just log to console
}

export async function checkSnoozed(): Promise<number> {
  let restored = 0;
  const store = getSnoozeStore();
  const now = Date.now();
  for (const account of EMAIL_ACCOUNTS) {
    if (!authManager.hasValidToken(account.id)) continue;
    try {
      let pageToken: string | undefined = undefined;
      do {
        const { ids, nextPageToken } = await gmailService.listMessages(account.id, {
          query: 'label:SNOOZED',
          maxResults: 100,
          ...(pageToken ? { pageToken } : {}),
        });
        for (const id of ids) {
          const key = `${account.id}:${id}`;
          const until = store.get(key);
          if (until === undefined) continue;
          if (now >= until) {
            try {
              await gmailService.unsnooze(account.id, id);
              restored += 1;
            } catch (e) {
              console.error(`Failed to unsnooze ${key}:`, e);
            }
          }
        }
        pageToken = nextPageToken;
      } while (pageToken);
    } catch (e) {
      console.error(`Snooze check failed for ${account.id}:`, e);
    }
  }
  if (restored > 0) console.log(`[${new Date().toISOString()}] Snooze check: restored ${restored} messages`);
  return restored;
}

let snoozeTimer: ReturnType<typeof setInterval> | null = null;

export function startSnoozeScheduler(intervalMs = 60_000): void {
  if (snoozeTimer !== null) return;
  snoozeTimer = setInterval(() => {
    void checkSnoozed();
  }, intervalMs);
  const t = snoozeTimer as unknown as { unref?: () => void };
  if (typeof t.unref === 'function') t.unref();
}

export function stopSnoozeScheduler(): void {
  if (snoozeTimer !== null) {
    clearInterval(snoozeTimer);
    snoozeTimer = null;
  }
}

// If this script is run directly, execute the sync
if (import.meta.main) {
  runSync().catch((error) => {
    console.error('Scheduler failed:', error);
    process.exit(1);
  });
  startSnoozeScheduler();
}

export { runSync, syncAccount };