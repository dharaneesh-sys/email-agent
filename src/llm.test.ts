// LLM service tests — all network calls are mocked via nim's setFetchImpl.
// MODEL_ID must be set BEFORE ./llm is imported: NIM_CONFIG is computed at
// module load, and the env override is captured from it. So ./llm, ./nim and
// ./config are loaded with dynamic imports AFTER the env assignment below
// (static imports would evaluate config.ts first with the env unset).

process.env['MODEL_ID'] = 'test-model'

import { describe, expect, test } from 'bun:test'
import type { EmailLike } from './llm'

const {
  LlmService,
  parseJsonObject,
  buildImportancePrompt,
  buildSummaryPrompt,
  buildDraftPrompt,
  llmService,
} = await import('./llm')
const { setFetchImpl } = await import('./nim')
const { NIM_CONFIG } = await import('./config')

// ─── Test helpers ────────────────────────────────────────────────────────────

interface CapturedRequest {
  model: string
  messages: { role: string; content: string }[]
  raw: Record<string, unknown>
}

let capturedRequests: CapturedRequest[] = []

// Mocks global fetch: captures the outgoing request and answers with an
// OpenAI-shaped chat completion whose content is the responder's return value
// (a plain string, or a full Response for error simulations).
function mockChat(responder: (req: CapturedRequest) => unknown): void {
  capturedRequests = []
  setFetchImpl((async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    const messages = Array.isArray(body['messages']) ? (body['messages'] as { role: string; content: string }[]) : []
    const req: CapturedRequest = {
      model: typeof body['model'] === 'string' ? body['model'] : '',
      messages,
      raw: body,
    }
    capturedRequests.push(req)
    const reply = responder(req)
    if (reply instanceof Response) return reply
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: String(reply) } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        model: req.model,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch)
}

