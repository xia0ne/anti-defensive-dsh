import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

/**
 * Mount the plugin on the REAL ToolRuntime and CommandRegistry.
 *
 * The in-memory fakes in the other tests model the *shape* of these services
 * but not their behaviour. The two defects this file exists for are both
 * invisible to a fake:
 *
 *   1. `output.schema` required every report field unconditionally, so the
 *      registry rejected the tool's own `{ ok: false, error }` value with
 *      INVALID_TOOL_OUTPUT — every failed scan surfaced as a schema error.
 *   2. `presentationMeta` was absent, so `tool/result` carried no canonical
 *      value and the dashboard could never fold a model-driven scan.
 */
const CHECKOUT = process.env.DSH_CHECKOUT ?? '/tmp/dsh_asar/dsh/node_modules/@deepseek-ai'
const available =
  existsSync(`${CHECKOUT}/cordis/lib/index.js`) &&
  existsSync(`${CHECKOUT}/dsh-tools/lib/index.js`) &&
  existsSync(`${CHECKOUT}/dsh-system-prompt/lib/index.js`) &&
  existsSync(`${CHECKOUT}/dsh-commands/lib/index.js`)

/** Compose the minimal real host the plugin's tool and command layers need. */
async function host() {
  const { Context } = await import(`${CHECKOUT}/cordis/lib/index.js`)
  const { default: SystemPrompt } = await import(`${CHECKOUT}/dsh-system-prompt/lib/index.js`)
  const { default: ToolRuntime } = await import(`${CHECKOUT}/dsh-tools/lib/index.js`)
  const { default: CommandRegistry } = await import(`${CHECKOUT}/dsh-commands/lib/index.js`)
  const prompt = await import(`${CHECKOUT}/dsh-system-prompt/lib/index.js`)
  const ctx = new Context()
  ctx.plugin(SystemPrompt)
  await new Promise((resolve) => setTimeout(resolve, 80))
  ctx.plugin(ToolRuntime)
  await new Promise((resolve) => setTimeout(resolve, 120))
  ctx.plugin(CommandRegistry)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const mod = await import('../lib/index.js')
  ctx.plugin(mod)
  await new Promise((resolve) => setTimeout(resolve, 300))
  return { ctx, renderPrompt: prompt.renderPrompt }
}

test('adw_scan executes through the real ToolRuntime and carries presentation metadata', { skip: !available }, async () => {
  const { ctx } = await host()
  const tools = ctx.get('tools')

  const ok = await tools.execute({
    name: 'adw_scan',
    arguments: { text: '遗憾的是效果有限。', section: 'abstract' },
    callId: 'call-ok',
    signal: new AbortController().signal,
  })
  assert.equal(ok.isError, false, JSON.stringify(ok.content))
  assert.equal(ok.value.ok, true)
  assert.ok(ok.value.score < 100)
  // The fold reads this; without it a model-driven scan never reaches the panel.
  assert.equal(ok.meta?.adwScan?.score, ok.value.score)

  // The failure branch is the one that used to be unrepresentable.
  const failed = await tools.execute({
    name: 'adw_scan',
    arguments: {},
    callId: 'call-fail',
    signal: new AbortController().signal,
  })
  assert.equal(failed.isError, false, `a handled failure must be a value, not INVALID_TOOL_OUTPUT: ${JSON.stringify(failed.content)}`)
  assert.equal(failed.value.ok, false)
  assert.match(failed.value.error, /either `text` or `path`/)
  assert.equal(failed.meta?.adwScan?.ok, false)
})

test('/adw off really removes the prompt section, and on restores it', { skip: !available }, async () => {
  const { ctx, renderPrompt } = await host()
  const assemble = async () => renderPrompt(await ctx.get('systemPrompt').assemble({}))
  assert.match(await assemble(), /发布会原则/)
  const definition = ctx.get('commands').view(ctx).get('adw').definition
  const off = await definition.handler({ rawInput: 'off', signal: undefined })
  assert.equal(off.kind, 'success')
  assert.doesNotMatch(await assemble(), /发布会原则/)
  const on = await definition.handler({ rawInput: 'on', signal: undefined })
  assert.equal(on.kind, 'success')
  assert.match(await assemble(), /发布会原则/)
})

test('the /adw command registers on the real CommandRegistry', { skip: !available }, async () => {
  const { ctx } = await host()
  const commands = ctx.get('commands')
  assert.equal(typeof commands.register, 'function')
  // A registered command must be resolvable from the registry's own view.
  const definitions = commands.view(ctx)
  assert.equal(definitions.has('adw'), true, 'adw must be present in the command view')
  const definition = definitions.get('adw').definition
  assert.match(definition.description, /反防御性写作/)
  const rules = await definition.handler({ rawInput: 'rules', signal: undefined })
  assert.equal(rules.kind, 'success')
  assert.match(rules.text, /self-weakening-hedge/)
})
