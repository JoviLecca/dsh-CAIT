# CAIT v1.1.4–v1.1.7 路线图：从第一稿到交付

> 状态：**1.1.4 已实现（2026-11-08），1.1.5 主体已实现（2026-11-08），1.1.6 主体已实现（2026-11-09），1.1.7 已规划**
> 基线：`v1.1.3`（`main`）→ `v1.1.4`
> 使用者：作者本人 + agent
> 原则：不按时间盒砍范围；每版一个主题；数据模型一次只动一层；每版可独立发布、独立回滚
> 开工方式：1.1.4 已按本文拆分实现；后续版本开工前再拆 `docs/REQUIREMENTS-1.1.x.md`

## 一句话

| 版本 | 主题 | 一句话 |
| --- | --- | --- |
| `1.1.4` | 第一稿值得少改 | agent 带着 brief 和上下文翻译，人只改值得改的 |
| `1.1.5` | 交得出去 | 资源不串、成本算得清、客户和外部译者接得住 |
| `1.1.6` | 审校工作台与术语发现 | 找得到、改得动、留得下、退得回、术语找得准 |
| `1.1.7` | 格式与本地化 | 真实文件里的表格、字符串、备注、字幕都能进 |

## 为什么是这个顺序

`1.1.0` 解决了「有没有第一稿」，`1.1.3` 解决了「记忆从哪来、agent 怎么提建议」。但 MT 仍然是逐句、无上下文，审校仍然没有「先看哪句」的抓手。所以先把第一稿质量补上，再谈交付和工作台。

四步之间有依赖，不是四个平行的功能包：

1. **1.1.4 先补第一稿**：brief 和上下文是后面所有 AI 能力的公共输入；稳定 `uid` 是 1.1.5 审校包和 1.1.6 合并拆分的前提。
2. **1.1.5 再补交付**：第一稿够用后，瓶颈转到「多客户串库、报不了价、客户接不住」。每文档资源也依赖 1.1.4 的 brief 语义。
3. **1.1.6 再补工作台**：交付跑通后，日常最大的摩擦是编辑器基本功——切分错了改不了、找词靠肉眼、改错不能撤销；术语提取也从「数频次」升级为「找专名」。术语发现和 LLM 审校共用结构化输出与证据链，放在同一版做，不另开版本。
4. **1.1.7 最后补格式**：格式是人群放大器，但每个格式都要动解析/回填层，放在工作台稳定之后做，返工最少。

## 版本总表

| 版本 | 主要交付 | 数据模型 |
| --- | --- | --- |
| `1.1.4` | 文档 brief、上下文工具、上下文 MT、批量 MT、术语约束闭环、风险标记、撤销确认/重开、QA 面板、Concordance | `STORE_VERSION` 4 → 5：`doc.brief`、`segment.uid` |
| `1.1.5` | 每文档绑定 TM/术语库、字数与匹配率分析、双语 DOCX、XLIFF 审校包往返、TM 维护 | 5 → 6：`doc.tmIds`、`doc.glossaryIds`、`doc.defaultWriteTmId` |
| `1.1.6` | 查找替换、合并/拆分/锁定句段、快捷键/命令面板、句段备注、本地撤销、术语提取重做、LLM 审校 pass | 6 → 7：`segment.notes`、`segment.locked` |
| `1.1.7` | DOCX 表格/页眉/脚注、本地化字符串格式、PPTX notes / XLSX、字幕时间轴 | 不升版本；扩展 `cleanSegmentMeta` / `cleanFormatMeta` 白名单 |

---

## 1.1.4 第一稿值得少改

### 现状与缺口

| 事实 | 位置 |
| --- | --- |
| `mtSuggest` 只发当前句 + 挂载术语命中，没有邻句、段落、文档 brief | `lib/store.js:642`，prompt 在 `:705-720` |
| 预翻译逐段调用，块内并发 2；3000 段 = 3000 次请求 | `lib/pre-translate.js:111-144` |
| 术语只查「源文含术语、译文没出现」；不查禁用词/用错术语 | `lib/qa.js:118-127` |
| 确认不可逆：`adoptSuggestion` 报「请先撤销确认」，但全库没有 unconfirm | `lib/store.js:402` |
| 编辑已确认句段后 Ctrl+S 只改 target，不写 TM | `lib/store.js:377` |
| 审校没有风险分级；只有当前草稿 charCount | `client/components.js:725` |

### 范围

