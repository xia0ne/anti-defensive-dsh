# 统计面板设计（Statistics Panels）

> 状态：v0.1 已实现（侧边栏 tab + 设置页）；报告页/趋势页为 M3–M4 计划
> 代码：`packages/plugin/lib/client.js`（浏览器半）、`packages/plugin/lib/projection.js`（读模型）
> 测试：`packages/plugin/test/client.test.js`（5 用例）、`packages/plugin/test/smoke.test.js`
> 相关：[DESIGN.md](../DESIGN.md) · [detector-spec.md](detector-spec.md) · [dsh-plugin-api.md](dsh-plugin-api.md)

---

## 0. 原则

面板只回答一个问题：**「我这段文字有没有在替审稿人攻击我？改完之后变好了没有？」**

因此设计上有三条硬约束：

1. **只呈现可追溯的数字**。每个数字都能定位到 `adwWriting` projection 的某个字段或一次 `/adw scan` 的结果；面板不计算新指标。
2. **分数是诊断，不是 KPI**。没有「目标分」「达标线」「排行榜」。面板不提供「一键冲 100 分」。
3. **不奖励过度宣称**。把「效果有限」删掉、换成「显著领先」会让 `comparison-scope-creep` 命中，分数不会更高。这条对称性是面板可信的前提。

---

## 1. 信息架构：四个表面

| # | 表面 | 目的 | 入口 | 展示什么 | DSH 接缝 | 状态 |
|---|---|---|---|---|---|---|
| P1 | **会话侧边栏「写作健康」tab** | 会话内实时反馈 | 右侧栏 tab / 引导页 | 分数环 + 相对上次 ▲▼、严重度占比条、分数趋势（含最好/最差/样本数）、按规则分布（中文名 + 机器 id + 严重度色）、**命中明细（句子 + 行号 + 建议，可展开，高/中/低筛选）**、改写前后对比 | `ctx.sidebarRightTabs.register({id:'dsh-adw', kind:'adw-writing-health'})` + `ctx.slots.register({name:'sidebar.right.pane.tab', key:'dsh-adw'})` + title seat | **v0.1 已实现** |
| P2 | **设置页「反防御性写作」** | 让用户看懂规则边界 | 设置 → 反防御性写作 | 8 条规则（名称/id/严重度/说明）+ 每条的反例 | `ctx.slots.register({name:'settings.section', id:'anti-defensive-writing', order:12, label, inject})` | **v0.1 已实现** |
| P3 | **文档级报告页** | 单文件全量报告 + 历史 | `/adw scan <path>` 结果中的「打开报告」/ 文件 tab | 全部命中（可跳行）、分数历史、按规则筛选 | `conversation.view`（session 作用域 list slot）+ 可选 `ctx.sidebarRight` 资源 tab；数据走 `/api/adw/report` fetch 路由 | M3 |
| P4 | **项目/全库汇总** | 跨会话趋势 | 设置页「查看趋势」/ 命令 `/adw trend` | 按天/按文件的分数与命中折线、规则分布、扫描次数 | `/api/adw/trend` fetch 路由 + 一个 `conversation.view` 页面 | M4 |

> 为什么 P1 用右侧栏而不是 `conversation.view`：`conversation.view` 只有 ≥2 个 View 时才显示 tab 栏（`dsh-client-ui-conversation/README.md`），且它占据主内容区，会与用户的校对阅读争夺空间。写作健康是**伴随式**信息，右侧栏更合适。P3 是**深度阅读**（要逐条跳行），才值得占用主区域。

---

## 2. P1 侧边栏 tab：组件规格

### 2.1 布局顺序（自上而下）

