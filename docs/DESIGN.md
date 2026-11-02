# dsh-anti-defensive-writing · 总体设计

> 状态：v0.1 设计稿（M0 前）
> 目标宿主：DeepSeek Harness 0.2.1-rc.x（本稿以 0.2.1-rc.5 为验证基准）
> 代码标识符一律英文；正文中文。

---

## 0. 一句话与阅读顺序

这个插件只做一件事：**让模型在写论文时不替审稿人攻击作者，同时让作者看见这件事有没有发生。**

它有两个面，但只有一条主线：

- **写作纪律引擎**（L2/L3）：把上游 MIT 的「发布会原则」12 条规则装进 DSH，让模型在写作与改写时真的遵守。
- **测量仪表盘**（L1/L4）：用确定性检测器给写作健康度做离线测量，再用 DSH 的 projection 与面板把测量结果呈现出来。

两个面不是并列功能，而是**同一条因果链的两端**：纪律层负责改变行为，测量层负责证明行为改变了、且没有把作者推向另一个极端（过度宣称）。本稿的组织方式就是论证这条链为什么必须是这个形状。

建议阅读顺序：[DESIGN.md](DESIGN.md) → [notes/dsh-plugin-api.md](notes/dsh-plugin-api.md) → [notes/detector-spec.md](notes/detector-spec.md) → [notes/dashboard-design.md](notes/dashboard-design.md)。

---

## 1. 产品定位

`dsh-anti-defensive-writing`（下称 ADW）是 DSH 的一个写作纪律插件：它在模型写论文、改论文、压缩论文、组织实验时，把「论文是一场学术发布会，不是项目总结」这一原则变成可执行的规则与可检查的信号；同时用一组只读统计面板，把「防御性写作」的出现频率、严重度与变化趋势呈现给作者。它不生成论文，不替用户做科研判断，也不许诺「改完就能中」。

### 1.1 它解决的具体问题

防御性写作不是语法错误，而是一种**叙事姿态**：作者在审稿人开口之前，先替对方把刀递过去——「遗憾的是」「效果有限」「仍明显落后」「我们尚未……因此应谨慎理解」。这类表达单看每一句都「诚实」，合起来却把论文的论证结构拆成了自我审查报告。上游 skill 的洞察是：问题不在诚实，而在**把不属于主张责任的东西主动揽到自己身上**。

ADW 的产品假设是：模型不是不知道这些词不好，而是**在长上下文里没有稳定的行为约束**。所以需要两层干预：

1. 把 12 条规则作为**技能与提示词**常驻在模型的可用上下文里（L2），让它有据可依；
2. 把规则中**可机械判定的部分**做成检测器（L1），让「有没有遵守」从主观感受变成可复现的报告，并让报告驱动面板（L4）。

### 1.2 Non-goals（明确不做，且每条都有架构后果）

| Non-goal | 含义 | 架构后果 |
|---|---|---|
| **绝不 overclaim** | 不把「删掉自我削弱」偷换成「把主张说得比证据更强」。上游规则的前提是「只提出证据能牢固支撑的主张」；ADW 的任何建议都不得改变主张强度。 | 检测器的每条建议带 `kind: 'rewrite' \| 'question'`；`question` 类强制不带 `suggestion.text`，只能以问句呈现（见 §3.2）。 |
| **绝不自动编造证据** | 不生成数字、不补实验、不虚构引用、不替作者写「我们证明了」。 | L3 只做「per-span 最小编辑」，且输入必须是用户提供的原文；插件没有生成实验结果的工具。 |
| **绝不替代人的判断** | 不自动改稿、不自动提交、不把分数当录取线。所有改写建议默认 pending，需用户逐条接受。 | L3 的触发必须是显式用户动作；projection 只读；面板不提供「一键全文改写」。 |
| **不是论文生成器** | 不提供「输入题目生成论文」；不做选题、不做实验设计。 | 没有生成类工具；skill 的 description 明确限定为「写作/修改/压缩/组织实验」。 |
| **不做学术不端规避** | 不帮助隐藏局限性、不帮助绕过审稿。上游决策规则第 7 条「只有无法回避且确实影响核心结论时，才进行必要说明」是**允许说**，不是**禁止说**。 | 检测器对「必要的 limitation 声明」有 negative corpus；误报要能被用户一键标记为「这是必要声明」。 |
| **不做云端分析** | 稿件文本不离开本机进程。 | L1 零网络、零模型调用；L4 只读本地 projection/storage（见 §3.4）。 |

### 1.3 目标用户与成功标准

目标用户是**正在写/改论文的研究生与研究者**，使用 DSH 的 Web/Desktop 界面。成功不是「分数越高越好」，而是三个可观察事实：

1. 模型在改写任务中**主动引用规则**（skill 被加载、`adw_scan` 被调用）；
2. 同一段文字在改写前后，**高严重度命中数下降**，且没有新增「证据无法支撑的强主张」；
3. 用户能在一次会话内**看懂**为什么某句被标记（规则 id、原文 span、建议），而不是只看到一个分数。

---

## 2. 上游溯源与合规

### 2.1 上游事实

- 仓库：`Adkid-Zephyr/anti-defensive-writing-Skill`（GitHub）。
- 许可：MIT，`LICENSE` 第 1–3 行：`MIT License` / `Copyright (c) 2026 Adkid-Zephyr`。
- 本仓库内 pinned 版本：commit `82d31402caa0db1790026824399044538483171b`，提交日期 2026-10-07，tag `plugin-v1.0.0`，提交信息 `feat: package bilingual writing skills as a Codex plugin`。
- 内容资产：中文 `skills/anti-defensive-writing/SKILL.md`（94 行）、英文 `skills/anti-defensive-writing-en/SKILL.md`（123 行）、`prompts/精简版提示词.txt`、`prompts/quick-prompt-en.txt`、`PRIVACY.md`。
- 上游 `plugin.json` 声明 `license: MIT`，并明确「contains instructions only, with no MCP server, login, telemetry or external data transfer」。

### 2.2 vendoring 规则（逐条）

我们**原样复制**上游的四个内容文件（两份 SKILL.md + 两份 prompt），不改一个字节。理由：skill 的措辞本身就是产品；任何改写都会让「我们遵守的是上游规则」这句话失去依据。需要本地化或裁剪时，在我们的代码里做**适配**，不动 vendored 原文。

文件布局（**vendored 内容就住在插件包里**，不另设 `vendor/` 目录；这样发布时 `files` 白名单天然覆盖，`readAsset()` 的相对路径也稳定）：

```
packages/plugin/
├── LICENSE                                  # 插件自身 MIT 全文（与上游同文，含 Adkid-Zephyr 版权行）
├── LICENSE.upstream                         # 上游 MIT 原文，逐字复制，供归属引用
├── NOTICE                                   # 上游归属、仓库 URL、pinned commit、逐字文件清单
├── MANIFEST.json                            # 每个 vendored 文件的 sha256 与上游路径（§2.4 生成）
├── package.json
├── cordis.patch.yml
├── lib/
│   ├── index.js                             # host half 入口
│   ├── skill-provider.js                    # 读 skills/ 下的 SKILL.md
│   ├── command.js · tool.js · projection.js
│   └── client.js                            # client half（构建产物）
├── skills/
│   ├── anti-defensive-writing/SKILL.md      # 中文，逐字
│   └── anti-defensive-writing-en/SKILL.md   # 英文，逐字
└── prompts/
    ├── 精简版提示词.txt                      # 中文，逐字
    └── quick-prompt-en.txt                  # 英文，逐字
```

上游的 `PRIVACY.md` 不随包复制：它是上游 Codex 插件的隐私声明，不是我们插件的声明；我们自己的 `PRIVACY.md` 单独写（见 §6.1）。`LICENSE.upstream` 与 `NOTICE` 必须进入 `package.json` 的 `files` 白名单。

`NOTICE` 的最小内容：

```
Anti-Defensive Writing skill content
Copyright (c) 2026 Adkid-Zephyr
Source: https://github.com/Adkid-Zephyr/anti-defensive-writing-Skill
Pinned commit: 82d31402caa0db1790026824399044538483171b (plugin-v1.0.0, 2026-10-07)
License: MIT (see LICENSE in this directory)
Files in this directory are copied verbatim from the upstream repository.
Modifications to the surrounding plugin are ours and are listed in the repository history.
```

`MANIFEST.json` 形如：

```json
{
  "upstream": "Adkid-Zephyr/anti-defensive-writing-Skill",
  "commit": "82d31402caa0db1790026824399044538483171b",
  "tag": "plugin-v1.0.0",
  "retrieved": "2026-11-02",
  "files": [
    { "path": "skills/anti-defensive-writing/SKILL.md", "sha256": "…", "upstreamPath": "skills/anti-defensive-writing/SKILL.md" }
  ]
}
```

### 2.3 必须做 / 绝不能做

**必须做：**

