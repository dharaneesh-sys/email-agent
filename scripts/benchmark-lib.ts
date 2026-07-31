// Pure benchmark helpers for the NIM email-model benchmark.
// No network calls and no imports from src/ — everything here is
// unit-testable in isolation.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SampleEmail {
  id: string
  from: string
  to: string
  subject: string
  body: string
  dateIso: string
}

// allow: SIZE_OK — CORPUS is a pure data table (6 fixed fixtures); the
// actual logic in this file is ~130 LOC.
export const CORPUS: readonly SampleEmail[] = [
  {
    id: 'urgent-deadline',
    from: 'sarah.mitchell@acmecorp.com',
    to: 'you@acmecorp.com',
    subject: 'URGENT: Q3 report deadline moved to Friday',
    body: [
      'Hi, I need to flag something urgent before the end of the week.',
      'The Q3 financial report deadline has moved up to this Friday at 5 PM — the original due date was next Tuesday.',
      'The board meeting got rescheduled, so finance needs our numbers three days earlier than planned.',
      'Please confirm by tomorrow morning that you can deliver the revenue section on time.',
      'If you need extra help pulling the numbers, loop in Priya from the analytics team.',
      'Let me know either way — this is the last urgent item on my list this quarter.',
    ].join(' '),
    dateIso: '2026-07-28T09:15:00.000Z',
  },
  {
    id: 'meeting-invite',
    from: 'james.okafor@example.com',
    to: 'you@acmecorp.com',
    subject: 'Meeting: product roadmap review — Thursday 2pm',
    body: [
      'Hello, I would like to invite you to a meeting next Thursday at 2:00 PM to review the product roadmap for the coming quarter.',
      'The meeting will take place in the Blue Room on the third floor, and a video link will be shared the day before.',
      'We will go over Q4 priorities, feedback from the last customer survey, and the draft of the new onboarding flow.',
      'Please add the meeting to your calendar and let me know if you cannot attend.',
      'The agenda is attached to this email, so it is worth a quick look beforehand.',
      'Looking forward to seeing you there.',
    ].join(' '),
    dateIso: '2026-07-29T10:00:00.000Z',
  },
  {
    id: 'bank-alert',
    from: 'alerts@securebank.example',
    to: 'you@example.com',
    subject: 'UPI alert: transaction of $1,250.00 on your account',
    body: [
      'This is to confirm that a transaction of $1,250.00 was completed on your account ending in 4821 on 29 July 2026 at 14:32 IST.',
      'The payment was made through UPI to PayU India for your order on QuickCart (order ID QC-88431).',
      'If you made this purchase, no action is required from your side.',
      'If you do not recognize this transaction, please call our 24x7 helpline immediately or block your card from the app.',
      'We also recommend changing your UPI PIN if you suspect any unauthorized activity.',
      'This is an automated alert, so please do not reply to this email.',
    ].join(' '),
    dateIso: '2026-07-29T09:02:00.000Z',
  },
  {
    id: 'newsletter',
    from: 'newsletter@weeklydigest.example',
    to: 'you@example.com',
    subject: 'The Weekly Digest — issue #142',
    body: [
      'Welcome to issue #142 of The Weekly Digest — your roundup of the most interesting stories in tech, design, and productivity.',
      'This week we take a deep look at how small teams are shipping AI features without dedicated ML engineers.',
      'We also collected five practical checklists for remote work, a long read on the history of the web browser, and a guide to building better dashboards.',
      'As always, every story is hand-picked and summarized so you can skim everything in under ten minutes.',
      'If you enjoy the newsletter, please forward it to a friend — subscriptions keep this thing alive.',
      'You are receiving this because you subscribed on our website.',
    ].join(' '),
    dateIso: '2026-07-31T06:00:00.000Z',
  },
  {
    id: 'promo-offer',
    from: 'deals@shopmart.example',
    to: 'you@example.com',
    subject: '50% OFF everything — this weekend only',
    body: [
      'Big news: this weekend only, take 50% OFF everything in the ShopMart summer collection with the code SUMMER50.',
      'From electronics to home decor, every single item is discounted — no minimum order, no fine print.',
      'The sale ends Sunday at midnight or while stocks last, so do not wait too long.',
      'New customers also get free shipping on their first order, no code needed.',
      'We add fresh arrivals to the sale page every day this week, so check back often.',
      'You can unsubscribe from future promotional emails using the link at the bottom of this message.',
    ].join(' '),
    dateIso: '2026-07-30T18:30:00.000Z',
  },
  {
    id: 'expense-policy',
    from: 'hr@acmecorp.com',
    to: 'all-staff@acmecorp.com',
    subject: 'Updated expense reimbursement policy for Q4',
    body: [
      'Hi all, HR has updated the expense reimbursement policy for Q4, and the changes take effect on the first of next month.',
      'The main updates are a new cap for client dinners and a simpler process for submitting mileage claims.',
      'Please review the attached policy document and make sure your team is aware of the new limits before the next expense run.',
      'We will also host a short walkthrough session on Friday afternoon for anyone with questions.',
      'This policy affects everyone in the company, so even a quick skim is appreciated.',
      'Thanks for your cooperation.',
    ].join(' '),
    dateIso: '2026-07-30T08:45:00.000Z',
  },
]

// ─── Scoring ────────────────────────────────────────────────────────────────

export function computeCompositeScore(quality: number, speed: number, cost: number): number {
  return quality * 0.6 + speed * 0.25 + cost * 0.15
}

