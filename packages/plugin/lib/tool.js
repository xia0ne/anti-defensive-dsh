/**
 * The model-facing `adw_scan` tool.
 *
 * This is the one surface where the model itself can ask the detector whether
 * a draft it just wrote is defensive. It returns the same `Report` the UI uses,
 * bounded so a long paper cannot flood the model's context.
 *
 * Registered with `defineTool` when `@deepseek-ai/dsh-tools` is present. The
 * tool definition is built lazily inside `registerScanTool` because importing
 * the host package at module scope would break standalone use and tests.
 *
 * @module dsh-anti-defensive-writing/tool
 */

import { scan, DETECTOR_VERSION, RULES } from './detector.js'

/** Hard cap on input size; the report stays meaningful and the call stays fast. */
const MAX_INPUT_CHARS = 200_000
/** Hits returned to the model; the aggregate stats still cover everything. */
const MAX_HITS = 40

export const TOOL_NAME = 'adw_scan'

/**
 * The `adw_scan` parameter map in the defineTool DSL. The single source of
 * truth for both the DSL path and the raw-JSON-Schema fallback.
 */
export function parameterSpec() {
  return {
    text: {
      type: 'string',
      description: 'The prose to scan. Provide either text or path, not both.',
    },
    path: {
      type: 'string',
      description: 'A workspace-relative or absolute path to a Markdown/text file to scan.',
    },
    section: {
      type: 'string',
      enum: [
        'abstract',
        'introduction',
        'related-work',
        'method',
        'experiments',
        'results',
        'discussion',
        'conclusion',
        'limitations',
        'rebuttal',
      ],
      description:
        'Paper section for scoring context. Omit to auto-detect from Markdown headings (Chinese and numbered headings included).',
    },
    minSeverity: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description:
        'List only hits at or above this severity. Defaults to the plugin config (low). Filters the list only; the score always reflects every hit.',
    },
  }
}

/**
 * Convert a defineTool parameter map to raw JSON Schema.
 * @param {Record<string, object>} spec
 */
export function parameterJsonSchema(spec = parameterSpec()) {
  const properties = {}
  const required = []
  for (const [name, field] of Object.entries(spec)) {
    const { required: isRequired, ...rest } = field
    properties[name] = rest
    if (isRequired === true) required.push(name)
  }
  return required.length > 0 ? { type: 'object', properties, required } : { type: 'object', properties }
}

/**
 * Build the tool definition object without importing the host package. The
 * caller passes in `defineTool` so this module stays host-free.
 *
 * @param {(definition: object) => object} defineTool - the host's defineTool.
 * @param {{ readFileText: (path: string, exec?: object) => Promise<string>, config: object }} deps
 */
