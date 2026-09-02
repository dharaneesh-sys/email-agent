# Email Agent Design System

> React + Vite SPA replacing `dashboard.html`. Single source of truth for all visual decisions.
> Every component is written after reading this file first.

## 0. Research Log (greenfield)

- Embedded refs: shortlisted [superhuman, raycast, linear.app] → picked [redesign-skill] + [superhuman] because this is a fast, keyboard-first email client — superhuman is the only Layer B reference for that exact product class; its lavender-glow-on-dark restraint beats linear's project-manager minimalism and raycast's launcher chrome for an inbox workload.
- Lazyweb: skipped — user constraint ("use online research only when necessary"); superhuman.md ships the full token/type/component contract embedded.
- Imagen drafts: skipped — no image pipeline in this environment; direct implementation from the embedded reference.
- ui-ux-db: 1 design-system search ("email client productivity dark mode premium AI") → generic "Modern Dark / Inter" pattern; took the dark-mode-first + no-pure-black discipline, rejected the blue/red SaaS palette (anti-slop) and the "Enterprise Gateway" marketing-page pattern (this is an app shell, not a landing page).

## 1. Atmosphere & Identity

A quiet command center for the inbox — dense enough for power use, calm enough to sit in all day. The signature is **lavender glow on warm charcoal**: surfaces separate by tonal shift rather than shadow, and a single soft-lavender accent marks everything alive (unread, AI-scored, interactive) without ever shouting. Keyboard-first: the mouse is optional, the `r`/`Esc`/`/` shortcuts are load-bearing. This is a tool that respects the operator's speed — Superhuman's product temperament, stripped of its marketing.

## 2. Color

### Palette (dark-only, deliberate — see §8 debt)

| Role | Token | Value | Usage |
|------|-------|-------|-------|
| Surface/primary | --surface-primary | #0E0E11 | App background (never pure black) |
| Surface/secondary | --surface-secondary | #16161B | List rows, nav rail, panes |
| Surface/elevated | --surface-elevated | #1D1D24 | Modals, popovers, tooltips |
| Surface/hover | --surface-hover | #1A1A20 | Row hover overlay |
| Text/primary | --text-primary | #F5F4F7 | Headlines, body |
| Text/secondary | --text-secondary | #A8A6B2 | Captions, metadata, dates |
| Text/tertiary | --text-tertiary | #6B6975 | Disabled, placeholders |
| Border/default | --border-default | #26262E | Card/row separation |
| Border/subtle | --border-subtle | #1B1B21 | Soft dividers |
| Accent/primary | --accent-primary | #CBB7FB | Interactive glow, chips, focus, selected |
| Accent/hover | --accent-hover | #DCCCFD | Hover state on accent elements |
| Accent/link | --accent-link | #B79FF6 | Text links, AI badges (≥4.5:1 on surfaces) |
| Accent/muted | --accent-muted | rgb(203 183 251 / 0.14) | Selected row wash, subtle fills |
| Status/success | --status-success | #8CE0AE | Confirmations, read-toggle |
| Status/warning | --status-warning | #F5C77E | Warnings |
| Status/error | --status-error | #F0807E | Errors, destructive |
| Status/info | --status-info | #CBB7FB | Informational (same family as accent) |
| Scrim | --scrim | rgb(6 6 9 / 0.6) | Modal backdrop |

### Rules
- Surface hierarchy creates depth through tonal shift; borders are for separation, shadows only on the modal layer (§7).
- Accent is used ONLY for interactive elements, live states (unread/AI), and selected states. Never decorative.
- Never introduce a color not in this table. Extend the table first.
- Status colors must carry a text label or icon — never color-only meaning (color-not-only).
- Every declared color passes WCAG AA on its intended surface (§8).

## 3. Typography

