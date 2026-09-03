/* SettingsPane — amber lock: theme pills is-active var(--accent-muted)/var(--accent-primary), health is-ok tint-accent, focus trap + Esc */
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button, IconButton } from './Button';
import { XIcon } from '../icons';

export type ThemeSetting = 'system' | 'light' | 'dark';

const THEME_KEY = 'email-agent:theme';

function applyTheme(setting: ThemeSetting): void {
  const systemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const effective = setting === 'system' ? (systemLight ? 'light' : 'dark') : setting;
  if (effective === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}

export function loadThemeSetting(): ThemeSetting {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // storage unavailable
  }
  return 'system';
}

const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['⌘K / Ctrl+K', 'Command palette'],
  ['/', 'Focus search'],
  ['c', 'Compose new email'],
  ['r', 'Reply to selected'],
  ['j / ↓ · k / ↑', 'Next / previous email'],
  ['Esc', 'Close palette / modal / clear search'],
];

interface SettingsPaneProps {
  open: boolean;
  onClose(): void;
  currentModel: string | null;
  onModelChanged(model: string): void;
}

export function SettingsPane({ open, onClose, currentModel, onModelChanged }: SettingsPaneProps) {
  const [theme, setTheme] = useState<ThemeSetting>(() => loadThemeSetting());
  const [models, setModels] = useState<readonly string[]>([]);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [authHealth, setAuthHealth] = useState<import('../types').AccountStatus[] | null>(null);
  const [healthBusy, setHealthBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setTheme(loadThemeSetting());
    setModelError(null);
    let cancelled = false;
    void api.config().catch(() => null);
    import('../utils').then(({ NIM_MODEL_CANDIDATES }) => {
      if (!cancelled) setModels(NIM_MODEL_CANDIDATES);
    });
    void api
      .diagnostics()
      .then((d) => { if (!cancelled) setAuthHealth(d.accounts); })
      .catch(() => { if (!cancelled) setAuthHealth(null); });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    return () => {
      // No cleanup needed — theme persists.
    };
  }, []);

  if (!open) return null;

  const changeTheme = (setting: ThemeSetting) => {
    setTheme(setting);
    try {
      localStorage.setItem(THEME_KEY, setting);
    } catch {
      // storage unavailable — still apply for this session
    }
    applyTheme(setting);
  };

  const changeModel = async (model: string) => {
    setModelBusy(true);
    setModelError(null);
    try {
      const res = await api.updateConfig({ model });
      if (res.success && res.model) onModelChanged(res.model);
      else setModelError('Failed to switch model');
    } catch {
      setModelError('Failed to switch model');
    } finally {
      setModelBusy(false);
    }
  };

  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const el = e.currentTarget;
    const focusables = el.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0] ?? null;
    const last = focusables[focusables.length - 1] ?? null;
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="settings-pane"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          trapTab(e);
        }}
      >
        <header className="modal-header">
          <h2 id="settings-title" className="modal-title">
            Settings
          </h2>
          <IconButton label="Close settings" onClick={onClose}>
            <XIcon size={18} />
          </IconButton>
        </header>

        <div className="settings-body">
          <section className="settings-section" aria-label="Appearance">
            <h3>Theme</h3>
            <div className="theme-toggle" role="radiogroup" aria-label="Theme">
              {(['system', 'light', 'dark'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={theme === option}
                  className={`theme-option${theme === option ? ' is-active' : ''}`}
                  onClick={() => changeTheme(option)}
                >
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section" aria-label="AI model">
            <h3>AI model</h3>
            <select
              className="tone-select"
              value={currentModel ?? ''}
              disabled={modelBusy}
              onChange={(e) => void changeModel(e.target.value)}
              aria-label="Active AI model"
            >
              {!currentModel && <option value="">Loading…</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {modelError && (
              <p className="form-error" role="alert">
                {modelError}
              </p>
            )}
          </section>

          <section className="settings-section" aria-label="Connected accounts health">
            <h3>Accounts health</h3>
            {!authHealth ? (
              <p className="detail-muted">Loading…</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {authHealth.map((acc) => {
                  const badge = !acc.authenticated
                    ? 'Not connected'
                    : acc.refreshTokenPresent === false
                      ? 'No refresh — reconnect'
                      : typeof acc.daysRemaining === 'number' && acc.daysRemaining <= 3
                        ? `Expires in ${acc.daysRemaining} day${acc.daysRemaining === 1 ? '' : 's'}`
                        : acc.hasValidToken
                          ? 'Healthy'
                          : 'Needs refresh';
                  const isWarn = badge.includes('Expires') || badge.includes('Needs');
                  const isDanger = badge.includes('No refresh') || badge.includes('Not connected');
                  return (
                    <li key={acc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-secondary)' }}>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--text-body-sm)' }}>{acc.id}</span>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-caption)', marginLeft: 8 }}>{acc.email ?? ''}</span>
                        <span className={`health-badge is-${isDanger ? 'danger' : isWarn ? 'warn' : 'ok'}`} style={{ marginLeft: 8, fontSize: 'var(--text-caption)', padding: '2px 6px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-default)' }}>{badge}</span>
                      </span>
                      <Button
                        variant="secondary"
                        disabled={healthBusy === acc.id || acc.refreshTokenPresent === false}
                        onClick={async () => {
                          setHealthBusy(acc.id);
                          try { await api.refreshAuth(acc.id); const d = await api.diagnostics(); setAuthHealth(d.accounts); } catch {} finally { setHealthBusy(null); }
                        }}
                      >
                        {healthBusy === acc.id ? 'Refreshing…' : 'Refresh now'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="settings-section" aria-label="Keyboard shortcuts">
            <h3>Keyboard shortcuts</h3>
            <dl className="shortcut-list">
              {SHORTCUTS.map(([keys, description]) => (
                <div key={keys} className="shortcut-row">
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{description}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <footer className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            Done
          </Button>
        </footer>
      </div>
    </div>
  );
}
