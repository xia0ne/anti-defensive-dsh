/**
 * The anti-defensive-writing detector: one deep module.
 *
 *   scan(text, options) -> Report
 *
 * Everything about *how* to find hits — masking code/math/URLs, section
 * detection, sentence geometry, overlap resolution, scoring — lives here.
 * Everything about *what* is a hit lives in `rules.js`. That split is the
 * seam: a reviewer can audit the judgement (rules) without holding the
 * geometry in their head, and can test the geometry (this file) with
 * synthetic rules.
 *
 * Offsets are UTF-16 code-unit offsets into the input string, identical to
 * `String.prototype.slice` and to `index` on RegExp match arrays. `line` and
 * `column` are 1-based; `column` counts UTF-16 code units from the line start.
 *
 * @module @adw/detector
 */

import { RULES, RULES_BY_ID, SEVERITY_WEIGHT } from './rules.js'
import { CN, EN } from './lexicons.js'

export const DETECTOR_VERSION = 1

/** Score cost per unit of defensive density. See `scoreOf`. */
const SCORE_SLOPE = 40
/** Short texts are scored as if they had at least this many sentences. */
const MIN_SENTENCES = 4
/** A section multiplier below this counts as "ignored in this section". */
const SUPPRESS_BELOW = 0.15

/**
 * Markdown/LaTeX/URL regions where a phrase hit is almost certainly a false
 * positive. Each is blanked with spaces of the same length so every offset
 * downstream is unchanged.
 */
const MASKERS = [
  { name: 'fenced-code', re: /^```[\s\S]*?^```/gm },
  { name: 'fenced-code', re: /^~~~[\s\S]*?^~~~/gm },
  { name: 'inline-code', re: /`[^`\n]*`/g },
  { name: 'math-display', re: /\$\$[\s\S]*?\$\$/g },
  { name: 'math-inline', re: /\$[^$\n]+?\$/g },
  { name: 'url', re: /\bhttps?:\/\/[^\s)>\]]+/g },
  { name: 'link-target', re: /\]\([^)\n]*\)/g },
  { name: 'html-tag', re: /<\/?[A-Za-z][^>\n]*>/g },
]

/**
 * Section heading vocabulary. Ordered: first match wins.
 *
 * The boundary is `(?=$|\p{P}|[与和及暨])` rather than `\b`: `\b` is
 * defined over ASCII word characters, so every Chinese heading (`## 摘要`,
 * `## 结论`) failed to match and silently scored as `unknown`. `\p{P}`
 * requires the `u` flag and keeps `Abstract:` / `Results—` working; the
 * connectors allow the very common compound headings `结论与展望`,
 * `实验与分析`. A trailing space is deliberately NOT a boundary, so the
 * sentence `# Abstract thinking is hard.` does not claim the abstract section.
 */
const HEADING_PATTERNS = [
  { section: 'abstract', re: /^(?:abstract|摘要)(?=$|\p{P}|[与和及暨])/iu },
  { section: 'introduction', re: /^(?:introduction|引言|前言|绪论)(?=$|\p{P}|[与和及暨])/iu },
  { section: 'related-work', re: /^(?:related work|related research|background|相关工作|研究背景)(?=$|\p{P}|[与和及暨])/iu },
  { section: 'method', re: /^(?:method|methods|methodology|approach|方法|模型)(?=$|\p{P}|[与和及暨])/iu },
  { section: 'experiments', re: /^(?:experiment|experiments|experimental setup|实验设置|实验)(?=$|\p{P}|[与和及暨])/iu },
  { section: 'results', re: /^(?:results|实验结果|结果)(?=$|\p{P}|[与和及暨])/iu },
  { section: 'discussion', re: /^(?:discussion|讨论)(?=$|\p{P}|[与和及暨])/iu },
  { section: 'conclusion', re: /^(?:conclusion|conclusions|结论|总结)(?=$|\p{P}|[与和及暨])/iu },
  { section: 'limitations', re: /^(?:limitations?|局限性|局限)(?=$|\p{P}|[与和及暨])/iu },
  { section: 'rebuttal', re: /^(?:rebuttal|response to reviewers?|审稿意见回复|回复审稿人)(?=$|\p{P}|[与和及暨])/iu },
]

