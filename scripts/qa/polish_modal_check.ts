import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
const page = await browser.newPage();
await page.goto('http://localhost:3030/dashboard.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

// Select an email and wait for the AI summary to complete (NIM can take ~10s)
await page.click('.email-item');
const summary = await page.waitForFunction(() => {
  const t = document.querySelector('#summaryTitle')?.textContent?.trim();
  return t && t.length > 0 && !t.includes('Summarizing') && !t.includes('...');
}, { timeout: 45000 }).then(() => page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const qa = (s: string) => document.querySelectorAll(s);
  return {
    summaryTitle: q('#summaryTitle')?.textContent?.trim().slice(0, 40) ?? '(none)',
    keyPoints: qa('#keyPointsList li').length,
    suggestedAction: q('#suggestedAction')?.textContent?.trim().slice(0, 50) ?? '',
    draftBtnDisabled: (q('#draftReplyBtn') as HTMLButtonElement)?.disabled ?? false,
  };
})).catch(() => ({ timeout: true }));

// Now the draft button should be enabled — open the modal
const draft = await page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const cs = (s: string, prop: string) => {
    const el = q(s); return el ? getComputedStyle(el)[prop as any] : null;
  };
  const btn = q('#draftReplyBtn') as HTMLButtonElement;
  const disabled = btn?.disabled ?? true;
  if (!disabled) btn.click();
  return { disabled, willClick: !disabled };
});

await page.waitForTimeout(600);
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
    replyTo: q('#replyTo') ? (q('#replyTo') as HTMLInputElement).value.slice(0, 40) : '(none)',
  };
});

console.log(JSON.stringify({ summary, draft, modal }, null, 2));
await browser.close();
