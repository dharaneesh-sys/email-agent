// NVIDIA NIM chat client
// OpenAI-compatible chat completions against https://integrate.api.nvidia.com/v1
// Runtime deps: none — plain Bun fetch with a test-only injection seam.

import { NIM_CONFIG } from './config'

// Models verified to work with the project's NVIDIA API key (23 total).
export const NIM_WORKING_MODELS: readonly string[] = [
  'deepseek-ai/deepseek-v4-pro',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-1b-instruct',
  'meta/llama-3.2-3b-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'mistralai/mistral-nemotron',
  'nvidia/ising-calibration-1.5-31b',
  'nvidia/llama-3.1-nemoguard-8b-content-safety',
  'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
  'nvidia/llama-3.1-nemotron-safety-guard-8b-v3',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/nemotron-3.5-content-safety',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-mini-4b-instruct',
  'nvidia/nemotron-nano-12b-v2-vl',
  'nvidia/riva-translate-4b-instruct-v1.1',
  'nvidia/riva-translate-4b-instruct-v2',
  'poolside/laguna-xs-2.1',
]

// Subset of NIM_WORKING_MODELS suited to email summarization/reply tasks.
export const NIM_EMAIL_CANDIDATES: readonly string[] = [
  'deepseek-ai/deepseek-v4-pro',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.2-3b-instruct',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-mini-4b-instruct',
]

export interface NimMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface NimChatParams {
  model: string
  messages: NimMessage[]
  temperature?: number
  maxTokens?: number
  responseFormat?: { type: 'json_object' }
  timeoutMs?: number
  signal?: AbortSignal
}

export interface NimChatResult {
  content: string
  model: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs: number
  finishedReason: string | null
}

export class NimError extends Error {
  status: number
  body: unknown
  retryable: boolean
  isAuth: boolean
  retryAfterMs: number | null

  constructor(status: number, body: unknown, message: string, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'NimError'
    this.status = status
    this.body = body
    this.isAuth = status === 401 || status === 403
    this.retryable = status === 408 || status === 429 || status >= 500
    this.retryAfterMs = retryAfterMs
  }
}

// Test-only injection seam; the production default is Bun's native fetch.
let fetchImpl: typeof fetch = fetch

export function setFetchImpl(fn: typeof fetch): void {
  fetchImpl = fn
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// NIM error bodies are NOT OpenAI-shaped: {"status":403,"title":"Forbidden",
// "message":"...","type":"..."} — prefer `message`, fall back to `title`.
function errorMessageFromBody(body: unknown, status: number): string {
  if (isRecord(body)) {
    if (typeof body['message'] === 'string') return body['message']
    if (typeof body['title'] === 'string') return body['title']
  }
  return `NIM request failed (${status})`
}

async function nimErrorFromResponse(response: Response): Promise<NimError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON error body — the generic fallback message covers it.
  }
  const retryAfter = response.headers.get('retry-after')
  const retryAfterMs = retryAfter !== null ? Math.max(0, Number(retryAfter)) * 1000 : null
  return new NimError(response.status, body, errorMessageFromBody(body, response.status), retryAfterMs)
}

// Network failures are transient in nature → retryable. Aborts (user signal or
// timeout) are NOT — never retry a cancelled request.
function toNimError(err: unknown): NimError {
  if (err instanceof NimError) return err
  if (err instanceof TypeError) {
    const wrapped = new NimError(0, err, `NIM request failed: ${err.message}`)
    wrapped.retryable = true
    return wrapped
  }
  if (err instanceof Error) {
    return new NimError(0, err, `NIM request failed: ${err.message}`)
  }
  return new NimError(0, err, 'NIM request failed')
}

// ─── Response parsing (OpenAI-compatible shape) ────────────────────────────

interface ChatCompletionBody {
  model?: string
  choices?: Array<{
    message?: { content?: string | null }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

function isChatCompletionBody(value: unknown): value is ChatCompletionBody {
  if (!isRecord(value)) return false
  if (value['choices'] !== undefined && !Array.isArray(value['choices'])) return false
  if (value['model'] !== undefined && typeof value['model'] !== 'string') return false
  return true
}

async function parseChatResult(response: Response, requestedModel: string, latencyMs: number): Promise<NimChatResult> {
  const body: unknown = await response.json()
  if (!isChatCompletionBody(body)) {
    throw new NimError(response.status, body, `NIM returned an unexpected response shape (${response.status})`)
  }
  const firstChoice = body.choices?.[0]
  const rawContent = firstChoice?.message?.content
  return {
    content: typeof rawContent === 'string' ? rawContent : '',
    model: body.model ?? requestedModel,
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      totalTokens: body.usage?.total_tokens ?? 0,
    },
    latencyMs,
    finishedReason: firstChoice?.finish_reason ?? null,
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function chat(params: NimChatParams): Promise<NimChatResult> {
  const apiKey = NIM_CONFIG.apiKey
  if (!apiKey) {
    throw new NimError(0, null, 'NVIDIA NIM API key not configured')
  }

  const maxRetries = NIM_CONFIG.maxRetries
  const url = `${NIM_CONFIG.baseUrl}/chat/completions`
  const timeoutMs = params.timeoutMs ?? NIM_CONFIG.timeoutMs

  // Omit undefined keys — the API must not receive explicit nulls.
  const requestBody: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
  }
  if (params.temperature !== undefined) requestBody['temperature'] = params.temperature
  if (params.maxTokens !== undefined) requestBody['max_tokens'] = params.maxTokens
  if (params.responseFormat !== undefined) requestBody['response_format'] = params.responseFormat

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  // attempts = 1 + maxRetries (3 total); backoff 500ms * 2^attempt, or the
  // server's Retry-After header when rate-limited (429).
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptStart = Date.now()
    let nimError: NimError
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const signal = params.signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, params.signal])
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal,
      })
      if (response.ok) {
        // Latency covers only this request — retry waits are excluded.
        return await parseChatResult(response, params.model, Date.now() - attemptStart)
      }
      nimError = await nimErrorFromResponse(response)
    } catch (err) {
      nimError = toNimError(err)
    }
    if (!nimError.retryable || attempt === maxRetries) throw nimError
    const wait = nimError.retryAfterMs ?? 500 * 2 ** attempt
    await sleep(Math.min(wait, 30_000))
  }
  throw new NimError(0, null, 'NIM request failed') // unreachable — loop always returns or throws
}

export async function listModels(): Promise<string[]> {
  if (!NIM_CONFIG.apiKey) return []
  try {
    const response = await fetchImpl(`${NIM_CONFIG.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${NIM_CONFIG.apiKey}` },
      signal: AbortSignal.timeout(NIM_CONFIG.timeoutMs),
    })
    if (!response.ok) return []
    const body: unknown = await response.json()
    if (!isRecord(body) || !Array.isArray(body['data'])) return []
    const ids: string[] = []
    for (const item of body['data']) {
      if (isRecord(item) && typeof item['id'] === 'string') ids.push(item['id'])
    }
    return ids
  } catch {
    return [] // never throw — callers treat an empty list as "unavailable"
  }
}

export async function pingModel(model: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now()
  try {
    await chat({ model, messages: [{ role: 'user', content: 'ping' }], maxTokens: 5, temperature: 0 })
    return { ok: true, latencyMs: Date.now() - startedAt }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, latencyMs: Date.now() - startedAt, error: message }
  }
}
