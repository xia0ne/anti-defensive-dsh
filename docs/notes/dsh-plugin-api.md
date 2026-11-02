# DSH 插件 API 合约（host + client 接缝）

本文件是团队编码所依据的 API 合约。每条断言标注验证来源与行号；无法验证的一律标 **UNVERIFIED**，不猜测。片段均可直接复制。

## 验证范围（verified against）

- **DSH 0.2.1-rc.5**，解包于 `/tmp/dsh_asar/dsh/node_modules/@deepseek-ai/`（下文路径均以此为根）。
- **第三方插件实例**：`/Users/yrh/.dsh/profiles/desktop/node_modules/` 下 `dsh-context@0.73.3`、`dsh-context-length@0.1.0`、`dsh-right-click-menu@0.1.0`、`@nanmicoder/dsh-agent-teams@0.1.25`。
- **本仓库工作示例**：`packages/plugin/`（`dsh-anti-defensive-writing`）。
- **desktop profile**：`/Users/yrh/.dsh/profiles/desktop/{package.json,cordis.yml,cordis.patch.yml}`。

行号格式 `dsh-skill/lib/index.js:452` 为 `grep -n` 实测值（打包产物是压缩单行 ESM，按实际文件行计）。

---

## 1. 包形状（package.json + cordis.patch.yml）

插件由**两半**组成：host 半（`main`，普通 Cordis 插件）与可选 client 半（`exports["./client"]`，浏览器 bundle）。声明缺失则对应半不加载。

| 字段 | 必需性 | 语义 | 验证 |
|---|---|---|---|
| `main` / `exports["."]` | 必需 | host 半入口，作为 Loader 行被 `apply` | `packages/plugin/package.json` |
| `exports["./client"]` | client 半必需 | string，或 `{default: string}` | `dsh-client-modules/lib/index.js:172-182` |
| `dsh.bundle.patch` | bundle 必需 | 一个路径或**有序路径数组**，相对包根 | `dsh-app-boot/lib/index.js:517-531` |
| `dsh.client.platform` | client 半必需 | 只有 `"web"` 被 client-modules 收录 | `dsh-client-modules/lib/index.js:62-76,732-745` |
| `dsh.client.inject` | 可选 | 字符串数组，**模块加载顺序**依赖（非服务注入） | `dsh-client-modules/lib/index.js:67`；`lib/client.js:789` |
| `dsh.client.external` | 可选 | 非 baseline 模块请求，须由动态包行或静态表键提供 | `dsh-client-modules/README.md:50` |
| `dsh.client.immediately` | 可选 | 布尔，boot 期立即加载 | `dsh-client-modules/lib/index.js:69` |
| `dsh.manifestVersion` | 可选 | 当前为 `1` | `dsh-package-manifest/README.md` |
| `engines.node` / `engines.dsh` | 可选 | `engines.dsh` 存在时**单独**决定兼容性 | `dsh-app-boot/lib/index.js:279-298` |

`cordis.patch.yml` insert 行（`packages/plugin/cordis.patch.yml`；同形状见 `dsh-experimental-badge-skill-bundle/cordis.patch.yml`）：

```yaml
- insert:
    - id: anti-defensive-writing
      name: dsh-anti-defensive-writing
```

**兼容性判定**（`dsh-app-boot/lib/index.js:279-298`）：声明 `engines.dsh` 则只用它判；否则逐个检查 `@deepseek-ai/dsh*` 的 `peerDependencies` 范围。`workspace:^|~|*` 仅在 peer 上下文等价于当前版本；`engines.dsh` 里写 `workspace:` 视为不兼容。失败行置 `disabled: true`（bundle 整体跳过），exemption 写 profile 的 `compatibility.json`。

> `dsh.compatibility.dshReleases`（dsh-context 使用）在 0.2.1-rc.5 **无任何读取者**（`grep -rl dshReleases /tmp/dsh_asar/dsh/node_modules/` 为空）——**无效字段**，真正的门是 `engines.dsh` / `peerDependencies`。

---

## 2. Host 半：Cordis 插件形状

```js
export const name = 'anti-defensive-writing'   // fiber 诊断名
export const inject = []                        // 静态服务依赖；缺任一则 fiber 挂起
export const Config = { /* StandardSchemaV1 */ }
export function apply(ctx, config) { /* ... */ }
```