```
① 分数卡（hero）
   ┌─────────────────────────────────────┐
   │  ╭──────╮   写作健康度              │
   │  │  64  │   [高 2] [中 2] [低 1]    │
   │  │ /100 │   最近 5 命中 · 3 次扫描   │
   │  ╰──────╯   100 = 未发现防御性表达；  │
   │             分数是诊断指标，不是目标。 │
   └─────────────────────────────────────┘

② 分数趋势卡
   ┌─────────────────────────────────────┐
   │ 分数趋势                    8 个样本 │
   │  ╭───────────────────────────────╮  │
   │  │        ╱‾‾╲                   │  │  ← sparkline，虚线 = 100
   │  │  ╱╲___╱    ╲___●              │  │
   │  ╰───────────────────────────────╯  │
   └─────────────────────────────────────┘

③ 按规则分布卡
   ┌─────────────────────────────────────┐
   │ 按规则分布                          │
   │ self-weakening-hedge  ████████   3  │
   │ loss-framing          █████      2  │
   └─────────────────────────────────────┘

④ 改写前后对比卡
   ┌─────────────────────────────────────┐
   │ 改写前后                            │
   │ 改写前 72 → 改写后 91  +19   3 → 1  │
   └─────────────────────────────────────┘

⑤ footer 提示
   检测器只做语言建议；涉及证据强度的建议以问句出现，不自动改写。
```

### 2.2 每个 widget 的定义

| widget | 数据来源（projection 字段） | 视觉 | 交互 |
|---|---|---|---|
| **分数环** `ScoreRing` | `last.score` | SVG 双圆环（半径 42、线宽 8、`stroke-dasharray` = 周长×score/100），颜色按分段：≥85 绿 `#2f9e63` / ≥60 琥珀 `#c77d1a` / <60 红 `#d64545`；中心 26px 数字 + `/100` | 无（纯展示）；`aria-label="score 64 of 100"` |
| **严重度徽章** | `last.high` / `last.medium` / `last.low` | 三个 pill：红/琥珀/蓝，文字「高 2」 | 无；`hits === 0` 时替换为单个绿色「干净」徽章 |
| **最近统计行** | `last.hits`、`scans` | 「最近 5 命中 · 3 次扫描」 | 无 |
| **趋势 sparkline** `Sparkline` | `trend[]` → `{seq, at, score, hits}`，最多 60 点 | 260×56 viewBox 折线，无坐标轴；y=100 处一条虚线基准；末点画 3px 圆点，颜色同分数分段 | `preserveAspectRatio="none"` 自适应宽度；`aria-label="score trend over N samples"` |
| **规则条形图** `RuleRow` | `byRule[]` → `{ruleId, count}`，最多 12 条，按 count 降序 | 两列：规则 id（省略号截断，title 显示全名）+ 70px 进度条（宽度 = count/max×100%）+ 数字 | 无；`byRule` 为空显示「暂无命中」 |
| **前后对比** | `pairs[]` → `{before, after, beforeHits, afterHits, at}`，最多 8 对 | 「改写前 72 → 改写后 91」+ 差值（正绿负红）+ 「3 → 1」 | 倒序显示（最新在前） |
| **footer** | 静态文案 | 11px 提示 | 无 |

### 2.3 状态矩阵

| 状态 | 触发条件 | 渲染 |
|---|---|---|
| **no session** | slot 未绑定 session | 组件不渲染（slot 框架负责） |
| **no projection** | `useProjection('adwWriting')` 返回 `undefined`/`null`（插件刚启用、尚无事件） | 空态卡：「还没有可统计的样本 / 发起一次写作或改写，或运行 `/adw scan <path>`…」+ footer |
| **projection 但有 0 样本** | `view.trend.length === 0` | 同上空态（避免显示一个 100 分造成「已经很好」的错觉） |
| **无命中** | `last.hits === 0` 且 trend 非空 | 正常渲染；徽章区显示绿色「干净」；规则卡显示「暂无命中」 |
| **有命中** | `last.hits > 0` | 完整渲染 |
| **scan running** | （M3）命令执行中 | 面板**不显示 spinner**：扫描是毫秒级同步操作，加 spinner 只会闪一下。命令结果到达后 projection 自然更新 |
| **scan failed** | 命令返回 `{kind:'error'}` | 错误在命令输出区显示；面板保持上一次数据，不显示错误态（避免把一次失败渲染成「写作变差」） |

### 2.4 compact vs expanded

侧边栏本身有 docked/floating 两种展示（`dsh-client-ui-sidebar-right`）。v0.1 只有一种布局，靠 CSS 自适应：

