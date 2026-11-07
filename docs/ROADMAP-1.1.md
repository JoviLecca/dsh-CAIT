# CAIT v1.1 — 预翻译与审校

> 状态：**已发布 `1.1.0`（2026-11-07）** —— 1.0–1.7、2.1–2.4、3.1–3.4 全部落地，21 个测试套件全绿
> 目标版本：`1.1.0`（上一版 `1.0.5`）
> 时间盒：2–3 周 / 估 11–14 个工作日
> 使用者：作者本人 + agent（不是面向陌生用户的首发版本）

## 一句话

把「逐句确认」换成「整篇铺底 + 人工审校」：MT 或 agent 先把全文填成**待审**，人只做判断。

## 为什么是这个

三轮取舍的结果：

| 问题 | 结论 |
| --- | --- |
| 这版的触发点 | 想让 agent 参与翻译真的成立 + 自己用着别扭 |
| 版本形状 | 一个大功能 + 若干修复 |
| agent 的画面 | 整篇预翻译，我只审校 |
| 预翻译引擎 | MT 铺底为主，agent 补刀 |
| 审校界面 | 原文 / 建议 / 译文三栏并排 |
| 是否砍范围 | 不砍，改用排序控制风险 |
| 追加需求 | 修「加自定义模型后 DeepSeek 路由消失」；主题适配（亮/暗字色 + 原生控件 `color-scheme`） |

技术上立不住的原因很具体：现在 agent 译一篇 200 段的文档，只能循环调 200 次
`cat_submit_translation`，而每次调用都会把 `status` 直接写成 `confirmed`
（`lib/store.js:399`）。**agent 干完的活和人工确认的活在数据上完全一样**，
人没有可审的对象。补上「待审」这一态，是这个版本全部工作的前提。

## 已验证的现状（改之前先看这几处）

| 事实 | 位置 |
| --- | --- |
| 快照版本号是 2 | `lib/store-utils.js:14`（`STORE_VERSION`）、`lib/store-utils.js:9`（`CAIT_VERSION`） |
| 载入时把 status 强制收敛成两态 | `lib/persistence.js:85` |
| 进度只数 `confirmed`，`pending = total - confirmed` | `lib/store.js:85` |
| 确认后自动跳到「下一个非 confirmed」 | `lib/store.js:441` `findNextUnconfirmed` |
| 确认是严格写入 + 失败回滚 | `lib/store.js:411-420` |
| 双语 MD/CSV 导出会带一列 `status` | `lib/import-export.js:575`、`:597` |
| 左侧句段栏**已有**原文/译文子串搜索 | `client/components.js:368-380` |
| 工作台已经是三列：句段栏 / 编辑区 / 右panel | `SegmentRail` / `EditorPane` / `CatPanel` |
| 编辑区内是「原文卡片在上、译文框在下」的堆叠布局 | `client/components.js:485` 起 |
| `selectSegment`、`saveDraft` 都**不落盘** | `lib/store.js:342`、`:352` |
| TM 只有 add / import / clear，没有单条改删 | `lib/tm.js:90`、`:110`、`:138` |
| 术语库有完整 CRUD，可以照抄 | `lib/glossary.js:78` `:100` |
| 库只有 create + setMounts，没有改名/删除 | `lib/libraries.js:97`、`:139` |
| RPC 是同步一问一答，没有流、没有 job | `client/rpc.js:9` |
| UI 整体随面板**线性**放大，上限 **1.8×**（1920 宽窗口实际是 1.588×） | `client/helpers.js:51-64` `CAIT_UI_BASE` 1100×680 / `computeCaitUnit`；`_dev/test-ui-scale.mjs` 断言 1700×900→1.324、4000×2400→1.8 |
| 工作台横向预算：句段栏 246 + 右栏 344，都是固定 px | `client/styles.js:61` `.cait-body`、`:84` `.cait-main` |

三个由此推出的结论，会影响估时：

- **「找不到句子」其实只有一半**：搜索有了，缺的是按状态筛选，以及光标/草稿不落盘。
- **「三栏」不是重排工作台**，而是把 `EditorPane` 内部的堆叠改成并排 + 窄宽退化，比想象中便宜。
- **密度是「三栏」的前置条件，不是审美问题**：1.8× 下 1920 宽的窗口只剩 1067 个设计像素，减去 246 + 344 的固定栏和编辑区 padding，正文区约 425px——三栏根本排不下。所以先降密度，再排三栏。