/**
 * Strip section numbering from a heading title so `## 1. 引言` and
 * `## 4.2 Experiments` match the vocabulary above. Covers the conventions a
 * paper actually uses: `1`, `1.2`, `一、`, `（一）`, `第 3 节`, `IV.`.
 * @param {string} title - raw heading text.
 */
function stripHeadingNumber(title) {
  return title
    .replace(/^第\s*[0-9一二三四五六七八九十]+\s*[章节部分]\s*[.、:：]?\s*/u, '')
    .replace(/^[（(]\s*[0-9一二三四五六七八九十]+\s*[)）]\s*[.、:：]?\s*/u, '')
    .replace(/^[0-9]+(?:\.[0-9]+)*\s*[.、:：]?\s+/u, '')
    .replace(/^[IVXLC]+\.\s+/u, '')
    .replace(/^[一二三四五六七八九十]+[、.．]\s*/u, '')
    .trim()
}

/**
 * Blank out regions that must not produce hits, preserving length and newlines.
 *
 * All matches are collected against the *original* text and blanked in one
 * pass. The previous version rebuilt the whole string per match, which is
 * O(n²): a 560k-character paper with 20k inline-code spans took 4.7 s, and the
 * `/adw scan` command has no input cap. Maskers cannot overlap between the
 * passes because they run on disjoint syntax, and a match that does fall
 * inside an already-collected region is dropped by `mergeRegions`.
 *
 * @param {string} text - raw input.
 * @returns {{ masked: string, regions: Array<{name: string, start: number, end: number}> }}
 */
function maskRegions(text) {
  // Each masker runs once over the text as its predecessors left it — that is
  // the documented precedence (a `# 结论` inside a fenced block is code, a URL
  // inside `](…)` is a link target) — but all of one pattern's matches are
  // blanked in a single pass. The old version rebuilt the whole string per
  // match (O(n²): 4.7 s on a 560k-char paper); this is O(pattern count × n)
  // with identical output, because blanking can only turn characters into
  // spaces and none of these patterns can be *created* that way.
  let masked = text
  const regions = []
  for (const { name, re } of MASKERS) {
    const fresh = new RegExp(re.source, re.flags)
    const matches = [...masked.matchAll(fresh)]
    if (matches.length === 0) continue
    const chars = masked.split('')
    for (const match of matches) {
      const start = match.index ?? 0
      const end = start + match[0].length
      regions.push({ name, start, end })
      for (let i = start; i < end; i++) {
        if (chars[i] !== '\n') chars[i] = ' '
      }
    }
    masked = chars.join('')
  }
  return { masked, regions: mergeRegions(regions) }
}

/** Merge overlapping/adjacent masked regions so the report stays small. */
function mergeRegions(regions) {
  if (regions.length === 0) return regions
  const sorted = [...regions].sort((a, b) => a.start - b.start || a.end - b.end)
  const out = [sorted[0]]
  for (const region of sorted.slice(1)) {
    const last = out[out.length - 1]
    if (region.start <= last.end) {
      last.end = Math.max(last.end, region.end)
      if (region.name !== last.name) last.name = 'mixed'
    } else {
      out.push({ ...region })
    }
  }
  return out
}

/**
 * Locate markdown headings and their section, in document order.
 * A `# 结论` line inside a fenced code block or math block is sample text,
 * not a heading; masked regions are excluded or the whole document after a
 * code sample would be scored as that section.
 * @param {string} text - original text.
 * @param {Array<{start:number,end:number}>} [maskedRegions] - regions to skip.
 * @returns {Array<{ start: number, end: number, section: string }>}
 */
function headingSpans(text, maskedRegions = []) {
  const spans = []
  const re = /^[ \t]{0,3}(#{1,6})[ \t]*([^\n]*)$/gm
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0
    if (maskedRegions.some((region) => start >= region.start && start < region.end)) continue
    const title = stripHeadingNumber(match[2].trim())
    if (title.length === 0) continue
    const section = HEADING_PATTERNS.find((item) => item.re.test(title))?.section
    if (section === undefined) continue
    spans.push({ start, end: start + match[0].length, section })
  }
  return spans
}

