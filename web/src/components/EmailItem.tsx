import { memo, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { EmailAction, EmailListItem, SnoozeDuration } from '../types';
import { avatarIndex, formatDate, initials } from '../utils';
import { IconButton } from './Button';
import { ScoreChip } from './ScoreChip';
import {
  ArchiveIcon,
  BoltIcon,
  CircleIcon,
  ClockIcon,
  MailIcon,
  MailOpenIcon,
  ReplyIcon,
  StarIcon,
  StarOutlineIcon,
  TrashIcon,
} from '../icons';

interface EmailItemProps {
  email: EmailListItem;
  index: number;
  selected: boolean;
  analyzing: boolean;
  busy: boolean;
  onSelect(email: EmailListItem): void;
  onAction(email: EmailListItem, action: EmailAction): void;
  onReply(email: EmailListItem): void;
  onSnooze?: ((email: EmailListItem, duration: SnoozeDuration) => void) | undefined;
  selectionMode?: boolean;
  checked?: boolean | undefined;
  onToggleSelect?: ((email: EmailListItem) => void) | undefined;
  /** Roving tabindex: 0 for active option, -1 otherwise. Computed by EmailList to keep virtualization clean. */
  rovingTabIndex?: number | undefined;
}

const FILTERED_LABELS = new Set(['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT']);

export const EmailItem = memo(function EmailItem({
  email,
  index,
  selected,
  analyzing,
  busy,
  onSelect,
  onAction,
  onReply,
  onSnooze,
  selectionMode = false,
  checked = false,
  onToggleSelect,
  rovingTabIndex,
}: EmailItemProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const handleMouseMove = (e: MouseEvent<HTMLElement>) => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const target = e.currentTarget;
    const { clientX, clientY } = e;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      target.style.setProperty('--mouse-x', `${x}px`);
      target.style.setProperty('--mouse-y', `${y}px`);
      rafRef.current = null;
    });
  };
  const handleMouseLeave = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };
  useEffect(() => {
    if (!snoozeOpen) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) setSnoozeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSnoozeOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [snoozeOpen]);
  const isStarred = email.labels.includes('STARRED');
  const otherLabels = email.labels.filter((l) => !FILTERED_LABELS.has(l));
  const scoreTipId = `score-tip-${email.id}`;
  const badgeTipId = `badge-tip-${email.id}`;

  const className = [
    'email-item',
    email.isUnread ? 'unread' : '',
    email.isImportant ? 'important' : '',
    selected ? 'selected' : '',
    analyzing ? 'analyzing' : '',
    busy ? 'busy' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const open = (e?: MouseEvent<HTMLElement>) => {
    if (e) {
      const t = e.target as HTMLElement;
      if (t.closest('button, input, a')) return;
    }
    onSelect(email);
  };

  return (
    <article
      className={className}
      data-email-id={email.id}
      role="option"
      aria-selected={selected}
      tabIndex={rovingTabIndex !== undefined ? rovingTabIndex : selected ? 0 : -1}
      onClick={open}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const t = e.target as HTMLElement;
          if (t.closest('button, input')) return;
          e.preventDefault();
          onSelect(email);
        }
      }}
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
    >
      <span className="row-checkbox-wrap">
        {selectionMode ? (
          <input
            type="checkbox"
            className="row-checkbox"
            checked={checked}
            aria-label={`Select ${email.subject || 'email'}`}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect?.(email)}
          />
        ) : (
          <input
            type="checkbox"
            className="row-checkbox"
            checked={!email.isUnread}
            disabled={busy}
            aria-label={email.isUnread ? 'Mark as read' : 'Mark as unread'}
            onChange={(e) => {
              e.stopPropagation();
              onAction(email, email.isUnread ? 'read' : 'unread');
            }}
          />
        )}
      </span>

      <span
        className={`avatar avatar-c${avatarIndex(email.from)}`}
        aria-hidden="true"
      >
        {initials(email.from)}
      </span>

      <div className="row-content">
        <div className="row-topline">
          <span className="row-sender" title={email.from}>
            {email.from}
          </span>
          <time className="row-date" dateTime={email.date} title={new Date(email.date).toLocaleString()}>
            {formatDate(new Date(email.date))}
          </time>
        </div>
        <div className="row-subject" title={email.subject}>
          {email.subject}
        </div>
        <div className="row-snippet" title={email.snippet}>
          {email.snippet}
        </div>
        <div className="row-tags">
          {email.isImportant && (
            <span className="tag tag-important">
              <BoltIcon size={12} />
              Important
            </span>
          )}
          {isStarred && (
            <span className="tag tag-starred">
              <StarIcon size={12} />
              Starred
            </span>
          )}
          {otherLabels.map((l) => (
            <span key={l} className="tag tag-label">
              {l}
            </span>
          ))}
          {typeof email.llmScore === 'number' && (
            <ScoreChip score={email.llmScore} reason={email.llmReason} tooltipId={scoreTipId} />
          )}
          {typeof email.llmScore === 'number' && email.llmReason && (
            <span className="chip-wrap">
              <span className="llm-badge" tabIndex={0} aria-describedby={badgeTipId}>
                AI
              </span>
              <span className="chip-tooltip" id={badgeTipId} role="tooltip">
                {email.llmReason}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="row-actions">
        <IconButton
          size="sm"
          label={email.isUnread ? 'Mark as read' : 'Mark as unread'}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onAction(email, email.isUnread ? 'read' : 'unread');
          }}
        >
          {email.isUnread ? <MailOpenIcon size={16} /> : <MailIcon size={16} />}
        </IconButton>
        <IconButton
          size="sm"
          label={isStarred ? 'Unstar' : 'Star'}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onAction(email, isStarred ? 'unstar' : 'star');
          }}
        >
          {isStarred ? <StarIcon size={16} /> : <StarOutlineIcon size={16} />}
        </IconButton>
        <IconButton
          size="sm"
          label="Archive"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onAction(email, 'archive');
          }}
        >
          <ArchiveIcon size={16} />
        </IconButton>
        <IconButton
          size="sm"
          label={email.isImportant ? 'Remove important' : 'Mark as important'}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onAction(email, email.isImportant ? 'unimportant' : 'important');
          }}
        >
          {email.isImportant ? <BoltIcon size={16} /> : <CircleIcon size={16} />}
        </IconButton>
        <IconButton
          size="sm"
          label="Reply"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onReply(email);
          }}
        >
          <ReplyIcon size={16} />
        </IconButton>
        <div className="snooze-wrap" ref={snoozeRef} style={{ position: 'relative' }}>
          <IconButton
            size="sm"
            label="Snooze"
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={snoozeOpen}
            onClick={(e) => {
              e.stopPropagation();
              setSnoozeOpen((v) => !v);
            }}
          >
            <ClockIcon size={16} />
          </IconButton>
          {snoozeOpen && (
            <div role="menu" className="snooze-menu" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 10, background: 'var(--surface-elevated)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 4, minWidth: 140, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
              {(['3h', 'tomorrow', 'nextWeek'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="menuitem"
                  className="snooze-option"
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSnoozeOpen(false);
                    if (onSnooze) onSnooze(email, d);
                  }}
                >
                  {d === '3h' ? '3 hours' : d === 'tomorrow' ? 'Tomorrow 9am' : 'Next week'}
                </button>
              ))}
            </div>
          )}
        </div>
        <IconButton
          size="sm"
          label="Delete"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onAction(email, 'trash');
          }}
        >
          <TrashIcon size={16} />
        </IconButton>
      </div>
    </article>
  );
});