## 数据模型

句段状态从两态变三态：

```
pending ──(预翻译/译完未确认)──> translated ──(人确认)──> confirmed
                                      └──(拒绝/重译)──> pending
```

新增字段（都在 segment 上）：

| 字段 | 取值 | 用途 |
| --- | --- | --- |
| `status` | `pending` \| `translated` \| `confirmed` | 状态机 |
| `origin` | `tm` \| `mt` \| `agent` \| `manual` | 这条译文谁给的，审校时决定信几分 |
| `suggestion` | string | 预翻译留下的机器译文；人改过 `target` 后仍保留，用于对照 |
| `confirmedAt` | ISO string \| null | 不变 |

`STORE_VERSION` 2 → 3。迁移规则：

- 老数据里 `status: 'confirmed'` 且有 `target` → 保持 `confirmed`；其余 → `pending`。
- 老数据没有 `origin`/`suggestion` → 不补；审校 UI 对 `origin` 缺失按 `manual` 显示。
- `persistence.restore` 的版本判断从 `1 || 2` 改成 `1 || 2 || 3`，v1/v2 都按上面规则迁移。

**语义要一起改的地方**（漏了不会报错，只会悄悄错，逐个确认）：

1. `progress()` 增加 `translated` 计数，`pending` 不能再是 `total - confirmed`。
2. `findNextUnconfirmed` 保持「跳过 confirmed」——也就是会停在 translated 上，这正是审校要的。
3. `confirmSegment` 写 TM 的行为不变；「直接采纳建议」由 UI 传 `target = suggestion` 实现，不新增标志位。
4. 双语 MD/CSV 的 `status` 列会开始出现 `translated`，检查导出测试的断言。
5. `cat_get_segment` / `cat_list_documents` 返回的进度文案（`lib/tools.js:74`、`:45`）要能显示待审数。
6. 客户端状态点/徽章需要 `.translated` 样式（`client/components.js:418`、`:483`）。

## 先做的两条：路由修复与主题适配

一条是 bug，一条是适配需求。都不属于 1.1 主线，但都挡路：前者让 MT 路由不可用，后者让新界面在暗色下没法看。都排在第 1 周。

### 1.0 加了自定义模型之后，DeepSeek 从模型路由里消失

**现象**：在 DSH 里新增一个自定义模型后，CAIT 设置里「模型路由」下拉只剩新模型和 mock，原来的 DeepSeek 不见了。

**根因在 `lib/mt.js:54-65`**：

```js
const configured = configuredProviderIds(loader)
const hasLoaderRoutes = adapters.some((adapter) => configured.has(String(adapter?.id ?? '')))
...
if (hasLoaderRoutes && !configured.has(id)) continue
```

`configuredProviderIds()` 从 loader 各 entry 的 `config.providers` 取 id。只要**任意一个** adapter 命中这份配置，`hasLoaderRoutes` 就为真，于是所有不在 loader 配置里的 adapter 全被 `continue` 掉。内置 deepseek adapter 是注册在 loader 之外的载体，所以「加一个自定义 provider」等于把整张表过滤成只剩自定义那一个。

**修法**：把「存在性过滤」降级成「提示」，不再用它决定谁可见。

- `llm.listProviders()` 的结果全部列出，一个不丢。
- loader 配置只用于排序（已配置的排前面）和标记 `configured: true`。
- 没有模型的 adapter 保留，标 `hasModels: false`，下拉里禁用并注明「无可用模型」，而不是让整条路消失。
- 补 `_dev/test-mt-routes.mjs`：fake llm + fake loader，断言「一个自定义 provider + 内置 deepseek」时两个都在、且顺序正确。

这条根因是从代码推出来的，符合现象但没在你机器上复现过。所以留一个诊断顺序：先按上面改，
因为它同时消除了「配置里有什么就只能看到什么」这个失效模式；若改完 deepseek 仍不出现，
说明 DSH 的 `llm.listProviders()` 本身就不再返回它，那时再从 loader 配置反向补一条保底条目。