| # | 交付 | 关键设计 | 验收 |
| --- | --- | --- | --- |
| 1.4.1 | 文档 brief | `doc.brief = { domain, audience, tone, notes, doNotTranslate, styleSample }`；不含 `client`/`deadline`（项目/文档元数据，1.1.5 再考虑）；文档头可编辑；agent 可读写；prompt 注入有字符上限 | 新建文档可填可跳过；旧文档为空；agent 读到同一份 brief |
| 1.4.2 | 上下文工具 | `cat_get_context({ documentId, index, before, after })` 返回邻句、段落、标题、brief；只读 | agent 不逐段 `cat_get_segment` 也能拿到上下文 |
| 1.4.3 | 上下文 MT | `mtSuggest` 增加 `context` 参数；prompt = brief + 前后各 1 句 + 段落标题 + 术语；超预算自动裁剪 | 同一篇文档 A/B，人工改动量下降 |
| 1.4.4 | 批量 MT | 8–16 段一请求，按段落分组；返回 JSON 或编号；解析失败整批降级单段 | 对齐成功率 ≥95%；成本/时延下降 |
| 1.4.5 | 术语约束闭环 | 术语条目可选 `forbidden` / `preferred`；`preferred` 承担“必须使用”语义；prompt 写 must / do-not；译后校验；一次修复重试 | 禁用词不出现；必用词出现；不无限重试 |
| 1.4.6 | 风险标记 | 复用 QA + 长度比 + 源文残留 + 空译；每段 high / medium / low；rail 可筛「重点审」；不落盘 | 3000 字文档能一眼看到高风险句 |
| 1.4.7 | 撤销确认/重开 | `unconfirmSegment`；清 `confirmedAt`，状态回 `translated`；编辑已确认句段自动降级；TM 保留旧值直到再次确认 | 点错可退回；不会出现「confirmed 但 TM 是旧译」 |
| 1.4.8 | QA 面板 | 列表、按 code/severity 筛、跳转、一键修（插入术语/复制源文/清空）；修复走现有 `saveDraft` | 每个问题都能定位并处理 |
| 1.4.9 | Concordance | `lookupConcordance` 查 TM 源/译；子串 + 词匹配；带上下文；跳句段 | 选中词能查到历史译法 |

### 顺序与决策点

1. **1.4.7** 先做。半天，修数据一致性，任何包都该带。
2. **1.4.1 + 1.4.2**。brief 和上下文工具是后面所有 AI 能力的公共底座。
3. **1.4.3**。先做单段上下文 MT，不上批量，方便 A/B。
4. **1.4.5**。术语约束接在 MT 后面，改 prompt + QA，不另起炉灶。
5. **1.4.6 + 1.4.8**。风险标记和 QA 面板一起做，形成「先看哪」的闭环。
6. **1.4.4 + 1.4.9**。批量 MT 和 Concordance 放尾部，前者有对齐风险，后者可独立。

**第 5 个工作日的决策点**：拿一篇真实 3000 字文档，比较「单句 MT」和「上下文 MT」预翻译后的人工改动量（改字符数、改句数、确认前修改次数）。如果没有明显下降，说明瓶颈在术语/风格而不是上下文，转去做 1.4.5 + 1.4.6，别继续加 prompt。

**批量 MT 的决策点**：返回对齐成功率低于 95%，1.1.4 只发单段上下文版，批量顺延到 1.1.4.x 补丁或 1.1.6，不硬上。

### 数据模型与迁移

- `doc.brief`：文档级对象，缺省为空；不参与 `documentFingerprint`。
- `segment.uid`：稳定的段标识。现在 `id` 是 `s${index + 1}`（`lib/store.js:259`），一旦插入/删除/合并就会漂；1.1.5 的 XLIFF 审校包和 1.1.6 的合并/拆分都需要稳定标识。`uid` 只做内部/外部引用，UI 仍用 `id`。
- `STORE_VERSION` 4 → 5。迁移：旧快照的每个 segment 补 `uid`，`doc.brief` 补空；不改 source/target/status；补 v4→v5 迁移测试。
- 术语条目的 `forbidden` / `preferred` 是可选字段，老数据按 `false` 处理；不单独升 store 版本。`required` 不另设字段，用 `preferred` + QA 表达“必须使用”。
- 风险标记按需计算，不落盘，避免快照膨胀和标记过期。
- **撤销确认的 TM 策略**：只清 `confirmedAt`、状态回 `translated`，不删除已写入的 TM 条目。这样不会误删其他句段共享的条目；用户重新确认时 `upsertTM` 覆盖旧值。这个取舍写进 README 已知限制，避免以后误以为 TM 会回滚。

