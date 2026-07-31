import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as RKeyboardEvent } from 'react';
import type { EmailListItem } from '../types';
import { extractEmailAddress } from '../utils';
import { Button, IconButton } from './Button';
import { XIcon } from '../icons';

interface ReplyModalProps {
  email: EmailListItem | null;
  prefill: string | null;
  onClose(): void;
  onSend(body: string): Promise<boolean>;
}

export function ReplyModal({ email, prefill, onClose, onSend }: ReplyModalProps) {
  const [body, setBody] = useState('');
  const [replyAll, setReplyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!email) return;
    setBody(prefill ?? '');
    setReplyAll(false);
    setError(null);
    setSending(false);
    const t = window.setTimeout(() => bodyRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [email?.id, prefill]);

  if (!email) return null;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) {
      setError('Please enter a reply');
      bodyRef.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    try {
      const ok = await onSend(text);
      if (!mountedRef.current) return;
      if (!ok) bodyRef.current?.focus();
    } catch {
      // onSend reports failures via toast; never leave the modal stuck
    } finally {
      if (mountedRef.current) setSending(false);
    }
  };

  const trapTab = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const el = dialogRef.current;
    if (!el) return;
    const focusables = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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

  const to = extractEmailAddress(email.from);
  const subject = email.subject.startsWith('Re: ') ? email.subject : `Re: ${email.subject}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="reply-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reply-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <header className="modal-header">
          <h2 id="reply-title" className="modal-title">
            Reply to Email
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <XIcon size={18} />
          </IconButton>
        </header>
        <form className="modal-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field-label">To</span>
            <input className="field-input" type="text" value={to} readOnly />
          </label>
          <label className="field">
            <span className="field-label">Subject</span>
            <input className="field-input" type="text" value={subject} readOnly />
          </label>
          <label className="field">
            <span className="field-label">Message</span>
            <textarea
              ref={bodyRef}
              className="field-input field-textarea"
              rows={6}
              value={body}
              placeholder="Write your reply…"
              onChange={(e) => {
                setBody(e.target.value);
                if (error) setError(null);
              }}
              {...(error ? { 'aria-invalid': true, 'aria-describedby': 'reply-error' } : {})}
            />
          </label>
          {error && (
            <p id="reply-error" className="form-error" role="alert">
              {error}
            </p>
          )}
          <label className="form-check">
            <input
              type="checkbox"
              className="form-check-input"
              checked={replyAll}
              onChange={(e) => setReplyAll(e.target.checked)}
            />
            <span>Reply to all</span>
          </label>
          <footer className="modal-footer">
            <Button variant="secondary" type="button" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={sending}>
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
