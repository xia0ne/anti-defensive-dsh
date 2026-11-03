/**
 * Skill provider adapter over the vendored upstream skill files.
 *
 * This module is an ADAPTER, not a module with its own business logic: the
 * content is the upstream Markdown, and everything here is shape conversion
 * into the `ctx.skills` provider interface. Keeping it this thin is the point —
 * syncing upstream never requires touching logic.
 *
 * Contract verified against `@deepseek-ai/dsh-skill` (0.2.1-rc.5):
 *   - `registerProvider(create)` calls `create(control)` once and reads
 *     `provider.name`; the name may not be "runtime".
 *   - `provider.list(options)` returns candidate summaries. Each candidate must
 *     have a kebab-case `name`, a non-empty `description`, an `invocation`
 *     object, and is returned to clients as a summary.
 *   - `provider.get(candidate, options)` returns the loaded definition:
 *     `{ name, description, invocation, provider, source, resourceBase, content }`.
 *     `definition.name` must equal `candidate.name` or the entry is invalidated.
 *
 * @module dsh-anti-defensive-writing/skill-provider
 */

import { fileURLToPath } from 'node:url'

import { BUNDLED_SKILL_RANK } from './compat.js'

/** Provider name shown in `skill` results. */
export const PROVIDER_NAME = 'anti-defensive-writing'

/**
 * The two vendored skills. `dir` is the resource base so referenced files can
 * be resolved relative to the skill; `locator` is the Markdown source.
 */
const SKILLS = Object.freeze([
  {
    name: 'anti-defensive-writing',
    label: '反防御性写作（中文）',
    description:
      '阻止论文的防御性写作。把论文视为一场学术发布会而非项目总结、实验日志或自我审查报告：围绕最强优势建立叙事，禁用自我贬低表达，不把打不过的指标设为主战场，让每个实验承担明确论证职责。触发词：论文润色、论文修改、写摘要、写引言、写结论、压缩论文、rebuttal、回复审稿意见、组织实验、论文AI味、防御性写作、心虚。',
    lang: 'zh',
    dir: 'skills/anti-defensive-writing',
    file: 'skills/anti-defensive-writing/SKILL.md',
  },
  {
    name: 'anti-defensive-writing-en',
    label: 'Anti-Defensive Writing (English)',
    description:
      'Stops defensive writing across the paper lifecycle. Treats the paper as a press conference, not a project summary or self-audit: identify the most publishable strength and build the most favourable, complete and persuasive narrative around it. Never volunteer weakness, never write an experiment diary, never attack the paper on the reviewer\'s behalf. Triggers: polish my paper, revise manuscript, write abstract, write introduction, write conclusion, shorten paper, rebuttal, respond to reviewers, organize experiments, defensive writing, AI-flavoured academic writing.',
    lang: 'en',
    dir: 'skills/anti-defensive-writing-en',
    file: 'skills/anti-defensive-writing-en/SKILL.md',
  },
])

/**
 * Build a skill provider definition.
 *
 * @param {object} deps
 * @param {(rel: string) => Promise<string>} deps.readAsset - reads a packaged asset as UTF-8.
 * @param {(rel: string) => URL} deps.asset - resolves a packaged asset URL.
 * @param {'zh'|'en'} [deps.language] - preferred skill ordering; both are always advertised.
 * @returns {object} provider accepted by `ctx.skills.registerProvider`.
 */
export function buildSkillProvider({ readAsset, asset, language = 'zh' }) {
  const ordered = language === 'en'
    ? [...SKILLS].sort((a, b) => (a.lang === 'en' ? -1 : 1))
    : [...SKILLS].sort((a, b) => (a.lang === 'zh' ? -1 : 1))

  /** @type {Map<string, object>} */
  const candidates = new Map()
  for (const skill of ordered) {
    candidates.set(skill.name, {
      name: skill.name,
      description: skill.description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: PROVIDER_NAME,
      source: 'bundled',
      // `URL.pathname` is percent-encoded; a workspace under a path with a
      // space (`~/My Papers/…`) produced `My%20Papers`, a directory that does
      // not exist, so the model-facing "base directory" was wrong.
      resourceBase: { kind: 'directory', path: fileURLToPath(asset(`${skill.dir}/`)) },
      rank: BUNDLED_SKILL_RANK,
      locator: skill.file,
    })
  }

  return {
    name: PROVIDER_NAME,

    /**
     * @param {{ signal?: AbortSignal }} [options]
     * @returns {Promise<object[]>} candidate summaries.
     */
    async list(options = {}) {
      options.signal?.throwIfAborted?.()
      return [...candidates.values()].map((candidate) => ({
        name: candidate.name,
        description: candidate.description,
        invocation: candidate.invocation,
        provider: candidate.provider,
        source: candidate.source,
        resourceBase: candidate.resourceBase,
        rank: candidate.rank,
      }))
    },

    /**
     * @param {{ name: string, locator?: string }} candidate
     * @param {{ signal?: AbortSignal }} [options]
     * @returns {Promise<object|undefined>} loaded skill definition.
     */
    async get(candidate, options = {}) {
      options.signal?.throwIfAborted?.()
      const definition = candidates.get(candidate.name)
      if (definition === undefined) return undefined
      const content = await readAsset(definition.locator)
      return {
        name: definition.name,
        description: definition.description,
        invocation: definition.invocation,
        provider: definition.provider,
        source: definition.source,
        resourceBase: definition.resourceBase,
        content,
      }
    },
  }
}

/** Exposed for tests and docs. */
export { SKILLS }