/**
 * Effective section at an offset: the most recent recognised heading.
 * @param {Array<{start:number,section:string}>} headings - heading index.
 * @param {number} offset - target offset.
 * @param {string} fallback - section to use before any heading.
 */
function sectionAt(headings, offset, fallback) {
  let current = fallback
  for (const heading of headings) {
    if (heading.start > offset) break
    current = heading.section
  }
  return current
}

/**
 * Sentence boundaries over the masked text. A sentence ends at CJK or Latin
 * terminal punctuation followed by whitespace/end, or at a blank line. The
 * returned ranges are `[start, end)` into the original text.
 * @param {string} masked - masked text.
 * @returns {Array<{start: number, end: number, text: string}>}
 */
function sentenceRanges(masked) {
  const ranges = []
  const length = masked.length
  const isTerminal = (ch) => ch === '。' || ch === '！' || ch === '？' || ch === '；' ||
    ch === '!' || ch === '?' || ch === ';'
  let start = 0
  let i = 0
  const push = (end) => {
    while (start < end && /\s/.test(masked[start])) start++
    let stop = end
    while (stop > start && /\s/.test(masked[stop - 1])) stop--
    if (stop > start && /[^\s]/.test(masked.slice(start, stop))) {
      ranges.push({ start, end: stop, text: masked.slice(start, stop) })
    }
    start = end
  }
  while (i < length) {
    const ch = masked[i]
    if (isTerminal(ch)) {
      let j = i + 1
      while (j < length && (masked[j] === '"' || masked[j] === "'" || masked[j] === '”' || masked[j] === '’' || masked[j] === '）' || masked[j] === ')')) j++
      push(j)
      i = j
      continue
    }
    if (ch === '\n') {
      let j = i + 1
      while (j < length && (masked[j] === ' ' || masked[j] === '\t' || masked[j] === '\r')) j++
      if (j >= length || masked[j] === '\n') {
        push(i)
        i = j
        continue
      }
    }
    if (ch === '.' && i + 1 < length && /\s/.test(masked[i + 1])) {
      // Latin full stop: require the next non-space to look like a new sentence.
      let j = i + 1
      while (j < length && /\s/.test(masked[j])) j++
      if (j >= length || /[A-Z0-9“"(\[]/.test(masked[j])) {
        push(i + 1)
        i = j
        continue
      }
    }
    i++
  }
  push(length)
  return ranges.length > 0 ? ranges : [{ start: 0, end: length, text: masked }]
}

/**
 * The sentence range containing an offset, using the precomputed sentence
 * geometry. Falls back to the offset itself when no range encloses it (which
 * happens only for text inside a masked region, already excluded from hits).
 * @param {Array<{start:number,end:number}>} ranges
 * @param {number} offset
 */
function sentenceAt(ranges, offset) {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const range = ranges[mid]
    if (offset < range.start) hi = mid - 1
    else if (offset >= range.end) lo = mid + 1
    else return range
  }
  return null
}

/** 1-based line and UTF-16 column for an offset. */
function positionOf(lineStarts, offset) {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 }
}

/** Maximum characters shown on each side of a hit in `excerpt`. */
const EXCERPT_PAD = 24

/**
 * Clip a sentence around one hit and mark the hit with `⟦…⟧`, so a panel can
 * render inline context without knowing anything about offsets.
 * @param {string} sentence - enclosing sentence text.
 * @param {number} offset - hit start within the sentence.
 * @param {number} length - hit length.
 */
function buildExcerpt(sentence, offset, length) {
  const start = Math.max(0, offset - EXCERPT_PAD)
  const end = Math.min(sentence.length, offset + length + EXCERPT_PAD)
  const head = start > 0 ? '…' : ''
  const tail = end < sentence.length ? '…' : ''
  return head + sentence.slice(start, offset) + '⟦' + sentence.slice(offset, offset + length) + '⟧' + sentence.slice(offset + length, end) + tail
}