- 宽度 ≥ 320px：分数环 96px + 徽章同排；
- 宽度 < 320px：分数环与徽章自动换行（`.adw-hero` 使用 `flex` + `gap`，无固定宽度）；
- 所有卡片 `width: 100%`，不做横向滚动；长规则 id 用 `text-overflow: ellipsis`。

> 不在 v0.1 做「紧凑模式」：先验证信息是否有价值，再决定砍哪一块。伪需求比缺功能更贵。

---

## 3. 数据模型：`adwWriting` projection

### 3.1 host 状态（`TimelineState` 等价物）

```js
{
  points: [                       // 样本点，最新在后；上限 60
    { seq, at, turn, score, hits, high, medium, low, chars, source }
  ],
  ruleTotals: { [ruleId]: number },   // 全会话累计，受 12 条已知规则约束
  last: { score, hits, high, medium, low, chars, at, source },
  pairs: [                         // 改写前后，上限 8
    { before, after, beforeHits, afterHits, at }
  ],
  pendingBefore: null | { text, score, hits, at, seq },  // 等待配对的「改写前」
  scans: number,
  turn: number
}
```

保留上限（`projection.js` 常量）：

| 常量 | 值 | 理由 |
|---|---|---|
| `MAX_TURNS` | 60 | 面板只展示最近 60 个样本；一张 sparkline 超过 60 点已无信息量 |
| `MAX_HITS` | 200 | 单次内部扫描的命中上限（不是 wire 字段） |
| `MAX_PREVIEW` | 160 | 用户消息预览的字符上限 |
| `MAX_SCAN_CHARS` | 20 000 | 对 assistant 消息做快速扫描时的截断（头尾各 10k），保证 fold 不被长文拖慢 |
| `MAX_BY_RULE` | 12 | wire 里最多 12 条规则行 |
| `MAX_PAIRS` | 8 | 前后对比最多 8 对 |
| `MAX_RECENT` | 40 | 面板最多 40 张命中卡；完整列表在 M3 报告页 |
| `MAX_EXCERPT` | 180 | 单张命中卡保存的句子/摘录字符上限 |

### 3.2 wire view（客户端可见，`viewSchema.parse` 校验）

```jsonc
{
  "version": 2,
  "scans": 3,
  "turn": 2,
  "last": { "score": 64, "hits": 5, "high": 2, "medium": 2, "low": 1,
            "chars": 900, "at": 1000, "source": "tool" },
  "delta": { "score": -8, "hits": 2 },          // 相对上一个样本；只有一个样本时省略
  "mix": { "high": 40, "medium": 40, "low": 20 }, // 整数百分比，和为 100
  "byRule": [ { "ruleId": "self-weakening-hedge", "count": 3,
                "severity": "high", "name": "自我削弱表达" } ],
  "recent": [ { "ruleId": "self-weakening-hedge", "ruleName": "自我削弱表达",
                "severity": "high", "kind": "rewrite", "line": 23, "column": 24,
                "text": "效果有限",
                "sentence": "遗憾的是，在跨域场景下效果有限。",
                "excerpt": "遗憾的是，在跨域场景下⟦效果有限⟧。",
                "section": "abstract",
                "note": "删除该削弱词；若程度重要，用可核验的数字代替形容词。",
                "source": "tool" } ],                // 最多 40 条，最新在前
  "trend":  [ { "seq": 1, "at": 100, "score": 80, "hits": 1 } ],
  "pairs":  [ { "before": 72, "after": 91, "beforeHits": 3, "afterHits": 1, "at": 400 } ],
  "summary": { "distinctRules": 2, "totalHits": 5, "averageScore": 72,
               "worstScore": 64, "bestScore": 80 }
}
```

`source` 枚举：`'none' | 'tool' | 'command' | 'assistant'`。

**plain-JSON 约束**（`dsh-session-projection` 硬要求，`projection.js` 的 `assertPlainJson` 守门）：

- 不允许 `undefined` 值属性（要么有值，要么省略）；
- 不允许 `Date` / class 实例 / 函数 / Symbol / BigInt / NaN / Infinity；
- `apply` 对不关心的事件必须返回**同一引用**（`Object.is` 门），否则每个事件都会触发下游渲染；
- `stateVersion` 变更必须 bump（当前 `1`）。

