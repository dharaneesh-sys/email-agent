// ThreadStack — tonal elevation: collapsed surface-secondary 0.92, open surface-elevated + amber-border + shadow-tinted, spine 1px border-subtle, 8px overlap
import { useEffect, useMemo, useState } from 'react';
import type { ThreadMessage } from '../types';
import { api } from '../api';
import { formatDate, linkifyText, sanitizeEmailHtml } from '../utils';
import { Button } from './Button';
import { ChevronIcon } from '../icons';

interface ThreadStackProps {
  threadId: string;
  accountId: string | null;
  /** Reports the number of messages so parents can swap redundant sections out. */
  onCount?(count: number): void;
  onReply(message: ThreadMessage): void;
}

function MessageBody({ message }: { message: ThreadMessage }) {
  const html = useMemo(() => {
    const body = message.body;
    if (!body) return '';
    if (body.html) return sanitizeEmailHtml(body.html, {});
    const text = body.text ?? body.snippet ?? '';
    return text ? linkifyText(text) : '';
  }, [message]);

  if (!html) {
    return <p className="thread-msg-empty">No readable content.</p>;
  }
  return (
    <div
      className={`thread-msg-body${message.body?.html ? '' : ' is-text'}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function ThreadStack({ threadId, accountId, onCount, onReply }: ThreadStackProps) {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Oldest auto-collapsed; newest expanded.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setFailed(false);
    void (async () => {
      try {
        const data = await api.thread(threadId, accountId ?? '');
        if (cancelled) return;
        const list = data.messages ?? [];
        setMessages(list);
        onCount?.(list.length);
        setExpanded(new Set(list.length > 0 ? [list[list.length - 1]!.id] : []));
      } catch {
        if (!cancelled) {
          setFailed(true);
          onCount?.(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, accountId, onCount]);

  if (failed || messages === null || messages.length <= 1) return null;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="thread-stack" aria-label={`Conversation with ${messages.length} messages`}>
      <div className="panel-header">
        <h2>Conversation</h2>
        <span className="thread-count">{messages.length} messages</span>
      </div>
      <ol className="thread-list">
        {messages.map((msg) => {
          const isOpen = expanded.has(msg.id);
          return (
            <li key={msg.id} className={`thread-msg${isOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="thread-msg-header"
                aria-expanded={isOpen}
                onClick={() => toggle(msg.id)}
              >
                <ChevronIcon size={14} className={isOpen ? 'is-open' : ''} />
                <span className="thread-msg-from">{msg.from ?? 'Unknown'}</span>
                <span className="thread-msg-date">
                  {msg.date ? formatDate(new Date(msg.date)) : ''}
                </span>
              </button>
              {isOpen && (
                <div className="thread-msg-content">
                  <MessageBody message={msg} />
                  <Button
                    variant="secondary"
                    onClick={() => onReply(msg)}
                  >
                    Reply
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
