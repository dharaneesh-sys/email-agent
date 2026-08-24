import { useEffect, useRef, useState, type ComponentType } from 'react';
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

function avatarInitial(acc: AccountStatus): string {
  const src = acc.label ?? acc.email ?? acc.id;
  return src.trim().charAt(0).toUpperCase() || '?';
}

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

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const railRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (openMenuId === null) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (railRef.current && !railRef.current.contains(target)) setOpenMenuId(null);
      else {
        const isMenuBtn = target.closest('.rail-account-menu');
        const isDropdown = target.closest('.rail-account-dropdown');
        if (!isMenuBtn && !isDropdown) setOpenMenuId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId]);

  return (
    <nav className="nav-rail" aria-label="Mailbox" ref={railRef as never}>
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
              const disabled = !!busy;
              const initial = avatarInitial(acc);
              const isOpen = openMenuId === acc.id;
              return (
                <div
                  key={acc.id}
                  className={`rail-account rail-account--collapsed${active ? ' is-active' : ''}`}
                  {...(active ? { 'aria-current': 'true' as const } : {})}
                >
                  <div className="rail-avatar-wrap" aria-hidden="true">
                    <span className="rail-avatar">{initial}</span>
                    <span className={`rail-avatar-dot${authed ? ' is-connected' : ''}`} />
                  </div>
                  <span className="rail-account-text rail-account-text--collapsed" aria-hidden="true">
                    <span className="rail-account-label">{acc.label ?? acc.id}</span>
                  </span>
                  <button
                    type="button"
                    className="rail-account-menu"
                    aria-label={`Account menu for ${acc.label ?? acc.email ?? acc.id}`}
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    onClick={() => setOpenMenuId(isOpen ? null : acc.id)}
                    disabled={disabled}
                  >
                    ⋯
                  </button>
                  {isOpen && (
                    <div className="rail-account-dropdown" role="menu">
                      {!authed ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="rail-dropdown-item is-connect"
                          onClick={() => {
                            setOpenMenuId(null);
                            onConnect(acc.id);
                          }}
                          disabled={disabled}
                        >
                          {busyLabel(busy, acc.id, 'Connect')}
                        </button>
                      ) : active ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="rail-dropdown-item"
                          onClick={() => {
                            setOpenMenuId(null);
                            onDisconnect(acc.id);
                          }}
                          disabled={disabled}
                        >
                          {busyLabel(busy, acc.id, 'Disconnect')}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            className="rail-dropdown-item"
                            onClick={() => {
                              setOpenMenuId(null);
                              onSelectAccount(acc.id);
                            }}
                            disabled={disabled}
                          >
                            Switch
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="rail-dropdown-item rail-dropdown-item--danger"
                            onClick={() => {
                              setOpenMenuId(null);
                              onDisconnect(acc.id);
                            }}
                            disabled={disabled}
                          >
                            {busyLabel(busy, acc.id, 'Disconnect')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
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
