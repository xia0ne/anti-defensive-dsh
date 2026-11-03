/**
 * The `/adw` slash command.
 *
 * Commands are human-facing: their output renders in the UI and is recorded as
 * `command/done`, but it never becomes a model message. That is exactly what a
 * lint report should be — visible to the author, invisible to the model, and
 * out of the prompt budget.
 *
 * Grammar (verified against `@deepseek-ai/dsh-commands` 0.2.1-rc.5):
 *   /adw scan <path> [--section <s>] [--min-severity high|medium|low]
 *   /adw rules [<rule-id>]
 *   /adw version
 *   /adw on | off
 *
 * The handler returns `{ kind: 'success', text }` or `{ kind: 'error', text }`.
 *
 * @module dsh-anti-defensive-writing/command
 */

import { scan, RULES, DETECTOR_VERSION } from './detector.js'

const USAGE = [
  '用法：',
  '  /adw scan <path> [--section <section>] [--min-severity high|medium|low]',
  '  /adw rules [<rule-id>]',
  '  /adw version',
  '  /adw on | off',
].join('\n')

/** Sections accepted by `--section`, mirrored from the detector's vocabulary. */
export const SECTIONS = Object.freeze([
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
])

/**
 * Parse `rawInput` into a verb plus arguments. Unknown flags are rejected with
 * a specific message rather than silently ignored, and a flag with no value is
 * an error instead of `undefined` reaching the scanner.
 * @param {string} raw
 */
export function parseAdwInput(raw) {
  const tokens = String(raw ?? '').trim().split(/\s+/).filter(Boolean)
  const verb = tokens.shift() ?? ''
  const flags = {}
  const positional = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '--section') {
      const value = tokens[++i]
      if (value === undefined || value.startsWith('--')) throw new Error('--section 需要一个值')
      flags.section = value
    } else if (token === '--min-severity') {
      const value = tokens[++i]
      if (value === undefined || value.startsWith('--')) throw new Error('--min-severity 需要一个值')
      flags.minSeverity = value
    } else if (token.startsWith('--')) {
      throw new Error(`未知参数：${token}`)
    } else {
      positional.push(token)
    }
  }
  if (flags.section !== undefined && !SECTIONS.includes(flags.section)) {
    throw new Error(`--section 只能是 ${SECTIONS.join(' | ')}`)
  }
  if (flags.minSeverity !== undefined && !['high', 'medium', 'low'].includes(flags.minSeverity)) {
    throw new Error('--min-severity 只能是 high | medium | low')
  }
  return { verb, positional, flags }
}

/**
 * Render a report as human-readable text. Deliberately compact: the UI panel
 * shows the full detail; the command is for a quick look and for logs.
 * @param {object} report
 * @param {string} [label]
 * @param {string} [section] - the section that was forced, when one was.
 */
export function renderReport(report, label, section) {
  const lines = []
  const scope = section === undefined ? '' : `（按 ${section} 计分）`
  lines.push(label === undefined ? '反防御性写作扫描' : `反防御性写作扫描：${label}${scope}`)
  lines.push(`写作健康度 ${report.score}/100 · 命中 ${report.stats.hits} 处（高 ${report.stats.high} / 中 ${report.stats.medium} / 低 ${report.stats.low}）· 防御密度 ${report.defensiveDensity}/句`)
  if (report.stats.suppressed > 0) {
    lines.push(`（另有 ${report.stats.suppressed} 处因章节语境被忽略）`)
  }
  if (report.stats.hidden > 0) {
    lines.push(`（列表已按严重度隐藏 ${report.stats.hidden} 处低级别命中；分数仍按全部命中计算）`)
  }
  if (report.hits.length === 0) {
    lines.push(report.stats.hits === 0 ? '未发现防御性写作信号。' : '当前严重度阈值下没有可显示的命中。')
    return lines.join('\n')
  }
  lines.push('')
  for (const hit of report.hits.slice(0, 20)) {
    const tag = hit.kind === 'question' ? '?' : '→'
    lines.push(`${tag} L${hit.line}:${hit.column} [${hit.ruleId}] 「${hit.text}」`)
    lines.push(`   ${hit.suggestion.note}`)
  }
  if (report.hits.length > 20) lines.push(`… 还有 ${report.hits.length - 20} 处。完整列表可用 adw_scan 或面板查看。`)
  if (report.truncated) lines.push('（结果已截断；完整统计见 report.stats）')
  return lines.join('\n')
}

