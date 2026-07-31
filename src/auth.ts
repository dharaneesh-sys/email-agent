// Authentication module for Gmail API using OAuth2
// Handles multiple accounts, token storage, and refresh

import { google } from 'googleapis';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { GOOGLE_OAUTH_CONFIG, EMAIL_ACCOUNTS } from './config';

// Token interface for storage
interface StoredToken {
  access_token: string;
  refresh_token: string | null;
  expiry_date: number;
  scope: string;
  token_type: 'Bearer';
}

// googleapis bundles its own OAuth2Client type incompatible with google-auth-library
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GmailOAuthClient = any;

class AuthManager {
  private clients: Map<string, GmailOAuthClient> = new Map();
  private tokens: Map<string, StoredToken> = new Map();

  constructor() {
    // Ensure token storage directory exists
    if (!existsSync(GOOGLE_OAUTH_CONFIG.tokenStorageDir)) {
      mkdirSync(GOOGLE_OAUTH_CONFIG.tokenStorageDir, { recursive: true });
    }
    // Load existing tokens
    this.loadAllTokens();
  }

  /**
   * Get or create an OAuth2 client for an account
   */
  getClient(accountId: string): GmailOAuthClient {
    if (!this.clients.has(accountId)) {
      const client = new google.auth.OAuth2(
        GOOGLE_OAUTH_CONFIG.clientId,
        GOOGLE_OAUTH_CONFIG.clientSecret,
        GOOGLE_OAUTH_CONFIG.redirectUri,
      );
      this.clients.set(accountId, client);
    }
    return this.clients.get(accountId)!;
  }

  /**
   * Load token from file for an account
   */
  private loadToken(accountId: string): StoredToken | null {
    const tokenPath = this.getTokenPath(accountId);
    if (!existsSync(tokenPath)) return null;

    try {
      const data = readFileSync(tokenPath, 'utf8');
      return JSON.parse(data) as StoredToken;
    } catch (error) {
      console.error(`Failed to load token for ${accountId}:`, error);
      return null;
    }
  }

  /**
   * Save token to file for an account
   */
  private saveToken(accountId: string, token: StoredToken): void {
    const tokenPath = this.getTokenPath(accountId);
    try {
      writeFileSync(tokenPath, JSON.stringify(token, null, 2), 'utf8');
      this.tokens.set(accountId, token);
    } catch (error) {
      console.error(`Failed to save token for ${accountId}:`, error);
    }
  }

  /**
   * Get token path for an account
   */
  private getTokenPath(accountId: string): string {
    return join(GOOGLE_OAUTH_CONFIG.tokenStorageDir, `token_${accountId}.json`);
  }

  /**
   * Load all tokens for configured accounts
   */
  loadAllTokens(): void {
    for (const account of EMAIL_ACCOUNTS) {
      const token = this.loadToken(account.id);
      if (token) {
        this.tokens.set(account.id, token);
        // Set credentials on the client
        const client = this.getClient(account.id);
        client.setCredentials({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expiry_date: token.expiry_date,
          scope: token.scope,
          token_type: token.token_type,
        });
      }
    }
  }

  /**
   * Check if we have a valid (non-expired) token for an account
   */
  hasValidToken(accountId: string): boolean {
    const token = this.tokens.get(accountId);
    if (!token) return false;

    // Check if token is expired (with 5 minute buffer)
    const expiresIn = (token.expiry_date - Date.now()) / 1000;
    return expiresIn > 300; // 5 minutes
  }

  /**
   * Check if we have any stored token for an account (expired or not).
   * Expired tokens can be auto-refreshed — no re-auth needed.
   */
  isConnected(accountId: string): boolean {
    return this.tokens.has(accountId);
  }

  /**
   * Get valid access token for an account, refreshing if necessary
   */
  async getAccessToken(accountId: string): Promise<string> {
    const client = this.getClient(accountId);
    const stored = this.tokens.get(accountId);

    // If we have a valid token, use it
    if (stored && this.hasValidToken(accountId)) {
      return stored.access_token;
    }

    // Otherwise, try to refresh
    if (stored?.refresh_token) {
      try {
        client.setCredentials({
          access_token: stored.access_token,
          refresh_token: stored.refresh_token,
          expiry_date: stored.expiry_date,
          scope: stored.scope,
          token_type: stored.token_type,
        });
        const { credentials } = await client.refreshAccessToken();
        const newToken: StoredToken = {
          access_token: credentials.access_token!,
          refresh_token: credentials.refresh_token ?? stored.refresh_token,
          expiry_date: credentials.expiry_date!,
          scope: credentials.scope!,
          token_type: 'Bearer',
        };
        this.saveToken(accountId, newToken);
        return newToken.access_token;
      } catch (error) {
        console.error(`Failed to refresh token for ${accountId}:`, error);
        throw new Error(`Token refresh failed for ${accountId}. Please re-authenticate.`);
      }
    }

    throw new Error(`No valid token found for ${accountId}. Please authenticate first.`);
  }

  /**
   * Generate auth URL for user consent
   */
  getAuthUrl(accountId: string): string {
    const client = this.getClient(accountId);
    console.log('redirectUri:', GOOGLE_OAUTH_CONFIG.redirectUri); // Debug line
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_OAUTH_CONFIG.scopes,
      prompt: 'consent', // Always show consent screen to get refresh token
      state: accountId, // Pass account ID in state to know which account we're authenticating for
    });
    return authUrl;
  }

  /**
   * Handle OAuth callback - exchange code for tokens
   */
  async handleCallback(code: string, state: string): Promise<StoredToken> {
    const accountId = state; // We passed accountId in state
    const client = this.getClient(accountId);

    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Store tokens
      const storedToken: StoredToken = {
        access_token: tokens.access_token!,
        refresh_token: tokens.refresh_token ?? null,
        expiry_date: tokens.expiry_date!,
        scope: tokens.scope ?? '',
        token_type: 'Bearer',
      };

      this.saveToken(accountId, storedToken);
      return storedToken;
    } catch (error) {
      console.error(`Error handling callback for ${accountId}:`, error);
      throw error;
    }
  }

  /**
   * Sign out an account (remove tokens)
   */
  signOut(accountId: string): void {
    this.tokens.delete(accountId);
    this.clients.delete(accountId);
    const tokenPath = this.getTokenPath(accountId);
    try {
      if (existsSync(tokenPath)) {
        unlinkSync(tokenPath);
      }
    } catch {
      // Ignore if file doesn't exist or can't be deleted
    }
  }

  /**
   * Get list of accounts that have never been authenticated (no stored token).
   * Expired tokens are auto-refreshed — they are NOT needing auth.
   */
  getAccountsNeedingAuth(): string[] {
    return EMAIL_ACCOUNTS
      .filter(acc => !this.isConnected(acc.id))
      .map(acc => acc.id);
  }
}

// Export singleton instance
export const authManager = new AuthManager();

// Helper function to get authenticated Gmail instance for an account
export async function getGmailForAccount(accountId: string) {
  const accessToken = await authManager.getAccessToken(accountId);
  const client = authManager.getClient(accountId);
  client.setCredentials({ access_token: accessToken, token_type: 'Bearer' });
  return google.gmail({ version: 'v1', auth: client });
}