1. 随包分发 `packages/plugin/LICENSE.upstream`（MIT 全文，含 `Copyright (c) 2026 Adkid-Zephyr`）。
2. 在 `packages/plugin/NOTICE` 列出上游归属、pinned commit 与逐字复制文件清单。
3. 在 `package.json` 的 `license` 中声明**我们自己的代码**的许可（MIT），并确保 `files` 包含 `skills/**`、`prompts/**`、`LICENSE`、`LICENSE.upstream`、`NOTICE`。
4. 对 vendored 文件做 sha256 校验（`MANIFEST.json`）；任何字节变化都必须失败。
5. 如果未来必须修改 vendored 文本（例如修一个错字），在文件头加 `Modified from <upstream path> at <commit>; changes: ...`，并同步更新 `MANIFEST.json` 的 `modified: true` 与变更说明。

**绝不能做：**

- 不能把上游内容重新许可为「我们的」或换成非 MIT 许可；
- 不能删除/改写上游版权声明；
- 不能把上游 skill 说成是 DSH 官方或我们原创；
- 不能把上游 `PRIVACY.md` 的承诺（无网络、无遥测）扩大解释为「整个插件无网络」——我们自己的插件有本地 fetch 路由，但没有外发网络请求，需在插件自己的 `PRIVACY.md` 里单独声明；
- 不能在未更新 `MANIFEST.json` 的情况下静默改 vendored 文本。

### 2.4 `scripts/sync-upstream.mjs` 同步故事

设计成一个**只读上游、只写 `packages/plugin/{skills,prompts}` 与归属文件**的确定性脚本：

```
node scripts/sync-upstream.mjs            # 按 PINNED_COMMIT 下载并覆盖 packages/plugin/{skills,prompts}
node scripts/sync-upstream.mjs --check    # 只校验：不写文件；漂移则 exit 1
node scripts/sync-upstream.mjs --to <sha> # 仅维护者用：更新 pin 并写 MANIFEST
```

实现要点：

1. `PINNED_COMMIT` 是脚本顶部的常量，与 `packages/plugin/MANIFEST.json` 的 `commit` 必须一致；`--check` 先比对二者。
2. 下载 `https://codeload.github.com/Adkid-Zephyr/anti-defensive-writing-Skill/tar.gz/<sha>`（或读取本地 `reference/upstream-skill/` 的 git 对象），只解出白名单内的六个文件（两份 SKILL.md、两份 prompt、`LICENSE`、`PRIVACY.md` 仅用于比对），写前先算 sha256。
3. 写入顺序：临时目录 → 校验 → 原子替换 `packages/plugin/skills/` 与 `packages/plugin/prompts/`；失败不留下半套文件。
4. `--check` 与 CI 的 `pnpm verify:upstream` 绑定：任何 vendored 文件与 `MANIFEST.json` 不一致即失败。
5. **升级 pin 必须是一个独立 PR**，PR 描述里贴出上游 diff（`git diff <old> <new> -- skills prompts LICENSE`），并由维护者确认「规则没有变化 / 变化是什么」。不允许线上自动跟随 `main`。

---

## 3. 能力分层：为什么是 L1→L4

这是本设计最核心的架构主张。四层不是功能清单，而是**按「模型参与度」排序的可靠性阶梯**：越往下越确定、越便宜、越隐私；越往上越灵活、越能处理语义，但也越不可复现。设计的关键是**让每一层只做它保证得了的事**，并且让上层的产物可以被下层测量。

```
┌──────────────────────────────────────────────────────────────┐
│ L4 统计与复盘    projections + dashboard（只读）              │
│    保证：看到的数字可追溯到 L1 的报告；不保证：写作质量        │
├──────────────────────────────────────────────────────────────┤
│ L3 模型辅助改写  显式用户动作，per-span，建议待确认            │
│    保证：不自动改稿、不新增事实；不保证：改写一定更好          │
├──────────────────────────────────────────────────────────────┤
│ L2 Skill/提示词  上游 12 条规则 + quick prompt，模型驱动        │
│    保证：规则在上下文中可见、可被引用；不保证：模型一定遵守     │
├──────────────────────────────────────────────────────────────┤
│ L1 确定性检测    regex/lexicon，离线，无模型                   │
│    保证：同输入同输出、零网络、可单测；不保证：语义正确        │
└──────────────────────────────────────────────────────────────┘
        ▲ 可靠性、可复现性、隐私性随层号下降
        ▲ 语义能力、改写能力随层号上升
```

### 3.1 L1 确定性检测（detector）

- **做什么**：把上游「语言规则（防自我削弱）」与可机械化的结构信号（过程叙事、结论突然自我否定、比较范围词）转成 **8 条**规则；对输入文本产出 `Report`：命中 span（UTF-16 offset + 1-based line/column）、规则 id、severity、`suggestion.kind`、分数、按规则/按章节计数。

  已实现的 8 条规则（`packages/detector/lib/rules.js`）：

  | rule id | 中文名 | severity | suggestion.kind |
  |---|---|---|---|
  | `self-weakening-hedge` | 自我削弱表达 | high | rewrite |
  | `loss-framing` | 主动承认落败 | high | rewrite |
  | `overgeneralized-limitation` | 局部现象上升为整体否定 | high | question |
  | `procedural-narration` | 工作汇报式叙事 | medium | rewrite |
  | `premature-self-negation` | 提前自我否定 | high | rewrite |
  | `defensive-preamble` | 防御性铺垫 | low | rewrite |
  | `apology` | 歉意表达 | medium | rewrite |
  | `comparison-scope-creep` | 比较范围越界 | medium | question |

  注意区分两个数字：**上游 skill 有 12 条规则**（叙事/语言/实验/结构），而**检测器只覆盖其中可机械判定的子集，共 8 条**。12 条是 L2 的契约，8 条是 L1 的能力边界；二者不能混为一谈。

- **评分公式**（本设计是唯一权威，detector-spec §3.1 与实现必须与此一致）：

  ```
  severityWeight: high = 3, medium = 2, low = 1
  weightedPoints = Σ (severityWeight(rule) × sectionMultiplier(rule, section))
  defensiveDensity = weightedPoints / max(sentences, 4)
  score = clamp(round(100 − 40 × defensiveDensity), 0, 100)
  ```

  章节权重默认值：`abstract 1.2, introduction 1.0, related-work 0.4, method 0.3, experiments 0.6, results 0.7, discussion 0.8, conclusion 1.2, limitations 0.2, rebuttal 0.7, unknown 1.0`；单条规则可覆盖。**抑制阈值**：`multiplier < 0.15` 时不计入 `hits`，改记入 `suppressed`（UI 可以诚实地说「本节有 N 处被规则忽略」）。`max(sentences, 4)` 保证一句摘要不会因一处命中被打到 0 分。

- **保证**：纯函数、零 DSH 依赖、零网络、零模型；`version: 1` 的 Schema 稳定；同一版本对同一输入字节级可复现；CJK 与 markdown 的 offset 可 `slice` 回原文；25 个测试覆盖正例、负例、CJK 偏移、掩码、章节抑制、幂等、契约。
- **绝不能做**：不改写文本、不判断科学有效性、不给「论文质量」打分、不把「没命中」说成「写得好」、不调用模型。
- **为什么 L1 不能调用模型**（四条硬理由）：
  1. **成本**：面板要按轮次刷新，每次刷新都过一次模型等于给每个 token 付两次钱；一次会话几十轮，成本不可控。
  2. **延迟**：侧边栏要在 100ms 级更新；模型调用是秒级且受网络波动影响，交互会碎。
  3. **确定性**：分数趋势要能跨天、跨版本比较；模型有采样温度，同一段文字昨天 62 分今天 58 分，趋势就没有意义。
  4. **隐私**：论文原稿是未发表成果；离线扫描保证文本不离开本机进程。上游 `PRIVACY.md` 的「no network calls」承诺也必须由 L1 继续兑现。

### 3.2 L2 Skill / 提示词注入

- **做什么**：把 vendored 的两份 `SKILL.md` 通过 `ctx.skills.registerProvider` 注册为 DSH skill，`modelInvocable: true`、`userInvocable: true`；同时提供一个可选的、约 150–250 token 的 systemPrompt section（规则摘要 + 「细节请加载 skill」），在用户开启「常驻纪律」时注入。
- **保证**：模型在写作/改写时能看到规则；用户可以用 `/adw rules` 查看规则清单；skill 的 description 含触发词（论文润色、论文修改、写摘要、写引言、写结论、压缩论文、rebuttal 等）。
- **绝不能做**：不能保证模型一定遵守；不能把 skill 注入当成「已改写」；不能在用户不知情时把整篇稿件塞进 system prompt。
- **为什么还需要 systemPrompt section**：skill 是**按需加载**的，模型可能不触发；一个短小的常驻 section 是「底线提醒」，而完整 12 条规则仍留在 skill 里，避免每轮都付全量 token。这也是 KV cache 友好的：短 section 稳定在前缀，只有开关切换时才破坏一次缓存。

### 3.3 L3 模型辅助改写

