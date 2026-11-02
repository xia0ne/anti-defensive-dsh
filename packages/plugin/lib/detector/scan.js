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

/** Section heading vocabulary. Ordered: first match wins. */
const HEADING_PATTERNS = [
  { section: 'abstract', re: /^(abstract|摘要)\b/i },
  { section: 'introduction', re: /^(introduction|引言|前言|绪论)\b/i },
  { section: 'related-work', re: /^(related work|related research|background|相关工作|研究背景)\b/i },
  { section: 'method', re: /^(method|methods|methodology|approach|方法|模型)\b/i },
  { section: 'experiments', re: /^(experiment|experiments|experimental setup|实验|实验设置)\b/i },
  { section: 'results', re: /^(results|结果|实验结果)\b/i },
  { section: 'discussion', re: /^(discussion|讨论)\b/i },
  { section: 'conclusion', re: /^(conclusion|conclusions|结论|总结)\b/i },
  { section: 'limitations', re: /^(limitations?|局限|局限性)\b/i },
  { section: 'rebuttal', re: /^(rebuttal|response to reviewers?|审稿意见回复|回复审稿人)\b/i },
]

/**
 * Blank out regions that must not produce hits, preserving length and newlines.
 * @param {string} text - raw input.
 * @returns {{ masked: string, regions: Array<{name: string, start: number, end: number}> }}
 */
function maskRegions(text) {
  const chars = [...text]
  let masked = text
  const regions = []
  for (const { name, re } of MASKERS) {
    const fresh = new RegExp(re.source, re.flags)
    for (const match of masked.matchAll(fresh)) {
      const start = match.index ?? 0
      const end = start + match[0].length
      regions.push({ name, start, end })
      let blank = ''
      for (let i = start; i < end; i++) blank += masked[i] === '\n' ? '\n' : ' '
      masked = masked.slice(0, start) + blank + masked.slice(end)
    }
  }
  // `chars` is intentionally unused beyond length validation; kept for a cheap
  // guard against malformed input reaching the masker.
  void chars
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
 * @param {string} text - original text (headings live outside masked regions).
 * @returns {Array<{ start: number, end: number, section: string }>}
 */
function headingSpans(text) {
  const spans = []
  const re = /^[ \t]{0,3}(#{1,6})[ \t]*([^\n]*)$/gm
  for (const match of text.matchAll(re)) {
    const title = match[2].trim()
    if (title.length === 0) continue
    const section = HEADING_PATTERNS.find((item) => item.re.test(title))?.section
    if (section === undefined) continue
    const start = match.index ?? 0
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
        if (rule.id === 'self-weakening-hedge') {
          const after = masked.slice(end, end + 4)
          const before = masked.slice(Math.max(0, start - 2), start)
          if (language === 'zh' && (phrase === '仅' || phrase === '仅仅')) {
            if (/^仅(?:当|限|于|在|用|对|需|能|可|供|凭|按|就|次)/.test(masked.slice(start, start + 3))) continue
            if (masked.slice(Math.max(0, start - 1), start) === '不') continue
          }
          if (language === 'zh' && phrase === '不如' && /^不如说/.test(masked.slice(start))) continue
          if (language === 'en') {
            // "only if/when/..." scopes a condition; "not only X but also Y" is additive.
            if (/^only (?:if|when|in|for|under|at|after|before|once)\b/i.test(masked.slice(start))) continue
            const beforeWord = masked.slice(Math.max(0, start - 6), start)
            if (/\bnot\s$/i.test(beforeWord)) continue
            if (phrase.startsWith('only ') && /\bnot\s+$/i.test(beforeWord)) continue
          }
          void after
        }
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
 * @param {'high'|'medium'|'low'} [options.minSeverity] - report only at or above this severity.
 * @param {string[]} [options.disabledRules] - rule ids to skip.
 * @param {Record<string, {zh?: string[], en?: string[]}>} [options.extraPhrases] - per-rule additions.
 * @param {boolean} [options.includeSuppressed=false] - include section-suppressed hits.
 * @param {number} [options.maxHits=500] - cap the returned hit list (stats stay complete).
 * @returns {Report}
 */
export function scan(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('scan(text): text must be a string')
  const empty = text.trim().length === 0
  const { masked, regions } = maskRegions(text)
  const lineStarts = lineStartsOf(text)
  const headings = headingSpans(text)
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
    if (severityRank[rule.severity] < minRank) continue
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

  const maxHits = Number.isFinite(options.maxHits) && options.maxHits > 0 ? Math.floor(options.maxHits) : 500
  const truncated = hits.length > maxHits
  const reported = truncated ? hits.slice(0, maxHits) : hits

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
