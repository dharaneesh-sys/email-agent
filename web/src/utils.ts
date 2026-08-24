// Formatting + sanitization helpers (behavior contract from dashboard.html)

/** Relative date: >7d locale, >1d "Nd ago", >1h "Nh ago", else "Nm ago" */
export function formatDate(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff)) return '';
  const hours = Math.floor(diff / 36e5);
  const days = Math.floor(hours / 24);
  if (days > 7) {
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  const minutes = Math.floor(diff / 6e4);
  return `${minutes}m ago`;
}

/** "Name <addr@x>" → "addr@x", else trimmed string */
export function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match?.[1] ?? from.trim();
}

/** Strip everything after last '/', then drop common size/instruct suffixes */
export function shortenModelName(model: string | null | undefined): string {
  if (!model) return 'AI';
  const name = String(model).split('/').pop() || String(model);
  return name.replace(/-(instruct|chat|latest|it|q4[_k0-9]+|gguf|fp16|bf16|8bit|4bit)$/i, '');
}

/** XSS-safe HTML → text extraction (DESIGN.md §8 debt). Prefers innerText
 * so paragraphs/line breaks survive for HTML-only emails. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.innerText ?? doc.body.textContent ?? '';
}

export function isHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

/** Server may send body as string or as { snippet } — normalize to text */
export function resolveBody(body: unknown): string | null {
  if (typeof body === 'string') return body;
  if (body !== null && typeof body === 'object') {
    const b = body as { snippet?: unknown };
    if (typeof b.snippet === 'string') return b.snippet;
  }
  return null;
}

/** Detail-pane resolution: full text, else sanitized html, else snippet */
export function resolveDetailBody(
  body: { snippet?: string; text?: string | null; html?: string | null } | undefined | null,
): string | null {
  if (body === null) return null;
  if (body?.text) return body.text;
  if (body?.html) return sanitizeHtml(body.html);
  return body?.snippet ?? null;
}

const BLOCKED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'button', 'noscript', 'svg', 'template',
]);

/**
 * Sanitize email HTML for rendering while preserving links and images.
 * Strips scripts/styles/forms/event handlers; keeps http(s)/mailto/tel hrefs
 * and http(s) or root-relative srcs; rewrites `cid:` image refs via cidMap.
 * Output is safe to inject with dangerouslySetInnerHTML.
 */
export function sanitizeEmailHtml(html: string, cidMap: Record<string, string>): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const walk = (node: Element): void => {
    for (const el of Array.from(node.children)) {
      if (BLOCKED_TAGS.has(el.tagName.toLowerCase())) {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'style') el.removeAttribute(attr.name);
      }
      const href = el.getAttribute('href');
      if (href !== null && !/^(https?:|mailto:|tel:)/i.test(href.trim())) el.removeAttribute('href');
      const src = el.getAttribute('src');
      if (src !== null) {
        const trimmed = src.trim();
        const lower = trimmed.toLowerCase();
        if (lower.startsWith('cid:')) {
          const key = lower.slice(4).replace(/[<>]/g, '');
          const mapped = cidMap[key];
          if (mapped) el.setAttribute('src', mapped);
          else el.remove();
        } else if (!/^(https?:|\/)/i.test(trimmed)) {
          el.removeAttribute('src');
        }
      }
      if (el.isConnected) walk(el);
    }
  };

  walk(doc.body);
  return doc.body.innerHTML;
}

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/gi;
const EMAIL_PATTERN = /([\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Escape HTML entities, then wrap bare URLs and email addresses in anchors.
 * Callers render inside a white-space: pre-wrap container to keep line breaks. */
export function linkifyText(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    .replace(URL_PATTERN, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`)
    .replace(EMAIL_PATTERN, (m) => `<a href="mailto:${m}">${m}</a>`);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Deterministic sender-hash → avatar palette index (0-5) */
export function avatarIndex(from: string): number {
  let h = 0;
  for (let i = 0; i < from.length; i += 1) {
    h = (h * 31 + from.charCodeAt(i)) >>> 0;
  }
  return h % 6;
}

export function initials(from: string): string {
  const name = from.split('<')[0] ?? from;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export interface SearchOperator {
  op: string;
  value: string;
}

const OPERATOR_RE = /(\w+):("[^"]*"|\S*)/g;

/**
 * Split a Gmail-style query into structured operators (from:, to:, subject:,
 * has:attachment, is:unread, …) and the remaining plain text.
 */
export function parseSearchOperators(query: string): { operators: SearchOperator[]; plain: string } {
  const operators: SearchOperator[] = [];
  const plain = query
    .replace(OPERATOR_RE, (_m, op: string, value: string) => {
      operators.push({ op, value: value.replace(/^"|"$/g, '') });
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { operators, plain };
}

/** Remove one operator from the raw query, preserving the rest verbatim. */
export function removeSearchOperator(query: string, target: SearchOperator): string {
  const needle = `${target.op}:"${target.value}"`;
  const bare = `${target.op}:${target.value}`;
  const next = query
    .replace(new RegExp(`${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'ig'), '')
    .replace(new RegExp(`(?<![\\w"])${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w"])`, 'ig'), '');
  return next.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Known-good NIM model candidates (mirrors src/nim.ts NIM_EMAIL_CANDIDATES).
 * Kept client-side so the Settings pane can offer the list without an
 * extra endpoint.
 */
export const NIM_MODEL_CANDIDATES: readonly string[] = [
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.2-3b-instruct',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-mini-4b-instruct',
];