- **做什么**：用户显式选择一段文字（或一次 scan 报告中的一组 span），要求模型按规则改写；插件的角色是**把 span 与建议整理成结构化上下文**，让模型做 per-span 的最小编辑，并把 before/after 交给用户逐条确认。
- **保证**：显式触发、可取消、不自动应用、不跨段重写、不引入原文没有的数字/结论；每条建议标注它对应哪条规则、是否改变主张强度。
- **绝不能做**：不能批量「一键优化全文」；不能在后台悄悄改文件；不能把「删掉 limitation」当成默认建议；不能在没有证据时把「效果有限」改成「效果显著」。
- **Truthfulness guard（与 §1.2 的 overclaim non-goal 对应）**：检测器的建议分两类——
  - `rewrite`：纯语言层面、不改变主张强度（如删「遗憾的是」）；
  - `question`：涉及主张与证据关系（如「效果有限」是否应删除，取决于是否有更强证据）。`question` 类只能以问句形式呈现，模型不得擅自给改写文本。这条规则是 L3 与 L1 之间唯一的「语义防火墙」。

### 3.4 L4 统计与复盘

- **做什么**：把 L1 的报告变成会话级 projection（实时）与跨会话/文档级统计（复盘）；面板展示分数、命中数、按规则分布、趋势与改写前后对比。
- **保证**：只读；每个数字都能追溯到某次 `scan` 的报告；分数公式公开；没有「目标分数」概念。
- **绝不能做**：不能把分数作为写作门禁；不能只显示分数不显示计数；不能把「分数上升」当成「论文更好」；不能为了好看的曲线而改变检测规则（规则版本与分数一起记录）。

### 3.5 分层的取舍：为什么不是「全都交给模型」

一个自然的反问是：既然模型能理解语义，为什么不直接让模型判断防御性写作？答案是**测量与干预必须分开**：

- 干预（L2/L3）需要语义理解，交给模型；
- 测量（L1/L4）需要可复现与可比较，交给确定性代码；
- 如果测量也交给模型，就会出现「用同一个可能犯错的模型去评判自己」的循环，分数无法作为独立证据。

因此本插件的架构原则可以写成一句话：**确定性在下，模型在上；测量只测量确定性层。**

---

## 4. 模块图与 seam 论证

### 4.1 组件图（host half / client half / shared）