/**
 * Render the rule catalogue, or one rule's detail.
 * @param {string} [ruleId]
 */
export function renderRules(ruleId) {
  if (ruleId !== undefined) {
    const rule = RULES.find((item) => item.id === ruleId)
    if (rule === undefined) return `没有规则 ${ruleId}。可用规则：${RULES.map((item) => item.id).join('、')}`
    const lines = [
      `${rule.id} · ${rule.name}（${rule.severity} · ${rule.kind}）`,
      rule.description,
      `为什么：${rule.rationale}`,
      `上游规则：${rule.upstream}`,
      '反例（不应命中）：',
      ...rule.negativeExamples.map((example) => `  - ${example}`),
    ]
    return lines.join('\n')
  }
  const lines = [`反防御性写作规则（detector v${DETECTOR_VERSION}）`, '']
  for (const rule of RULES) {
    lines.push(`${rule.severity === 'high' ? '●' : rule.severity === 'medium' ? '◐' : '○'} ${rule.id} · ${rule.name}`)
    lines.push(`    ${rule.description}`)
  }
  lines.push('')
  lines.push('用 /adw rules <rule-id> 查看单条规则与反例。')
  return lines.join('\n')
}

/**
 * Register the command on a context that has `commands`.
 *
 * `/adw on|off` flips the standing prompt reminder for this process. The
 * section's text is a thunk, so the change takes effect on the next assembled
 * prompt without a restart; before this, the command printed a success message
 * and changed nothing.
 *
 * @param {object} ctx
 * @param {{ scanFile: (path: string, exec?: object) => Promise<object>, config: object, promptGate?: { enabled: boolean } }} deps
 */
export function registerAdwCommand(ctx, deps) {
  const commands = ctx.get('commands')
  if (commands === undefined || typeof commands.register !== 'function') return
  commands.register({
    name: 'adw',
    description: '反防御性写作：扫描文件、查看规则、开关纪律提示',
    input: { hint: 'scan <path> | rules | version | on | off' },
    async handler({ rawInput, signal, agent }) {
      try {
        const { verb, positional, flags } = parseAdwInput(rawInput)
        signal?.throwIfAborted?.()
        switch (verb) {
          case 'scan': {
            if (positional.length === 0) return { kind: 'error', text: '缺少路径。\n' + USAGE }
            const path = positional[0]
            const report = await deps.scanFile(path, { agent, signal, section: flags.section, minSeverity: flags.minSeverity })
            return { kind: 'success', text: renderReport(report, path, flags.section) }
          }
          case 'rules':
            return { kind: 'success', text: renderRules(positional[0]) }
          case 'version':
            return {
              kind: 'success',
              text: `dsh-anti-defensive-writing · detector v${DETECTOR_VERSION} · ${RULES.length} 条规则`,
            }
          case 'on':
          case 'off': {
            const gate = deps.promptGate
            if (gate === undefined) {
              return {
                kind: 'error',
                text: '当前 host 没有提供纪律提示开关（插件以 injectPrompt: false 运行）。',
              }
            }
            gate.enabled = verb === 'on'
            return {
              kind: 'success',
              text: verb === 'on'
                ? '反防御性写作提示已开启，下一次模型请求生效。'
                : '反防御性写作提示已关闭，下一次模型请求生效（skill、扫描工具和面板不受影响）。',
            }
          }
          case '':
            return { kind: 'error', text: USAGE }
          default:
            return { kind: 'error', text: `未知子命令 ${verb}。\n${USAGE}` }
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