- 三种合法形状：函数、类、`{ name, inject, Config, apply }` 对象（`cordis/src/registry.ts:92-133`）；`resolve()` 只认函数或带 `apply` 的对象（`:222-228`）。
- `inject` 是**声明式前置条件**：服务齐备前插件不启动（`registry.ts:300-306`）。
- `ctx.get(name, strict = true)`：不建立依赖地读服务；`strict` 为真只返回 provider fiber 仍 active 的实现，否则 `undefined`（`cordis/src/reflect.ts:233-241`）。**动态可选依赖用它**。
- `ctx.inject(deps, callback)` ≡ `ctx.plugin({ inject: deps, apply: callback })`（`registry.ts:300-306`），fiber 随服务变化卸载/重启。`packages/plugin/lib/index.js` 全篇采用「`ctx.inject([svc], scoped => { const s = scoped.get(svc); if (!s) return; ... })`」。

### 生命周期与释放

`ctx.effect(execute, label)` 立即执行，收集返回的 disposer，在显式调用或 fiber 卸载时**逆序**执行；重复调用 disposer 是 no-op（`cordis/src/fiber.ts:415-425`）。effect 体可返回单个 disposer、disposer 数组或 generator。

```js
ctx.effect(() => {
  const off = doSomething()
  return () => off()
}, 'my-plugin: registration')
```

各 registry 的 `register()` 本身就是 effect，返回「精确的 Cordis effect disposer」：`dsh-skill/lib/index.js:147-183`、`dsh-tools/lib/index.js:2974-2983`、`dsh-commands/lib/index.js:266-269`、`dsh-session-projection/lib/index.js:68-102`。**不要手动保存再手动释放**。

---

## 3. Skill provider 注册

### 3.1 三个入口

| 入口 | 用途 | 验证 |
|---|---|---|
| `ctx.skills.registerProvider(create)` | 外部来源 provider；`create(control)` **同步调用一次** | `dsh-skill/lib/index.js:147` |
| `ctx.skills.register(skill)` | 内存内单条 skill，provider 固定 `runtime` | `:193` |
| `ctx.skills.list(options)` / `get(name, options)` | 消费侧读目录 / 按名加载正文 | `:224, :250` |

`control` = `{ signal: AbortSignal, invalidate(): void }`（`:148-157`）。`invalidate()` 只在**该次注册仍存活**时清缓存（`:152-156, :381-385`）。`provider.name` 不可为保留名 `"runtime"`，同名同层重复抛错（`:159-163`）。

### 3.2 candidate / definition 的精确字段契约

**candidate（`list()` 元素）** — `validateCandidate`（`dsh-skill/lib/index.js:452-464`）实测：

| 字段 | 必需 | 校验 |
|---|---|---|
| `name` | ✅ | 匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（kebab-case，`:17`） |
| `description` | ✅ | 非空字符串 |
| `invocation` | ✅ | `{modelInvocable: boolean, userInvocable: boolean}`，两者都须 boolean |
| `source` | ✅ | **必须 string**（缺失抛 `non-string source`） |
| `rank` | ✅ | **必须有限 number**（缺失抛 `invalid rank`） |
| `provider` | ✅ | 必须 string，且**必须等于** `provider.name` |
| `locator` | 语义必需 | 原样回传给 `get()` |
| `whenToUse` / `path` | 可选 | 若存在须 string |
| `resourceBase` | 可选 | `{kind:'directory',path}` / `{kind:'url',url}` / `{kind:'opaque',description}` |

> ⚠️ **与 lead 口径的差异**：lead 称 `provider/source/resourceBase/rank/locator` 皆可选。实测 `source`、`rank`、`provider` **三者必需**（`dsh-skill/lib/index.js:459-462`）。`resourceBase`、`locator` 可省，其余不可。

**definition（`get()` 返回）** — `validateDefinition`（`:471-490`）要求 `name`/`description`/`invocation`/`provider`/`source`/`content` 全部必需（`content` 为 string），可选 `whenToUse`/`path`/`resourceBase`。且 `definition.name` 必须等于选中 candidate 的 name，否则 entry 失效并触发下次重发现（`:259-263`）。

`list()` 可返回 `candidate[]` 或 `{candidates, complete: boolean}`；其它形状抛 `TypeError`（`:414-426`）。

### 3.3 rank 常量与优先级

| 常量 | 值 | 位置 |
|---|---|---|
| `PROJECT_DSH_RANK` / `PROJECT_AGENTS_RANK` / `CUSTOM_RANK` / `USER_DSH_RANK` / `USER_AGENTS_RANK` | 100 / 200 / 300 / 400 / 500 | `dsh-skill-filesystem/lib/index.js:20-24` |
| `RUNTIME_RANK`（不导出） | 250 | `dsh-skill/lib/index.js:21` |
| **`BUNDLED_SKILL_RANK`（导出）** | **600** | `dsh-skill/lib/index.js:23` |

