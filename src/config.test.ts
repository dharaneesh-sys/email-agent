import { describe, expect, test } from 'bun:test'
import { extractNimApiKey, NIM_CONFIG } from './config'

// Mirrors the real .env shape: profile -> array of keys, "nvidia" first.
const failoverKeys = JSON.stringify({
  nvidia: ['nvapi-aaa', 'nvapi-bbb'],
  'nvidia-premium': ['nvapi-ccc', 'nvapi-ddd'],
  'openai-fallback': ['sk-proj-xxx'],
})

describe('extractNimApiKey', () => {
  test('returns the first nvapi- key from a JSON-shaped OPENCODE_FAILOVER_KEYS', () => {
    const env = { OPENCODE_FAILOVER_KEYS: failoverKeys }
    expect(extractNimApiKey(env)).toBe('nvapi-aaa')
  })

  test('keeps walking profiles in document order until an nvapi- key is found', () => {
    const env = {
      OPENCODE_FAILOVER_KEYS: JSON.stringify({
        other: ['sk-xxx', 'sk-yyy'],
        nvidia: ['nvapi-bbb'],
      }),
    }
    expect(extractNimApiKey(env)).toBe('nvapi-bbb')
  })

  test('NVIDIA_NIM_API_KEY takes precedence over OPENCODE_FAILOVER_KEYS', () => {
    const env = { NVIDIA_NIM_API_KEY: 'nvapi-zzz', OPENCODE_FAILOVER_KEYS: failoverKeys }
    expect(extractNimApiKey(env)).toBe('nvapi-zzz')
  })

  test('ignores an empty NVIDIA_NIM_API_KEY and falls through to failover keys', () => {
    const env = { NVIDIA_NIM_API_KEY: '  ', OPENCODE_FAILOVER_KEYS: failoverKeys }
    expect(extractNimApiKey(env)).toBe('nvapi-aaa')
  })

  test('falls back to regex when JSON.parse fails on a malformed payload', () => {
    const malformed = '{"nvidia":["nvapi-aaa","nvapi-bbb",]'
    expect(extractNimApiKey({ OPENCODE_FAILOVER_KEYS: malformed })).toBe('nvapi-aaa')
  })

  test('regex fallback works on non-JSON payloads', () => {
    const env = { OPENCODE_FAILOVER_KEYS: 'nvidia=["nvapi-aaa"] trailing garbage' }
    expect(extractNimApiKey(env)).toBe('nvapi-aaa')
  })

  test('returns null when no key source exists', () => {
    expect(extractNimApiKey({})).toBeNull()
    expect(extractNimApiKey({ OPENCODE_FAILOVER_KEYS: 'no keys here' })).toBeNull()
    expect(extractNimApiKey({ NVIDIA_NIM_API_KEY: ' ' })).toBeNull()
  })

  test('returns null when JSON parses but contains no nvapi- key', () => {
    const env = { OPENCODE_FAILOVER_KEYS: JSON.stringify({ openai: ['sk-xxx'] }) }
    expect(extractNimApiKey(env)).toBeNull()
  })
})

describe('NIM_CONFIG', () => {
  test('has sensible defaults', () => {
    expect(NIM_CONFIG.baseUrl).toBe('https://integrate.api.nvidia.com/v1')
    expect(NIM_CONFIG.defaultModel).toBe('meta/llama-3.1-70b-instruct')
    expect(NIM_CONFIG.modelEnvOverride).toBeNull()
    expect(NIM_CONFIG.timeoutMs).toBe(90000)
    expect(NIM_CONFIG.maxRetries).toBe(2)
    expect(NIM_CONFIG.maxOutputTokens).toEqual({ importance: 128, summary: 512, reply: 1024 })
    expect(NIM_CONFIG.importance).toEqual({ batchSize: 5, maxPerSync: 25, threshold: 60, concurrency: 2 })
    expect(NIM_CONFIG.generatedModelPath.endsWith('src/generated-model.json')).toBe(true)
    expect(NIM_CONFIG.apiKey === null || NIM_CONFIG.apiKey.startsWith('nvapi-')).toBe(true)
  })
})