**估时**：0.5 天（含测试）。**不修的后果**：第 2 周预翻译上线后，凡加过自定义模型的机器都选不到 deepseek，MT 功能等于不可用。

### 1.7 暗色/亮色主题适配

**需求**：亮色主题下以深色字为主、暗色下以浅色字为主；填充按钮上的字同理。

**这层映射不用自己算**，DSH 已定义好：

| 令牌 | 亮色 | 暗色 |
| --- | --- | --- |
| `--dsw-alias-label-primary` | `#0f1115` | `#f9fafb` |
| `--dsw-alias-label-primary-inverted` | `#fff` | `#353638` |

`client/styles.js` 已经全部走 `--dsw-alias-*` 令牌，方向是对的。问题在三处具体用法：

1. **主按钮把「面」令牌当「字」令牌**：`client/styles.js:46` `.cait-btn-primary{color:var(--dsw-alias-bg-base)}`。DSH 自己的主按钮是 `background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted)`，照它改。
2. **没有声明 `color-scheme`**：`.cait-root` 未设置，原生控件跟随文档级 `color-scheme`，而令牌管不到它们。暗色主题下 `<select>` 展开的 option 列表、checkbox、滚动条、输入光标可能仍是白底黑字——设置里的「模型路由」正好是原生 `<select>`（`client/components.js:1323-1336`），最容易撞上。
3. **主题信号**：DSH 用 `body[data-ds-dark-theme]` 标记暗色。加一个 `useThemeKind()`：MutationObserver 监听该属性，在 root 上写 `data-cait-theme` 并设对应的 `color-scheme`。只读 DSH 的状态，不自己判断主题。

**做法**：按清单逐项过一遍——正文、次要文字、普通/主/危险按钮、输入框、下拉 option、placeholder、`mark` 高亮、模态遮罩、状态徽章——确认没有别处也把「面」当「字」。再补静态测试 `_dev/test-theme-tokens.mjs`：`client/styles.js` 里除 `var(…, #xxx)` 兜底外不允许出现 hex/rgb 字面量；主按钮必须引用 `-inverted`；`color-scheme` 必须存在。

**验收**：两个主题各截一次图，重点看下拉展开、主按钮、`mark` 高亮。看着对就收，不逐像素比对。

**估时**：0.5–1 天。放在第 1 周，理由同 1.6：3.1 的三栏会新增一批元素，先立好规则再铺新 UI，免得返工两次。

## 工作分解

### 第 1 周｜地基 + 便宜货

做完这周末，应该已经能「agent 翻完、你筛着看完就确认」，只是还得手动一段段触发。

| # | 任务 | 改哪里 | 估时 |
| --- | --- | --- | --- |
| 1.0 | 修复：自定义模型后 DeepSeek 路由丢失 | `lib/mt.js:54-65`、新增 `_dev/test-mt-routes.mjs` | 0.5 天 |
| 1.1 | 三态 + `origin`/`suggestion` + v3 迁移 | `lib/store-utils.js`、`lib/persistence.js`、`lib/store.js`、`_dev/test-persistence.mjs` | 1.5–2 天 |
| 1.2 | 状态筛选（全部/待审/未译/已确认/有 QA） | `client/components.js` `SegmentRail`+`CatPanel`、`client/styles.js`、`locale/*.json` | 0.5 天 |
| 1.3 | 光标与草稿落盘 | `lib/store.js` `selectSegment`/`saveDraft` + 客户端 1.5s debounce | 0.5 天 |
| 1.4 | TM 单条改/删 | 照 `lib/glossary.js:78`/`:100` 写 `lib/tm.js`，接 `lib/api.js:7` 的 MUTATIONS + TM 面板 | 0.5 天 |
| 1.5 | 库改名/删除 | `lib/libraries.js` + `LibrariesModal`（含默认库/挂载引用清理） | 0.5 天 |
| 1.6 | 收紧 UI 缩放（1.8× → 1.45×，改为阻尼增长） | `client/helpers.js` `computeCaitUnit`、`_dev/test-ui-scale.mjs` | 0.5 天 |
| 1.7 | 主题适配（亮/暗字色 + `color-scheme`） | `client/styles.js`、`client/helpers.js`（`useThemeKind`）、`_dev/test-theme-tokens.mjs` | 0.5–1 天 |

