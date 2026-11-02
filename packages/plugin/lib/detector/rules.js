/**
 * Rule catalogue for the anti-defensive-writing detector.
 *
 * A rule is a small declarative object: which phrases (per language) it watches,
 * which contexts suppress it, how much a hit costs in each paper section, and
 * what the user should DO about it. The matcher in `scan.js` owns offsets,
 * sentence/section geometry and scoring; rules own only judgement.
 *
 * Design constraints (see docs/notes/detector-spec.md):
 *   - `kind: 'rewrite'` means the fix is local and mechanical (delete a hedge,
 *     drop a preamble). The detector may propose exact replacement text.
 *   - `kind: 'question'` means the fix needs a fact the detector cannot know.
 *     It must NEVER propose replacement text, only ask the author.
 *   - Every rule carries `negativeExamples` used by the test suite and shown in
 *     the settings UI, so users can see what the rule deliberately ignores.
 *
 * @module @adw/detector/rules
 */

/** Severity → score weight. Only these three values are valid. */
export const SEVERITY_WEIGHT = Object.freeze({ high: 3, medium: 2, low: 1 })

/** Sections a paper can be in. `unknown` is the fallback. */
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
  'unknown',
])

/**
 * Per-section multiplier on a rule's score weight. `0` suppresses the rule.
 * The defaults encode one claim: a hedge in an abstract or conclusion costs
 * more than the same hedge in an experiments section, where qualification is
 * part of the genre.
 */
const DEFAULT_SECTIONS = Object.freeze({
  abstract: 1.2,
  introduction: 1.0,
  'related-work': 0.4,
  method: 0.3,
  experiments: 0.6,
  results: 0.7,
  discussion: 0.8,
  conclusion: 1.2,
  limitations: 0.2,
  rebuttal: 0.7,
  unknown: 1.0,
})

/** Merge a rule's overrides over the default section weights. */
function sections(overrides = {}) {
  return Object.freeze({ ...DEFAULT_SECTIONS, ...overrides })
}

/**
 * Phrases that must NOT fire even though a bare scan would hit them.
 * Encoded as guards next to the rule because they are rule-specific.
 */
export const GUARDS = Object.freeze({
  /** `仅当` / `仅限于` / `仅在…时` scope a claim; they are not self-weakening. */
  cnOnlyScoping: /^仅(?:当|限|于|在|用|对|需|能|可|供|凭|按|就|次)/,
  /** `不仅` is additive, never a hedge. */
  cnNotOnly: /^不仅/,
  /** `only if` / `only when` scope a condition. */
  enOnlyScoping: /^only (?:if|when|in|for|under|at|after|before|once)\b/i,
  /** `not only` is additive. */
  enNotOnly: /^not only\b/i,
})

/**
 * The rule catalogue.
 *
 * Scoring note: `sections` values multiply the severity weight; they are not
 * probabilities. A suppressed rule still appears in `meta.suppressedHits` so
 * the UI can say "3 hits were ignored in this section" instead of lying.
 */
