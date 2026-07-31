# email-agent

Gmail AI agent — smart inbox with AI-powered prioritization (importance scoring, summaries, suggested actions, smart replies) via NIM-compatible LLM endpoints.

## Install

```bash
bun install
```

## Run

```bash
bun run index.ts
```

Serves the dashboard at `http://localhost:3030/dashboard.html`. Requires:
- Gmail OAuth credentials (see `.env` — `.env.example` documents the required keys)
- A NIM-compatible LLM endpoint (defaults to localhost, overridable via env)

## Test

```bash
bun test
```

## QA (browser verification, fully self-contained)

Playwright runs from this repo's own `node_modules` — no external installs needed beyond the Chromium binary at `/usr/bin/chromium`.

Start the server first, then:

```bash
# DOM audit: tokens, layout, overflow, badges
bun run scripts/qa/dom_check.ts

# Full end-to-end: email click -> AI summary -> smart reply modal
bun run scripts/qa/e2e_check.ts

# Post-polish audits (interaction, modal flow, mobile, reduced-motion)
bun run scripts/qa/polish_dom_check.ts
bun run scripts/qa/polish_interact_check.ts
bun run scripts/qa/polish_modal_check.ts
```

If Chromium is elsewhere, point `executablePath` in the script to your binary.

## Type checking

```bash
bunx tsc --noEmit        # server code
bunx tsc --noEmit -p scripts/qa/tsconfig.json  # QA scripts (DOM libs)
```
