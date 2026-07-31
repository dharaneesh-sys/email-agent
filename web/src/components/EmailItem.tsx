import { memo } from 'react';
import type { MouseEvent } from 'react';
import type { EmailAction, EmailListItem } from '../types';
import { avatarIndex, formatDate, initials } from '../utils';
import { IconButton } from './Button';
import { ScoreChip } from './ScoreChip';
import {
  ArchiveIcon,
  BoltIcon,
  CircleIcon,
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
}: EmailItemProps) {
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
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const t = e.target as HTMLElement;
          if (t.closest('button, input')) return;
          e.preventDefault();
          onSelect(email);
        }
      }}
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
    >
      <span className="row-checkbox-wrap">
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
      </span>

      <span
        className={`avatar avatar-c${avatarIndex(email.from)}`}
        aria-hidden="true"
      >
        {initials(email.from)}
      </span>

      <div className="row-content">
        <div className="row-topline">
          <span className="row-sender">{email.from}</span>
          <time className="row-date" dateTime={email.date}>
            {formatDate(new Date(email.date))}
          </time>
        </div>
        <div className="row-subject">{email.subject}</div>
        <div className="row-snippet">{email.snippet}</div>
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
