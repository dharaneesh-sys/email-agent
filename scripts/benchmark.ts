#!/usr/bin/env bun
// Live NIM model benchmark for email tasks (importance / summary / reply).
// Usage: bun run scripts/benchmark.ts [--quick] [--models=a,b,c] [--skip-judge] [--out=<path>]
//
// Selects the best candidate from NIM_EMAIL_CANDIDATES by a weighted
// composite of judged quality (0.6), speed (0.25) and cost (0.15), and
// writes the winner to src/generated-model.json (or --out).

import {
  aggregateJudgeOutput,
  buildDraftPrompt,
  buildImportancePrompt,
  buildSummaryPrompt,
  computeCompositeScore,
  CORPUS,
  extractBalancedJson,
  minMaxNormalize,
  pool,
  writeGeneratedModel,
} from './benchmark-lib'
import type { EvalResult, GeneratedModelFile, SampleEmail } from './benchmark-lib'
import { chat, NimError, NIM_EMAIL_CANDIDATES, NIM_WORKING_MODELS, pingModel } from '../src/nim'
import type { NimChatParams, NimChatResult, NimMessage } from '../src/nim'
import { NIM_CONFIG } from '../src/config'

type TaskKind = 'importance' | 'summary' | 'reply'

const JUDGE_MODEL = 'deepseek-ai/deepseek-v4-pro'

const SYSTEM_PROMPTS: Record<TaskKind, string> = {
  importance: 'You are an email triage assistant that rates how important an email is. Output only JSON.',
  summary: 'You are an email assistant that produces concise, accurate summaries. Output only JSON.',
  reply: 'You are a professional email assistant that writes clear, concise replies.',
}

const KIND_INSTRUCTIONS: Record<TaskKind, string> = {
  importance: 'The task was to rate email importance (0-100). Evaluate how accurate each score is given the email content.',
  summary: 'The task was to produce a JSON summary with summary, keyPoints, and suggestedAction. Evaluate how useful, accurate, and complete each summary is.',
  reply: 'The task was to write a professional, concise reply to the email. Evaluate how appropriate, clear, and helpful each reply is.',
}

interface CliOptions {
  quick: boolean
  models: string[] | null
  skipJudge: boolean
  out: string
}

interface TaskSpec {
  kind: TaskKind
  email: SampleEmail
}

interface TaskOutput {
  kind: TaskKind
  emailId: string
  content: string
  latencyMs: number
  tokens: number
}

interface ModelEval {
  model: string
  outputs: TaskOutput[]
  failures: number
}

interface JudgeGroup {
  model: string
  kind: TaskKind
  emails: readonly SampleEmail[]
  outputs: TaskOutput[]
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { quick: false, models: null, skipJudge: false, out: NIM_CONFIG.generatedModelPath }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--quick') opts.quick = true
    else if (arg === '--skip-judge') opts.skipJudge = true
    else if (arg === '--models') {
      const next = argv[i + 1]
      if (next !== undefined) {
        opts.models = next.split(',').map((s) => s.trim()).filter(Boolean)
        i++
      }
    } else if (arg.startsWith('--models=')) {
      opts.models = arg.slice('--models='.length).split(',').map((s) => s.trim()).filter(Boolean)
    } else if (arg === '--out') {
      const next = argv[i + 1]
      if (next !== undefined) {
        opts.out = next
        i++
      }
    } else if (arg.startsWith('--out=')) {
      opts.out = arg.slice('--out='.length)
    }
  }
  return opts
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

function reciprocal(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(values)) out[key] = value > 0 ? 1 / value : value
  return out
}

// Rebuilds params without responseFormat — exactOptionalPropertyTypes-safe.
function withoutResponseFormat(params: NimChatParams): NimChatParams {
  const next: NimChatParams = { model: params.model, messages: params.messages }
  if (params.temperature !== undefined) next.temperature = params.temperature
  if (params.maxTokens !== undefined) next.maxTokens = params.maxTokens
  if (params.timeoutMs !== undefined) next.timeoutMs = params.timeoutMs
  if (params.signal !== undefined) next.signal = params.signal
  return next
}

// Some models reject response_format with a 400 — retry once without it.
async function chatWithFormatFallback(params: NimChatParams): Promise<NimChatResult> {
  try {
    return await chat(params)
  } catch (err) {
    if (params.responseFormat !== undefined && err instanceof NimError && err.status === 400) {
      return await chat(withoutResponseFormat(params))
    }
    throw err
  }
}