### 3.3 喂给 projection 的事件

| 事件 | 处理 | 为什么 |
|---|---|---|
| `user/message` | 提取纯文本 → `scan()` → 存为 `pendingBefore` | 用户粘贴/发送的原文是「改写前」的天然候选 |
| `tool/result`（`adw_scan`） | 读 `data.meta.adwScan` 的 `ToolValue`（工具 `presentationMeta`） → 生成 `point`；若有 `pendingBefore` 则配对成 `pairs` | 权威数据源，模型自查的结果 |
| `command/done` | 用正则从 `/adw scan` 的固定输出中提取 `写作健康度 N/100 · 命中 N 处（高/中/低）` | 命令结果不进模型历史，但仍是有效测量 |
| `assistant/message` | 对回复正文做有界扫描（≤20k 字符）→ `point`；`source: 'assistant'` | 模型没调工具时面板也要动，否则用户以为插件没生效 |
| 其他所有事件 | 返回原 state 引用 | 零成本 |

> **为什么 fold 里要重新扫描 assistant 文本**：`adw_scan` 是可选工具（配置 `tools: false` 可关），而且模型不一定每次自查。fold 是唯一能保证「面板始终有数据」的地方。代价是有界扫描（20k 字符）+ 结果缓存，实测 500 条事件 40ms。

---

## 4. 指标定义（必须诚实、不可 gaming）

### 4.1 公式

```
severityWeight:  high = 3, medium = 2, low = 1
sectionMultiplier: 见 detector-spec.md §2.2（abstract 1.2, conclusion 1.2, limitations 0.2, …）

weightedPoints   = Σ (severityWeight × sectionMultiplier)     // 每次命中
defensiveDensity = weightedPoints / max(sentences, 4)
score            = clamp(round(100 − 40 × defensiveDensity), 0, 100)
```

| 指标 | 公式 | 诊断值 / 虚荣值 |
|---|---|---|
| `score` | 上式 | **诊断**。同文档前后对比有意义；跨文档绝对值不可比（篇幅、章节结构不同） |
| `defensiveDensity` | `weightedPoints / max(sentences,4)` | **诊断**。比 score 更接近原始测量，用于解释分数为什么变 |
| `last.hits` / `high/medium/low` | 计数 | **诊断**。用户能立刻定位 |
| `byRule[].count` | 按规则累计 | **诊断**。回答「我主要犯哪一类」 |
| 严重度混合 | `high / (high+medium+low)` | **诊断**。高严重度占比比总分更能说明问题性质 |
| `pairs[].after − before` | 改写前后分数差 | **诊断**。唯一的因果性证据（同一段文字前后对比） |
| `scans` | 累计扫描次数 | **虚荣**。只说明用得勤，不说明写得好；不在主视觉区突出 |
| `summary.averageScore` | 所有样本算术平均 | **虚荣**。会被样本选择（只扫好段落）污染；只在报告页出现，面板不显示 |
| `summary.worstScore` | 最小样本 | **诊断**。比平均更能暴露问题段落 |
| 「连续 X 天」「累计扫描 N 次」类 | — | **虚荣，v0.1 不做**。典型 gaming 目标 |

### 4.2 「不要优化这个数字」

面板底部与设置页各有一句固定文案：

> 分数是诊断指标，不是目标。检测器只做语言建议；涉及证据强度的建议以问句出现，不自动改写。

三条反 gaming 设计：

1. **无目标分、无达标线、无等级（A/B/C）、无排行榜**。
2. **对称检测**：删掉削弱词但新增过度宣称 → `comparison-scope-creep` 命中，分数不升反降。
3. **规则版本随分数记录**（`detectorVersion`）。跨版本的分数趋势用虚线/不同颜色标注，禁止混算平均。

---

## 5. ASCII 线框

### 5.1 侧边栏 tab（有数据，扩展态）

