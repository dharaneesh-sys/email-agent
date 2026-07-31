import { afterAll, describe, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import {
  aggregateJudgeOutput,
  buildDraftPrompt,
  buildImportancePrompt,
  buildSummaryPrompt,
  computeCompositeScore,
  CORPUS,
  extractBalancedJson,
  loadGeneratedModel,
  minMaxNormalize,
  pool,
  writeGeneratedModel,
} from './benchmark-lib'
import type { GeneratedModelFile } from './benchmark-lib'

describe('computeCompositeScore', () => {
  test('all 100s → 100', () => {
    expect(computeCompositeScore(100, 100, 100)).toBe(100)
  })

  test('quality 0, speed 100, cost 100 → 40', () => {
    expect(computeCompositeScore(0, 100, 100)).toBe(40)
  })

  test('quality 100, speed 0, cost 100 → 75', () => {
    expect(computeCompositeScore(100, 0, 100)).toBe(75)
  })
})

describe('minMaxNormalize', () => {
  test('scales extremes to 0 and 100, mid value proportionally', () => {
    const out = minMaxNormalize({ a: 10, b: 20, c: 30 })
    expect(out["a"]).toBe(0)
    expect(out["b"]).toBe(50)
    expect(out["c"]).toBe(100)
  })

  test('all-equal values → 100 for every entry', () => {
    const out = minMaxNormalize({ a: 5, b: 5, c: 5 })
    expect(out["a"]).toBe(100)
    expect(out["b"]).toBe(100)
    expect(out["c"]).toBe(100)
  })

  test('non-finite entries stay as-is', () => {
    const out = minMaxNormalize({ a: 10, b: 20, c: NaN })
    expect(out["a"]).toBe(0)
    expect(out["b"]).toBe(100)
    expect(Number.isNaN(out["c"])).toBe(true)
  })

  test('empty record → empty record', () => {
    expect(minMaxNormalize({})).toEqual({})
  })
})

describe('extractBalancedJson', () => {
  test('parses a bare object with trailing noise', () => {
    const parsed = extractBalancedJson('Sure! {"score": 85, "reason": "ok"}\nthanks!')
    expect(parsed).toEqual({ score: 85, reason: 'ok' })
  })

  test('parses an array embedded in prose', () => {
    const parsed = extractBalancedJson('Here: [10, 20, 30] and done')
    expect(parsed).toEqual([10, 20, 30])
  })

  test('returns null when no JSON exists', () => {
    expect(extractBalancedJson('this is not json at all')).toBeNull()
  })
})

describe('aggregateJudgeOutput', () => {
  test('parses a clean JSON array', () => {
    const out = aggregateJudgeOutput('[90, 80, 70]', 3)
    expect(out.quality).toBe(80)
    expect(out.perItem).toEqual([90, 80, 70])
  })

  test('parses a fenced {"scores": [...]} block', () => {
    const out = aggregateJudgeOutput('```json\n{"scores": [10, 20]}\n```', 2)
    expect(out.quality).toBe(15)
    expect(out.perItem).toEqual([10, 20])
  })

  test('prefers an explicit quality field over perItem', () => {
    const out = aggregateJudgeOutput('{"quality": 85, "perItem": [70, 90, 80]}', 3)
    expect(out.quality).toBe(85)
    expect(out.perItem).toEqual([70, 90, 80])
  })

  test('pads missing per-item scores with null', () => {
    const out = aggregateJudgeOutput('[90]', 3)
    expect(out.quality).toBe(90)
    expect(out.perItem).toEqual([90, null, null])
  })

  test('clamps out-of-range scores to 0-100', () => {
    const out = aggregateJudgeOutput('[150, -10, 50]', 3)
    expect(out.perItem).toEqual([100, 0, 50])
    expect(out.quality).toBe(50)
  })

  test('ignores prose around a valid array', () => {
    const out = aggregateJudgeOutput('My assessment:\n[85, 60, 90]\nHope this helps.', 3)
    expect(out.quality).toBe(235 / 3)
    expect(out.perItem).toEqual([85, 60, 90])
  })

  test('malformed input → fallback 60 with empty perItem', () => {
    const out = aggregateJudgeOutput('this is not json at all', 3)
    expect(out.quality).toBe(60)
    expect(out.perItem).toEqual([])
  })
})

const TEST_PATH = `/tmp/opencode/benchmark-lib-test-${process.pid}.json`

describe('writeGeneratedModel / loadGeneratedModel', () => {
  afterAll(() => {
    rmSync(TEST_PATH, { force: true })
  })

  test('round-trips a winner file', () => {
    const file: GeneratedModelFile = {
      model: 'meta/llama-3.1-8b-instruct',
      selectedAt: '2026-07-31T00:00:00.000Z',
      scores: {
        'meta/llama-3.1-8b-instruct': { quality: 80.5, speed: 90, cost: 60, total: 79.8 },
      },
      notes: 'test run',
    }
    writeGeneratedModel(TEST_PATH, file)
    expect(loadGeneratedModel(TEST_PATH)).toEqual(file)
  })

  test('returns null for a missing file', () => {
    expect(loadGeneratedModel(`/tmp/opencode/does-not-exist-${process.pid}.json`)).toBeNull()
  })

  test('returns null for malformed JSON', () => {
    const bad = `/tmp/opencode/benchmark-lib-bad-${process.pid}.json`
    writeFileSync(bad, '{not json')
    expect(loadGeneratedModel(bad)).toBeNull()
    rmSync(bad, { force: true })
  })

  test('returns null for valid JSON with the wrong shape', () => {
    const bad = `/tmp/opencode/benchmark-lib-shape-${process.pid}.json`
    writeFileSync(bad, JSON.stringify({ hello: 'world' }))
    expect(loadGeneratedModel(bad)).toBeNull()
    rmSync(bad, { force: true })
  })
})

describe('pool', () => {
  test('runs all items and preserves input order', async () => {
    const out = await pool([1, 2, 3, 4], async (n) => {
      await Bun.sleep(5 * (4 - n))
      return n * 10
    }, 2)
    expect(out).toEqual([10, 20, 30, 40])
  })

  test('empty items → empty result', async () => {
    expect(await pool([], async (n: number) => n, 2)).toEqual([])
  })

  test('never exceeds the concurrency limit', async () => {
    let active = 0
    let peak = 0
    await pool([1, 2, 3, 4, 5, 6], async () => {
      active++
      peak = Math.max(peak, active)
      await Bun.sleep(10)
      active--
    }, 3)
    expect(peak).toBe(3)
  })
})

describe('prompt builders', () => {
  test('importance prompt asks for a JSON score and embeds the email', () => {
    const prompt = buildImportancePrompt(CORPUS[0]!, 'you@acmecorp.com')
    expect(prompt).toContain('"score"')
    expect(prompt).toContain('you@acmecorp.com')
    expect(prompt).toContain('urgent')
  })

  test('summary prompt asks for the JSON key contract', () => {
    const prompt = buildSummaryPrompt(CORPUS[1]!)
    expect(prompt).toContain('"summary"')
    expect(prompt).toContain('"keyPoints"')
    expect(prompt).toContain('"suggestedAction"')
  })

  test('draft prompt embeds the tone and the email subject', () => {
    const prompt = buildDraftPrompt(CORPUS[2]!, 'professional and concise')
    expect(prompt).toContain('professional and concise')
    expect(prompt).toContain(CORPUS[2]!.subject)
  })
})