/** Compute line-start offsets once. */
function lineStartsOf(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g

/** Compile one phrase into a matcher for the given language. */
function phraseMatcher(phrase, language) {
  const escaped = phrase.replace(ESCAPE, '\\$&')
  if (language === 'en') {
    return new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'gi')
  }
  return new RegExp(escaped, 'g')
}

/** Longest-first so "仍明显落后" wins over "明显落后". */
function sortedPhrases(list) {
  return [...list].sort((a, b) => b.length - a.length)
}

/** The sentence-ish window around a hit, used by the context guards. */
function contextAround(masked, start, end) {
  const left = Math.max(0, start - 80)
  const right = Math.min(masked.length, end + 80)
  return masked.slice(left, right)
}

/**
 * The clause containing a hit: text between the nearest clause boundaries.
 * A sentence like `基线…性能下降，本文方法保持稳定` mentions two subjects;
 * only the clause around the hit decides whose performance dropped.
 * @param {string} masked
 * @param {number} start
 * @param {number} end
 */
function clauseAround(masked, start, end) {
  const boundary = /[，,。；;！!？?\n]/
  let left = start
  while (left > 0 && !boundary.test(masked[left - 1])) left--
  let right = end
  while (right < masked.length && !boundary.test(masked[right])) right++
  return masked.slice(left, right)
}

/** True when `haystack` contains any of `needles` (case-insensitive for Latin). */
function mentions(haystack, needles) {
  const lower = haystack.toLowerCase()
  return needles.some((needle) => lower.includes(needle.toLowerCase()))
}

/**
 * Rule-specific guards against legitimate academic usage.
 *
 * Each rule's `negativeExamples` is a promise: the settings page shows them to
 * users as "this will NOT be flagged". The phrases alone cannot keep that
 * promise — `性能下降` is self-weakening when the subject is this paper and
 * normal evidence when the subject is a baseline — so the context decides.
 *
 * The guards are deliberately narrow: they only suppress a hit when the
 * surrounding clause names another subject (baseline/prior work/SOTA), or when
 * the hit sits in a scope statement, a method description, or a correction.
 * Anything ambiguous is left for the author, which is the direction the
 * product wants to err in.
 *
 * @param {string} ruleId
 * @param {string} masked - masked text (offsets valid).
 * @param {number} start - hit start.
 * @param {number} end - hit end.
 * @param {string} phrase - matched phrase.
 * @param {'zh'|'en'} language
 * @returns {boolean} true when this hit must not be reported.
 */
