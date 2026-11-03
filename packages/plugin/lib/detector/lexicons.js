/**
 * Lexicon data for the anti-defensive-writing detector.
 *
 * These lists are the single source of truth for what each rule matches: the
 * rules import them directly, so editing a word here is all it takes to change
 * behaviour. That matters because the settings page tells users the word lists
 * are the editable surface — keeping a second copy inside `rules.js` silently
 * broke that promise.
 *
 * Upstream source: skills/anti-defensive-writing{,-en}/SKILL.md
 * ("禁用自我削弱式表达" / "Banned self-weakening phrases").
 *
 * @module @adw/detector/lexicons
 */

/** Simplified-Chinese lexicon */
export const CN = Object.freeze({
  /** Self-weakening hedges the skill bans outright. */
  selfWeakening: Object.freeze([
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
  ]),

  /** Phrases that state the paper lost a contest it did not have to enter. */
  lossFraming: Object.freeze([
    '本文弱于',
    '本方法弱于',
    '弱于',
    '劣于',
    '不如',
    '未能超过',
    '未能达到',
    '未能优于',
    '性能下降',
    '性能退化',
    '性能劣化',
    '准确率下降',
    '下降明显',
    '明显下降',
  ]),

  /** A single failed condition written up as a general defect. */
  overgeneralizedLimitation: Object.freeze([
    '无法处理',
    '完全不适用',
    '普遍不适用',
    '方法失效',
    '完全失效',
    '不能胜任',
    '无法胜任',
    '不具备泛化能力',
  ]),

  /** Process narration (“we first … then … finally”) in narrative sections. */
  proceduralNarration: Object.freeze([
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
  ]),

  /** Limitations and second thoughts placed before the contribution lands. */
  prematureSelfNegation: Object.freeze([
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
  ]),

  /** Preamble phrases that only set up a self-weakening sentence. */
  defensivePreamble: Object.freeze([
    '需要指出的是',
    '值得一提的是',
    '客观地说',
    '平心而论',
    '在此需要说明',
    '需要说明的是',
  ]),

  /** Apologetic register that adds no information. */
  apology: Object.freeze([
    '抱歉',
    '笔者才疏学浅',
    '恐有疏漏',
    '难免有疏漏',
    '难免存在错误',
  ]),

  /** Claims whose comparison scope outruns the evidence. */
  comparisonScopeCreep: Object.freeze([
    '在所有数据集上',
    '在所有指标上',
    '全面领先',
    '全面超越',
    '全面优于',
    '所有实验中均',
    '均优于所有',
  ]),

})

/** English lexicon. Matched case-insensitively. */
export const EN = Object.freeze({
  /** Self-weakening hedges the skill bans outright. */
  selfWeakening: Object.freeze([
    'unfortunately',
    'regrettably',
    'sadly',
    'limited improvement',
    'marginal improvement',
    'only marginal',
    'limited gains',
    'modest improvement',
    'severely insufficient',
    'serious shortcomings',
    'significant limitations',
    'still lags far behind',
    'far behind',
    'merely',
    'only achieves',
    'only improves',
    'only reaches',
  ]),

  /** Phrases that state the paper lost a contest it did not have to enter. */
  lossFraming: Object.freeze([
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
  ]),

  /** A single failed condition written up as a general defect. */
  overgeneralizedLimitation: Object.freeze([
    'cannot handle',
    'fails completely',
    'does not work at all',
    'is not applicable in general',
    'our method cannot',
    'is unable to handle',
  ]),

  /** Process narration (“we first … then … finally”) in narrative sections. */
  proceduralNarration: Object.freeze([
    'we first',
    'we then',
    'we next',
    'we initially',
    'we attempted',
    'we tried',
    'after several attempts',
    'we later',
    'finally, we',
    'at first, we',
  ]),

  /** Limitations and second thoughts placed before the contribution lands. */
  prematureSelfNegation: Object.freeze([
    'nevertheless',
    'admittedly',
    'to be fair',
    'it must be admitted',
    'a major limitation',
    'the main limitation',
    'this work has limitations',
    'our approach has limitations',
    'future work should address',
    'should be interpreted with caution',
  ]),

  /** Preamble phrases that only set up a self-weakening sentence. */
  defensivePreamble: Object.freeze([
    'it is worth noting that',
    'it should be noted that',
    'needless to say',
    'it is important to acknowledge',
    'we would like to point out',
  ]),

  /** Apologetic register that adds no information. */
  apology: Object.freeze([
    'we apologize',
    'we regret',
    'we are sorry',
  ]),

  /** Claims whose comparison scope outruns the evidence. */
  comparisonScopeCreep: Object.freeze([
    'on all datasets',
    'across all metrics',
    'consistently superior',
    'outperforms all',
    'outperforms every',
    'state-of-the-art on all',
    'universally better',
  ]),

})
