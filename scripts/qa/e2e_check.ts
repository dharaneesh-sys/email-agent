// E2E verification for email-agent LLM features.
// Usage: bun /tmp/opencode/e2e_check.ts [baseUrl]
// Requires playwright to be resolvable (run with NODE_PATH or in a dir with node_modules).
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3030';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
const page = await browser.newPage();

const errors: string[] = [];
page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

const results: Record<string, string | number | boolean> = {};

async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

// ─── API checks ─────────────────────────────────────────────────────────────
try {
  const cfg = await api('/api/config');
  results['config.status'] = cfg.status;
  results['config.model'] = cfg.json && (cfg.json as any).model;
  results['config.llmEnabled'] = cfg.json && (cfg.json as any).llmEnabled;

  const emails = await api('/api/emails?account=personal&maxResults=10');
  results['emails.status'] = emails.status;
  const emailArr = emails.json && (emails.json as any).emails || (emails.json as any) || [];
  results['emails.count'] = Array.isArray(emailArr) ? emailArr.length : 0;
  const firstId = Array.isArray(emailArr) && emailArr[0] ? (emailArr[0] as any).id : null;
  results['emails.firstHasLlmScore'] = Array.isArray(emailArr) && emailArr[0] ? (emailArr[0] as any).llmScore !== undefined : false;

  if (firstId) {
    const imp = await api('/api/importance/refresh', {
      method: 'POST',
      body: { ids: emailArr.slice(0, 5).map((e: any) => e.id), accountId: 'personal' },
    });
    results['importance.status'] = imp.status;
    results['importance.model'] = imp.json && (imp.json as any).model;
    results['importance.scoresCount'] = imp.json && Array.isArray((imp.json as any).scores) ? (imp.json as any).scores.length : 0;

    const sum = await api('/api/summary/' + firstId + '?account=personal');
    results['summary.status'] = sum.status;
    results['summary.text'] = sum.json && (sum.json as any).summary ? String((sum.json as any).summary).slice(0, 60) : '';

    const draft = await api('/api/reply/draft', {
      method: 'POST',
      body: { messageId: firstId, tone: 'professional', accountId: 'personal' },
    });
    results['draft.status'] = draft.status;
    results['draft.reply'] = draft.json && (draft.json as any).reply ? String((draft.json as any).reply).slice(0, 60) : '';

    const badTone = await api('/api/reply/draft', { method: 'POST', body: { messageId: firstId, tone: 'rude' } });
    results['draft.badTone.status'] = badTone.status;

    const missSum = await api('/api/summary/zzz-non-existent?account=personal');
    results['summary.missing.status'] = missSum.status;
  } else {
    results['SKIPPED'] = 'no emails available for detail/summary/draft checks';
  }
} catch (e) {
  results['apiException'] = String(e);
}

// ─── UI checks ──────────────────────────────────────────────────────────────
try {
  await page.goto(BASE + '/dashboard.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  results['ui.modelBadge'] = await page.evaluate(() => {
    const el = document.getElementById('modelBadge');
    return el ? (el.textContent || '').trim() : '(missing)';
  });
  results['ui.emailCount'] = await page.evaluate(() => document.querySelectorAll('.email-item').length);
  results['ui.darkTheme'] = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    return bg;
  });
  results['ui.hasSkeleton'] = await page.evaluate(() => document.querySelectorAll('.skeleton-row').length > 0);

  // Click first email → detail pane + summary
  const detail = await page.evaluate(async () => {
    const first = document.querySelector('.email-item');
    if (!first) return { clicked: false };
    (first as HTMLElement).click();
    await new Promise(r => setTimeout(r, 8000)); // wait for summary fetch
    const pane = document.getElementById('detailPane');
    const summary = document.getElementById('summaryText');
    return {
      clicked: true,
      paneDisplay: pane ? getComputedStyle(pane).display : 'missing',
      summaryText: summary ? (summary.textContent || '').slice(0, 60) : 'missing',
      hasKeyPoints: document.querySelectorAll('#keyPointsList li').length,
    };
  });
  results['ui.detail'] = JSON.stringify(detail);

  // Draft reply flow
  const draftFlow = await page.evaluate(async () => {
    const tone = document.getElementById('toneSelect') as HTMLSelectElement | null;
    const btn = document.getElementById('draftReplyBtn') as HTMLButtonElement | null;
    if (!tone || !btn) return { ok: false, reason: 'controls missing' };
    btn.click();
    await new Promise(r => setTimeout(r, 6000));
    const modal = document.querySelector('.modal') as HTMLElement | null;
    const body = document.getElementById('replyBody') as HTMLTextAreaElement | null;
    return {
      ok: true,
      modalDisplay: modal ? getComputedStyle(modal).display : 'missing',
      replyPrefilled: body ? (body.value || '').length > 0 : false,
    };
  });
  results['ui.draftFlow'] = JSON.stringify(draftFlow);

  await page.screenshot({ path: '/tmp/opencode/e2e_dashboard.png', fullPage: true });
  results['screenshot'] = '/tmp/opencode/e2e_dashboard.png';
} catch (e) {
  results['uiException'] = String(e);
}

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
