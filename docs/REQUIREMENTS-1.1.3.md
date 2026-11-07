# CAIT 1.1.3 需求：对齐、传播与 agent 协作

> 状态：**已实现（2026-11-07）**——见文末「十一、实现记录」
> 基线：`v1.1.2`（`18a4117`）
> 前置：`docs/REQUIREMENTS-1.1.2.md`（上下文 TM）**必须先完成**——对齐器写库、自动传播、一致性检查都要碰 TM 条目结构，反过来做会返工
> 目标版本：`1.1.3`
> 优先级来源：用户 2026-11-07 定序 **C（记忆）→ A（速度）→ B（质量）→ D（交接）**，原话「主要还是记忆和速度，我并不担心质量，如今的AI在翻译方面比许多人类翻译要强很多，最后才是交接。」
> 因此本版做 C 的全部、A 的关键项、B 的机械项、以及 agent 差异化；D（审校包交接）不做。

## 一、为什么做

翻译质量这一侧已经不再是瓶颈。真正的瓶颈有两个：

1. **记忆库从零开始。** 手上大量的「源文 + 我的译文」旧稿，现在对 CAIT 毫无价值，只能靠一句句确认慢慢积累。导入只认 TMX/CSV，而翻译公司给的是两个独立文件。
2. **重复劳动。** 同一句话在文档里出现十次，就要译十次、确认十次。

这两件事做完，日常效率的提升远大于再加几个 QA 检查项。

## 二、现状与差距

| 能力 | 现状 | 位置 |
| --- | --- | --- |
| 文件 → 文本 | 只有「导入并建文档」一条路，没有「只取文本」的路径 | `lib/import-export.js:178` `importFile` |
| 切句 | 已有通用切分，可直接对任意文本用 | `lib/segmenter.js:54` `splitIntoSegments`、`:17` `splitSentences` |
| 相似度 | 字符 Dice + 词 Jaccard，**只适合同语言比较**，不能拿来比「英文原句 vs 中文译文」 | `lib/similarity.js:38-54` |
| TM 写入 | `upsertTM(source, target, sourceLang, targetLang, tmId)`，按 `normalizeText(source)` 覆盖 | `lib/tm.js:11` |
| 重复句段 | 同文档内重复源文各自独立，没有合并或传播 | `lib/store.js` `confirmSegment` |
| 术语 | 只有子串命中（`findGlossaryHits`），没有候选提取 | `lib/glossary.js` |
| agent 建议 | 只有 `preTranslate` 会写 `suggestion`，agent 无法主动提建议 | `lib/pre-translate.js` |
| QA | 四类机械检查 | `lib/qa.js` |

## 三、A：对齐器（本版核心）

目标：两个独立文件（源文 + 已有译文）→ 逐句配对 → 人工确认后写入 TM。

### 3.1 输入

- **主场景：两个独立文件。** 翻译公司给源文，用户给译文——正是这种情况。
- 文件类型沿用导入的支持范围（TXT/MD/DOCX/EPUB/HTML/XLSX/PPTX）。二进制文件走现有 `base64` 通道（`lib/import-export.js:183-201` 的分派逻辑）。
- 次场景：单个双语对照文件（原文段、译文段交替）。作为可选项，若时间不够可留到下一版。

### 3.2 只取文本，不建文档

对齐属于「往库里写」而不是「往工作台里建」，所以新增一条 `readUploadText({ name, text, base64 })`：

- 复用 `parseDocx` / `parseEpub` / `parseXlsx` / `parsePptxDetailed` / `parseHtml` 等既有解析函数，**只返回纯文本**；
- 不调用 `createDocument`，不占用 `MAX_SEGMENTS`，也不出现在文档列表里；
- 解析失败按现有错误码风格抛 `ALIGN_PARSE`，消息里带文件名。

避免重复实现解析逻辑，是本项能否在 5 天内做完的关键。

### 3.3 切分

两侧各自 `splitIntoSegments(text)`。段落号（`paragraph`）要保留，配对时当结构信号用。

### 3.4 配对算法

**关键难点：跨语言不能比字面相似度。** `lib/similarity.js` 的 Dice/Jaccard 是用来比两个**同语言**字符串的，拿它比「3 modes」和「3 种模式」会得到接近 0 的分数。所以打分的依据换成三类结构信号：

