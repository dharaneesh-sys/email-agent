// Scheduler module for periodic email checking
// Can be run via cron to pre-fetch and cache emails

import { EMAIL_ACCOUNTS } from './config';
import { authManager } from './auth';
import { gmailService } from './gmail';
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

// If this script is run directly, execute the sync
if (import.meta.main) {
  runSync().catch((error) => {
    console.error('Scheduler failed:', error);
    process.exit(1);
  });
}

export { runSync, syncAccount };