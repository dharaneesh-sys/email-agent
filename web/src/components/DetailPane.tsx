import { useEffect, useMemo, useState } from 'react';
import type { EmailAttachment, EmailListItem, Tone } from '../types';
import type { SummaryResponse } from '../types';
import { api, attachmentUrl } from '../api';
import { formatDate, formatFileSize, linkifyText, resolveDetailBody, sanitizeEmailHtml } from '../utils';
import { Button, IconButton } from './Button';
import { ScoreChip } from './ScoreChip';
import { BackIcon, BoltIcon, MailIcon, PaperclipIcon, SparklesIcon } from '../icons';

// Session cache per account+email so re-selecting an email skips the LLM-backed summary fetch.
const summaryCache = new Map<string, SummaryResponse>();
const SUMMARY_CACHE_LIMIT = 100;

interface EmailBody {
  snippet?: string;
  text?: string | null;
  html?: string | null;
  attachments?: EmailAttachment[];
}

interface DetailSnapshot {
  emailId: string;
  subject: string;
  from: string;
  date: string;
  body: EmailBody | null;
}

type SummaryState =
  | { emailId: string; status: 'loading' }
  | { emailId: string; status: 'ready'; summary: string; keyPoints: string[]; suggestedAction?: string }
  | { emailId: string; status: 'unavailable' };

interface DetailPaneProps {
  email: EmailListItem | null;
  accountId: string | null;
  drafting: boolean;
  onDraft(tone: Tone): void;
  onBack(): void;
}

