import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildSkillProvider, SKILLS } from '../lib/skill-provider.js'
import { parseAdwInput, renderReport, renderRules } from '../lib/command.js'
import { buildScanTool, toToolValue } from '../lib/tool.js'
import {
  applyEvent,
  viewOf,
  buildWritingHealthProjection,
  viewSchema,
  stateSchema,
  PROJECTION_KEY,
} from '../lib/projection.js'
import { scan } from '../lib/detector.js'

/** Load a packaged asset through the same URL mapping the plugin uses. */
async function readAsset(rel) {
  const { readFile } = await import('node:fs/promises')
  return readFile(new URL(`../${rel}`, import.meta.url), 'utf8')
}

test('skill provider exposes both vendored skills with valid candidates', async () => {
  const provider = buildSkillProvider({ readAsset, asset: (rel) => new URL(`../${rel}`, import.meta.url) })
  assert.equal(provider.name, 'anti-defensive-writing')
  const candidates = await provider.list()
  assert.equal(candidates.length, 2)
  assert.deepEqual(candidates.map((c) => c.name).sort(), [
    'anti-defensive-writing',
    'anti-defensive-writing-en',
  ])
  for (const candidate of candidates) {
    assert.match(candidate.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    assert.ok(candidate.description.length > 20)
    assert.equal(candidate.invocation.modelInvocable, true)
    assert.equal(candidate.invocation.userInvocable, true)
    assert.equal(candidate.provider, 'anti-defensive-writing')
    // validateCandidate hard-requires source (string) + rank (finite number).
    assert.equal(typeof candidate.source, 'string')
    assert.equal(typeof candidate.rank, 'number')
    assert.ok(Number.isFinite(candidate.rank))
    assert.equal(candidate.resourceBase.kind, 'directory')
    assert.ok(candidate.resourceBase.path.includes('skills/'))
  }
  // zh advertised first by default
  assert.equal(candidates[0].name, 'anti-defensive-writing')
})

test('skill provider returns verbatim upstream Markdown as content', async () => {
  const provider = buildSkillProvider({ readAsset, asset: (rel) => new URL(`../${rel}`, import.meta.url) })
  const definition = await provider.get({ name: 'anti-defensive-writing' })
  assert.ok(definition.content.includes('# 学术写作原则'))
  assert.ok(definition.content.includes('论文是一场学术发布会'))
  const en = await provider.get({ name: 'anti-defensive-writing-en' })
  assert.ok(en.content.includes('The Press-Release Principle'))
  assert.equal(await provider.get({ name: 'nope' }), undefined)
})

test('skill provider honours the preferred language ordering', async () => {
  const provider = buildSkillProvider({
    readAsset,
    asset: (rel) => new URL(`../${rel}`, import.meta.url),
    language: 'en',
  })
  const candidates = await provider.list()
  assert.equal(candidates[0].name, 'anti-defensive-writing-en')
})

test('parseAdwInput handles verbs, flags and positional arguments', () => {
  assert.deepEqual(parseAdwInput('scan docs/a.md'), {
    verb: 'scan',
    positional: ['docs/a.md'],
    flags: {},
  })
  assert.deepEqual(parseAdwInput('scan a.md --section abstract --min-severity high'), {
    verb: 'scan',
    positional: ['a.md'],
    flags: { section: 'abstract', minSeverity: 'high' },
  })
  assert.deepEqual(parseAdwInput('rules self-weakening-hedge'), {
    verb: 'rules',
    positional: ['self-weakening-hedge'],
    flags: {},
  })
  assert.deepEqual(parseAdwInput('  '), { verb: '', positional: [], flags: {} })
})

test('parseAdwInput rejects unknown flags and bad severities', () => {
  assert.throws(() => parseAdwInput('scan a.md --bogus'), /未知参数/)
  assert.throws(() => parseAdwInput('scan a.md --min-severity urgent'), /high \| medium \| low/)
})

test('renderReport is readable and marks question-kind hits differently', () => {
  const report = scan('遗憾的是本文弱于基线。', { section: 'abstract' })
  const text = renderReport(report, 'a.md')
  assert.match(text, /写作健康度 \d+\/100/)
  assert.match(text, /a\.md/)
  assert.match(text, /→ L1:/)
  assert.match(text, /\? L1:5/)
})

test('renderRules lists every rule and can drill into one with counter-examples', () => {
  const all = renderRules()
  assert.match(all, /反防御性写作规则/)
  assert.match(all, /self-weakening-hedge/)
  assert.match(all, /comparison-scope-creep/)
  const one = renderRules('loss-framing')
  assert.match(one, /主动承认落败/)
  assert.match(one, /反例（不应命中）/)
  assert.match(renderRules('nope'), /没有规则 nope/)
})

test('adw_scan tool definition has a valid shape and bounded output', async () => {
  const defineTool = (definition) => definition
  const deps = {
    config: { minSeverity: 'low', disabledRules: [] },
    readFileText: async () => '遗憾的是效果有限。',
  }
  const tool = buildScanTool(defineTool, deps)
  assert.equal(tool.name, 'adw_scan')
  assert.ok(tool.description.includes('defensive writing'))
  assert.ok(tool.parameters.text)
  assert.ok(tool.parameters.path)
  const value = await tool.execute({ text: '遗憾的是效果有限。' }, {})
  assert.equal(value.ok, true)
  assert.equal(typeof value.score, 'number')
  assert.ok(Array.isArray(value.hits))
  assert.ok(value.hits.length >= 1)
  for (const hit of value.hits) {
    assert.equal(typeof hit.suggestion, 'string')
    assert.ok(!('suggestion' in hit && typeof hit.suggestion === 'object'))
  }
  const rendered = tool.output.render({}, value)
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /writing-health/)
})