export function buildScanTool(defineTool, deps) {
  return defineTool({
    name: TOOL_NAME,
    description:
      'Scan academic prose for defensive writing (自我削弱、主动认输、工作汇报式叙事、提前自我否定、比较范围越界). ' +
      'Returns a writing-health score, per-rule counts and pinpointed spans with line/column and a suggested action. ' +
      'Use it to check a draft before returning it, or when the user asks whether a passage sounds defensive. ' +
      'It never rewrites text: suggestions of kind "question" need the author to confirm evidence.',
    parameters: parameterSpec(),
    output: {
      schema: outputSchemaSpec(),
      render: (_args, value) => [
        {
          type: 'text',
          text: value.ok
            ? renderToolReport(value)
            : `adw_scan failed: ${value.error ?? 'unknown error'}`,
        },
      ],
      // The dashboard folds tool results from this metadata. Without it the
      // `tool/result` event carries no canonical value, so every model-driven
      // scan would be invisible to the panel.
      presentationMeta: (_args, value) => ({ adwScan: value }),
    },
    async execute(args, exec) {
      exec.signal?.throwIfAborted?.()
      try {
        let text
        if (typeof args.text === 'string' && args.text.trim() !== '') {
          text = args.text
        } else if (typeof args.path === 'string' && args.path.trim() !== '') {
          text = await deps.readFileText(args.path, { agent: exec.agent, signal: exec.signal })
        } else {
          return { ok: false, error: 'provide either `text` or `path`' }
        }
        if (text.length > MAX_INPUT_CHARS) {
          return { ok: false, error: `input is ${text.length} chars; the limit is ${MAX_INPUT_CHARS}` }
        }
        const report = scan(text, {
          ...(typeof args.section === 'string' && args.section !== '' ? { section: args.section } : {}),
          minSeverity: typeof args.minSeverity === 'string' ? args.minSeverity : deps.config.minSeverity,
          disabledRules: deps.config.disabledRules,
        })
        return toToolValue(report)
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/**
 * Shrink a Report to the tool's declared output. Aggregates stay complete; the
 * span list is capped.
 * @param {object} report
 */
export function toToolValue(report) {
  return {
    ok: true,
    score: report.score,
    defensiveDensity: report.defensiveDensity,
    stats: {
      chars: report.stats.chars,
      sentences: report.stats.sentences,
      hits: report.stats.hits,
      high: report.stats.high,
      medium: report.stats.medium,
      low: report.stats.low,
      suppressed: report.stats.suppressed,
      hidden: report.stats.hidden ?? 0,
    },
    byRule: report.byRule.map((row) => ({ ruleId: row.ruleId, count: row.count })),
    hits: report.hits.slice(0, MAX_HITS).map((hit) => ({
      ruleId: hit.ruleId,
      severity: hit.severity,
      kind: hit.kind,
      line: hit.line,
      column: hit.column,
      text: hit.text,
      section: hit.section,
      suggestion: hit.suggestion.note,
    })),
    truncated: report.truncated || report.hits.length > MAX_HITS,
  }
}

/** Human-readable rendering used by the tool result and tests. */
export function renderToolReport(value) {
  const lines = [
    `writing-health ${value.score}/100 · ${value.stats.hits} hit(s) ` +
      `(high ${value.stats.high} / medium ${value.stats.medium} / low ${value.stats.low})`,
  ]
  for (const hit of value.hits) {
    const flag = hit.kind === 'question' ? '?' : '→'
    lines.push(`${flag} L${hit.line}:${hit.column} ${hit.ruleId} "${hit.text}" — ${hit.suggestion}`)
  }
  if (value.truncated) lines.push(`(list truncated; ${value.stats.hits} hits in total)`)
  return lines.join('\n')
}

/**
 * Register the tool on a context that has `tools`.
 *
 * `defineTool` is imported dynamically rather than statically for two reasons:
 * the detector and the rest of the plugin must run outside DSH (tests, CI,
 * editor use), and a host without the tool registry should lose only this
 * layer, not the whole bundle.
 *
 * When the import fails — plain Node, a `link:` install whose peer lookup does
 * not reach the DSH runtime — the plugin still registers an equivalent
 * definition built by `buildRawToolDefinition`. `tools.register()` validates
 * `output.render` and the JSON Schema subset, and both builders produce the
 * same shape, so the fallback is not a degraded tool.
 *
 * @param {object} ctx
 * @param {{ readFileText: (path: string, exec?: object) => Promise<string>, config: object }} deps
 * @returns {Promise<boolean>} whether the tool was registered.
 */
export async function registerScanTool(ctx, deps) {
  const tools = ctx.get('tools')
  if (tools === undefined || typeof tools.register !== 'function') return false
  let defineTool
  try {
    ;({ defineTool } = await import('@deepseek-ai/dsh-tools'))
  } catch {
    defineTool = undefined
  }
  const definition =
    typeof defineTool === 'function'
      ? buildScanTool(defineTool, deps)
      : buildRawToolDefinition(deps)
  try {
    tools.register(definition)
    return true
  } catch (error) {
    ctx.logger?.warn?.(`dsh-anti-defensive-writing: adw_scan registration rejected: ${error}`)
    return false
  }
}

/**
 * Build the tool definition without `defineTool`.
 *
 * Mirrors what `defineTool` returns for the parameters/output declared in
 * `buildScanTool`: the registry accepts a plain object as long as
 * `output.render` is a function and the schema stays inside the supported
 * subset (type/oneOf/properties/required/additionalProperties/items/enum/const
 * plus annotations). Keeping the two builders adjacent makes drift visible.
 *
 * @param {{ readFileText: (path: string, exec?: object) => Promise<string>, config: object }} deps
 */
export function buildRawToolDefinition(deps) {
  const defined = buildScanTool((definition) => definition, deps)
  return {
    ...defined,
    parameters: parameterJsonSchema(),
    output: {
      ...defined.output,
      schema: dslToJsonSchema(defined.output.schema),
    },
  }
}

/**
 * The `adw_scan` output shape, written once in the defineTool value-schema DSL
 * (inline `required: true`). `dslToJsonSchema` converts it for the fallback
 * path, so the two forms cannot drift.
 *
 * `oneOf` of two closed objects is deliberate: a single object with every
 * report field required makes the `{ ok: false, error }` branch unrepresentable,
 * and the registry rejects such a value at the boundary — the tool then fails
 * with `INVALID_TOOL_OUTPUT` instead of returning its own message. Each branch
 * keeps the other branch's fields as optional so `additionalProperties: false`
 * does not double-count a stray field as a oneOf match.
 */
export function outputSchemaSpec() {
  const report = {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      error: { type: 'string' },
      score: { type: 'number', required: true },
      defensiveDensity: { type: 'number', required: true },
      stats: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          chars: { type: 'number', required: true },
          sentences: { type: 'number', required: true },
          hits: { type: 'number', required: true },
          high: { type: 'number', required: true },
          medium: { type: 'number', required: true },
          low: { type: 'number', required: true },
          suppressed: { type: 'number', required: true },
          hidden: { type: 'number', required: true },
        },
      },
      byRule: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ruleId: { type: 'string', required: true },
            count: { type: 'number', required: true },
          },
        },
      },
      hits: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ruleId: { type: 'string', required: true },
            severity: { type: 'string', required: true },
            kind: { type: 'string', required: true },
            line: { type: 'number', required: true },
            column: { type: 'number', required: true },
            text: { type: 'string', required: true },
            section: { type: 'string', required: true },
            suggestion: { type: 'string', required: true },
          },
        },
      },
      truncated: { type: 'boolean', required: true },
    },
  }
  const failure = {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      error: { type: 'string', required: true },
    },
  }
  return { oneOf: [report, failure] }
}

/**
 * Convert the defineTool DSL's inline `required: true` into raw JSON Schema
 * sibling `required: []` arrays. Only the two keywords differ; everything else
 * the DSL accepts is already valid raw JSON Schema.
 * @param {object} spec - DSL-shaped schema.
 * @returns {object} raw JSON Schema.
 */
export function dslToJsonSchema(spec) {
  if (spec === null || typeof spec !== 'object') return spec
  const out = {}
  const requiredKeys = []
  for (const [key, value] of Object.entries(spec)) {
    if (key === 'required' && value === true) continue
    if (key === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, dslToJsonSchema(child)]),
      )
      for (const [name, child] of Object.entries(value)) {
        if (child && child.required === true) requiredKeys.push(name)
      }
      continue
    }
    if (key === 'items') {
      out.items = dslToJsonSchema(value)
      continue
    }
    if (key === 'oneOf' && Array.isArray(value)) {
      out.oneOf = value.map(dslToJsonSchema)
      continue
    }
    out[key] = value
  }
  if (requiredKeys.length > 0) out.required = requiredKeys
  return out
}

/** Exposed for docs/tests. */
export const RULE_IDS = RULES.map((rule) => rule.id)
export { DETECTOR_VERSION }
