import type { ComponentType } from 'react';
import type { AccountStatus, Filter } from '../types';
import type { IconProps } from '../icons';
import { BoltIcon, InboxIcon, MailOpenIcon, SparklesIcon, StarIcon } from '../icons';

export interface NavRailCounts {
  all: number | null;
  unread: number | null;
  important: number | null;
  starred: number | null;
}

export interface NavRailBusy {
  accountId: string;
  action: 'connect' | 'disconnect';
}

export interface NavRailAuth {
  status: 'checking' | 'ready';
  accounts: AccountStatus[];
  activeAccountId: string | null;
  busy: NavRailBusy | null;
}

interface NavRailProps {
  currentFilter: Filter;
  counts: NavRailCounts;
  auth: NavRailAuth;
  onFilter(filter: Filter): void;
  onSelectAccount(id: string): void;
  onConnect(id: string): void;
  onDisconnect(id: string): void;
}

const FILTERS: ReadonlyArray<{ id: Filter; label: string; icon: ComponentType<IconProps> }> = [
  { id: 'all', label: 'All', icon: InboxIcon },
  { id: 'unread', label: 'Unread', icon: MailOpenIcon },
  { id: 'important', label: 'Important', icon: BoltIcon },
  { id: 'starred', label: 'Starred', icon: StarIcon },
];

export function NavRail({
  currentFilter,
  counts,
  auth,
  onFilter,
  onSelectAccount,
  onConnect,
  onDisconnect,
}: NavRailProps) {
  const busyLabel = (busy: NavRailBusy | null, id: string, fallback: string) =>
    busy?.accountId === id ? (busy.action === 'connect' ? 'Connecting…' : 'Disconnecting…') : fallback;

  return (
    <nav className="nav-rail" aria-label="Mailbox">
      <div className="rail-brand">
        <span className="rail-brand-mark" aria-hidden="true">
          <SparklesIcon size={18} />
        </span>
        <span className="rail-brand-name">Email Agent</span>
      </div>

      <div className="rail-filters" role="group" aria-label="Filters">
        {FILTERS.map((f) => {
          const active = f.id === currentFilter;
          const count = counts[f.id];
          const Icon = f.icon;
          return (
            <button
              key={f.id}
              type="button"
              className={`rail-item${active ? ' is-active' : ''}`}
              aria-label={f.label}
              onClick={() => onFilter(f.id)}
              {...(active ? { 'aria-current': 'page' as const } : {})}
            >
              <Icon size={18} />
              <span className="rail-label">{f.label}</span>
              {count !== null && <span className="rail-count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="rail-bottom">
        {auth.status === 'checking' ? (
          <div className="rail-account">
            <span className="rail-dot" aria-hidden="true" />
            <span className="rail-account-text">
              <span className="rail-account-muted">Checking accounts…</span>
            </span>
          </div>
        ) : (
          <div className="rail-accounts" role="group" aria-label="Email accounts">
            {auth.accounts.map((acc) => {
              const active = acc.id === auth.activeAccountId;
              const authed = acc.authenticated;
              const busy = auth.busy?.accountId === acc.id ? auth.busy : null;
              let actionLabel: string;
              let onAction: () => void;
              let disabled = false;
              if (!authed) {
                actionLabel = busyLabel(busy, acc.id, 'Connect');
                onAction = () => onConnect(acc.id);
              } else if (active) {
                actionLabel = busyLabel(busy, acc.id, 'Disconnect');
                onAction = () => onDisconnect(acc.id);
              } else {
                actionLabel = 'Switch';
                onAction = () => onSelectAccount(acc.id);
              }
              if (busy) disabled = true;
              return (
                <div
                  key={acc.id}
                  className={`rail-account${active ? ' is-active' : ''}`}
                  {...(active ? { 'aria-current': 'true' as const } : {})}
                >
                  <span
                    className={`rail-dot${authed ? ' is-connected' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="rail-account-text">
                    <span className="rail-account-label">{acc.label ?? acc.id}</span>
                    <strong className="rail-account-email">{acc.email ?? acc.id}</strong>
                  </span>
                  <button
                    type="button"
                    className={`rail-account-btn${authed ? '' : ' is-connect'}`}
                    onClick={onAction}
                    disabled={disabled}
                  >
                    {actionLabel}
                  </button>
                </div>
              );
            })}
            {auth.accounts.length === 0 && (
              <div className="rail-account">
                <span className="rail-dot" aria-hidden="true" />
                <span className="rail-account-text">
                  <span className="rail-account-muted">No accounts configured</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