function makeEmail(overrides: Partial<EmailLike> = {}): EmailLike {
  return {
    id: overrides.id ?? 'msg-1',
    from: overrides.from ?? 'alice@example.com',
    to: overrides.to ?? 'me@example.com',
    subject: overrides.subject ?? 'Project update',
    snippet: overrides.snippet ?? 'The deployment is ready for review.',
    date: overrides.date ?? '2026-07-30T10:00:00Z',
    ...(overrides.isImportant === undefined ? {} : { isImportant: overrides.isImportant }),
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

// ─── parseJsonObject ─────────────────────────────────────────────────────────

describe('parseJsonObject', () => {
  test('parses plain JSON', () => {
    expect(parseJsonObject<{ a: number }>('{"a": 1}')).toEqual({ a: 1 })
  })

  test('parses JSON inside a ```json fence', () => {
    expect(parseJsonObject<{ a: number }>('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
  })

  test('parses JSON inside a bare ``` fence', () => {
    expect(parseJsonObject<{ a: number }>('```\n{"a": 1}\n```')).toEqual({ a: 1 })
  })

  test('extracts JSON from text with trailing prose', () => {
    const text = 'Here is the result: {"score": 80, "reason": "urgent"} Thanks!'
    expect(parseJsonObject<{ score: number }>(text)).toMatchObject({ score: 80 })
  })

  test('extracts balanced JSON when braces appear inside strings', () => {
    const text = 'prefix {"a": "}", "b": [1, 2]} suffix'
    expect(parseJsonObject<{ a: string; b: number[] }>(text)).toEqual({ a: '}', b: [1, 2] })
  })

  test('parses top-level arrays', () => {
    expect(parseJsonObject<number[]>('[1, 2, 3]')).toEqual([1, 2, 3])
  })

  test('returns null for invalid text', () => {
    expect(parseJsonObject('not json at all')).toBeNull()
    expect(parseJsonObject('{invalid')).toBeNull()
    expect(parseJsonObject('{"a": } garbage')).toBeNull()
  })

  test('returns null for empty or whitespace-only input', () => {
    expect(parseJsonObject('')).toBeNull()
    expect(parseJsonObject('   \n  ')).toBeNull()
  })
})

// ─── Prompt builders ─────────────────────────────────────────────────────────

describe('prompt builders', () => {
  const email = makeEmail({ subject: 'Quarterly report', from: 'boss@example.com' })

  test('buildImportancePrompt includes sender, subject, body, and account email', () => {
    const prompt = buildImportancePrompt(email, 'me@example.com')
    expect(prompt).toContain('boss@example.com')
    expect(prompt).toContain('Quarterly report')
    expect(prompt).toContain('The deployment is ready for review.')
    expect(prompt).toContain('me@example.com')
  })

  test('buildSummaryPrompt includes sender and subject', () => {
    const prompt = buildSummaryPrompt(email)
    expect(prompt).toContain('boss@example.com')
    expect(prompt).toContain('Quarterly report')
  })

  test('buildDraftPrompt includes subject and the tone', () => {
    const prompt = buildDraftPrompt(email, 'professional')
    expect(prompt).toContain('Quarterly report')
    expect(prompt).toContain('professional')
  })
})

// ─── Model selection ─────────────────────────────────────────────────────────

describe('LlmService model selection', () => {
  test('getActiveModel prefers the MODEL_ID env override', () => {
    expect(llmService.getActiveModel()).toBe('test-model')
    expect(new LlmService().getActiveModel()).toBe('test-model')
  })

  test('getActiveModelInfo reports the active model and defaults', () => {
    const info = llmService.getActiveModelInfo()
    expect(info.model).toBe('test-model')
    expect(info.defaultModel).toBe(NIM_CONFIG.defaultModel)
    expect(info.llmEnabled).toBe(llmService.isEnabled())
  })
})

// ─── Disabled service ────────────────────────────────────────────────────────

describe('disabled service (no API key)', () => {
  test('isEnabled is false and LLM calls short-circuit without fetching', async () => {
    const original = NIM_CONFIG.apiKey
    mockChat(() => 'should never be called')
    Object.defineProperty(NIM_CONFIG, 'apiKey', { value: null, configurable: true })
    try {
      const service = new LlmService()
      expect(service.isEnabled()).toBe(false)
      expect(await service.summarize(makeEmail())).toBeNull()
      expect(await service.draftReply(makeEmail(), 'professional')).toBeNull()
      service.enqueueImportance([makeEmail()], 'me@example.com')
      expect(capturedRequests.length).toBe(0)
    } finally {
      Object.defineProperty(NIM_CONFIG, 'apiKey', { value: original, configurable: true })
    }
  })
})

// ─── enqueueImportance ───────────────────────────────────────────────────────

describe('enqueueImportance', () => {
  test('scores emails in the background and dedupes repeated enqueues', async () => {
    const service = new LlmService()
    mockChat((req) => {
      const user = req.messages[1]?.content ?? ''
      const score = user.includes('Important news') ? 80 : 30
      return JSON.stringify({ score, reason: 'test reason' })
    })
    const important = makeEmail({ id: 'e-imp', subject: 'Important news' })
    const digest = makeEmail({ id: 'e-dig', subject: 'Weekly digest' })

    service.enqueueImportance([important, digest], 'me@example.com')
    await waitFor(() => service.getImportance('e-imp') !== null && service.getImportance('e-dig') !== null)

    const imp = service.getImportance('e-imp')
    expect(imp?.llmScore).toBe(80)
    expect(imp?.reason).toBe('test reason')
    expect(imp?.isImportant).toBe(true)
    expect(imp?.emailId).toBe('e-imp')
    expect(imp?.model).toBe('test-model')
    expect(service.getImportance('e-dig')?.llmScore).toBe(30)
    expect(service.getImportance('e-dig')?.isImportant).toBe(false)

    service.enqueueImportance([important], 'me@example.com')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(capturedRequests.length).toBe(2)
  })

  test('only processes the first maxPerSync new emails', async () => {
    const service = new LlmService()
    mockChat(() => JSON.stringify({ score: 70, reason: 'bulk' }))
    const emails: EmailLike[] = []
    for (let i = 0; i < NIM_CONFIG.importance.maxPerSync + 5; i++) {
      emails.push(makeEmail({ id: `bulk-${i}`, subject: `Bulk ${i}` }))
    }

    service.enqueueImportance(emails, 'me@example.com')
    await waitFor(() => capturedRequests.length >= NIM_CONFIG.importance.maxPerSync)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(capturedRequests.length).toBe(NIM_CONFIG.importance.maxPerSync)
    expect(service.getImportance(`bulk-${NIM_CONFIG.importance.maxPerSync}`)).toBeNull()
  })
})

// ─── ensureImportance ────────────────────────────────────────────────────────

describe('ensureImportance', () => {
  test('returns scored results and reuses the cache on repeat calls', async () => {
    const service = new LlmService()
    mockChat(() => JSON.stringify({ score: 90, reason: 'deadline' }))
    const email = makeEmail({ id: 'e-ens' })

    const first = await service.ensureImportance([email], 'me@example.com')
    expect(first.size).toBe(1)
    expect(first.get('e-ens')?.llmScore).toBe(90)
    expect(first.get('e-ens')?.isImportant).toBe(true)
    expect(capturedRequests.length).toBe(1)

    const second = await service.ensureImportance([email], 'me@example.com')
    expect(second.get('e-ens')?.llmScore).toBe(90)
    expect(capturedRequests.length).toBe(1)
  })

  test('does not throw when scoring fails', async () => {
    const service = new LlmService()
    mockChat(() => new Response(JSON.stringify({ status: 403, title: 'Forbidden' }), { status: 403 }))
    const email = makeEmail({ id: 'e-fail' })

    const result = await service.ensureImportance([email], 'me@example.com')
    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
    expect(service.getImportance('e-fail')).toBeNull()
  })
})

// ─── summarize ───────────────────────────────────────────────────────────────

describe('summarize', () => {
  test('returns a parsed summary and requests JSON output from the active model', async () => {
    const service = new LlmService()
    mockChat(() =>
      JSON.stringify({
        summary: 'A clear summary.',
        keyPoints: ['Point A', 'Point B'],
        suggestedAction: 'Reply by Friday',
      }),
    )
    const email = makeEmail({ id: 'e-sum' })

    const result = await service.summarize(email)
    expect(result?.summary).toBe('A clear summary.')
    expect(result?.keyPoints).toEqual(['Point A', 'Point B'])
    expect(result?.suggestedAction).toBe('Reply by Friday')
    expect(result?.model).toBe('test-model')
    expect(capturedRequests.length).toBe(1)
    expect(capturedRequests[0]?.model).toBe('test-model')
    expect(capturedRequests[0]?.raw['response_format']).toEqual({ type: 'json_object' })
  })

  test('caches summaries per email id', async () => {
    const service = new LlmService()
    mockChat(() => JSON.stringify({ summary: 'Cached summary.', keyPoints: [], suggestedAction: '' }))
    const email = makeEmail({ id: 'e-sum-cache' })

    expect((await service.summarize(email))?.summary).toBe('Cached summary.')
    expect((await service.summarize(email))?.summary).toBe('Cached summary.')
    expect(capturedRequests.length).toBe(1)
  })

  test('returns null when the API fails', async () => {
    const service = new LlmService()
    mockChat(() => new Response(JSON.stringify({ status: 403, title: 'Forbidden' }), { status: 403 }))
    expect(await service.summarize(makeEmail({ id: 'e-sum-fail' }))).toBeNull()
  })
})

// ─── draftReply ──────────────────────────────────────────────────────────────

describe('draftReply', () => {
  test('returns a trimmed reply, includes the tone, and omits response_format', async () => {
    const service = new LlmService()
    mockChat(() => '  Thanks for the update.  ')
    const email = makeEmail({ id: 'e-draft' })

    const result = await service.draftReply(email, 'professional')
    expect(result?.reply).toBe('Thanks for the update.')
    expect(result?.model).toBe('test-model')
    const body = capturedRequests[0]
    const allText = (body?.messages ?? []).map((m) => m.content).join('\n')
    expect(allText).toContain('professional')
    expect(body?.raw['response_format']).toBeUndefined()
  })

  test('caches drafts per email and tone', async () => {
    const service = new LlmService()
    mockChat(() => 'Draft body.')
    const email = makeEmail({ id: 'e-draft-cache' })

    expect((await service.draftReply(email, 'concise'))?.reply).toBe('Draft body.')
    expect((await service.draftReply(email, 'concise'))?.reply).toBe('Draft body.')
    expect(capturedRequests.length).toBe(1)
    await service.draftReply(email, 'friendly')
    expect(capturedRequests.length).toBe(2)
  })
})