export const RULES = Object.freeze([
  {
    id: 'self-weakening-hedge',
    name: '自我削弱表达',
    nameEn: 'Self-weakening hedge',
    severity: 'high',
    kind: 'rewrite',
    upstream: '语言规则：禁用自我削弱式表达',
    description:
      '“遗憾”“仅”“效果有限”“仍明显落后”一类措辞，会在贡献尚未建立时先替读者完成一次否定。',
    rationale:
      '删掉削弱词，或把程度副词换成可核验的具体数字；主张强度由证据决定，而不是由形容词自贬。',
    sections: sections({ abstract: 1.3, conclusion: 1.3, experiments: 0.4 }),
    phrases: {
      zh: [
        '遗憾的是',
        '可惜的是',
        '很遗憾',
        '仍明显落后',
        '明显落后',
        '效果有限',
        '提升有限',
        '改善有限',
        '存在严重不足',
        '严重不足',
        '明显不足',
        '明显欠缺',
        '尚不完善',
        '尚不成熟',
        '不够理想',
        '不尽如人意',
        '难以令人满意',
        '有待提高',
        '有待改进',
        '表现欠佳',
        '表现不佳',
        '仅',
        '仅仅',
      ],
      en: [
        'unfortunately',
        'regrettably',
        'limited improvement',
        'marginal improvement',
        'only marginal',
        'limited gains',
        'modest improvement',
        'severely insufficient',
        'serious shortcomings',
        'still lags far behind',
        'merely',
        'only achieves',
        'only improves',
        'only reaches',
      ],
    },
    /** Minimal deletion: a hedge is removable without changing the claim. */
    suggest: (hit) => ({
      kind: 'rewrite',
      text: '',
      note: '删除该削弱词；若程度重要，用可核验的数字代替形容词。',
    }),
    negativeExamples: [
      '只有在数据集规模超过 10 万时，方法才生效。',
      '该方法仅当批大小固定为 32 时成立。',
      'This optimization only applies when the batch size is fixed.',
      'Our method not only improves accuracy but also reduces latency.',
      'The evaluation is limited to the scope of in-domain datasets.',
    ],
  },

  {
    id: 'loss-framing',
    name: '主动承认落败',
    nameEn: 'Loss framing',
    severity: 'high',
    kind: 'question',
    upstream: '语言规则：不占优的结果不说输',
    description:
      '“本文弱于”“未能超过”“性能下降”直接把论文放进一场它不必参加的比赛。',
    rationale:
      '按上游决策顺序处理：先判断该结果是否必须讨论，再从目标差异、约束条件或合理权衡解释，或收缩主张避免正面对撞。',
    sections: sections({ abstract: 1.4, conclusion: 1.3, limitations: 0.05 }),
    phrases: {
      zh: [
        '本文弱于',
        '本方法弱于',
        '弱于',
        '劣于',
        '未能超过',
        '未能达到',
        '未能优于',
        '性能下降',
        '性能退化',
        '性能劣化',
        '准确率下降',
        '下降明显',
        '明显下降',
        '不如',
      ],
      en: [
        'our method is weaker',
        'is weaker than',
        'inferior to',
        'falls short of',
        'fails to surpass',
        'fails to outperform',
        'fails to beat',
        'performance drops',
        'performance degrades',
        'performance decreases',
        'underperforms',
        'worse than the baseline',
        'lower than the baseline',
      ],
    },
    suggest: (hit) => ({
      kind: 'question',
      note: '这个比较是否必须出现在当前章节？能否换成目标差异、约束条件或权衡的表述，或收缩主张避免正面对撞？',
    }),
    negativeExamples: [
      'The baseline underperforms on long documents, where context is truncated.',
      '在长文档场景下，基线方法因上下文截断而性能下降，本文方法保持稳定。',
      'Our method is weaker on a metric the task does not optimize for.',
    ],
  },

  {
    id: 'overgeneralized-limitation',
    name: '局部现象上升为整体否定',
    nameEn: 'Overgeneralized limitation',
    severity: 'high',
    kind: 'question',
    upstream: '语言规则：不把局部现象上升为对整体方法的否定',
    description:
      '把某一条件下的失败写成“无法处理”“方法失效”“不具备泛化能力”，等于替审稿人把局部现象推广成普遍缺陷。',
    rationale:
      '限定条件与范围：写明“在 X 条件下无法处理 Y”，把结论收回到证据覆盖的边界内。',
    sections: sections({ abstract: 1.4, conclusion: 1.3, limitations: 0.1 }),
    phrases: {
      zh: [
        '无法处理',
        '完全不适用',
        '普遍不适用',
        '方法失效',
        '完全失效',
        '不能胜任',
        '无法胜任',
        '不具备泛化能力',
      ],
      en: [
        'cannot handle',
        'fails completely',
        'does not work at all',
        'is not applicable in general',
        'our method cannot',
        'is unable to handle',
      ],
    },
    suggest: (hit) => ({
      kind: 'question',
      note: '该结论的证据覆盖哪些条件？请把断言收缩到这些条件内，或补充实验证明它确实是普遍的。',
    }),
    negativeExamples: [
      '在缺少标注数据的冷启动阶段，该方法无法处理长尾类别。',
      'The model cannot handle inputs longer than its context window.',
    ],
  },

  {
    id: 'procedural-narration',
    name: '工作汇报式叙事',
    nameEn: 'Procedural narration',
    severity: 'medium',
    kind: 'rewrite',
    upstream: '叙事规则：不写成工作汇报',
    description:
      '“我们首先…然后…最后…”按过程展开，而不是按“问题→缺口→解法→证据”的最终逻辑展开。',
    rationale:
      '只保留最终成立的逻辑链；过程细节属于方法章节，不属于摘要、引言和结论。',
    sections: sections({
      abstract: 1.2,
      introduction: 1.2,
      method: 0.05,
      experiments: 0.1,
      results: 0.1,
      conclusion: 0.9,
    }),
    phrases: {
      zh: [
        '我们首先',
        '我们随后',
        '我们接着',
        '然后我们',
        '最后我们',
        '起初我们',
        '最初我们',
        '我们尝试了',
        '我们曾尝试',
        '经过多次尝试',
        '后来我们',
        '一开始我们',
        '我们最初',
        '然后尝试',
        '最后选择',
        '最后决定',
      ],
      en: [
        'we first',
        'we then',
        'we next',
        'we initially',
        'we attempted',
        'after several attempts',
        'we later',
        'finally, we',
        'at first, we',
      ],
    },
    suggest: (hit) => ({
      kind: 'question',
      note: '这段是否在讲“我们做了什么过程”？把它改写成该段要支撑的论点，或移到方法章节。',
    }),
    negativeExamples: [
      'We first preprocess the corpus with sentence-level tokenization.',
      '如第 3.2 节所述，我们首先将输入划分为片段。',
    ],
  },

  {
    id: 'premature-self-negation',
    name: '提前自我否定',
    nameEn: 'Premature self-negation',
    severity: 'high',
    kind: 'rewrite',
    upstream: '结构规则：结论只强化记忆点，不在最后突然自我否定',
    description:
      '贡献尚未建立就谈局限，或在结论末尾突然加入自我否定，会把读者注意力从记忆点移开。',
    rationale:
      '局限性放到讨论或附录；摘要和结论只强化“解决了什么、证明了什么、为什么重要”。',
    sections: sections({
      abstract: 1.4,
      conclusion: 1.5,
      introduction: 1.1,
      discussion: 0.8,
      limitations: 0.05,
      experiments: 0.3,
    }),
    phrases: {
      zh: [
        '尽管如此',
        '必须承认',
        '不得不承认',
        '本研究的局限',
        '本文的局限',
        '存在局限',
        '不足之处在于',
        '本研究仍存在',
        '本文仍存在',
        '尚需进一步研究',
        '因此应谨慎',
        '应谨慎理解',
        '谨慎解读',
        '不宜过度解读',
      ],
      en: [
        'nevertheless',
        'admittedly',
        'it must be admitted',
        'a major limitation',
        'the main limitation',
        'this work has limitations',
        'our approach has limitations',
        'future work should address',
        'should be interpreted with caution',
      ],
    },
    suggest: (hit) => ({
      kind: 'rewrite',
      text: '',
      note: '把这段局限说明移出摘要/结论；若必须保留，改为一句事实性陈述并附上边界条件。',
    }),
    negativeExamples: [
      'In the Limitations section we discuss the scope of our evaluation.',
      '第 5 节讨论本研究的局限与适用范围。',
    ],
  },

  {
    id: 'defensive-preamble',
    name: '防御性铺垫',
    nameEn: 'Defensive preamble',
    severity: 'low',
    kind: 'rewrite',
    upstream: '语言规则：不替审稿人总结弱点',
    description:
      '“需要指出的是”“值得一提的是”“客观地说”常被用来给一个自我削弱句做铺垫，删掉不影响信息量。',
    rationale: '删除铺垫语，直接陈述事实。',
    sections: sections({ abstract: 0.8, conclusion: 0.8 }),
    phrases: {
      zh: [
        '需要指出的是',
        '值得一提的是',
        '客观地说',
        '平心而论',
        '在此需要说明',
        '需要说明的是',
      ],
      en: [
        'it is worth noting that',
        'it should be noted that',
        'needless to say',
        'it is important to acknowledge',
        'we would like to point out',
      ],
    },
    suggest: (hit) => ({ kind: 'rewrite', text: '', note: '删除铺垫语，直接陈述事实。' }),
    negativeExamples: [
      'Note that the scheduler is deterministic by construction.',
      '需要说明的是，所有实验均在同一随机种子下重复三次。',
    ],
  },

  {
    id: 'apology',
    name: '歉意表达',
    nameEn: 'Apologetic register',
    severity: 'medium',
    kind: 'rewrite',
    upstream: '语言规则：不主动扩大攻击面',
    description: '致歉式措辞把论文放在被审判的位置，且不提供任何信息。',
    rationale: '删除致歉句；如确有错误，直接说明更正内容。',
    sections: sections({ rebuttal: 0.6 }),
    phrases: {
      zh: ['抱歉', '笔者才疏学浅', '恐有疏漏', '难免有疏漏', '难免存在错误'],
      en: ['we apologize', 'we regret', 'we are sorry'],
    },
    suggest: (hit) => ({ kind: 'rewrite', text: '', note: '删除致歉语，直接说明事实或更正。' }),
    negativeExamples: [
      'We regret that the earlier version contained a typo in Table 2; it is corrected here.',
    ],
  },

  {
    id: 'comparison-scope-creep',
    name: '比较范围越界',
    nameEn: 'Comparison scope creep',
    severity: 'medium',
    kind: 'question',
    upstream: '叙事规则：控制比较范围',
    description:
      '“全面领先”“所有数据集上均优于”这类断言超出多数论文的证据边界，反而邀请审稿人找一个反例。',
    rationale:
      '只提出证据能牢固支撑的主张；说服力来自主张与证据高度一致，而不是比较项目最多。',
    sections: sections({ abstract: 1.2, conclusion: 1.2 }),
    phrases: {
      zh: [
        '在所有数据集上',
        '在所有指标上',
        '全面领先',
        '全面超越',
        '全面优于',
        '所有实验中均',
        '均优于所有',
      ],
      en: [
        'on all datasets',
        'across all metrics',
        'consistently superior',
        'outperforms all',
        'outperforms every',
        'state-of-the-art on all',
        'universally better',
      ],
    },
    suggest: (hit) => ({
      kind: 'question',
      note: '这句话的证据覆盖所有数据集/指标吗？请把范围收缩到实际评测过的集合。',
    }),
    negativeExamples: [
      'On all datasets in Table 1, our method improves accuracy.',
      '在表 2 列出的三个数据集上，本文方法均优于基线。',
    ],
  },
])

/** Lookup by id. */
export const RULES_BY_ID = Object.freeze(
  Object.fromEntries(RULES.map((rule) => [rule.id, rule])),
)

/** Lightweight metadata for the settings UI and docs. */
export function ruleSummaries() {
  return RULES.map((rule) => ({
    id: rule.id,
    name: rule.name,
    nameEn: rule.nameEn,
    severity: rule.severity,
    kind: rule.kind,
    upstream: rule.upstream,
    description: rule.description,
    negativeExamples: [...rule.negativeExamples],
  }))
}
