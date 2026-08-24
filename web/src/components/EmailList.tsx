import { memo } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { EmailAction, EmailListItem } from '../types';
import { Button } from './Button';
import { EmailItem } from './EmailItem';
import { SkeletonRow } from './SkeletonRow';

interface EmailListProps {
  emails: EmailListItem[];
  loading: boolean;
  error: boolean;
  noAccount: boolean;
  selectedEmailId: string | null;
  analyzing: boolean;
  busyIds: ReadonlySet<string>;
  listRef: RefObject<HTMLElement | null>;
  searchActive: boolean;
  onSelect(email: EmailListItem): void;
  onAction(email: EmailListItem, action: EmailAction): void;
  onReply(email: EmailListItem): void;
  onRetry(): void;
  onClearSearch(): void;
}

export const EmailList = memo(function EmailList({
  emails,
  loading,
  error,
  noAccount,
  selectedEmailId,
  analyzing,
  busyIds,
  listRef,
  searchActive,
  onSelect,
  onAction,
  onReply,
  onRetry,
  onClearSearch,
}: EmailListProps) {
  const virtualizer = useVirtualizer({
    count: emails.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  let content: ReactNode;

  if (noAccount) {
    content = (
      <div className="list-state">
        <span className="list-state-ring" aria-hidden="true" />
        <p className="list-state-title">Connect an account</p>
        <p className="list-state-hint">Sign in from the sidebar to load your inbox.</p>
      </div>
    );
  } else if (loading && emails.length === 0) {
    content = (
      <div className="skeleton-list">
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonRow key={i} delayMs={i * 30} />
        ))}
      </div>
    );
  } else if (error) {
    content = (
      <div className="list-state">
        <span className="list-state-ring is-error" aria-hidden="true" />
        <p className="list-state-title">Couldn't load emails</p>
        <p className="list-state-hint">The request failed. Check your connection and try again.</p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  } else if (emails.length === 0) {
    content = searchActive ? (
      <div className="list-state">
        <span className="list-state-ring" aria-hidden="true" />
        <p className="list-state-title">No results</p>
        <p className="list-state-hint">Nothing matches your search or filters.</p>
        <Button variant="secondary" onClick={onClearSearch}>
          Clear search
        </Button>
      </div>
    ) : (
      <div className="list-state">
        <span className="list-state-ring" aria-hidden="true" />
        <p className="list-state-title">Inbox zero</p>
        <p className="list-state-hint">No emails match your current filters.</p>
      </div>
    );
  } else {
    const virtualItems = virtualizer.getVirtualItems();
    content = (
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const email = emails[virtualRow.index];
          if (!email) return null;
          return (
            <div
              key={email.id}
              data-index={virtualRow.index}
              className="virtual-row"
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <EmailItem
                email={email}
                index={virtualRow.index}
                selected={email.id === selectedEmailId}
                analyzing={analyzing}
                busy={busyIds.has(email.id)}
                onSelect={onSelect}
                onAction={onAction}
                onReply={onReply}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <main
      id="email-list"
      ref={listRef}
      className="email-list"
      aria-label="Email list"
      aria-busy={loading}
    >
      {content}
    </main>
  );
});