验收：载入一个 v2 快照不报错、不丢译文；关掉 DSH 再开，光标和没确认的草稿都在；
加过自定义模型后 DeepSeek 仍在路由下拉里；两个主题下列表、按钮、下拉展开都正常。

**1.6 的取值**（一次定稿，不逐点微调）：`unit = min(1.45, 1 + (min(w/1100, h/680) - 1) * 0.6)`

| 面板尺寸 | 现在 | 改后 |
| --- | --- | --- |
| 1320×800 | 1.176 | 1.106 |
| 1700×900 | 1.324 | 1.194 |
| 1920×1080 | 1.588 | 1.353 |
| 2560×1440 / 4K | 1.8（封顶） | 1.45（封顶） |

中尺寸几乎不动，只压大屏那一段——也就是实际抱怨的地方（最大化/全屏比周围 DSH 面板大一圈）。
1920 下 1.353 恰好让三栏的横向预算（约 1390 设计像素）成立，所以这件事排在第 3 周之前做完，避免三栏做完再返工密度。
`_dev/test-ui-scale.mjs` 里 1.324 / 1.8 / 1.029 三处断言随公式一起更新。若某尺寸看着偏小，只动 cap，不重算曲线。

### 第 2 周｜引擎

| # | 任务 | 改哪里 | 估时 |
| --- | --- | --- | --- |
| 2.1 | 分块预翻译 RPC | `lib/store.js` 新增 `preTranslate`、`lib/api.js:94` handlers | 1–1.5 天 |
| 2.2 | MT 并发与失败处理 | `lib/mt.js`、`store.mtSuggest`（并发 2、超时不重试、失败留 pending） | 0.5 天 |
| 2.3 | agent 工具三个 | `lib/tools.js:48` 起 | 1 天 |
| 2.4 | 进度与「取消」 | 客户端循环 + 停止按钮（见下方设计） | 0.5 天 |

**预翻译不做 job 队列**。RPC 是同步的（`client/rpc.js:9`），没有流、没有取消通道；
为此新建一套 job 状态机不划算。采用分块：

```
preTranslate({ documentId, from, count, mode: 'tm'|'mt'|'both', overwrite })
  → { segments: [...], progress: {...}, done: boolean }
```

- 客户端循环，一块 8 段、块内并发 2；每块结束写一次快照（best-effort，不严格模式）。
- 进度天然可见：现有 2 秒 revision 轮询（`bootstrap().revision`）会让句段一条条出现在栏里。
- 「取消」= 客户端停止循环；已翻的保留。不需要取消端点。
- 200 段 × 3s/段 ÷ 并发 2 ≈ 5 分钟，单块请求约 12 秒，本地同源，可接受。
- 若实测单块明显 > 15 秒，再考虑改成真 job（`start` / `status` / `cancel`），那是退路，不是默认。

取舍：关掉页面会中断预翻译。对「自己 + agent」的使用者可以接受，写进已知限制。

**agent 工具**：

| 工具 | 作用 |
| --- | --- |
| `cat_pre_translate` | 触发一批预翻译（`maxSegments` 默认 20），返回进度；agent 可反复调用推进 |
| `cat_get_segments` | 一次取一段范围的句段（含源文、建议、状态、TM 命中），替代逐段 `cat_get_segment` |
| `cat_confirm_segments` | 批量确认（只接受 `index` 列表 + 可选固定 `target`），写 TM 规则同单条 |

验收：一段 200 段文档，从 0 到「全部 translated」不用人在界面里点。

### 第 3 周｜脸面 + 收尾

| # | 任务 | 改哪里 | 估时 |
| --- | --- | --- | --- |
| 3.1 | 三栏审校（原文/建议/译文） | `client/components.js` `EditorPane`、`client/styles.js` | 2 天 |
| 3.2 | 批量接受 / 快捷键 | 同上 + `CatPanel` | 含在 3.1 |
| 3.3 | 轻量 QA 四类检查 | `lib/qa.js`（新）、`lib/api.js`、rail 红点、导出前报告 | 1–1.5 天 |
| 3.4 | 文档与发布 | `README*.md`、`CHANGELOG.md`、`docs/`、版本号 | 1–1.5 天 |

