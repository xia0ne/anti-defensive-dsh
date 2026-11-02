import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * Load the browser bundle in a sandbox with a fake module loader and fake
 * react/react-jsx-runtime, then drive `apply()` against a fake Cordis context.
 * This proves the bundle is syntactically valid, registers the expected seats,
 * and renders without throwing.
 */
function loadClientBundle() {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const registered = []
  const styles = []
  const listeners = {}

  // Eagerly invoke function components so the test asserts on rendered output,
  // not on a lazy element descriptor.
  const render = (type, props) => (typeof type === 'function' ? type(props ?? {}) : { type, props })
  const jsxRuntime = {
    jsx: render,
    jsxs: render,
    Fragment: Symbol('Fragment'),
  }
  const react = {
    Fragment: Symbol('Fragment'),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
  }
  const moduleTable = {
    'react': react,
    'react/jsx-runtime': jsxRuntime,
  }

  const documentStub = {
    querySelector: (selector) => (styles.includes(selector) ? {} : null),
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: (tag) => styles.push(`style[data-plugin-css="${tag.dataset.pluginCss}"]`) },
  }

  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: ({ id, factory }) => registered.push({ id, exports: factory((name) => {
          if (!(name in moduleTable)) throw new Error(`unexpected external module: ${name}`)
          return moduleTable[name]
        }) }),
      },
    },
    document: documentStub,
    console,
    setTimeout,
    clearTimeout,
    React: undefined,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.equal(registered.length, 1)
  return { bundle: registered[0], sandbox }
}

function fakeContext() {
  const registrations = { tabs: [], slots: [], locales: [] }
  const ctx = {
    effect(fn) {
      const disposer = fn()
      return () => disposer?.()
    },
    locale: {
      register(namespace, dictionaries) {
        registrations.locales.push({ namespace, dictionaries })
        return () => {}
      },
      bind() {
        // Mirrors the real ctx.locale.bind(ns): t(key, values?) interpolates
        // {name} placeholders itself. A caller that pre-formats and then calls
        // t(key) again loses every placeholder, so this fake must be exact.
        return (key, values) => {
          const dict = registrations.locales.at(-1)?.dictionaries?.zh ?? {}
          const template = dict[key] ?? key
          return String(template).replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''))
        }
      },
    },
    sidebarRightTabs: {
      register(definition) {
        registrations.tabs.push(definition)
        return () => {}
      },
    },
    slots: {
      inject(name, factory) {
        return factory()
      },
      register(options, Component) {
        registrations.slots.push({ options, Component })
        return () => {}
      },
    },
  }
  return { ctx, registrations }
}

test('client bundle registers under the module loader with expected exports', () => {
  const { bundle } = loadClientBundle()
  assert.equal(bundle.id, 'dsh-anti-defensive-writing')
  assert.equal(typeof bundle.exports.apply, 'function')
  // Arrays built inside the vm sandbox have a different Array prototype.
  assert.deepEqual([...bundle.exports.inject], ['slots', 'locale', 'sidebarRightTabs'])
  assert.equal(bundle.exports.NS, 'dsh-anti-defensive-writing')
  assert.equal(bundle.exports.RULE_CATALOG.length, 8)
})

test('client apply registers tab type, tab body, title and settings section', () => {
  const { bundle } = loadClientBundle()
  const { ctx, registrations } = fakeContext()
  bundle.exports.apply(ctx)

  assert.equal(registrations.locales.length, 1)
  assert.equal(registrations.locales[0].namespace, 'dsh-anti-defensive-writing')

  assert.equal(registrations.tabs.length, 1)
  assert.equal(registrations.tabs[0].id, 'dsh-adw')
  assert.equal(registrations.tabs[0].kind, 'adw-writing-health')

  const slotNames = registrations.slots.map((slot) => slot.options.name).sort()
  assert.deepEqual(slotNames, [
    'settings.section',
    'sidebar.right.pane.tab',
    'sidebar.right.pane.tab.title',
  ])
  const body = registrations.slots.find((slot) => slot.options.name === 'sidebar.right.pane.tab')
  assert.equal(body.options.key, 'dsh-adw')
  const section = registrations.slots.find((slot) => slot.options.name === 'settings.section')
  assert.equal(section.options.id, 'anti-defensive-writing')
})