```
┌────────────────────────────────┐
│  写作健康                      │  ← tab 标题（title seat）
├────────────────────────────────┤
│ ┌────────────────────────────┐ │
│ │   ╭─────╮  写作健康度  ▼-8 │ │  ← 相对上次扫描
│ │   │ 58  │  9 命中 · 7 次扫描 │ │
│ │   │/100 │  · 工具扫描        │ │
│ │   ╰─────╯                  │ │
│ │   ████████░░░░░░░░░░░      │ │  ← 严重度占比条
│ │   ● 高44% ● 中33% ● 低23%  │ │
│ │  ────────────────────────  │ │
│ │  100 = 未发现防御性表达；   │ │
│ │  分数是诊断指标，不是目标。 │ │
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ 分数趋势   最好100·最差58·7│ │
│ │ 100 ┤ - - - - - - - - - -  │ │
│ │  50 ┤      ╱‾╲___╱╲___╱╲  │ │
│ │   0 └────────────────────── │ │
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ 按规则分布            5 / 8│ │
│ │ 自我削弱表达               │ │
│ │  self-weakening-hedge      │ │
│ │ ████████████████████    6  │ │
│ │ 主动承认落败               │ │
│ │  loss-framing              │ │
│ │ █████████████           4  │ │
│ │ 提前自我否定 …          3  │ │
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ 命中明细          5 / 16   │ │
│ │ [全部5][高3][中1][低1]     │ │  ← 筛选 chips
│ │ ┌────────────────────────┐ │ │
│ │ │● 自我削弱表达  L3:24  +│ │ │
│ │ │ 遗憾的是…⟦效果有限⟧…   │ │ │
│ │ └────────────────────────┘ │ │
│ │ ┌────────────────────────┐ │ │
│ │ │● 主动承认落败 L7:60  ? │ │ │  ← ? = 需确认证据
│ │ │ ⟦Our method is weaker⟧ │ │ │
│ │ │ 这个比较是否必须出现在 │ │ │  ← question 类直接显示
│ │ │ 当前章节？…            │ │ │
│ │ └────────────────────────┘ │ │
│ │ ┌────────────────────────┐ │ │
│ │ │● 提前自我否定 L12:5   +│ │ │
│ │ │ 尽管如此，⟦必须承认⟧…  │ │ │
│ │ └────────────────────────┘ │ │
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ 改写前后              2 组 │ │
│ │ 72 → 91   +19    4 → 1 命中│ │
│ │ 64 → 58   -6     6 → 9 命中│ │
│ └────────────────────────────┘ │
│ 检测器只做语言建议；涉及证据强度│
│ 的建议以问句出现，不自动改写。  │
└────────────────────────────────┘
```

### 5.2 侧边栏 tab（空态）

```
┌──────────────────────────────┐
│  写作健康                    │
├──────────────────────────────┤
│                              │
│        还没有可统计的样本      │
│                              │
│  发起一次写作或改写，或运行    │
│  /adw scan <path>，这里就会   │
│  出现分数与命中分布。          │
│                              │
│  检测器只做语言建议；涉及证据   │
│  强度的建议以问句出现，不自动   │
│  改写。                        │
└──────────────────────────────┘
```

### 5.3 设置页「反防御性写作」

```
┌────────────────────────────────────────────────────────┐
│ 反防御性写作                                            │
│ 离线检测器会扫描中文与英文的自我削弱表达、主动认输、     │
│ 工作汇报式叙事、提前自我否定与比较范围越界。它不会修改   │
│ 文字，也不会判断科学结论。                              │
│ 用法: /adw scan <path> 扫描文件；/adw rules 查看规则；   │
│ 模型自查可调用 adw_scan 工具。                          │
├────────────────────────────────────────────────────────┤
│ 内置规则                                                │
│                                                        │
│ [high]  自我削弱表达        self-weakening-hedge        │
│         "遗憾""仅""效果有限"一类措辞。                  │
│         不会命中的反例（设计如此）                       │
│         · 仅当批次大小固定时成立。                       │
│         · This holds only if the data is i.i.d.        │
│ ──────────────────────────────────────────────────────  │
│ [high]  主动承认落败        loss-framing                │
│         "本文弱于""未能超过""性能下降"。                │
│         不会命中的反例（设计如此）                       │
│         · 基线在长文档上性能下降，本文方法保持稳定。     │
│ …（共 8 条）                                            │
└────────────────────────────────────────────────────────┘
```

