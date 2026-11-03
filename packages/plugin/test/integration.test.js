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

test('Config is a native Schemastery schema when the host provides one', () => {
  // A bare StandardSchema object validates fine but is reported by the profile
  // inspector as `unsupported`, which removes the plugin's settings card.
  // Under plain Node the native library is absent, so this asserts the
  // portable fallback's shape; the profile probe covers the native path.
  assert.ok(typeof Config['~standard'].validate === 'function')
  assert.equal(Config['~standard'].version, 1)
  const out = Config['~standard'].validate({ minSeverity: 'high', tools: false })
  assert.equal(out.value.minSeverity, 'high')
  assert.equal(out.value.tools, false)
  assert.equal(out.value.enabled, true, 'defaults are filled')
})

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

test('/adw on and off flip the live prompt gate instead of claiming a no-op restart', async () => {
  const services = { commands: {}, systemPrompt: {} }
  const { ctx, calls } = fakeHost(services)
  apply(ctx, DEFAULT_CONFIG)
  const command = calls.commands[0]
  const section = calls.sections[0]
  assert.equal(typeof section.text, 'function', 'prompt text must be a thunk so /adw off can take effect')
  assert.ok(section.text().includes('发布会原则'))
  const off = await command.handler({ rawInput: 'off', signal: undefined })
  assert.equal(off.kind, 'success')
  assert.equal(section.text(), '', 'off must empty the prompt section')
  const on = await command.handler({ rawInput: 'on', signal: undefined })
  assert.equal(on.kind, 'success')
  assert.ok(section.text().includes('发布会原则'))
})

test('a composed host gets every registration', async () => {
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
  // A temp workspace pins the root independently of the caller's cwd
  // (`pnpm verify` runs from the repo root, the test runner from the package).
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'adw-command-'))
  await writeFile(join(root, 'paper.md'), '遗憾的是效果有限。需要指出的是，实验一致。')

  const services = { commands: {}, skills: {}, workingDirectory: { ensure: async () => root } }
  const { ctx, calls } = fakeHost(services)
  apply(ctx, DEFAULT_CONFIG)
  const command = calls.commands[0]

  // A real command invocation always carries the live Agent; the workspace
  // root comes from its Session, not from the host process cwd.
  const agent = { session: { header: { cwd: root } } }
  const ok = await command.handler({ rawInput: 'scan paper.md', signal: undefined, agent })
  assert.equal(ok.kind, 'success')
  assert.match(ok.text, /写作健康度/)

  const missing = await command.handler({ rawInput: 'scan does-not-exist.md', signal: undefined, agent })
  assert.equal(missing.kind, 'error')
  assert.match(missing.text, /file not found/)

  const escape = await command.handler({ rawInput: 'scan ../../etc/passwd', signal: undefined, agent })
  assert.equal(escape.kind, 'error')
  assert.match(escape.text, /outside the workspace/)

  // Flags reach the scanner instead of being parsed and dropped.
  const forced = await command.handler({ rawInput: 'scan paper.md --section abstract --min-severity high', signal: undefined, agent })
  assert.equal(forced.kind, 'success')
  assert.match(forced.text, /按 abstract 计分/)
  const hidden = await command.handler({ rawInput: 'scan paper.md --min-severity high', signal: undefined, agent })
  assert.match(hidden.text, /隐藏 1 处/)
  // Filtering the list must not move the score; forcing a section legitimately
  // does, because the section multiplier is part of the metric.
  assert.equal((hidden.text.match(/写作健康度 (\d+)/) ?? [])[1], (ok.text.match(/写作健康度 (\d+)/) ?? [])[1], 'the score must not move with the display filter')
})

test('readWorkspaceFile uses the live Agent working directory, not the process cwd', async () => {
  const { readWorkspaceFile } = await import('../lib/index.js')
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'adw-workspace-'))
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'paper.md'), '遗憾的是效果有限。需要指出的是，实验一致。')
  await writeFile(join(root, 'docs', 'paper.md'), '遗憾的是效果有限。需要指出的是，实验一致。')
  await mkdir(join(root, 'sub'))
  await writeFile(join(root, 'sub', 'nested.md'), '效果有限。')

  const calls = []
  const ctx = {
    get: (name) => (name === 'workingDirectory'
      ? { ensure: async (agent, signal) => { calls.push([agent, signal]); return agent.session.header.cwd } }
      : undefined),
  }
  const agent = { session: { header: { cwd: root } } }
  const signal = new AbortController().signal

  const text = await readWorkspaceFile('paper.md', ctx, { agent, signal })
  assert.match(text, /^遗憾的是效果有限。/)
  assert.equal(calls.length, 1, 'the service must be asked once, with the Agent')
  assert.equal(calls[0][0], agent, 'ensure() takes the Agent, not the Cordis context')

  // Nested relative path resolves inside the session directory.
  assert.equal(await readWorkspaceFile('sub/nested.md', ctx, { agent }), '效果有限。')

  // Traversal still refused when a real service supplies the root.
  await assert.rejects(() => readWorkspaceFile('../../etc/passwd', ctx, { agent }), /outside the workspace/)

  // A symlink inside the workspace must not read outside it: the lexical
  // check alone cannot see where the link points.
  const { symlink } = await import('node:fs/promises')
  const outside = await mkdtemp(join(tmpdir(), 'adw-outside-'))
  await writeFile(join(outside, 'secret.txt'), 'TOP SECRET')
  await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
  await assert.rejects(() => readWorkspaceFile('link.txt', ctx, { agent }), /outside the workspace/)
  // Without an Agent (editor/CI), fall back to cwd instead of throwing.
  assert.equal((await readWorkspaceFile('packages/plugin/package.json', ctx)).length > 0, true)
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