test('tab body renders an empty state when no projection is available', () => {
  const { bundle } = loadClientBundle()
  const { ctx, registrations } = fakeContext()
  bundle.exports.apply(ctx)
  const body = registrations.slots.find((slot) => slot.options.name === 'sidebar.right.pane.tab').Component
  const tree = body({ sessionId: 's1', useProjection: () => undefined })
  assert.ok(tree)
  assert.equal(tree.type, 'div')
  // The rendered tree is a jsx runtime object; assert the empty-state title made it in.
  const serialized = JSON.stringify(tree, (key, value) => (typeof value === 'symbol' ? String(value) : value))
  assert.match(serialized, /还没有可统计的样本/)
})

test('tab body renders score, trend and rule bars from a projection view', () => {
  const { bundle } = loadClientBundle()
  const { ctx, registrations } = fakeContext()
  bundle.exports.apply(ctx)
  const body = registrations.slots.find((slot) => slot.options.name === 'sidebar.right.pane.tab').Component
  const view = {
    version: 1,
    scans: 3,
    turn: 2,
    last: { score: 64, hits: 5, high: 2, medium: 2, low: 1, chars: 900, at: 1000, source: 'tool' },
    delta: { score: -8, hits: 2 },
    mix: { high: 40, medium: 40, low: 20 },
    byRule: [
      { ruleId: 'self-weakening-hedge', count: 3, severity: 'high', name: '自我削弱表达' },
      { ruleId: 'loss-framing', count: 2, severity: 'high', name: '主动承认落败' },
    ],
    recent: [
      { ruleId: 'loss-framing', ruleName: '主动承认落败', severity: 'high', kind: 'question', line: 7, column: 60, text: 'Our method is weaker', sentence: 'Our method is weaker than the baseline on dataset D.', excerpt: 'Our method is ⟦weaker⟧ than the baseline…', section: 'experiments', note: '这个比较是否必须出现在当前章节？', source: 'tool' },
      { ruleId: 'self-weakening-hedge', ruleName: '自我削弱表达', severity: 'medium', kind: 'rewrite', line: 3, column: 66, text: 'it must be admitted', sentence: 'it must be admitted that we have not tested cross-domain generalization.', excerpt: '⟦it must be admitted⟧ that we have not tested…', section: 'abstract', note: '把这段局限说明移出摘要/结论。', source: 'tool' },
    ],
    trend: [
      { seq: 1, at: 100, score: 80, hits: 1 },
      { seq: 2, at: 200, score: 72, hits: 3 },
      { seq: 3, at: 300, score: 64, hits: 5 },
    ],
    pairs: [{ before: 72, after: 91, beforeHits: 3, afterHits: 1, at: 400 }],
    summary: { distinctRules: 2, totalHits: 5, averageScore: 72, worstScore: 64, bestScore: 80 },
  }
  const tree = body({ sessionId: 's1', useProjection: (key) => (key === 'adwWriting' ? view : undefined) })
  const serialized = JSON.stringify(tree, (key, value) => (typeof value === 'symbol' ? String(value) : value))
  assert.match(serialized, /writing health|写作健康度|写作健康/)
  assert.match(serialized, /self-weakening-hedge/)
  assert.match(serialized, /loss-framing/)
  // score 64 appears in the ring
  assert.match(serialized, /64/)
  // hit detail must render: the actual sentence and its advice
  assert.match(serialized, /Our method is ⟦weaker⟧ than the baseline/)
  assert.match(serialized, /这个比较是否必须出现在当前章节/)
  // severity filter chips render with counts
  assert.match(serialized, /adw-chip/)
  // interpolation must survive: "3 次扫描" and "3 个样本", not " 次扫描"
  assert.match(serialized, /3 次扫描/)
  assert.match(serialized, /3 个样本/)
  assert.match(serialized, /1 组/)
})

test('settings section lists all eight rules with counter-examples', () => {
  const { bundle } = loadClientBundle()
  const { ctx, registrations } = fakeContext()
  bundle.exports.apply(ctx)
  const section = registrations.slots.find((slot) => slot.options.name === 'settings.section')
  const tree = section.Component({ t: (key) => key })
  const serialized = JSON.stringify(tree, (key, value) => (typeof value === 'symbol' ? String(value) : value))
  for (const rule of bundle.exports.RULE_CATALOG) {
    assert.ok(serialized.includes(rule.id), `missing rule ${rule.id}`)
  }
})
