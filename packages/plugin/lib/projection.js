/**
 * The `adwWriting` session projection — the dashboard's read model.
 *
 * Folding rules that matter (verified against dsh-session-projection 0.2.1-rc.5):
 *   - `apply` is synchronous and MUST return the same state reference for
 *     events it does not care about; a new object means downstream work.
 *   - The wire view must be plain JSON: no `undefined`-valued properties, no
 *     Date, no class instances, no functions.
 *   - `stateVersion` bumps whenever fields or fold semantics change.
 *   - Retention is bounded: the projection must not grow with session length.
 *
 * What is folded:
 *   - `user/message`  → the text the author is working on (bounded preview)
 *   - `tool/result` for `adw_scan` → the authoritative report (score + counts)
 *   - `command/done` for `/adw scan` → file-level scan results
 *   - `assistant/message` → a cheap bounded re-scan of the reply, so the panel
 *     moves even when the model did not call the tool
 *
 * Everything else returns the same reference.
 *
 * @module dsh-anti-defensive-writing/projection
 */

import { scan, RULES } from './detector.js'

/** Projection key, stable across versions. */
export const PROJECTION_KEY = 'adwWriting'
/** Schema version; bump on any state or fold change. */
export const STATE_VERSION = 2

/** Bounds. A session with 500 turns must not grow this projection. */
const MAX_TURNS = 60
const MAX_HITS = 200
const MAX_PREVIEW = 160
const MAX_SCAN_CHARS = 20_000
const MAX_BY_RULE = 12

/** The historical point kept for the before/after comparison. */
const MAX_PAIRS = 8
/** Hit cards kept for the panel; enough to fill a scroll pane. */
const MAX_RECENT = 40
/** Characters of sentence context stored per hit card. */
const MAX_EXCERPT = 180

/**
 * Empty state.
 * @returns {object}
 */
function initialState() {
  return {
    /** Newest last. Each point is one observed sample. */
    points: [],
    /** rule id → cumulative hits across the session. */
    ruleTotals: {},
    /** Last report-level totals. */
    last: {
      score: 100,
      hits: 0,
      high: 0,
      medium: 0,
      low: 0,
      chars: 0,
      at: 0,
      source: 'none',
    },
    /** Rewrite pairs: before/after scores for the same passage. */
    pairs: [],
    /** Pending "before" sample waiting for the next scan of similar text. */
    pendingBefore: null,
    /** Newest hit cards, newest last. */
    recent: [],
    /** Number of scans observed. */
    scans: 0,
    /** Last touched turn (for the UI to group by turn). */
    turn: 0,
  }
}

/** Turn number from an event, when the host stamped one. */
function turnOf(event) {
  const turn = event?.data?.turn
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
}

/** Extract plain text from a message content array. */
function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    if (block.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out
}

/** One-line preview, bounded. */
function preview(text) {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= MAX_PREVIEW) return flat
  return flat.slice(0, MAX_PREVIEW - 1) + '…'
}

/**
 * Append one sample point, trimming the two parallel arrays together.
 * @param {object} state
 * @param {object} point
 */
function pushPoint(state, point) {
  const points = [...state.points, point]
  const trimmed = points.length > MAX_TURNS ? points.slice(points.length - MAX_TURNS) : points
  return { points: trimmed }
}

/**
 * Project detector hits into bounded, render-ready cards. The panel shows
 * these; it never re-scans and never touches offsets.
 * @param {Array<object>} hits
 * @param {string} source
 */
function hitCards(hits, source) {
  return hits.map((hit) => ({
    ruleId: hit.ruleId,
    ruleName: hit.ruleName,
    severity: hit.severity,
    kind: hit.kind,
    line: hit.line,
    column: hit.column,
    text: hit.text,
    sentence: clip(hit.sentence ?? hit.text, MAX_EXCERPT),
    excerpt: clip(hit.excerpt ?? hit.text, MAX_EXCERPT),
    section: hit.section,
    // Tool results carry the note as a string; raw detector hits carry the
    // structured suggestion. Accept both so the fold works on either source.
    note: typeof hit.suggestion === 'string' ? hit.suggestion : (hit.suggestion?.note ?? ''),
    source,
  }))
}

