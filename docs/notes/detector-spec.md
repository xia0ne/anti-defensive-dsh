# 防御性写作检测器（Detector）规格

> 状态：已实现并测试通过（v0.1 prototype）
> 代码：`packages/detector/` · 测试：`packages/detector/test/scan.test.js`
> 上游依据：`reference/upstream-skill/skills/anti-defensive-writing/SKILL.md`（中文）与 `anti-defensive-writing-en/SKILL.md`（英文）

---

## 0. 一句话

`scan(text, options) -> Report` 是一个**纯函数、零依赖、离线**的深模块：文本进，报告出。
它负责 L1 确定性检测（词表 / 正则 / 段落几何 / 评分），**绝不调用模型、绝不修改原文、绝不判断科学正确性**。

```js
import { scan } from '@adw/detector'

const report = scan(text, { section: 'abstract' })
report.score          // 0-100，100 = 干净
report.hits[0].start  // UTF-16 偏移，可直接 slice
report.hits[0].suggestion.kind // 'rewrite' | 'question'
```

---

## 1. 规则分类（Rule taxonomy）

规则元数据定义在 `packages/detector/lib/rules.js`，词表数据在 `lib/lexicons.js`。

**三种 suggestion 语义**（这是防止「检测器变成 overclaiming 机器」的关键）：

| kind | 含义 | 是否给替换文本 |
|---|---|---|
| `rewrite` | 局部、机械可改（删削弱词、删铺垫语） | 可以给 `text`（本版多为空串 = 删除） |
| `question` | 需要作者掌握的证据事实，检测器无权代答 | **绝不**给 `text`，只给 `note` 提问 |
| `delete` | 整句/整段与主线无关 | 本版未启用，保留给后续 |

### 1.1 规则总表

| id | 中文名 | 严重度 | kind | 上游规则 | 匹配方式 |
|---|---|---|---|---|---|
| `self-weakening-hedge` | 自我削弱表达 | high | rewrite | 语言规则：禁用自我削弱式表达 | 词表（CN 23 条 / EN 14 条） |
| `loss-framing` | 主动承认落败 | high | rewrite | 语言规则：不占优的结果不说输 | 词表 |
| `overgeneralized-limitation` | 局部现象上升为整体否定 | high | question | 语言规则：不把局部现象上升为对整体方法的否定 | 词表 |
| `procedural-narration` | 工作汇报式叙事 | medium | rewrite | 叙事规则：不写成工作汇报 | 词表 + 句首位置 |
| `premature-self-negation` | 提前自我否定 | high | rewrite | 结构规则：结论只强化记忆点 | 词表 |
| `defensive-preamble` | 防御性铺垫 | low | rewrite | 语言规则：不替审稿人总结弱点 | 词表 |
| `apology` | 歉意表达 | medium | rewrite | 语言规则：不主动扩大攻击面 | 词表 |
| `comparison-scope-creep` | 比较范围越界 | medium | question | 叙事规则：控制比较范围 | 词表 |

### 1.2 每条规则的反例（负例，必须不触发）

规则对象中的 `negativeExamples` 字段即测试用例来源。完整列表见 `rules.js`，摘录关键负例：

**`self-weakening-hedge`**

| 负例 | 为什么不触发 |
|---|---|
| `只有在数据集规模超过 10 万时，方法才生效。` | 条件限定，不是自贬 |
| `该方法仅当批大小固定为 32 时成立。` | `仅当` 是 scoping |
| `This optimization only applies when the batch size is fixed.` | `only ... when` 是 scoping |
| `Our method not only improves accuracy but also reduces latency.` | `not only` 是递进 |
| `The evaluation is limited to the scope of in-domain datasets.` | `limited to the scope` 是范围声明 |

**`loss-framing`**

| 负例 | 为什么不触发 |
|---|---|
| `The baseline underperforms on long documents, where context is truncated.` | 主语是基线，不是本文 |
| `在长文档场景下，基线方法因上下文截断而性能下降，本文方法保持稳定。` | 同上，且用于衬托本文 |
| `Our method is weaker on a metric the task does not optimize for.` | 该句若在 limitations 章节会被 section 权重抑制；在正文中仍需人工判断（设计上允许一次 question） |

**`procedural-narration`**

| 负例 | 为什么不触发（或抑制） |
|---|---|
| `We first preprocess the corpus with sentence-level tokenization.` | method 章节权重 0.05，被抑制 |
| `如第 3.2 节所述，我们首先将输入划分为片段。` | method 章节 |

**`premature-self-negation`**

| 负例 | 为什么不触发 |
|---|---|
| `In the Limitations section we discuss the scope of our evaluation.` | limitations 章节权重 0.05 |
| `第 5 节讨论本研究的局限与适用范围。` | 同上 |

