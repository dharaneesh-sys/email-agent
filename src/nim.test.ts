import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { NIM_CONFIG } from './config'
import { chat, listModels, NimError, pingModel, setFetchImpl } from './nim'

// ─── Test helpers ───────────────────────────────────────────────────────────

const mockFetch = (handler: (url: string, init: RequestInit) => Promise<Response>) => {
  // Bun's fetch type carries extra members (preconnect), so assert the shape.
  setFetchImpl((async (input: Request | URL | string, init?: RequestInit) =>
    handler(String(input), init ?? {})) as typeof fetch)
}

// chat() reads NIM_CONFIG.apiKey at call time. If the test env has no real
// key, install a fake one so the mocked-fetch tests exercise the HTTP path.
const originalApiKey = NIM_CONFIG.apiKey

beforeAll(() => {
  if (NIM_CONFIG.apiKey === null) {
    Object.defineProperty(NIM_CONFIG, 'apiKey', { value: 'nvapi-test-key', configurable: true })
  }
})

afterAll(() => {
  Object.defineProperty(NIM_CONFIG, 'apiKey', { value: originalApiKey, configurable: true })
})

// Awaits the promise, asserting it rejected with a NimError, then runs checks.
async function expectNimError(promise: Promise<unknown>, check: (err: NimError) => void): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(NimError)
    if (err instanceof NimError) {
      check(err)
      return
    }
  }
  throw new Error('expected chat() to throw a NimError')
}

// ─── chat() ─────────────────────────────────────────────────────────────────

