import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scan, RULES, scoreOf } from '../lib/scan.js'

/** Convenience: the rule ids that fired, in document order. */
const fired = (report) => report.hits.map((hit) => hit.ruleId)

test('clean prose scores 100 and reports no hits', () => {
  const report = scan('本文提出一种新的对齐方法。在两个基准上，该方法提升了 3.2 个点。')
  assert.equal(report.stats.hits, 0)
  assert.equal(report.score, 100)
  assert.deepEqual(report.hits, [])
})

test('empty and whitespace-only input is clean and does not throw', () => {
  for (const text of ['', '   ', '\n\n\t']) {
    const report = scan(text)
    assert.equal(report.stats.hits, 0)
    assert.equal(report.score, 100)
    assert.equal(report.stats.sentences, 0)
  }
})

test('non-string input throws a TypeError naming the parameter', () => {
  assert.throws(() => scan(null), /scan\(text\): text must be a string/)
})

test('upstream README defensive sample fires the self-weakening rule', () => {
  const text =
    '虽然本方法在两个同领域数据集上提高了准确率，但必须承认，我们尚未测试跨领域泛化，因此应谨慎理解这些结果。'
  const report = scan(text)
  const ids = fired(report)
  assert.ok(ids.includes('premature-self-negation'), `expected premature-self-negation, got ${ids}`)
  assert.ok(report.score < 100)
})

test('upstream README press-release rewrite is clean', () => {
  const text = '本方法在两个同领域数据集上提高了准确率；跨领域泛化尚未评估。'
  const report = scan(text)
  assert.ok(!fired(report).includes('self-weakening-hedge'))
  assert.ok(report.score >= 85, `expected a high score, got ${report.score}`)
})

test('English self-weakening phrases fire', () => {
  const report = scan(
    'Unfortunately, our method only achieves a limited improvement over the baseline.',
  )
  const ids = fired(report)
  assert.ok(ids.includes('self-weakening-hedge'))
  assert.ok(report.hits.some((hit) => hit.language === 'en'))
})

test('loss framing fires in an abstract but is suppressed in limitations', () => {
  const text = '本文方法在该指标上弱于基线，性能下降 2 个点。'
  const inAbstract = scan(text, { section: 'abstract' })
  assert.ok(fired(inAbstract).includes('loss-framing'))
  const inLimitations = scan(text, { section: 'limitations' })
  assert.ok(!fired(inLimitations).includes('loss-framing'))
  assert.ok(inLimitations.suppressed.some((hit) => hit.ruleId === 'loss-framing'))
})

test('procedural narration is suppressed in the method section', () => {
  const text = '我们首先构建候选集，然后我们排序，最后我们选择前 k 个。'
  assert.ok(fired(scan(text, { section: 'introduction' })).includes('procedural-narration'))
  assert.ok(!fired(scan(text, { section: 'method' })).includes('procedural-narration'))
})

test('section auto-detection from markdown headings', () => {
  const text = [
    '# Abstract',
    'Unfortunately, the gains are limited.',
    '',
    '## Experiments',
    'We first tune the learning rate.',
  ].join('\n')
  const report = scan(text)
  const abstractHit = report.hits.find((hit) => hit.ruleId === 'self-weakening-hedge')
  assert.equal(abstractHit?.section, 'abstract')
  const procedural = report.hits.find((hit) => hit.ruleId === 'procedural-narration')
  assert.equal(procedural, undefined, 'procedural narration should be suppressed under Experiments')
})

test('CJK offsets are UTF-16 code-unit offsets and line/column are 1-based', () => {
  const text = '第一段没有问题。\n第二段遗憾的是这里有削弱词。'
  const report = scan(text)
  const hit = report.hits.find((item) => item.phrase === '遗憾的是')
  assert.ok(hit)
  assert.equal(text.slice(hit.start, hit.end), '遗憾的是')
  assert.equal(hit.line, 2)
  assert.equal(hit.column, 4)
})

test('emoji and surrogate pairs do not shift offsets', () => {
  const text = '摘要 😀 遗憾的是我们没能测试。'
  const report = scan(text)
  const hit = report.hits.find((item) => item.phrase === '遗憾的是')
  assert.ok(hit)
  assert.equal(text.slice(hit.start, hit.end), '遗憾的是')
})

test('code fences and math are masked and never produce hits', () => {
  const text = [
    '正文没有问题。',
    '```',
    'fortunately, only marginal improvement',
    '```',
    '公式 $only marginal$ 不是文字。',
    '链接 https://example.com/only-marginal 也不是。',
  ].join('\n')
  const report = scan(text)
  assert.equal(report.stats.hits, 0)
  assert.ok(report.coverage.maskedRegions.length >= 3)
})

test('legitimate scoping uses of 仅 and only do not fire', () => {
  for (const text of [
    '仅当批次大小固定时，该结论成立。',
    '该方法仅限离线场景使用。',
    'This holds only if the data is i.i.d.',
    'The result applies only in the low-noise regime.',
    '我们的方法不仅更快，而且更稳。',
    'Our method not only improves accuracy but also reduces latency.',
  ]) {
    const report = scan(text)
    assert.ok(
      !fired(report).includes('self-weakening-hedge'),
      `false positive on: ${text} -> ${JSON.stringify(report.hits.map((h) => h.phrase))}`,
    )
  }
})