**`comparison-scope-creep`**

| 负例 | 为什么不触发 |
|---|---|
| `On all datasets in Table 1, our method improves accuracy.` | 有明确的表格范围，是事实陈述而非越界 |
| `在表 2 列出的三个数据集上，本文方法均优于基线。` | 同上 |

**`apology`**

| 负例 | 为什么不触发（设计意图） |
|---|---|
| `We regret that the earlier version contained a typo in Table 2; it is corrected here.` | 更正声明是必要信息，不是道歉（当前词表未收录 `we regret that` 这个完整形式；若是 `we regret` 会触发，需人工确认） |

> 注：`apology` 的负例暴露了词表法固有局限——它只能近似。规格要求 UI 把每条规则的负例展示给用户，用户可据此关闭误报规则。

### 1.3 匹配机制细节

1. **大小写与词边界**：英文规则用 `(?<![A-Za-z])phrase(?![A-Za-z])` 匹配（`gi`），避免 `only` 命中 `onlyness` 之类的子串；中文按字符直接匹配。
2. **长词优先**：同一规则内按短语长度降序扫描，`仍明显落后` 先于 `明显落后` 被匹配；命中后按「最左优先 + 最长」去重，避免同一处重复计数。
3. **scoping guards**（硬编码在 `scan.js`，因为它们依赖命中位置）：
   - 中文 `仅`：后接 `当/限/于/在/用/对/需/能/可/供/凭/按/就/次` 时不触发；前一字为 `不` 时不触发（`不仅`）。
   - 英文 `only`：`only if/when/in/for/under/at/after/before/once` 不触发；`not only` 不触发；`only` 开头短语前有 `not ` 时也不触发。
4. **掩码区**：见 §2.1，代码块、行内代码、公式、URL、链接目标、HTML 标签一律不参与匹配。

---

## 2. 章节感知（Section awareness）

### 2.1 章节声明方式（三种，优先级从高到低）

1. **显式参数**：`scan(text, { section: 'abstract' })` — 调用方（命令、面板、工具）已知章节时直接传。
2. **Markdown 标题自动检测**：识别 `# Abstract` / `## 4. Experiments` 一类标题，按最近标题为后续文本定章节。
3. **`unknown` 兜底**：无标题、无参数时按 `unknown` 计。

支持章节：`abstract` `introduction` `related-work` `method` `experiments` `results` `discussion` `conclusion` `limitations` `rebuttal` `unknown`。

### 2.2 章节权重表（`rules.js` 的 `DEFAULT_SECTIONS`）

| 章节 | 权重 | 设计意图 |
|---|---|---|
| abstract | 1.2 | 发布会开场，削弱词代价最高 |
| introduction | 1.0 | 主线建立处 |
| related-work | 0.4 | 综述语境允许客观比较 |
| method | 0.3 | 方法描述本就中性 |
| experiments | 0.6 | 实验条件限定是正常文体 |
| results | 0.7 | 结果陈述允许条件说明 |
| discussion | 0.8 | 讨论允许保留 |
| conclusion | 1.2 | 记忆点，不下猛药 |
| limitations | 0.2 | 局限章节本就该谈局限 |
| rebuttal | 0.7 | 需回应审稿人，语气可缓和 |
| unknown | 1.0 | 中性 |

规则可在自身 `sections` 中覆盖，例如：

- `self-weakening-hedge`：abstract 1.3 / conclusion 1.3 / experiments 0.4（削弱词在实验章节较可接受）
- `loss-framing`：limitations 0.05（主动承认落败在局限章节被抑制）
- `procedural-narration`：method 0.05 / experiments 0.1 / results 0.1（过程叙述在方法/实验章节是正常写法）
- `premature-self-negation`：limitations 0.05（局限章节谈局限是应该的）
- `overgeneralized-limitation`：limitations 0.1

**章节抑制阈值**：`multiplier < 0.15` 时不算命中，计入 `suppressed` 数组而不是 `hits`。这样 UI 可以诚实显示「本节有 3 处被规则忽略」，而不是假装没有。

### 2.3 掩码区（不参与匹配）

| 区域 | 正则 |
|---|---|
| 围栏代码块 | ` ```...``` ` / `~~~...~~~` |
| 行内代码 | `` `...` `` |
| 行间公式 | `$$...$$` |
| 行内公式 | `$...$` |
| URL | `https?://...` |
| 链接目标 | `](...)` |
| HTML 标签 | `<tag ...>` |

掩码实现为**等长空格替换**（保留 `\n`），因此所有偏移量保持不变，可直接对原文 `slice` 高亮。

---

## 3. 评分（Scoring）

