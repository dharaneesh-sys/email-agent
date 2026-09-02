import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as RKeyboardEvent } from 'react';
import type { EmailAction, EmailListItem } from '../types';
import { api } from '../api';
import { mark } from '../utils/perf';

interface CommandPaletteProps {
  open: boolean;
  emails: EmailListItem[];
  /** Currently selected email — actions target it when present. */
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
  section: 'Jump to' | 'Actions';
  label: string;
  detail?: string;
  keywords: string;
  run(): void;
}

const MAX_RESULTS = 10;

/** Case-insensitive substring fuzzy match across label + detail + keywords. */
function matches(item: PaletteItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return `${item.label} ${item.detail ?? ''} ${item.keywords}`.toLowerCase().includes(q);
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActiveIdx(0);
    mark('palette:open');
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const emailItems: PaletteItem[] = emails.slice(0, 50).map((email) => ({
      key: `email-${email.id}`,
      section: 'Jump to',
      label: email.subject || '(No Subject)',
      detail: email.from,
      keywords: email.snippet ?? '',
      run: () => onSelectEmail(email),
    }));

    const staticItems: PaletteItem[] = [
      {
        key: 'act-show-stats',
        section: 'Actions',
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
        section: 'Actions',
        label: 'Reconnect Gmail',
        detail: 'Re-authenticate Google account',
        keywords: 'reconnect gmail auth google re-authenticate connect',
        run: () => {
          if (onReconnect) { onReconnect(); return; }
          void (async () => {
            try {
              const status = await api.authStatus();
              const list = status.accounts ?? [];
              const target = list.find((a) => a.authenticated) ?? list[0] ?? null;
              const accountId = target?.id ?? 'primary';
              const data = await api.authUrl(accountId);
              if (data.authUrl) window.location.href = data.authUrl;
            } catch {
              // silent — auth endpoint may be unavailable
            }
          })();
        },
      },
      {
        key: 'act-toggle-theme',
        section: 'Actions',
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
      staticItems.push({
        key: 'act-copy-link',
        section: 'Actions',
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

    const actionItems: PaletteItem[] = [];
    if (activeEmail) {
      const target = activeEmail;
      actionItems.push(
        {
          key: 'act-archive',
          section: 'Actions',
          label: 'Archive',
          detail: target.subject || '(No Subject)',
          keywords: 'archive email',
          run: () => onAction(target, 'archive'),
        },
        {
          key: 'act-star',
          section: 'Actions',
          label: target.labels.includes('STARRED') ? 'Unstar' : 'Star',
          detail: target.subject || '(No Subject)',
          keywords: 'star favourite',
          run: () => onAction(target, target.labels.includes('STARRED') ? 'unstar' : 'star'),
        },
        {
          key: 'act-read',
          section: 'Actions',
          label: target.isUnread ? 'Mark as read' : 'Mark as unread',
          detail: target.subject || '(No Subject)',
          keywords: 'read unread',
          run: () => onAction(target, target.isUnread ? 'read' : 'unread'),
        },
        {
          key: 'act-reply',
          section: 'Actions',
          label: 'Reply…',
          detail: target.subject || '(No Subject)',
          keywords: 'reply respond draft',
          run: () => onReply(target),
        },
      );
    }
    return [...staticItems, ...actionItems, ...emailItems];
  }, [emails, activeEmail, onSelectEmail, onAction, onReply, onShowStats, onReconnect]);

  const filtered = useMemo(() => items.filter((item) => matches(item, query)).slice(0, MAX_RESULTS), [items, query]);

  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const prev = prevFocusRef.current;
      onClose();
      window.setTimeout(() => {
        if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus();
      }, 0);
    }
  };

  let lastSection: string | null = null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          placeholder="Search emails or type a command…"
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
                  <p className="palette-section" key={`sec-${item.section}`}>
                    {item.section}
                  </p>
                ) : null;
              lastSection = item.section;
              return (
                <Fragment key={item.key}>
                  {header}
                  <div
                    id={`palette-opt-${idx}`}
                    role="option"
                    aria-selected={idx === activeIdx}
                    data-active={idx === activeIdx || undefined}
                    className={`palette-option${idx === activeIdx ? ' is-active' : ''}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => runItem(item)}
                  >
                    <span className="palette-option-label">{item.label}</span>
                    {item.detail && <span className="palette-option-detail">{item.detail}</span>}
                  </div>
                </Fragment>
              );
            })
          )}
        </div>
        <footer className="palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </footer>
      </div>
    </div>
  );
}