// 0..100 scaling: (v - min) / (max - min) * 100. All-equal inputs → 100 for
// every entry; non-finite entries are left untouched.
export function minMaxNormalize(values: Record<string, number>): Record<string, number> {
  const finite = Object.values(values).filter((v) => Number.isFinite(v))
  if (finite.length === 0) return { ...values }
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) {
      out[key] = value
      continue
    }
    out[key] = max === min ? 100 : ((value - min) / (max - min)) * 100
  }
  return out
}

// ─── Tolerant JSON parsing ──────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?/gi, '').trim()
}

// Finds the first '{' or '[' in the text and returns the balanced JSON
// substring (string-aware). Falls back to a bare number scan when
// JSON.parse fails, so partially-valid output still yields scores.
export function extractBalancedJson(text: string): unknown {
  const cleaned = stripCodeFences(text)
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned.charAt(i)
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0 && start !== -1) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1))
        } catch {
          const numbers = cleaned
            .slice(start, i + 1)
            .match(/-?\d+(?:\.\d+)?/g)
            ?.map(Number) ?? []
          return numbers.length > 0 ? numbers : null
        }
      }
    }
  }
  return null
}

function clampScore(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)))
}

function coerceScores(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const scores: number[] = []
  for (const item of raw) {
    const n = typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : NaN
    if (Number.isFinite(n)) scores.push(clampScore(n))
  }
  return scores
}

// Parses a judge response: a bare JSON array, {"scores": [...]}, or
// {"quality": N, "perItem": [...]}. Quality = explicit `quality` field when
// present, else the average of the parsed scores. Any total failure →
// { quality: 60, perItem: [] }.
export function aggregateJudgeOutput(judgeText: string, expectedCount: number): { quality: number; perItem: (number | null)[] } {
  const parsed = extractBalancedJson(judgeText)
  let quality: number | null = null
  let scores: number[] = []
  if (Array.isArray(parsed)) {
    scores = coerceScores(parsed)
  } else if (isRecord(parsed)) {
    const perItem = parsed['perItem']
    if (Array.isArray(perItem)) scores = coerceScores(perItem)
    else if (Array.isArray(parsed['scores'])) scores = coerceScores(parsed['scores'])
    const raw = parsed['quality']
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    if (Number.isFinite(n)) quality = clampScore(n)
  }
  if (quality === null && scores.length > 0) {
    quality = scores.reduce((a, b) => a + b, 0) / scores.length
  }
  if (quality === null) return { quality: 60, perItem: [] }
  const perItem: (number | null)[] = Array.from({ length: expectedCount }, (_, i) => scores[i] ?? null)
  return { quality, perItem }
}

// ─── Generated-model file IO ────────────────────────────────────────────────

export interface GeneratedModelFile {
  model: string
  selectedAt: string
  scores: Record<string, { quality: number; speed: number; cost: number; total: number }>
  notes: string
}

export function loadGeneratedModel(path: string): GeneratedModelFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(parsed)) return null
    if (typeof parsed['model'] !== 'string') return null
    if (typeof parsed['selectedAt'] !== 'string') return null
    if (!isRecord(parsed['scores'])) return null
    if (typeof parsed['notes'] !== 'string') return null
    return parsed as unknown as GeneratedModelFile
  } catch {
    return null
  }
}

export function writeGeneratedModel(path: string, winner: GeneratedModelFile): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(winner, null, 2) + '\n')
}

// ─── Concurrency ────────────────────────────────────────────────────────────

// Runs `worker` over every item with at most `concurrency` in flight.
// Results are returned in input order regardless of completion order.
export async function pool<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const active = Math.min(Math.max(concurrency, 1), items.length)
  async function run(): Promise<void> {
    while (true) {
      const index = next
      next += 1
      const item = items[index]
      // Termination + noUncheckedIndexedAccess guard: the array is not sparse.
      if (item === undefined) return
      results[index] = await worker(item)
    }
  }
  await Promise.all(Array.from({ length: active }, () => run()))
  return results
}

// ─── Prompt builders (mirror what src/llm.ts will do; defined locally so
// this file never depends on it) ─────────────────────────────────────────────

export function buildImportancePrompt(email: SampleEmail, accountEmail: string): string {
  return [
    `You are an email triage assistant for ${accountEmail}.`,
    'Assess how important this email is for the recipient to read and act on today.',
    '',
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    '',
    email.body,
    '',
    'Respond ONLY with JSON: {"score": 0-100, "reason": "short justification"}',
    'Score 100 = must act immediately, 0 = can safely ignore.',
  ].join('\n')
}

export function buildSummaryPrompt(email: SampleEmail): string {
  return [
    'Summarize this email for the recipient.',
    '',
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    '',
    email.body,
    '',
    'Respond ONLY with JSON: {"summary": "2-3 sentences", "keyPoints": ["...", "..."], "suggestedAction": "one line or empty string"}',
  ].join('\n')
}

export function buildDraftPrompt(email: SampleEmail, tone: string): string {
  return [
    `Write a ${tone} reply to this email as the recipient.`,
    '',
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    '',
    email.body,
    '',
    'Respond with the plain text of the reply only — no preamble, no quotes.',
  ].join('\n')
}

// ─── Benchmark result ───────────────────────────────────────────────────────

export interface EvalResult {
  model: string
  quality: number
  speed: number
  cost: number
  total: number
  avgLatencyMs: number
  totalTokens: number
}