### 验收标准

一篇真实 3000 字文档（DOCX 或 Markdown）：

1. 填 brief → 预翻译 → 风险标记 → 按「重点审」筛选 → 改几句 → 撤销一次确认 → 重新确认 → 导出，全程不碰终端。
2. 上下文 MT 与单句 MT 的 A/B 记录（改动字符数/句数）能看出差异；看不出就按决策点转项。
3. 术语库设一个禁用词、一个必用词，预翻译结果通过校验；故意改错能报出来。
4. QA 面板能跳到问题句并一键修；Concordance 能查到同词的历史译法。
5. `node _dev/test-*.mjs` 全绿，新增 context/brief/risk/unconfirm/concordance 测试。

### 这一版不混进来

- LLM 审校 pass（放 1.1.6）。
- 每文档绑定 TM/术语库（放 1.1.5；1.1.4 仍用全局挂载）。
- 合并/拆分/锁定（放 1.1.6）。
- 格式扩展（放 1.1.7）。
- 语义/向量 TM（仍不做）。

### 实现状态（2026-11-08）

已完成：

- 1.4.1 文档 brief（六字段、UI、API、`cat_get_brief`/`cat_set_brief`、prompt 注入）。
- 1.4.2 上下文工具（brief、当前句、前后各最多 5 句、段落信息；`cat_get_context`）。
- 1.4.3 上下文 MT（`mtSuggest` 自动带 brief + 前后各 1 句，未改成显式 `context` 参数）。
- 1.4.4 批量 MT（每请求最多 8 段，按位置返回 JSON，缺失逐段回退；未做到 16 段）。
- 1.4.5 术语约束（`forbidden`/`preferred` 进入术语条目、prompt、QA、CSV/JSON/TBX；**未做**自动修复重试）。
- 1.4.6 风险标记（high/medium/low、rail 风险筛选、`LENGTH_DRIFT`/`TERM_FORBIDDEN`）。
- 1.4.7 撤销确认 + 编辑已确认句段自动降级；TM 不回滚，重确认覆盖。
- 1.4.8 QA 面板（列表、跳转、复制源文/清空/插入术语；**未做**按 code/severity 筛选）。
- 1.4.9 Concordance（TM 源/译检索、上下文；**未做**跳句段，当前是把结果写入草稿）。

待真实文档验证：上下文 MT 与单句 MT 的 A/B（改动字符数/句数）。这是发布前唯一需要外部输入才能完成的验收项。

测试：`_dev/test-*.mjs` 30 套全绿；新增 `test-brief.mjs` 覆盖 uid、brief、context、unconfirm、编辑已确认降级、concordance、v4→v5 迁移。

---

## 1.1.5 交得出去

### 现状与缺口

| 事实 | 位置 |
| --- | --- |
| TM/术语库全局挂载，没有项目/客户绑定 | `lib/store.js:163` |
| 文档只有单一 `targetLang`，没有资源字段 | `lib/store.js:292-304` |
| 导出只有 target-txt/source-txt/target-md/bilingual-md/bilingual-csv/tmx/document-json | `lib/import-export.js:418`，bilingual-csv 在 `:663` |
| 没有字数/匹配率分析；进度只有 confirmed/total | `client/components.js:725` |
| TM 只有单条改/删，没有合并/去重/按条件清理 | `lib/tm.js:84` |

### 范围

| # | 交付 | 关键设计 | 验收 |
| --- | --- | --- | --- |
| 1.5.1 | 每文档绑定 TM/术语库 | `doc.tmIds` / `doc.glossaryIds` / `doc.defaultWriteTmId`；`null` = 继承全局挂载；预翻译、TM 查询、术语查询、确认写库都走文档绑定 | 两个客户文档各绑各的库，互不串 |
| 1.5.2 | 字数与匹配率分析 | `analyzeDocument` 返回字数/字符/句段/重复句；TM 分段：ICE/context、exact、85–99、70–84、new；导出 CSV/JSON | 数字与人工抽查一致 |
| 1.5.3 | 双语 DOCX 审校稿 | 新导出格式 `bilingual-docx`；两列表格（原文/译文，状态可选）；复用 `lib/docx.js` 的 `writeZip`，写最小 OOXML | Word 打开正常；长文不崩 |
| 1.5.4 | XLIFF 审校包往返 | 先 1.2，带 `state`、`note`、`x-cait-uid`；回填只更新现有文档，按 uid 映射；未知 uid 跳过并报告 | 外部改 10 段，回填 10 段，状态正确 |
| 1.5.5 | TM 维护 | 合并两个库、库内去重、按条件清理（语言对/源文子串/空译文）；删除前预览 + 备份 | 合并后无重复；挂载引用不悬空 |