```
score(a, b) = 0.45 * anchorOverlap + 0.35 * lengthFit + 0.20 * structMatch
```

- **anchorOverlap**：两侧共享的「硬锚点」——数字、`{0}` 这类占位符、URL、全大写的拉丁词、产品名。按多重集 Dice 计算。无锚点时记中立值 0.5（不奖励也不惩罚）。
- **lengthFit**：`1 - |lenA/medianA - lenB/medianB|` 归一（Gale-Church 的长度假设，对英→中这种长度差异大的语言对仍然有效，只是权重不能给满）。
- **structMatch**：同段落号 +0.5，标题对标题 +0.5（`splitIntoSegments` 已经把标题单独识别出来）。

可选增强（默认关闭）：`mtProxy` 模式——先用当前 MT 路由把源文批量译一遍，再用 `similarity()` 比 MT 输出与译文。这是唯一能真正「理解」跨语言对应的办法，但代价是 token；建议只对低置信度区间启用。

配对的 DP：

- 状态 `(i, j)`，走法 `1:1`、`1:0`（缺译）、`0:1`（多译）、`2:1`、`1:2`（切分不一致）；
- `1:1` 代价 `1 - score`；跳过代价 `1.0`；合并代价 `1 - score(合并后) + 0.15`（合并有额外成本，避免算法偷懒）；
- 复杂度 `O(n·m)`。2000×2000 ≈ 400 万格，纯 JS 几十毫秒；超过 5000 段的文档先按段落块切分、块内对齐，避免卡死。

置信度分层（写进返回值和界面）：

| 分数 | 标记 | 默认勾选 |
| --- | --- | --- |
| ≥ 0.60 | 高置信 | 是 |
| 0.35–0.60 | 待确认 | 否 |
| < 0.35 | 可疑 | 否 |

### 3.5 界面

新增「对齐」入口（顶栏「文档 / 库 / 对齐」第三个 tab，复用 `LibraryPage` 的三列骨架）：

- 顶部：两个文件选择框 + 「开始对齐」；
- 中部：左右两列对照表，每行左侧源文、右侧译文，行尾显示置信度徽标；低置信度整行标黄；
- 行操作：上移/下移、拆成 `1:0`+`0:1`、与上一行合并、删除配对、插入空行；
- 底部：`将 N 对写入记忆库`，目标库下拉（默认当前挂载的第一个 TM）；
- 写入前二次确认，文案写明「会跳过与现有条目完全相同的 N 条」。

### 3.6 写入

- 逐对 `upsertTM(source, target, sourceLang, targetLang, tmId)`（`lib/tm.js:11`），`context` 传 `null`——与 1.1.2 的 `contextHash === null` 语义一致，属于「无上下文」条目。
- 只写两侧都非空、且被勾选的行。
- 返回 `{written, skipped, total}`；`skipped` 计空行与完全重复。
- **不**创建文档、**不**改任何句段状态。

### 3.7 agent 工具

`cat_align`：参数 `{sourceFile, targetFile, minScore, limit}`，返回高置信对子数量、低置信度的前 N 对（带两侧文本与分数）、未配对行数。让 agent 能直接说「我配好了 187 对，其中 6 对需要你看，位置在第 43、91……段」。

## 四、A：自动传播

同一文档内源文完全相同的句段，一句确认后其余自动填上。

- 导入时建立 `normalizeText(source) → [indices]`，只在同文档内生效；
- 确认一句后，同组内未确认的句段写入相同译文，`origin = 'auto'`（新增到 `SEGMENT_ORIGINS`，`lib/store-utils.js:25`），状态自然落到 `translated`，进入待审；
- 同组内某句被人工改动时，其余**未确认**的同组句段同步更新（否则会留下一堆过时副本）；已确认的不动；
- 提供「立即铺满本文档」按钮，导入后一次填完所有重复句；
- `origin = 'auto'` 需要同步：导出 status/origin 列、locales 三份、状态点样式。

## 五、B：一致性检查（只加机械项）

`lib/qa.js` 增加两项，仍只告警、不阻断：