function isLegitimateUsage(ruleId, masked, start, end, phrase, language) {
  const context = contextAround(masked, start, end)

  if (ruleId === 'self-weakening-hedge') {
    if (language === 'zh' && (phrase === '仅' || phrase === '仅仅')) {
      // `仅当…` / `仅限于…` scope a claim; `不仅` is additive.
      if (/^仅(?:当|限|于|在|用|对|需|能|可|供|凭|按|就|次)/.test(masked.slice(start, start + 3))) return true
      if (masked.slice(Math.max(0, start - 1), start) === '不') return true
    }
    if (language === 'zh' && phrase === '不如' && /^不如说/.test(masked.slice(start))) return true
    if (language === 'en') {
      // "only if/when/..." scopes a condition; "not only X but also Y" is additive.
      if (/^only (?:if|when|in|for|under|at|after|before|once)\b/i.test(masked.slice(start))) return true
      const beforeWord = masked.slice(Math.max(0, start - 6), start)
      if (/\bnot\s$/i.test(beforeWord)) return true
      if (phrase.startsWith('only ') && /\bnot\s+$/i.test(beforeWord)) return true
    }
    // "limited to the scope of X" declares coverage, not a shortfall.
    if (phrase === 'limited improvement' || phrase === 'limited gains' || phrase === 'modest improvement') {
      if (/\blimited to\b/i.test(context)) return false
    }
    return false
  }

  if (ruleId === 'loss-framing') {
    // A comparison is only self-weakening when the subject is this paper.
    // `基线…性能下降，本文方法保持稳定` is the standard foil, not a confession.
    // Look at the clause around the hit, not the whole sentence: the sentence
    // legitimately names both subjects.
    const clause = clauseAround(masked, start, end)
    const foreignSubject = [
      '基线', '对比方法', '先前方法', '已有方法', '现有方法', '其他方法', '该方法', '这些方法',
      'baseline', 'prior method', 'previous method', 'existing method', 'competing method',
      'the model cannot', 'state-of-the-art',
    ]
    const selfSubject = ['本文', '本方法', '我们', 'our method', 'our approach', 'we ']
    if (mentions(clause, foreignSubject) && !mentions(clause, selfSubject)) return true
    if (/\bthe baseline\b/i.test(clause) && !mentions(clause, selfSubject)) return true
    // "on a metric the task does not optimize for" scopes the comparison away.
    if (/\bdoes not optimi[sz]e\b/i.test(context) || /不(?:是|作为)优化目标/.test(context)) return true
    return false
  }

  if (ruleId === 'overgeneralized-limitation') {
    // A condition clause turns a universal-sounding phrase into a scoped one:
    // `在缺少标注数据的冷启动阶段，该方法无法处理长尾类别`.
    const scoped = /(?:在|当|对于|针对)[^。；;\n]{0,40}(?:阶段|情况下|条件|场景|时|下)/.test(context)
      || /\b(?:when|for|on|in)\b[^.;\n]{0,60}\b(?:inputs?|cases?|scenarios?|settings?|conditions?)\b/i.test(context)
    if (scoped) return true
    // A named capability limit (`longer than its context window`) is a fact.
    if (/\b(?:longer than|shorter than|more than|fewer than)\b/i.test(context)) return true
    return false
  }

  if (ruleId === 'procedural-narration') {
    // Method/experiment prose legitimately narrates procedure. The section
    // multiplier already covers headings; this covers unlabelled method text.
    // A pointer into the paper (`如第 3.2 节所述`) is also procedural, not
    // narrative: it tells the reader where the procedure is documented.
    if (/\b(?:preprocess|tokeniz|segment|encod|split|partition|corpus|dataset|pipeline|implement)\w*/i.test(context)) return true
    if (/(?:预处理|分词|划分|切分|编码|语料|数据集|流程|实现|第\s*\d+(?:\.\d+)*\s*节)/.test(context)) return true
    return false
  }

  if (ruleId === 'premature-self-negation') {
    // A pointer to where limitations are discussed is navigation, not a hedge.
    if (/(?:第\s*\d+(?:\.\d+)*\s*节|Section\s+\d+(?:\.\d+)*)/i.test(context)
      && /(?:讨论|说明|详见|见|discuss|describes?|covers?)/i.test(context)) return true
    return false
  }

  if (ruleId === 'defensive-preamble') {
    // A preamble that introduces a verifiable protocol detail carries information.
    if (/\b(?:random seed|repeated|reproduc|deterministic|by construction)\b/i.test(context)) return true
    if (/(?:随机种子|重复\s*\d+\s*次|可复现|确定性)/.test(context)) return true
    return false
  }

  if (ruleId === 'apology') {
    // A correction of a concrete error is information, not an apology.
    if (/\b(?:typo|errata|erratum|corrected here|earlier version|previous version)\b/i.test(context)) return true
    if (/(?:更正|勘误|笔误|前一版|早期版本)/.test(context)) return true
    return false
  }

  if (ruleId === 'comparison-scope-creep') {
    // A named, bounded set (a table, a figure, an explicit count) is evidence,
    // not scope creep: `On all datasets in Table 1` / `表 2 列出的三个数据集`.
    if (/(?:表|图|Table|Figure)\s*\d+/i.test(context)) return true
    if (/(?:\bthree|\bfour|\bfive|\bthese|\bthe\s+\d+|列出的|这三个|以上\s*\d+\s*个)\b/i.test(context)) return true
    return false
  }

  return false
}

/**
 * Collect hits for one rule over the masked text.
 * @param {object} rule - rule definition.
 * @param {string} masked - masked text.
 * @param {Map<string, string[]>} extra - user lexicon overrides.
 */