test('ablation-style baseline caveats do not fire loss framing', () => {
  const text =
    'When the context exceeds the window, the baseline degrades because its retriever truncates documents.'
  const report = scan(text, { section: 'experiments' })
  assert.ok(!fired(report).includes('loss-framing'))
})

test('overclaiming is caught by comparison-scope-creep and asks a question instead of rewriting', () => {
  const report = scan('本文方法在所有数据集上全面领先。')
  const hit = report.hits.find((item) => item.ruleId === 'comparison-scope-creep')
  assert.ok(hit)
  assert.equal(hit.kind, 'question')
  assert.equal(hit.suggestion.kind, 'question')
  assert.equal(hit.suggestion.text, undefined)
})

test('every rule reports a suggestion kind consistent with its declaration', () => {
  for (const rule of RULES) {
    const sample = rule.phrases.zh[0] ?? rule.phrases.en[0]
    const report = scan(sample, { section: 'abstract' })
    const hit = report.hits.find((item) => item.ruleId === rule.id)
    assert.ok(hit, `rule ${rule.id} did not fire on its own first phrase`)
    assert.equal(hit.kind, rule.kind)
    if (rule.kind === 'question') assert.equal(hit.suggestion.text, undefined)
  }
})

test('question-kind hits never carry replacement text for any rule', () => {
  const samples = [
    '本文弱于基线。',
    '该方法无法处理所有输入。',
    '本文在所有数据集上全面领先。',
  ]
  for (const text of samples) {
    for (const hit of scan(text).hits) {
      if (hit.kind === 'question') {
        assert.equal(hit.suggestion.text, undefined)
        assert.equal(hit.suggestion.kind, 'question')
      }
    }
  }
})

test('disabledRules skips a rule entirely', () => {
  const text = '遗憾的是效果有限。'
  const withRule = scan(text)
  assert.ok(withRule.stats.hits > 0)
  const without = scan(text, { disabledRules: ['self-weakening-hedge'] })
  assert.ok(!fired(without).includes('self-weakening-hedge'))
})

test('minSeverity filters low-severity rules', () => {
  const text = '需要指出的是，实验设置与基线一致。'
  assert.ok(fired(scan(text)).includes('defensive-preamble'))
  const highOnly = scan(text, { minSeverity: 'high' })
  assert.ok(!fired(highOnly).includes('defensive-preamble'))
})

test('extraPhrases extends one rule without touching others', () => {
  const text = '这个结果非常拉胯。'
  assert.equal(scan(text).stats.hits, 0)
  const extended = scan(text, {
    extraPhrases: { 'self-weakening-hedge': { zh: ['非常拉胯'] } },
    section: 'abstract',
  })
  assert.ok(fired(extended).includes('self-weakening-hedge'))
})

test('idempotence: scanning the same text twice yields identical reports', () => {
  const text = '遗憾的是，本文方法弱于基线，且在所有数据集上未能超过对比方法。'
  assert.deepEqual(scan(text), scan(text))
})

test('maxHits caps the hit list but not the stats', () => {
  const text = Array.from({ length: 20 }, (_, i) => `遗憾的是第${i}点。`).join('')
  const report = scan(text, { maxHits: 5 })
  assert.equal(report.hits.length, 5)
  assert.equal(report.truncated, true)
  assert.equal(report.stats.hits, 20)
})

test('score is monotone in defensive density and clamps to [0, 100]', () => {
  assert.equal(scoreOf(0, 10), 100)
  assert.ok(scoreOf(5, 10) < scoreOf(2, 10))
  assert.equal(scoreOf(1e6, 1), 0)
})

test('overlapping phrases of one rule do not double count', () => {
  const text = '仍明显落后。'
  const report = scan(text)
  const hits = report.hits.filter((hit) => hit.ruleId === 'self-weakening-hedge')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].phrase, '仍明显落后')
})

test('report shape is stable', () => {
  const report = scan('遗憾的是效果有限。')
  for (const key of [
    'version',
    'score',
    'defensiveDensity',
    'stats',
    'byRule',
    'bySection',
    'hits',
    'truncated',
    'suppressed',
    'coverage',
  ]) {
    assert.ok(key in report, `missing ${key}`)
  }
  for (const key of ['chars', 'sentences', 'hits', 'high', 'medium', 'low', 'suppressed', 'weightedPoints', 'markedRatio']) {
    assert.ok(key in report.stats, `missing stats.${key}`)
  }
  const hit = report.hits[0]
  for (const key of ['ruleId', 'ruleName', 'severity', 'kind', 'start', 'end', 'line', 'column', 'text', 'phrase', 'language', 'section', 'weight', 'suggestion']) {
    assert.ok(key in hit, `missing hit.${key}`)
  }
})