### 顺序与决策点

1. **1.5.1** 先做。数据模型 + 迁移 + UI 选择器，是后面所有「按项目」能力的地基。
2. **1.5.2**。不依赖模型，先给一个能报价的数字。
3. **1.5.5**。TM 维护依赖稳定 id，放模型之后。
4. **1.5.3**。双语 DOCX 需要新的 DOCX 写入能力，单独验证。
5. **1.5.4**。XLIFF 往返风险最高，放最后。

**决策点**：1.5.1 做完先跑「两个客户」场景。如果 `null = 继承全局` 让用户困惑，就改成「文档必须显式选库，旧文档首次打开时把当前全局挂载固化为文档绑定」；不要两套语义并存。

**XLIFF 版本已定**：1.1.5 先做 1.2；2.0 后置，单独开关，不混解析器。理由见文末第 4 条。

### 数据模型与迁移

- `STORE_VERSION` 5 → 6：`doc.tmIds`、`doc.glossaryIds`、`doc.defaultWriteTmId`。
- `null` / 缺省 = 继承全局挂载，保证旧文档行为不变；显式空数组 = 不挂任何库，用于「这个文档不写 TM」。
- 写库目标：`defaultWriteTmId` 优先；为空时取文档绑定的第一个 TM；再为空取全局第一个；都没有则报错，不静默丢译文。
- `documentFingerprint` 不含这些字段；切换绑定不会导致文档被判定为「新文档」。
- XLIFF 导出用 `segment.uid`，不用 index-based `id`；导出文件带 `doc.fingerprint`，回填时校验文档身份。

### 验收标准

1. 建两个 TM 库、两个术语库，两个文档各绑一套；预翻译和确认写库不串。
2. 3000 字文档的分析结果能导出 CSV；ICE/exact/fuzzy/new 的句数加起来等于总句数。
3. 双语 DOCX 在 Word 里能打开，原文/译文列对齐，长文不崩。
4. 导出一份 XLIFF，手工改 10 段译文和 2 条 note，回填后只有这 10 段变化，note 保留。
5. 合并两个有重复条目的 TM，合并结果无重复，挂载引用仍有效。
6. 全部迁移测试 + `_dev/test-*.mjs` 全绿。

### 实现状态（2026-11-08）

- **1.5.1 已完成**：文档资源绑定、`null` 继承、显式空数组、`NO_TM_BOUND` / `TM_NOT_MOUNTED` / `TM_NOT_BOUND`、删除库清理悬空引用、v5→v6 迁移、资源选择器 UI。
- **1.5.2 已完成**：`analyzeDocument`、ICE/exact/模糊/新增分桶、match rate/leverage、分析与 CSV/JSON 下载 UI。
- **1.5.3 已完成**：`bilingual-docx` 三列表格导出，ExportModal 入口，Word 可打开。
- **1.5.4 主体完成**：XLIFF 1.2 审校包导出（`x-cait-uid`、target `state`、note）与回填（uid / XLIFF id / 唯一源文匹配，源文不一致拒绝，报告未匹配）；未做文档 fingerprint 校验，也未保留外部修改的 note（当前 segment 没有 note 模型，1.1.6 再补）。
- **1.5.5 后端/API/UI 完成**：merge/dedupe/prune 预览与确认、备份字段、测试；库面板提供去重与清理空译文入口，合并仍走 API/agent。
- 全量 36 套 `_dev/test-*.mjs` 通过；`client.js` 已重建。

### 风险与后续

- 1.5.4 的 fingerprint/note 往返，作为 1.1.5 发布前的收尾项；不改变上面的数据模型。
- 1.5.4 第一版只承诺「结构未变的往返」；外部工具重排 trans-unit 时只按 uid/源文报告，不猜测。

---

## 1.1.6 审校工作台与术语发现

### 现状与缺口