describe('chat', () => {
  test('200: returns parsed content, usage, latency, and the correct request', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> = {}
    mockFetch(async (url, init) => {
      capturedUrl = url
      capturedBody = JSON.parse(String(init.body)) as Record<string, unknown>
      const headers = init.headers as Record<string, string> | undefined
      expect(headers?.['Authorization']).toStartWith('Bearer nvapi-')
      expect(headers?.['Content-Type']).toBe('application/json')
      return new Response(
        JSON.stringify({
          model: 'meta/llama-3.1-8b-instruct',
          choices: [{ message: { content: 'Hello there' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 },
      )
    })

    const result = await chat({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      maxTokens: 32,
    })

    expect(result.content).toBe('Hello there')
    expect(result.model).toBe('meta/llama-3.1-8b-instruct')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
    expect(result.finishedReason).toBe('stop')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)

    expect(capturedUrl).toBe('https://integrate.api.nvidia.com/v1/chat/completions')
    expect(capturedBody['model']).toBe('meta/llama-3.1-8b-instruct')
    expect(capturedBody['messages']).toEqual([{ role: 'user', content: 'Hi' }])
    expect(capturedBody['temperature']).toBe(0.7)
    expect(capturedBody['max_tokens']).toBe(32)
    expect(capturedBody['response_format']).toBeUndefined()
  })

  test('handles missing content and usage fields (defaults to empty string / 0)', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })
    })
    const result = await chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    expect(result.content).toBe('')
    expect(result.finishedReason).toBeNull()
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })
    expect(result.model).toBe('m')
  })

  test('403 with {status:403,title:Forbidden} → NimError, isAuth, not retryable, no retry', async () => {
    let calls = 0
    mockFetch(async () => {
      calls++
      return new Response(JSON.stringify({ status: 403, title: 'Forbidden', type: 'about:blank' }), { status: 403 })
    })
    await expectNimError(chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }), (err) => {
      expect(err.status).toBe(403)
      expect(err.isAuth).toBe(true)
      expect(err.retryable).toBe(false)
      expect(err.message).toBe('Forbidden')
    })
    expect(calls).toBe(1)
  })

  test('404: NimError message prefers body.message over title', async () => {
    mockFetch(async () => {
      return new Response(
        JSON.stringify({ status: 404, title: 'Not Found', message: 'model not found' }),
        { status: 404 },
      )
    })
    await expectNimError(chat({ model: 'nope', messages: [{ role: 'user', content: 'hi' }] }), (err) => {
      expect(err.status).toBe(404)
      expect(err.message).toBe('model not found')
      expect(err.isAuth).toBe(false)
      expect(err.retryable).toBe(false)
    })
  })

  test('429 then success: resolves after exactly 1 retry', async () => {
    let calls = 0
    mockFetch(async () => {
      calls++
      if (calls === 1) {
        return new Response(JSON.stringify({ status: 429, title: 'Too Many Requests' }), { status: 429 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    })
    const result = await chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    expect(result.content).toBe('ok')
    expect(calls).toBe(2)
  })

  test('429 with Retry-After: surfaces the wait on the thrown error', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ status: 429, title: 'Too Many Requests' }), {
        status: 429,
        headers: { 'retry-after': '1' },
      })
    )
    await expectNimError(chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }), (err) => {
      expect(err.status).toBe(429)
      expect(err.retryable).toBe(true)
      expect(err.retryAfterMs).toBe(1000)
    })
  })

  test('500 three times: throws NimError after 2 retries (3 calls), retryable', async () => {
    let calls = 0
    mockFetch(async () => {
      calls++
      return new Response(JSON.stringify({ status: 500, title: 'Internal', message: 'boom' }), { status: 500 })
    })
    await expectNimError(chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }), (err) => {
      expect(err.status).toBe(500)
      expect(err.retryable).toBe(true)
      expect(err.message).toBe('boom')
    })
    expect(calls).toBe(3)
  })

  test('network TypeError: retried, then throws after maxRetries', async () => {
    let calls = 0
    mockFetch(async () => {
      calls++
      throw new TypeError('fetch failed')
    })
    await expectNimError(chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }), (err) => {
      expect(err.status).toBe(0)
      expect(err.retryable).toBe(true)
      expect(err.message).toContain('fetch failed')
    })
    expect(calls).toBe(3)
  })

  test('non-retryable 4xx is not retried', async () => {
    let calls = 0
    mockFetch(async () => {
      calls++
      return new Response(JSON.stringify({ status: 400, title: 'Bad Request' }), { status: 400 })
    })
    await expectNimError(chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }), (err) => {
      expect(err.status).toBe(400)
      expect(err.retryable).toBe(false)
    })
    expect(calls).toBe(1)
  })

  test('response_format is passed through to the request body', async () => {
    let sentFormat: unknown
    mockFetch(async (_url, init) => {
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>
      sentFormat = sent['response_format']
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 })
    })
    await chat({
      model: 'm',
      messages: [{ role: 'user', content: 'return json' }],
      responseFormat: { type: 'json_object' },
    })
    expect(sentFormat).toEqual({ type: 'json_object' })
  })

  test('no API key: throws NimError status 0, non-retryable, fetch never called', async () => {
    const current = NIM_CONFIG.apiKey
    let fetchCalled = false
    mockFetch(async () => {
      fetchCalled = true
      return new Response('{}', { status: 200 })
    })
    try {
      Object.defineProperty(NIM_CONFIG, 'apiKey', { value: null, configurable: true })
      await expectNimError(chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }), (err) => {
        expect(err.status).toBe(0)
        expect(err.retryable).toBe(false)
        expect(err.isAuth).toBe(false)
        expect(err.message).toBe('NVIDIA NIM API key not configured')
      })
    } finally {
      Object.defineProperty(NIM_CONFIG, 'apiKey', { value: current, configurable: true })
    }
    expect(fetchCalled).toBe(false)
  })
})

// ─── pingModel() / listModels() ─────────────────────────────────────────────

describe('pingModel', () => {
  test('returns ok:true with latency on 200', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }), { status: 200 })
    })
    const result = await pingModel('m')
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.error).toBeUndefined()
  })

  test('returns ok:false with error message on failure (never throws)', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ status: 403, message: 'Access denied' }), { status: 403 })
    })
    const result = await pingModel('m')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Access denied')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
})

describe('listModels', () => {
  test('returns model ids from the data array', async () => {
    mockFetch(async (url) => {
      expect(url).toBe('https://integrate.api.nvidia.com/v1/models')
      return new Response(JSON.stringify({ data: [{ id: 'a/b' }, { id: 'c/d' }] }), { status: 200 })
    })
    expect(await listModels()).toEqual(['a/b', 'c/d'])
  })

  test('returns [] on failure, never throws', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ status: 500, title: 'boom' }), { status: 500 })
    })
    expect(await listModels()).toEqual([])
  })
})
