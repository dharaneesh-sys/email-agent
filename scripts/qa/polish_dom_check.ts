import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
const page = await browser.newPage();
await page.goto('http://localhost:3030/dashboard.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
const report = await page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const qa = (s: string) => document.querySelectorAll(s);
  const rect = (s: string) => {
    const el = q(s); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const cs = (s: string, prop: string) => {
    const el = q(s); return el ? getComputedStyle(el)[prop as any] : null;
  };
  const overflow = [...qa('*')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.right > window.innerWidth + 2 && getComputedStyle(el).position !== 'fixed' && getComputedStyle(el).position !== 'absolute';
  }).slice(0, 5).map(el => `${el.tagName}.${el.className?.toString?.().slice(0,30)}`);
  const root = getComputedStyle(document.documentElement);
  return {
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    rootTokens: {
      bg: root.getPropertyValue('--bg').trim(),
      surface: root.getPropertyValue('--surface').trim(),
      primary: root.getPropertyValue('--primary').trim(),
      space: root.getPropertyValue('--space-5').trim(),
      textXl: root.getPropertyValue('--text-xl').trim(),
      radiusLg: root.getPropertyValue('--radius-lg').trim(),
      transition: root.getPropertyValue('--transition').trim(),
    },
    viewport: [window.innerWidth, window.innerHeight],
    h1Style: {
      fontSize: cs('h1', 'fontSize'),
      webkitTextFillColor: cs('h1', 'webkitTextFillColor'),
    },
    modelBadge: {
      text: q('#modelBadge')?.textContent?.trim() ?? '(none)',
      display: cs('#modelBadge', 'display'),
    },
    statChips: qa('.stat').length,
    statValues: [...qa('.stat-value')].map(el => el.textContent?.trim()),
    emailRowCount: qa('.email-item').length,
    scoreChips: qa('.score-chip, .llm-badge').length,
    headerRadius: cs('header', 'borderRadius'),
    listRadius: cs('.email-list', 'borderRadius'),
    focusVisibleDefined: [...document.styleSheets].some(sh => {
      try { return [...sh.cssRules].some(r => r.cssText?.includes('focus-visible')); } catch { return false; }
    }),
    reducedMotionDefined: [...document.styleSheets].some(sh => {
      try { return [...sh.cssRules].some(r => r.cssText?.includes('prefers-reduced-motion')); } catch { return false; }
    }),
    horizontalOverflow: overflow,
    detailDisplay: q('#detailPane') ? getComputedStyle(q('#detailPane')!).display : null,
    summaryTitle: q('#summaryTitle')?.textContent?.trim() ?? '(none)',
    keyPoints: qa('#keyPointsList li').length,
    modalDisplay: q('.modal') ? getComputedStyle(q('.modal')!).display : '(no modal)',
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
