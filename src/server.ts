// Hono-based server for Email Agent dashboard
// Provides REST API endpoints and serves static files

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { EMAIL_ACCOUNTS } from './config';
import { authManager } from './auth';
import { gmailService } from './gmail';
import { importanceScorer } from './importance';
import type { EmailListItem } from './types';

// Create Hono app
const app = new Hono();

// Middleware to ensure account is authenticated (except auth endpoints)
app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  if (path.startsWith('/api/auth') || path.startsWith('/api/oauth2callback') || path.startsWith('/api/health')) {
    await next();
    return;
  }
  const accountId = c.req.query('account') || EMAIL_ACCOUNTS[0].id;
  if (!authManager.hasValidToken(accountId)) {
    throw new HTTPException(401, { message: `Account ${accountId} not authenticated` });
  }
  await next();
});

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get authentication status for all accounts
app.get('/api/auth/status', async (c) => {
  const status = await Promise.all(
    EMAIL_ACCOUNTS.map(async (acc) => ({
      id: acc.id,
      email: acc.email,
      authenticated: authManager.hasValidToken(acc.id),
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
    return c.redirect(`/dashboard.html?auth=success&account=${encodeURIComponent(state)}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    return c.redirect(`/dashboard.html?auth=failed&reason=${encodeURIComponent(reason)}`);
  }
});

// Get emails for an account with optional filtering
app.get('/api/emails', zValidator('query', z.object({
  accountId: z.string().optional(),
  query: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(100).optional(),
  importantOnly: z.coerce.boolean().optional(),
  unreadOnly: z.coerce.boolean().optional(),
})), async (c) => {
  const { 
    accountId = EMAIL_ACCOUNTS[0].id, 
    query, 
    maxResults = 20,
    importantOnly = false,
    unreadOnly = false
  } = c.req.valid('query');

  if (!EMAIL_ACCOUNTS.some(acc => acc.id === accountId)) {
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
    const messageIds = await gmailService.listMessages(accountId, {
      query: gmailQuery,
      maxResults: Math.min(maxResults * 2, 100), // Get extra to account for filtering
    });

    // Fetch full messages
    const emails = await Promise.all(
      messageIds.slice(0, maxResults).map(id => gmailService.getMessage(accountId, id))
    );

    // Score importance and convert to UI format
    const emailItems: EmailListItem[] = await Promise.all(
      emails.map(async (email) => {
        const importance = importanceScorer.scoreEmail(email, 
          EMAIL_ACCOUNTS.find(acc => acc.id === accountId)!.email
        );

        // Extract headers
        const subject = email.payload.headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
        const from = email.payload.headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown';
        const dateTimestamp = parseInt(email.internalDate, 10);
        const date = new Date(dateTimestamp).toISOString();

        // Check labels
        const labelIds = email.labelIds || [];
        const isUnread = labelIds.includes('UNREAD');

        return {
          id: email.id,
          threadId: email.threadId,
          snippet: email.snippet || '',
          from,
          subject,
          date,
          importanceScore: importance.score,
          isImportant: importance.isImportant || (importantOnly && importance.score > 0),
          labels: labelIds,
          isUnread,
        };
      })
    );

    // Filter by importance if requested
    const filteredEmails = importantOnly 
      ? emailItems.filter(e => e.isImportant)
      : emailItems;

    return c.json({ 
      emails: filteredEmails.slice(0, maxResults),
      count: filteredEmails.length,
      accountId
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
    const importance = importanceScorer.scoreEmail(email, 
      EMAIL_ACCOUNTS.find(acc => acc.id === accountId)!.email
    );

    // Extract all headers for display
    const headers = Object.fromEntries(
      email.payload.headers.map(h => [h.name.toLowerCase(), h.value])
    );

    return c.json({
      email: {
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
          // We could extract the full body here if needed
        }
      }
    });
  } catch (error) {
    console.error('Error fetching email:', error);
    throw new HTTPException(404, { message: 'Email not found' });
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
    // Get unread count
    const [unreadCount, totalInbox, recentIds] = await Promise.all([
      gmailService.countMessages(accountId, 'is:unread in:inbox'),
      gmailService.countMessages(accountId, 'in:inbox'),
      gmailService.listMessages(accountId, {
        query: 'in:inbox newer_than:7d',
        maxResults: 100,
      }),
    ]);
    
    let importantCount = 0;
    if (recentIds.length > 0) {
      const emails = await Promise.all(
        recentIds.slice(0, 50).map(id => gmailService.getMessage(accountId, id))
      );
      importantCount = emails.reduce((count, email) => {
        const importance = importanceScorer.scoreEmail(email, 
          EMAIL_ACCOUNTS.find(acc => acc.id === accountId)!.email
        );
        return count + (importance.isImportant ? 1 : 0);
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

app.get('/', (c) => c.redirect('/dashboard.html'));

// Serve static files (dashboard.html, CSS, JS, etc.)
app.get('/*', serveStatic({ root: './' }));

export default app;