| 事实 | 位置 |
| --- | --- |
| 只有 3 个快捷键：Ctrl+Enter 确认、Ctrl+S 保存、Alt+↑/↓ 上下段 | `client/components.js:741` |
| 没有查找替换、命令面板、撤销栈 | 同上 |
| 没有编辑器级合并/拆分/锁定；`align.merge` 只用于对齐行 | `client/locales.js:348` |
| 没有句段备注/评论 | `client/locales.js` 没有句段备注/评论的 UI 文案键 |
| 没有 LLM 审校 pass | `lib/qa.js` 只有机械检查 |
| 术语提取只按频次/边界熵，默认 `minCount=2`；单次出现的专名被丢掉，虚构作品的人名/地名/造物名提不到，常用词反而占满候选 | `lib/term-extract.js`、`lib/terms.js:25` |

### 范围

| # | 交付 | 关键设计 | 验收 |
| --- | --- | --- | --- |
| 1.6.1 | 查找替换 | 源/译/两者；大小写/正则；预览命中与逐段 diff；RPC 批量应用；可撤销上一次替换 | 替换 100 处可预览、可回退 |
| 1.6.2 | 合并/拆分/锁定 | 相邻合并；按句/光标拆；锁定禁止 MT/替换/编辑；导出映射 | TXT/MD 先通过；DOCX/EPUB 再验 |
| 1.6.3 | 快捷键/命令面板 | Ctrl+F/H/Z/Y/Shift+F/K；与宿主快捷键冲突检查 | 常用操作不用鼠标 |
| 1.6.4 | 句段备注 | `segment.notes[]`；单用户 + agent；resolve/unresolve；UI 侧栏；`cat_add_note` / `cat_get_notes` | 备注不丢、不串段 |
| 1.6.5 | 本地撤销 | 目标文本编辑 + 替换的 undo/redo；确认/撤销确认走逆 RPC；不做持久历史 | Ctrl+Z 行为可预期 |
| 1.6.6 | 术语提取重做 | 候选不再以频次为门槛：专名、引号内术语、大写复合词、中文人名/地名/造物名，单次出现也进候选；LLM 按 brief 与上下文判定 termhood、type、confidence、evidence；TM/术语库只给译法建议；按类型筛选；默认不自动入库 | 单次出现的虚构专名能进候选；常用词不淹没列表；候选可解释、可拒绝 |
| 1.6.7 | LLM 审校 pass | 结构化 issue（code/severity/message/suggestion）；按块 opt-in；结果进 QA 面板；不落盘 | 50 段审校可用；成本可见 |

### 顺序与决策点

1. **1.6.1** 查找替换。高频、无模型改动，先做。
2. **1.6.3** 快捷键/命令面板。便宜，放大 1.6.1 的收益。
3. **1.6.4 + 1.6.5** 备注与撤销。模型 + UX 一起做。
4. **1.6.2** 合并/拆分/锁定。风险最高，放中段，留出验证时间。
5. **1.6.6** 术语提取。先做候选生成，再接 LLM 判定；它决定「审校前有没有术语可守」，比 LLM 审校更靠前。
6. **1.6.7** LLM 审校。实验性质，放最后，不阻塞发布。

**1.6.6 的做法**：不再用 `minCount` 当门槛。候选生成保留单次出现的专名、引号内术语、大写复合词、中文人名/地名/造物名；LLM 只对候选做判定，不要求它从全文里「找词」。输出 `{term, type, confidence, evidenceIndex}`，`evidenceIndex` 必须指向原句；没有证据的候选直接丢弃。类型先分 `person/place/org/artifact/tech/concept/other`，UI 可按类型筛。TM/术语库只提供译法建议，不自动写入。没有可用 LLM 路由时退回启发式候选，功能不阻塞。

**术语提取的决策门**：如果 LLM 判定在虚构样本上把常用词也大量标成术语，先收紧类型与置信度阈值，不急着扩候选；如果单次专名的召回仍低于 70%，说明候选生成漏了，先补启发式（引号、书名号、对话标签、重复出现的命名模式），不要只靠模型。

**合并/拆分的决策门**：先在 TXT/MD 上原型，导出后对比段数/文本；再验 DOCX/EPUB。如果 Office 的导出映射不成立，1.1.6 先覆盖纯文本类格式，Office 的映射和 1.1.7 的格式层一起做。这不是砍需求，是把格式耦合留给格式版本。

### 数据模型与迁移