/** Clip with an ellipsis, never returning undefined. */
function clip(value, max) {
  const text = typeof value === 'string' ? value : ''
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

/** Keep only the newest N cards. */
function pushHits(state, cards) {
  if (cards.length === 0) return state.recent
  const merged = [...state.recent, ...cards]
  return merged.length > MAX_RECENT ? merged.slice(merged.length - MAX_RECENT) : merged
}

/** Severity mix as integer percentages that sum to 100 (largest remainder). */
function severityMix(high, medium, low) {
  const total = high + medium + low
  if (total === 0) return { high: 0, medium: 0, low: 0 }
  const raw = [high / total, medium / total, low / total].map((value) => value * 100)
  const floors = raw.map(Math.floor)
  let remainder = 100 - floors.reduce((a, b) => a + b, 0)
  const order = raw.map((value, index) => ({ index, frac: value - floors[index] })).sort((a, b) => b.frac - a.frac)
  for (let i = 0; i < remainder; i++) floors[order[i % 3].index] += 1
  return { high: floors[0], medium: floors[1], low: floors[2] }
}

/** Accumulate rule totals from a report, bounded to the known rule ids. */
function addRuleTotals(totals, byRule) {
  const next = { ...totals }
  for (const row of byRule) {
    if (!RULES.some((rule) => rule.id === row.ruleId)) continue
    next[row.ruleId] = (next[row.ruleId] ?? 0) + row.count
  }
  return next
}

/**
 * Parse an `adw_scan` tool result. The canonical value is the tool's declared
 * output; the session records rendered content, so both shapes are accepted.
 * @returns {object|null}
 */
function reportFromToolResult(event) {
  const data = event?.data
  if (typeof data !== 'object' || data === null) return null
  const source = data.source
  if (typeof source !== 'object' || source === null) return null
  if (typeof source.callId !== 'string') return null
  const meta = data.meta
  if (typeof meta !== 'object' || meta === null) return null
  // Tool presentation metadata carries the canonical value when the host
  // provides it; otherwise the rendered content is not parsable and the fold
  // falls back to the assistant-message scan.
  const value = meta.value
  if (typeof value !== 'object' || value === null) return null
  const result = value.result
  if (typeof result !== 'object' || result === null || result.ok !== true) return null
  if (typeof result.score !== 'number' || typeof result.stats !== 'object') return null
  return result
}

/**
 * Fold one session event.
 *
 * @param {object} state - previous state (never mutated).
 * @param {{ type: string, seq: number, time: number, data?: object }} event
 * @param {{ scan?: typeof scan }} [deps]
 * @returns {object} the same reference when uninterested.
 */
export function applyEvent(state, event, deps = { scan }) {
  const scanFn = deps.scan ?? scan

  if (event.type === 'user/message') {
    const content = textOfContent(event.data?.content)
    if (content.trim() === '') return state
    const report = boundedScan(scanFn, content)
    // A user message is a "before" candidate: remember it until a scan settles.
    const before = {
      text: preview(content),
      score: report.score,
      hits: report.stats.hits,
      at: typeof event.time === 'number' ? event.time : 0,
      seq: event.seq,
    }
    return {
      ...state,
      pendingBefore: before,
      ...(turnOf(event) === undefined ? {} : { turn: turnOf(event) }),
    }
  }

  if (event.type === 'tool/result') {
    const report = reportFromToolResult(event)
    if (report === null) return state
    const point = {
      seq: event.seq,
      at: typeof event.time === 'number' ? event.time : 0,
      turn: turnOf(event) ?? state.turn,
      score: report.score,
      hits: report.stats.hits,
      high: report.stats.high,
      medium: report.stats.medium,
      low: report.stats.low,
      chars: report.stats.chars,
      source: 'tool',
    }
    const pairs = [...state.pairs]
    if (state.pendingBefore !== null) {
      pairs.push({
        before: state.pendingBefore.score,
        after: report.score,
        beforeHits: state.pendingBefore.hits,
        afterHits: report.stats.hits,
        at: point.at,
      })
      while (pairs.length > MAX_PAIRS) pairs.shift()
    }
    return {
      ...state,
      ...pushPoint(state, point),
      ruleTotals: addRuleTotals(state.ruleTotals, report.byRule ?? []),
      recent: pushHits(state, hitCards(report.hits ?? [], 'tool')),
      last: point,
      pairs,
      pendingBefore: null,
      scans: state.scans + 1,
    }
  }

  if (event.type === 'command/done') {
    const data = event.data
    if (typeof data !== 'object' || data === null) return state
    if (data.kind !== 'success' || typeof data.text !== 'string') return state
    // Command output is free text; only the `adw scan` shape carries a score.
    const match = /写作健康度 (\d+)\/100 · 命中 (\d+) 处（高 (\d+) \/ 中 (\d+) \/ 低 (\d+)）/.exec(data.text)
    if (match === null) return state
    const point = {
      seq: event.seq,
      at: typeof event.time === 'number' ? event.time : 0,
      turn: turnOf(event) ?? state.turn,
      score: Number(match[1]),
      hits: Number(match[2]),
      high: Number(match[3]),
      medium: Number(match[4]),
      low: Number(match[5]),
      chars: 0,
      source: 'command',
    }
    return {
      ...state,
      ...pushPoint(state, point),
      last: point,
      scans: state.scans + 1,
    }
  }

  if (event.type === 'assistant/message') {
    const content = textOfContent(event.data?.message?.content ?? event.data?.content)
    if (content.trim() === '') return state
    const report = boundedScan(scanFn, content)
    if (report.stats.hits === 0 && state.points.length > 0) {
      // A clean reply still moves the trend: authors need to see the flatline.
      const point = {
        seq: event.seq,
        at: typeof event.time === 'number' ? event.time : 0,
        turn: turnOf(event) ?? state.turn,
        score: report.score,
        hits: 0,
        high: 0,
        medium: 0,
        low: 0,
        chars: report.stats.chars,
        source: 'assistant',
      }
      return { ...state, ...pushPoint(state, point), last: point }
    }
    if (report.stats.hits === 0) return state
    const point = {
      seq: event.seq,
      at: typeof event.time === 'number' ? event.time : 0,
      turn: turnOf(event) ?? state.turn,
      score: report.score,
      hits: report.stats.hits,
      high: report.stats.high,
      medium: report.stats.medium,
      low: report.stats.low,
      chars: report.stats.chars,
      source: 'assistant',
    }
    return {
      ...state,
      ...pushPoint(state, point),
      ruleTotals: addRuleTotals(state.ruleTotals, report.byRule ?? []),
      recent: pushHits(state, hitCards(report.hits ?? [], 'assistant')),
      last: point,
      scans: state.scans + 1,
    }
  }

  return state
}

/** Scan at most MAX_SCAN_CHARS of a message, fairly (head + tail). */
function boundedScan(scanFn, text) {
  if (text.length <= MAX_SCAN_CHARS) return scanFn(text, { maxHits: MAX_HITS })
  const half = Math.floor(MAX_SCAN_CHARS / 2)
  return scanFn(text.slice(0, half) + '\n' + text.slice(text.length - half), { maxHits: MAX_HITS })
}

/**
 * Project state to the client-visible, plain-JSON view. No `undefined`
 * properties: every optional field is either present with a real value or
 * omitted.
 * @param {object} state
 */
export function viewOf(state) {
  const byRule = Object.entries(state.ruleTotals)
    .map(([ruleId, count]) => {
      const rule = RULES.find((item) => item.id === ruleId)
      return {
        ruleId,
        count,
        severity: rule?.severity ?? 'low',
        name: rule?.name ?? ruleId,
      }
    })
    .sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId))
    .slice(0, MAX_BY_RULE)
  const points = state.points.slice(-MAX_TURNS)
  const scores = points.map((point) => point.score)

  // Delta against the previous sample: the single most useful number to show
  // next to the score, because it answers "is this edit better than the last".
  const previous = points.length >= 2 ? points[points.length - 2] : undefined
  const delta = previous === undefined
    ? undefined
    : {
        score: state.last.score - previous.score,
        hits: state.last.hits - previous.hits,
      }

  // Last 30 samples are enough for the sparkline and keep the wire small.
  return {
    version: STATE_VERSION,
    scans: state.scans,
    turn: state.turn,
    last: {
      score: state.last.score,
      hits: state.last.hits,
      high: state.last.high,
      medium: state.last.medium,
      low: state.last.low,
      chars: state.last.chars,
      at: state.last.at,
      source: state.last.source,
    },
    ...(delta === undefined ? {} : { delta }),
    mix: severityMix(state.last.high, state.last.medium, state.last.low),
    byRule,
    recent: state.recent.slice().reverse(),
    trend: points.map((point) => ({
      seq: point.seq,
      at: point.at,
      score: point.score,
      hits: point.hits,
    })),
    pairs: state.pairs.map((pair) => ({
      before: pair.before,
      after: pair.after,
      beforeHits: pair.beforeHits,
      afterHits: pair.afterHits,
      at: pair.at,
    })),
    summary: {
      distinctRules: byRule.length,
      totalHits: byRule.reduce((sum, row) => sum + row.count, 0),
      averageScore: scores.length === 0 ? 100 : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      worstScore: scores.length === 0 ? 100 : Math.min(...scores),
      bestScore: scores.length === 0 ? 100 : Math.max(...scores),
    },
  }
}