### 3.1 公式

```
weightedPoints = Σ (severityWeight(rule) × sectionMultiplier(rule, section))

severityWeight: high=3, medium=2, low=1

defensiveDensity = weightedPoints / max(sentences, 4)

score = clamp(round(100 − 40 × defensiveDensity), 0, 100)
```

- `sentences` 由 `sentenceRanges()` 统计：中文以 `。！？；` 断句，英文以 `.` + 空白 + 大写/数字开头断句，空行断段。
- `max(sentences, 4)`：短文本（如一句摘要）不会被一处命中直接打到 0 分，避免「短样本惩罚过重」。
- `40` 是斜率：约 2.5 个「高严重度单位 / 句」打到 0 分。
- **score 是诊断指标，不是 KPI**。它没有线性可加性，不能跨文档比较绝对值；只用于同一文档改前/改后对比与趋势。

### 3.2 输出 JSON Schema（稳定，version = 1）

```jsonc
{
  "version": 1,
  "score": 62,                       // 0-100 整数
  "defensiveDensity": 0.95,          // weightedPoints / max(sentences, 4)
  "stats": {
    "chars": 420,                    // 原文 UTF-16 长度
    "sentences": 6,
    "hits": 7,                       // 全部命中（未截断）
    "high": 3, "medium": 2, "low": 2,
    "suppressed": 1,                 // 被章节权重抑制的数量
    "weightedPoints": 5.7,
    "markedRatio": 0.038             // 命中字符数 / 总字符数
  },
  "byRule": [                        // 按 count 降序
    { "ruleId": "self-weakening-hedge", "count": 3, "high": 3, "medium": 0, "low": 0 }
  ],
  "bySection": [                     // 按出现顺序
    { "section": "abstract", "count": 5 }
  ],
  "hits": [
    {
      "ruleId": "self-weakening-hedge",
      "ruleName": "自我削弱表达",
      "severity": "high",
      "kind": "rewrite",
      "start": 42,                   // UTF-16，含
      "end": 47,                     // UTF-16，不含
      "line": 3,                     // 1-based
      "column": 5,                   // 1-based，UTF-16 code unit
      "text": "遗憾的是",
      "phrase": "遗憾的是",           // 命中的词表条目
      "language": "zh",              // 'zh' | 'en'
      "section": "abstract",
      "weight": 3.9,                 // severity × section multiplier
      "suggestion": {
        "kind": "rewrite",           // 'rewrite' | 'question' | 'delete'
        "note": "删除该削弱词；若程度重要，用可核验的数字代替形容词。",
        "text": ""                   // 仅 rewrite 可以有；question 必须缺省
      }
    }
  ],
  "truncated": false,                // hits 是否被 maxHits 截断
  "suppressed": [ { "ruleId": "loss-framing", "start": 120, "end": 132, "section": "limitations" } ],
  "coverage": {
    "maskedRegions": [ { "name": "fenced-code", "start": 200, "end": 240 } ],
    "sectionsSeen": ["abstract", "experiments"]
  }
}
```

### 3.3 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `section` | 自动检测 | 强制章节 |
| `minSeverity` | 无（全部） | `'high' \| 'medium' \| 'low'`。**只过滤 `hits` 列表，不改变分数与统计**；被隐藏的条数见 `stats.hidden` |
| `disabledRules` | `[]` | 规则 id 数组 |
| `extraPhrases` | `{}` | `{ [ruleId]: { zh?: string[], en?: string[] } }`，用户自定义词表 |
| `maxHits` | `500` | 返回列表上限（统计不受影响） |

---

## 4. 非目标与真实性护栏（Truthfulness guard）

### 4.1 硬性非目标

1. **不自动改文**。`scan()` 是纯函数，返回报告；改写必须由用户显式触发（L3 模型辅助），且逐条确认。
2. **不判断科学正确性**。检测器只判断「表达是否自我削弱 / 是否越界」，不判断「结论是否成立」。
3. **不奖励 overclaiming**。把「弱于」改成「全面领先」不会提高分数——`comparison-scope-creep` 会立刻命中。这是刻意的对称设计。
4. **不做跨语言翻译**。中英词表各自匹配，不互译。
5. **不依赖 DSH**。`packages/detector` 可以在任何 Node ≥18 环境运行，测试也不需要 DSH runtime。

### 4.2 哪些建议必须作为「问题」而不是「改写」

以下情况检测器**只提问**（`kind: 'question'`，无 `text` 字段）：

| 规则 | 为什么不能代答 |
|---|---|
| `loss-framing` | 是否必须讨论该结果、能否用目标差异解释，取决于论文故事线 |
| `overgeneralized-limitation` | 证据覆盖哪些条件，只有作者知道 |
| `comparison-scope-creep` | 实际评测了哪些数据集/指标，只有作者知道 |