```
┌──── DSH Host (Cordis tree) ──────────────────────────────────────────────────────────────┐
│                                                                                          │
│  ctx.skills (registry seam)     ctx.tools (registry seam)     ctx.commands               │
│        ▲                               ▲                            ▲                    │
│        │ registerProvider              │ register                   │ register           │
│  ┌─────┴──────────────┐        ┌───────┴──────────┐       ┌─────────┴────────┐           │
│  │ adw-skill-provider │        │  adw-scan tool   │       │   adw command    │           │
│  │  (adapter)         │        │  (model-facing)  │       │  /adw scan|...   │           │
│  └─────┬──────────────┘        └───────┬──────────┘       └─────────┬────────┘           │
│        │ vendored SKILL.md bytes       │ scan(text, opts)             │                  │
│        │                               ▼                              ▼                  │
│        │              ┌───────────────────────────────────────────────┐                  │
│        │              │      @adw/detector  (pure module, zero DSH)    │                 │
│        │              │      scan(text, options) -> Report             │                 │
│        │              │      RULES / rules / CN / EN / scoreOf         │                 │
│        │              └───────▲───────────────────────────▲───────────┘                  │
│        │                      │                           │                              │
│  ┌─────┴──────────────┐  ┌────┴───────────────┐  ┌────────┴──────────────┐               │
│  │ skills/            │  │ adw-scan-store(M3) │  │ adwWriting projection │               │
│  │  anti-defensive-*  │  │ storageDomain, M3  │  │ sessionProjections    │               │
│  │ (MIT, verbatim)    │  │  JSON records)     │  │  fold events)         │               │
│  └────────────────────┘  └────┬───────────────┘  └────────┬──────────────┘               │
│                               │                           │ wire view JSON               │
│                    ┌──────────▼────────────┐              │                              │
│                    │ /api/adw/report (M3)  │              │                              │
│                    │ /api/adw/trend  (M4)  │              │                              │
│                    │ /api/adw/detail (M3)  │              │                              │
│                    └──────────┬────────────┘              │                              │
│                               │ fetch (JSON)              │ projection snapshot          │
│  ctx.systemPrompt.section ──► adw:writing-discipline (optional)                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                               │                           │
                               ▼                           ▼
┌──── DSH Web client ──────────────────────────────────────────────────────────────────────┐
│                                                                                          │
│  ┌────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐              │
│  │ writing-health tab │  │ report view          │  │ settings card        │              │
│  │ sidebar.right.pane │  │ sidebar.panellist    │  │ settings.section     │              │
│  └────────────────────┘  └──────────────────────┘  └──────────────────────┘              │
│  ┌─────────────────────────────────────────────────────────────────────┐                 │
│  │ i18n: ctx.locale.register('dsh-anti-defensive-writing', { zh, en }) │                 │
│  └─────────────────────────────────────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 模块台账（interface 小、implementation 深）

| 模块 | Interface（调用方必须知道的全部） | Implementation（藏起来的部分） | Depth / Leverage / Locality |
|---|---|---|---|
| `@adw/detector` | `scan(text: string, options?: ScanOptions): Report`；`rules` / `RULES` / `RULES_BY_ID` / `CN` / `EN` / `scoreOf` / `DETECTOR_VERSION`。`ScanOptions` 实际字段：`section?`、`minSeverity?`（`'high' \| 'medium' \| 'low'`）、`disabledRules?`（`string[]`）、`extraPhrases?`（`Record<ruleId, { zh?: string[]; en?: string[] }>`）、`includeSuppressed?`（boolean）、`maxHits?`（number，默认 500）。**没有 `lang` 选项**——语言按词表逐条匹配，中英混排自动各算各的。 | 8 条规则、CN/EN 词典、UTF-16 offset、markdown/公式/代码掩码、句子几何、章节权重、评分、suggestion 生成与 truthfulness guard。 | **深**：一个函数调用换来完整报告；**leverage**：tool、command、projection、面板、测试、CI 六个调用方共用一份实现；**locality**：改一条规则只动 `rules.js`，改几何只动 `scan.js`。 |
| `adw-skill-provider` | `ctx.skills.registerProvider(create)` 收的是**工厂** `create(control)`（不是 provider 对象），返回 provider：`name`、`list(options)`、`get(candidate, options)`。candidate 的 `name`/`description`/`invocation`/`provider`/`source`/`rank` **全部必需**（`provider` 必须等于 `provider.name`，`rank` 必须是有限数字，第三方用 `BUNDLED_SKILL_RANK = 600`）；`locator` 语义必需。 | 读取 `skills/` 下的 vendored 文件、解析 YAML frontmatter、按 `skillLanguage` 决定 CN/EN 的排序（两份始终都 advertise）、注入 invocation policy、把 `resourceBase` 指向 `skills/<name>/`。 | **适配器**（adapter）：上游内容是数据，适配器只做形状转换。seam 由 DSH 的 `ctx.skills` 提供，已有 filesystem / badge 两个真实适配器，因此是**真 seam** 而非假想 seam。 |
| `adw-scan` tool | `adw_scan({ text?, path?, section?, minSeverity? }) -> ToolValue`，其中 `ToolValue = { ok, score, defensiveDensity, stats, byRule, hits, truncated }`（从 `Report` 投影出来的有界形状，不是整份 Report）。模型只看到这个 JSON。 | 通过 `workingDirectory` 服务解析工作区根、再用 `node:fs` 读文件（路径校验拒绝越出 workspace）、`MAX_INPUT_CHARS = 200_000` 上限、调用 detector；**聚合值始终全量**，`hits` 只保留前 `MAX_HITS = 40` 条并置 `truncated: true`。 | **深**：模型不需要知道文件 IO、编码、截断规则；**leverage**：模型、`/adw scan`、report route 三个入口共用；**locality**：所有「怎么把文本变成报告」的决策在一处。 |
| `adw command` | `ctx.commands.register({ name: 'adw', description, input: { hint }, handler })`；handler 收 `{ commandId, agent, rawInput, attachments, signal }`，返回 `{ kind: 'success', text? }` 或 `{ kind: 'error', text }`（error 的 text 必须非空）。语法：`/adw scan <path> [--section <s>] [--min-severity high\|medium\|low]`、`/adw rules [<rule-id>]`、`/adw version`、`/adw on \| off`。 | 子命令解析、文件读取、报告渲染成人类可读文本（**只展示前 20 条**，完整统计仍打印）、规则目录与反例展示。 | 中等深度：命令是薄的 UI 适配器；复杂度在子命令路由与输出格式。 |
| `adw projection unit` | `ctx.sessionProjections.register({ key: 'adwWriting', stateSchema, stateVersion: 1, init(header, inheritedEventCount), apply(state, event), wire: { viewSchema, view } })`；`stateSchema`/`viewSchema` 只需有 `.parse()`，`wire` 可省略（host-only），`apply` 同步且不关心的事件返回同一引用。view 字段：`version, scans, turn, last{score,hits,high,medium,low,chars,at,source}, byRule[], trend[], pairs[], summary{distinctRules,totalHits,averageScore,worstScore}`。 | 折叠 `user/message`（作为 before 候选）、`tool/result`（仅 `adw_scan`，取 `meta.value.result`）、`command/done`（`/adw scan` 的成功文本）、`assistant/message`（有界重扫，`MAX_SCAN_CHARS = 20_000`）；保留 `MAX_TURNS = 60` 个点、`MAX_PAIRS = 8` 对改写前后、最多 12 条 per-rule；无关事件返回同一引用。 | **深**：客户端只读一个 plain-JSON view；**locality**：所有「会话内怎么写统计」的逻辑在 fold 里，UI 不算分。 |
| `adw-scan-store` **（未实现，M3）** | `ctx.storageDomain` 上的 `adw` 域：`putScan(record)` / `listScans(range)` / `getFileHistory(path)`。M3 前趋势只来自 session projection。 | JSON backend 的 unit/table 布局、content hash 去重、按文件/日期索引、保留策略。 | 中等深度：跨会话统计必须持久化，但接口只有三个方法。 |
| `/api/adw/*` routes **（未实现，M3）** | `connection.fetch.register({ path, methods: ['POST'], requestBody: 'buffered', fetch })`；响应 `{ ok: true, value }` / `{ ok: false, error: { code, message } }`。M0–M2 没有任何 fetch 路由，面板只读 projection。 | 参数校验、session 解析、scan-store 查询、live scan（report route 对文件按需扫描）、响应截断。 | **深**：客户端只看见稳定的 JSON envelope；host 侧可以换存储/换扫描策略而不动 UI。 |
| `writing-health` tab | `ctx.effect(() => ctx.sidebarRightTabs.register({ id: 'dsh-adw', kind: 'adw-writing-health', title: () => t('tab.title'), guide: [...] }))` + `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-adw', locale: NS }, Body))`，可选标题 seat `sidebar.right.pane.tab.title` 同 key `dsh-adw`；`title`/`label` 都必须是 thunk，否则语言切换后钉死；tab body 从 slot 注入的 hook context 拿 `useProjection('adwWriting')`（组件 props 含 `sessionId`、`useProjection`、`t`），**不是**自己 fetch 或读 snapshot。 | 分数环、命中列表、per-rule 柱状图、sparkline、空/加载/错误态、compact/expanded 布局。 | 浅接口、深实现：UI 复杂度全在组件内部。 |
| `report view` **（未实现，M3）** | `conversation.view`（session 作用域 list slot，`{name, id, order, label}` + Component）或 `sidebar.panellist` + `main` keyed slot；数据走 `/api/adw/report`。M0–M2 没有报告页。 | 文件级报告、分数历史、按规则筛选、跳转到行。 | 中等。 |
| `settings card` | `ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'anti-defensive-writing', order: 12, label: () => t('settings.nav'), inject: () => ({ t }) }, SettingsSection))`（`settings.section` 是 root-scope `list`，`id` 必需、`order` 可选，`label` 用 thunk，`inject` 是给组件的注入面工厂）。Config schema 字段（与 `packages/plugin/lib/index.js` 一致）：`enabled`、`injectPrompt`、`tools`、`minSeverity`（`'high'\|'medium'\|'low'`）、`disabledRules`（`string[]`）、`skillLanguage`（`'zh'\|'en'`）。注：`plugins.bundle.config` 是 dsh-context 自用的 per-bundle 配置卡，不是通用设置入口；通用入口是 `settings.section`。 | 表单、保存/重置、校验、即时生效。 | 薄适配器。 |
| `i18n` | `ctx.locale.register('dsh-anti-defensive-writing', { zh, en })` + `ctx.locale.bind('dsh-anti-defensive-writing')`（client bundle 的 `NS` 常量是这个全名）。 | 两套字典、key parity。 | 薄。 |

### 4.3 三个关键 seam 的论证

#### seam A：detector 是纯深模块

**位置**：`packages/detector/index.js` 的 `scan()`（实现分布在 `lib/scan.js`、`lib/rules.js`、`lib/lexicons.js`）。它不 import 任何 `@deepseek-ai/*`、不 import `node:*`、不读环境变量。**它是 plain ESM JavaScript + JSDoc 类型，没有构建步骤**：`node --test` 直接跑源码，插件通过 `packages/plugin/lib/detector.js` 再导出。

**为什么把 seam 放在这里，而不是放进 Cordis 插件里：**

1. **deletion test**：假设删掉 detector，把规则逻辑直接写进 `adw-scan` tool。那么 `/adw scan`、projection 的 fold、report route、面板的「重新扫描」按钮、测试、CI 脚本六处都要各自实现一遍规则；改一条词典要改六处。复杂度没有消失，只是扩散了。detector 正是在消除这种扩散。
2. **interface 即测试面**：所有 golden corpus 测试都通过 `scan()` 这一条缝调用，和 tool/command/面板调用的是同一条缝。我们不需要为测试造一个假的 DSH host。
3. **两个真实运行环境**：detector 既在 DSH host 进程里跑，也在 `scripts/adw-scan.mjs`（CI、命令行）里跑。这不是「假想的第二个 adapter」，而是第二个真实调用环境；它证明了「零 DSH 依赖」不是口号。
4. **零依赖的代价可控**：detector 只用 ESM 标准库（`String.prototype.matchAll`、`RegExp`），词典是纯数据文件（`lib/lexicons.js`）；没有 TypeScript 编译步骤，也没有 `node:*` 导入，因此可以被未来任何编辑器插件复用，而不会把 DSH 的 Cordis 树拖进去。

**interface 的纪律**：`Report` 是纯 JSON（无 class 实例、无函数、无 `undefined` 值），字段一旦发布就按 `report.version`（当前为 `1`）管理；新增规则只能加字段，不能改已有字段含义。这让 projection、storage、HTTP 三层都能安全地透传同一个对象。注意：`suggestion.text` 在 `kind: 'question'` 时**必须缺省**，这是 schema 的一部分，由 `question-kind hits never carry replacement text for any rule` 测试守护；`report shape is stable` 测试守护字段集合。

#### seam B：projection 是客户端读模型

**位置**：`ctx.sessionProjections.register({ key: 'adwWriting', ... })` 的 `wire` 边界。

**为什么需要这个 seam：**

- 客户端**不能**自己扫描：把 detector 打进 client bundle 会让包体变大，而且每渲染一次就重扫全文，成本不可接受；更关键的是，客户端拿不到完整的会话原文（projection 只发聚合值）。
- 客户端**不应该**自己折叠事件：事件顺序、turn/step 语义、tool result 配对都是 host 的知识；让每个 UI 都实现一遍必然漂移。
- projection 的 interface 是 `{ asOfSeq, values }` 的 plain JSON；它和 DSH 的 `snapshot()`/`onChanged()` 机制对齐，客户端只读。**leverage**：未来 TUI、CLI、导出报告都可以复用同一个 `adwWriting` view；**locality**：统计口径只在 host 的 fold 里定义一次。

**约束（来自 `dsh-session-projection` 的公开契约）**：`apply` 必须同步；不关心的事件必须返回同一个 state 引用；`wire.view` 必须同步且返回纯 JSON；`stateVersion` 在字段或语义变化时递增。这些约束会写进 projection 模块的顶部注释，并在测试里用 schema parse 兜底。

#### seam C：skill provider 是上游内容的适配器

**位置**：`ctx.skills.registerProvider(...)` 返回的 provider 对象。

**为什么是 adapter 而不是 module**：这个模块的「实现」几乎是数据——两份 Markdown 的字节。它做的事情只有：把文件读出来、解析 frontmatter、按语言选择、声明 invocation policy。真正的内容在上游。把它叫做 adapter 是准确的：它满足 DSH 的 provider interface，但内部没有自己的业务逻辑。

**为什么这个 seam 是 DSH 已经提供的**：`ctx.skills` 是 DSH 的 service definition（`dsh-skill`），已有 `dsh-skill-filesystem` 与 `dsh-skill-badge` 两个真实 adapter。我们只是第三个 adapter，不改 registry。这意味着：上游内容升级时只动 `skills/` + `prompts/` 与适配器；DSH 的 skill 机制升级时只动适配器与 peerDependencies。

### 4.4 深度总结：哪些复杂度被藏起来了

| 调用方看到的 | 被藏起来的复杂度 | 结果 |
|---|---|---|
| `scan(text)` | 8 条规则、双语词典、UTF-16 offset、掩码、section 抑制、评分、suggestion 分类 | 一个函数，六个调用方 |
| `adw_scan({ path })` | 文件读取、编码、大小限制、截断、错误码 | 模型只看见 JSON |
| `adwWriting` view | 事件折叠、turn 配对、保留窗口、引用稳定 | 面板只读一个对象 |
| provider 对象 | 文件定位、frontmatter、语言选择、resource base | DSH 只看见标准 provider |
| `/api/adw/report` | 存储查询、实时扫描、参数校验、错误 envelope | 客户端只看见 `{ok,value}` |

---

## 5. 数据流

### 5.1 总述

所有数据流都遵循同一条规则：**文本只在 host 进程内被 L1 读取；模型只通过 skill 正文与 `adw_scan` 的 JSON 结果看到规则与报告；客户端只通过 projection 与 fetch route 看到聚合值。** 没有任何一条流把整篇稿件发给第三方服务。

### 5.2 (a) 用户粘贴一段文字要求改写

```
User                Composer              Agent (model)            adw_scan tool          Detector
 │  paste + "帮我改"    │                       │                       │                     │
 ├────────────────────►│                       │                       │                     │
 │                     │ user/message          │                       │                     │
 │                     ├──────────────────────►│                       │                     │
 │                     │                       │ 1. skill catalog 已含  │                     │
 │                     │                       │    anti-defensive-*    │                     │
 │                     │                       │ 2. 按 description 触发 │                     │
 │                     │                       │    或用户显式 /skill   │                     │
 │                     │                       │ 3. 调 adw_scan(text)   │                     │
 │                     │                       ├──────────────────────►│                     │
 │                     │                       │                       ├────────────────────►│
 │                     │                       │                       │  Report (spans)     │
 │                     │                       │                       │◄────────────────────┤
 │                     │                       │  tool/result (JSON)   │                     │
 │                     │                       │◄──────────────────────┤                     │
 │                     │                       │ 4. 按规则给 per-span   │                     │
 │                     │                       │    最小编辑建议        │                     │
 │                     │  assistant/message    │                       │                     │
 │                     │◄──────────────────────┤                       │                     │
 │  5. 用户逐条 accept  │                       │                       │                     │
 │◄────────────────────┤                       │                       │                     │
```

关键点：

- `adw_scan` 的 tool result 会进入会话日志（`tool/result`），因此 projection 能把它计入「本轮扫描」。`tool/result` 携带的是 detector 的 `Report` JSON（`version: 1` + `score` + `stats` + `byRule` + `hits[]`）；detector 默认的列表上限是 `maxHits: 500`，超出时 `hits` 截断而 `stats` 保持全量并置 `truncated: true`——所以正常论文片段不会被截断，模型也不会得到一份「只有前 N 条」的假统计。注意：`/adw` 命令的**人类可读文本**为了可读性只展示前 20 条（`command.js` 的 `renderReport`），这与 `adw_scan` 的 tool result 是两回事，不要混淆。
- 模型给出的改写建议不落盘；只有用户接受后，新的 `assistant/message` 或文件写入才会发生。
- 如果用户没有显式要求改写，只是普通写作，L2 的 systemPrompt section 仍然生效，但不会自动调用 `adw_scan`（避免每轮都扫描）。

### 5.3 (b) 用户 `/adw scan <path>` 扫描文件

```
User          /adw command        workingDirectory       Detector        Session log
 │ /adw scan     │                     │                   │                │
 │ docs/a.md     │                     │                   │                │
 ├──────────────►│                     │                   │                │
 │               │ ensure(cwd)         │                   │                │
 │               ├────────────────────►│                   │                │
 │               │ workspace root      │                   │                │
 │               │◄────────────────────┤                   │                │
 │               │ read via node:fs (path must stay inside the root)          │
 │               │ scan(text,{section})│                   │                │
 │               ├─────────────────────────────────────────►│                │
 │               │                     │    Report         │                │
 │               │◄─────────────────────────────────────────┤                │
 │               │ command/done {kind:'success', text}                       │
 │               ├──────────────────────────────────────────────────────────►│
 │  text summary │                     │                   │                │
 │◄──────────────┤                     │                   │                │
```

关键点：

- 命令结果是**直接 UI 输出**（`command/done` 的 `text`），不进入模型历史；`command/run` / `command/done` 本身是 DSH 的日志事件，projection 可以据此知道「用户扫描过」。
- `adw-scan-store`（M3 起）用 `contentHash` 去重：同一文件同一内容重复扫描只更新 `at`，不新增记录；这保证趋势不被重复点击污染。M1/M2 阶段尚未引入 store，`/adw scan` 只渲染文本。
- 文件读取走 `workingDirectory` 服务解析出的工作区根（`lib/index.js` 的 `readAssetFile`），越出 workspace 的相对路径被拒绝；这是命令/工具层的边界检查，不是 DSH 沙箱本身。当前实现用 `node:fs`（不经 `ctx.fs`），因此不触发 DSH 的 fs 观察策略——这是有意的取舍（M0 零 DSH 依赖优先），需在 PR 中标注；后续若改走 `ctx.fs.readText` 可获得观察策略与版本守卫。

### 5.4 (c) 模型在改写时自动遵循规则

```
Session start
     │
     ├─► ctx.skills.list()  → skill catalog 注入（initial catalog message）
     │
     ├─► ctx.systemPrompt.section('adw:writing-discipline')  ← 可选、短
     │
User: "帮我压缩这段引言"
     │
     ▼
Model sees: skill description（触发词命中）+ short section（底线提醒）
     │
     ├─► 若需要完整规则：调用 skill 工具加载 SKILL.md
     │        └─ 返回 <skill_content> 12 条规则 + checklist
     │
     ├─► 写作/改写输出
     │
     └─► 可选：adw_scan(self_check) → 报告 → 模型据此自查
```

关键点：

- 「自动遵循」不是 hook 强制，而是**上下文可用性**的结果：skill catalog 是 DSH 的 model-facing 机制，description 的触发词决定模型是否会加载；systemPrompt section 是兜底。
- 模型自查是可选的：如果每轮都强制 `adw_scan`，会拖慢生成；建议只在「用户要求检查」「改写收尾」「/adw scan」时调用。
- 规则注入的 token 预算是显式的：skill 正文约 1.5–2k token（仅加载时付），systemPrompt section 约 150–250 token（每轮付，可关）。

### 5.5 (d) 面板实时更新

```
session/event (user/message | assistant/message | tool/result | command/done)
        │
        ▼
ctx.sessionProjections 驱动 adwWriting.apply(state, event)
        │  无关事件 → 返回同一引用 → 零下游工作
        │  相关事件 → 新 state → wire.view(state) → viewSchema.parse
        ▼
onChanged(listener) 通知（只有 Object.is 变化才发）
        │
        ▼
Client slot hook context: useProjection('adwWriting')  → React re-render
        │
        ▼
writing-health tab（kind adw-writing-health，id dsh-adw）
  ①分数环 last.score  ②严重度徽章 last.high/medium/low
  ③最近统计 last.hits + scans  ④sparkline trend[]
  ⑤按规则条形图 byRule[]  ⑥改写前后 pairs[]  ⑦footer 免责文案
```

关键点（与 [notes/dashboard-design.md §2–§3](notes/dashboard-design.md) 一致）：

- **数据只来自 projection**：客户端不扫描任何文本、不自算指标，所有数字都能定位到 `adwWriting` 的某个字段。tab body 由 slot 注入的 hook context 提供 `sessionId`、`useProjection`、`t`，不自己 fetch。
- **fold 的四种输入**（`projection.js`）：`user/message` → 有界扫描后存为 `pendingBefore`（改写前的天然候选）；`tool/result`（仅 `adw_scan`）→ 读 `data.meta.value.result` 生成样本点并配对；`command/done`（仅 `/adw scan`）→ 从固定输出正则提取分数与计数；`assistant/message` → 有界重扫（`MAX_SCAN_CHARS = 20_000`，头尾各半）。其余事件一律返回原 state 引用。
- **保留上限**：`MAX_TURNS = 60`（sparkline 点数）、`MAX_BY_RULE = 12`（规则行）、`MAX_PAIRS = 8`（前后对比）、`MAX_HITS = 200`（单次内部扫描命中上限）、`MAX_PREVIEW = 160`（用户消息预览）、`MAX_SCAN_CHARS = 20_000`。会话再长，view 也是常数大小。
- **状态矩阵**（dashboard 笔记 §2.3）：no session → 不渲染；无 projection 或 `trend.length === 0` → 空态卡（**不显示一个 100 分**，避免"已经很好"的错觉）；`last.hits === 0` 且 trend 非空 → 正常渲染 + 绿色「干净」徽章；scan running 不加 spinner（毫秒级操作）；scan failed 只在命令输出区显示错误，面板保留上一次数据。
- **a11y / 暗色 / i18n**：分数环与 sparkline 都有 `role="img"` + `aria-label`；严重度同时用颜色与文字表达；所有颜色走 DSH design token（`--dsw-alias-*`），不硬编码背景；UI 文案全部走 `ctx.locale.register('dsh-anti-defensive-writing', { zh, en })` 的 key（`panel.*`、`settings.*`、`tab.*`），规则中文名属于**内容**而非 UI 文案。

### 5.6 (e) 跨会话趋势

```
Session A ── /adw scan ──► adw-scan-store (storageDomain 'adw', JSON)   ← M3
Session B ── /adw scan ──► adw-scan-store
Session C ── /adw scan ──► adw-scan-store
                              │
                              ▼
                 /api/adw/trend  (POST { range: '7d'|'30d'|'all', groupBy: 'day'|'file' })   ← M4
                              │
                              ▼
                 汇总页（conversation.view）：KPI 条 + 分数折线 + 按文件表 + 规则分布
```

关键点：

- **跨会话不能用 projection**：projection 是 per-session 的，会话结束后只作为一次扫描的样本进入持久化存储。趋势必须走 `ctx.storageDomain` + host query（M3/M4）。
- **storage 只存聚合值**（`score`、`counts`、`ruleIds`、`contentHash`、`path`、`timestamp`、`detectorVersion`），不存原文；趋势数据即使被导出也不泄露稿件。
- **可比性**：`detectorVersion` 随每个点记录；版本不同的点用不同颜色/虚线标注，**禁止混算平均**。汇总页的「平均分」只在同时显示样本数时出现（否则会诱导用户只扫好段落）。
- **虚荣指标隔离**（dashboard 笔记 §4.1）：`scans`（扫描次数）与 `summary.averageScore` 标为虚荣值，不进面板主视觉区；`summary.worstScore`、`pairs[].after − before`、严重度混合才是诊断值。

---

## 6. 插件身份与安装

### 6.1 包身份

| 字段 | 值 | 说明 |
|---|---|---|
| `name` | `dsh-anti-defensive-writing` | 与 DSH 第三方插件命名习惯一致（`dsh-context`、`dsh-context-length`、`dsh-right-click-menu`）。 |
| `version` | `0.1.0` | M0 起的开发版本；发布前按 semver。 |
| `type` | `module` | ESM。 |
| `main` / `exports["."]` | `./lib/index.js` | host half。 |
| `exports["./client"]` | `./lib/client.js` | client half，`dsh.client.platform: "web"` 时由 client-modules 加载。 |
| `license` | `MIT` | 我们的代码；上游内容另有 MIT 与 NOTICE。 |
| `engines.dsh` | `">=0.2.1-rc.2 <0.3.0-0"` | 以 0.2.1-rc.5 为验证基准；rc.2 起预计兼容，未逐版验证的要标 `compatible` 前先跑矩阵。 |
| `dsh.manifestVersion` | `1` | 公开 manifest 格式。 |
| `exports["./detector"]` | `./lib/detector.js` | 供 host 侧消费与测试复用 detector。 |
| `dsh.bundle.patch` | `"./cordis.patch.yml"` | 安装器据此自动挂载 bundle。 |
| `dsh.client.platform` | `"web"` | Web/Desktop 共用。 |
| `dsh.client.inject` | 见下 | 只列 client bundle 真正需要的宿主 client 包。 |

`dsh.client.inject` 建议列表：

```json
[
  "@deepseek-ai/dsh-api-remotes",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-sidebar-right"
]
```

说明：`dsh.client.inject` 只列**可注入的 client 包**；`react` / `react-dom` / `dsh-client-ui-primitives` 由 shell 的 shared module table 提供，不需要也不会列进去。`dsh.client.external` 仅在需要非基线模块时使用；本插件计划只用基线，因此省略。

`cordis.patch.yml`：

```yaml
# Bundle patch: one host row; the dsh.client declaration makes the web app
# load ./client.js as the browser half.
- insert:
    - id: anti-defensive-writing
      name: dsh-anti-defensive-writing
```

### 6.2 peerDependencies（建议）

```json
{
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.0.5",
    "@deepseek-ai/dsh-commands": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-session-projection": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-skill": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-system-prompt": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-tools": "^0.2.1-rc.2",
    "@deepseek-ai/schemastery": "~3.18.5"
  }
}
```

（与 `packages/plugin/package.json` 的实际声明一致；`@deepseek-ai/dsh-commands`、`@deepseek-ai/dsh-session-projection`、`@deepseek-ai/dsh-system-prompt` 标为 `peerDependenciesMeta.optional: true`，host 半用 `ctx.inject` 容忍缺失。`dsh-storage-domain` 只在 M3/M4 引入 scan-store 时才成为 peer。）

`react` / `react-dom` 作为可选 peer（与 `dsh-context` 的做法一致），避免客户端包在没有 React 的宿主里解析失败。

### 6.3 兼容性说明（DSH 0.2.1-rc.x）

- **已验证**：0.2.1-rc.5（本机 Desktop 运行时）。版本门只用 `engines.dsh`（0.2.1-rc.5 的 `dsh-app-boot` 在 `engines.dsh` 存在时单独据此判定）。**不要**依赖 `dsh.compatibility.dshReleases`：该字段在 0.2.1-rc.5 没有任何读取者（见 [notes/dsh-plugin-api.md §1](notes/dsh-plugin-api.md)）。
- **API 依赖的都是公开 seam**：`ctx.skills.registerProvider`、`ctx.tools.register`、`ctx.commands.register`、`ctx.sessionProjections.register`、`ctx.storageDomain`、`connection.fetch.register`、`ctx.systemPrompt.section`。不触碰 `lib/` 内部实现，不 patch loader。
- **client bundle 必须预构建**：host 通过 `/plugins` 服务 `lib/client.js`；源码启动不会自动构建 client bundle。发布包里必须包含构建产物，`package.json` 的 `files` 要显式列出 `lib/client.js`。
- **HMR**：client bundle 改动只有在 `pnpm run dev:web` 同时运行时才会热替换；否则需要刷新页面/重启 Desktop。Desktop 是 Electron-owned profile，不能假设 CLI 的 HMR 行为。
- **版本拒绝**：若 `engines.dsh` 不满足，DSH 的安装器会以 `incompatible-version` 拒绝；不要用 `allow-version` 绕过，除非明确接受风险。

### 6.4 Desktop profile 的安装路径（Electron-owned）

Desktop profile 位于 `~/.dsh/profiles/desktop/`，其 `package.json` 的 `dsh.profile.bundles` 是加载列表，`cordis.patch.yml` 是用户 patch 层。

**为什么不能用 `dsh plugin --profile desktop`**：`@deepseek-ai/dsh` 的 `bin.js` 第 36 行有硬编码守卫：

```js
if (profile.toLowerCase() === "desktop") program.error("error: profile \"desktop\" is managed exclusively by the Electron application");
```

所以 CLI 对 desktop profile 的插件管理会被直接拒绝。正确的安装方式有三条，按推荐顺序：

**方式 A：Desktop 内置「插件」页面（推荐给最终用户）**

1. 打开 Desktop → 侧边栏 **Plugins** → 搜索 `dsh-anti-defensive-writing` → Install。
2. 安装器读取 `dsh.bundle.patch`，自动把 bundle 加入 profile 并插入 loader row。
3. 重启 Desktop（或按提示刷新）→ 打开任意会话 → 右侧栏出现「写作健康」tab。

**方式 B：手动编辑 profile（推荐给本地开发/未发布版本）**

1. **完全退出 DeepSeek Harness Desktop**（不是关窗口；Electron 持有 profile 文件锁）。
2. 在 profile 目录安装包：
   ```sh
   cd ~/.dsh/profiles/desktop
   pnpm add dsh-anti-defensive-writing@0.1.0
   # 本地开发：
   # pnpm add link:/Users/yrh/WorkSpace/projects/anti-defensive-dsh
   ```
3. 编辑 `~/.dsh/profiles/desktop/package.json`，把包名加入 `dsh.profile.bundles` 数组（保持数组顺序即加载顺序，通常追加到末尾）：
   ```json
   "bundles": [
     "@deepseek-ai/dsh-base",
     "@deepseek-ai/dsh-web-app",
     "dsh-context",
     "dsh-anti-defensive-writing"
   ]
   ```
4. **不要**再往 `~/.dsh/profiles/desktop/cordis.patch.yml` 手动追加同名 insert 行：bundle 自身的 `cordis.patch.yml` 由 bundle 机制自动应用（`dsh-app-boot`），重复 id 会冲突。profile 的 `cordis.patch.yml` 只用于覆盖配置（如 `disabled: true` 或调整 Config 字段）。
5. 重新打开 Desktop。
6. 验证：
   - **Plugins** 页面能看到 `dsh-anti-defensive-writing`，且状态为 enabled；
   - 打开一个会话，右侧栏 tab 列表出现「写作健康 / Writing Health」；
   - 在会话里输入 `/adw rules`，应返回规则清单文本；
   - 设置 → Plugins → 该 bundle 的 Configuration 卡片出现 6 个配置项（`enabled`、`injectPrompt`、`tools`、`minSeverity`、`disabledRules`、`skillLanguage`）。

**方式 C：发布到 npm 后用 profile 页面安装**（与方式 A 相同，只是源是 registry）。

**排错顺序**：

1. bundle 不出现 → 检查 `package.json` 的 `dsh.bundle.patch` 路径是否存在、`dsh.profile.bundles` 是否包含包名；
2. 插件加载报错 → 看 Desktop 启动日志（`~/.dsh/logs/startup-*.log`）的 `plugin` 段落；
3. client tab 不出现 → 检查 `lib/client.js` 是否在发布包里、`dsh.client.platform` 是否为 `web`、`dsh.client.inject` 是否包含 `sidebar-right`；
4. `/adw` 命令不存在 → 检查 host 半是否成功 apply（`ctx.commands` 是否注入）。

### 6.5 依赖与构建

- 构建：**detector 无构建步骤**（plain ESM + JSDoc，`node --test` 直接跑）；`packages/plugin` 的 host 半（`lib/*.js`）也可直接用 ESM 发布，只有 client bundle 需要构建——用 `tsdown`（与 `dsh-context` 同款）或 `esbuild`，产物必须是 `window.__ModuleLoader__.load({ id, factory })` 形式（构建器负责，不手写）。
- 测试：detector 用 `node:test`（零依赖）；host 单测可用 `node:test`；E2E 用 `dsh --profile headless --json`。
- 不引入运行时依赖（除 peerDependencies 外）；detector 零依赖。
- 发布前 `pnpm pack --dry-run` 检查 `files` 是否包含 `lib/client.js`、`skills/**`、`prompts/**`、`LICENSE`、`LICENSE.upstream`、`NOTICE`。

---

## 7. 里程碑 M0–M4

每个里程碑都有**可运行的验收命令**，不是「看起来完成了」。

### M0：包骨架 + detector + 测试

| 项 | 内容 |
|---|---|
| 交付物 | `packages/detector/`（`index.js` + `lib/{scan,rules,lexicons}.js` + `test/scan.test.js`，plain ESM + JSDoc，**无构建步骤**）、`packages/plugin/` 骨架（`package.json`、`cordis.patch.yml`、`skills/`、`prompts/`、`LICENSE.upstream`、`NOTICE`、`MANIFEST.json`）、`scripts/sync-upstream.mjs --check`。 |
| 验收命令 | `node scripts/verify.mjs`（内部先跑 `scripts/sync-detector.mjs --check` 再跑 `node --test packages/detector/test/scan.test.js`）→ 25/25 通过；`node scripts/sync-upstream.mjs --check` → `vendored upstream content is intact (4 files at 82d31402caa0)`。 |
| 通过标准 | **已达成（DONE）**：detector 25/25；`report shape is stable` 与 `question-kind hits never carry replacement text` 两条契约测试绿；`--check` exit 0；CJK offset 测试 ≥3 例。 |
| **不在 M0** | 不注册任何 DSH 服务；没有 UI；没有 projection；没有 storage。 |

### M1：skill provider + tool + command（headless 可验证）

| 项 | 内容 |
|---|---|
| 交付物 | `packages/plugin/lib/{skill-provider,command,tool,index}.js`（`detector.js` 作为检测器的单一导入点）；`packages/plugin/cordis.patch.yml`；`package.json` 的 `dsh.bundle.patch`。 |
| 验收命令 | `node scripts/verify.mjs` → `plugin tests`（`packages/plugin/test/smoke.test.js`，18/18）、`integration tests`（`integration.test.js`，8/8）、`real registry mount`（`real-registry.test.js`，1/1）；`scripts/probe-profile.mjs` 把 bundle 组合进 scratch profile 并成功 import host entry。 |
| 通过标准 | **已达成（DONE）**：skill catalog 含 `anti-defensive-writing` 与 `anti-defensive-writing-en`；`adw_scan` 返回合法 JSON；`/adw rules` 返回 `kind: 'success'`；`/adw scan` 对越出 workspace 的路径返回错误而不是读取；`sessionsProjections`/`skills` 缺失时插件仍能降级加载。 |
| **不在 M1** | 没有 projection；没有侧边栏；没有 storage；没有 report route。 |

### M2：projections + 侧边栏 tab

| 项 | 内容 |
|---|---|
| 交付物 | `packages/plugin/lib/projection.js`（`adwWriting` unit，`stateVersion: 1`）、`packages/plugin/lib/client.js`（构建产物）、locale zh/en。 |
| 验收命令 | `node scripts/verify.mjs` → `client bundle tests`（`packages/plugin/test/client.test.js`，5/5）：在 sandbox 里加载 `window.__ModuleLoader__` bundle，断言 tab 类型注册、settings section 注册与渲染输出；projection 折叠由 `integration.test.js` 的 `the projection folds real scan output into a client-visible view` 覆盖。 |
| 通过标准 | **已达成（DONE）**：`adwWriting` view 通过 `viewSchema.parse`（8 个顶层键 + plain-JSON 递归校验）；空会话显示空态；禁用插件后 tab 不渲染；projection 缺失时面板不渲染。 |
| **不在 M2** | 没有 report 页面；没有跨会话趋势；没有 fetch route。（settings section 已在 v0.1 随 client bundle 一并交付，见 §4.2。） |

### M3：report 页面 + 持久化（设置页已在 M2 交付）

| 项 | 内容 |
|---|---|
| 交付物 | `packages/plugin/lib/client.js` 的 report 页面（`conversation.view`）、`/api/adw/report` fetch route、`adw-scan-store`（`ctx.storageDomain` 的 `adw` 域）。 |
| 验收命令 | `curl -s -X POST http://127.0.0.1:52709/api/adw/report -d '{"path":"docs/sample.md"}'`（需带 auth）→ `{"ok":true,"value":{...}}`；把 `minSeverity` 改为 `high`（`/adw scan --min-severity high` 或插件 Config）→ 只返回 high 命中；`node --test packages/plugin/test/report.test.js`。 |
| 通过标准 | route 对不存在文件返回 `{ok:false,error:{code:"not-found"}}`；同一文件同一内容重复扫描不新增存储记录；report 页面能按规则/严重度筛选并跳行。 |
| **不在 M3** | 没有趋势聚合（M4）；没有 i18n 全量；没有 upstream sync 自动化。 |

### M4：趋势 + 打磨 + 上游同步

| 项 | 内容 |
|---|---|
| 交付物 | `/api/adw/trend`、汇总页/趋势图、i18n 完整、a11y、`scripts/sync-upstream.mjs` 的 CI 集成、文档与 `PRIVACY.md`。 |
| 验收命令 | `node scripts/sync-upstream.mjs --check`；`node --test packages/detector/test/scan.test.js`（外加 plugin 的 node:test 文件）；seed storage fixture 后打开汇总页，7d/30d 切换正常；`node scripts/check-i18n.mjs`。 |
| 通过标准 | 所有测试绿；zh/en key 集合相等；趋势图在 0 数据时显示空态；`--check` 在 CI 中作为 required check。 |
| **不在 M4** | 不做模型自动改写整篇；不做云端同步；不做多人协作。 |

### 7.1 里程碑依赖图

```
M0 ──► M1 ──► M2 ──► M3 ──► M4
 │       │       │       │
 │       │       │       └─ 依赖 M2 的 projection 与 M1 的 scan
 │       │       └─ 依赖 M1 的 tool/command 与 M0 的 detector
 │       └─ 依赖 M0 的 detector 与 vendored skill
 └─ 独立可交付：detector 可单独发布/复用

M0、M1、M2 已在本仓库完成（`node scripts/verify.mjs` 全绿：detector 25 + plugin 18 + client 5 + integration 8 + real-registry 1）；M3/M4 为计划。
```

---

## 8. 风险与取舍

| 风险 | 表现 | 缓解 | 怎么知道它发生了（signal） |
|---|---|---|---|
| **检测误报** | 合法的学术表达被标为防御性写作（如 `only if`、`limited to`、必要的 limitation 声明） | negative corpus 覆盖每类反例；severity 分级；每条命中给「为什么」；用户可标记「这是必要声明」并加入本地豁免；默认不自动改写。 | negative corpus 的误报率 > 5%；面板「忽略」点击率 > 30%；用户反馈里出现具体误报句子。 |
| **用户不信任分数** | 「这个 62 分怎么来的？」「为什么昨天 70 今天 60？」 | 分数公式公开；面板同时显示计数与规则分布；分数不带等级（不出现 A/B/C）；趋势标注规则版本；提供「只看计数」模式。 | 设置中关闭分数显示的比例；报告页停留时长；「分数」相关反馈数量。 |
| **模型 overclaim** | 模型把「效果有限」改成「效果显著」，或删掉必要的 limitation | L3 只接受 `rewrite` 类建议；`question` 类必须问句；system prompt 明确「保留事实、数字、必要限定」；改写 diff 必须显示 before/after；用户可拒绝。 | 抽查改写接受率与人工复核；出现「新增数字/新增主张」的 diff 即视为 bug；用户把某条建议标为 overclaim。 |
| **client bundle 构建/HMR** | tab 不出现、旧代码不生效、刷新后错乱 | CI 构建 `lib/client.js` 并校验 `window.__ModuleLoader__.load` 包装；本地必须 `pnpm run dev:web` 才有 HMR；文档写清「改 client 需重建 + 刷新」。 | 启动日志出现 missing client bundle；开发者反馈「改了没生效」；`pnpm pack --dry-run` 缺 `lib/client.js`。 |
| **projection plain-JSON 约束** | `undefined`、Date、class 实例进入 wire → schema parse 失败或客户端崩溃 | 所有 projection 输出先经 `viewSchema.parse`（hand-written plain-JSON guard，检查 8 个顶层键 + 递归拒绝 `undefined`/函数/非有限数/非 plain object）；状态里只用 string/number/boolean/array/object/null；`stateVersion` 变更即 bump；测试覆盖空态与截断态。 | 运行时出现 `viewSchema.parse` 错误日志；客户端 tab 显示错误态；schema 测试失败。 |
| **上游漂移** | 上游改了规则/措辞，`skills/`/`prompts/` 与文档不一致 | pinned commit + `MANIFEST.json` + `sync-upstream.mjs --check`；升级 pin 走独立 PR + diff review；skill description 的触发词变更要在 PR 里说明。 | `--check` 失败；CI required check 红；用户反馈「规则和上游不一样」。 |
| **i18n 范围蔓延** | 只做了中文，英文界面出现中文；或规则词典中英混用 | i18n 字典 key parity 测试；detector 词典是**数据**，与 UI 语言解耦；先 zh/en 两套，其他语言留接口。 | `check-i18n` 失败；英文界面截图出现中文；用户报告。 |
| **性能/长文** | 扫描整篇论文卡住 UI；projection 每事件重扫 | `adw_scan` 的输入上限是 `MAX_INPUT_CHARS = 200_000`（detector 本身不做截断）；projection 对每条消息只扫 `MAX_SCAN_CHARS = 20_000`（头尾各半）并用 `maxHits: 200` 限制；report route 按需扫描并缓存 contentHash。 | 扫描耗时 > 200ms（本地）；面板输入卡顿；`truncated: true` 比例异常高。 |
| **隐私** | 稿件被发到外部服务 | L1 零网络；插件无 telemetry；fetch route 只服务本机 DSH client；`PRIVACY.md` 明确「不收集、不外发」。 | 网络抓包出现非 localhost 请求；依赖审计发现遥测包。 |

### 8.1 关键取舍（trade-off）记录

1. **规则宁可少一条，不可多一条误报**：每加一条规则都要有 ≥2 个 negative example；宁可漏报，不可让用户觉得「这也要管」。
2. **分数是诊断，不是目标**：不提供「满分攻略」；分数只用于趋势与定位问题。
3. **L1 与 L3 分离**：L1 不做语义改写，L3 不做测量；两者的接口是 `Report`，这样任何一层的实现替换都不会污染另一层。
4. **skill 内容原样 vendoring**：本地化/裁剪会破坏「遵守上游规则」的可验证性；需要适配就在 provider 层做。

---

## 9. 验收清单

审阅者可以按顺序跑：

### 9.1 合规

- [ ] `packages/plugin/LICENSE.upstream` 与上游 `LICENSE` 逐字一致（`diff` 为空）。
- [ ] `NOTICE` 含 `Copyright (c) 2026 Adkid-Zephyr`、仓库 URL、pinned commit `82d3140…`。
- [ ] `MANIFEST.json` 的每个 `sha256` 与文件实际值一致；`node scripts/sync-upstream.mjs --check` exit 0。
- [ ] 两份 `SKILL.md` 与上游对应文件逐字一致（`diff` 为空）。
- [ ] `package.json` 的 `files` 包含 `skills/**`、`prompts/**`、`LICENSE`、`LICENSE.upstream`、`NOTICE`。

### 9.2 detector

- [ ] `node scripts/verify.mjs` 全绿；其中 detector `packages/detector/test/scan.test.js` 25/25、plugin `smoke.test.js` 18/18、`client.test.js` 5/5、`integration.test.js` 8/8、`real-registry.test.js` 1/1。
- [ ] 上游 README 的 before/after 对照表中的 defensive 句子至少命中 2 条规则。
- [ ] 每个规则至少 2 个 negative example 通过（不命中）。
- [ ] CJK 文本的 `span.start/end` 能正确切回原文（`text.slice(start,end) === span.text`）。
- [ ] `report.version === 1`；`report shape is stable` 测试通过；`question` 类命中的 `suggestion.text` 缺省。
- [ ] `scan()` 对同一输入两次调用输出字节级一致（idempotence）。

### 9.3 host 半

- [ ] `node scripts/verify.mjs` 的 `plugin tests` / `integration tests` / `real registry mount` 三组全绿（18 + 8 + 1）。
- [ ] （可选，需真实 dsh CLI）`dsh --profile headless --json "用 adw_scan 扫描 <fixture> 并报告分数"` exit 0，且 stdout 含 `adw_scan` 的 tool_call 与合法 JSON tool_result。
- [ ] skill catalog 含 `anti-defensive-writing` 与 `anti-defensive-writing-en`，且 `modelInvocable === true`。
- [ ] `/adw rules` 返回规则清单；`/adw on|off` 返回 `kind: 'success'` 并提示「需重启会话生效」（v0.1 的 on/off 只提示，不热切换 systemPrompt section）。
- [ ] `adw_scan` 对不存在路径返回结构化错误，不抛未捕获异常。
- [ ] 不传 `text` 也不传 `path` 时返回参数错误。

### 9.4 projection / 客户端

- [ ] 空会话的 `adwWriting` view 有全部 8 个顶层键：`version`、`scans`、`turn`、`last`（含 `score: 100`、`source: 'none'`）、`byRule: []`、`trend: []`、`pairs: []`、`summary`；`viewSchema.parse` 通过。
- [ ] 有命中的会话：分数、计数、趋势与 fixture 预期一致。
- [ ] projection 对无关事件返回同一 state 引用（可用单测断言 `Object.is`）。
- [ ] 右侧栏 tab 在 1280px 与 800px 宽度下都不溢出（CSS 在 <320px 时 hero 换行）；空态/有数据/干净三态由 `client.test.js` 断言。
- [ ] 禁用插件后 tab 不渲染；重新启用后恢复。

### 9.5 安装

- [ ] `pnpm pack --dry-run` 的输出包含 `lib/client.js`、`lib/index.js`、`cordis.patch.yml`、`skills/**`、`prompts/**`、`LICENSE.upstream`、`NOTICE`。
- [ ] `node scripts/probe-profile.mjs` 能把 bundle 组合进 scratch DSH profile，且 host entry 可被 import（`node scripts/verify.mjs` 已覆盖）。
- [ ] 在干净的 desktop profile（复制一份）里按 §6.4 方式 B 安装，重启后 tab 出现。
- [ ] `dsh plugin --profile desktop add …` 如预期被拒绝，错误文本含 `managed exclusively by the Electron application`（用于确认我们没有依赖 CLI 路径）。
- [ ] 卸载后 profile 的 `package.json` 与 `cordis.patch.yml` 无残留。

### 9.6 文档

- [ ] 本文件与 [notes/dsh-plugin-api.md](notes/dsh-plugin-api.md)、[notes/detector-spec.md](notes/detector-spec.md)、[notes/dashboard-design.md](notes/dashboard-design.md) 的所有交叉引用可解析（文件存在）。
- [ ] 检测器规则 id、projection key、route 路径在四份文档中拼写一致。
- [ ] `PRIVACY.md` 明确「本地扫描、无遥测、无外发」。
- [ ] `README.md` 的安装步骤与 §6.4 一致。

---

## 附录 A：术语对照（codebase-design 词汇）

| 词 | 本设计中的用法 |
|---|---|
| module | 有 interface 与 implementation 的任何单元：detector、provider、tool、command、projection、tab。 |
| interface | 调用方必须知道的全部：签名、invariant、错误模式、性能特征。不只是 TypeScript 类型。 |
| implementation | module 内部实现；与 adapter 区分：adapter 描述角色（填哪个槽），implementation 描述内容。 |
| seam | 可以替换行为而不改调用点的地方；本设计三个关键 seam：detector 的 `scan()`、projection 的 `wire`、`ctx.skills` 的 provider。 |
| adapter | 满足某个 seam 的具体实现；本设计的 skill provider 是上游内容的 adapter。 |
| depth | interface 的杠杆率：调用方学一点接口，换来大量行为。detector 是深模块。 |
| leverage | 调用方从 depth 得到的东西：一个 `scan()` 服务六个调用方。 |
| locality | 维护者从 depth 得到的东西：改一条规则只动一个 package。 |

## 附录 B：已完成整合与已知取舍

三份专题笔记均已落地并整合进本稿（本稿是"为什么"，笔记是"具体到字段"）：

| 笔记 | 状态 | 整合进 DESIGN.md 的位置 |
|---|---|---|
| [notes/detector-spec.md](notes/detector-spec.md) | 已整合（v0.1 已实现，25 测试） | §3.1 规则表与评分公式、§4.2 detector 行、§5.2 tool result、§9.2 |
| [notes/dashboard-design.md](notes/dashboard-design.md) | 已整合（P1/P2 已实现；P3/P4 为 M3/M4） | §4.2 客户端行、§5.5、§5.6、§9.4 |
| [notes/dsh-plugin-api.md](notes/dsh-plugin-api.md) | 已整合（0.2.1-rc.5 实测） | §4.2 全部 interface、§6.1–§6.4 安装与兼容 |

**已知取舍（代码为准，笔记随之对齐）**：

1. **tab id 是 `dsh-adw`，不是 `anti-defensive-writing`**。理由：bundle id、settings section id 与 tab id 若同名会让读者/工具混淆；短 id 也与 `dsh-context` 的惯例一致。`kind` 仍是 `adw-writing-health`。
2. **settings section 用 `order: 12`**，紧跟「模型（10）」「上下文长度（11）」之后，让用户在同一区域找到写作相关设置。
3. **`adw-scan-store` 与 `/api/adw/*` 是 M3 设计，尚未实现**。本仓库当前只有 projection 读模型；不要按本稿去找这些文件。

**一处需要读者注意的口径差异（不是冲突）**：`dashboard-design.md` §6.1 写 `/adw scan` 的文件读取"不绕过 DSH 的沙箱策略"，而当前实现走 `workingDirectory` + `node:fs`（不经 `ctx.fs`），因此**不触发** DSH 的 fs 观察策略与版本守卫；边界检查由插件自己完成。这是 M0 阶段"零 DSH 依赖优先"的取舍，M3 若改走 `ctx.fs.readText` 即可对齐笔记原意。本稿 §5.3 已按实现记录。
