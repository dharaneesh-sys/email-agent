// A11y Phase 4.1 — listbox/option roving tabindex (preserves @tanstack/react-virtual)
// Manual axe verification (no axe-playwright dep — see MUST NOT DO):
//   1. bun run dev  (Vite on 5173)
//   2. npx @axe-core/cli http://localhost:5173 --tags wcag2a,wcag2aa  (0 critical)
//   OR Playwright: await AxeBuilder(page).analyze()  and assert violations.filter(critical).length===0
//   Keyboard: Tab to listbox → ArrowDown/Up roves focus+selection → Enter opens → Tab reaches Load more button
import { memo, useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { EmailAction, EmailListItem, SnoozeDuration } from '../types';
import { Button } from './Button';
import { EmailItem } from './EmailItem';
import { SkeletonRow } from './SkeletonRow';
import { MagnifyingGlass, ArrowsClockwise } from '@phosphor-icons/react';


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
  hasMore?: boolean;
  onLoadMore?(): void;
  onSelect(email: EmailListItem): void;
  onAction(email: EmailListItem, action: EmailAction): void;
  onReply(email: EmailListItem): void;
  onSnooze?: ((email: EmailListItem, duration: SnoozeDuration) => void) | undefined;
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: ((email: EmailListItem) => void) | undefined;
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
  hasMore,
  onLoadMore,
  onSelect,
  onAction,
  onReply,
  onSnooze,
  selectionMode,
  selectedIds,
  onToggleSelect,
  onRetry,
  onClearSearch,
}: EmailListProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Roving tabindex: track previous selection to drive focus moves on arrow-key nav
  const prevSelectedRef = useRef<string | null>(null);
  const virtualizer = useVirtualizer({
    count: emails.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  useEffect(() => {
    if (!hasMore || !onLoadMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !loading) onLoadMore();
      },
      { root: listRef.current, rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, onLoadMore, loading, listRef, emails.length]);

  // Move focus to the newly selected option when selection changes via
  // keyboard (ArrowUp/Down). The effect only fires when the active
  // element is already inside the listbox or the document body — so
  // mouse clicks that leave focus on a row-action button are untouched.
  // Verified not to break virtualizer.measureElement: focus target is
  // the inner [role="option"], not the virtual-row wrapper that owns
  // the measure ref.
  useEffect(() => {
    if (!selectedEmailId || prevSelectedRef.current === selectedEmailId) {
      prevSelectedRef.current = selectedEmailId;
      return;
    }
    prevSelectedRef.current = selectedEmailId;
    const active = document.activeElement as HTMLElement | null;
    const listEl = listRef.current;
    const inside = active ? listEl?.contains(active) : false;
    const onOption = active?.getAttribute('role') === 'option';
    const shouldFocus = inside || onOption || active === document.body || active?.id === 'email-list';
    if (!shouldFocus || !listEl) return;
    // Defer until virtualizer has rendered the selected row
    requestAnimationFrame(() => {
      const el = listEl.querySelector(`[data-email-id="${CSS.escape(selectedEmailId)}"]`) as HTMLElement | null;
      if (el && document.contains(el)) el.focus({ preventScroll: true });
    });
  }, [selectedEmailId, listRef]);

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
          <SkeletonRow key={i} delayMs={i * 30} variant={(i % 3) as 0 | 1 | 2} />
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
          <ArrowsClockwise size={16} aria-hidden="true" />
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
          <MagnifyingGlass size={16} aria-hidden="true" />
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
      <>
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
            const isSelected = email.id === selectedEmailId;
            // Roving tabindex: only the selected option is tabbable; when
            // nothing is selected, the first virtual row carries tabIndex 0
            // so the listbox remains reachable via Tab.
            const rovingTabIndex = selectedEmailId !== null
              ? isSelected ? 0 : -1
              : virtualRow.index === 0 ? 0 : -1;
            return (
              <div
                key={email.id}
                data-index={virtualRow.index}
                className="virtual-row"
                role="presentation"
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                <EmailItem
                  email={email}
                  index={virtualRow.index}
                  selected={isSelected}
                  analyzing={analyzing}
                  busy={busyIds.has(email.id)}
                  onSelect={onSelect}
                  onAction={onAction}
                  onReply={onReply}
                  onSnooze={onSnooze}
                  selectionMode={selectionMode ?? false}
                  checked={selectedIds?.has(email.id) ?? false}
                  onToggleSelect={onToggleSelect}
                  rovingTabIndex={rovingTabIndex}
                />
              </div>
            );
          })}
        </div>
        {hasMore && onLoadMore && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '16px 0' }}>
            {/* Sentinel is not in tab order; its button remains reachable */}
            <div ref={sentinelRef} aria-hidden="true" data-testid="load-more-sentinel" style={{ height: 1, width: '100%' }} />
            <Button variant="secondary" onClick={onLoadMore} disabled={loading} data-testid="load-more-button">
              {loading ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <main
      id="email-list"
      ref={listRef}
      className="email-list"
      role="listbox"
      aria-label="Email list"
      aria-busy={loading}
      aria-multiselectable={selectionMode ? true : undefined}
      tabIndex={-1}
    >
      {content}
    </main>
  );
});