以下情况可以直接给删除建议（`kind: 'rewrite'`，`text: ''`）：`self-weakening-hedge`、`defensive-preamble`、`apology`、`premature-self-negation`、`procedural-narration` —— 因为这些是**删掉也不改变事实**的措辞。

> 护栏的工程实现：`rules.js` 里 `kind` 是声明，`scan.js` 里对 `question` 规则强制不输出 `suggestion.text`；测试 `question-kind hits never carry replacement text for any rule` 守住这条契约。

---

## 5. 原型实现与测试

### 5.1 文件

```
packages/detector/
├── package.json          # @adw/detector, zero dependencies
├── index.js              # 再导出
├── lib/
│   ├── scan.js           # 几何 + 匹配 + 评分（深模块实现）
│   ├── rules.js          # 8 条规则、章节权重、负例（判据）
│   └── lexicons.js       # CN/EN 词表数据
└── test/
    └── scan.test.js      # 25 个测试
```

### 5.2 运行命令与结果

```bash
cd packages/detector
/Users/yrh/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node --test test/scan.test.js
```

实测输出（尾部）：

```
✔ overlapping phrases of one rule do not double count (0.115917ms)
✔ report shape is stable (0.145708ms)
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 81.800673
```

### 5.3 覆盖的测试类别

| 类别 | 用例 |
|---|---|
| 正例（上游 README 对照表） | 防御性原句命中；发布会改写版干净 |
| 负例 / 合法学术用法 | `仅当` / `only if` / `not only` / 基线劣于本文 / 表格范围限定 |
| CJK 偏移 | 中文偏移可 `slice` 回原文；行/列 1-based；emoji 代理对不偏移 |
| 掩码 | 代码块、公式、URL 内的命中为 0 |
| 章节抑制 | abstract vs limitations vs method vs experiments |
| 章节自动检测 | `# Abstract` / `## Experiments` 标题 |
| 幂等性 | 同文两次扫描 `deepEqual` |
| 契约 | 规则 kind 与 suggestion kind 一致；question 无 text |
| 健壮性 | 空串/空白/非字符串抛错；maxHits 截断但统计完整；分数单调、clamp |

### 5.4 已知局限（诚实声明）

1. **词表法必有漏检**。防范性写作的很多变体（如「本文在……方面还有提升空间」）不在词表内。用户可通过 `extraPhrases` 扩展。
2. **句法规则弱**。`procedural-narration` 只看词表 + 章节，无法识别「无 `我们首先` 但实质是流水账」的段落——那属于 L2/L3 的模型判断。
3. **章节检测只认 Markdown 标题**。Word/PDF 转换后的纯文本需要调用方显式传 `section`。
4. **英文断句是启发式**。缩写（e.g., et al.）可能造成句数偏差，进而影响密度分母；已用「下一个非空字符必须是大写/数字/引号/括号」降低误判，但不完美。
5. **负例 `we regret that ... is corrected here`** 会触发 `apology`（见 §1.2），这是已知误报，建议用户在 UI 中可关闭该规则。

---

## 6. 下一层：什么必须交给模型（The next layer）

检测器只覆盖「语言层」的机械信号。以下能力**必须**由 L2 Skill / L3 模型完成，检测器不得越界：

| 能力 | 为什么是模型的活 | 交接方式 |
|---|---|---|
| 叙事重构（重选主结果、重排贡献） | 需要理解全文证据与故事线 | 把 `report.byRule` 与 `hits` 作为上下文，交给 anti-defensive-writing skill |
| 实验职责分配（每个实验证明什么） | 需要理解实验设计与论证链 | Skill 的「实验规则」章节 + 用户显式请求 |
| 主张–证据一致性检查 | 需要读取论文正文与表格数字 | L3 逐段改写，必须附证据引用 |
| 防御性写作的「隐含变体」 | 词表覆盖不到 | Skill 的 12 条规则作为 system prompt section |
| rebuttal 策略 | 需要读审稿意见与回复 | Skill + 用户输入 |

**交接契约**：L1 产出的 `Report` 是 L2/L3 的输入，而不是替代品。典型链路：

```
原文 → scan() → Report（命中列表 + 分数）
                ↓
        用户点击「用 Skill 改写这一段」
                ↓
  prompt = skill 规则 + 该段原文 + Report.hits（规则 id 与短语）
                ↓
        模型返回最小改动版本 → 再 scan() 对比 score / hits 变化
```

第二次 `scan()` 的结果就是「前后对比」面板的数据来源——**用检测器验证模型改写是否真的减少了防御性表达，而不是相信模型的自我评价**。
