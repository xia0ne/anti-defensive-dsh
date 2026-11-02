/**
 * dsh-anti-defensive-writing — browser half.
 *
 * Hand-authored client bundle in the DSH module-loader factory-CJS format:
 * `window.__ModuleLoader__.load({ id, factory })`. The factory receives the
 * module-table `require`, so only shell-externalized modules may be imported
 * (`react`, `react/jsx-runtime` are in the static table).
 *
 * Surfaces:
 *   1. a right-sidebar tab 「写作健康」 (kind `adw-writing-health`) that reads
 *      the `adwWriting` projection — score ring, per-rule bars, trend
 *      sparkline, before/after pairs, and the latest hits;
 *   2. a settings section 「反防御性写作」 listing the rules with their
 *      counter-examples, so users can see exactly what is and is not checked.
 *
 * All numbers come from the host projection. The client never scans text and
 * never invents a metric.
 */
window.__ModuleLoader__.load({
  id: 'dsh-anti-defensive-writing',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const jsx = require('react/jsx-runtime')
    const React = require('react')

    // ── styles ─────────────────────────────────────────────────────────────
    const CSS_ID = 'dsh-anti-defensive-writing/writing-health.css'
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-anti-defensive-writing'
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = [
        '.adw-root{box-sizing:border-box;width:100%;height:100%;overflow-y:auto;padding:16px 14px 28px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
        '.adw-card{background:var(--dsw-alias-bg-module-platform);background:color-mix(in srgb,var(--dsw-alias-bg-module-platform) 88%,transparent);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}',
        '.adw-card-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}',
        '.adw-hero{display:flex;align-items:center;gap:16px}',
        '.adw-ring{position:relative;width:96px;height:96px;flex:0 0 auto}',
        '.adw-ring svg{transform:rotate(-90deg)}',
        '.adw-ring-value{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0}',
        '.adw-ring-num{font-size:26px;font-weight:700;line-height:30px;letter-spacing:-.02em}',
        '.adw-ring-unit{font-size:10px;color:var(--dsw-alias-label-tertiary)}',
        '.adw-hero-meta{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}',
        '.adw-hero-line{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
        '.adw-hero-label{color:var(--dsw-alias-label-tertiary);font-size:12px}',
        '.adw-hero-value{font-size:16px;font-weight:600}',
        '.adw-badge{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:1px 8px;font-size:11px;line-height:18px;border:1px solid transparent}',
        '.adw-badge-high{color:#d64545;background:rgba(214,69,69,.10);border-color:rgba(214,69,69,.28)}',
        '.adw-badge-medium{color:#c77d1a;background:rgba(199,125,26,.10);border-color:rgba(199,125,26,.28)}',
        '.adw-badge-low{color:#3d7fc9;background:rgba(61,127,201,.10);border-color:rgba(61,127,201,.28)}',
        '.adw-badge-clean{color:#2f9e63;background:rgba(47,158,99,.10);border-color:rgba(47,158,99,.28)}',
        '.adw-row{display:flex;align-items:center;gap:8px;min-width:0}',
        '.adw-row-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
        '.adw-row-count{flex:0 0 auto;font-variant-numeric:tabular-nums;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
        '.adw-bar{height:6px;border-radius:3px;background:var(--dsw-alias-border-l1);overflow:hidden;flex:0 0 auto;width:70px}',
        '.adw-bar i{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary)}',
        '.adw-spark{width:100%;height:56px;display:block}',
        '.adw-pairs{display:flex;flex-direction:column;gap:6px}',
        '.adw-pair{display:flex;align-items:center;gap:8px;font-size:12px;font-variant-numeric:tabular-nums}',
        '.adw-pair-arrow{color:var(--dsw-alias-label-tertiary)}',
        '.adw-up{color:#2f9e63}',
        '.adw-down{color:#d64545}',
        '.adw-empty{padding:28px 16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px;display:flex;flex-direction:column;gap:6px;align-items:center}',
        '.adw-empty-title{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600}',
        '.adw-hint{color:var(--dsw-alias-label-dimmed);font-size:11px;line-height:17px}',
        '.adw-rule{display:flex;flex-direction:column;gap:4px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
        '.adw-rule:first-of-type{border-top:none}',
        '.adw-rule-head{display:flex;align-items:center;gap:8px}',
        '.adw-rule-name{font-weight:600;font-size:12px}',
        '.adw-rule-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--dsw-alias-label-dimmed)}',
        '.adw-rule-desc{color:var(--dsw-alias-label-tertiary);font-size:12px}',
        '.adw-negative{color:var(--dsw-alias-label-dimmed);font-size:11px;line-height:17px}',
        // ── hero refinements ──
        '.adw-hero-card{gap:12px}',
        '.adw-hero-sub{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:11px}',
        '.adw-dot-sep{opacity:.5}',
        '.adw-hero-foot{color:var(--dsw-alias-label-dimmed);font-size:11px;line-height:16px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}',
        '.adw-delta{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;border-radius:6px;padding:0 6px;line-height:18px;background:var(--dsw-alias-bg-layer-1)}',
        '.adw-up{color:#2f9e63}',
        '.adw-down{color:#d64545}',
        '.adw-flat{color:var(--dsw-alias-label-tertiary)}',
        // ── severity mix ──
        '.adw-mix{display:flex;flex-direction:column;gap:5px;margin-top:2px}',
        '.adw-mix-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--dsw-alias-border-l1)}',
        '.adw-mix-bar span{display:block;height:100%}',
        '.adw-mix-bar span+span{box-shadow:inset 1px 0 0 rgba(255,255,255,.45)}',
        '.adw-mix-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:var(--dsw-alias-label-tertiary)}',
        '.adw-mix-item{display:inline-flex;align-items:center;gap:4px}',
        '.adw-mix-item i{width:7px;height:7px;border-radius:2px;display:inline-block}',
        '.adw-mix-empty{font-size:11px;color:#2f9e63;font-weight:600}',
        // ── card meta ──
        '.adw-card-meta{font-size:10px;color:var(--dsw-alias-label-dimmed);font-variant-numeric:tabular-nums;font-weight:400}',
        // ── rule rows ──
        '.adw-row-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.adw-row-sub{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;color:var(--dsw-alias-label-dimmed);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.adw-row-label{display:flex;flex-direction:column;gap:0;line-height:14px}',
        '.adw-row{padding:3px 0}',
        // ── hit cards ──
        '.adw-hits-card{gap:8px}',
        '.adw-filters{display:flex;gap:5px;flex-wrap:wrap}',
        '.adw-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font:inherit;font-size:11px;line-height:18px;cursor:pointer;transition:background .15s,border-color .15s}',
        '.adw-chip:hover{background:var(--dsw-alias-bg-layer-1)}',
        '.adw-chip-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
        '.adw-chip-count{font-variant-numeric:tabular-nums;opacity:.75}',
        '.adw-hit-list{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}',
        '.adw-hit{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:7px 9px;display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-layer-1)}',
        '.adw-hit-head{display:flex;align-items:center;gap:6px;font-size:11px}',
        '.adw-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}',
        '.adw-dot-high{background:#d64545}',
        '.adw-dot-medium{background:#c77d1a}',
        '.adw-dot-low{background:#3d7fc9}',
        '.adw-hit-rule{font-weight:600;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.adw-hit-loc{margin-left:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--dsw-alias-label-dimmed);flex:0 0 auto}',
        '.adw-hit-kind{width:15px;height:15px;border-radius:50%;background:rgba(199,125,26,.15);color:#c77d1a;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}',
        '.adw-hit-sentence{font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer;position:relative;padding-right:14px;word-break:break-word}',
        '.adw-hit-sentence:hover{color:var(--dsw-alias-label-primary)}',
        '.adw-hit-toggle{position:absolute;right:0;top:0;color:var(--dsw-alias-label-dimmed);font-weight:700}',
        '.adw-hit-note{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary);border-top:1px dashed var(--dsw-alias-border-l1);padding-top:5px}',
        '.adw-hit-note-question{color:#9a6410;background:rgba(199,125,26,.07);border:1px solid rgba(199,125,26,.20);border-radius:7px;padding:5px 7px;margin-top:2px}',
        // ── pairs ──
        '.adw-pair{display:flex;align-items:center;gap:10px;font-size:12px;font-variant-numeric:tabular-nums;padding:5px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
        '.adw-pair:first-child{border-top:none}',
        '.adw-pair-scores{display:inline-flex;align-items:center;gap:5px;font-weight:600}',
        '.adw-pair-before{color:var(--dsw-alias-label-tertiary)}',
        '.adw-pair-arrow{color:var(--dsw-alias-label-dimmed);font-weight:400}',
        '.adw-pair-after{color:var(--dsw-alias-label-primary)}',
        '.adw-pair-delta{font-weight:600;min-width:38px}',
        '.adw-pair-hits{margin-left:auto;color:var(--dsw-alias-label-dimmed);font-size:11px}',
        // ── empty & footer ──
        '.adw-empty-hint{margin-top:4px;font-size:11px;color:var(--dsw-alias-label-dimmed)}',
        '.adw-empty-hint code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:0 4px}',
        '.adw-footer{border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px;margin-top:2px}',
      ].join('')
      document.head.appendChild(tag)
    }

    // ── i18n ───────────────────────────────────────────────────────────────
    const NS = 'dsh-anti-defensive-writing'
    const zh = {
      'tab.title': '写作健康',
      'tab.guide': '查看防御性写作的分数、命中分布与改写前后对比。',
      'panel.empty.title': '还没有可统计的样本',
      'panel.empty.body': '发起一次写作或改写，或运行 /adw scan <path>，这里就会出现分数与命中分布。',
      'panel.score': '写作健康度',
      'panel.score.hint': '100 = 未发现防御性表达；分数是诊断指标，不是目标。',
      'panel.last': '最近一次',
      'panel.last.none': '暂无',
      'panel.hits': '命中',
      'panel.high': '高',
      'panel.medium': '中',
      'panel.low': '低',
      'panel.clean': '干净',
      'panel.rules': '按规则分布',
      'panel.rules.empty': '暂无命中',
      'panel.trend': '分数趋势',
      'panel.trend.points': '{n} 个样本',
      'panel.pairs': '改写前后',
      'panel.pairs.empty': '还没有前后对比',
      'panel.pairs.line': '改写前 {before} → 改写后 {after}',
      'panel.hits.list': '命中明细',
      'panel.hits.empty': '这次没有命中。',
      'panel.filter.all': '全部',
      'panel.delta.title': '相比上一次扫描',
      'panel.best': '最好',
      'panel.worst': '最差',
      'panel.trend.aria': '写作健康度随扫描次数的变化趋势',
      'panel.kind.question': '需要你确认证据，检测器不代改',
      'panel.pairs.count': '{n} 组',
      'panel.empty.commandHint': '扫描，或直接在对话里写/改一段文字。',
      'panel.scans': '{n} 次扫描',
      'panel.source.tool': '工具扫描',
      'panel.source.command': '命令扫描',
      'panel.source.assistant': '模型回复',
      'panel.source.none': '暂无',
      'panel.footer': '检测器只做语言建议；涉及证据强度的建议以问句出现，不自动改写。',
      'settings.nav': '反防御性写作',
      'settings.title': '反防御性写作',
      'settings.intro': '离线检测器会扫描中文与英文的自我削弱表达、主动认输、工作汇报式叙事、提前自我否定与比较范围越界。它不会修改文字，也不会判断科学结论。',
      'settings.rules': '内置规则',
      'settings.negatives': '不会命中的反例（设计如此）',
      'settings.usage': '用法',
      'settings.usage.body': '/adw scan <path> 扫描文件；/adw rules 查看规则；模型自查可调用 adw_scan 工具。',
    }
    const en = {
      'tab.title': 'Writing Health',
      'tab.guide': 'Defensive-writing score, per-rule distribution, and before/after comparisons.',
      'panel.empty.title': 'Nothing to measure yet',
      'panel.empty.body': 'Write or revise something, or run /adw scan <path>, and the score and rule distribution appear here.',
      'panel.score': 'Writing health',
      'panel.score.hint': '100 = no defensive phrasing detected; the score is diagnostic, not a target.',
      'panel.last': 'Latest',
      'panel.last.none': 'n/a',
      'panel.hits': 'Hits',
      'panel.high': 'High',
      'panel.medium': 'Medium',
      'panel.low': 'Low',
      'panel.clean': 'Clean',
      'panel.rules': 'By rule',
      'panel.rules.empty': 'No hits',
      'panel.trend': 'Score trend',
      'panel.trend.points': '{n} samples',
      'panel.pairs': 'Before / after',
      'panel.pairs.empty': 'No rewrite pairs yet',
      'panel.pairs.line': 'before {before} → after {after}',
      'panel.hits.list': 'Hits',
      'panel.hits.empty': 'No hits in this sample.',
      'panel.filter.all': 'All',
      'panel.delta.title': 'vs. the previous scan',
      'panel.best': 'Best',
      'panel.worst': 'Worst',
      'panel.trend.aria': 'Writing-health score across scans',
      'panel.kind.question': 'Needs your evidence check; the detector will not rewrite it',
      'panel.pairs.count': '{n} pairs',
      'panel.empty.commandHint': 'to scan a file, or just write/revise prose in the chat.',
      'panel.scans': '{n} scans',
      'panel.source.tool': 'tool scan',
      'panel.source.command': 'command scan',
      'panel.source.assistant': 'assistant reply',
      'panel.source.none': 'none',
      'panel.footer': 'The detector only makes wording suggestions; evidence-strength questions are asked, never auto-rewritten.',
      'settings.nav': 'Anti-Defensive Writing',
      'settings.title': 'Anti-Defensive Writing',
      'settings.intro': 'An offline detector scans Chinese and English prose for self-weakening hedges, loss framing, work-report narration, premature self-negation and comparison-scope creep. It never edits text and never judges scientific merit.',
      'settings.rules': 'Built-in rules',
      'settings.negatives': 'Counter-examples that deliberately do not fire',
      'settings.usage': 'Usage',
      'settings.usage.body': '/adw scan <path> scans a file; /adw rules lists rules; the model can call the adw_scan tool for a self-check.',
    }

    /** Interpolate `{name}` placeholders. */
    function fmt(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (_, key) => String(values?.[key] ?? ''))
    }

    // ── shared bits ────────────────────────────────────────────────────────
    const SEVERITY_COLOR = { high: '#d64545', medium: '#c77d1a', low: '#3d7fc9' }

    function scoreColor(score) {
      if (score >= 85) return '#2f9e63'
      if (score >= 60) return '#c77d1a'
      return '#d64545'
    }

    /** Circular score gauge. */
    function ScoreRing({ score }) {
      const radius = 42
      const circumference = 2 * Math.PI * radius
      const clamped = Math.max(0, Math.min(100, score))
      const dash = (clamped / 100) * circumference
      const color = scoreColor(clamped)
      return jsx.jsx('div', {
        className: 'adw-ring',
        role: 'img',
        'aria-label': `score ${clamped} of 100`,
        children: [
          jsx.jsxs('svg', {
            width: 96,
            height: 96,
            viewBox: '0 0 96 96',
            children: [
              jsx.jsx('circle', {
                cx: 48, cy: 48, r: radius, fill: 'none',
                stroke: 'var(--dsw-alias-border-l1)', strokeWidth: 8,
              }),
              jsx.jsx('circle', {
                cx: 48, cy: 48, r: radius, fill: 'none',
                stroke: color, strokeWidth: 8, strokeLinecap: 'round',
                strokeDasharray: `${dash} ${circumference - dash}`,
              }),
            ],
          }),
          jsx.jsxs('div', {
            className: 'adw-ring-value',
            children: [
              jsx.jsx('span', { className: 'adw-ring-num', style: { color }, children: clamped }),
              jsx.jsx('span', { className: 'adw-ring-unit', children: '/100' }),
            ],
          }),
        ],
      })
    }

    /** A compact score-trend chart, no chart library. */
    function Sparkline({ points, ariaLabel }) {
      if (points.length === 0) return null
      const width = 280
      const height = 64
      const padX = 6
      const padY = 8
      const step = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0
      const y = (score) => padY + (1 - Math.max(0, Math.min(100, score)) / 100) * (height - padY * 2)
      const coords = points.map((point, index) => [padX + index * step, y(point.score)])
      const line = coords.map(([cx, cy], index) => `${index === 0 ? 'M' : 'L'}${cx.toFixed(2)},${cy.toFixed(2)}`).join(' ')
      const area = `${line} L${coords[coords.length - 1][0].toFixed(2)},${height - padY} L${coords[0][0].toFixed(2)},${height - padY} Z`
      const last = points[points.length - 1]
      const color = scoreColor(last.score)
      return jsx.jsxs('svg', {
        className: 'adw-spark',
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': ariaLabel ?? `score trend over ${points.length} samples`,
        children: [
          // Reference lines at 100 / 75 / 50 / 25 keep the slope readable.
          ...[100, 75, 50, 25].map((level) =>
            jsx.jsx('line', {
              x1: 0, x2: width, y1: y(level), y2: y(level),
              stroke: 'var(--dsw-alias-border-l1)',
              strokeWidth: level === 100 ? 1 : 0.5,
              strokeDasharray: level === 100 ? '4 4' : '2 6',
            }, level),
          ),
          jsx.jsx('path', { d: area, fill: color, opacity: 0.10, stroke: 'none' }),
          jsx.jsx('path', { d: line, fill: 'none', stroke: color, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }),
          ...coords.map(([cx, cy], index) =>
            index === coords.length - 1
              ? null
              : jsx.jsx('circle', { cx, cy, r: 1.6, fill: color, opacity: 0.55 }, index),
          ),
          jsx.jsx('circle', { cx: coords[coords.length - 1][0], cy: coords[coords.length - 1][1], r: 3.2, fill: color }),
        ],
      })
    }

    /** One rule row: name, machine id, proportional bar, count. */
    function RuleRow({ label, sublabel, count, max, severity }) {
      const pct = max === 0 ? 0 : Math.round((count / max) * 100)
      const color = SEVERITY_COLOR[severity] ?? 'var(--dsw-alias-brand-primary)'
      return jsx.jsxs('div', {
        className: 'adw-row',
        children: [
          jsx.jsxs('span', {
            className: 'adw-row-label',
            title: `${label} (${sublabel ?? ''})`,
            children: [
              jsx.jsx('span', { className: 'adw-row-name', children: label }),
              sublabel ? jsx.jsx('span', { className: 'adw-row-sub', children: sublabel }) : null,
            ],
          }),
          jsx.jsx('span', { className: 'adw-bar', children: jsx.jsx('i', { style: { width: `${pct}%`, background: color } }) }),
          jsx.jsx('span', { className: 'adw-row-count', children: count }),
        ],
      })
    }

    // ── sidebar tab body ───────────────────────────────────────────────────
    /**
     * The tab body. The slot supplies `sessionId`, `useProjection`, `t` and the
     * tab-domain hooks; nothing here fetches.
     */
    // ── hit card ───────────────────────────────────────────────────────────
    const SEVERITY_LABEL = { high: '高', medium: '中', low: '低' }

    /** One hit: what was said, where, and what to do about it. */
    function HitCard({ hit, t }) {
      const [open, setOpen] = React.useState(false)
      const canExpand = typeof hit.sentence === 'string' && hit.sentence !== ''
      return jsx.jsxs('div', {
        className: 'adw-hit',
        children: [
          jsx.jsxs('div', {
            className: 'adw-hit-head',
            children: [
              jsx.jsx('span', { className: `adw-dot adw-dot-${hit.severity}`, 'aria-hidden': 'true' }),
              jsx.jsx('span', { className: 'adw-hit-rule', children: hit.ruleName || hit.ruleId }),
              jsx.jsxs('span', {
                className: 'adw-hit-loc',
                children: ['L', hit.line, ':', hit.column],
              }),
              hit.kind === 'question'
                ? jsx.jsx('span', { className: 'adw-hit-kind', title: t('panel.kind.question'), children: '?' })
                : null,
            ],
          }),
          jsx.jsxs('div', {
            className: 'adw-hit-sentence',
            onClick: canExpand ? () => setOpen((value) => !value) : undefined,
            role: canExpand ? 'button' : undefined,
            tabIndex: canExpand ? 0 : undefined,
            onKeyDown: canExpand
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setOpen((value) => !value)
                  }
                }
              : undefined,
            children: [
              jsx.jsx('span', { children: open || !canExpand ? hit.sentence : hit.excerpt }),
              canExpand ? jsx.jsx('span', { className: 'adw-hit-toggle', children: open ? '−' : '+' }) : null,
            ],
          }),
          open || hit.kind === 'question'
            ? jsx.jsx('div', {
                className: `adw-hit-note${hit.kind === 'question' ? ' adw-hit-note-question' : ''}`,
                children: hit.note,
              })
            : null,
        ],
      })
    }

    /** Integer percentages from raw counts, for v1 views without `mix`. */
    function deriveMix(last) {
      const total = last.high + last.medium + last.low
      if (total === 0) return { high: 0, medium: 0, low: 0 }
      return {
        high: Math.round((last.high / total) * 100),
        medium: Math.round((last.medium / total) * 100),
        low: Math.round((last.low / total) * 100),
      }
    }

    /** A labelled meter: 高/中/低 severity split. */
    function SeverityMix({ mix, total, t }) {
      const rows = [
        { key: 'high', label: t('panel.high'), color: '#d64545', value: mix.high },
        { key: 'medium', label: t('panel.medium'), color: '#c77d1a', value: mix.medium },
        { key: 'low', label: t('panel.low'), color: '#3d7fc9', value: mix.low },
      ]
      if (total === 0) {
        return jsx.jsx('div', { className: 'adw-mix-empty', children: t('panel.clean') })
      }
      return jsx.jsxs('div', {
        className: 'adw-mix',
        children: [
          jsx.jsx('div', {
            className: 'adw-mix-bar',
            role: 'img',
            'aria-label': rows.map((row) => `${row.label} ${row.value}%`).join(', '),
            children: rows.map((row) =>
              row.value === 0
                ? null
                : jsx.jsx('span', {
                    style: { width: `${row.value}%`, background: row.color },
                    title: `${row.label} ${row.value}%`,
                  }, row.key),
            ),
          }),
          jsx.jsxs('div', {
            className: 'adw-mix-legend',
            children: rows.map((row) =>
              jsx.jsxs('span', {
                className: 'adw-mix-item',
                children: [
                  jsx.jsx('i', { style: { background: row.color } }),
                  `${row.label} ${row.value}%`,
                ],
              }, row.key),
            ),
          }),
        ],
      })
    }

    /** A single before/after rewrite row with the score delta. */
    function PairRow({ pair, t }) {
      const diff = pair.after - pair.before
      const tone = diff > 0 ? 'adw-up' : diff < 0 ? 'adw-down' : 'adw-flat'
      return jsx.jsxs('div', {
        className: 'adw-pair',
        children: [
          jsx.jsxs('span', {
            className: 'adw-pair-scores',
            children: [
              jsx.jsx('span', { className: 'adw-pair-before', children: pair.before }),
              jsx.jsx('span', { className: 'adw-pair-arrow', children: '→' }),
              jsx.jsx('span', { className: 'adw-pair-after', children: pair.after }),
            ],
          }),
          jsx.jsx('span', {
            className: `adw-pair-delta ${tone}`,
            children: `${diff > 0 ? '+' : ''}${diff}`,
          }),
          jsx.jsxs('span', {
            className: 'adw-pair-hits',
            children: [`${pair.beforeHits} → ${pair.afterHits}`, ' ', t('panel.hits')],
          }),
        ],
      })
    }

    // ── sidebar tab body ───────────────────────────────────────────────────
    /**
     * The tab body. The slot supplies `sessionId`, `useProjection`, `t` and the
     * tab-domain hooks; nothing here fetches.
     */
    function WritingHealthTab(props) {
      const t = props.t
      const view = typeof props.useProjection === 'function' ? props.useProjection('adwWriting') : undefined
      const [filter, setFilter] = React.useState('all')

      if (view === undefined || view === null || view.trend.length === 0) {
        return jsx.jsxs('div', {
          className: 'adw-root',
          children: [
            jsx.jsxs('div', {
              className: 'adw-empty',
              children: [
                jsx.jsx('div', { className: 'adw-empty-title', children: t('panel.empty.title') }),
                jsx.jsx('div', { children: t('panel.empty.body') }),
                jsx.jsxs('div', {
                  className: 'adw-empty-hint',
                  children: [
                    jsx.jsx('code', { children: '/adw scan <path>' }),
                    ' ',
                    t('panel.empty.commandHint'),
                  ],
                }),
              ],
            }),
            jsx.jsx('div', { className: 'adw-hint', children: t('panel.footer') }),
          ],
        })
      }

      const last = view.last
      const delta = view.delta
      const recent = Array.isArray(view.recent) ? view.recent : []
      // v1 projected views (persisted checkpoints from an earlier build) have no
      // `mix`; derive it rather than crashing the tab.
      const mix = view.mix ?? deriveMix(last)
      const summary = view.summary ?? { distinctRules: 0, totalHits: last.hits, averageScore: last.score, worstScore: last.score, bestScore: last.score }
      const filtered = filter === 'all' ? recent : recent.filter((hit) => hit.severity === filter)
      const maxRule = view.byRule.length === 0 ? 0 : Math.max(...view.byRule.map((row) => row.count))
      const filters = [
        { id: 'all', label: t('panel.filter.all'), count: recent.length },
        { id: 'high', label: t('panel.high'), count: recent.filter((hit) => hit.severity === 'high').length },
        { id: 'medium', label: t('panel.medium'), count: recent.filter((hit) => hit.severity === 'medium').length },
        { id: 'low', label: t('panel.low'), count: recent.filter((hit) => hit.severity === 'low').length },
      ]

      return jsx.jsxs('div', {
        className: 'adw-root',
        children: [
          // ① score hero with delta + severity mix
          jsx.jsxs('div', {
            className: 'adw-card adw-hero-card',
            children: [
              jsx.jsxs('div', {
                className: 'adw-hero',
                children: [
                  jsx.jsx(ScoreRing, { score: last.score }),
                  jsx.jsxs('div', {
                    className: 'adw-hero-meta',
                    children: [
                      jsx.jsxs('div', {
                        className: 'adw-hero-line',
                        children: [
                          jsx.jsx('span', { className: 'adw-hero-label', children: t('panel.score') }),
                          delta === undefined
                            ? null
                            : jsx.jsxs('span', {
                                className: `adw-delta ${delta.score > 0 ? 'adw-up' : delta.score < 0 ? 'adw-down' : 'adw-flat'}`,
                                title: t('panel.delta.title'),
                                children: [
                                  delta.score > 0 ? '▲' : delta.score < 0 ? '▼' : '—',
                                  ' ',
                                  `${delta.score > 0 ? '+' : ''}${delta.score}`,
                                ],
                              }),
                        ],
                      }),
                      jsx.jsxs('div', {
                        className: 'adw-hero-sub',
                        children: [
                          jsx.jsx('span', { children: `${last.hits} ${t('panel.hits')}` }),
                          jsx.jsx('span', { className: 'adw-dot-sep', children: '·' }),
                          jsx.jsx('span', { children: t('panel.scans', { n: view.scans }) }),
                          jsx.jsx('span', { className: 'adw-dot-sep', children: '·' }),
                          jsx.jsx('span', { children: t(`panel.source.${last.source}`) }),
                        ],
                      }),
                      jsx.jsx(SeverityMix, { mix, total: last.hits, t }),
                    ],
                  }),
                ],
              }),
              jsx.jsx('div', { className: 'adw-hero-foot', children: t('panel.score.hint') }),
            ],
          }),

          // ② trend with axis labels and summary stats
          jsx.jsxs('div', {
            className: 'adw-card',
            children: [
              jsx.jsxs('div', {
                className: 'adw-card-title',
                children: [
                  jsx.jsx('span', { children: t('panel.trend') }),
                  jsx.jsxs('span', {
                    className: 'adw-card-meta',
                    children: [
                      `${t('panel.best')} ${summary.bestScore ?? summary.averageScore}`,
                      ' · ',
                      `${t('panel.worst')} ${summary.worstScore}`,
                      ' · ',
                      t('panel.trend.points', { n: view.trend.length }),
                    ],
                  }),
                ],
              }),
              jsx.jsx(Sparkline, { points: view.trend, ariaLabel: t('panel.trend.aria') }),
            ],
          }),

          // ③ per-rule distribution
          jsx.jsxs('div', {
            className: 'adw-card',
            children: [
              jsx.jsxs('div', {
                className: 'adw-card-title',
                children: [
                  jsx.jsx('span', { children: t('panel.rules') }),
                  jsx.jsxs('span', { className: 'adw-card-meta', children: [summary.distinctRules, ' / 8'] }),
                ],
              }),
              view.byRule.length === 0
                ? jsx.jsx('div', { className: 'adw-hint', children: t('panel.rules.empty') })
                : view.byRule.map((row) =>
                    jsx.jsx(RuleRow, {
                      label: row.name || row.ruleId,
                      sublabel: row.ruleId,
                      count: row.count,
                      max: maxRule,
                      severity: row.severity,
                    }, row.ruleId),
                  ),
            ],
          }),

          // ④ hit detail — the part that makes the panel actionable
          jsx.jsxs('div', {
            className: 'adw-card adw-hits-card',
            children: [
              jsx.jsxs('div', {
                className: 'adw-card-title',
                children: [
                  jsx.jsx('span', { children: t('panel.hits.list') }),
                  jsx.jsxs('span', { className: 'adw-card-meta', children: [recent.length, ' / ', summary.totalHits] }),
                ],
              }),
              recent.length === 0
                ? jsx.jsx('div', { className: 'adw-hint', children: t('panel.hits.empty') })
                : jsx.jsxs(React.Fragment, {
                    children: [
                      jsx.jsx('div', {
                        className: 'adw-filters',
                        role: 'tablist',
                        children: filters.map((item) =>
                          jsx.jsxs('button', {
                            type: 'button',
                            className: `adw-chip${filter === item.id ? ' adw-chip-on' : ''}`,
                            role: 'tab',
                            'aria-selected': filter === item.id,
                            onClick: () => setFilter(item.id),
                            children: [item.label, jsx.jsx('span', { className: 'adw-chip-count', children: item.count })],
                          }, item.id),
                        ),
                      }),
                      filtered.length === 0
                        ? jsx.jsx('div', { className: 'adw-hint', children: t('panel.hits.empty') })
                        : jsx.jsx('div', {
                            className: 'adw-hit-list',
                            children: filtered.map((hit, index) =>
                              jsx.jsx(HitCard, { hit, t }, `${hit.ruleId}-${hit.line}-${hit.column}-${index}`),
                            ),
                          }),
                    ],
                  }),
            ],
          }),

          // ⑤ rewrite pairs
          jsx.jsxs('div', {
            className: 'adw-card',
            children: [
              jsx.jsxs('div', {
                className: 'adw-card-title',
                children: [
                  jsx.jsx('span', { children: t('panel.pairs') }),
                  jsx.jsx('span', {
                    className: 'adw-card-meta',
                    children: view.pairs.length === 0 ? '' : t('panel.pairs.count', { n: view.pairs.length }),
                  }),
                ],
              }),
              view.pairs.length === 0
                ? jsx.jsx('div', { className: 'adw-hint', children: t('panel.pairs.empty') })
                : jsx.jsx('div', {
                    className: 'adw-pairs',
                    children: view.pairs
                      .slice()
                      .reverse()
                      .map((pair, index) => jsx.jsx(PairRow, { pair, t }, `${pair.at}-${index}`)),
                  }),
            ],
          }),

          jsx.jsx('div', { className: 'adw-hint adw-footer', children: t('panel.footer') }),
        ],
      })
    }

    function WritingHealthTabTitle(props) {
      const t = props.t
      return jsx.jsx('span', { children: t('tab.title') })
    }

    // ── settings section ───────────────────────────────────────────────────
    const RULE_CATALOG = [
      { id: 'self-weakening-hedge', name: '自我削弱表达', severity: 'high', desc: '“遗憾”“仅”“效果有限”一类措辞。', negatives: ['仅当批次大小固定时成立。', 'This holds only if the data is i.i.d.'] },
      { id: 'loss-framing', name: '主动承认落败', severity: 'high', desc: '“本文弱于”“未能超过”“性能下降”。', negatives: ['基线在长文档上性能下降，本文方法保持稳定。'] },
      { id: 'overgeneralized-limitation', name: '局部现象上升为整体否定', severity: 'high', desc: '“无法处理”“方法失效”“不具备泛化能力”。', negatives: ['在缺少标注数据的冷启动阶段，该方法无法处理长尾类别。'] },
      { id: 'procedural-narration', name: '工作汇报式叙事', severity: 'medium', desc: '“我们首先…然后…最后…”。', negatives: ['We first preprocess the corpus with sentence-level tokenization.'] },
      { id: 'premature-self-negation', name: '提前自我否定', severity: 'high', desc: '贡献尚未建立就谈局限，结论末尾突然自我否定。', negatives: ['第 5 节讨论本研究的局限与适用范围。'] },
      { id: 'defensive-preamble', name: '防御性铺垫', severity: 'low', desc: '“需要指出的是”“值得一提的是”。', negatives: ['需要说明的是，所有实验均在同一随机种子下重复三次。'] },
      { id: 'apology', name: '歉意表达', severity: 'medium', desc: '致歉式措辞，不提供信息。', negatives: ['We regret that Table 2 contained a typo; it is corrected here.'] },
      { id: 'comparison-scope-creep', name: '比较范围越界', severity: 'medium', desc: '“全面领先”“所有数据集上均优于”。', negatives: ['在表 2 列出的三个数据集上，本文方法均优于基线。'] },
    ]

    function SettingsSection(props) {
      const t = props.t
      return jsx.jsxs('div', {
        className: 'adw-root',
        style: { height: 'auto', padding: '0', maxWidth: '760px' },
        children: [
          jsx.jsxs('div', {
            className: 'adw-card',
            children: [
              jsx.jsx('div', { style: { fontSize: '18px', fontWeight: 600 }, children: t('settings.title') }),
              jsx.jsx('div', { className: 'adw-hint', children: t('settings.intro') }),
              jsx.jsx('div', {
                className: 'adw-hint',
                children: jsx.jsxs(React.Fragment, {
                  children: [
                    jsx.jsx('strong', { children: t('settings.usage') + ': ' }),
                    t('settings.usage.body'),
                  ],
                }),
              }),
            ],
          }),
          jsx.jsxs('div', {
            className: 'adw-card',
            children: [
              jsx.jsx('div', { className: 'adw-card-title', children: jsx.jsx('span', { children: t('settings.rules') }) }),
              RULE_CATALOG.map((rule) =>
                jsx.jsxs('div', {
                  className: 'adw-rule',
                  children: [
                    jsx.jsxs('div', {
                      className: 'adw-rule-head',
                      children: [
                        jsx.jsx('span', { className: `adw-badge adw-badge-${rule.severity}`, children: rule.severity }),
                        jsx.jsx('span', { className: 'adw-rule-name', children: rule.name }),
                        jsx.jsx('span', { className: 'adw-rule-id', children: rule.id }),
                      ],
                    }),
                    jsx.jsx('div', { className: 'adw-rule-desc', children: rule.desc }),
                    jsx.jsxs('div', {
                      className: 'adw-negative',
                      children: [
                        jsx.jsx('div', { children: t('settings.negatives') }),
                        ...rule.negatives.map((example, index) => jsx.jsx('div', { children: `· ${example}` }, index)),
                      ],
                    }),
                  ],
                }, rule.id),
              ),
            ],
          }),
        ],
      })
    }

    // ── cordis plugin entry ────────────────────────────────────────────────
    const inject = ['slots', 'locale', 'sidebarRightTabs']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-adw: dictionaries')
      const t = ctx.locale.bind(NS)

      // 1) right-sidebar tab type
      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: 'dsh-adw',
            kind: 'adw-writing-health',
            title: () => t('tab.title'),
            guide: [
              {
                order: 30,
                title: () => t('tab.title'),
                description: () => t('tab.guide'),
              },
            ],
          }),
        'dsh-adw: tab type',
      )

      // 2) tab body + chip title
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: 'dsh-adw', locale: NS },
          (props) => jsx.jsx(WritingHealthTab, { ...props, t }),
        ),
      )
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: 'dsh-adw' },
          () => jsx.jsx(WritingHealthTabTitle, { t }),
        ),
      )

      // 3) settings section
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'anti-defensive-writing',
            order: 12,
            label: () => t('settings.nav'),
            inject: () => ({ t }),
          },
          SettingsSection,
        ),
      )
    }

    exports.NS = NS
    exports.apply = apply
    exports.inject = inject
    exports.WritingHealthTab = WritingHealthTab
    exports.SettingsSection = SettingsSection
    exports.RULE_CATALOG = RULE_CATALOG
    return module.exports
  },
})
