// Configuration for Email Agent
// Reuses Google OAuth credentials from ClutchD-Backend where available

import { z } from 'zod';

// Load environment variables
const CLIENT_ID = process.env['GOOGLE_OAUTH_CLIENT_ID'] || '710446274779-8kn2hpj6bl7014gv19a63lipnehdedun.apps.googleusercontent.com';
// NOTE: Client secret needs to be provided - check ClutchD-Backend backend/.env or set via GOOGLE_OAUTH_CLIENT_SECRET
const CLIENT_SECRET = process.env['GOOGLE_OAUTH_CLIENT_SECRET'] || 'YOUR_CLIENT_SECRET_HERE';

// OAuth2 configuration
export const GOOGLE_OAUTH_CONFIG = {
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUri: 'http://localhost:3030/api/oauth2callback',
  scopes: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid',
  ],
  // Token storage directory
  tokenStorageDir: (process.env['HOME'] || '/tmp') + '/.config/email-agent/tokens/',
};

// Email account configuration
export const EMAIL_ACCOUNTS = [
  {
    id: 'personal',
    email: process.env['EMAIL_PERSONAL'] || 'your-personal@gmail.com',
    label: 'Personal Gmail',
  },
  {
    id: 'work',
    email: process.env['EMAIL_WORK'] || 'your-work@gmail.com',
    label: 'Work Gmail',
  },
] as const;

// Warn if placeholder emails are still in use
for (const acc of EMAIL_ACCOUNTS) {
  if (acc.email === 'your-personal@gmail.com' || acc.email === 'your-work@gmail.com') {
    console.warn(`⚠️  ${acc.id} email is still set to placeholder "${acc.email}". Set ${acc.id === 'personal' ? 'EMAIL_PERSONAL' : 'EMAIL_WORK'} in .env to your real Gmail address.`);
  }
}

// Importance scoring rules
export const IMPORTANCE_RULES = {
  // Sender domain scoring (higher = more important)
  SENDER_SCORES: {
    // High priority domains
    'gmail.com': 10,
    'google.com': 15,
    // Add known important domains here
  },
  // Keyword scoring (points added if found in subject or body)
  KEYWORD_SCORES: {
    'urgent': 20,
    'important': 15,
    'action required': 15,
    'deadline': 15,
    'meeting': 10,
    'call': 10,
    'invoice': 12,
    'payment': 12,
    'bill': 10,
    'asap': 15,
    'follow up': 10,
    'reply needed': 12,
  },
  // Negative keywords (points subtracted)
  NEGATIVE_KEYWORDS: {
    'newsletter': -5,
    'promotion': -10,
    'sale': -8,
    'discount': -8,
    'unsubscribe': -5,
  },
  // Recency bonus (points for emails received within timeframe)
  RECENCY_BONUS: {
    '1h': 20,
    '6h': 15,
    '24h': 10,
    '7d': 5,
  },
  // Thread participation boost
  THREAD_PARTICIPATION_BONUS: 10, // If you've replied in the thread
  DIRECT_TO_YOU_BOOST: 15, // If email is directly to you (not CC/BCC)
  CC_PENALTY: -5, // Slight penalty for being CC'd
};

// Validation schemas
export const EmailSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()),
  snippet: z.string(),
  historyId: z.string(),
  internalDate: z.string(), // timestamp as string
  payload: z.object({
    headers: z.array(
      z.object({
        name: z.string(),
        value: z.string(),
      })
    ),
    parts: z.array(
      z.object({
        mimeType: z.string(),
        filename: z.string().optional(),
        headers: z.array(
          z.object({
            name: z.string(),
            value: z.string(),
          })
        ).optional(),
        body: z.object({
          size: z.number(),
          attachmentId: z.string().optional(),
          data: z.string().optional(),
        }).optional(),
      })
    ).optional(),
  }),
});

export type Email = z.infer<typeof EmailSchema>;

export const EmailImportanceSchema = z.object({
  emailId: z.string(),
  score: z.number(),
  reasons: z.array(z.string()),
  isImportant: z.boolean(),
});

export type EmailImportance = z.infer<typeof EmailImportanceSchema>;

export const ConfigSchema = z.object({
  port: z.number().default(3030),
  pollIntervalMinutes: z.number().default(15),
  maxEmailsPerPoll: z.number().default(50),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = {
  port: 3030,
  pollIntervalMinutes: 15,
  maxEmailsPerPoll: 50,
};