function buildJudgePrompt(kind: TaskKind, emails: readonly SampleEmail[], outputs: readonly TaskOutput[]): string {
  const parts: string[] = [KIND_INSTRUCTIONS[kind], '', 'Here are the emails and the candidate outputs, in order:']
  for (const [i, email] of emails.entries()) {
    const output = outputs.find((o) => o.emailId === email.id)
    parts.push(
      '',
      `=== Email ${i + 1} ===`,
      `From: ${email.from}`,
      `Subject: ${email.subject}`,
      truncate(email.body, 500),
      '',
      `--- Candidate ${kind} output for email ${i + 1} ---`,
      output ? truncate(output.content, 600) : '(no output produced)',
    )
  }
  parts.push(
    '',
    'Respond ONLY with JSON: {"quality": 0-100 (overall quality across all emails), "perItem": [0-100 per email, in the same order as above]}',
  )
  return parts.join('\n')
}

function importanceScoreFrom(content: string): number | null {
  const parsed = extractBalancedJson(content)
  if (!isRecord(parsed)) return null
  const raw = parsed['score']
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return null
  return Math.min(100, Math.max(0, Math.round(n)))
}

// Parse-based quality fallback (used when judging is skipped or fails):
// the urgent email must score high, the newsletter/promo low, the
// borderline work email somewhere in the middle.
function parseBasedQuality(importanceScores: readonly (number | null)[]): number {
  const checks: [number, (s: number) => boolean][] = [
    [0, (s) => s >= 70],
    [3, (s) => s <= 45],
    [4, (s) => s <= 45],
    [5, (s) => s >= 20 && s <= 85],
  ]
  let passed = 0
  let total = 0
  for (const [index, predicate] of checks) {
    const score = importanceScores[index]
    if (score === null || score === undefined) continue
    total++
    if (predicate(score)) passed++
  }
  if (total === 0) return 60
  return Math.round((passed / total) * 100)
}

// ─── Task execution ─────────────────────────────────────────────────────────

function tasksFor(corpus: readonly SampleEmail[]): TaskSpec[] {
  const tasks: TaskSpec[] = []
  for (const email of corpus) tasks.push({ kind: 'importance', email })
  for (const email of corpus) tasks.push({ kind: 'summary', email })
  for (const email of corpus.slice(0, 3)) tasks.push({ kind: 'reply', email })
  return tasks
}

async function runTask(model: string, task: TaskSpec): Promise<TaskOutput> {
  const { kind, email } = task
  const maxTokens =
    kind === 'importance'
      ? NIM_CONFIG.maxOutputTokens.importance
      : kind === 'summary'
        ? NIM_CONFIG.maxOutputTokens.summary
        : NIM_CONFIG.maxOutputTokens.reply
  const userPrompt =
    kind === 'importance'
      ? buildImportancePrompt(email, email.to)
      : kind === 'summary'
        ? buildSummaryPrompt(email)
        : buildDraftPrompt(email, 'professional and concise')
  const messages: NimMessage[] = [
    { role: 'system', content: SYSTEM_PROMPTS[kind] },
    { role: 'user', content: userPrompt },
  ]
  const params: NimChatParams = {
    model,
    messages,
    temperature: 0.2,
    maxTokens,
  }
  if (kind !== 'reply') params.responseFormat = { type: 'json_object' }
  const result = await chatWithFormatFallback(params)
  return { kind, emailId: email.id, content: result.content, latencyMs: result.latencyMs, tokens: result.usage.totalTokens }
}

// ─── Judge ──────────────────────────────────────────────────────────────────

function judgeChat(model: string, messages: NimMessage[]): Promise<NimChatResult> {
  return chat({ model, messages, temperature: 0, maxTokens: 1024, responseFormat: { type: 'json_object' } })
}

// ─── Output ─────────────────────────────────────────────────────────────────

