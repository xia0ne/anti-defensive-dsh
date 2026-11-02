import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

/**
 * Mount the plugin's skill provider into the REAL DSH SkillRegistry.
 *
 * This is the only test that would have caught the factory-vs-object bug:
 * `registerProvider(provider)` throws `create is not a function` at activation,
 * which a hand-written fake context cannot reproduce unless it copies the real
 * signature.
 *
 * The checkout is read from DSH_CHECKOUT (defaults to the extracted copy used
 * during development); the test skips cleanly when it is absent.
 */
const CHECKOUT = process.env.DSH_CHECKOUT ?? '/tmp/dsh_asar/dsh/node_modules/@deepseek-ai'
const available = existsSync(`${CHECKOUT}/cordis/lib/index.js`) && existsSync(`${CHECKOUT}/dsh-skill/lib/index.js`)

test('skill provider registers with the real SkillRegistry', { skip: !available }, async () => {
  const { Context } = await import(`${CHECKOUT}/cordis/lib/index.js`)
  const { default: SkillRegistry } = await import(`${CHECKOUT}/dsh-skill/lib/index.js`)

  const ctx = new Context()
  ctx.plugin(SkillRegistry)
  await new Promise((resolve) => setTimeout(resolve, 100))

  const mod = await import('../lib/index.js')
  const fiber = ctx.plugin(mod)
  await new Promise((resolve) => setTimeout(resolve, 200))

  const summaries = await ctx.skills.list()
  const names = summaries.map((item) => item.name).sort()
  assert.deepEqual(names, ['anti-defensive-writing', 'anti-defensive-writing-en'])

  const loaded = await ctx.skills.get('anti-defensive-writing')
  assert.ok(loaded)
  assert.ok(loaded.content.includes('学术写作原则'))
  assert.equal(loaded.provider, 'anti-defensive-writing')

  const en = await ctx.skills.get('anti-defensive-writing-en')
  assert.ok(en.content.includes('Press-Release Principle'))

  await fiber?.dispose?.()
})