**三栏布局的退路（预先定好，避免反复改）**：
宽度按 `--cait-u` 自适应。1.6 之后 1920 宽的窗口约有 1419 设计像素，而三栏的预算是
246（句段栏）+ 344（右栏）+ 52（编辑区 padding）+ 3×240（三栏）+ 28（栏间距）≈ 1390，刚好够。
最小列宽写死 240，低于就走退路，不靠文字断行硬撑：
退成「原文 + 译文两栏、建议折叠在译文上方」，只做一版，不再尝试第三方案。判定方式是用真实文档看一眼，不靠感觉。

**QA 四类检查**（只告警，不阻挡导出）：

| 检查 | 规则 |
| --- | --- |
| 占位符/标签缺失 | `meta.inline` + `{n}` token 未被译文包含 |
| 术语未使用 | 命中术语库的源文词，译文里找不到对应译法（大小写不敏感） |
| 数字不一致 | 源文与译文的数字/小数多重集不同 |
| 空译文 | 状态是 translated/confirmed 但 `target` 为空 |

报告按需计算、不落盘（`getQaReport`）；句段栏显示红点，导出前弹一次汇总。

### 合计

11–14 个工作日，正好占满 2–3 周（10–14 个工作日），余量归零。
所以第 2 周末要真跑一次预翻译（200 段左右）验证速度：如果慢了，先调块大小和并发，不砍功能。

## 明确不做

写死在这里，避免中途飘回来：

- 新格式（PDF / 图片 OCR / 多模态输入），继续不做
- 语义 / 向量 TM 匹配，TM 仍是词法
- 多人审校流（评论、指派、审批状态）
- style-preserving XLSX、XLIFF `<alt-trans>` / notes
- 真正的服务端 job 队列（除非分块实测撑不住）
- 预翻译的历史记录 / 撤销（只保留 `suggestion` 对照）

## 验收标准

一篇真实的 3000 字文档（DOCX 或 Markdown）：

1. 导入 → 预翻译 → 筛「待审」逐条审 → 批量确认 → 导出，全程不碰终端、不改代码。
2. 中途关掉 DSH 再打开：进度、光标、未确认的草稿都在。
3. 导出文件能对回原格式的结构（DOCX 的段落、Markdown 的标题层级）。
4. `node _dev/test-*.mjs` 全绿，包含新增的 `test-review.mjs` 与 `test-pretranslate.mjs`。

## 发布清单

- [ ] `package.json` / `lib/store-utils.js:9` `CAIT_VERSION` / 导出元数据 三处版本号同步到 `1.1.0`
- [ ] `STORE_VERSION` = 3，含 v2→v3 迁移测试（旧快照能读出、译文不丢）
- [ ] 三份 README 同步：功能表、已知限制、`Planned next` 段替换为本文件摘要
- [ ] `CHANGELOG.md` 增加 `1.1.0` 段（Added / Changed / Fixed / Known limits）
- [ ] `npm run build:client` 后 `node --check client.js`
- [ ] 打 tag、走 `.github/workflows/publish.yml`

## 风险

| 风险 | 症状 | 应对 |
| --- | --- | --- |
| 三态语义漏改 | 进度数字不对、导出 status 列怪、agent 读数不准 | 改完逐条过上面「语义要一起改的地方」6 条 |
| 分块预翻译卡住 | 单块 > 15s、MT 路由限流 | 降并发、缩块；再不行改 job（退路） |
| 三栏窄宽读不清 | 1× 面板下换行稀碎 | 走预先定好的两栏退路，不试第三版 |
| 缩放调小后中屏偏小 | 1320–1700 宽反而比周围 DSH 面板小 | 只调一次 cap（1.4 / 1.45 二选一），看 1600/1920/2560 三个尺寸各一眼，不重算曲线 |
| 主题漏改 | 某个元素在两套主题里有一边看不清 | 用 `_dev/test-theme-tokens.mjs` 卡住字面量，两主题截图各看一眼 |
| 迁移炸老数据 | 载入报错、被备份成 `.corrupt-` | 迁移测试覆盖 v1/v2 两种快照 |
| 范围回弹 | 中途想加格式/加语义匹配 | 看「明确不做」 |

## 相关文档

- 现状与限制：`README.md` 的 *Known limits and roadmap*
- 版本历史：`CHANGELOG.md`
- 实施记录（开工后建）：`docs/`
