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
  const overflow = [...qa('*')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.right > window.innerWidth + 2 && getComputedStyle(el).position !== 'fixed' && getComputedStyle(el).position !== 'absolute';
  }).slice(0, 5).map(el => `${el.tagName}.${el.className?.toString?.().slice(0,30)}`);
  return {
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    viewport: [window.innerWidth, window.innerHeight],
    header: rect('header') ?? rect('.header'),
    emailList: rect('#emailList') ?? rect('.email-list'),
    detailPane: rect('#detailPane'),
    detailDisplay: q('#detailPane') ? getComputedStyle(q('#detailPane')!).display : null,
    summaryTitle: q('#summaryTitle')?.textContent?.trim() ?? q('[data-summary-title]')?.textContent?.trim() ?? '(none)',
    keyPoints: qa('#keyPointsList li').length,
    suggestedAction: q('#suggestedAction')?.textContent?.trim().slice(0, 60) ?? '(none)',
    modelBadge: q('#modelBadge')?.textContent?.trim() ?? '(none)',
    modalDisplay: q('.modal') ? getComputedStyle(q('.modal')!).display : '(no modal)',
    toneOptions: qa('#toneSelect option').length,
    replyBodyLen: q('#replyBody') ? (q('#replyBody') as HTMLTextAreaElement).value.length : 0,
    horizontalOverflow: overflow,
    emailRowCount: qa('.email-item').length,
    scoreChips: qa('.score-chip, .llm-badge').length,
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