test('adw_scan tool requires text or path and returns a structured error', async () => {
  const tool = buildScanTool((definition) => definition, {
    config: { minSeverity: 'low', disabledRules: [] },
    readFileText: async () => '',
  })
  const value = await tool.execute({}, {})
  assert.deepEqual(value, { ok: false, error: 'provide either `text` or `path`' })
})

test('adw_scan tool caps input length', async () => {
  const tool = buildScanTool((definition) => definition, {
    config: { minSeverity: 'low', disabledRules: [] },
    readFileText: async () => '',
  })
  const value = await tool.execute({ text: 'x'.repeat(200_001) }, {})
  assert.equal(value.ok, false)
  assert.match(value.error, /limit/)
})

test('toToolValue keeps every aggregate but caps the span list', () => {
  const report = scan(
    Array.from({ length: 60 }, (_, i) => `遗憾的是第${i}点。`).join(''),
    { section: 'abstract', maxHits: 100 },
  )
  const value = toToolValue(report)
  assert.equal(value.stats.hits, report.stats.hits)
  assert.equal(value.hits.length, 40)
  assert.equal(value.truncated, true)
})

test('projection folds a user message into a pending before-sample', () => {
  const state = applyEvent(
    buildWritingHealthProjection().init(),
    { type: 'user/message', seq: 1, time: 100, data: { content: [{ type: 'text', text: '遗憾的是效果有限。' }] } },
  )
  assert.equal(state.pendingBefore.hits > 0, true)
  assert.equal(state.pendingBefore.score < 100, true)
})

test('projection ignores unrelated events by returning the same reference', () => {
  const initial = buildWritingHealthProjection().init()
  for (const event of [
    { type: 'session/end', seq: 1, time: 0, data: {} },
    { type: 'assistant/live-chunk', seq: 2, time: 0, data: {} },
    { type: 'todo/write', seq: 3, time: 0, data: { todos: [] } },
  ]) {
    assert.equal(applyEvent(initial, event), initial)
  }
})

test('projection records a rewrite pair when a tool result follows a user message', () => {
  const projection = buildWritingHealthProjection()
  let state = projection.init()
  state = applyEvent(state, {
    type: 'user/message',
    seq: 1,
    time: 100,
    data: { content: [{ type: 'text', text: '遗憾的是效果有限，本文弱于基线。' }] },
  })
  const before = state.pendingBefore.score
  state = applyEvent(state, {
    type: 'tool/result',
    seq: 2,
    time: 200,
    data: {
      source: { callId: 'call-1' },
      meta: {
        value: {
          result: {
            ok: true,
            score: 96,
            defensiveDensity: 0.1,
            stats: { chars: 20, sentences: 3, hits: 0, high: 0, medium: 0, low: 0, suppressed: 0 },
            byRule: [],
          },
        },
      },
    },
  })
  assert.equal(state.scans, 1)
  assert.equal(state.pairs.length, 1)
  assert.equal(state.pairs[0].before, before)
  assert.equal(state.pairs[0].after, 96)
  assert.equal(state.pendingBefore, null)
})

test('projection view is plain JSON and passes the view schema', () => {
  const projection = buildWritingHealthProjection()
  let state = projection.init()
  state = applyEvent(state, {
    type: 'assistant/message',
    seq: 1,
    time: 1,
    data: { message: { content: [{ type: 'text', text: '需要指出的是，效果有限。' }] } },
  })
  const view = viewOf(state)
  assert.doesNotThrow(() => viewSchema.parse(view))
  assert.doesNotThrow(() => stateSchema.parse(state))
  const serialized = JSON.stringify(view)
  assert.ok(!serialized.includes('undefined'))
  assert.equal(view.version, 2)
  assert.ok(Array.isArray(view.trend))
  assert.ok(Array.isArray(view.byRule))
  assert.ok(view.summary.averageScore <= 100)
})

test('projection bounds growth over many events', () => {
  const projection = buildWritingHealthProjection()
  let state = projection.init()
  for (let i = 0; i < 500; i++) {
    state = applyEvent(state, {
      type: 'assistant/message',
      seq: i,
      time: i,
      data: { message: { content: [{ type: 'text', text: '需要指出的是，效果有限。' }] } },
    })
  }
  assert.ok(state.points.length <= 60)
  assert.ok(state.pairs.length <= 8)
  const view = viewOf(state)
  assert.ok(view.trend.length <= 60)
  assert.doesNotThrow(() => viewSchema.parse(view))
})

test('projection rejects non-plain-JSON state', () => {
  assert.throws(() => stateSchema.parse({ bad: undefined }), /undefined is not plain JSON/)
  assert.throws(() => stateSchema.parse({ bad: new Date() }), /plain objects/)
  assert.throws(() => stateSchema.parse({ bad: Number.NaN }), /non-finite/)
})

test('projection key and version are stable', () => {
  const projection = buildWritingHealthProjection()
  assert.equal(projection.key, PROJECTION_KEY)
  assert.equal(PROJECTION_KEY, 'adwWriting')
  assert.equal(projection.stateVersion, 2)
})
