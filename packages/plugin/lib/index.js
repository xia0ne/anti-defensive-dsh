/**
 * dsh-anti-defensive-writing — host half.
 *
 * Registers, in order of how much they depend on the host:
 *
 *   1. a skill provider carrying the two upstream SKILL.md files verbatim;
 *   2. a slash command (`/adw`) for scanning files and inspecting rules;
 *   3. an optional model-facing tool (`adw_scan`) for self-checks;
 *   4. an optional system-prompt section with the one-line principle;
 *   5. a session projection (`adwWriting`) feeding the dashboard.
 *
 * Every registration goes through `ctx.inject([...])`, so the package loads on
 * a host that composes only some of the layers: a missing service leaves that
 * child fiber pending instead of failing the bundle.
 *
 * @module dsh-anti-defensive-writing
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import { scan, RULES, DETECTOR_VERSION } from './detector.js'
import { buildSkillProvider } from './skill-provider.js'
import { registerAdwCommand } from './command.js'
import { registerScanTool } from './tool.js'
import { registerWritingHealth } from './projection.js'

/** Stable Cordis plugin name. */
export const name = 'anti-defensive-writing'

/**
 * No hard service dependency: each layer below declares its own via
 * `ctx.inject`, so a host missing one layer still gets the others.
 */
export const inject = []

/** Defaults for every configuration key. */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  injectPrompt: true,
  tools: true,
  minSeverity: 'low',
  disabledRules: [],
  skillLanguage: 'zh',
})

const SEVERITIES = new Set(['high', 'medium', 'low'])
const LANGUAGES = new Set(['zh', 'en'])

/**
 * Configuration schema in the Standard Schema shape Cordis validates against
 * (`Config['~standard'].validate(value)`). Written by hand so the package has
 * no runtime dependency on a schema library.
 */
export const Config = {
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
        if (!SEVERITIES.has(input.minSeverity)) issues.push({ message: 'minSeverity must be high|medium|low', path: ['minSeverity'] })
        else out.minSeverity = input.minSeverity
      }
      if (input.skillLanguage !== undefined) {
        if (!LANGUAGES.has(input.skillLanguage)) issues.push({ message: 'skillLanguage must be zh|en', path: ['skillLanguage'] })
        else out.skillLanguage = input.skillLanguage
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

/** Resolve a packaged asset path. */
function asset(rel) {
  return new URL(`../${rel}`, import.meta.url)
}

/** Read a packaged text asset. */
function readAssetBytes(rel) {
  return readFile(asset(rel), 'utf8')
}

/**
 * The one-line principle injected as a prompt section. Deliberately short:
 * the full 12 rules live in the skill and are loaded on demand, so a normal
 * turn does not pay for them.
 */
export const PROMPT_SECTION = [
  '论文写作纪律（发布会原则）：论文是一场学术发布会，不是项目总结、实验日志或自我审查报告。',
  '只围绕本文最强的优势组织叙事；不写「我们做了什么、试过什么、哪些失败了」的过程；',
  '禁用自我削弱式表达（「遗憾的是」「仅」「仍明显落后」「效果有限」「存在严重不足」）；',
  '打不过的指标不设为比赛项目；不占优的结果不说输；优势必须主动说清楚；',
  '每个实验必须承担明确论证职责；结论只强化记忆点，不在最后突然自我否定。',
  '改写论文时保留作者原有用词习惯与段落结构，只做必要的最小改动；没有问题的部分不要动。',
  '不得为了减少「防御性写作」而夸大主张、编造数字或删除必要的局限性说明——',
  '检测器只做语言建议，主张强度必须由证据决定。',
].join('')

/**
 * Cordis apply.
 * @param {object} ctx - Cordis context.
 * @param {object} [config] - validated plugin configuration.
 */
export function apply(ctx, config = DEFAULT_CONFIG) {
  const resolved = { ...DEFAULT_CONFIG, ...(config ?? {}) }
  if (!resolved.enabled) return

  // 1) Skill provider — the upstream capability itself.
  ctx.inject(['skills'], (scoped) => {
    const skills = scoped.get('skills')
    if (skills === undefined || typeof skills.registerProvider !== 'function') return
    // registerProvider takes a FACTORY: create(control) -> provider. Passing a
    // provider object throws `create is not a function` at activation.
    skills.registerProvider(() =>
      buildSkillProvider({
        readAsset: readAssetBytes,
        asset,
        language: resolved.skillLanguage,
      }),
    )
  })

  // 2) Slash command — human-facing, never becomes a model message.
  ctx.inject(['commands'], (scoped) => {
    registerAdwCommand(scoped, {
      scanFile: async (path) => scan(await readWorkspaceFile(path, scoped), { minSeverity: resolved.minSeverity, disabledRules: resolved.disabledRules }),
      config: resolved,
    })
  })

  // 3) Model-facing tool — optional, for self-checks.
  if (resolved.tools) {
    ctx.inject(['tools'], (scoped) => {
      // Fire-and-forget by design: the tool layer is optional, and a host
      // without @deepseek-ai/dsh-tools must not stall the rest of the plugin.
      registerScanTool(scoped, {
        readFileText: (path) => readWorkspaceFile(path, scoped),
        config: resolved,
      }).catch((error) => {
        scoped.logger?.warn?.(`dsh-anti-defensive-writing: adw_scan registration failed: ${error}`)
      })
    })
  }

  // 4) Prompt section — the standing reminder.
  if (resolved.injectPrompt) {
    ctx.inject(['systemPrompt'], (scoped) => {
      const systemPrompt = scoped.get('systemPrompt')
      if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') return
      systemPrompt.section({
        name: 'dsh-adw:writing-discipline',
        order: 10050,
        text: PROMPT_SECTION,
        interpolate: false,
      })
    })
  }

  // 5) Session projection — the dashboard read model.
  ctx.inject(['sessionProjections'], (scoped) => {
    registerWritingHealth(scoped, { scan })
  })
}

/**
 * Read a file inside the session working directory. Relative paths resolve
 * against the workspace root; traversal outside it is refused. The command and
 * tool are conveniences, not a sandbox escape hatch.
 * @param {string} path - user-supplied path.
 * @param {object} ctx - Cordis context.
 */
export async function readWorkspaceFile(path, ctx) {
  if (typeof path !== 'string' || path.trim() === '') throw new Error('path must be a non-empty string')
  const root = await workingDirectoryOf(ctx)
  const absolute = isAbsolute(path) ? path : resolve(root, path)
  const rel = relative(root, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`refusing to read outside the workspace: ${path}`)
  }
  if (!existsSync(absolute)) throw new Error(`file not found: ${path}`)
  return readFile(absolute, 'utf8')
}

/** Best-effort workspace root; falls back to the process cwd. */
async function workingDirectoryOf(ctx) {
  try {
    const service = ctx.get?.('workingDirectory')
    if (service && typeof service.ensure === 'function') {
      const cwd = await service.ensure(undefined)
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
  } catch {
    // fall through to cwd
  }
  return process.cwd()
}

/** Re-export the detector surface for host-side consumers and tests. */
export { scan, RULES, DETECTOR_VERSION }