export function DetailPane({ email, accountId, drafting, onDraft, onBack }: DetailPaneProps) {
  const [snapshot, setSnapshot] = useState<DetailSnapshot | null>(null);
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [tone, setTone] = useState<Tone>('professional');
  const [fullEmailOpen, setFullEmailOpen] = useState(false);

  useEffect(() => {
    const id = email?.id ?? null;
    setSnapshot(null);
    setSummary(null);
    setFullEmailOpen(false);
    if (!id) return;
    setSnapshot({
      emailId: id,
      subject: email?.subject ?? '(No subject)',
      from: email?.from ?? '',
      date: email?.date ?? '',
      body: email?.snippet ? { snippet: email.snippet } : null,
    });
    setSummary({ emailId: id, status: 'loading' });

    let cancelled = false;
    const account = accountId ?? '';

    void (async () => {
      try {
        const data = await api.emailDetail(id, account);
        if (cancelled) return;
        const fresh = data.email;
        if (fresh) {
          setSnapshot((prev) => {
            if (!prev || prev.emailId !== id) return prev;
            return {
              emailId: id,
              subject: fresh.subject ?? prev.subject,
              from: fresh.from ?? prev.from,
              date: fresh.date ?? prev.date,
              body: fresh.body ?? prev.body,
            };
          });
        }
      } catch {
        // keep optimistic fill
      }
      try {
        const cacheKey = `${account}:${id}`;
        let sum = summaryCache.get(cacheKey);
        if (!sum) {
          sum = await api.summary(id, account);
          if (cancelled) return;
          if (summaryCache.size >= SUMMARY_CACHE_LIMIT) summaryCache.clear();
          summaryCache.set(cacheKey, sum);
        }
        if (cancelled) return;
        setSummary({
          emailId: id,
          status: 'ready',
          summary: sum.summary || 'No summary available.',
          keyPoints: sum.keyPoints ?? [],
          ...(sum.suggestedAction ? { suggestedAction: sum.suggestedAction } : {}),
        });
      } catch {
        if (!cancelled) setSummary({ emailId: id, status: 'unavailable' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [email?.id, accountId]);

  const activeSnapshot = snapshot && email && snapshot.emailId === email.id ? snapshot : null;
  const activeSummary = summary && email && summary.emailId === email.id ? summary : null;
  const showSummaryLoading = !activeSummary || activeSummary.status === 'loading';
  const account = accountId ?? '';

  const previewText = useMemo(() => {
    const raw = activeSnapshot?.body ? resolveDetailBody(activeSnapshot.body) : null;
    if (!raw) return '';
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join('\n');
  }, [activeSnapshot]);

  const cidMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const att of activeSnapshot?.body?.attachments ?? []) {
      if (att.contentId) map[att.contentId] = attachmentUrl(email?.id ?? '', att, account);
    }
    return map;
  }, [activeSnapshot, email?.id, account]);

  const fullBodyHtml = useMemo(() => {
    const body = activeSnapshot?.body;
    if (!body) return '';
    if (body.html) return sanitizeEmailHtml(body.html, cidMap);
    const text = body.text ?? body.snippet ?? '';
    return text ? linkifyText(text) : '';
  }, [activeSnapshot, cidMap]);

  const attachments = activeSnapshot?.body?.attachments ?? [];
  const showFullEmail = fullEmailOpen && fullBodyHtml !== '';

  return (
    <aside className={`detail-pane${email ? ' is-open' : ''}`} aria-label="Email details">
      <div className="detail-backdrop" onClick={onBack} aria-hidden="true" />
      <div className="detail-sheet">
        {email ? (
          <div className="detail-scroll">
            <div className="detail-head">
              <IconButton
                size="sm"
                label="Back to list"
                className="detail-back-btn"
                onClick={onBack}
              >
                <BackIcon size={18} />
              </IconButton>
              <div className="detail-meta">
                <h1 className="detail-subject">{activeSnapshot?.subject ?? email.subject}</h1>
                <p className="detail-from">
                  {activeSnapshot?.from ? `From: ${activeSnapshot.from}` : ''}
                </p>
                <p className="detail-date">
                  {activeSnapshot?.date ? formatDate(new Date(activeSnapshot.date)) : ''}
                </p>
              </div>
            </div>

            <div className="importance-row">
              {email.isImportant && (
                <span className="tag tag-important">
                  <BoltIcon size={12} />
                  Important
                </span>
              )}
              {typeof email.llmScore === 'number' ? (
                <ScoreChip
                  score={email.llmScore}
                  reason={email.llmReason}
                  tooltipId="detail-score-tip"
                  prefix="AI "
                />
              ) : null}
              {!email.isImportant && typeof email.llmScore !== 'number' && (
                <span className="detail-muted">No AI assessment yet</span>
              )}
            </div>

            <section className="summary-panel" aria-live="polite">
              <h2>
                <span className="llm-badge">AI</span> Summary
              </h2>
              {showSummaryLoading && (
                <div className="summary-loading">
                  <span className="skeleton" />
                  <span className="skeleton" />
                  <span className="skeleton" />
                </div>
              )}
              {activeSummary?.status === 'ready' && (
                <>
                  <p className="summary-text">{activeSummary.summary}</p>
                  {activeSummary.keyPoints.length > 0 && (
                    <ul className="key-points">
                      {activeSummary.keyPoints.map((kp) => (
                        <li key={kp}>{kp}</li>
                      ))}
                    </ul>
                  )}
                  {activeSummary.suggestedAction && (
                    <div className="suggested-action">
                      <SparklesIcon size={14} />
                      <span>Suggested: {activeSummary.suggestedAction}</span>
                    </div>
                  )}
                </>
              )}
              {activeSummary?.status === 'unavailable' && (
                <p className="summary-unavailable">Summary unavailable</p>
              )}
            </section>

            <section className="full-email-section">
              <div className="full-email-header">
                <h2>Full Email</h2>
                <button
                  type="button"
                  className="full-email-toggle"
                  aria-expanded={fullEmailOpen}
                  onClick={() => setFullEmailOpen((open) => !open)}
                >
                  {fullEmailOpen ? 'Hide full email' : 'View full email'}
                </button>
              </div>
              {!fullEmailOpen ? (
                previewText ? (
                  <p className="full-email-preview">{previewText}</p>
                ) : (
                  <p className="full-email-preview is-empty">No preview available</p>
                )
              ) : (
                <div className="full-email-content" aria-label="Full email content">
                  {showFullEmail ? (
                    <div className="full-email-body" dangerouslySetInnerHTML={{ __html: fullBodyHtml }} />
                  ) : (
                    <p className="full-email-empty">No readable content for this email.</p>
                  )}
                  {attachments.length > 0 && (
                    <ul className="attachment-list">
                      {attachments.map((att) => (
                        <li key={att.attachmentId} className="attachment-item">
                          <span className="attachment-icon" aria-hidden="true">
                            <PaperclipIcon size={16} />
                          </span>
                          <span className="attachment-info">
                            <span className="attachment-name">{att.filename || 'attachment'}</span>
                            <span className="attachment-meta">
                              {formatFileSize(att.size)}
                              {att.inline ? <span className="attachment-inline-tag">inline</span> : null}
                            </span>
                          </span>
                          <a
                            className="attachment-download"
                            href={attachmentUrl(email.id, att, account)}
                            download={att.filename || true}
                          >
                            Download
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>

            <section className="smart-reply-block">
              <h2>Smart Reply</h2>
              <label className="field-label" htmlFor="tone-select">
                Tone
              </label>
              <select
                id="tone-select"
                className="tone-select"
                value={tone}
                onChange={(e) => setTone(e.target.value as Tone)}
              >
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="concise">Concise</option>
                <option value="formal">Formal</option>
              </select>
              <Button
                variant="primary"
                className="draft-btn"
                disabled={drafting}
                onClick={() => onDraft(tone)}
              >
                {drafting ? 'Drafting…' : 'Draft Reply'}
              </Button>
            </section>
          </div>
        ) : (
          <div className="detail-placeholder">
            <MailIcon size={44} className="list-state-icon" />
            <p>Select an email to view details</p>
          </div>
        )}
      </div>
    </aside>
  );
}