排序：`rank` **升序** → provider 注册顺序 → provider 内 `list()` 顺序（`:519-521`）。层间：近层直接遮蔽远层，rank 只在同层内比较（`:84, :115`）。第三方自带 skill 用 `BUNDLED_SKILL_RANK`（`dsh-skill-badge/lib/index.js:26`、`dsh-skill-office/lib/index.js:74`）。

### 3.4 model / user 可见性

`invocation.modelInvocable` 管模型侧（catalog 与 `skill` 工具），`userInvocable` 管人类侧（`/name` 调用），两者独立，四种组合都保留（`dsh-skill/lib/index.js:37-47`、`dsh-skill/README.md:55-62`）。只对一侧可见的 skill 不会出现在另一侧目录。

### 3.5 正文渲染

`renderSkillContent(skill)` 由 `dsh-skill` 导出，工具结果与用户显式调用共用同一渲染（`:57-70`）：`<skill_content name>` 包 `<skill_resources>`（base directory / URL / opaque 提示）与 `<skill_instructions>`（正文）。`resourceBase` 缺省提示 `Resources for this skill are managed by provider "..."`（`:73`）；三种 kind 各有固定文案（`:74-77`）。

### 3.6 最小可粘贴片段

```js
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'

const CANDIDATE = {
  name: 'anti-defensive-writing',
  description: '阻止论文的防御性写作。触发词：论文润色、rebuttal、写摘要。',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'anti-defensive-writing',   // 必须等于 provider.name
  source: 'bundled',
  rank: BUNDLED_SKILL_RANK,             // 必需数字
  resourceBase: { kind: 'directory', path: '/abs/path/to/skills/anti-defensive-writing' },
  locator: 'skills/anti-defensive-writing/SKILL.md',
}

const provider = {
  name: 'anti-defensive-writing',
  list: () => Promise.resolve([CANDIDATE]),
  async get(candidate) {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: CANDIDATE.resourceBase,
      content: await readFile(SKILL_PATH, 'utf8'),
    }
  },
}

export const inject = ['skills']
export function apply(ctx) {
  ctx.skills.registerProvider(() => provider)   // 工厂，不是对象
}
```

（形状对照 `dsh-skill-badge/lib/index.js:16-52` 全文件后段。）

---

## 4. 模型可见工具：`defineTool`

```js
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'adw_scan',
  description: 'Scan academic prose for defensive writing.',
  parameters: {
    text: { type: 'string', description: 'The prose to scan.' },
    minSeverity: { type: 'string', description: 'high | medium | low.' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        score: { type: 'number' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: `score ${value.score}` }],
  },
  async execute(args, exec) {
    exec.signal?.throwIfAborted?.()
    return { ok: true, score: 100 }
  },
}))
```

**parameters DSL**（`dsh-tools/lib/index.js:650-760`，`compilePropertyMap` 在 `:756`）：属性名 → 属性 schema 的映射，不是 JSON Schema。每项支持 `type`（`string|number|integer|boolean|null|array|object`，作者侧另有 `json`）、`required?: true`、`description?`、`enum?`、`const?`、`items?`、`properties?`、`additionalProperties`。注意：`required` 只接受 **`true`**，写 `false` 抛 `required must be true when present`（`:603-604`）；`object` 节点**必须显式**给 `additionalProperties: true|false`（`:697-700`）。

**output**（`:2977`）：必须有 `schema` 与 `render`；`presentationMeta?` 存在时须为函数。`render(args, value)` 返回内容块数组，常用 `{type:'text', text}`，图片用 `{type:'image', attachment}`（`dsh-tool-fs/lib/index.js:966-973`）。返回值经 lossless-JSON 快照（`:3637-3669`）。

**execute(args, exec)** 关键字段（`:3229-3260`）：`signal`（协作取消）、`agent?`、`callId`、`rootCallId`、`arguments`、`deferContext(ctx)`、`concludeTurn()`。参数执行前由 DSL 编译的 JSON Schema 校验，非法输入变普通错误结果（`:866-870`）。

**并行安全与超时**：`isConcurrencySafe(args)` **只有精确返回 `true`** 才算 parallel，未声明/未知/抛错一律 `exclusive`（`:3153-3161`）。`timeoutMs` 只做**声明**，registry 从不强制，需 `@deepseek-ai/dsh-tool-call-timeout-policy`（`dsh-tools/README.md:235`）。工具一旦 register，schema 自动进入 system prompt 装配（`dsh-tools/README.md:30`）。

