import { useEffect, useState } from 'react';
import type { EmailListItem, Tone } from '../types';
import type { SummaryResponse } from '../types';
import { api } from '../api';
import { formatDate, isHtml, resolveBody, sanitizeHtml } from '../utils';
import { Button, IconButton } from './Button';
import { ScoreChip } from './ScoreChip';
import { BackIcon, BoltIcon, MailIcon, SparklesIcon } from '../icons';

// Session cache per account+email so re-selecting an email skips the LLM-backed summary fetch.
const summaryCache = new Map<string, SummaryResponse>();
const SUMMARY_CACHE_LIMIT = 100;

interface DetailSnapshot {
  emailId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
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

  useEffect(() => {
    const id = email?.id ?? null;
    setSnapshot(null);
    setSummary(null);
    if (!id) return;
    setSnapshot({
      emailId: id,
      subject: email?.subject ?? '(No subject)',
      from: email?.from ?? '',
      date: email?.date ?? '',
      body: email?.snippet ?? '',
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
          const body = resolveBody(fresh.body);
          setSnapshot((prev) => {
            if (!prev || prev.emailId !== id) return prev;
            return {
              emailId: id,
              subject: fresh.subject ?? prev.subject,
              from: fresh.from ?? prev.from,
              date: fresh.date ?? prev.date,
              body:
                body === null
                  ? prev.body
                  : isHtml(body)
                    ? sanitizeHtml(body)
                    : body,
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

            <div className="detail-body">{activeSnapshot?.body ?? email.snippet}</div>

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
