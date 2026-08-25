import { useEffect, useMemo, useState } from 'react';
import type { EmailAttachment, EmailListItem, SnoozeDuration, Tone } from '../types';
import type { SummaryResponse, ThreadMessage } from '../types';
import { api, attachmentUrl } from '../api';
import { formatDate, formatFileSize, linkifyText, resolveDetailBody, sanitizeEmailHtml } from '../utils';
import { Button, IconButton } from './Button';
import { ScoreChip } from './ScoreChip';
import { ThreadStack } from './ThreadStack';
import { BackIcon, BoltIcon, ChevronIcon, ClockIcon, MailIcon, PaperclipIcon, SparklesIcon } from '../icons';

// Session cache per account+email so re-selecting an email skips the LLM-backed summary fetch.
const summaryCache = new Map<string, SummaryResponse>();
const SUMMARY_CACHE_LIMIT = 100;

interface EmailBody {
  snippet?: string;
  text?: string | null;
  html?: string | null;
  attachments?: EmailAttachment[]
}

/**
 * Consume the SSE summary stream. Resolves with the structured result from
 * the terminal `done` event, or null when the server signalled an error or
 * the stream ended without one. Deltas are forwarded as they arrive.
 */
async function consumeSummaryStream(
  id: string,
  account: string,
  onDelta: (text: string) => void,
): Promise<SummaryResponse | null> {
  const res = await fetch(
    `/api/summary/${encodeURIComponent(id)}/stream?account=${encodeURIComponent(account)}`,
  );
  if (!res.ok || !res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line === '') {
        eventName = 'message';
      } else if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        let payload: unknown = null;
        try {
          payload = JSON.parse(line.slice(5).trim());
        } catch {
          nl = buffer.indexOf('\n');
          continue;
        }
        if (eventName === 'delta' && typeof payload === 'object' && payload !== null) {
          const t = (payload as { t?: unknown }).t;
          if (typeof t === 'string' && t.length > 0) onDelta(t);
        } else if (eventName === 'done' && payload !== null && typeof payload === 'object') {
          const p = payload as SummaryResponse;
          if (typeof p.summary === 'string' && p.summary.length > 0) return p;
          return null;
        } else if (eventName === 'error') {
          return null;
        }
      }
      nl = buffer.indexOf('\n');
    }
  }
  return null;
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
  | { emailId: string; status: 'streaming'; text: string }
  | { emailId: string; status: 'ready'; summary: string; keyPoints: string[]; suggestedAction?: string }
  | { emailId: string; status: 'unavailable' };

interface DetailPaneProps {
  email: EmailListItem | null;
  accountId: string | null;
  drafting: boolean;
  onDraft(tone: Tone): void;
  onBack(): void;
  onReply(email: EmailListItem): void;
  onSnooze?: ((email: EmailListItem, duration: SnoozeDuration) => void) | undefined;
}

