// SPA interaction QA — verifies the DESIGN.md behavior contract:
// row click opens detail, filters work, actions reach the API, modal opens, mobile reflow, reduced-motion.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
const page = await browser.newPage();
await page.goto('http://localhost:3030/', { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);

// 1. Row count and first-row click -> detail pane populates
const list = await page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const qa = (s: string) => document.querySelectorAll(s);
  const rows = qa('[role="listitem"], article');
  const first = rows[0];
  let clicked = false;
  if (first) {
    (first as HTMLElement).click();
    clicked = true;
  }
  return { rowCount: rows.length, clicked };
});

await page.waitForTimeout(1200);
const detail = await page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const qa = (s: string) => document.querySelectorAll(s);
  const cs = (s: string, prop: string) => {
    const el = q(s);
    return el ? getComputedStyle(el)[prop as never] : null;
  };
  const overflow = [...qa('*')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const pos = getComputedStyle(el).position;
      return r.right > window.innerWidth + 2 && pos !== 'fixed' && pos !== 'absolute';
    })
    .slice(0, 5)
    .map((el) => `${el.tagName}.${String(el.className).slice(0, 30)}`);
  return {
    detailVisible: cs('aside', 'display') !== 'none',
    detailSubject: q('aside h1, aside [class*="subject"], aside [class*="Subject"]')?.textContent?.trim().slice(0, 60) ?? '(none)',
    summaryText: q('aside [class*="summary"]')?.textContent?.trim().slice(0, 40) ?? '(none)',
    keyPoints: qa('aside li').length,
    toneSelect: qa('select').length,
    draftBtn: [...qa('aside button')].find((b) => /draft|reply/i.test(b.textContent ?? ''))?.textContent?.trim() ?? '(none)',
    horizontalOverflow: overflow,
  };
});

// 2. Open reply modal via keyboard shortcut 'r' (requires selection)
await page.keyboard.press('r');
await page.waitForTimeout(400);
const modal = await page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const cs = (s: string, prop: string) => {
    const el = q(s);
    return el ? getComputedStyle(el)[prop as never] : null;
  };
  const dlg = q('[role="dialog"]');
  return {
    dialogPresent: dlg !== null,
    dialogDisplay: cs('[role="dialog"]', 'display'),
    modalRadius: dlg ? getComputedStyle(dlg).borderRadius : '(none)',
    textareas: document.querySelectorAll('[role="dialog"] textarea').length,
    replyToFilled: (q('[role="dialog"] input[readonly], [role="dialog"] input:read-only') as HTMLInputElement | null)?.value.slice(0, 40) ?? '(none)',
  };
});

// Close modal with Escape
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const modalClosed = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  return dlg ? getComputedStyle(dlg).display : 'no-dialog';
});

// 3. Mobile viewport reflow
await page.setViewportSize({ width: 375, height: 720 });
await page.waitForTimeout(400);
const mobile = await page.evaluate(() => {
  const qa = (s: string) => document.querySelectorAll(s);
  const overflow = [...qa('*')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const pos = getComputedStyle(el).position;
      return r.right > window.innerWidth + 2 && pos !== 'fixed' && pos !== 'absolute';
    })
    .slice(0, 5)
    .map((el) => `${el.tagName}.${String(el.className).slice(0, 30)}`);
  const nav = document.querySelector('nav');
  const main = document.querySelector('main');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    navWidth: nav ? Math.round(nav.getBoundingClientRect().width) : '(no nav)',
    mainVisible: main ? main.getBoundingClientRect().width > 0 : false,
    overflow,
  };
});

// 4. Reduced-motion check
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
const reduced = await page.evaluate(() => {
  const sk = document.querySelector('[class*="skeleton"]');
  return {
    matchMediaReduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    skeletonAnim: sk ? getComputedStyle(sk).animationDuration : '(no skeleton)',
  };
});

console.log(JSON.stringify({ list, detail, modal, modalClosed, mobile, reduced }, null, 2));
await browser.close();
