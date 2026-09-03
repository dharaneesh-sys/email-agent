// SPA functional audit — "Do NOT assume anything works."
// Exercises every interactive surface against the live server + real Gmail data:
//   filters, search, selection, action buttons, analyze, refresh, multi-account,
//   error paths, console hygiene. Emits a structured PASS/FAIL report.
//
// Usage: bun run scripts/qa/spa_functional_audit.ts [chromium|firefox]
import { chromium, firefox } from 'playwright';

const browserName = process.argv[2] ?? 'chromium';
const execPaths: Record<string, string> = {
  chromium: '/usr/bin/chromium',
};
const browser = await (browserName === 'firefox' ? firefox : chromium).launch({
  headless: true,
  ...(execPaths[browserName] ? { executablePath: execPaths[browserName] } : {}),
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const results: { check: string; pass: boolean; detail: string }[] = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const reactWarnings: string[] = [];

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
  if (msg.text().includes('Warning:') && /React|component|prop/i.test(msg.text())) reactWarnings.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

const actionRequests: { url: string; body: unknown; status: number | null }[] = [];
const summaryRequests: string[] = [];
page.on('request', (req) => {
  if (req.url().includes('/action')) {
    actionRequests.push({ url: req.url(), body: req.postDataJSON(), status: null });
  }
  if (req.url().includes('/api/summary/')) summaryRequests.push(req.url());
});
page.on('response', (res) => {
  const hit = actionRequests.find((a) => a.url === res.url() && a.status === null);
  if (hit) hit.status = res.status();
});

const q = (s: string) => page.locator(s);
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ check: name, pass, detail });
};

const waitForEmails = async () => {
  await q('article.email-item').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
};
const rowClass = async (i: number) => (await q('article.email-item').nth(i).getAttribute('class').catch(() => null)) ?? '';
const starLabel = async (i: number) =>
  (await q('article.email-item').nth(i).locator('button[aria-label="Star"], button[aria-label="Unstar"]').first()
    .getAttribute('aria-label').catch(() => null)) ?? '';