---

## 5. 斜杠命令：`ctx.commands.register`

```js
ctx.commands.register({
  name: 'adw',                                  // /^[a-z][a-z0-9_-]*$/
  description: '反防御性写作：扫描文件、查看规则',
  input: { hint: 'scan <path> | rules | version' },
  async handler({ commandId, agent, rawInput, attachments, signal }) {
    if (rawInput.trim() === '') return { kind: 'error', text: '缺少子命令' }
    return { kind: 'success', text: 'ok' }
  },
})
```

- name 语法 `/^[a-z][a-z0-9_-]*$/u`（`dsh-commands/lib/index.js:78`）；`description` 非空；`handler` 必须函数（`:149-153`）。
- `input`: `{hint: string, attachments?: boolean}`，`hint` 非空（`:154-164`）。
- **handler invocation**：`{commandId, agent, rawInput, attachments, signal}`，整体 `Object.freeze`（`:379-385`）。`rawInput` 是命令名之后的**全部原始文本**，含前导分隔空白（`:108-111`）。
- **返回契约**：`{kind:'success', text?, sourceEventSeq?}` 或 `{kind:'error', text}`——**error 的 text 必须非空**；未知 kind 抛 `TypeError`（`:184-206`）。
- `recordInput` 默认 true；命令自身已记权威事件时设 false 避免日志重复（`dsh-commands/README.md:46`）。
- 生命周期：`command/run` 在 handler 前、`command/done` 在结算后写入该 agent 会话日志；非法语法/未知命令**不记日志**（`:327-350`）。注册/移除 emit `commands/change`（`:428`）。
- **agent 作用域**：普通注册全局；声明 `commands` 注入的插件挂在 `agent.ctx` 下注册，即只对该 agent 生效并遮蔽同名全局（`dsh-commands/README.md:52-54`、`lib/index.js:82-90`）。

---

## 6. 会话投影：`ctx.sessionProjections.register`

```js
export function apply(ctx) {
  ctx.sessionProjections.register({
    key: 'adwWriting',
    stateSchema: { parse: (v) => v },          // 任何带 parse() 的对象都行
    stateVersion: 1,                            // 非负安全整数
    init: (_header, _inheritedEventCount) => ({ points: [], scans: 0 }),
    apply: (state, event) =>
      event.type === 'adw/scan' ? { ...state, scans: state.scans + 1 } : state,
    wire: {
      viewSchema: { parse: (v) => v },
      view: (state) => ({ scans: state.scans }),
    },
  })
}
```

| 字段 | 必需 | 说明 | 验证 |
|---|---|---|---|
| `key` | ✅ | 每键一个 definition；同 key 同 `stateVersion` 共享 cells 并计数 | `dsh-session-projection/lib/index.js:68-102` |
| `stateSchema` | ✅ | 只需 `.parse(value)`；restore 时 `def.stateSchema.parse(row.val)` | `:254, :296` |
| `stateVersion` | ✅ | 非负安全整数，否则注册抛错 | `:76-78` |
| `init(header, inheritedEventCount)` | ✅ | 收到 `session.header` 与精确 fork 继承切点 | `:68-74` |
| `apply(state, event)` | ✅ | **同步**；不关心的事件返回**同一引用** | `:386-392` |
| `wire?` | 可选 | 缺省即 **host-only**，客户端不可见 | `:145-149` |
| `wire.viewSchema` / `wire.view` | wire 内必需 | view 结果过 `.parse()`；**不得返回 Promise** | `:429-433` |

**三条硬规则**

1. **`apply` 必须同步**，不关心的事件返回同一引用——未变化引用意味着零下游工作（README:54；实现用 `Object.is(next, cell.state)` 判定，`:392`）。
2. **`wire.view` 原始结果按 `Object.is` 比较**：内部变化但视图引用不变 → 不发布；结构相等但新对象 → 仍算变化。要抑制发布必须复用引用（README:54；`:406-415`）。
3. **纯 JSON**：`checkpoint()` 用 `structuredClone` 深拷贝，注释明确「plain JSON by the unit contract, so the clone is total」（`:181-196`）。

> state-carrying 事件必须携带**变更后的完整状态**，不能只带 delta（README:54）。