| code | 判定 | 为什么值得 |
| --- | --- | --- |
| `INCONSISTENT_TARGET` | 同文档内同一源文（`normalizeText` 后相同）出现两种以上不同译文 | 传播之后最容易出现的错 |
| `UNTRANSLATED_RESIDUE` | `normalizeText(target) === normalizeText(source)`（且源文非纯数字/符号） | 「漏译」最常见的伪装 |

不做：LQA 错误分类打分、严重度加权、审校人签署——那是交付流程才需要的东西。

## 六、D：agent 协作（差异化）

### 6.0 一个原语：`proposeTranslation`

现在 agent 只能改 `target`，等于替用户做了决定。补一个 mutation：

```
proposeTranslation({ documentId, index, target, reason? })
```

- 写 `segment.suggestion = target`、`segment.origin = 'agent'`、`segment.suggestionReason = reason`；
- **不动 `target`**，用户可以在审校区对照后点「采纳」（`adoptSuggestion` 已存在）；
- 已确认句段拒绝（与 `adoptSuggestion` 一致），抛 `ALREADY_CONFIRMED`；
- 附带工具 `cat_propose_translation`，让 agent 可以逐段或成批提建议。

这一条打通后，下面三件事都不需要新机制，只是「用法」。

### 6.1 术语提取（重做，不用纯 LLM）

**上次为什么效果不好**（推断，但和常见失败模式一致）：让模型「读全文给术语」，它给的多是高频实词、粒度不一、没有频次证据，还容易编造译法。没有证据的列表，人没法逐条判断，最后就弃用了。

这次拆成两步，**统计负责找候选，模型负责判断**：

1. **候选生成（确定性、可测试，不需要模型）**
   - 拉丁文：词元 n-gram（1–4 词），去掉停用词、去首尾虚词；
   - 中日文：重复子串（2–6 字）+ 左右邻接熵过滤，解决没有分词器的问题；
   - 打分：频次 ≥2、C-value 式长度加权（长串优先于它的子串）、边界熵高；
   - 去重：与已有术语库比对，命中的标注「已在库中」；同义变体折叠（大小写、复数）。
2. **判断与译法（模型，输入是有界的）**
   - 只把前 60–80 个候选连同「出现次数 + 2 个例句」交给 agent，让它标注「是/不是领域术语」并给译法；
   - 译法先查记忆库：候选出现在已确认的源文里时，把配对的译文片段作为提示一并给它——有证据的译法比凭空生成可靠得多。
3. **人工确认**：候选表格（术语 / 次数 / 例句 / 建议译法 / 库里是否已有），勾选后批量入库。

新增：`lib/term-extract.js`（纯算法，可单测）、`cat_term_candidates`（只读）、`addGlossaryEntries`（批量写入，一次 mutation 代替 N 次）。

### 6.2 一致性审查

机械部分（同源不同译）由 5 的 QA 覆盖；语义部分交给 agent：新增只读 `cat_consistency_report`，按「源文分组 + 译法分组」返回候选冲突，agent 逐个判断后走 6.0 提建议。不新增界面。

### 6.3 风格改写

不改代码：agent 用 `cat_get_segments` 读段 → 按用户语气档案改写 → `cat_propose_translation` 写回建议 → 用户在审校区逐条采纳。写进 README 的用法示例即可。

## 七、不做

- 多人协作、服务器端 TM、多用户句段锁、角色权限。
- 项目/客户包、交付流程、成本清算。
- PDF、IDML、字幕时间轴编辑。
- LQA 打分表与审校人签署。
- 审校包往返（XLIFF 带 state/note 给外部译者）——D 级，本版不做。
- 纯 LLM 的「读全文出术语」——见 6.1，已被证伪的方案不再做第二遍。
- 语义/向量匹配、回译对比。

## 八、估时

| 项 | 天 |
| --- | --- |
| 3.2 只取文本 + 3.3 切分复用 | 0.5 |
| 3.4 配对 DP + 置信度 | 1.5 |
| 3.5 对齐界面 | 2 |
| 3.6 写库 + 3.7 工具 | 0.5–1 |
| 四、自动传播 | 1 |
| 五、一致性检查 | 0.5 |
| 6.0 proposeTranslation + 工具 | 0.5 |
| 6.1 术语提取（算法 + 界面 + 批量入库） | 2–2.5 |
| 6.2 一致性审查工具 | 0.5 |
| 文档与 README | 0.5 |
| **合计** | **9.5–10.5** |

