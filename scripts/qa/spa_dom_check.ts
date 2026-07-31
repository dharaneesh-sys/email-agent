// SPA structural QA — verifies the React app shell against the DESIGN.md contract:
// bounded shell, scroll ownership, semantic landmarks, tokens, fonts, no overflow.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
const page = await browser.newPage();
await page.goto('http://localhost:3030/', { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);

const report = await page.evaluate(() => {
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
  const root = getComputedStyle(document.documentElement);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    // Landmarks required by DESIGN.md §8
    hasNav: q('nav[aria-label="Mailbox"]') !== null,
    hasMain: q('main') !== null,
    hasAside: q('aside') !== null,
    skipLink: q('a.skip-link, a[href="#main"], a[href*="main-content"]') !== null,
    // Shell is a bounded grid: grid-template-rows auto minmax(0,1fr) on the shell
    shellRows: cs('body > div, #root > div, .app-shell', 'gridTemplateRows'),
    shellHeightBounded: cs('body > div, #root > div, .app-shell', 'maxBlockSize') || cs('body > div, #root > div, .app-shell', 'height'),
    // Scroll owners: list pane + detail pane should have overflow-y auto
    listScrollOwner: cs('main', 'overflowY') || cs('[data-scroll-owner="list"]', 'overflowY'),
    detailScrollOwner: cs('aside', 'overflowY') || cs('[data-scroll-owner="detail"]', 'overflowY'),
    listMinHeight: cs('main', 'minHeight') || cs('[data-scroll-owner="list"]', 'minHeight'),
    // Tokens from DESIGN.md §2
    tokens: {
      bg: root.getPropertyValue('--surface-primary').trim(),
      surface: root.getPropertyValue('--surface-secondary').trim(),
      accent: root.getPropertyValue('--accent-primary').trim(),
      text: root.getPropertyValue('--text-primary').trim(),
    },
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    // Fonts: Geist loaded (font-display swap)
    bodyFont: getComputedStyle(document.body).fontFamily,
    geistLoaded: document.fonts?.check('16px "Geist Sans"') ?? false,
    // Nav rail width (expanded 220px per §4/§5)
    navRailWidth: cs('nav', 'width'),
    // Stats, search, auth presence
    searchField: q('input[type="search"], input[aria-label*="earch"], input[placeholder*="earch"]') !== null,
    authStatus: document.querySelectorAll('.rail-account').length > 0,
    authActive: q('.rail-account.is-active') !== null,
    emailRowCount: qa('[role="listitem"], article, .email-item').length,
    scoreChips: qa('.score-chip, .llm-badge').length,
    focusVisibleDefined: [...document.styleSheets].some((sh) => {
      try {
        return [...sh.cssRules].some((r) => r.cssText?.includes('focus-visible'));
      } catch {
        return false;
      }
    }),
    reducedMotionDefined: [...document.styleSheets].some((sh) => {
      try {
        return [...sh.cssRules].some((r) => r.cssText?.includes('prefers-reduced-motion'));
      } catch {
        return false;
      }
    }),
    horizontalOverflow: overflow,
  };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