### Font Stack
- Primary: `Geist Sans` (bundled locally via `@fontsource-variable/geist` — Geist Sans ships under the `geist` package name — `font-display: swap`), fallback `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- Mono (data): `Geist Mono` (via `@fontsource-variable/geist-mono`), fallback `ui-monospace, "SF Mono", Menlo, monospace`
- If the fontsource package cannot be installed offline, fall back to the system stack — never load fonts from a CDN at runtime.

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| H1 | 20px / 1.25rem | 600 | 1.3 | -0.02em | Pane titles, modal titles |
| H2 | 16px / 1rem | 600 | 1.4 | -0.01em | Section headers (Summary, Smart Reply) |
| Body | 15px / 0.9375rem | 400 | 1.55 | 0 | Email subject, list text |
| Body/sm | 14px / 0.875rem | 400 | 1.5 | 0 | Sender, snippet, detail meta |
| Caption | 12.5px / 0.78125rem | 500 | 1.4 | 0 | Dates, tags, labels |
| Overline | 11px / 0.6875rem | 600 | 1.3 | 0.08em | Nav labels, uppercase |
| Data | 13px / 0.8125rem | 500 | 1.2 | 0 | AI scores, stat numbers — mono, tabular-nums |

### Rules
- Two families max. `font-variant-numeric: tabular-nums` on every numeric display (scores, stats, dates) — no layout shift when digits change.
- Body text never below 14px; captions never below 11px.
- Headings wrap with `text-wrap: balance`; paragraphs `text-wrap: pretty`.
- Numbers in mono where precision matters (scores, stats), proportional elsewhere.

## 4. Spacing & Layout

### Base Unit
All spacing derives from a base of **4px**.

| Token | Value | Usage |
|-------|-------|-------|
| --space-1 | 4px | Icon-to-label gaps |
| --space-2 | 8px | Compact: inline groups, chip gaps |
| --space-3 | 12px | Form field padding, icon button gutters |
| --space-4 | 16px | Standard: list row padding, card padding |
| --space-5 | 20px | Comfortable: pane section gaps |
| --space-6 | 24px | Generous: modal padding, pane padding |
| --space-8 | 32px | Separated: between panes, sections |
| --space-10 | 40px | Toolbar height context |
| --space-12 | 48px | Major section breaks |
| --space-16 | 64px | Page-level rhythm |

### Grid & Shell
- Max content width: 1440px (app shell is full-bleed; content column constrained inside panes).
- App shell: `fixed-sidenav-shell` (layout-skill primitive) — fixed left nav rail + fluid list + detail pane.
- Desktop (≥1024px): 3-region `list-detail` grid — `auto minmax(0, 1fr) minmax(0, 1.1fr)`; nav rail 220px, list and detail share remaining width (detail wins on ≥1440px).
- Tablet (768–1023px): nav rail collapses to a 64px icon rail; list + detail remain side-by-side.
- Mobile (<768px): single column. List owns the viewport; detail becomes an overlay sheet (imposter + backdrop) with a back affordance.
- Breakpoints named by layout state: `--bp-tablet 768px`, `--bp-desktop 1024px`, `--bp-wide 1440px`.
- Bounded scroll shell: `display: grid; grid-template-rows: auto minmax(0, 1fr); max-block-size: 100dvb;` — **list pane and detail pane are each a named scroll owner with `min-height: 0`** (layout-skill §1–§2). Nav rail never scrolls.

### Rules
- Tokenize design intent (spacing steps, shell widths); keep browser mechanics raw (`auto`, `%`, `minmax()`, `clamp()`, `dvb`).
- Panes use logical properties (`margin-inline`, `inset-inline`) for future RTL.
- 375px reflow: single readable column, zero horizontal scroll of primary content.

## 5. Components

### NavRail (app shell aside)
- **Structure**: `<nav aria-label="Mailbox">` — brand row, filter list (All / Unread / Important / Starred), account block (switcher + auth) pinned to bottom.
- **Variants**: expanded (≥768px, text+icon), collapsed (64px icon-only rail at <768px desktop-width).
- **Spacing**: rail 220px; item padding var(--space-3) var(--space-4); item gap var(--space-2).
- **States**: default; hover (surface-hover); active filter (accent-muted wash + accent text + 2px accent inset indicator); focus (accent ring); disabled (tertiary, no click).
- **Accessibility**: real buttons; `aria-current="page"` on active; counts read as "Unread · 12"; full keyboard reach.
- **Motion**: none (persistent), 150ms ease-out background on hover.
- **Layout**: `stack` primitive; scroll owner: none.

### SearchField
- **Structure**: `<input type="search">` with leading magnifier icon, keyboard hint kbd (`/`).
- **States**: default; focus (border accent + 3px accent-muted ring); filled; disabled; empty.
- **Accessibility**: visible label (sr-only) + `aria-label="Search emails"`; `Escape` clears and blurs; global `/` focuses.
- **Layout**: fixed width in top toolbar; scroll owner: none.

### EmailList (scroll owner #1)
- **Structure**: `<main role="list" aria-label="Email list">` containing `EmailItem` rows.
- **Variants**: loading (5 skeleton rows), empty (composed 📭-free SVG + message + action), error (message + Retry button), populated.
- **States**: per-row (§ EmailItem).
- **Accessibility**: list semantics; rows focusable; `aria-selected` on active row.
- **Motion**: rows enter 200ms ease-out with 30ms stagger; skeleton shimmer 1.4s.
- **Layout**: `stack`; **owns vertical scroll**, `min-height: 0`.

### EmailItem
- **Structure**: article row — avatar (initials, colored by sender hash), 2-line block (sender / subject / snippet + tags), date + score rail, hover action cluster (read, star, archive, important, reply), unread indicator dot.
- **Variants**: default, unread (accent dot + bolder subject), important (accent-muted left wash), selected (accent-muted bg + accent border), analyzing (pulse opacity 0.45→0.9), AI-scored (score chip + `AI` badge with reason tooltip).
- **Spacing**: padding var(--space-4); gap var(--space-3); tags cluster var(--space-2).
- **States**: default, hover (surface-hover + actions reveal), active (scale 0.995), focus (accent ring inset), selected, disabled (during action in-flight), loading (analyzing pulse).
- **Accessibility**: keyboard — Enter opens detail, Tab reaches action cluster, Space toggles checkbox; tooltips carry `role="tooltip"`.
- **Motion**: actions fade/slide in 150ms on hover/focus-within; analyze pulse 1.2s ease-in-out.
- **Layout**: `cluster` for tags; `stack` for text block; truncate with ellipsis (`text-overflow: ellipsis; min-inline-size: 0`).

### DetailPane (scroll owner #2)
- **Structure**: `<aside>` — meta (subject, from, date), importance row (chips), body (sanitized HTML), Summary panel (AI badge, loading skeleton / text + key points + suggested action / unavailable), Smart Reply block (tone select + Draft button).
- **Variants**: empty (placeholder "Select an email"), loading (skeleton), populated, error (summary unavailable — degrades).
- **States**: interactive children only (tone select, draft button, reply).
- **Accessibility**: body region `aria-live="polite"` on summary load; HTML body sanitized (see §8 debt — server HTML rendered via textContent-safe renderer or DOMPurify).
- **Motion**: pane content crossfades 200ms on email switch; skeleton shimmer.
- **Layout**: `stack`; **owns vertical scroll**, `min-height: 0`; body constrained to ~65ch measure.

### ReplyModal
- **Structure**: `role="dialog" aria-modal="true" aria-labelledby` — header (title + close), form (To readonly, Subject readonly, Message textarea, Reply-all checkbox), footer (Cancel / Send). Backdrop scrim.
- **Spacing**: modal padding var(--space-6); field gap var(--space-4); footer padding var(--space-4) var(--space-6).
- **States**: open (scale 0.97→1 + fade 200ms), sending (Send disabled + "Sending…"), validation (empty body → inline error "Please enter a reply"), error (toast).
- **Accessibility**: focus trap; initial focus on body textarea; `Esc` closes; `aria-describedby` error hint; backdrop click closes; never steals focus from toasts.
- **Motion**: spring scale+fade 250ms ease-out; exit faster (150ms).
- **Layout**: `imposter` overlay-stack over app; scroll owner: modal body if content overflows (rare).

### Toast
- **Structure**: single live region `role="status" aria-live="polite"` bottom-center; variants info / success / error (accent, status-success, status-error border + icon).
- **States**: visible 3s, fade out 200ms; error variant `role="alert"`.
- **Accessibility**: aria-live announces without stealing focus; contrast ≥4.5:1.
- **Layout**: `imposter` fixed bottom; never part of scroll flow.

### Button / IconButton
- **Structure**: `<button>`; variants — primary (accent bg, dark text), secondary (surface-elevated + border), ghost (transparent, hover wash), icon (44×44 hit area).
- **States**: default, hover (accent-hover / surface-hover), active (scale 0.97), focus (accent ring), disabled (tertiary 0.5 opacity, `cursor: not-allowed`), loading (disabled + label swap).
- **Accessibility**: `aria-label` on icon-only buttons; `cursor: pointer`; min 44px touch target.
- **Motion**: 150ms ease-out background; press scale 0.97.
- **Layout**: `cluster`; buttons bottom-aligned in card groups.

### SkeletonRow
- **Structure**: shimmer block matching row anatomy (avatar circle + 2 text bars).
- **Motion**: shimmer 1.4s ease infinite; disabled under reduced-motion.

### ScoreChip / LlmBadge + Tooltip
- **Structure**: mono score chip (accent ≥70, mid ≥40, low otherwise) + `AI` badge; hover/focus reveals reason tooltip (role="tooltip", surface-elevated, accent-link text).
- **States**: hover/focus-visible reveal; keyboard reachable.
- **Motion**: tooltip fade 100ms.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 100–150ms | ease-out | Hover washes, press scale, tooltips |
| Standard | 200–300ms | ease-in-out | Modal open, pane crossfade, row stagger |
| Emphasis | 400ms | cubic-bezier(0.16, 1, 0.3, 1) | List↔detail transition, toast exit |
| Ambient | 1.2–1.4s | ease-in-out | Analyze pulse, skeleton shimmer |

### Rules
- Animate ONLY `transform` and `opacity`. Never layout properties.
- Every interactive element: hover + active + focus states (§5).
- Staggered list entries 30ms apart, max 300ms total — never mount everything at once, never stagger past perception.
- Exits are faster than entries (~60–70%).
- `prefers-reduced-motion: reduce` → all non-essential animation duration 0.01ms, iteration 1 (pulse/shimmer disabled, stagger collapsed).
- No scroll listeners; `IntersectionObserver` if reveal is ever added.

## 7. Depth & Surface

### Strategy: **mixed — tonal-shift + borders, one shadow layer**

- Surface hierarchy by tonal shift: primary → secondary → elevated (no borders needed for panes; borders only where two same-tone surfaces meet).
- Borders (1px var(--border-default)): rows, cards, inputs, modal chrome. Subtle (var(--border-subtle)): dividers inside panes.
- Shadows: **exactly one level** — Prominent `0 16px 48px rgb(0 0 0 / 0.5)` for the modal layer only. Everything else is border + tone.
- Accent glow: `box-shadow: 0 0 0 1px var(--accent-primary)` on selected/focused rows — outline, not ambient glow.
- Zero glassmorphism, zero gradients, zero noise overlays. Restraint is the texture.

## 8. Accessibility Constraints & Accepted Debt

### Constraints
- WCAG 2.2 AA. Contrast floor 4.5:1 body / 3:1 large text. Every declared color passes on its surface.
- Visible focus ring on every interactive element (2px accent, 2px offset).
- Full keyboard reachability: `r` reply (with selection), `Esc` close modal/clear search, `/` focus search, `ArrowUp/Down` + `Enter` list navigation, `Tab` through actions.
- Skip-to-content link at top of shell.
- Toasts announce via `aria-live` without stealing focus; errors inline + `role="alert"`.
- `prefers-reduced-motion` respected globally (§6).
- Semantic HTML: `<nav>`, `<main>`, `<aside>`, `<article>`, `<dialog>` semantics; no div soup.
- `lang="en"`, unique `<title>`, meta description, proper viewport.

### Accepted Debt
| Item | Location | Why accepted | Owner / Exit |
|------|----------|--------------|--------------|
| Light mode | whole app | superhuman product is dark-only; old dashboard is dark-only; user wants a great dark app, not a half-light mode | Add light token set when requested |
| HTML email body rendered sanitized | DetailPane | old app used raw innerHTML; we render via textContent-safe path to avoid XSS — cosmetic fidelity loss on rich emails | Revisit with DOMPurify + allowlist when rich rendering is required |
| No virtualization | EmailList (max 50 items) | server caps maxResults=50; perf fine | Virtualize if maxResults ever grows |
| No i18n/RTL | whole app | single-locale personal tool | If localization is requested |
| OAuth Publishing status Testing (7-day refresh expiry) | `src/auth.ts` + `~/.config/email-agent/tokens/` | Google expires `refresh_token` after 7 days in Testing (observed as 15-day drift across 2 accounts) | **Must move to Production**: `console.cloud.google.com → OAuth consent screen → Publishing status → In production` + verify `gmail.*` restricted scopes (see https://developers.google.com/identity/protocols/oauth2#expiration, https://support.google.com/cloud/answer/13464325). Code fallback: `saveToken` preserves refresh_token across re-consent, scheduler refreshes every 6h and at 50% TTL, diagnostics at `GET /api/auth/diagnostics`, health at `GET /api/auth/status` |
