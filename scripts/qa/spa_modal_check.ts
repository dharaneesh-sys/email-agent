// SPA modal/draft QA — waits for the AI summary (NIM can take ~10s), then
// exercises the smart-reply draft flow end-to-end against the DESIGN.md contract.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
const page = await browser.newPage();
await page.goto('http://localhost:3030/', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

// Select the first email row
await page.evaluate(() => {
  const first = document.querySelector('[role="listitem"], article');
  if (first) (first as HTMLElement).click();
});

// Wait for summary to appear (polite: don't fail the whole script if NIM is slow)
const summary = await page
  .waitForFunction(
    () => {
      const t = document.querySelector('aside .summary-text')?.textContent?.trim();
      return !!t && t.length > 0 && !/…|\.\.\.|Summarizing/i.test(t);
    },
    { timeout: 45000 },
  )
  .then(() =>
    page.evaluate(() => {
      const q = (s: string) => document.querySelector(s);
      const qa = (s: string) => document.querySelectorAll(s);
      return {
        summaryText: q('aside .summary-text')?.textContent?.trim().slice(0, 60) ?? '(none)',
        keyPoints: qa('aside li').length,
        suggestedAction: q('[class*="suggested"]')?.textContent?.trim().slice(0, 50) ?? '(none)',
        draftBtnDisabled: [...qa('aside button')].find((b) => /draft/i.test(b.textContent ?? ''))?.hasAttribute('disabled') ?? null,
      };
    }),
  )
  .catch(() => ({ timeout: true }));

// Open the reply modal via the Draft button (or 'r' shortcut as fallback)
await page.evaluate(() => {
  const draft = [...document.querySelectorAll('aside button')].find((b) => /draft/i.test(b.textContent ?? ''));
  if (draft && !draft.hasAttribute('disabled')) (draft as HTMLButtonElement).click();
});
await page.waitForTimeout(1500);

const modal = await page.evaluate(() => {
  const q = (s: string) => document.querySelector(s);
  const cs = (s: string, prop: string) => {
    const el = q(s);
    return el ? getComputedStyle(el)[prop as never] : null;
  };
  const dlg = q('[role="dialog"]');
  const body = q('[role="dialog"] textarea') as HTMLTextAreaElement | null;
  return {
    dialogDisplay: dlg ? cs('[role="dialog"]', 'display') : '(no dialog)',
    modalRadius: dlg ? getComputedStyle(dlg).borderRadius : '(none)',
    replyBodyLen: body?.value.length ?? 0,
    replyTo: (q('[role="dialog"] input[readonly], [role="dialog"] input:read-only') as HTMLInputElement | null)?.value.slice(0, 40) ?? '(none)',
    toneOptions: document.querySelectorAll('[role="dialog"] select option, aside select option').length,
  };
});

console.log(JSON.stringify({ summary, modal }, null, 2));
await browser.close();