**读面**：`snapshot(session)` → `{asOfSeq, values}`（`:140-155`）；`stateOf(session, key)` → 单 unit 的 live 只读 host 状态（`:118-127`）；`onChanged(listener)` → `(session, key, value, seq)`，返回 effect disposer（`:109-117`）；`cachedSnapshot(session, keys?)` 仅读已物化 cells，值可能滞后，只作 hint（`:164-180`）。

**真实例子**：`dsh-context` 注册 `contextTimeline` / `contextHeaders` / `contextActivity` 三个投影（`dsh-context/lib/index.js` 入口末段 `e.sessionProjections.register(...)` 三连）。`contextHeaders`（`function nr(e)`）展示完整形状：`stateSchema: Qn`、`wire:{viewSchema: er, view: t => ({headers: ...})}`、`init: () => ({headers: []})`、`apply` 对不关心的事件 `return e`、对角标重复 `return e`、否则 `{headers: i.length > 50 ? i.slice(-50) : i}`（有界）。

---

## 7. Host fetch 路由

```js
ctx.inject(['connection'], (child) => {
  const connection = child.get('connection')
  if (connection?.fetch?.register === undefined) return
  child.effect(() => connection.fetch.register({
    path: '/api/adw/report',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body
      try { body = await request.json() }
      catch { return Response.json({ ok: false, error: { code: 'adw/bad-request', message: 'body is not JSON' } }) }
      return Response.json({ ok: true, value: { sessionId: body.sessionId } },
        { headers: { 'cache-control': 'no-store' } })
    },
  }), 'adw: report route')
})
```

- 服务名 `connection`（`dsh-client-connection/lib/index.js:710`）。
- `ctx.connection.fetch` 是**按读取该服务的 Context 归属**的精确路由面：`get fetch() { const owner = this.ctx; return { register: (route) => this.registerFetchRoute(owner, route) } }`（`:732-735`）。`registerFetchRoute` 内部再包 `owner.effect(...)`，重复 path 抛错（`:840-854`）。
- route 形状 `{path, methods: string[], requestBody: 'buffered'|'streaming', fetch(request)}`（`:840-846`；`'streaming'` 见 `dsh-client-file-upload/lib/index.js:173`）。`assertFetchRoute` 只校验 path 是 `/api/...` 合法 endpoint、methods 非空且不重复（`:973-977`）。
- **`fetch(request)` 只收 `request`**，不传 peer；非 owner principal 在分发层即 403（`:826-832`）。
- **envelope 约定**（dsh-context 全线一致）：`Response.json(e, {headers:{'cache-control':'no-store'}})`；成功 `{ok:true, value}` 或 `{ok:true}`，失败 `{ok:false, error:{code, message}}`（`dsh-context/lib/index.js` 的 `function K(e)` / `function q(e,t)`）。客户端读 `n.ok !== true` 判失败、取 `n.value`（`dsh-context/lib/client.js` 的 `fetch('api/dsh-context/detail', ...)` 段）。
- 路径写法：客户端用**相对** `'api/dsh-context/detail'`（无前导 `/`），host 侧注册 `'/api/dsh-context/detail'`（有前导 `/`）。

**dsh-context 的包装**：它把「service 尚未就绪」封装成 `an(e)`（取 `e?.fetch?.register.bind(e.fetch)`，非函数返回 `undefined`）与 `L(e,t,n,r,i)`（`try { e.effect(() => a({path:n, methods:['POST'], requestBody:'buffered', fetch:r}), i) } catch { return false }`），并在 `ctx.inject(['connection'], ...)` 内调用（`dsh-context/lib/index.js` 的 `function an(` / `function L(`）。

---

## 8. Client bundle 格式

```js
window.__ModuleLoader__.load({
  id: 'dsh-anti-defensive-writing',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    let react = require('react')
    let jsx = require('react/jsx-runtime')
    let primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    // ... 组件与 apply() ...

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
```

**执行模型**：bundle 求值只**注册工厂**；所有模块体副作用（含 CSS 注入）都在工厂闭包里，首次 materialize 才运行（`dsh-client-modules/lib/index.js:14-33`、README:70-72）。`factory(require)` → exports，按 id 记忆化；`require` 循环抛错（factory-form CJS 无法交付部分 exports）。