## 九、测试计划

| 套件 | 覆盖 |
| --- | --- |
| `_dev/test-align.mjs` | 切分复用、`1:1`/`1:0`/`0:1`/`2:1` 四种走法各一组用例、锚点评分（数字/占位符）、长度比失真时不误配、置信度分层、写库去重、空译文跳过 |
| `_dev/test-propagate.mjs` | 确认后同组填充、人工改动同步未确认同组、已确认不被覆盖、`origin === 'auto'` 往返存档 |
| `_dev/test-qa.mjs`（扩） | 同源两译报 `INCONSISTENT_TARGET`、译文等于原文报 `UNTRANSLATED_RESIDUE`、纯数字句不误报 |
| `_dev/test-term-extract.mjs` | 拉丁 n-gram 与 CJK 子串候选、停用词过滤、C-value 长串优先、边界熵过滤、已在库中标注、同义变体折叠 |
| `_dev/test-propose.mjs` | `proposeTranslation` 写 suggestion 不动 target、已确认拒绝、理由落盘、采纳后 origin 保留 |

回归：当前 24 个套件全绿，重点 `test-three-state`、`test-pretranslate`、`test-library-view`、`test-formats`。

## 十、风险

| 风险 | 应对 |
| --- | --- |
| 跨语言配对在长短混排文档上误配 | 锚点优先；低置信度默认不勾选；界面允许手工拆合；可开 MT 代理模式重跑 |
| DP 在超大文档上卡住 | 段落块预对齐 + 段数上限 5000，超出提示先用块模式 |
| 术语提取在中文上靠子串，出现大量无意义片段 | 频次 + 边界熵双阈值，候选上限 200，按分数排序；先给用户看，不自动入库 |
| `origin = 'auto'` 扩散到导出与样式 | 逐处检查：`SEGMENT_ORIGINS`、导出列、三份 locales、状态点、`test-three-state` |
| agent 写的建议质量参差，淹没人工结果 | 建议与译文严格分离（`suggestion` 字段），审校区可一键忽略；不自动采纳 |
| 对齐写入的条目污染已有记忆 | 写入前显示目标库与跳过条数；默认写入用户选定的库，不动其它库 |

## 十一、实现记录（2026-11-07）

- 新增文件：`lib/aligner.js`（打分 + DP + `alignUploads`/`writeAlignment`）、`lib/propagate.js`（同源分组、确认后填充、编辑同步、整篇铺满）、`lib/term-extract.js`（纯算法候选与排序）、`lib/terms.js`（`termCandidates`/`addGlossaryEntries`）。
- 文档读取：`lib/import-export.js` 的 `readUploadBody` / `readUploadText` 只取文本、不建文档；docx 走 `parseDocxDetailed`，epub/xlsx/pptx 用已有解析器，md 去标记，其余按纯文本。
- 工具从 10 个增到 15 个：`cat_propose_translation`、`cat_align`、`cat_consistency_report`、`cat_term_candidates`、`cat_add_terms`。新增工具必须用 `ctx.tools.register`，`ctx.tool` 不存在（第一次写成 `ctx.tool` 直接让 `test-plugin` 报错）。
- 界面：顶栏第三 tab「对齐」（`AlignPage`），左文件卡用 `FileReader.readAsDataURL` + `readUploadText`，行表支持勾选/合并/拆分/删除；句段栏新增「铺满重复句段」；库页面术语页签新增「从文档提取术语」与候选面板。
- 与设计的差异：① 没有单独的 `cat_align` 文件上传参数，工具只接文本（MCP 工具传不了二进制，界面才走 `readUploadText`）；② 候选面板的译文默认填记忆库证据的第一条，而不是留空；③ `alignUploads` 直接返回完整行表，没有单独的分页（500 行以内够用）；④ 术语提取的候选上限 60（设计里写 60–80），界面一次全显示。
- 未做：MT 代理模式、`blocked` 之外的块级预对齐界面、风格改写（仍只写在 README 的路线图里）。
- 测试：新增 `test-align`（9 节）、`test-propagate`（4 节）、`test-propose`（4 节）、`test-terms`（9 节），`test-qa` 扩到 11 节，`test-plugin` 改为 15 个工具；合计 29 个套件全绿。