/** A minimal schema object: `parse` validates and returns the value. */
export const viewSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) throw new TypeError('adwWriting view must be an object')
    for (const key of ['version', 'scans', 'turn', 'last', 'byRule', 'trend', 'pairs', 'summary']) {
      if (!(key in value)) throw new TypeError(`adwWriting view missing ${key}`)
    }
    assertPlainJson(value, 'adwWriting')
    return value
  },
}

/** Same contract as `viewSchema`, applied to the host state. */
export const stateSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) throw new TypeError('adwWriting state must be an object')
    assertPlainJson(value, 'adwWriting state')
    return value
  },
}

/** Reject values the projection cache cannot serialize. */
function assertPlainJson(value, path) {
  if (value === null) return
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') {
    if (type === 'number' && !Number.isFinite(value)) throw new TypeError(`${path}: non-finite number`)
    return
  }
  if (type === 'undefined') throw new TypeError(`${path}: undefined is not plain JSON`)
  if (type === 'function' || type === 'symbol' || type === 'bigint') throw new TypeError(`${path}: ${type} is not plain JSON`)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPlainJson(item, `${path}[${index}]`))
    return
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${path}: only plain objects are allowed`)
  }
  for (const [key, item] of Object.entries(value)) assertPlainJson(item, `${path}.${key}`)
}

/**
 * Build the projection definition.
 * @param {{ scan?: typeof scan }} [deps]
 */
export function buildWritingHealthProjection(deps = { scan }) {
  return {
    key: PROJECTION_KEY,
    stateSchema,
    stateVersion: STATE_VERSION,
    init: () => initialState(),
    apply: (state, event) => applyEvent(state, event, deps),
    wire: { viewSchema, view: viewOf },
  }
}

/**
 * Register on a context that has `sessionProjections`.
 * @param {object} ctx
 * @param {{ scan?: typeof scan }} [deps]
 */
export function registerWritingHealth(ctx, deps) {
  const registry = ctx.get('sessionProjections')
  if (registry === undefined || typeof registry.register !== 'function') return
  registry.register(buildWritingHealthProjection(deps))
}
