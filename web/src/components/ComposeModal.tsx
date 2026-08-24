import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as RKeyboardEvent } from 'react';
import { Button, IconButton } from './Button';
import { XIcon } from '../icons';

const DRAFT_KEY = 'email-agent:compose-draft';
const AUTOSAVE_MS = 2000;

interface DraftShape {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

function loadDraft(): DraftShape {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { to: '', cc: '', bcc: '', subject: '', body: '' };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('bad draft');
    const d = parsed as Record<string, unknown>;
    return {
      to: typeof d['to'] === 'string' ? d['to'] : '',
      cc: typeof d['cc'] === 'string' ? d['cc'] : '',
      bcc: typeof d['bcc'] === 'string' ? d['bcc'] : '',
      subject: typeof d['subject'] === 'string' ? d['subject'] : '',
      body: typeof d['body'] === 'string' ? d['body'] : '',
    };
  } catch {
    return { to: '', cc: '', bcc: '', subject: '', body: '' };
  }
}

interface ComposeModalProps {
  open: boolean;
  accountId: string | null;
  onClose(): void;
  /** Return true when the send succeeded — clears the autosaved draft. */
  onSend(message: { to: string; cc?: string; bcc?: string; subject: string; body: string }): Promise<boolean>;
}

export function ComposeModal({ open, accountId, onClose, onSend }: ComposeModalProps) {
  const [draft, setDraft] = useState<DraftShape>(() => loadDraft());
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Autosave every change, debounced 2s.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setSavedAt(Date.now());
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [draft, open]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSending(false);
    const t = window.setTimeout(() => toRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const update = (patch: Partial<DraftShape>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!draft.to.trim() || !draft.subject.trim() || !draft.body.trim()) {
      setError('To, subject and message are required.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const ok = await onSend({
        to: draft.to.trim(),
        ...(draft.cc.trim() ? { cc: draft.cc.trim() } : {}),
        ...(draft.bcc.trim() ? { bcc: draft.bcc.trim() } : {}),
        subject: draft.subject.trim(),
        body: draft.body,
      });
      if (!mountedRef.current) return;
      if (ok) {
        localStorage.removeItem(DRAFT_KEY);
      } else {
        toRef.current?.focus();
      }
    } catch {
      // onSend reports failures via toast
    } finally {
      if (mountedRef.current) setSending(false);
    }
  };

  const trapTab = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const el = dialogRef.current;
    if (!el) return;
    const focusables = el.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
        className="reply-modal compose-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <header className="modal-header">
          <h2 id="compose-title" className="modal-title">
            New Message
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <XIcon size={18} />
          </IconButton>
        </header>
        <form className="modal-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field-label">To</span>
            <input
              ref={toRef}
              className="field-input"
              type="text"
              value={draft.to}
              placeholder="recipient@example.com"
              onChange={(e) => update({ to: e.target.value })}
            />
          </label>
          <div className="compose-row">
            <label className="field">
              <span className="field-label">Cc</span>
              <input
                className="field-input"
                type="text"
                value={draft.cc}
                onChange={(e) => update({ cc: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">Bcc</span>
              <input
                className="field-input"
                type="text"
                value={draft.bcc}
                onChange={(e) => update({ bcc: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Subject</span>
            <input
              className="field-input"
              type="text"
              value={draft.subject}
              onChange={(e) => update({ subject: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Message</span>
            <textarea
              className="field-input field-textarea"
              rows={8}
              value={draft.body}
              placeholder="Write your message…"
              onChange={(e) => update({ body: e.target.value })}
              {...(error ? { 'aria-invalid': true, 'aria-describedby': 'compose-error' } : {})}
            />
          </label>
          {error && (
            <p id="compose-error" className="form-error" role="alert">
              {error}
            </p>
          )}
          <footer className="modal-footer">
            <span className="compose-saved" aria-live="polite">
              {savedAt ? 'Draft saved' : ''}
            </span>
            <Button variant="secondary" type="button" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={sending} disabled={!accountId}>
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