try {
  await page.goto('http://localhost:3030/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await waitForEmails();

  const totalRows = await q('article.email-item').count();
  check('app-load', totalRows > 0, `rendered ${totalRows} email rows`);
  check('no-console-errors-on-load', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
  check('no-page-errors-on-load', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'clean');

  // --- Sidebar filters -------------------------------------------------------
  const filterTest = async (label: string, predicate: (cls: string, star: string) => boolean) => {
    await q(`nav button[aria-label="${label}"]`).click();
    await page.waitForTimeout(400);
    const rows = q('article.email-item');
    const n = await rows.count();
    let bad = 0;
    const sample: string[] = [];
    for (let i = 0; i < Math.min(n, 20); i++) {
      const cls = await rowClass(i);
      const star = await starLabel(i);
      if (!predicate(cls, star)) { bad++; sample.push(cls); }
    }
    check(`filter:${label}`, bad === 0, `${n} rows, ${bad} mismatched ${sample.slice(0, 3).join(' | ')}`);
    return n;
  };
  const allCount = await filterTest('All', () => true);
  const unreadCount = await filterTest('Unread', (cls) => cls.includes('unread'));
  const importantCount = await filterTest('Important', (cls) => cls.includes('important'));
  const starredCount = await filterTest('Starred', (_cls, star) => star === 'Unstar');
  check('filter-counts-sane', unreadCount <= allCount && importantCount <= allCount && starredCount <= allCount,
    `all=${allCount} unread=${unreadCount} important=${importantCount} starred=${starredCount}`);

  // --- Search ----------------------------------------------------------------
  await q('nav button[aria-label="All"]').click();
  const searchInput = q('input[type="search"], input[placeholder*="earch" i]').first();
  const hasSearch = (await searchInput.count()) > 0;
  check('search-field-present', hasSearch, hasSearch ? 'input found' : 'NO SEARCH INPUT');
  if (hasSearch) {
    await searchInput.fill('security');
    await page.waitForTimeout(400);
    const n = await q('article.email-item').count();
    check('search:normal-term', n > 0 && n < allCount, `${n} rows (was ${allCount})`);

    await searchInput.fill('!@#$%^&*()_+{}[]|\\:;",.<>?/');
    await page.waitForTimeout(400);
    const n2 = await q('article.email-item').count();
    check('search:special-chars', n2 === 0, `special chars -> ${n2} rows (no crash)`);

    await searchInput.fill('');
    await page.waitForTimeout(400);
    const n3 = await q('article.email-item').count();
    check('search:cleared', n3 === allCount, `cleared -> ${n3} rows (was ${allCount})`);

    for (const ch of 'project') { await searchInput.type(ch, { delay: 0 }); await page.waitForTimeout(15); }
    await page.waitForTimeout(400);
    const n4 = await q('article.email-item').count();
    check('search:rapid-typing', n4 >= 0, `rapid-typed "project" -> ${n4} rows, no crash`);
    check('search:rapid-no-error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
    await searchInput.fill('');
    await page.waitForTimeout(300);
  }

  // --- Selection & keyboard --------------------------------------------------
  await q('article.email-item').nth(0).click();
  await page.waitForTimeout(800);
  const detailVisible = await q('aside').isVisible().catch(() => false);
  const detailSubject = (await q('aside h1, aside [class*="subject" i]').first().textContent().catch(() => '')) ?? '';
  check('select:row-opens-detail', detailVisible, detailSubject.slice(0, 60) || 'detail visible');

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(500);
  const subj2 = (await q('aside h1, aside [class*="subject" i]').first().textContent().catch(() => '')) ?? '';
  check('select:keyboard-navigates', subj2 !== detailSubject, `detail switched: "${detailSubject.slice(0, 30)}" -> "${subj2.slice(0, 30)}"`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('select:escape-no-crash', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'clean');

  // --- Action buttons (contract check: client payload vs server enum) ----------
  await q('article.email-item').nth(0).click();
  await page.waitForTimeout(600);

  const starBtn = q('article.email-item').nth(0).locator('button[aria-label="Star"], button[aria-label="Unstar"]').first();
  if ((await starBtn.count()) > 0) {
    const starLabelBefore = (await starBtn.getAttribute('aria-label').catch(() => '')) ?? '';
    const expectedStarAction = starLabelBefore === 'Unstar' ? 'unstar' : 'star';
    await starBtn.click();
    await page.waitForTimeout(900);
    const starReq = actionRequests.find((a) => (a.body as { action?: string })?.action === expectedStarAction);
    check('action:star-sends-correct-action', !!starReq, starReq ? `payload ${JSON.stringify(starReq.body)} -> HTTP ${starReq.status}` : `no request captured for action "${expectedStarAction}"`);
    if (starReq) check('action:star-server-accepts', starReq.status === 200, `server returned ${starReq.status} (expect 200)`);
  } else {
    check('action:star-button-present', false, 'NO STAR BUTTON FOUND');
  }

  const readBtn = q('article.email-item').nth(0).locator('button[aria-label*="read" i]').first();
  if ((await readBtn.count()) > 0) {
    const readLabel = (await readBtn.getAttribute('aria-label').catch(() => '')) ?? '';
    const expectedReadAction = readLabel.includes('Mark as unread') ? 'unread' : 'read';
    await readBtn.click();
    await page.waitForTimeout(900);
    const readReq = actionRequests.find((a) => (a.body as { action?: string })?.action === expectedReadAction);
    check('action:read-sends-correct-action', !!readReq, readReq ? `payload ${JSON.stringify(readReq.body)} -> HTTP ${readReq.status}` : `no request captured for action "${expectedReadAction}" (btn "${readLabel}")`);
    if (readReq) check('action:read-server-accepts', readReq.status === 200, `server returned ${readReq.status} (expect 200)`);
  } else {
    check('action:read-button-present', false, 'NO READ TOGGLE BUTTON FOUND');
  }

  const importantBtn = q('article.email-item').nth(0).locator('button[aria-label*="important" i]').first();
  if ((await importantBtn.count()) > 0) {
    await importantBtn.click();
    await page.waitForTimeout(900);
    const impReq = actionRequests.find((a) => (a.body as { action?: string })?.action === 'important' || (a.body as { action?: string })?.action === 'unimportant');
    check('action:important-sends-correct-action', !!impReq, impReq ? `payload ${JSON.stringify(impReq.body)} -> HTTP ${impReq.status}` : 'no request captured for action "important"/"unimportant"');
    if (impReq) check('action:important-server-accepts', impReq.status === 200, `server returned ${impReq.status} (expect 200)`);
  } else {
    check('action:important-button-present', false, 'NO IMPORTANT BUTTON FOUND');
  }

  // Archive (only action matching the server enum) — verify end-to-end.
  const archiveBtn = q('article.email-item').nth(0).locator('button[aria-label="Archive"]').first();
  if ((await archiveBtn.count()) > 0) {
    await archiveBtn.click();
    await page.waitForTimeout(1200);
    const archReq = actionRequests.find((a) => (a.body as { action?: string })?.action === 'archive');
    check('action:archive-sends-archive', !!archReq, archReq ? `payload ${JSON.stringify(archReq.body)} -> HTTP ${archReq.status}` : 'no request captured');
    if (archReq) check('action:archive-server-accepts', archReq.status === 200, `server returned ${archReq.status} (expect 200)`);
  } else {
    check('action:archive-button-present', false, 'NO ARCHIVE BUTTON FOUND');
  }

  // Delete/trash — client EmailAction has no trash variant.
  const deleteBtn = q('button[aria-label*="delete" i], button[aria-label*="trash" i], button[title*="delete" i], button[title*="trash" i]').first();
  check('action:delete-button-in-ui', (await deleteBtn.count()) > 0, (await deleteBtn.count()) > 0 ? 'delete button found' : 'NO DELETE/TRASH BUTTON — client EmailAction has no trash variant (server supports trash)');

  // --- Reply modal (compose form: To/Subject/Message + Send/Cancel) --------------
  const replyBtn = q('article.email-item').nth(0).locator('button[aria-label="Reply"]').first();
  if ((await replyBtn.count()) > 0) {
    await replyBtn.click();
    await page.waitForTimeout(600);
    const modalVisible = await q('[role="dialog"]').isVisible().catch(() => false);
    check('reply:modal-opens', modalVisible, `dialog visible: ${modalVisible}`);
    const toInput = await q('[role="dialog"] input[value*="@"]').count();
    check('reply:to-field-prefilled', toInput > 0, `to-field with address: ${toInput > 0}`);
    const textarea = await q('[role="dialog"] textarea').count();
    check('reply:message-textarea', textarea > 0, `textarea: ${textarea > 0}`);
    const sendBtn = await q('[role="dialog"] button:has-text("Send")').count();
    check('reply:send-button-present', sendBtn > 0, `send button: ${sendBtn > 0}`);
    const paneTone = await q('aside select').count();
    check('detailpane:tone-select-present', paneTone > 0, `aside tone select: ${paneTone > 0}`);
    const draftBtn = await q('aside button:has-text("Draft Reply")').count();
    check('detailpane:draft-reply-button', draftBtn > 0, `aside draft reply button: ${draftBtn > 0}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    check('reply:button-present', false, 'NO REPLY BUTTON FOUND');
  }

  // --- AI Analyze (button flips to "Analyzing…" + disabled; toast within ~3s) ----
  const analyzeBtn = q('button:has-text("Analyze"), button:has-text("Analyzing")').first();
  if ((await analyzeBtn.count()) > 0) {
    await analyzeBtn.click();
    await page.waitForTimeout(200);
    const labelDuring = (await analyzeBtn.textContent().catch(() => '')) ?? '';
    const disabledDuring = labelDuring.includes('Analyzing');
    check('analyze:button-disabled-while-running', disabledDuring, `disabled during run: ${disabledDuring} (label "${labelDuring.trim()}")`);
    const toastVisible = await q('.toast span').first().waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false);
    const toast = toastVisible ? (await q('.toast span').first().textContent().catch(() => '')) ?? '' : '';
    check('analyze:completes', toast !== '' && !toast.includes('failed'), toast.slice(0, 60) || '(no toast within 25s)');
    check('analyze:no-page-error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'clean');
  } else {
    check('analyze:button-present', false, 'NO ANALYZE BUTTON');
  }

  // --- Refresh ----------------------------------------------------------------
  await q('article.email-item').first().click();
  const refreshBtn = q('button[aria-label*="refresh" i], button:has-text("Refresh")').first();
  if ((await refreshBtn.count()) > 0) {
    await refreshBtn.click();
    await page.waitForTimeout(300);
    const disabledDuring = await refreshBtn.isDisabled().catch(() => false);
    await page.waitForTimeout(2500);
    const n = await q('article.email-item').count();
    check('refresh:reloads', n > 0, `${n} rows after refresh`);
    check('refresh:disabled-while-running', disabledDuring, `disabled during run: ${disabledDuring}`);
    check('refresh:no-error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
  } else {
    check('refresh:button-present', false, 'NO REFRESH BUTTON');
  }

  // --- Multi-account ------------------------------------------------------------
  const switchBtn = q('nav button:has-text("Switch")').first();
  const nAccounts = await q('nav button:has-text("Disconnect"), nav button:has-text("Switch")').count();
  check('multiaccount:switcher-present', nAccounts > 0, `${nAccounts} account controls`);
  if ((await switchBtn.count()) > 0) {
    await switchBtn.click();
    await page.waitForTimeout(2500);
    const n2 = await q('article.email-item').count();
    check('multiaccount:switch-loads', n2 >= 0, `second account rendered ${n2} rows`);
    await q('nav button:has-text("Switch")').first().click();
    await page.waitForTimeout(2500);
    const n3 = await q('article.email-item').count();
    check('multiaccount:switch-back', n3 > 0, `switched back -> ${n3} rows`);
  }

  // --- Summary account correctness (BUG#2: no account param on /api/summary) ------
  check('summary:account-param-present', summaryRequests.length > 0 && summaryRequests.every((u) => u.includes('account=')),
    summaryRequests.length ? summaryRequests.map((u) => (u.includes('account=') ? 'with account' : 'NO account param')).slice(0, 3).join(' | ') : 'no summary requests observed');

  // --- Error path: backend down (simulated via route abort on a fresh page) --------
  const errPage = await ctx.newPage();
  const errConsole: string[] = [];
  errPage.on('console', (m) => { if (m.type() === 'error') errConsole.push(m.text()); });
  await errPage.route('**/api/emails*', (route) => route.abort('connectionrefused'));
  await errPage.goto('http://localhost:3030/', { waitUntil: 'networkidle' });
  await errPage.waitForTimeout(4000);
  const errVisible = await errPage.locator('text=/failed to load emails/i').first().isVisible().catch(() => false);
  check('error:backend-down-shows-error', errVisible, `error state visible: ${errVisible}`);
  const retryBtn = await errPage.locator('button:has-text("Retry")').count();
  check('error:retry-button-present', retryBtn > 0, `retry button: ${retryBtn > 0}`);
  await errPage.unroute('**/api/emails*');
  await errPage.close();

  // --- Console hygiene across the whole run --------------------------------------
  check('hygiene:no-react-warnings', reactWarnings.length === 0, reactWarnings.slice(0, 3).join(' | ') || 'clean');
  check('hygiene:no-page-errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'clean');
  check('hygiene:no-console-errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
} catch (err) {
  results.push({ check: 'SCRIPT-ERROR', pass: false, detail: String(err).slice(0, 200) });
} finally {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== SPA FUNCTIONAL AUDIT [${browserName}] — ${passed} pass / ${failed} fail ===\n`);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.check}\n     ${r.detail}`);
  console.log(`\nconsole errors (${consoleErrors.length}):`);
  for (const e of consoleErrors.slice(0, 8)) console.log('  ' + e.slice(0, 160));
  console.log(`page errors (${pageErrors.length}):`);
  for (const e of pageErrors.slice(0, 5)) console.log('  ' + e.slice(0, 160));
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}
