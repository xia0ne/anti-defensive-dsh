/**
 * The plugin's configuration surface.
 *
 * Cordis accepts two shapes for `plugin.Config`: a native Schemastery schema
 * and a bare Standard-Schema object (`{'~standard': {validate}}`). Only the
 * native one is *discovered* by the profile's config inspector — a bare object
 * is reported as `status: "unsupported"` and the plugin loses its configuration
 * card on the Plugins page, so users see six settings they can never edit.
 *
 * The host resolves `@deepseek-ai/schemastery` for a profile-installed or
 * `link:`-installed bundle (verified against DSH 0.2.1-rc.5), so the native
 * path is what production uses. The detector package and this package's test
 * suite also run in plain Node with no `@deepseek-ai/*` on disk; there the
 * import fails and we fall back to the equivalent hand-written validator. The
 * two are kept side by side on purpose: a silent drift here would show up as a
 * settings page that accepts a value the plugin rejects at boot.
 *
 * @module dsh-anti-defensive-writing/config
 */

import { RULES } from './detector.js'

/** Defaults for every configuration key. */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  injectPrompt: true,
  tools: true,
  minSeverity: 'low',
  disabledRules: [],
  skillLanguage: 'zh',
})

const SEVERITIES = ['high', 'medium', 'low']
const LANGUAGES = ['zh', 'en']
const SEVERITY_SET = new Set(SEVERITIES)
const LANGUAGE_SET = new Set(LANGUAGES)

/**
 * Build the schema with a native Schemastery instance.
 * @param {object} Schema - the default export of `@deepseek-ai/schemastery`.
 */
function nativeConfig(Schema) {
  return Schema.object({
    enabled: Schema.boolean().default(true).description('总开关：关闭后不注册任何一层。'),
    injectPrompt: Schema.boolean()
      .default(true)
      .description('是否把「发布会原则」短提示注入 system prompt。'),
    tools: Schema.boolean().default(true).description('是否向模型注册 adw_scan 工具。'),
    minSeverity: Schema.union(SEVERITIES)
      .default('low')
      .description('报告与工具结果的最低显示严重度。只过滤列表，不影响分数。'),
    disabledRules: Schema.array(Schema.string())
      .default([])
      .description(`禁用的规则 id（属于指标定义，会从分数中排除）。可用：${RULES.map((rule) => rule.id).join('、')}`),
    skillLanguage: Schema.union(LANGUAGES)
      .default('zh')
      .description('两份 skill 同时可用，这里只决定排序优先级。'),
  })
}

/**
 * The portable equivalent, used only when the native schema library is not
 * resolvable (standalone tests, editor integrations).
 */
function portableConfig() {
  return {
    '~standard': {
      version: 1,
      vendor: 'dsh-anti-defensive-writing',
      validate(value) {
        const issues = []
        const input = value === undefined || value === null ? {} : value
        if (typeof input !== 'object' || Array.isArray(input)) {
          return { issues: [{ message: 'config must be an object', path: [] }] }
        }
        const out = { ...DEFAULT_CONFIG }
        const bool = (key) => {
          if (input[key] === undefined) return
          if (typeof input[key] !== 'boolean') issues.push({ message: `${key} must be a boolean`, path: [key] })
          else out[key] = input[key]
        }
        bool('enabled')
        bool('injectPrompt')
        bool('tools')
        if (input.minSeverity !== undefined) {
          if (!SEVERITY_SET.has(input.minSeverity)) {
            issues.push({ message: `minSeverity must be one of ${SEVERITIES.join('|')}`, path: ['minSeverity'] })
          } else out.minSeverity = input.minSeverity
        }
        if (input.skillLanguage !== undefined) {
          if (!LANGUAGE_SET.has(input.skillLanguage)) {
            issues.push({ message: `skillLanguage must be one of ${LANGUAGES.join('|')}`, path: ['skillLanguage'] })
          } else out.skillLanguage = input.skillLanguage
        }
        if (input.disabledRules !== undefined) {
          if (!Array.isArray(input.disabledRules) || input.disabledRules.some((item) => typeof item !== 'string')) {
            issues.push({ message: 'disabledRules must be a string array', path: ['disabledRules'] })
          } else out.disabledRules = [...input.disabledRules]
        }
        if (issues.length > 0) return { issues }
        return { value: out }
      },
    },
  }
}

let NativeSchema
try {
  NativeSchema = (await import('@deepseek-ai/schemastery')).default
} catch {
  NativeSchema = undefined
}

/** Whether the running host provided the native schema library. */
export const hasNativeConfig = NativeSchema !== undefined

export const Config = hasNativeConfig ? nativeConfig(NativeSchema) : portableConfig()
