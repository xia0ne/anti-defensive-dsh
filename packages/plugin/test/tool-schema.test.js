import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import {
  buildScanTool,
  buildRawToolDefinition,
  outputSchemaSpec,
  dslToJsonSchema,
  parameterJsonSchema,
  parameterSpec,
} from '../lib/tool.js'

const CHECKOUT = process.env.DSH_CHECKOUT ?? '/tmp/dsh_asar/dsh/node_modules/@deepseek-ai'
const available = existsSync(`${CHECKOUT}/dsh-tools/lib/index.js`)

/**
 * The registry validates schemas far more strictly than `defineTool`'s DSL.
 * A mismatch here means the tool silently fails to register in production, so
 * both builders are checked against the real `assertSupportedJsonSchema` and
 * a real executed value against the real output validator.
 */
test('both tool builders produce registry-legal schemas', { skip: !available }, async () => {
  const Tools = await import(`${CHECKOUT}/dsh-tools/lib/index.js`)
  const deps = { readFileText: async () => '', config: { minSeverity: 'low', disabledRules: [] } }

  const definitions = {
    defineTool: buildScanTool(Tools.defineTool, deps),
    raw: buildRawToolDefinition(deps),
  }

  for (const [label, definition] of Object.entries(definitions)) {
    assert.equal(definition.name, 'adw_scan', label)
    assert.doesNotThrow(() => Tools.assertSupportedJsonSchema(definition.parameters), `${label} parameters`)
    assert.doesNotThrow(() => Tools.assertSupportedJsonSchema(definition.output.schema), `${label} output`)
    assert.equal(typeof definition.output.render, 'function', `${label} render`)

    const value = await definition.execute({ text: '遗憾的是效果有限。' }, {})
    assert.equal(value.ok, true, label)
    assert.doesNotThrow(
      () => Tools.validateJsonSchemaValue(definition.output.schema, value, ''),
      `${label} output value must conform`,
    )
  }
})

test('the DSL and raw parameter schemas agree', () => {
  const raw = parameterJsonSchema()
  assert.equal(raw.type, 'object')
  assert.deepEqual(Object.keys(raw.properties).sort(), ['minSeverity', 'path', 'section', 'text'])
  // None of adw_scan's parameters are mandatory: text OR path.
  assert.equal(raw.required, undefined)
  assert.deepEqual(Object.keys(parameterSpec()).sort(), ['minSeverity', 'path', 'section', 'text'])
})

test('dslToJsonSchema lifts inline required into a sibling array', () => {
  const spec = {
    type: 'object',
    properties: {
      a: { type: 'string', required: true },
      b: { type: 'number' },
      c: { type: 'array', required: true, items: { type: 'string', required: true } },
    },
  }
  const json = dslToJsonSchema(spec)
  assert.deepEqual(json.required, ['a', 'c'])
  assert.equal(json.properties.a.required, undefined)
  assert.deepEqual(json.properties.c.items, { type: 'string' })
  assert.equal(json.type, 'object')
})

test('the output spec is a two-branch oneOf: report success or a structured failure', () => {
  const spec = outputSchemaSpec()
  assert.equal(spec.oneOf.length, 2)
  const [report, failure] = spec.oneOf
  assert.deepEqual(
    Object.keys(report.properties).sort(),
    ['byRule', 'defensiveDensity', 'error', 'hits', 'ok', 'score', 'stats', 'truncated'],
  )
  for (const key of ['ok', 'score', 'defensiveDensity', 'stats', 'byRule', 'hits', 'truncated']) {
    assert.equal(report.properties[key].required, true, `${key} must be required`)
  }
  assert.equal(report.properties.error.required, undefined, 'error is only present on failure')
  assert.deepEqual(Object.keys(failure.properties).sort(), ['error', 'ok'])
  assert.equal(failure.properties.error.required, true)
  assert.ok('error' in report.properties, 'the success branch tolerates error for the render fallback')
})

test('the two output branches are structurally disjoint', () => {
  const spec = dslToJsonSchema(outputSchemaSpec())
  const report = spec.oneOf[0]
  const failure = spec.oneOf[1]
  // The success branch never requires `error`; the failure branch requires
  // exactly `ok` + `error` and nothing else.
  assert.ok(!report.required.includes('error'))
  assert.deepEqual(failure.required.sort(), ['error', 'ok'])
  assert.deepEqual(Object.keys(failure.properties).sort(), ['error', 'ok'])
  assert.equal(failure.additionalProperties, false)
  assert.equal(report.additionalProperties, false)
})

test('registerScanTool falls back to the raw definition when dsh-tools is absent', async () => {
  const { registerScanTool } = await import('../lib/tool.js')
  const registered = []
  const ctx = {
    get: (serviceName) => (serviceName === 'tools' ? { register: (definition) => registered.push(definition) } : undefined),
    logger: { warn() {} },
  }
  const ok = await registerScanTool(ctx, {
    readFileText: async () => '',
    config: { minSeverity: 'low', disabledRules: [] },
  })
  // Under this test runner the bare specifier is unresolved, so this exercises
  // the fallback; under a DSH-launched process it exercises defineTool. Both
  // must register exactly one working tool.
  assert.equal(ok, true)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'adw_scan')
  const value = await registered[0].execute({ text: '遗憾的是效果有限。' }, {})
  assert.equal(value.ok, true)
})