**shell 外置模块**：自 `dsh-web-frontend/dist/assets/index-*.js` 的 `PLATFORM_MODULES`（函数 `OZ()`）实测，静态表恰为 11 项 —— `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。其余模块必须在 `dsh.client.external` 精确声明（`dsh-client-modules/README.md:50`）。**`dsh-client-ui-primitives` 是 baseline，可直接 `require`，不要自带副本**（`dsh-client-ui-workspace/README.md:112`）。

**是否需要构建步骤**：**需要存在已构建的 `lib/client.js`**——host 半只服务已构建 bundle，缺失则激活失败并打印构建指引（`dsh-client-modules/lib/index.js:128-156`、README:54「Build requirements」）。但**不一定需要打包器**：手写 factory-CJS 完全可用，`dsh-context-length` 与 `dsh-right-click-menu` 都直接手写 `lib/client.js`（各自文件头注释说明）。

> ⚠️ 本仓库现状：`packages/plugin/package.json` 已声明 `exports["./client"]` 与 `dsh.client`，但 **`packages/plugin/lib/client.js` 不存在**。Web profile 下会激活失败。上线前必须补齐。

**host 如何服务**：`client-modules` 扫描已启用 Loader 行 → 解析包 `package.json` 的 `dsh.client` → 组成 `window.__DSH_BOOT__` 引导图 → 在 `/plugins/...` 下按 combo 脚本成组提供（README:12,34,38）。无逐插件接线。

---

## 9. Client UI 接缝

### locale

```js
const NS = 'adw'
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: { title: '反防御性写作' }, en: { title: 'Anti-Defensive Writing' } }), 'adw: dictionaries')
  const t = ctx.locale.bind(NS)
}
```

`register(ns, {zh, en})`（或逐语言 `register(ns,'ja',{...})`）返回 disposer，重复同 ns 同 locale 抛错（`dsh-client-locale/lib/client.js:1387-1413`）。`bind(ns)` 返回**稳定身份**的 `t(key, params?)`，占位符 `{name}`（`:1414-1428`）。类型化字典要求两种内置语言齐全（`dsh-client-locale/README.md`）。

### slots：两步式

`ctx.slots.inject(slotName, factory)` **等待 slot 声明**，声明塌陷时移除贡献、恢复后重新注册；`factory` 返回 `ctx.slots.register(options, Component)` 的 disposer（`dsh-client-ui-workspace/README.md:171`、`dsh-client-ui-brand-official/README.md:46`）。

```js
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'adw',
  order: 11,
  label: () => t('nav'),
  inject: () => ({ /* 传给组件的注入面 */ }),
}, AdwSection))
```

`options` 常用：`name`（必需）、`id`（`list` 必需）/`key`（`keyed` 必需）、`order`、`label`（string 或 thunk）、`inject`（工厂）、`locale`、`store`、`children`、`select`（`chain` 必需）。kind 强制：`single` 不允许重复 priority；`keyed` 必须有 `key`；`list` 必须有 `id`（`dsh-web-frontend/dist/assets/index-*.js` 的 `SlotCore.register`）。

### settings 页面

```js
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'context-length',
  order: 11,
  label: () => t('nav'),
  inject: () => ({ remote, schema, describe, t }),
}, ContextLengthSection))
```

slot 契约：`settings.section` 是 root 作用域 `list`，`id` 必需、`order` 可选、`label` 可选（string 或 `() => string`），owner props 只给 `{close}`（`dsh-cordis-client-runner/lib/client.js` 的 slot catalog `key: "settings.section"`；声明方是 `dsh-client-ui-settings-general/lib/client.js` 的 `sidebar.settings` children 表）。真实例子：`dsh-context-length/lib/client.js` 的 `settings.section` / `id:"context-length"` / `order:11`。

### 右侧栏 tab（两段式，缺一不可）

```js
// 第一段：类型声明
ctx.effect(() => ctx.sidebarRightTabs.register({
  id: 'dsh-context',
  kind: 'dsh-context',
  title: () => t('tab.context'),
  guide: [{ order: 20, title: () => t('tab.context'), description: () => t('sidebar.guideDescription'), icon }],
}), 'dsh-context: tab type')

