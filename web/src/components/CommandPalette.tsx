import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as RKeyboardEvent } from 'react';
import type { EmailAction, EmailListItem } from '../types';

interface CommandPaletteProps {
  open: boolean;
  emails: EmailListItem[];
  /** Currently selected email — actions target it when present. */
  activeEmail: EmailListItem | null;
  onClose(): void;
  onSelectEmail(email: EmailListItem): void;
  onAction(email: EmailListItem, action: EmailAction): void;
  onReply(email: EmailListItem): void;
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
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
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
    return [...actionItems, ...emailItems];
  }, [emails, activeEmail, onSelectEmail, onAction, onReply]);

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
      onClose();
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