- `STORE_VERSION` 6 → 7：`segment.notes`（数组，缺省空）、`segment.locked`（布尔，缺省 false）。
- 合并：两个相邻段变成一个，生成新 `uid`，旧 uid 记入 `meta.mergedFrom`；拆分：生成新 uid，`meta.splitFrom` 记来源。
- 合并/拆分禁止跨段落、跨锁定/非译边界。XLIFF 导出默认用新 uid；只有勾选“反映切分变化”时才派生 `old-1`/`old-2`/`old1-old2` 之类的外部 id；外部引用失效只报告并让用户手动映射，不猜。
- 备注是单用户线程，不做角色/审批；agent 写入的备注标 `author: 'agent'`。
- 术语候选不落盘；`termCandidates` 输出扩展 `type` / `confidence` / `evidenceIndex`，保留 `term` / `count` / `examples` / `inLibrary` / `evidence` 旧字段；不因术语提取再升 `STORE_VERSION`。
- 撤销栈只在客户端内存，不落盘；关掉面板后不保证恢复。持久编辑历史留到以后。

### 验收标准

1. 3000 字文档里把「按钮」替换成「按键」，预览 37 处，应用后 Ctrl+Z 能整体回退。
2. 合并两句、拆一句、锁定一段；导出 Markdown 和 DOCX，文本与段数符合预期；锁定段不被预翻译覆盖。
3. 给 5 段加备注，刷新后仍在；agent 能读到并追加。
4. 3000 字虚构片段人工标 20 个单次专名，至少 16 个进候选，常用词候选不超过 10 个；每个候选带原句证据；不自动入库。
5. 50 段跑一次 LLM 审校，问题进 QA 面板，能跳转；不产生无法关闭的阻塞。
6. 快捷键不与 DSH 冲突；命令面板能搜到上述动作。
7. `_dev/test-*.mjs` 全绿。

### 风险

- 合并/拆分与导出映射是最大风险；决策门不过就只覆盖纯文本类。
- 撤销的边界容易失控：只承诺文本编辑和替换，不承诺任意状态回滚。
- 术语提取的 LLM 误判会制造假专名；候选必须带原句证据、默认不自动入库，低置信度只展示不预选。
- 术语提取的成本与隐私：只发候选上下文，不发全文；按文档指纹缓存；没有 LLM 路由时退回启发式。
- LLM 审校误报会消耗信任；默认关闭，结果只作建议。

---

### 实现状态（2026-11-09）

- **1.6.1 查找替换完成**：`replaceInDocument` 预览/应用/撤销，确认句段被改后回到待审，TM 保留旧值；`ReplaceModal` + `Ctrl/Cmd+F`。
- **1.6.3 快捷键/命令面板完成**：`Ctrl/Cmd+K` 打开命令面板，覆盖新建、导入、导出、预翻译、替换、brief、资源、分析、清理预翻译、备注、AI 审校、文档/库/对齐/设置。
- **1.6.4 句段备注完成**：store v7 的 `segment.notes`，增改删与迁移测试；备注入口在句段头。
- **1.6.5 本地撤销完成**：句段内草稿 undo/redo（650ms 合并、200 步）；替换自身有 undo；未做“确认逆操作”这类跨状态回滚。
- **1.6.2 合并/拆分/锁定完成（文本格式）**：合并/拆分只覆盖 TXT/Markdown，Office 段落映射未做；锁定阻止编辑、确认、替换、预翻译、传播和清理。
- **1.6.6 术语提取重做（启发式）**：单次专名、引号术语、大写复合词、中文对话动词前专名进入候选，带类型/置信度/证据；普通 n-gram 仍要求重复。模型判定尚未接入。
- **1.6.7 LLM 审校（后端/UI/工具）**：`reviewDocument` + `cat_review`，QA 标签页可运行、跳转、填入建议；默认不写文档；需要可用 DSH 模型路由。
- 全量 41 套 `_dev/test-*.mjs` 通过；`client.js` 已重建。
- 未做：术语候选的模型判定、Office 合并/拆分、确认逆操作；`1.1.7` 未开工。


### 现状与缺口

| 事实 | 位置 |
| --- | --- |
| DOCX 导入跳过表格、页眉、脚注、域、替代文字、修订删除；导出保留源文 | README *Known limits* |
| 没有本地化字符串格式；只有文件级 JSON/PO/XLIFF/CSV 等 | `lib/formats.js` |
| PPTX 只有正文，没有 notes；XLSX 只有两列，无样式/多表 | README *Known limits* |
| SRT/VTT 可导入导出，但没有时间轴编辑 | `lib/formats.js` |
| `cleanSegmentMeta` 已有 `identifier`/`msgidPlural`/`plural`/`plurals`/`comments`，可承载本地化元数据 | `lib/store-utils.js` |