function printTable(rows: EvalResult[]): void {
  const modelWidth = Math.max(5, ...rows.map((r) => r.model.length))
  const numWidth = 10
  const widths = [modelWidth, numWidth, numWidth, numWidth, numWidth, numWidth]
  const pad = (s: string, w: number) => s.padEnd(w)
  const border = '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|'
  const line = (cells: string[]) => '| ' + cells.join(' | ') + ' |'
  console.log(
    line([
      pad('model', modelWidth),
      pad('quality', numWidth),
      pad('speed', numWidth),
      pad('cost', numWidth),
      pad('total', numWidth),
      pad('avgLatency(ms)', numWidth),
    ])
  )
  console.log(border)
  for (const row of rows) {
    console.log(
      line([
        pad(row.model, modelWidth),
        pad(row.quality.toFixed(1), numWidth),
        pad(row.speed.toFixed(1), numWidth),
        pad(row.cost.toFixed(1), numWidth),
        pad(row.total.toFixed(1), numWidth),
        pad(row.avgLatencyMs.toFixed(1), numWidth),
      ])
    )
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (!NIM_CONFIG.apiKey) {
    console.error('Error: NVIDIA NIM API key not configured (set NVIDIA_NIM_API_KEY or OPENCODE_FAILOVER_KEYS).')
    process.exit(1)
  }

  console.time('benchmark')
  console.log(`NIM email-model benchmark — ${new Date().toISOString()}`)
  console.log(`candidates: ${opts.models ? opts.models.join(',') : `default (${NIM_EMAIL_CANDIDATES.length})`} | quick=${opts.quick} | judge=${!opts.skipJudge} | out=${opts.out}`)

  const corpus = opts.quick ? CORPUS.slice(0, 3) : CORPUS
  const candidates = opts.models ?? [...NIM_EMAIL_CANDIDATES]
  if (opts.models) {
    for (const model of opts.models) {
      if (!NIM_WORKING_MODELS.includes(model)) {
        console.warn(`  warning: ${model} is not in NIM_WORKING_MODELS — including anyway`)
      }
    }
  }

  // 1. ping all candidates (concurrency 5), keep the reachable ones.
  console.log('\nPinging candidates…')
  const pings = await pool(
    candidates,
    async (model) => {
      const ping = await pingModel(model)
      console.log(`  ${ping.ok ? 'ok  ' : 'FAIL'} ${model} (${ping.latencyMs}ms${ping.error ? ` — ${ping.error}` : ''})`)
      return ping
    },
    5
  )
  const live = candidates.filter((_, i) => pings[i]?.ok === true)
  console.log(`${live.length}/${candidates.length} candidates reachable`)
  if (live.length === 0) {
    console.error('Error: all candidates failed the ping. Check the API key and network connectivity.')
    process.exit(1)
  }

  // 2. run every task on every live candidate (concurrency 3).
  console.time('eval')
  console.log('\nEvaluating tasks (importance + summary on all emails, reply on first 3)…')
  const evals: ModelEval[] = await pool(
    live,
    async (model) => {
      const outputs: TaskOutput[] = []
      let failures = 0
      await pool(
        tasksFor(corpus),
        async (task) => {
          try {
            outputs.push(await runTask(model, task))
          } catch (err) {
            failures++
            console.warn(`  ${model} ${task.kind}/${task.email.id} failed: ${errorText(err)}`)
          }
        },
        3
      )
      console.log(
        `  ${model}: ${outputs.length} outputs, ${failures} failures, ${round1(outputs.reduce((a, o) => a + o.latencyMs, 0) / Math.max(outputs.length, 1))}ms avg, ${outputs.reduce((a, o) => a + o.tokens, 0)} tokens`
      )
      return { model, outputs, failures }
    },
    3
  )
  console.timeEnd('eval')

  // 3. judge each (model, task) group with a strong model (concurrency 3).
  const judgeQuality = new Map<string, { group: TaskKind; quality: number }[]>()
  let judgeModel: string = JUDGE_MODEL
  let judgeFallbackUsed = false

  if (!opts.skipJudge) {
    console.time('judge')
    console.log(`\nJudging outputs with ${JUDGE_MODEL} (fallback ${NIM_CONFIG.defaultModel})…`)
    const groups: JudgeGroup[] = []
    for (const ev of evals) {
      for (const kind of ['importance', 'summary', 'reply'] as const) {
        const outputs = ev.outputs.filter((o) => o.kind === kind)
        if (outputs.length > 0) groups.push({ model: ev.model, kind, emails: corpus, outputs })
      }
    }
    await pool(
      groups,
      async (group) => {
        const messages: NimMessage[] = [
          { role: 'system', content: 'You are a strict, unbiased evaluator of email-assistant model outputs. Output only JSON.' },
          { role: 'user', content: buildJudgePrompt(group.kind, group.emails, group.outputs) },
        ]
        try {
          const result = await judgeChat(judgeModel, messages)
          const quality = aggregateJudgeOutput(result.content, group.emails.length).quality
          const list = judgeQuality.get(group.model) ?? []
          list.push({ group: group.kind, quality })
          judgeQuality.set(group.model, list)
        } catch (err) {
          if (
            !judgeFallbackUsed &&
            judgeModel === JUDGE_MODEL &&
            err instanceof NimError &&
            err.status === 404
          ) {
            judgeFallbackUsed = true
            judgeModel = NIM_CONFIG.defaultModel
            console.warn(`  ${JUDGE_MODEL} returned 404 — falling back to ${judgeModel}`)
            try {
              const result = await judgeChat(judgeModel, messages)
              const quality = aggregateJudgeOutput(result.content, group.emails.length).quality
              const list = judgeQuality.get(group.model) ?? []
              list.push({ group: group.kind, quality })
              judgeQuality.set(group.model, list)
            } catch (err2) {
              console.warn(`  judge failed for ${group.model}/${group.kind}: ${errorText(err2)}`)
            }
            return
          }
          console.warn(`  judge failed for ${group.model}/${group.kind}: ${errorText(err)}`)
        }
      },
      3
    )
    console.timeEnd('judge')
    for (const ev of evals) {
      const groups = judgeQuality.get(ev.model) ?? []
      if (groups.length > 0) {
        console.log(`  judge ${ev.model}: ${groups.map((g) => `${g.group}=${round1(g.quality)}`).join(', ')}`)
      } else {
        console.log(`  judge ${ev.model}: no usable judge scores — using parse-based fallback`)
      }
    }
  }

  // 4. score: quality (judge avg or parse fallback), speed/cost (normalized
  // reciprocals), total (composite).
  const latencyByModel: Record<string, number> = {}
  const tokensByModel: Record<string, number> = {}
  const qualityByModel: Record<string, number> = {}
  for (const ev of evals) {
    latencyByModel[ev.model] = ev.outputs.reduce((a, o) => a + o.latencyMs, 0) / Math.max(ev.outputs.length, 1)
    tokensByModel[ev.model] = ev.outputs.reduce((a, o) => a + o.tokens, 0)
    const groups = judgeQuality.get(ev.model) ?? []
    qualityByModel[ev.model] =
      groups.length > 0
        ? groups.reduce((a, g) => a + g.quality, 0) / groups.length
        : parseBasedQuality(importanceScoresFor(ev, corpus))
  }
  const speedScores = minMaxNormalize(reciprocal(latencyByModel))
  const costScores = minMaxNormalize(reciprocal(tokensByModel))

  const results: EvalResult[] = evals.map((ev) => {
    const quality = qualityByModel[ev.model] ?? 60
    const speed = speedScores[ev.model] ?? 0
    const cost = costScores[ev.model] ?? 0
    return {
      model: ev.model,
      quality: round1(quality),
      speed: round1(speed),
      cost: round1(cost),
      total: round1(computeCompositeScore(quality, speed, cost)),
      avgLatencyMs: round1(latencyByModel[ev.model] ?? 0),
      totalTokens: tokensByModel[ev.model] ?? 0,
    }
  })
  results.sort((a, b) => b.total - a.total)

  console.log('\n── Results ──')
  printTable(results)

  // 5. write the winner.
  const winner = results[0]
  if (!winner) {
    console.error('Error: no scores computed — nothing to write.')
    process.exit(1)
  }
  const winnerFile: GeneratedModelFile = {
    model: winner.model,
    selectedAt: new Date().toISOString(),
    scores: Object.fromEntries(
      results.map((r) => [
        r.model,
        { quality: r.quality, speed: r.speed, cost: r.cost, total: r.total },
      ])
    ),
    notes: `selected by scripts/benchmark.ts at ${new Date().toISOString()} — quick=${opts.quick}, judge=${!opts.skipJudge}, candidates=${candidates.length}, corpus=${corpus.length} emails, judgeModel=${judgeModel}`,
  }
  writeGeneratedModel(opts.out, winnerFile)
  console.log(`\nWinner: ${winner.model} (total ${winner.total.toFixed(1)}) — wrote ${opts.out}`)
  console.timeEnd('benchmark')
}

function importanceScoresFor(ev: ModelEval, corpus: readonly SampleEmail[]): (number | null)[] {
  return corpus.map((email) => {
    const output = ev.outputs.find((o) => o.kind === 'importance' && o.emailId === email.id)
    return output ? importanceScoreFrom(output.content) : null
  })
}

await main()