function ruleHits(rule, masked, extra) {
  const candidates = []
  const sources = [
    { language: 'zh', phrases: [...(rule.phrases?.zh ?? []), ...(extra.get(`${rule.id}:zh`) ?? [])] },
    { language: 'en', phrases: [...(rule.phrases?.en ?? []), ...(extra.get(`${rule.id}:en`) ?? [])] },
  ]
  for (const { language, phrases } of sources) {
    for (const phrase of sortedPhrases(phrases)) {
      const re = phraseMatcher(phrase, language)
      for (const match of masked.matchAll(re)) {
        const start = match.index ?? 0
        const end = start + match[0].length
        // Rule-specific guards against legitimate academic usage.
        if (isLegitimateUsage(rule.id, masked, start, end, phrase, language)) continue
        candidates.push({ start, end, phrase, language })
      }
    }
  }
  // De-overlap within one rule: leftmost, then longest.
  candidates.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept = []
  let cursor = -1
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue
    kept.push(candidate)
    cursor = candidate.end
  }
  return kept
}

/**
 * Health score. 100 = no defensive signals, 0 = saturated.
 * @param {number} weightedPoints - sum of severity weight x section multiplier.
 * @param {number} sentences - detected sentence count.
 */
export function scoreOf(weightedPoints, sentences) {
  const denominator = Math.max(sentences, MIN_SENTENCES)
  const density = weightedPoints / denominator
  const score = Math.round(100 - SCORE_SLOPE * density)
  return Math.max(0, Math.min(100, score))
}

/**
 * Scan one piece of prose.
 *
 * @param {string} text - the prose to scan (Chinese, English, or mixed).
 * @param {object} [options]
 * @param {string} [options.section] - force a section instead of auto-detecting.
 * @param {'high'|'medium'|'low'} [options.minSeverity] - list only hits at or above this severity.
 *   A display filter: it never changes `score`, `defensiveDensity`, or `stats`, because the
 *   text did not change. `stats.hidden` reports how many hits it hid.
 * @param {string[]} [options.disabledRules] - rule ids to skip entirely (a metric definition, not a filter).
 * @param {Record<string, {zh?: string[], en?: string[]}>} [options.extraPhrases] - per-rule additions.
 * @param {number} [options.maxHits=500] - cap the returned hit list (stats stay complete).
 * @returns {Report}
 */