### 5.4 文档级报告页（M3）

```
┌──────────────────────────────────────────────────────────┐
│ docs/paper.md                          写作健康度 64/100 │
│ 上次扫描 2026-11-02 15:40 · 1 次扫描 · detector v1       │
├──────────────────────────────────────────────────────────┤
│ 筛选: [全部规则 ▾] [全部严重度 ▾]        排序: [行号 ▾]   │
├──────────────────────────────────────────────────────────┤
│ L23:4  [high] self-weakening-hedge  「遗憾的是」          │
│        建议: 删除该削弱词；若程度重要，用可核验的数字代替。 │
│        [跳转到该行]                                      │
│ ──────────────────────────────────────────────────────── │
│ L41:12 [high] loss-framing  「本文弱于」                  │
│        建议: ? 这个比较是否必须出现在当前章节？…          │
│ ──────────────────────────────────────────────────────── │
│ L88:1  [med]  procedural-narration  「我们首先」          │
│        建议: 这段是否在讲"我们做了什么过程"？…            │
├──────────────────────────────────────────────────────────┤
│ 分数历史: 2026-11-01 58 → 2026-11-02 64  (+6)            │
└──────────────────────────────────────────────────────────┘
```

### 5.5 项目汇总页（M4）

```
┌──────────────────────────────────────────────────────────┐
│ 反防御性写作 · 项目汇总                    最近 30 天 ▾   │
├──────────────────────────────────────────────────────────┤
│  扫描文件 12   平均分 71   最差 48   命中 83              │
├──────────────────────────────────────────────────────────┤
│  分数趋势                                                │
│  100 ┤                                                   │
│   75 ┤      ╱‾‾╲___╱‾‾                                   │
│   50 ┤  ___╱                                             │
│    0 └──────────────────────────────                     │
│       11-01   11-08   11-15   11-22                      │
├──────────────────────────────────────────────────────────┤
│  按文件                                                  │
│  paper.md          64   ████████████  12 处              │
│  related.md        88   ███            3 处              │
│  rebuttal.md       52   ██████████████ 21 处             │
└──────────────────────────────────────────────────────────┘
```

> 汇总页的「平均分」只在这里出现，且必须同时显示样本数（12 个文件）——单看平均分会诱导用户只扫好段落。

---

## 6. 交互与命令面

### 6.1 命令语法（已实现）

| 命令 | 行为 | 输出 |
|---|---|---|
| `/adw scan <path> [--section <s>] [--min-severity high\|medium\|low]` | 读取工作区内文件并扫描 | 多行文本：标题、`写作健康度 N/100 · 命中 N 处（高/中/低）· 防御密度 x/句`、前 20 条命中（`→ L行:列 [rule-id] 「原文」` + 建议；`?` 前缀 = 需要作者确认） |
| `/adw rules [<rule-id>]` | 列出 8 条规则；带参数时显示单条 + 反例 | 规则清单或单条详情 |
| `/adw version` | 版本 | `dsh-anti-defensive-writing · detector v1 · 8 条规则` |
| `/adw on` / `/adw off` | 开关纪律提示 | 提示需重启会话生效 |
| （M4）`/adw trend` | 汇总页 | 同 P4 |

**如何不污染模型历史**：`commands.register` 的 handler 返回值经 `command/done` 落到会话日志，由 UI 渲染，**不进入模型消息序列**（`dsh-commands/README.md`: "run directly against an agent without creating a model message"）。所以扫描一篇 2 万字的论文不会让模型的上下文涨 2 万字。

`scan` 的文件读取走插件自己的 `readWorkspaceFile`（相对 workspace 根解析、拒绝 `..` 越界、文件不存在给结构化错误）。

> **与实现的精确口径（v0.1）**：`readWorkspaceFile` 通过 `workingDirectory` 服务解析工作区根，然后用 `node:fs` 读取，**没有经过 `ctx.fs`**。因此它不触发 DSH 的 fs 观察策略与版本守卫；越界拒绝由插件自己的 `relative()` 检查完成。这是 M0「detector 零 DSH 依赖优先」的延伸取舍。M3 若改为 `ctx.fs.readText`，即可继承 DSH 的沙箱与观察策略；届时 `packages/plugin/lib/index.js` 的 `readWorkspaceFile` 是唯一改动点。

