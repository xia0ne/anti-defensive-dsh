# anti-defensive-writing · 设计文档索引

`dsh-anti-defensive-writing` 的设计集。`DESIGN.md` 是主文档（为什么是这个形状），`notes/` 是三份专题笔记（具体到字段、代码与测试）。按下表顺序读。

## 阅读顺序

| # | 文档 | 一句话 | 读它的理由 |
|---|---|---|---|
| 0 | [USAGE.md](USAGE.md) | 怎么用：四种用法、命令语法、分数怎么读、**哪些情况故意不命中**、排错。 | 拿到插件先读这个，五分钟上手。 |
| 1 | [DESIGN.md](DESIGN.md) | 总体设计：产品定位、上游 MIT 合规、L1–L4 能力分层、模块与 seam、数据流、插件身份与安装、M0–M4 里程碑、风险、验收清单。 | 先建立「为什么」，再进入细节；所有专题笔记都受它约束。 |
| 2 | [notes/dsh-plugin-api.md](notes/dsh-plugin-api.md) | DSH 0.2.1-rc.x 的插件 API 合约：包形状、host 半、skill provider、tool、command、projection、fetch route、client bundle、UI seam、agent hook，附 gotchas 与已知缺口。 | 任何「插件怎么写」的问题以它为准；DESIGN §4/§6 的接口都从这里取证。 |
| 3 | [notes/detector-spec.md](notes/detector-spec.md) | 检测器规格：8 条规则的分类与反例、CN/EN 词典、section 感知、评分公式、`Report` JSON schema、truthfulness guard、25 个测试。 | 任何「什么算防御性写作、怎么打分」的问题以它为准；对应 DESIGN §3.1/§5.2。 |
| 4 | [notes/dashboard-design.md](notes/dashboard-design.md) | 统计面板设计：4 个表面（侧边栏 tab / 设置页 / 报告页 / 汇总页）、widget 规格与状态矩阵、`adwWriting` 数据模型、指标公式、5 张 ASCII 线框、命令面、a11y/暗色/i18n、MVP 切割线。 | 任何「面板长什么样、显示什么数字」的问题以它为准；对应 DESIGN §4.2/§5.5–§5.6。 |

## 快速导航

- 想知道**插件能不能做** → [DESIGN.md §3](DESIGN.md#3-能力分层为什么是-l1l4) + [notes/dsh-plugin-api.md](notes/dsh-plugin-api.md) 的 §11 Gotchas。
- 想改**检测规则** → [notes/detector-spec.md](notes/detector-spec.md)；改完跑 `node scripts/verify.mjs`。
- 想改**面板** → [notes/dashboard-design.md](notes/dashboard-design.md)；projection 字段以它为准，不要另起一套。
- 想**安装/发布** → [DESIGN.md §6](DESIGN.md#6-插件身份与安装)。

## 当前状态（v0.1）

- **已实现并验证**：detector（25 测试）、host 半 skill provider / `/adw` / `adw_scan` / systemPrompt section（18 测试）、`adwWriting` projection、侧边栏「写作健康」tab、设置页「反防御性写作」、中英 i18n（client 5 测试）、整合 8 测试、真实 SkillRegistry 挂载 1 测试。一条命令：`node scripts/verify.mjs`。
- **计划中**：M3 报告页 + `adw-scan-store` + `/api/adw/report`；M4 趋势汇总 + `/api/adw/trend`。
- 已知取舍记录在 [DESIGN.md 附录 B](DESIGN.md#附录-b已完成整合与已知取舍)。

## 约定

- `DESIGN.md` 与 `notes/` 用中文散文、英文标识符。
- 上游 vendored 内容在 `packages/plugin/skills/` 与 `packages/plugin/prompts/`（逐字复制，MIT；见 `packages/plugin/LICENSE.upstream`、`NOTICE`、`MANIFEST.json`）。
- 四份文档之间的交叉引用必须可解析；若发现冲突，在 DESIGN.md 附录 B 记录「冲突点 / 采用哪份 / 理由」，不静默选择。