export function DetailPane({ email, accountId, drafting, onDraft, onBack, onReply, onSnooze }: DetailPaneProps) {
  const [snapshot, setSnapshot] = useState<DetailSnapshot | null>(null);
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [tone, setTone] = useState<Tone>('professional');
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [smartReplyOpen, setSmartReplyOpen] = useState(true);
  const [fullEmailOpen, setFullEmailOpen] = useState(false);
  const [threadCount, setThreadCount] = useState(0);
  const [preview, setPreview] = useState<EmailAttachment | null>(null);
  const [bodyModePref, setBodyModePref] = useState<'html' | 'text'>('html');
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  useEffect(() => {
    const id = email?.id ?? null;
    setSnapshot(null);
    setSummary(null);
    setFullEmailOpen(false);
    setThreadCount(0);
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
          // Try the SSE stream first — first token lands in ~hundreds of ms.
          // Any failure falls back to the buffered endpoint.
          const streamed = await consumeSummaryStream(id, account, (delta) => {
            if (cancelled) return;
            setSummary((prev) => {
              const baseText = prev && prev.emailId === id && prev.status === 'streaming' ? prev.text : '';
              return { emailId: id, status: 'streaming', text: baseText + delta };
            });
          });
          if (cancelled) return;
          if (!streamed) {
            sum = await api.summary(id, account);
          } else {
            sum = streamed;
          }
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

  const hasHtmlBody = Boolean(activeSnapshot?.body?.html);
  const hasTextBody = Boolean(activeSnapshot?.body?.text || activeSnapshot?.body?.snippet);

  // Effective mode clamps the preference to what this email actually provides.
  const bodyMode: 'html' | 'text' =
    bodyModePref === 'html' && !hasHtmlBody ? 'text'
    : bodyModePref === 'text' && !hasTextBody ? 'html'
    : bodyModePref;

  const renderedBody = useMemo(() => {
    const body = activeSnapshot?.body;
    if (!body) return '';
    if (bodyMode === 'html' && body.html) return sanitizeEmailHtml(body.html, cidMap);
    const text = body.text ?? body.snippet ?? '';
    return text ? linkifyText(text) : '';
  }, [activeSnapshot, cidMap, bodyMode]);

  const attachments = activeSnapshot?.body?.attachments ?? [];
  const showFullEmail = fullEmailOpen && renderedBody !== '';

  return (
    <aside
      className={`detail-pane${email ? ' is-open' : ''}`}
      role="region"
      aria-label="Email detail"
      aria-live="polite"
    >
      {/* Live announcement when a new email is opened — screen readers hear subject+sender */}
      <p role="status" aria-live="polite" aria-atomic="true" className="visually-hidden">
        {email ? `Opened ${activeSnapshot?.subject ?? email.subject} from ${activeSnapshot?.from ?? email.from}` : ''}
      </p>
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
              <div style={{ position: 'relative', marginLeft: 'auto' }}>
                <IconButton size="sm" label="Snooze" aria-haspopup="menu" aria-expanded={snoozeOpen} onClick={() => setSnoozeOpen((v) => !v)}>
                  <ClockIcon size={18} />
                </IconButton>
                {snoozeOpen && (
                  <div role="menu" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 10, background: 'var(--surface, #1e1e1e)', border: '1px solid var(--border, #333)', borderRadius: 8, padding: 4, minWidth: 140, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
                    {(['3h', 'tomorrow', 'nextWeek'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        role="menuitem"
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13 }}
                        onClick={() => {
                          setSnoozeOpen(false);
                          if (onSnooze && email) onSnooze(email, d);
                        }}
                      >
                        {d === '3h' ? '3 hours' : d === 'tomorrow' ? 'Tomorrow 9am' : 'Next week'}
                      </button>
                    ))}
                  </div>
                )}
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
              <div className="panel-header">
                <h2>
                  <span className="llm-badge">AI</span> Summary
                </h2>
                <button
                  type="button"
                  className="panel-toggle"
                  aria-expanded={summaryOpen}
                  aria-controls="summary-content"
                  onClick={() => setSummaryOpen((open) => !open)}
                >
                  <ChevronIcon size={16} className={summaryOpen ? 'is-open' : ''} />
                  <span className="sr-only">{summaryOpen ? 'Collapse summary' : 'Expand summary'}</span>
                </button>
              </div>
              {summaryOpen && (
                <div id="summary-content">
                  {showSummaryLoading && (
                    <div className="summary-loading">
                      <span className="skeleton" />
                      <span className="skeleton" />
                      <span className="skeleton" />
                    </div>
                  )}
                  {activeSummary?.status === 'streaming' && (
                    <p className="summary-text is-streaming">{activeSummary.text}</p>
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
                </div>
              )}
            </section>

            {email?.threadId && (
              <ThreadStack
                threadId={email.threadId}
                accountId={accountId}
                onCount={setThreadCount}
                onReply={(msg: ThreadMessage) => {
                  const mapped: EmailListItem = {
                    id: msg.id,
                    threadId: msg.threadId ?? email.threadId ?? '',
                    snippet: msg.snippet ?? '',
                    from: msg.from ?? 'Unknown',
                    subject: msg.subject ?? '(No Subject)',
                    date: msg.date ?? '',
                    importanceScore: 0,
                    isImportant: false,
                    labels: msg.labels ?? [],
                    isUnread: msg.isUnread ?? false,
                  };
                  onReply(mapped);
                }}
              />
            )}

            {threadCount <= 1 && (
              <section className="full-email-section">
              <div className="full-email-header panel-header">
                <h2>Full Email</h2>
                <div className="body-mode-toggle" role="group" aria-label="Body format">
                  {(['html', 'text'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`body-mode-btn${bodyMode === mode ? ' is-active' : ''}`}
                      aria-pressed={bodyMode === mode}
                      disabled={mode === 'html' ? !hasHtmlBody : !hasTextBody}
                      onClick={() => setBodyModePref(mode)}
                    >
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="panel-toggle"
                  aria-expanded={fullEmailOpen}
                  aria-controls="full-email-content"
                  onClick={() => setFullEmailOpen((open) => !open)}
                >
                  <ChevronIcon size={16} className={fullEmailOpen ? 'is-open' : ''} />
                  <span className="sr-only">{fullEmailOpen ? 'Hide full email' : 'View full email'}</span>
                </button>
              </div>
              {!fullEmailOpen ? (
                previewText ? (
                  <p className="full-email-preview">{previewText}</p>
                ) : (
                  <p className="full-email-preview is-empty">No preview available</p>
                )
              ) : (
                <div className="full-email-content" id="full-email-content" aria-label="Full email content">
                  {showFullEmail ? (
                    <div
                      className={`full-email-body${bodyMode === 'text' ? ' is-text' : ''}`}
                      dangerouslySetInnerHTML={{ __html: renderedBody }}
                    />
                  ) : (
                    <p className="full-email-empty">No readable content for this email.</p>
                  )}
                  {attachments.length > 0 && (
                    <ul className="attachment-list">
                      {attachments.map((att) => {
                        const isImage = att.mimeType.startsWith('image/');
                        const isPdf = att.mimeType === 'application/pdf';
                        const canPreview = isImage || isPdf;
                        return (
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
                            {canPreview && (
                              <button type="button" className="attachment-preview-btn" onClick={() => setPreview(att)}>
                                Preview
                              </button>
                            )}
                            <a
                              className="attachment-download"
                              href={attachmentUrl(email.id, att, account)}
                              download={att.filename || true}
                            >
                              Download
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
              </section>
            )}

            <section className="smart-reply-block">
              <div className="panel-header">
                <h2>Smart Reply</h2>
                <button
                  type="button"
                  className="panel-toggle"
                  aria-expanded={smartReplyOpen}
                  aria-controls="smart-reply-content"
                  onClick={() => setSmartReplyOpen((open) => !open)}
                >
                  <ChevronIcon size={16} className={smartReplyOpen ? 'is-open' : ''} />
                  <span className="sr-only">{smartReplyOpen ? 'Collapse smart reply' : 'Expand smart reply'}</span>
                </button>
              </div>
              {smartReplyOpen && (
                <div id="smart-reply-content">
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
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="detail-placeholder">
            <MailIcon size={44} className="list-state-icon" />
            <p>Select an email to view details</p>
          </div>
        )}
      </div>
      {preview && email && (
        <div
          className="attachment-lightbox-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Attachment preview"
          onClick={() => setPreview(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPreview(null);
          }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="attachment-lightbox" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="attachment-lightbox-close" onClick={() => setPreview(null)} aria-label="Close preview">
              ×
            </button>
            {preview.mimeType.startsWith('image/') ? (
              <img
                className="attachment-lightbox-img"
                src={attachmentUrl(email.id, preview, account)}
                alt={preview.filename || 'attachment'}
              />
            ) : (
              <iframe
                className="attachment-lightbox-pdf"
                src={attachmentUrl(email.id, preview, account)}
                title={preview.filename || 'PDF preview'}
                sandbox="allow-same-origin"
              />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