### 6.2 面板上的动作

| 动作 | v0.1 | 说明 |
|---|---|---|
| 点击命中跳转到行 | ✗（M3） | 需要 P3 报告页 + `sidebar.right.pane.tab` 的 `navigation.params.line` |
| 「用 Skill 改写这一段」 | ✗（M3） | 需要把原文 + `Report.hits` 注入 composer；必须用户显式点击，不能自动 |
| 展开/收起侧边栏 | ✓（框架） | `sidebarRight.toggleExpanded()` 由 shell 提供 |
| 刷新 | ✓（框架） | projection 自动推送，无需手动刷新 |

---

## 7. 可访问性 / 暗色 / i18n

### 7.1 可访问性

- 分数环：`role="img"` + `aria-label="score 64 of 100"`（不只靠颜色传达）；数字本身是文本，屏幕阅读器可读。
- sparkline：`role="img"` + `aria-label="score trend over N samples"`；不提供逐点 tab 停靠（数据表在 P3）。
- 严重度徽章：同时用**颜色 + 文字**（「高 2」），不单靠颜色。
- 所有交互元素可 Tab 到达，focus ring 使用 `var(--dsw-focus-ring-color)`（继承 shell）。
- 动效：无自定义动画，`prefers-reduced-motion` 下无变化。

### 7.2 暗色模式

所有颜色走 DSH 设计 token，不硬编码背景：

| 用途 | token |
|---|---|
| 卡片背景 | `--dsw-alias-bg-module-platform`（+ `color-mix` 88% 透明） |
| 主文字 | `--dsw-alias-label-primary` |
| 次文字 | `--dsw-alias-label-secondary` |
| 弱文字 | `--dsw-alias-label-tertiary` / `--dsw-alias-label-dimmed` |
| 边框 | `--dsw-alias-border-l1` / `--dsw-alias-border-l2` |
| 品牌色（进度条） | `--dsw-alias-brand-primary` |

严重度色（红/琥珀/蓝/绿）是**语义色**，在明暗两种主题下都保持可辨识（前景色 + 10% 背景 + 28% 边框）。

### 7.3 i18n

- `ctx.locale.register('dsh-anti-defensive-writing', { zh, en })`，`ctx.locale.bind(NS)`。
- 所有 UI 文案走 key（`panel.*`、`settings.*`、`tab.*`），无硬编码中文字符串（规则目录 `RULE_CATALOG` 的中文名是**内容**而非 UI 文案，随规则版本走）。
- 未匹配 key 回退到 key 本身（便于发现遗漏）。

---

## 8. MVP 切割线

### v0.1（已实现，本仓库）

- ✅ P1 侧边栏 tab：分数环、严重度徽章、最近统计、sparkline、按规则条形图、前后对比、空态
- ✅ P2 设置页：8 条规则 + 反例
- ✅ `adwWriting` projection（6 类字段、保留上限、plain-JSON 校验）
- ✅ `/adw scan|rules|version|on|off`
- ✅ 中英 i18n
- ✅ 客户端 bundle 在 sandbox 中可加载、可渲染（5 个测试）

**不做的理由**：先验证「分数 + 命中明细」是否真的帮助用户；P3/P4 需要持久化存储与额外路由，投入产出比要在 v0.1 有真实使用数据后才成立。

### M3（报告页）

- P3 报告页：全量命中、跳行、按规则/严重度筛选、分数历史
- `/api/adw/report` fetch 路由
- `adw-scan-store`（storageDomain，按 contentHash 去重）

### M4（趋势）

- P4 汇总页：按天/按文件趋势、规则分布
- `/api/adw/trend` fetch 路由
- 「用 Skill 改写这一段」动作

### 明确不做

- ❌ 目标分 / 达标线 / 排行榜 / 连续天数
- ❌ 自动全文改写（违反 L3 的显式触发原则）
- ❌ 云端汇总（稿件不出本机）
- ❌ 把分数写进论文或答辩材料（面板是作者自查工具，不是质量证明）