### 范围

| # | 交付 | 关键设计 | 验收 |
| --- | --- | --- | --- |
| 1.7.1 | DOCX 表格/页眉/脚注 | 解析为段，`meta` 记录 `docxPart`/`table`/`row`/`cell`；回填到对应 XML 位置；不支持区域保留源文 | 真实 DOCX 的表格、页眉往返 |
| 1.7.2 | 本地化字符串 | `.strings`/`.stringsdict`、Android `strings.xml`、`.resx`、`.arb`、YAML/properties；key、复数、ICU、comment | 每种格式导入导出不丢 key/复数 |
| 1.7.3 | PPTX notes / XLSX | notes 正文可译；XLSX 多表 + 基础样式；不追求完整样式还原 | notes 可译；多表不串 |
| 1.7.4 | 字幕时间轴 | cue 合并/拆分/平移；重叠警告；SRT/VTT | 时间码不漂移 |

### 顺序与决策点

已定顺序：**DOCX 表格/页眉/脚注 → Apple/Android 字符串 → 字幕 → PPTX/XLSX**。前两个是 1.1.7 的必做项；1.7.2 内的 `.resx`/`.arb`/YAML/properties 跟在 Apple/Android 之后；PPTX/XLSX 放最后。

**真实文件的作用**：如果主要文件是字幕，可以把 1.7.4 提到 1.7.3 前面；但 DOCX 和 strings 不后置。这版的目标是补两个最大人群的深度，不是把格式表再铺宽一层。

### 数据模型

- 不升 `STORE_VERSION`；扩展 `cleanSegmentMeta` 白名单：`docxPart`、`table`、`row`、`cell`、`sheet`、`keyPath`、`icuType` 等，全部可选。
- 文件级信息放 `formatMeta`（编码、sheet 列表、strings 方言），扩展 `cleanFormatMeta` 白名单。
- 注意：`documentFingerprint` 包含 `meta`，新增 meta 字段会让「同文件重新导入」的指纹变化；旧文档不受影响，新导入可能不再复用旧文档。这是可接受的，写进已知限制。

### 验收标准

1. 一份带表格、页眉、脚注的 DOCX：导入 → 翻译 → 导出，表格/页眉/脚注位置正确，未支持区域保留源文。
2. 一组 `.strings` + `.stringsdict`、一份 Android `strings.xml`：导入导出后 key、复数、注释不丢。
3. 一份 PPTX notes、一份多 sheet XLSX：notes 可译，多表不串。
4. 一份 SRT：合并两条 cue、拆分一条、整体平移 1 秒，导出后时间码正确、无重叠。
5. 每种格式至少一个 fixture 测试；`_dev/test-*.mjs` 全绿。

### 风险

- DOCX 的 XML 命名空间、关系、part 路径比现有正文解析复杂；先做表格/页眉，脚注最后。
- `.strings` 可能是 UTF-16；编码检测要先做。
- 复数/ICU 语义容易只做「看起来对」；至少覆盖 zero/one/other 和占位符。
- 字幕重叠是产品问题不是解析问题；先警告，不自动改时间。

---

## 跨版本工程约束

1. **每版只升一次 `STORE_VERSION`**，迁移测试覆盖从 v4 一路读到当前版本；旧快照能读、译文不丢。
2. **每个新 RPC 都进 `lib/api.js` 白名单**；读写分开，破坏性操作要 `confirm`。
3. **agent 工具只加读/批量/上下文类**；删除、合并、批量替换这类破坏性动作先走 UI，不急着给 agent。
4. **三语同步**：新增 UI 文案必须同时进 `client/locales.js` 的中/英/日；README 三份同步。
5. **每版发布前**：`npm run build:client`、`node --check client.js`、`_dev/test-*.mjs` 全绿、CHANGELOG + README + 版本号三处同步。
6. **每版独立发布**，不攒大版本；补丁版本用于回归修复。
7. **估时只用于排序，不作为砍功能的理由**；某版做不完就顺延到下一版或补丁，不删需求。

## 数据模型时间线

| 版本 | `STORE_VERSION` | 新增字段 | 迁移要点 |
| --- | --- | --- | --- |
| `1.1.4` | 4 → 5 | `doc.brief`、`segment.uid` | 旧 segment 补 uid；brief 空；不改译文/状态 |
| `1.1.5` | 5 → 6 | `doc.tmIds`、`doc.glossaryIds`、`doc.defaultWriteTmId` | null = 继承全局；不改变旧文档行为 |
| `1.1.6` | 6 → 7 | `segment.notes`、`segment.locked` | 缺省空数组/false |
| `1.1.7` | 7（不变） | `meta`/`formatMeta` 白名单扩展 | 可选字段；旧数据不受影响 |

