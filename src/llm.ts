// LLM-powered email intelligence: importance scoring, summaries, draft replies.
// Backed by the NVIDIA NIM chat client; all results are cached in memory.
// allow: SIZE_OK — spec-mandated single file: 11 exports + one service class;
// every top-level symbol is either a required export or a private helper of
// LlmService. Splitting would break the required `./llm` import surface.

import { readFileSync } from 'node:fs'
import { NIM_CONFIG } from './config'
import { chat } from './nim'
import type { NimMessage } from './nim'

export type Tone = 'professional' | 'friendly' | 'concise' | 'formal'

// Minimal email shape consumed by the LLM prompts. Deliberately separate from
// the raw Gmail `Email` schema in types.ts, which only carries headers/payload
// and is painful to construct in tests.
export interface EmailLike {
  id: string
  from: string
  to: string
  subject: string
  snippet?: string
  body?: string
  date: string | Date
  isImportant?: boolean
}

export interface LlmImportanceResult {
  emailId: string
  llmScore: number
  reason: string
  isImportant: boolean
  model: string
}

export interface SummaryResult {
  summary: string
  keyPoints: string[]
  suggestedAction: string
  model: string
}

export interface DraftResult {
  reply: string
  model: string
}

interface ImportanceCacheEntry {
  result: LlmImportanceResult | null
  status: 'pending' | 'done' | 'failed'
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

const IMPORTANCE_SYSTEM_PROMPT =
  'You are an email prioritization assistant. Analyze the email and respond ONLY with JSON: {"score": 0-100, "reason": "one sentence"}'

const SUMMARY_SYSTEM_PROMPT =
  'You are an email summarizer. Respond ONLY with JSON: {"summary": "2-3 sentences", "keyPoints": ["..."], "suggestedAction": "..."}'

const TONE_DESCRIPTIONS: Record<Tone, string> = {
  professional: 'polite, business-appropriate language',
  friendly: 'warm, casual, conversational language',
  concise: 'short and direct language',
  formal: 'highly formal, respectful language',
}

function emailBody(email: EmailLike): string {
  const body = email.body?.trim()
  if (body !== undefined && body !== '') return body
  return email.snippet ?? ''
}

function formatDate(date: string | Date): string {
  return date instanceof Date ? date.toISOString() : date
}

export function buildImportancePrompt(email: EmailLike, accountEmail: string): string {
  return [
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Body: ${emailBody(email)}`,
    '',
    `Rate how important and actionable this email is for ${accountEmail}, on a scale of 0 to 100. Ignore newsletters and promotions unless they require action.`,
  ].join('\n')
}

export function buildSummaryPrompt(email: EmailLike): string {
  return [
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Date: ${formatDate(email.date)}`,
    `Body: ${emailBody(email)}`,
    '',
    'Summarize this email in 2-3 sentences, list its key points, and suggest one concrete next action.',
  ].join('\n')
}

function buildDraftSystemPrompt(tone: Tone): string {
  return `You are a helpful email assistant. Write a reply in ${tone} tone. Respond with the reply text only.`
}

export function buildDraftPrompt(email: EmailLike, tone: Tone): string {
  return [
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Body: ${emailBody(email)}`,
    '',
    `Write a reply to this email in a ${tone} tone (${TONE_DESCRIPTIONS[tone]}).`,
  ].join('\n')
}

// ─── Tolerant JSON extraction ────────────────────────────────────────────────

// Scans from the first '{' or '[' and returns the slice up to its balanced
// closing brace, respecting string literals (so '}' inside a string is safe).
function extractJsonSlice(text: string): string | null {
  const brace = text.indexOf('{')
  const bracket = text.indexOf('[')
  if (brace === -1 && bracket === -1) return null
  let start: number
  let open: string
  let close: string
  if (brace !== -1 && (bracket === -1 || brace < bracket)) {
    start = brace
    open = '{'
    close = '}'
  } else {
    start = bracket
    open = '['
    close = ']'
  }
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i] ?? ''
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === open) {
      depth++
    } else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function parseJsonObject<T>(text: string): T | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  let candidate = trimmed
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/)
  if (fenceMatch) candidate = (fenceMatch[1] ?? '').trim()
  if (candidate.startsWith('{') || candidate.startsWith('[')) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      // Fall through to slice extraction — the text may have trailing prose.
    }
  }
  const slice = extractJsonSlice(candidate)
  if (slice !== null) {
    try {
      return JSON.parse(slice) as T
    } catch {
      return null
    }
  }
  return null
}

// ─── Small shared helpers ────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function clampScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

// ─── LlmService ──────────────────────────────────────────────────────────────

const IMPORTANCE_DEADLINE_MS = 60_000
const CACHE_CAP = 100

export class LlmService {
  private activeModel: string | null = null
  private generatedModel: { model: string } | null | undefined
  private importanceCache = new Map<string, ImportanceCacheEntry>()
  private summaryCache = new Map<string, SummaryResult | null>()
  private draftCache = new Map<string, DraftResult | null>()

  constructor() {}

  // Priority: MODEL_ID env override → src/generated-model.json → default model.
  getActiveModel(): string {
    if (this.activeModel !== null) return this.activeModel
    const envOverride = NIM_CONFIG.modelEnvOverride
    if (envOverride !== null && envOverride.trim() !== '') {
      this.activeModel = envOverride
      return envOverride
    }
    const generated = this.readGeneratedModel()
    if (generated !== null && generated.model.trim() !== '') {
      this.activeModel = generated.model
      return generated.model
    }
    this.activeModel = NIM_CONFIG.defaultModel
    return NIM_CONFIG.defaultModel
  }

  isEnabled(): boolean {
    return NIM_CONFIG.apiKey !== null && NIM_CONFIG.apiKey !== ''
  }

  getActiveModelInfo(): { model: string; llmEnabled: boolean; defaultModel: string } {
    return {
      model: this.getActiveModel(),
      llmEnabled: this.isEnabled(),
      defaultModel: NIM_CONFIG.defaultModel,
    }
  }

  // Fire-and-forget importance scoring. Never throws.
  enqueueImportance(emails: EmailLike[], accountEmail: string): void {
    if (!this.isEnabled()) return
    const fresh = emails.filter((email) => {
      const cached = this.importanceCache.get(email.id)
      return cached === undefined || cached.status === 'failed'
    })
    const toProcess = fresh.slice(0, NIM_CONFIG.importance.maxPerSync)
    if (toProcess.length === 0) return
    for (const email of toProcess) {
      this.importanceCache.set(email.id, { result: null, status: 'pending' })
    }
    void this.runImportanceBatches(toProcess, accountEmail)
  }

  // Cache-only lookup; null while pending, failed, or unknown.
  getImportance(emailId: string): LlmImportanceResult | null {
    return this.importanceCache.get(emailId)?.result ?? null
  }

  // Await-scored importance: returns results for every requested email that
  // completed (cached or freshly scored) within the 60s deadline. Never throws.
  async ensureImportance(emails: EmailLike[], accountEmail: string): Promise<Map<string, LlmImportanceResult>> {
    const results = new Map<string, LlmImportanceResult>()
    if (!this.isEnabled()) {
      for (const email of emails) {
        const cached = this.importanceCache.get(email.id)
        if (cached?.status === 'done' && cached.result !== null) results.set(email.id, cached.result)
      }
      return results
    }
    const toScore: EmailLike[] = []
    for (const email of emails) {
      const cached = this.importanceCache.get(email.id)
      if (cached === undefined || cached.status === 'failed') {
        toScore.push(email)
      } else if (cached.status === 'done' && cached.result !== null) {
        results.set(email.id, cached.result)
      }
    }
    const capped = toScore.slice(0, NIM_CONFIG.importance.maxPerSync)
    for (const email of capped) {
      this.importanceCache.set(email.id, { result: null, status: 'pending' })
    }
    if (capped.length > 0) {
      try {
        await Promise.race([this.runImportanceBatches(capped, accountEmail), sleep(IMPORTANCE_DEADLINE_MS)])
      } catch {
        // Return whatever completed within the deadline.
      }
    }
    for (const email of emails) {
      const cached = this.importanceCache.get(email.id)
      if (cached?.status === 'done' && cached.result !== null) results.set(email.id, cached.result)
    }
    return results
  }

  async summarize(email: EmailLike): Promise<SummaryResult | null> {
    if (!this.isEnabled()) return null
    const key = `summary:${email.id}`
    const cached = this.summaryCacheGet(key)
    if (cached !== undefined) return cached
    const messages: NimMessage[] = [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: buildSummaryPrompt(email) },
    ]
    try {
      const result = await chat({
        model: this.getActiveModel(),
        messages,
        temperature: 0.2,
        maxTokens: NIM_CONFIG.maxOutputTokens.summary,
        responseFormat: { type: 'json_object' },
      })
      const parsed = parseJsonObject<{ summary?: unknown; keyPoints?: unknown; suggestedAction?: unknown }>(
        result.content,
      )
      if (parsed === null || typeof parsed.summary !== 'string' || parsed.summary.trim() === '') {
        throw new Error('Summary response did not contain a valid summary string')
      }
      const summary: SummaryResult = {
        summary: parsed.summary,
        keyPoints: Array.isArray(parsed.keyPoints)
          ? parsed.keyPoints.filter((point): point is string => typeof point === 'string')
          : [],
        suggestedAction: typeof parsed.suggestedAction === 'string' ? parsed.suggestedAction : '',
        model: result.model,
      }
      this.summaryCacheSet(key, summary)
      return summary
    } catch (err) {
      // Do not cache the failure — a later request retries the summary.
      console.warn(`Summary failed for ${email.id}: ${errorMessage(err)}`)
      return null
    }
  }

  async draftReply(email: EmailLike, tone: Tone): Promise<DraftResult | null> {
    if (!this.isEnabled()) return null
    const key = `draft:${email.id}:${tone}`
    const cached = this.draftCacheGet(key)
    if (cached !== undefined) return cached
    const messages: NimMessage[] = [
      { role: 'system', content: buildDraftSystemPrompt(tone) },
      { role: 'user', content: buildDraftPrompt(email, tone) },
    ]
    try {
      const result = await chat({
        model: this.getActiveModel(),
        messages,
        temperature: 0.4,
        maxTokens: NIM_CONFIG.maxOutputTokens.reply,
      })
      const reply = result.content.trim()
      if (reply === '') throw new Error('Draft response was empty')
      const draft: DraftResult = { reply, model: result.model }
      this.draftCacheSet(key, draft)
      return draft
    } catch (err) {
      // Do not cache the failure — a later request retries the draft.
      console.warn(`Draft failed for ${email.id}: ${errorMessage(err)}`)
      return null
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  // Cached read of src/generated-model.json (written by a separate task).
  // Absent or malformed file → null; the caller falls back to the default model.
  private readGeneratedModel(): { model: string } | null {
    if (this.generatedModel !== undefined) return this.generatedModel
    try {
      const raw = readFileSync(NIM_CONFIG.generatedModelPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      this.generatedModel =
        isRecord(parsed) && typeof parsed['model'] === 'string' ? { model: parsed['model'] } : null
    } catch {
      this.generatedModel = null
    }
    return this.generatedModel
  }

  // Runs scoring in chunks of batchSize, with up to `concurrency` chunks in
  // flight at once. Never throws — per-email failures mark the cache entry.
  private async runImportanceBatches(emails: EmailLike[], accountEmail: string): Promise<void> {
    try {
      const batchSize = Math.max(1, NIM_CONFIG.importance.batchSize)
      const concurrency = Math.max(1, NIM_CONFIG.importance.concurrency)
      const chunks: EmailLike[][] = []
      for (let i = 0; i < emails.length; i += batchSize) {
        chunks.push(emails.slice(i, i + batchSize))
      }
      for (let i = 0; i < chunks.length; i += concurrency) {
        const window = chunks.slice(i, i + concurrency)
        await Promise.all(window.map((chunk) => this.processImportanceBatch(chunk, accountEmail)))
      }
    } catch {
      // Best-effort scoring — never propagate.
    }
  }

  private async processImportanceBatch(emails: EmailLike[], accountEmail: string): Promise<void> {
    await Promise.all(emails.map((email) => this.scoreEmailImportance(email, accountEmail)))
  }

  private async scoreEmailImportance(email: EmailLike, accountEmail: string): Promise<void> {
    const messages: NimMessage[] = [
      { role: 'system', content: IMPORTANCE_SYSTEM_PROMPT },
      { role: 'user', content: buildImportancePrompt(email, accountEmail) },
    ]
    try {
      const result = await chat({
        model: this.getActiveModel(),
        messages,
        temperature: 0,
        maxTokens: NIM_CONFIG.maxOutputTokens.importance,
        responseFormat: { type: 'json_object' },
      })
      const parsed = parseJsonObject<{ score?: unknown; reason?: unknown }>(result.content)
      const llmScore = clampScore(parsed?.score)
      const reason = typeof parsed?.reason === 'string' ? parsed.reason : ''
      const entry = this.importanceCache.get(email.id)
      if (entry !== undefined) {
        entry.result = {
          emailId: email.id,
          llmScore,
          reason,
          isImportant: llmScore >= NIM_CONFIG.importance.threshold,
          model: result.model,
        }
        entry.status = 'done'
      }
    } catch (err) {
      console.warn(`Importance scoring failed for ${email.id}: ${errorMessage(err)}`)
      const entry = this.importanceCache.get(email.id)
      if (entry !== undefined) {
        entry.result = null
        entry.status = 'failed'
      }
    }
  }

  private summaryCacheGet(key: string): SummaryResult | null | undefined {
    const value = this.summaryCache.get(key)
    if (value !== undefined) {
      this.summaryCache.delete(key)
      this.summaryCache.set(key, value)
    }
    return value
  }

  private summaryCacheSet(key: string, value: SummaryResult | null): void {
    this.summaryCache.set(key, value)
    this.trimCache(this.summaryCache)
  }

  private draftCacheGet(key: string): DraftResult | null | undefined {
    const value = this.draftCache.get(key)
    if (value !== undefined) {
      this.draftCache.delete(key)
      this.draftCache.set(key, value)
    }
    return value
  }

  private draftCacheSet(key: string, value: DraftResult | null): void {
    this.draftCache.set(key, value)
    this.trimCache(this.draftCache)
  }

  // Simple LRU: re-touch on read, drop the oldest key once the cap is exceeded.
  private trimCache<K, V>(cache: Map<K, V>): void {
    if (cache.size <= CACHE_CAP) return
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

// Singleton instance for server use.
export const llmService = new LlmService()
