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

/** XSS-safe HTML → text extraction (DESIGN.md §8 debt) */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent ?? '';
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
