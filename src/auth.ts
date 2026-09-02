// Authentication module for Gmail API using OAuth2
// Handles multiple accounts, token storage, and refresh

import { google } from 'googleapis';
import { join } from 'node:path';
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
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
  private fileMtimes: Map<string, number> = new Map();
  private lastRefreshAt: Map<string, number> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private authRefreshTimer: ReturnType<typeof setInterval> | null = null;
  constructor() {
    // Ensure token storage directory exists with restricted permissions
    if (!existsSync(GOOGLE_OAUTH_CONFIG.tokenStorageDir)) {
      mkdirSync(GOOGLE_OAUTH_CONFIG.tokenStorageDir, { recursive: true, mode: 0o700 });
      try { chmodSync(GOOGLE_OAUTH_CONFIG.tokenStorageDir, 0o700); } catch {}
    } else {
      try { chmodSync(GOOGLE_OAUTH_CONFIG.tokenStorageDir, 0o700); } catch {}
    }
    // Load existing tokens
    this.loadAllTokens();
    // Poll every 60s for out-of-process writes
    this.pollTimer = setInterval(() => {
      for (const account of EMAIL_ACCOUNTS) {
        this.reloadFromDisk(account.id);
      }
    }, 60_000);
    // Allow process to exit even if timer is active
    if (this.pollTimer && typeof (this.pollTimer as unknown as { unref?: () => void }).unref === 'function') {
      (this.pollTimer as unknown as { unref: () => void }).unref();
    }
    // Proactive refresh: every 6h, refresh tokens expiring within 30min or <3 days
    const scheduleRefresh = () => {
      for (const account of EMAIL_ACCOUNTS) void this.refreshIfNeeded(account.id);
    };
    setTimeout(scheduleRefresh, 30_000);
    this.authRefreshTimer = setInterval(scheduleRefresh, 6 * 60 * 60 * 1000);
    if (this.authRefreshTimer && typeof (this.authRefreshTimer as unknown as { unref?: () => void }).unref === 'function') {
      (this.authRefreshTimer as unknown as { unref: () => void }).unref();
    }
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
    // Preserve existing refresh_token if incoming is null (Google only returns it on first consent)
    if (!token.refresh_token) {
      const existing = this.tokens.get(accountId)?.refresh_token ?? this.loadToken(accountId)?.refresh_token ?? null;
      if (existing) token.refresh_token = existing;
    }
    try {
      const tmpPath = `${tokenPath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(token, null, 2), { mode: 0o600 });
      try { chmodSync(tmpPath, 0o600); } catch {}
      // fsync tmp file to ensure durability before rename
      try {
        const fd = openSync(tmpPath, 'r');
        fsyncSync(fd);
        closeSync(fd);
      } catch {}
      renameSync(tmpPath, tokenPath);
      try { chmodSync(tokenPath, 0o600); } catch {}
      this.tokens.set(accountId, token);
      try {
        const st = statSync(tokenPath);
        this.fileMtimes.set(accountId, st.mtimeMs);
      } catch {}
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
        // Heal null refresh_token: keep in-memory non-null if disk lost it
        if (token.refresh_token === null) {
          const memRefresh = this.tokens.get(account.id)?.refresh_token ?? null;
          if (memRefresh) {
            token.refresh_token = memRefresh;
            console.warn(`Healed null refresh_token for ${account.id} from memory`);
          } else {
            console.warn(`Token for ${account.id} has null refresh_token — will require re-authentication when access token expires`);
          }
        }
        this.tokens.set(account.id, token);
        try {
          const st = statSync(this.getTokenPath(account.id));
          this.fileMtimes.set(account.id, st.mtimeMs);
        } catch {}
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
   * Reload token from disk if disk is newer than memory.
   * Compares expiry_date and refresh_token, updating memory if disk is newer.
   */
  reloadFromDisk(accountId: string): void {
    const tokenPath = this.getTokenPath(accountId);
    if (!existsSync(tokenPath)) return;
    let mtimeMs: number | null = null;
    try {
      const st = statSync(tokenPath);
      mtimeMs = st.mtimeMs;
      const cached = this.fileMtimes.get(accountId);
      // If we have a cached mtime and file hasn't changed, skip read
      if (cached !== undefined && mtimeMs <= cached) {
        // Still check if we should skip even when mtime unchanged; avoid unnecessary I/O
        // but allow reload if memory is missing
        if (this.tokens.has(accountId)) return;
      }
    } catch {
      // fall through to read attempt
    }
    const diskToken = this.loadToken(accountId);
    if (!diskToken) return;
    const memToken = this.tokens.get(accountId);
    if (!memToken) {
      // No memory token — heal null refresh already handled in load path but log here too
      if (diskToken.refresh_token === null) {
        console.warn(`Token for ${accountId} has null refresh_token — will require re-authentication when access token expires`);
      }
      this.tokens.set(accountId, diskToken);
      if (mtimeMs !== null) this.fileMtimes.set(accountId, mtimeMs);
      const client = this.getClient(accountId);
      client.setCredentials({
        access_token: diskToken.access_token,
        refresh_token: diskToken.refresh_token,
        expiry_date: diskToken.expiry_date,
        scope: diskToken.scope,
        token_type: diskToken.token_type,
      });
      return;
    }
    // Heal disk null refresh from memory before comparison
    if (diskToken.refresh_token === null && memToken.refresh_token) {
      diskToken.refresh_token = memToken.refresh_token;
    }
    // If disk is newer (higher expiry_date) or has a refresh_token that memory lacks, update memory
    const diskNewer = diskToken.expiry_date > memToken.expiry_date;
    const diskHasRefreshMemMissing = !!diskToken.refresh_token && !memToken.refresh_token;
    const shouldUpdate = diskNewer || diskHasRefreshMemMissing || mtimeMs === null || (this.fileMtimes.get(accountId) !== undefined && mtimeMs > (this.fileMtimes.get(accountId) ?? 0));
    if (shouldUpdate) {
      // Prefer disk if newer; preserve refresh_token if disk lost it
      if (!diskToken.refresh_token && memToken.refresh_token) {
        diskToken.refresh_token = memToken.refresh_token;
      }
      this.tokens.set(accountId, diskToken);
      if (mtimeMs !== null) this.fileMtimes.set(accountId, mtimeMs);
      const client = this.getClient(accountId);
      client.setCredentials({
        access_token: diskToken.access_token,
        refresh_token: diskToken.refresh_token,
        expiry_date: diskToken.expiry_date,
        scope: diskToken.scope,
        token_type: diskToken.token_type,
      });
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
    // Reconcile disk vs memory: pick up out-of-process writes before validity check
    this.reloadFromDisk(accountId);
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
        this.lastRefreshAt.set(accountId, Date.now());
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
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_OAUTH_CONFIG.scopes,
      prompt: 'consent',
      include_granted_scopes: true,
      state: accountId,
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
        refresh_token:
          tokens.refresh_token ??
          this.tokens.get(accountId)?.refresh_token ??
          this.loadToken(accountId)?.refresh_token ??
          null,
        expiry_date: tokens.expiry_date ?? Date.now() + 3600_000,
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
    const client = this.clients.get(accountId);
    if (client) {
      try { void client.revokeCredentials().catch(() => {}); } catch {}
    }
    this.tokens.delete(accountId);
    this.clients.delete(accountId);
    this.fileMtimes.delete(accountId);
    this.lastRefreshAt.delete(accountId);
    const tokenPath = this.getTokenPath(accountId);
    try {
      if (existsSync(tokenPath)) unlinkSync(tokenPath);
    } catch {
      // Ignore
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

  getTokenDiagnostics(accountId: string): {
    id: string;
    expiryDate: number | null;
    daysRemaining: number | null;
    refreshTokenPresent: boolean;
    hasValidToken: boolean;
    isConnected: boolean;
    fileExists: boolean;
    lastRefreshAt: number | null;
  } {
    const token = this.tokens.get(accountId) ?? this.loadToken(accountId);
    const fileExists = existsSync(this.getTokenPath(accountId));
    const expiryDate = token?.expiry_date ?? null;
    const daysRemaining = expiryDate !== null ? Math.floor((expiryDate - Date.now()) / 86400000) : null;
    return {
      id: accountId,
      expiryDate,
      daysRemaining,
      refreshTokenPresent: !!token?.refresh_token,
      hasValidToken: this.hasValidToken(accountId),
      isConnected: this.isConnected(accountId),
      fileExists,
      lastRefreshAt: this.lastRefreshAt.get(accountId) ?? null,
    };
  }

  async refreshIfNeeded(accountId: string): Promise<boolean> {
    const stored = this.tokens.get(accountId) ?? this.loadToken(accountId);
    if (!stored) return false;
    if (!stored.refresh_token) return false;
    const expiresInMs = stored.expiry_date - Date.now();
    const hoursRemaining = expiresInMs / 3_600_000;
    const daysRemaining = expiresInMs / 86_400_000;
    const shouldRefresh = expiresInMs < 30 * 60 * 1000 || daysRemaining < 3 || !this.hasValidToken(accountId);
    if (!shouldRefresh) return false;
    const start = Date.now();
    try {
      await this.getAccessToken(accountId);
      this.lastRefreshAt.set(accountId, Date.now());
      console.log(`[AuthRefresh] refreshed ${accountId} in ${Date.now() - start}ms (was ${hoursRemaining.toFixed(1)}h remaining)`);
      return true;
    } catch (error) {
      console.warn(`[AuthRefresh] failed for ${accountId}:`, error instanceof Error ? error.message : String(error));
      return false;
    }
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