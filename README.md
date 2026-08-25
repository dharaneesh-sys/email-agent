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

Serves the SPA (web/dist) at `http://localhost:3030/` and the API at `/api/*` (built from `web/`, design system in `DESIGN.md`). Only `web/dist` is served — `legacy/dashboard.html` is archived and returns 404. Requires:
- Gmail OAuth credentials (see `.env` — `.env.example` documents the required keys)
- A NIM-compatible LLM endpoint (defaults to localhost, overridable via env)

### Frontend

The SPA lives in `web/` (Vite + React 19 + TS) and is served from `web/dist` at `/` with SPA fallback (`/settings`, etc. → `index.html`); hashed assets at `/assets/*` are immutable. Dev server proxies `/api` to the running Hono server:

```bash
cd web && bun install && bun run dev   # http://localhost:5173
bun run build                          # tsc --noEmit && vite build -> web/dist (served by the server)
```

## Test

```bash
bun test
```

## QA (browser verification, fully self-contained)

Playwright runs from this repo's own `node_modules` — no external installs needed beyond the Chromium binary at `/usr/bin/chromium`.

Start the server first, then:

```bash
# SPA audits (React app): shell/scroll-owners/overflow, interaction, modal+draft flow
#   spa_dom_check.ts     — shell geometry, tokens, fonts, rail width, account rows, no overflow
#   spa_interact_check.ts — list click → detail pane, summary, tone select, reply modal, 'r'/Esc, 375px reflow, reduced-motion
#   spa_modal_check.ts   — waits for AI summary (NIM ~10s), draft reply body, reply-to, tone options
bun run scripts/qa/spa_dom_check.ts
bun run scripts/qa/spa_interact_check.ts
bun run scripts/qa/spa_modal_check.ts

# Legacy dashboard audits (archived to legacy/dashboard.html — no longer served)
bun run scripts/qa/dom_check.ts
bun run scripts/qa/e2e_check.ts
bun run scripts/qa/polish_dom_check.ts
bun run scripts/qa/polish_interact_check.ts
bun run scripts/qa/polish_modal_check.ts
```

If Chromium is elsewhere, point `executablePath` in the script to your binary.

## Type checking

```bash
bunx tsc --noEmit        # server code
bunx tsc --noEmit -p web/tsconfig.json  # SPA code
bunx tsc --noEmit -p scripts/qa/tsconfig.json  # QA scripts (DOM libs)
```
