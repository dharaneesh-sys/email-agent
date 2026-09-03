import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as RKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { EmailAction, EmailListItem } from '../types';
import { api } from '../api';
import { mark } from '../utils/perf';

interface CommandPaletteProps {
  open: boolean;
  emails: EmailListItem[];
  activeEmail: EmailListItem | null;
  onClose(): void;
  onSelectEmail(email: EmailListItem): void;
  onAction(email: EmailListItem, action: EmailAction): void;
  onReply(email: EmailListItem): void;
  onShowStats?(): void;
  onReconnect?(): void;
}

interface PaletteItem {
  key: string;
  section: 'Recent' | 'Jump to' | 'Actions' | 'Navigate';
  label: string;
  detail?: string;
  keywords: string;
  run(): void;
}

type Page = 'root' | 'actions' | 'emails';

const MAX_RESULTS = 10;
const RECENT_KEY = 'email-agent:palette-recent';
const MAX_RECENT = 5;

function matches(item: PaletteItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return `${item.label} ${item.detail ?? ''} ${item.keywords}`.toLowerCase().includes(q);
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
  } catch {
    // ignore
  }
}

export function CommandPalette({
  open,
  emails,
  activeEmail,
  onClose,
  onSelectEmail,
  onAction,
  onReply,
  onShowStats,
  onReconnect,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [pageStack, setPageStack] = useState<Page[]>(['root']);
  const [recentIds, setRecentIds] = useState<string[]>(() => loadRecent());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const currentPage = pageStack[pageStack.length - 1] ?? 'root';

  // Reset on open, capture trigger, focus input, mark perf
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActiveIdx(0);
    setPageStack(['root']);
    setRecentIds(loadRecent());
    mark('palette:open');
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  // Keep palette focused if input blurs to backdrop (focus trap helper)
  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const pushPage = useCallback((page: Page) => {
    setPageStack((prev) => [...prev, page]);
    setActiveIdx(0);
    setQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const popPage = useCallback(() => {
    setPageStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    setActiveIdx(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const closeWithReturn = useCallback(() => {
    const prev = prevFocusRef.current;
    onClose();
    window.setTimeout(() => {
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus();
    }, 0);
  }, [onClose]);

  // Build base items
  const { recentItems, emailItems, staticItems, actionItems } = useMemo(() => {
    const recent: PaletteItem[] = recentIds
      .map((id) => emails.find((e) => e.id === id))
      .filter((e): e is EmailListItem => Boolean(e))
      .map((email) => ({
        key: `recent-${email.id}`,
        section: 'Recent' as const,
        label: email.subject || '(No Subject)',
        detail: email.from,
        keywords: `recent ${email.snippet ?? ''}`,
        run: () => onSelectEmail(email),
      }));

    const eItems: PaletteItem[] = emails.slice(0, 50).map((email) => ({
      key: `email-${email.id}`,
      section: 'Jump to' as const,
      label: email.subject || '(No Subject)',
      detail: email.from,
      keywords: email.snippet ?? '',
      run: () => onSelectEmail(email),
    }));

    const sItems: PaletteItem[] = [
      {
        key: 'act-show-stats',
        section: 'Actions' as const,
        label: 'Show stats',
        detail: 'Mailbox statistics',
        keywords: 'show stats mailbox unread important total statistics',
        run: () => {
          if (onShowStats) onShowStats();
          else window.dispatchEvent(new CustomEvent('email-agent:show-stats'));
        },
      },
      {
        key: 'act-reconnect',
        section: 'Actions' as const,
        label: 'Reconnect Gmail',
        detail: 'Re-authenticate Google account',
        keywords: 'reconnect gmail auth google re-authenticate connect',
        run: () => {
          if (onReconnect) {
            onReconnect();
            return;
          }
          void (async () => {
            try {
              const status = await api.authStatus();
              const list = status.accounts ?? [];
              const target = list.find((a) => a.authenticated) ?? list[0] ?? null;
              const accountId = target?.id ?? 'primary';
              const data = await api.authUrl(accountId);
              if (data.authUrl) window.location.href = data.authUrl;
            } catch {
              // silent
            }
          })();
        },
      },
      {
        key: 'act-toggle-theme',
        section: 'Actions' as const,
        label: 'Toggle theme',
        detail: 'Cycle system / light / dark',
        keywords: 'toggle theme light dark system appearance',
        run: () => {
          try {
            const key = 'email-agent:theme';
            const cur = localStorage.getItem(key);
            const curNorm = cur === 'light' || cur === 'dark' || cur === 'system' ? cur : 'system';
            const next = curNorm === 'system' ? 'light' : curNorm === 'light' ? 'dark' : 'system';
            localStorage.setItem(key, next);
            const systemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
            const effective = next === 'system' ? (systemLight ? 'light' : 'dark') : next;
            if (effective === 'light') document.documentElement.setAttribute('data-theme', 'light');
            else document.documentElement.removeAttribute('data-theme');
          } catch {
            // storage unavailable
          }
        },
      },
    ];

    if (activeEmail) {
      sItems.push({
        key: 'act-copy-link',
        section: 'Actions' as const,
        label: 'Copy email link',
        detail: activeEmail.subject || '(No Subject)',
        keywords: 'copy email link clipboard url share',
        run: () => {
          const url = `${window.location.origin}${window.location.pathname}#email-${activeEmail.id}`;
          const fallback = () => {
            try {
              const ta = document.createElement('textarea');
              ta.value = url;
              ta.setAttribute('readonly', '');
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
            } catch {
              // ignore
            }
          };
          if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(url).catch(fallback);
          else fallback();
        },
      });
    }

    const aItems: PaletteItem[] = [];
    if (activeEmail) {
      const target = activeEmail;
      aItems.push(
        {
          key: 'act-archive',
          section: 'Actions' as const,
          label: 'Archive',
          detail: target.subject || '(No Subject)',
          keywords: 'archive email',
          run: () => onAction(target, 'archive'),
        },
        {
          key: 'act-star',
          section: 'Actions' as const,
          label: target.labels.includes('STARRED') ? 'Unstar' : 'Star',
          detail: target.subject || '(No Subject)',
          keywords: 'star favourite',
          run: () => onAction(target, target.labels.includes('STARRED') ? 'unstar' : 'star'),
        },
        {
          key: 'act-read',
          section: 'Actions' as const,
          label: target.isUnread ? 'Mark as read' : 'Mark as unread',
          detail: target.subject || '(No Subject)',
          keywords: 'read unread',
          run: () => onAction(target, target.isUnread ? 'read' : 'unread'),
        },
        {
          key: 'act-reply',
          section: 'Actions' as const,
          label: 'Reply…',
          detail: target.subject || '(No Subject)',
          keywords: 'reply respond draft',
          run: () => onReply(target),
        },
      );
    }

    return { recentItems: recent, emailItems: eItems, staticItems: sItems, actionItems: aItems };
  }, [emails, activeEmail, recentIds, onSelectEmail, onAction, onReply, onShowStats, onReconnect]);

  // Navigation drill items visible only on root when query empty
  const navItems = useMemo<PaletteItem[]>(() => {
    if (currentPage !== 'root') return [];
    const items: PaletteItem[] = [];
    const totalActions = staticItems.length + actionItems.length;
    if (totalActions > 0) {
      items.push({
        key: 'nav-actions',
        section: 'Navigate' as const,
        label: 'Actions…',
        detail: `${totalActions} commands`,
        keywords: 'actions navigate commands',
        run: () => pushPage('actions'),
      });
    }
    if (emailItems.length > 0) {
      items.push({
        key: 'nav-emails',
        section: 'Navigate' as const,
        label: 'Jump to email…',
        detail: `${emailItems.length} emails`,
        keywords: 'jump emails navigate',
        run: () => pushPage('emails'),
      });
    }
    return items;
  }, [currentPage, staticItems.length, actionItems.length, emailItems.length, pushPage]);

  // Items for current page before filtering
  const pageItems = useMemo<PaletteItem[]>(() => {
    if (currentPage === 'actions') return [...staticItems, ...actionItems];
    if (currentPage === 'emails') return [...emailItems];
    // root: recent at top, then actions, then emails (+ nav when empty query but treat nav as filtered too)
    // navItems are appended but participate in fuzzy
    return [...recentItems, ...staticItems, ...actionItems, ...emailItems, ...navItems];
  }, [currentPage, recentItems, staticItems, actionItems, emailItems, navItems]);

  const filtered = useMemo(() => {
    const base = pageItems.filter((item) => matches(item, query));
    // When on root with empty query, ensure recent stays capped and ordered before others
    // Already ordered; just slice to max
    return base.slice(0, MAX_RESULTS);
  }, [pageItems, query]);

  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const persistRecentFor = useCallback(
    (item: PaletteItem) => {
      // Only email jumps count for recent
      const m = item.key.match(/^(?:email|recent)-(.+)$/);
      if (!m) return;
      const id = m[1];
      if (!id) return;
      const next = [id, ...recentIds.filter((x) => x !== id)].slice(0, MAX_RECENT);
      setRecentIds(next);
      saveRecent(next);
    },
    [recentIds],
  );

  const runItem = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      // nav items push instead of close
      if (item.key === 'nav-actions' || item.key === 'nav-emails') {
        item.run();
        return;
      }
      persistRecentFor(item);
      closeWithReturn();
      item.run();
    },
    [persistRecentFor, closeWithReturn],
  );

  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'ArrowRight' && filtered[activeIdx]?.key.startsWith('nav-')) {
      e.preventDefault();
      runItem(filtered[activeIdx]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (pageStack.length > 1) popPage();
      else closeWithReturn();
    } else if (e.key === 'Backspace' && query === '' && pageStack.length > 1) {
      // Back navigates stack when input empty — mirror Esc
      e.preventDefault();
      popPage();
    } else if (e.key === 'Tab') {
      // Trap focus: keep inside palette, cycle active index
      e.preventDefault();
      if (e.shiftKey) setActiveIdx((i) => Math.max(i - 1, 0));
      else setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      focusInput();
    }
  };

  // Document-level trap: Tab from outside returns to input while open
  useEffect(() => {
    if (!open) return;
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (!panelRef.current?.contains(document.activeElement)) {
        // Let palette's Tab handler manage it
        return;
      }
    };
    document.addEventListener('keydown', onDocKey);
    return () => document.removeEventListener('keydown', onDocKey);
  }, [open]);

  let lastSection: string | null = null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette-scrim"
          className="palette-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          onClick={closeWithReturn}
          aria-hidden="true"
        />
      )}
      {open && (
        <motion.div
          key="palette-panel"
          ref={panelRef}
          className="command-palette"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          initial={{ opacity: 0, scale: 0.97, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -8 }}
          transition={{ type: 'spring', duration: 0.2, bounce: 0.12 }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          {pageStack.length > 1 && (
            <div className="palette-breadcrumb" aria-label="Palette navigation">
              <button type="button" className="palette-back" onClick={popPage} aria-label="Back">
                ← Back
              </button>
              <span className="palette-crumb" aria-current="page">
                {currentPage === 'actions' ? 'Actions' : currentPage === 'emails' ? 'Jump to' : 'All'}
              </span>
            </div>
          )}
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            placeholder={
              currentPage === 'actions'
                ? 'Filter actions…'
                : currentPage === 'emails'
                  ? 'Jump to email…'
                  : 'Search emails or type a command…'
            }
            value={query}
            aria-controls="palette-listbox"
            aria-activedescendant={filtered[activeIdx] ? `palette-opt-${activeIdx}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
          />
          <div className="palette-list" id="palette-listbox" role="listbox" aria-label="Commands" ref={listRef}>
            {filtered.length === 0 ? (
              <p className="palette-empty">No matches</p>
            ) : (
              filtered.map((item, idx) => {
                const header =
                  item.section !== lastSection ? (
                    <p className="palette-section" key={`sec-${item.key}-${item.section}`}>
                      {item.section}
                    </p>
                  ) : null;
                lastSection = item.section;
                const isActive = idx === activeIdx;
                return (
                  <Fragment key={item.key}>
                    {header}
                    <div
                      id={`palette-opt-${idx}`}
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive || undefined}
                      data-option=""
                      className={`palette-option${isActive ? ' is-active' : ''}`}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => runItem(item)}
                    >
                      <span className="palette-option-label">{item.label}</span>
                      {item.detail && <span className="palette-option-detail">{item.detail}</span>}
                      {item.key.startsWith('nav-') && <span className="palette-option-chevron" aria-hidden="true">›</span>}
                    </div>
                  </Fragment>
                );
              })
            )}
          </div>
          <footer className="palette-footer">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>→ drill</span>
            <span>esc {pageStack.length > 1 ? 'back' : 'close'}</span>
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
