import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
const page = await browser.newPage();
await page.goto('http://localhost:3030/dashboard.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);

// 1. Click the first email item -> detail pane should open
await page.click('.email-item');
await page.waitForTimeout(800);
const detail = await page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const qa = (s: string) => document.querySelectorAll(s);
  const cs = (s: string, prop: string) => {
    const el = q(s); return el ? getComputedStyle(el)[prop as any] : null;
  };
  const overflow = [...qa('*')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.right > window.innerWidth + 2 && getComputedStyle(el).position !== 'fixed' && getComputedStyle(el).position !== 'absolute';
  }).slice(0, 5).map(el => `${el.tagName}.${el.className?.toString?.().slice(0,30)}`);
  return {
    detailDisplay: cs('#detailPane', 'display'),
    detailSubject: q('#detailSubject')?.textContent?.trim().slice(0, 60) ?? '(none)',
    summaryTitle: q('#summaryTitle')?.textContent?.trim() ?? '(none)',
    keyPoints: qa('#keyPointsList li').length,
    selectedRow: q('.email-item.selected') !== null,
    selectedBg: cs('.email-item.selected', 'backgroundColor'),
    suggestedAction: q('#suggestedAction')?.textContent?.trim().slice(0, 50) ?? '(none)',
    scoreChipsVisible: qa('.score-chip').length,
    toneOptions: qa('#toneSelect option').length,
    draftBtn: q('#draftReplyBtn')?.textContent?.trim() ?? '(none)',
    modalDisplayBefore: cs('.modal', 'display'),
    horizontalOverflow: overflow,
  };
});

// 2. Open the reply modal
await page.click('#draftReplyBtn');
await page.waitForTimeout(400);
const modal = await page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const cs = (s: string, prop: string) => {
    const el = q(s); return el ? getComputedStyle(el)[prop as any] : null;
  };
  const m = q('.modal');
  const mc = q('.modal-content');
  return {
    modalDisplay: cs('.modal', 'display'),
    modalBackdrop: m ? getComputedStyle(m).backdropFilter || getComputedStyle(m).getPropertyValue('-webkit-backdrop-filter') : '(none)',
    modalRadius: mc ? getComputedStyle(mc).borderRadius : '(none)',
    replyBodyLen: q('#replyBody') ? (q('#replyBody') as HTMLTextAreaElement).value.length : 0,
    replyTo: q('#replyTo') ? (q('#replyTo') as HTMLInputElement).value : '(none)',
  };
});

// 3. Small viewport check
await page.setViewportSize({ width: 375, height: 720 });
await page.waitForTimeout(300);
const mobile = await page.evaluate(() => {
  const qa = (s: string) => document.querySelectorAll(s);
  const overflow = [...qa('*')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.right > window.innerWidth + 2 && getComputedStyle(el).position !== 'fixed' && getComputedStyle(el).position !== 'absolute';
  }).slice(0, 5).map(el => `${el.tagName}.${el.className?.toString?.().slice(0,30)}`);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    layoutCols: getComputedStyle(document.querySelector('.layout-grid')!).gridTemplateColumns,
    overflow: overflow,
  };
});

// 4. Reduced-motion check
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const reduced = await page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const r = document.querySelector('.skeleton');
  return {
    matchMediaReduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    skeletonAnim: r ? getComputedStyle(r).animationDuration : '(no skeleton)',
  };
});

console.log(JSON.stringify({ detail, modal, mobile, reduced }, null, 2));
await browser.close();
