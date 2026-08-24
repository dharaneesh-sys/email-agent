import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountStatus, EmailAction, EmailListItem, Filter, Tone, ToastVariant } from '../types';
import { api } from '../api';
import { shortenModelName } from '../utils';
import { NavRail, type NavRailAuth, type NavRailCounts } from './NavRail';
import { SearchField } from './SearchField';
import { EmailList } from './EmailList';
import { DetailPane } from './DetailPane';
import { ReplyModal } from './ReplyModal';
import { CommandPalette } from './CommandPalette';
import { Toast, type ToastState } from './Toast';
import { Button, IconButton } from './Button';
import { RefreshIcon, SparklesIcon } from '../icons';

type AuthState =
  | { status: 'checking' }
  | { status: 'ready'; accounts: AccountStatus[] };

const initialStats = { unread: null, important: null, total: null };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState<{ accountId: string; action: 'connect' | 'disconnect' } | null>(null);
  const [emails, setEmails] = useState<EmailListItem[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsError, setEmailsError] = useState(false);
  const [currentFilter, setCurrentFilter] = useState<Filter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [stats, setStats] = useState<{ unread: number | null; important: number | null; total: number | null }>(initialStats);
  const [modelName, setModelName] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [replyEmail, setReplyEmail] = useState<EmailListItem | null>(null);
  const [replyPrefill, setReplyPrefill] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const importanceInitialized = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const toastId = useRef(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const searchQueryRef = useRef('');
  const [serverQuery, setServerQuery] = useState('');
  const serverQueryRef = useRef('');
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  // Account id read by async callbacks. Set imperatively in initAuth/disconnect
  // (before any setState) so the mount-time init sequence never sees a stale
  // closure with `currentAccountId === null`.
  const currentAccountIdRef = useRef<string | null>(null);
  // Refs so async callbacks (handleAction, refreshImportance) read fresh state
  // without recreating the callback (keeps EmailList/EmailItem memo effective).
  const busyIdsRef = useRef<ReadonlySet<string>>(new Set());
  const selectedEmailIdRef = useRef<string | null>(null);
  const emailsRef = useRef<EmailListItem[]>([]);
  const filteredEmailsRef = useRef<EmailListItem[]>([]);
  // In-flight guards — prevent duplicate Analyze / Refresh requests.
  const analyzingRef = useRef(false);
  const refreshingRef = useRef(false);
  // Monotonic load sequence — discards responses superseded by a newer fetch
  // (e.g. auto-refresh overlapping a manual refresh, or an account switch).
  const emailsSeq = useRef(0);

  const currentAccountId = auth.status === 'ready' ? (auth.accounts.find((a) => a.id === activeAccountId)?.authenticated ? activeAccountId : null) : null;
  currentAccountIdRef.current = currentAccountId;
  busyIdsRef.current = busyIds;
  selectedEmailIdRef.current = selectedEmailId;
  const accounts = auth.status === 'ready' ? auth.accounts : [];

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    serverQueryRef.current = serverQuery;
  });

  // --- Toast ---------------------------------------------------------------

  const notify = useCallback((message: string, variant: ToastVariant = 'info') => {
    toastId.current += 1;
    setToast({ id: toastId.current, message, variant, leaving: false });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast((prev) => (prev ? { ...prev, leaving: true } : prev));
      toastTimer.current = window.setTimeout(
        () => setToast((prev) => (prev && prev.leaving ? null : prev)),
        200,
      );
    }, 2800);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // --- Derived state -------------------------------------------------------

  const filteredEmails = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = emails.filter((email) => {
      const matchesSearch =
        q === '' ||
        email.subject.toLowerCase().includes(q) ||
        email.from.toLowerCase().includes(q) ||
        email.snippet.toLowerCase().includes(q);
      const matchesFilter =
        currentFilter === 'all' ||
        (currentFilter === 'unread' && email.isUnread) ||
        (currentFilter === 'important' && email.isImportant) ||
        (currentFilter === 'starred' && email.labels.includes('STARRED'));
      return matchesSearch && matchesFilter;
    });
    return filtered.sort((a, b) => {
      if (a.isImportant !== b.isImportant) return b.isImportant ? 1 : -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [emails, searchQuery, currentFilter]);

  emailsRef.current = emails;
  filteredEmailsRef.current = filteredEmails;

  const selectedEmail = useMemo(
    () => emails.find((e) => e.id === selectedEmailId) ?? null,
    [emails, selectedEmailId],
  );

  const starredCount = useMemo(
    () => emails.filter((e) => e.labels.includes('STARRED')).length,
    [emails],
  );

  const navCounts = useMemo<NavRailCounts>(
    () => ({ all: stats.total, unread: stats.unread, important: stats.important, starred: starredCount }),
    [stats, starredCount],
  );

  const navAuth = useMemo<NavRailAuth>(
    () => ({
      status: auth.status,
      accounts: auth.status === 'ready' ? auth.accounts : [],
      activeAccountId,
      busy: authBusy,
    }),
    [auth, activeAccountId, authBusy],
  );

  // --- API operations ------------------------------------------------------

  const refreshImportance = useCallback(
    async (isAuto: boolean) => {
      if (analyzingRef.current) return;
      if (!emailsRef.current.length || !currentAccountIdRef.current) {
        if (!isAuto) notify('No emails to analyze', 'error');
        return;
      }
      const visibleIds = (filteredEmailsRef.current.length ? filteredEmailsRef.current : emailsRef.current).map((e) => e.id);
      analyzingRef.current = true;
      setAnalyzing(true);
      try {
        const data = await api.importanceRefresh(visibleIds, currentAccountIdRef.current);
        const scores = data.scores ?? [];
        if (scores.length) {
          setEmails((prev) =>
            prev.map((email) => {
              const score = scores.find((s) => s.emailId === email.id);
              if (!score) return email;
              return {
                ...email,
                ...(typeof score.llmScore === 'number' ? { llmScore: score.llmScore } : {}),
                ...(score.reason ? { llmReason: score.reason } : {}),
                ...(typeof score.isImportant === 'boolean' ? { isImportant: score.isImportant } : {}),
              };
            }),
          );
        }
        if (data.model) setModelName(shortenModelName(data.model));
        notify(scores.length ? `Analyzed ${scores.length} emails` : 'Importance analysis completed', 'success');
      } catch {
        if (!isAuto) notify('AI analysis failed', 'error');
      } finally {
        analyzingRef.current = false;
        setAnalyzing(false);
      }
    },
    [notify],
  );

  const loadEmails = useCallback(async () => {
    const accountId = currentAccountIdRef.current;
    if (!accountId) return;
    const seq = ++emailsSeq.current;
    setEmailsLoading(true);
    setEmailsError(false);
    try {
      const data = await api.emails(accountId, serverQueryRef.current);
      if (seq !== emailsSeq.current || currentAccountIdRef.current !== accountId) return;
      const list = data.emails ?? [];
      setEmails(list);
      if (!importanceInitialized.current && list.length > 0) {
        importanceInitialized.current = true;
        void refreshImportance(true);
      }
    } catch {
      if (seq !== emailsSeq.current || currentAccountIdRef.current !== accountId) return;
      setEmailsError(true);
    } finally {
      if (seq === emailsSeq.current) setEmailsLoading(false);
    }
  }, [refreshImportance]);

  const loadStats = useCallback(async () => {
    const account = currentAccountIdRef.current;
    if (!account) return;
    try {
      const data = await api.stats(account);
      if (currentAccountIdRef.current !== account) return;
      setStats({ unread: data.unreadCount ?? 0, important: data.importantCount ?? 0, total: data.totalInbox ?? 0 });
    } catch {
      // keep previous
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.config();
      const model = data.model ?? data.defaultModel;
      if (model) setModelName(shortenModelName(model));
    } catch {
      // endpoint absent — badge stays hidden
    }
  }, []);

  const initAuth = useCallback(async (preferredAccountId?: string | null) => {
    try {
      const data = await api.authStatus();
      const list = data.accounts ?? [];
      // Activate the account just connected via OAuth callback, else first authenticated
      const authed = list.filter((acc) => acc.authenticated);
      const target = preferredAccountId
        ? authed.find((acc) => acc.id === preferredAccountId) ?? null
        : authed[0] ?? null;
      currentAccountIdRef.current = target?.id ?? null;
      setActiveAccountId(target?.id ?? null);
      setAuth({ status: 'ready', accounts: list });
    } catch {
      currentAccountIdRef.current = null;
      setActiveAccountId(null);
      setAuth({ status: 'ready', accounts: [] });
    }
  }, []);

  const connect = useCallback(async (accountId: string) => {
    setAuthBusy({ accountId, action: 'connect' });
    try {
      const urlData = await api.authUrl(accountId);
      if (urlData.authUrl) {
        window.location.href = urlData.authUrl;
      } else {
        notify('Authentication failed', 'error');
      }
    } catch {
      notify('Authentication failed', 'error');
    } finally {
      setAuthBusy(null);
    }
  }, [notify]);

  const disconnect = useCallback(
    async (accountId: string) => {
      setAuthBusy({ accountId, action: 'disconnect' });
      try {
        await api.signout(accountId);
        const wasActive = activeAccountId === accountId;
        // Refresh account list from the server (signout clears the token).
        const data = await api.authStatus();
        const list = data.accounts ?? [];
        if (wasActive) {
          const fallback = list.find((a) => a.authenticated) ?? null;
          currentAccountIdRef.current = fallback?.id ?? null;
          setActiveAccountId(fallback?.id ?? null);
          setEmails([]);
          setSelectedEmailId(null);
          if (fallback) {
            void opsRef.current.loadStats();
            void opsRef.current.loadEmails();
          }
        }
        setAuth({ status: 'ready', accounts: list });
        notify('Disconnected successfully', 'success');
      } catch {
        // silent, like the old dashboard
      } finally {
        setAuthBusy(null);
      }
    },
    [activeAccountId, notify],
  );

  const switchAccount = useCallback((accountId: string) => {
    setActiveAccountId(accountId);
    const acc = accounts.find((a) => a.id === accountId);
    currentAccountIdRef.current = acc?.authenticated ? accountId : null;
    setEmails([]);
    setSelectedEmailId(null);
    setSearchQuery('');
    if (acc?.authenticated) {
      void opsRef.current.loadStats();
      void opsRef.current.loadEmails();
    }
  }, [accounts]);

  const applyLocalAction = useCallback((email: EmailListItem, action: EmailAction): EmailListItem => {
    switch (action) {
      case 'read':
        return { ...email, isUnread: false };
      case 'unread':
        return { ...email, isUnread: true };
      case 'star':
        return { ...email, labels: [...email.labels, 'STARRED'] };
      case 'unstar':
        return { ...email, labels: email.labels.filter((l) => l !== 'STARRED') };
      case 'archive':
      case 'trash':
        return { ...email, labels: email.labels.filter((l) => l !== 'INBOX') };
      case 'important':
        return { ...email, isImportant: true };
      case 'unimportant':
        return { ...email, isImportant: false };
    }
  }, []);

  const ACTION_LABELS: Record<EmailAction, string> = {
    read: 'marked as read',
    unread: 'marked as unread',
    star: 'starred',
    unstar: 'unstarred',
    archive: 'archived',
    important: 'marked as important',
    unimportant: 'marked as not important',
    trash: 'moved to trash',
  };

  const handleAction = useCallback(
    async (email: EmailListItem, action: EmailAction) => {
      if (!currentAccountId || busyIdsRef.current.has(email.id)) return;
      setBusyIds((prev) => new Set(prev).add(email.id));
      try {
        const data = await api.action(email.id, action, currentAccountId);
        if (!data.success) throw new Error('Action failed');
        setEmails((prev) =>
          action === 'trash'
            ? prev.filter((e) => e.id !== email.id)
            : prev.map((e) => (e.id === email.id ? applyLocalAction(e, action) : e)),
        );
        if (action === 'trash' && selectedEmailIdRef.current === email.id) setSelectedEmailId(null);
        void loadStats();
        notify(`Email ${ACTION_LABELS[action]}`, 'success');
      } catch {
        notify('Action failed', 'error');
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(email.id);
          return next;
        });
      }
    },
    [currentAccountId, applyLocalAction, loadStats, notify],
  );

  // --- Reply / draft flows -------------------------------------------------

  const openReply = useCallback((email: EmailListItem) => {
    setReplyPrefill(null);
    setReplyEmail(email);
  }, []);

  const sendReply = useCallback(
    async (body: string): Promise<boolean> => {
      if (!replyEmail || !currentAccountId) return false;
      try {
        const data = await api.sendReply(replyEmail.id, body, currentAccountId);
        if (!data.success) throw new Error('Reply failed');
        setReplyEmail(null);
        setReplyPrefill(null);
        notify('Reply sent!', 'success');
        return true;
      } catch {
        notify('Failed to send reply', 'error');
        return false;
      }
    },
    [replyEmail, currentAccountId, notify],
  );

  const draftReply = useCallback(
    async (tone: Tone) => {
      if (!selectedEmailId || !currentAccountId) {
        notify('Select an email first', 'error');
        return;
      }
      const email = emails.find((e) => e.id === selectedEmailId);
      if (!email) {
        notify('Email no longer in the list', 'error');
        return;
      }
      setDrafting(true);
      try {
        const data = await api.draftReply(selectedEmailId, tone, currentAccountId);
        if (!data.reply) {
          notify('Could not generate a draft', 'error');
          return;
        }
        setReplyEmail(email);
        setReplyPrefill(data.reply);
        notify('Draft ready for review', 'success');
      } catch {
        notify('Failed to draft reply', 'error');
      } finally {
        setDrafting(false);
      }
    },
    [selectedEmailId, currentAccountId, emails, notify],
  );

  const handleRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([loadEmails(), loadStats()]);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [loadEmails, loadStats]);

  const handleRetry = useCallback(() => {
    void loadEmails();
  }, [loadEmails]);

  const openDetail = useCallback((email: EmailListItem) => {
    setSelectedEmailId(email.id);
  }, []);

  // Debounced server search — typing updates the client filter instantly, the
  // Gmail query is pushed to /api/emails after a 300ms quiet period.
  useEffect(() => {
    const t = window.setTimeout(() => setServerQuery(searchQuery), 300);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const serverQueryMounted = useRef(false);
  useEffect(() => {
    if (!serverQueryMounted.current) {
      serverQueryMounted.current = true;
      return;
    }
    void opsRef.current.loadEmails();
  }, [serverQuery]);

  // --- Init sequence + auto-refresh ---------------------------------------

  const opsRef = useRef({ loadEmails, loadStats, initAuth, loadConfig });
  useEffect(() => {
    opsRef.current = { loadEmails, loadStats, initAuth, loadConfig };
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      notify('Account connected successfully!', 'success');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('auth') === 'failed') {
      notify(`Authentication failed: ${params.get('reason') ?? 'Unknown error'}`, 'error');
      window.history.replaceState({}, '', window.location.pathname);
    }

    const ops = opsRef.current;
    void ops.initAuth(params.get('account')).then(() => {
      void opsRef.current.loadStats();
      void opsRef.current.loadEmails();
    });
    void ops.loadConfig();

    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void opsRef.current.loadEmails();
        void opsRef.current.loadStats();
      }
    }, 120000);
    return () => window.clearInterval(timer);
  }, [notify]);

  // --- Keyboard shortcuts --------------------------------------------------

  const onGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      const isFormField =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true;

      if (e.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (replyEmail) {
          setReplyEmail(null);
          return;
        }
        if (selectedEmailId && window.matchMedia('(max-width: 767px)').matches) {
          setSelectedEmailId(null);
          return;
        }
        if (searchQuery) {
          setSearchQuery('');
          searchRef.current?.blur();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (isFormField) return;

      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (selectedEmailId) {
          e.preventDefault();
          const email = emails.find((x) => x.id === selectedEmailId);
          if (email) openReply(email);
        }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (filteredEmails.length === 0) return;
        e.preventDefault();
        const idx = filteredEmails.findIndex((x) => x.id === selectedEmailId);
        let nextIdx: number;
        if (idx === -1) nextIdx = e.key === 'ArrowDown' ? 0 : filteredEmails.length - 1;
        else if (e.key === 'ArrowDown') nextIdx = Math.min(idx + 1, filteredEmails.length - 1);
        else nextIdx = Math.max(idx - 1, 0);
        const item = filteredEmails[nextIdx];
        if (item) setSelectedEmailId(item.id);
      }
    },
    [paletteOpen, replyEmail, selectedEmailId, searchQuery, filteredEmails, emails, openReply],
  );

  useEffect(() => {
    keysRef.current = onGlobalKeyDown;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Keep the selected row in view when navigating with the keyboard
  useEffect(() => {
    if (!selectedEmailId) return;
    listRef.current
      ?.querySelector(`[data-email-id="${selectedEmailId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedEmailId]);

  // --- Render --------------------------------------------------------------

  const noAccount = currentAccountId === null && auth.status !== 'checking';
  const listLoading = emailsLoading || auth.status === 'checking';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#email-list">
        Skip to content
      </a>
      <p className="visually-hidden" role="status" aria-live="polite">
        {`${filteredEmails.length} emails shown`}
      </p>
      <div className="app-body">
        <NavRail
          currentFilter={currentFilter}
          counts={navCounts}
          auth={navAuth}
          onFilter={setCurrentFilter}
          onSelectAccount={switchAccount}
          onConnect={connect}
          onDisconnect={disconnect}
        />
        <div className="app-content">
          <div className="toolbar">
            <SearchField value={searchQuery} onChange={setSearchQuery} inputRef={searchRef} />
            <div className="stat-pills" aria-label="Mailbox statistics">
              <span className="stat-pill">
                <span className="stat-label">Unread</span>
                <span className="stat-value">{stats.unread ?? '–'}</span>
              </span>
              <span className="stat-pill">
                <span className="stat-label">Important</span>
                <span className="stat-value">{stats.important ?? '–'}</span>
              </span>
              <span className="stat-pill">
                <span className="stat-label">Total</span>
                <span className="stat-value">{stats.total ?? '–'}</span>
              </span>
            </div>
            {modelName && (
              <span className="model-badge">
                <span className="model-dot" aria-hidden="true" />
                {modelName}
              </span>
            )}
            <IconButton label="Refresh" disabled={refreshing} onClick={() => void handleRefresh()}>
              <RefreshIcon size={18} className={refreshing ? 'is-spinning' : ''} />
            </IconButton>
            <Button variant="primary" disabled={analyzing} onClick={() => void refreshImportance(false)}>
              <SparklesIcon size={16} />
              <span>{analyzing ? 'Analyzing…' : 'Analyze'}</span>
            </Button>
          </div>
          <div className="workspace" data-split={selectedEmailId ? '' : undefined}>
            <EmailList
              emails={filteredEmails}
              loading={listLoading}
              error={emailsError}
              noAccount={noAccount}
              selectedEmailId={selectedEmailId}
              analyzing={analyzing}
              busyIds={busyIds}
              listRef={listRef}
              onSelect={openDetail}
              onAction={handleAction}
              onReply={openReply}
              onRetry={handleRetry}
            />
            <DetailPane
              email={selectedEmail}
              accountId={currentAccountId}
              drafting={drafting}
              onDraft={(tone) => void draftReply(tone)}
              onBack={() => setSelectedEmailId(null)}
            />
          </div>
        </div>
      </div>
      <ReplyModal
        email={replyEmail}
        prefill={replyPrefill}
        onClose={() => setReplyEmail(null)}
        onSend={sendReply}
      />
      <CommandPalette
        open={paletteOpen}
        emails={filteredEmails}
        activeEmail={selectedEmail}
        onClose={() => setPaletteOpen(false)}
        onSelectEmail={(email) => {
          setPaletteOpen(false);
          openDetail(email);
        }}
        onAction={handleAction}
        onReply={(email) => {
          setPaletteOpen(false);
          openReply(email);
        }}
      />
      <Toast toast={toast} />
    </div>
  );
}
