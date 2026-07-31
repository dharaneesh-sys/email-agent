// Server route tests — only routes that avoid real Gmail/LLM network calls:
//   - /api/config and /api/health are public (auth middleware skip list)
//   - the /api/importance/refresh, /api/summary/:id and /api/reply/draft 503
//     paths gate on llmService.isEnabled() BEFORE any Gmail fetch, so they
//     return 503 without touching the network when NIM_CONFIG.apiKey is nulled
// /api/emails and /api/email/:id require real Gmail auth + fetches (no DI seam
// for gmailService), so they are covered by live verification instead.

import { beforeAll, describe, expect, test } from 'bun:test'
import app from './server'
import { EMAIL_ACCOUNTS, NIM_CONFIG } from './config'
import { authManager } from './auth'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function jsonObject(res: Response): Promise<Record<string, unknown>> {
  const body: unknown = await res.json()
  if (!isRecord(body)) throw new Error('Expected a JSON object response')
  return body
}

// The /api/* auth middleware 401s without a valid token. Seed the in-memory
// token map with a long-lived fake token so the LLM routes reach their
// handlers. hasValidToken only checks expiry in memory — no network involved.
// TS `private` is compile-time only; the cast is deliberate and test-only.
beforeAll(() => {
  const tokens = (authManager as unknown as {
    tokens: Map<string, {
      access_token: string
      refresh_token: string | null
      expiry_date: number
      scope: string
      token_type: 'Bearer'
    }>
  }).tokens
  for (const acc of EMAIL_ACCOUNTS) {
    tokens.set(acc.id, {
      access_token: 'test-token',
      refresh_token: null,
      expiry_date: Date.now() + 86_400_000,
      scope: 'gmail',
      token_type: 'Bearer',
    })
  }
})

describe('GET /api/config', () => {
  test('is public (200 without auth) and returns LLM config plus default account', async () => {
    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
    const body = await jsonObject(res)
    expect(typeof body['model']).toBe('string')
    expect(typeof body['llmEnabled']).toBe('boolean')
    expect(typeof body['defaultModel']).toBe('string')
    expect(body['defaultAccount']).toBe(EMAIL_ACCOUNTS[0].id)
  })
})

describe('GET /api/health', () => {
  test('returns 200 without auth', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
  })
})

describe('POST /api/reply/draft validation', () => {
  test('rejects an invalid tone with 400', async () => {
    const res = await app.request('/api/reply/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'abc', tone: 'angry' }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects a missing messageId with 400', async () => {
    const res = await app.request('/api/reply/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tone: 'friendly' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('LLM-disabled paths (NIM_CONFIG.apiKey forced to null)', () => {
  // isEnabled() reads NIM_CONFIG.apiKey at call time (no caching), and the
  // refresh/summary/draft handlers gate on it BEFORE the Gmail fetch, so these
  // tests return 503 with zero network access.
  test('GET /api/summary/:id returns 503 when LLM disabled', async () => {
    const original = NIM_CONFIG.apiKey
    Object.defineProperty(NIM_CONFIG, 'apiKey', { value: null, configurable: true })
    try {
      const res = await app.request('/api/summary/does-not-matter')
      expect(res.status).toBe(503)
      const body = await jsonObject(res)
      expect(body['error']).toBe('LLM disabled')
    } finally {
      Object.defineProperty(NIM_CONFIG, 'apiKey', { value: original, configurable: true })
    }
  })

  test('POST /api/reply/draft returns 503 when LLM disabled', async () => {
    const original = NIM_CONFIG.apiKey
    Object.defineProperty(NIM_CONFIG, 'apiKey', { value: null, configurable: true })
    try {
      const res = await app.request('/api/reply/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: 'xyz', tone: 'professional' }),
      })
      expect(res.status).toBe(503)
      const body = await jsonObject(res)
      expect(body['error']).toBe('LLM disabled')
    } finally {
      Object.defineProperty(NIM_CONFIG, 'apiKey', { value: original, configurable: true })
    }
  })

  test('POST /api/importance/refresh returns 503 when LLM disabled', async () => {
    const original = NIM_CONFIG.apiKey
    Object.defineProperty(NIM_CONFIG, 'apiKey', { value: null, configurable: true })
    try {
      const res = await app.request('/api/importance/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['xyz'] }),
      })
      expect(res.status).toBe(503)
      const body = await jsonObject(res)
      expect(body['error']).toBe('LLM disabled')
    } finally {
      Object.defineProperty(NIM_CONFIG, 'apiKey', { value: original, configurable: true })
    }
  })
})