## 不在这四版里（1.1.8+ 候选）

写在这里，避免中途飘回来。不是永远不做，是这四版各自有主题，塞进来会变成拼盘。

- PDF / OCR / 多模态输入
- 语义/向量 TM
- 多人协作、角色、审批、服务端句段锁
- 云端同步、服务端 job 队列
- 多目标语言（一源多译）
- 项目包/整包备份
- 成本核算/发票
- 完整 style-preserving XLSX
- 图像/视觉输入（README 的 *Planned next*）
- XLIFF `<alt-trans>`（1.1.5 先做 `state`/`note` 审校包）

## 六个问题的定稿（2026-11-08）

下面六条按主流 CAT 的做法定稿，实现时按此执行，不再逐条讨论。

1. **brief 字段**：保留 `domain` / `audience` / `tone` / `notes` / `doNotTranslate` / `styleSample` 六项；`client` / `deadline` 不进 `doc.brief`，它们是项目/文档元数据，1.1.5 做文档资源时再决定要不要加，或留到更晚的项目层。Trados 把 customer/due date 放在项目详情，memoQ 把 client/domain/subject/deadline 放在项目向导；Phrase/Crowdin 另设按语言的 style guide。1.1.4 没有项目层，`doc.brief` 只承担“翻译指令”。
2. **术语标记**：`forbidden` 进术语条目，做成一等字段（UI、CSV/TBX 导入导出、QA 校验）；`required` 不另造状态，用 `preferred`（approved target）+ 现有 `TERM_NOT_USED` 语义表达“源文命中术语时译文必须命中 approved target”。不用 `note` 约定。memoQ/Phrase/Trados 都把 forbidden 作为条目状态，required 通常落在 preferred/QA。
3. **撤销确认与 TM**：只清 `confirmedAt`、状态回 `translated`，不回滚 TM；提示“TM 中的旧译文保留”，重新确认时覆盖；清理错误条目走 1.1.5 的 TM 维护。memoQ 的 Clear translations 只清文档，已存 TM 保留；Localazy 的 unconfirm 也不删 TM。TM 是独立资产，不做引用计数删除。
4. **XLIFF 版本**：1.1.5 先做 XLIFF 1.2（`state`、`note`、`x-cait-uid`）；2.0 后置，单独开关，不混解析器。memoQ 把 1/2 做成独立过滤器，Phrase 明确两者 DOM 不兼容，Trados 生态仍以 SDLXLIFF/1.2 为主；1.2 是最大公约数，`state`/`note` 足够表达审校往返。
5. **1.1.7 前两个格式**：DOCX 表格/页眉/脚注 + Apple `.strings`/`.stringsdict`、Android `strings.xml`；字幕第三，PPTX notes/XLSX 最后。真实文件只影响“字幕是否提前”，不影响前两个。文档 CAT 以 Office 为基本盘，开发者 TMS 以 app strings 为基本盘；CAIT 现在格式面宽但深度浅，先补两个最大人群的深度。
6. **合并/拆分的 uid**：未动句段保持原 uid；合并生成新 uid，旧 uid 进 `meta.mergedFrom`；拆分生成新 uid，旧 uid 进 `meta.splitFrom`。XLIFF 导出默认用新 uid；勾选“反映切分变化”时才派生 `old-1`/`old-2`/`old1-old2`。外部引用失效只报告 + 手动映射，不猜；禁止跨段落、跨锁定/非译边界合并。memoQ 用派生 ID，Trados 合并会影响 TM 且不能跨段；主流不承诺单一不变 uid，CAIT 用“内部稳定 uid + 外部派生 id”兼容两边。

## 发布节奏

- `1.1.4` 先发，验证「上下文 + brief」是否真的减少改动；再决定 1.1.5 的优先级。
- `1.1.5` 发完，跑一次真实客户审校往返；不通就修 XLIFF，不急着开 1.1.6。
- `1.1.6` 的合并/拆分如果卡在 Office 映射，先发纯文本类，Office 留给 1.1.7。
- `1.1.7` 前两个已定（DOCX 表格/页眉/脚注 + Apple/Android 字符串）；真实文件只决定字幕是否提前，不改前两个。