// 第二段：tab 主体（key = 类型的 id）
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  key: 'dsh-context',
  locale: 'dsh-context',
}, Body))
```

- `sidebarRightTabs.register({id, kind, patterns?, priority?, canOpen?, title, guide?, keepMounted?})` → disposer；`id` 全局唯一，重复抛错；`title(address)` 在开 tab 时**捕获**（`dsh-client-ui-sidebar-right/README.md:83`；`lib/client.js` 的 `definition.title(address)`）。
- priority band：`extension`(3) / `builtin`(2) / `fallback`(1)，默认 `extension`；同 kind 最多一 builtin + 一 extension（`lib/client.js` 的 `RANKS` / `DEFAULT_BAND` / `coexists`）。
- `sidebar.right.pane.tab` 是 **session 作用域 keyed slot**，`key` = 类型 `id`（`lib/client.js` children 声明：`"sidebar.right.pane.tab": {kind:"keyed", scope:"session"}`）。
- 可选标题 seat `sidebar.right.pane.tab.title`，同 key；不注册则用开 tab 时捕获的 `title()` 文本。
- 真实例子：`dsh-context/lib/client.js` 的 `El(e,t,n,r)` 中 `e.register({id:wl, kind:Tl, title:..., guide:[...]})` 加两个 `slots.inject`；`@nanmicoder/dsh-agent-teams/lib/client.js` 的 `native.sidebarRightTabs.register({id: TEAM_TAB_ID, kind: TEAM_TAB_KIND, title: () => t('workspace.title')})`。

### 会话视图（可选）

`conversation.view` 是 session 作用域 `list` slot：`{name, id, order, label, inject}` + Component（`dsh-cordis-client-runner/lib/client.js` 的 `key:"conversation.view"`）。`dsh-context` 用它注册 `id:'context'`、`order:20`。**只有 ≥2 个 View 时 tab 栏才显示**（`dsh-client-ui-conversation/README.md:73`）。其它可用 seat：`conversation.chat.assistant-actions`、`conversation.chat.turnTail`、`shell.overlay`、`conversation.input.overlay`。

---

## 10. Agent 钩子

### `agent/pre-step`（waterfall）

```js
ctx.on('agent/pre-step', async ({ agent, messages, step, turn, signal }, next) => {
  const decision = await next()
  if (decision.kind === 'reject') return decision
  return { ...decision, messages: [...decision.messages, extraMessage] }
})
```

- 派发点：`dsh-agent-loop/lib/index.js:902-920` 的 `preStep()`，`this.dispatch.waterfall("agent/pre-step", {messages, turn, step, signal}, fallback)`。
- payload：`{agent, messages, turn, step, signal}`（`agent` 由 `agentEvents` 自动注入，`dsh-agent/lib/index.js:242-246`）。
- **决策类型**：`{kind:'reject'}` 或 `{kind:'enter', messages, startsRequestSeries?}`（`dsh-agent/README.md:85`）。返回时必须透传 `decision` 并**保留 `startsRequestSeries`**。
- 时机：system prompt 装配之后、`step/start` 之前；`reject` 或首批消息为空则不开启 step（`:902-960`）。
- `messages` 是已被 claim 的完整批次，返回的新数组即进入 step 的批次。

### `agent/*` 事件全景

实测在 0.2.1-rc.5 所有包中出现的事件名（`grep -rhoE "'agent/[a-z/-]+'"` 去重）：

| 事件 | 类型 | 用途 |
|---|---|---|
| `agent/pre-step` | waterfall | 准入/改写入 step 的消息 |
| `agent/request` | waterfall | 解析/覆盖 provider、model、reasoningEffort |
| `agent/request-error` | waterfall | 返回 `{kind:'retry'}` 可重试 |
| `agent/turn-stopping` | waterfall | 回合将关闭前，可 steer 续命 |
| `agent/assistant-stream` | emit | 单次 attempt 的有序 start/chunk/end 帧（`dsh-agent-loop/lib/index.js:1080`） |
| `agent/created` / `agent/disposed` / `agent/status` / `agent/error` | serial / emit | 生命周期、状态、单次失败（`dsh-agent-loop/lib/index.js:877-882`） |
| `agent/inbox/{inserted,claimed,discarded,spliced}` | emit | 收件箱结构变更 |

### 注入 system prompt section

```js
ctx.inject(['systemPrompt'], (scoped) => {
  const systemPrompt = scoped.get('systemPrompt')
  if (systemPrompt?.section === undefined) return
  systemPrompt.section({
    name: 'dsh-adw:writing-discipline',
    order: 10050,
    text: PROMPT_SECTION,
    interpolate: false,
  })
})
```

- `section(section)` 校验 `order` 有限数，重复 name 同层抛错，返回 effect disposer（`dsh-system-prompt/lib/index.js:253-257`）。
- section 形状 `{name, order, text: string | (context)=>string, interpolate?: false, complete?: true}`。`complete:true` 会成为**完整** prompt，多个生效即装配失败（`dsh-system-prompt/README.md:56`）。
- 排序：`order` 升序，同 order 按 name 码点序（README:56）。
- `interpolate:false` 保留字面 `{{...}}`（`:118`）；默认解析 `{{name}}` 变量，**未注册变量抛错**（`:162-186`）。
- 中心分配位：`SECTION_ORDERS`（`HARNESS_IDENTITY:-1000` … `DEPLOYMENT_PERSONA_SUFFIX:10200`，`:10-43`），仓库内贡献者用 `getSectionOrder(name)`（`:262-264`）。第三方可用任意有限 order —— `dsh-agent-teams` 用 `order:117`（`lib/capabilities.js:96-99`），`dsh-context` 用 `getSectionOrder(...) ± 1000`。

### 观察 assistant 输出

1. **`agent/assistant-stream`**（进程内实时帧，非 replay 源）：`{frame}`，start/chunk/end 有序；loop 先提交完整紧凑流为一条 `assistant/message` 或 `assistant/attempt`，再发 end 帧（`dsh-agent/README.md:67`）。
2. **`session/event`**（durable，可 replay）：监听 `assistant/message`。`packages/plugin/lib/projection.js` 的 `applyEvent` 同时处理 `user/message`/`tool/result`/`command/done`/`assistant/message`，是可延续的观察示例。

---

## 11. Gotchas

1. **desktop profile 归 Electron 所有**：`dsh --profile desktop` 直接报错 —— `if (profile.toLowerCase() === "desktop") program.error("error: profile \"desktop\" is managed exclusively by the Electron application")`（`dsh/lib/bin.js:35-37`）。`dsh plugin --profile desktop` 仅在 Desktop 自带 carrier 注入 `manageDesktopProfile` 时放行（`bin.js:119`）。手工安装 = 改 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 与 `dsh.profile.bundles`；插件自身 `cordis.patch.yml` 由 bundle 机制自动应用（`dsh-app-boot/lib/index.js:1025-1034`），**不需**再往 profile 的 `cordis.patch.yml` 加同名 insert 行（重复 id 冲突）。
2. **client bundle 必须有已构建的 `lib/client.js`**：缺失则激活失败（`dsh-client-modules/README.md:54`）。手写 factory-CJS 可省打包器，不能省文件。
3. **`dsh.client.inject` 不是服务注入**：它是**模块加载顺序**依赖，列出的包先到达（`dsh-client-modules/lib/client.js:789`）。真正的运行时服务依赖写在 client 半导出的 `inject: ['slots','locale',...]`。
4. **projection 必须纯 JSON 且 `apply` 保持引用**：`checkpoint()` 用 `structuredClone`，含 undefined/Date/类实例会坏；`apply` 对不关心的事件返回新对象会放大下游工作（`dsh-session-projection/lib/index.js:181-196,386-392`）。
5. **`ctx.skills.registerProvider` 收工厂**：`create(control)`，不是 provider 对象；传对象得 `TypeError: create is not a function`（实测）。
6. **candidate 的 `source`/`rank`/`provider` 必需**（§3.2），不是可选项。
7. **`label` 写成 `label: t('nav')` 会钉死语言**；用 thunk `() => t('nav')`，每次投影重读（`dsh-cordis-client-runner/lib/client.js` 的 `registerOptions.label` 文档）。
8. **`dsh.compatibility.dshReleases` 无效**（§1），别照抄 dsh-context 期待版本门生效。

---

## 12. 待办 / 已知缺口

| 项 | 状态 |
|---|---|
| `packages/plugin/lib/client.js` 缺失 | **阻断**：`package.json` 已声明 `exports["./client"]`，无文件则 Web profile 激活失败 |
| `packages/plugin/lib/skill-provider.js` 的 `list()` 丢弃 `rank` | **阻断**：`validateCandidate` 抛 `invalid rank`（`dsh-skill/lib/index.js:460`） |
| `packages/plugin/lib/index.js` 给 `registerProvider` 传对象 | **阻断**：实测 `TypeError: create is not a function` |
| `@deepseek-ai/dsh-client-ui-primitives` 导出面 | **UNVERIFIED**：包不在解包目录；仅从 shell bundle 的 `PLATFORM_MODULES` 确认它是 baseline external，具体组件名以实际安装为准 |
| `@deepseek-ai/dsh-client-ui-slots` 的 `SlotMap` 类型声明 | **UNVERIFIED**：同上；slot 契约经 `dsh-cordis-client-runner/lib/client.js` 运行时 catalog 与真实插件用法间接验证 |
| Electron Desktop 的 `__DSH_TRANSPORT__` 约定 | **UNVERIFIED**：仅 `dsh-client-connection/README.md:30` 一句话，未在 desktop 包内验证 |
