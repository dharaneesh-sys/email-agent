/**
 * Design token regression guard — DESIGN.md §2 discipline.
 *
 * Locks two invariants:
 *  1. app.css contains zero raw hex values (tokens.css is the single source).
 *  2. Accent-on-surface contrast meets WCAG AA (>= 4.5:1) for the pairs the
 *     UI actually renders text against.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STYLES_DIR = join(import.meta.dir, '..');
const APP_CSS = join(STYLES_DIR, 'app.css');
const TOKENS_CSS = join(STYLES_DIR, 'tokens.css');

interface HexViolation {
  line: number;
  hex: string;
  content: string;
}

/** Strip /* ... *\/ comment blocks so commented-out hex is not flagged. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function scanRawHexViolations(css: string): HexViolation[] {
  const clean = stripComments(css);
  const violations: HexViolation[] = [];
  const lines = clean.split('\n');
  const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    let match: RegExpExecArray | null;
    hexPattern.lastIndex = 0;
    while ((match = hexPattern.exec(line)) !== null) {
      violations.push({ line: i + 1, hex: match[0], content: line.trim() });
    }
  }
  return violations;
}

function parseToken(tokensCss: string, name: string): string {
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`);
  const m = tokensCss.match(re);
  if (!m?.[1]) throw new Error(`token --${name} not found in tokens.css`);
  return m[1].trim();
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(hexToRgb(fg));
  const l2 = luminance(hexToRgb(bg));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens', () => {
  test('app.css contains zero raw hex values (comments excluded)', () => {
    const css = readFileSync(APP_CSS, 'utf-8');
    const violations = scanRawHexViolations(css);
    if (violations.length > 0) {
      const detail = violations.map((v) => `  L${v.line}: ${v.hex} → ${v.content}`).join('\n');
      throw new Error(`Raw hex found in app.css — use tokens.css vars instead:\n${detail}`);
    }
    expect(violations.length).toBe(0);
  });

  test('tokens.css defines the core palette', () => {
    const css = readFileSync(TOKENS_CSS, 'utf-8');
    for (const token of ['surface-primary', 'surface-secondary', 'accent-primary', 'text-primary']) {
      expect(parseToken(css, token)).toMatch(/^#/);
    }
  });

  test('accent on surface-primary meets WCAG AA (>= 4.5:1)', () => {
    const css = readFileSync(TOKENS_CSS, 'utf-8');
    const ratio = contrastRatio(parseToken(css, 'accent-primary'), parseToken(css, 'surface-primary'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test('accent on surface-secondary meets WCAG AA (>= 4.5:1)', () => {
    const css = readFileSync(TOKENS_CSS, 'utf-8');
    const ratio = contrastRatio(parseToken(css, 'accent-primary'), parseToken(css, 'surface-secondary'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test('text-primary on surface-elevated meets WCAG AA (>= 4.5:1)', () => {
    const css = readFileSync(TOKENS_CSS, 'utf-8');
    const ratio = contrastRatio(parseToken(css, 'text-primary'), parseToken(css, 'surface-elevated'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