export function scan(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('scan(text): text must be a string')
  const empty = text.trim().length === 0
  const { masked, regions } = maskRegions(text)
  const lineStarts = lineStartsOf(text)
  const headings = headingSpans(text, regions)
  const ranges = empty ? [] : sentenceRanges(masked)
  const sentenceCount = ranges.length

  const forcedSection = options.section
  const disabled = new Set(options.disabledRules ?? [])
  const minSeverity = options.minSeverity
  const severityRank = { low: 1, medium: 2, high: 3 }
  const minRank = minSeverity === undefined ? 0 : severityRank[minSeverity] ?? 0

  const extraMap = new Map()
  for (const [ruleId, lists] of Object.entries(options.extraPhrases ?? {})) {
    if (Array.isArray(lists?.zh)) extraMap.set(`${ruleId}:zh`, lists.zh)
    if (Array.isArray(lists?.en)) extraMap.set(`${ruleId}:en`, lists.en)
  }

  const hits = []
  const suppressed = []
  const perRule = new Map()
  let weightedPoints = 0
  let markedChars = 0

  for (const rule of RULES) {
    if (disabled.has(rule.id)) continue
    const found = ruleHits(rule, masked, extraMap)
    if (found.length === 0) continue
    for (const candidate of found) {
      const section = forcedSection ?? sectionAt(headings, candidate.start, 'unknown')
      const multiplier = rule.sections[section] ?? 1
      if (multiplier < SUPPRESS_BELOW) {
        suppressed.push({ ruleId: rule.id, start: candidate.start, end: candidate.end, section })
        continue
      }
      const weight = SEVERITY_WEIGHT[rule.severity] * multiplier
      weightedPoints += weight
      markedChars += candidate.end - candidate.start
      const position = positionOf(lineStarts, candidate.start)
      const suggestion = rule.suggest(candidate)
      const sentence = sentenceAt(ranges, candidate.start)
      const entry = {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        kind: rule.kind,
        start: candidate.start,
        end: candidate.end,
        line: position.line,
        column: position.column,
        text: text.slice(candidate.start, candidate.end),
        phrase: candidate.phrase,
        language: candidate.language,
        section,
        weight: Number(weight.toFixed(3)),
        // The enclosing sentence, so a UI can show context without re-scanning.
        // `excerpt` clips long sentences around the hit and marks the phrase.
        sentence: sentence === null ? text.slice(candidate.start, candidate.end) : text.slice(sentence.start, sentence.end),
        excerpt: buildExcerpt(
          sentence === null ? text.slice(candidate.start, candidate.end) : text.slice(sentence.start, sentence.end),
          sentence === null ? 0 : candidate.start - sentence.start,
          candidate.end - candidate.start,
        ),
        suggestion: {
          kind: suggestion.kind,
          note: suggestion.note,
          ...(suggestion.text === undefined ? {} : { text: suggestion.text }),
        },
      }
      hits.push(entry)
      const count = perRule.get(rule.id) ?? { ruleId: rule.id, count: 0, high: 0, medium: 0, low: 0 }
      count.count += 1
      count[rule.severity] += 1
      perRule.set(rule.id, count)
    }
  }

  hits.sort((a, b) => a.start - b.start)

  const bySection = new Map()
  for (const hit of hits) {
    bySection.set(hit.section, (bySection.get(hit.section) ?? 0) + 1)
  }

  // `minSeverity` filters the list only. Computing it after the score would let
  // a caller raise the score by narrowing the filter, which is the one thing a
  // diagnostic metric must never allow.
  const reportedHits = minRank === 0 ? hits : hits.filter((hit) => severityRank[hit.severity] >= minRank)
  const hidden = hits.length - reportedHits.length
  const maxHits = Number.isFinite(options.maxHits) && options.maxHits > 0 ? Math.floor(options.maxHits) : 500
  const truncated = reportedHits.length > maxHits
  const reported = truncated ? reportedHits.slice(0, maxHits) : reportedHits

  return {
    version: DETECTOR_VERSION,
    score: empty ? 100 : scoreOf(weightedPoints, sentenceCount),
    defensiveDensity: empty ? 0 : Number((weightedPoints / Math.max(sentenceCount, MIN_SENTENCES)).toFixed(3)),
    stats: {
      chars: text.length,
      sentences: sentenceCount,
      hits: hits.length,
      high: hits.filter((hit) => hit.severity === 'high').length,
      medium: hits.filter((hit) => hit.severity === 'medium').length,
      low: hits.filter((hit) => hit.severity === 'low').length,
      suppressed: suppressed.length,
      hidden,
      weightedPoints: Number(weightedPoints.toFixed(3)),
      markedRatio: text.length === 0 ? 0 : Number((markedChars / text.length).toFixed(4)),
    },
    byRule: [...perRule.values()].sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId)),
    bySection: [...bySection.entries()].map(([section, count]) => ({ section, count })),
    hits: reported,
    truncated,
    suppressed,
    coverage: {
      maskedRegions: regions.map((region) => ({ name: region.name, start: region.start, end: region.end })),
      sectionsSeen: [...new Set(headings.map((heading) => heading.section))],
    },
  }
}

/** Re-export the judgement surface next to the geometry. */
export { RULES, RULES_BY_ID } from './rules.js'
export { CN, EN } from './lexicons.js'

/**
 * @typedef {object} Report
 * @property {number} version - detector schema version.
 * @property {number} score - 0-100 writing-health score (100 is clean).
 * @property {number} defensiveDensity - weighted points per sentence.
 * @property {object} stats - aggregate counts.
 * @property {Array} byRule - per-rule counts.
 * @property {Array} bySection - per-section counts.
 * @property {Array} hits - ordered hit list with offsets and suggestions.
 * @property {boolean} truncated - whether `hits` was capped.
 * @property {Array} suppressed - hits ignored by section rules.
 * @property {object} coverage - masked regions and sections seen.
 */
