import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, name, Config, DEFAULT_CONFIG, PROMPT_SECTION } from '../lib/index.js'

/**
 * An in-memory Cordis-like host. It implements exactly the four service
 * surfaces the plugin touches, plus `ctx.inject` semantics (the callback runs
 * only when the named service exists).
 */
function fakeHost(services) {
  const calls = { skills: [], commands: [], tools: [], sections: [], projections: [] }

  const ctx = {
    logger: { warn() {}, info() {}, debug() {} },
    effect(fn, label) {
      const value = fn()
      return () => (typeof value === 'function' ? value() : undefined)
    },
    get(serviceName) {
      return services[serviceName]
    },
    inject(names, callback) {
      const missing = names.filter((serviceName) => services[serviceName] === undefined)
      if (missing.length > 0) return undefined
      return callback(ctx)
    },
  }

  if (services.skills !== undefined) {
    services.skills.registerProvider = (provider) => {
      calls.skills.push(provider)
      return () => {}
    }
  }
  if (services.commands !== undefined) {
    services.commands.register = (definition) => {
      calls.commands.push(definition)
      return () => {}
    }
  }
  if (services.tools !== undefined) {
    services.tools.register = (tool) => {
      calls.tools.push(tool)
      return () => {}
    }
  }
  if (services.systemPrompt !== undefined) {
    services.systemPrompt.section = (section) => {
      calls.sections.push(section)
      return () => {}
    }
  }
  if (services.sessionProjections !== undefined) {
    services.sessionProjections.register = (definition) => {
      calls.projections.push(definition)
      return () => {}
    }
  }

  return { ctx, calls }
}

test('plugin identity and config defaults are stable', () => {
  assert.equal(name, 'anti-defensive-writing')
  assert.equal(DEFAULT_CONFIG.enabled, true)
  assert.equal(DEFAULT_CONFIG.skillLanguage, 'zh')
  assert.ok(PROMPT_SECTION.includes('发布会原则'))
  assert.ok(PROMPT_SECTION.includes('不得为了减少'))
})

test('Config accepts defaults, coerces nothing, and reports issues', () => {
  const good = Config['~standard'].validate(undefined)
  assert.equal(good.value.enabled, true)
  assert.deepEqual(good.value.disabledRules, [])

  const bad = Config['~standard'].validate({ minSeverity: 'urgent', disabledRules: 'nope' })
  assert.equal(bad.issues.length, 2)
  assert.equal(bad.value, undefined)
})

test('a fully composed host gets every registration', async () => {
  const services = {
    skills: {},
    commands: {},
    tools: {},
    systemPrompt: {},
    sessionProjections: {},
    workingDirectory: { ensure: async () => process.cwd() },
  }
  const { ctx, calls } = fakeHost(services)
  apply(ctx, Config['~standard'].validate({}).value)

  assert.equal(calls.skills.length, 1)
  assert.equal(calls.commands.length, 1)
  assert.equal(calls.commands[0].name, 'adw')
  assert.equal(calls.sections.length, 1)
  assert.equal(calls.sections[0].name, 'dsh-adw:writing-discipline')
  assert.equal(calls.sections[0].interpolate, false)
  assert.equal(calls.projections.length, 1)
  assert.equal(calls.projections[0].key, 'adwWriting')

  // tool.js loads @deepseek-ai/dsh-tools via dynamic import, which is absent
  // here; the plugin must degrade rather than throw.
  assert.equal(calls.tools.length, 0)

  // The command must work end to end against a real file.
  const result = await calls.commands[0].handler({ rawInput: 'rules', signal: undefined })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /self-weakening-hedge/)
})

test('a minimal host without optional services still loads the skill provider', () => {
  const services = { skills: {} }
  const { ctx, calls } = fakeHost(services)
  apply(ctx, DEFAULT_CONFIG)
  assert.equal(calls.skills.length, 1)
  assert.equal(calls.commands.length, 0)
  assert.equal(calls.projections.length, 0)
})

test('enabled:false short-circuits every registration', () => {
  const services = { skills: {}, commands: {}, tools: {}, systemPrompt: {}, sessionProjections: {} }
  const { ctx, calls } = fakeHost(services)
  apply(ctx, { ...DEFAULT_CONFIG, enabled: false })
  assert.equal(calls.skills.length, 0)
  assert.equal(calls.commands.length, 0)
  assert.equal(calls.sections.length, 0)
  assert.equal(calls.projections.length, 0)
})

test('injectPrompt:false and tools:false skip those layers only', () => {
  const services = { skills: {}, commands: {}, tools: {}, systemPrompt: {}, sessionProjections: {} }
  const { ctx, calls } = fakeHost(services)
  apply(ctx, { ...DEFAULT_CONFIG, injectPrompt: false, tools: false })
  assert.equal(calls.skills.length, 1)
  assert.equal(calls.commands.length, 1)
  assert.equal(calls.sections.length, 0)
  assert.equal(calls.projections.length, 1)
})

test('/adw scan reads a real workspace file and returns a report', async () => {
  // Pin the workspace root to this package so the test is independent of the
  // caller's cwd (`pnpm verify` runs from the repo root, the test runner from
  // the package directory).
  const packageRoot = new URL('..', import.meta.url).pathname
  const services = {
    commands: {},
    skills: {},
    workingDirectory: { ensure: async () => packageRoot },
  }
  const { ctx, calls } = fakeHost(services)
  apply(ctx, DEFAULT_CONFIG)
  const command = calls.commands[0]

  const ok = await command.handler({ rawInput: 'scan package.json', signal: undefined })
  assert.equal(ok.kind, 'success')
  assert.match(ok.text, /写作健康度/)

  const missing = await command.handler({ rawInput: 'scan does-not-exist.md', signal: undefined })
  assert.equal(missing.kind, 'error')
  assert.match(missing.text, /file not found/)

  const escape = await command.handler({ rawInput: 'scan ../../etc/passwd', signal: undefined })
  assert.equal(escape.kind, 'error')
  assert.match(escape.text, /outside the workspace/)
})

test('the projection folds real scan output into a client-visible view', async () => {
  const services = { skills: {}, sessionProjections: {} }
  const { ctx, calls } = fakeHost(services)
  apply(ctx, DEFAULT_CONFIG)
  const projection = calls.projections[0]
  assert.doesNotThrow(() => projection.stateSchema.parse(projection.init()))

  let state = projection.apply(projection.init(), {
    type: 'user/message',
    seq: 1,
    time: 10,
    data: { content: [{ type: 'text', text: '遗憾的是效果有限。' }] },
  })
  const view = projection.wire.view(state)
  assert.doesNotThrow(() => projection.wire.viewSchema.parse(view))
  assert.ok(view.trend.length === 0 || view.last.hits > 0)
})
