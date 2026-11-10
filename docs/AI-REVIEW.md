# AI 审校：现状、问题与方案

> 状态：阶段 A + B 已实现（1.1.8-beta1）；阶段 C 未做，见 §8 实现记录。
> 相关文件：`lib/review.js`、`client/workbench/controller.js`、`client/components/panels.js`、`client/components/workbench.js`。

## 1. 现状（代码事实）

### 1.1 入口在哪

| 入口 | 位置 | 标签 |
| --- | --- | --- |
| 面板按钮 | 右侧「检查」tab 的标题行右侧，一个 sparkles 小链接按钮 | `qa.review` = "AI 审校" |
| 命令面板 | Ctrl/Cmd+K → 搜索 | `cmd.review` = "AI 审校当前文档" |

`panel.qa` 在界面上的名字是 **「检查」**，不是「审校」，所以按"审校"去找是找不到的；按钮本身也只是标题行里的小链接，不是主操作。

### 1.2 点了之后实际发生什么

`client/workbench/controller.js:927`：

```js
const runReview = async () => {
  if (!doc || reviewBusy) return
  setReviewBusy(true)
  const result = await rpc('reviewDocument', { documentId: doc.id, from: 0, count: 20 })
  setReview(result || { issues: [] })
}
```

- **范围写死**：`from: 0, count: 20`。无论当前在第几段、文档有多长，永远只审**第 1–20 段**。
- **服务端上限同样是 20**：`lib/review.js:7` 的 `MAX_REVIEW_SEGMENTS = 20`，并且 `from/count` 只能表达**连续区间**，表达不了"只审这几段"。
- **没有分页/续审入口**：第 21 段以后目前没有任何办法送进 AI 审校。
- **命令名与实际行为不符**：命令面板写的是"审校当前文档"，实际只审开头 20 段。

### 1.3 服务端怎么判断

`lib/review.js:55` 一次模型调用：

1. 取 `[start, end)` 区间的句段，每段拼成 `[S12] / previous: … / source: … / target: …`（`target` 为空写 `(empty)`），带上文档 brief 与语言方向；
2. 系统提示要求"判断意思、术语、漏译、增译、流畅度；不要改写正确的句子，没问题返回 `[]`"；
3. 模型回 `[{index, severity, code, message, suggestion}]`；
4. 服务端过滤（`lib/review.js:31`）：`index` 不在本次区间的丢弃、`severity` 非法按 `medium`、`message` 为空丢弃、最多 120 条。

也就是说：**"哪些句子值得报"完全由模型在这 20 段里现场判断**，没有跨段比较、没有第二轮筛选、没有优先级排序。

### 1.4 与「检查」（规则 QA）的关系

两套东西互不相干：

| | 规则检查 | AI 审校 |
| --- | --- | --- |
| 实现 | `lib/qa.js` | `lib/review.js` |
| 触发 | 打开文档自动跑，点"重新检查"再跑 | 手动点按钮 |
| 范围 | 全文档每一段 | 固定前 20 段 |
| 依据 | 确定性规则（空译文、占位符、数字、术语、残留、字幕重叠、长度漂移） | 一次模型调用 |
| 风险等级 | 代码里写死的映射（`lib/qa.js:10`） | 模型自报 `high/medium/low` |

规则检查已经算出了"高风险段落"名单（`qa.risks`），AI 审校**完全没有用这份名单**。

### 1.5 结果的生命周期

- `review` 只存在内存里（`controller.js:44`）；
- 切换文档时 `setReview(null)`（`controller.js:329`）；
- 刷新页面即丢失；
- 没有"已审 / 已处理 / 已忽略"状态，同一段可以反复审、反复计费；
- `suggestion` 不会自动写入，点"填入建议"只是填进草稿（`panels.js:567`），仍需人工确认——这一点是合理设计，不是缺陷。

## 2. 问题清单

| # | 问题 | 影响 | 级别 |
| --- | --- | --- | --- |
| 1 | 范围写死前 20 段，长文档无法审校 | 功能对 90% 的真实文档不成立 | P0 |
| 2 | 命令名"审校当前文档"与实际行为不符 | 用户以为审完了 | P0 |
| 3 | 入口藏在「检查」tab 的角落 + 命令面板 | 用户找不到（本次就是这种情况） | P1 |
| 4 | 不使用规则检查的高风险名单 | 把 token 花在没问题的句子上；真正危险的段落可能永远轮不到 | P1 |
| 5 | 结果不持久、无处理状态 | 重复审校、无法跟踪进度 | P1 |
| 6 | 不可取消、无进度 | 一次 20 段要等数十秒，长文档批量审校时体验更差 | P2 |
| 7 | 不能只审"当前页 / 选中段 / 高风险" | 无法与工作流对齐 | P2 |

## 3. 方案

分三步，每步都可独立上线；A 是修"名不副实"，B 是补齐真实工作流，C 是可选增强。

### 阶段 A：把现有功能做诚实（约半天）

**目标**：不再撒谎，且长文档有入口。

1. 客户端按"当前页"取范围：

```js
// controller.js
const bounds = pageBounds(selected, pageSize) // 已有的分页工具
const result = await rpc('reviewDocument', {
  documentId: doc.id,
  from: bounds.start,
  count: Math.min(bounds.size, 20),
})
```

2. 面板标题显示实际范围，例如「AI 审校建议（第 41–60 段）」；命令名改成「AI 审校当前页」。
3. 在「检查」tab 标题行加一个**主按钮**（不再是链接样式），并给 `cmd.review` 补一行提示文字说明范围。
4. 若当前页超过 20 段（`pageSize` 最大 200），先审前 20 段，并在结果下方显示「继续审本页剩余 N 段」按钮。

**验收**：在第 300 段点审校，请求体是 `from: 280, count: 20`；界面标题显示"第 281–300 段"；长文档每次都能审到。

### 阶段 B：审校队列（1–2 天）

**目标**：AI 审校可以直接吃规则检查的结果，并且能分批跑完、能取消。

1. **服务端加一个参数**（保持 `from/count` 兼容）：

```js
// lib/review.js
async reviewDocument({ documentId, from = 0, count = 20, indexes = null } = {}) {
  const targets = Array.isArray(indexes) && indexes.length
    ? indexes.filter((i) => Number.isInteger(i)).slice(0, MAX_REVIEW_SEGMENTS)
    : range(from, count)
  // …按 targets 取段、拼 prompt；返回 { indexes: targets, issues }
}
```

   - 用 `indexes` 而不是区间，是因为"高风险项"天然不连续；
   - 越界索引直接忽略，不报错（与现有 `parseIssues` 的宽容策略一致）。

2. **客户端队列**（`controller.js`）：

```js
const runReview = async ({ target = 'page' } = {}) => {
  const indexes =
    target === 'risk'
      ? (qa?.risks || []).filter((r) => r.risk === 'high').map((r) => r.index)
      : pageBounds(selected, pageSize).indexes
  const batches = chunk(indexes, 20)
  reviewCancelRef.current = false
  setReview({ running: true, done: 0, total: indexes.length, issues: [] })
  for (const batch of batches) {
    if (reviewCancelRef.current) break
    const part = await rpc('reviewDocument', { documentId: doc.id, indexes: batch })
    setReview((prev) => ({ ...prev, done: prev.done + batch.length, issues: [...prev.issues, ...(part.issues || [])] }))
  }
  setReview((prev) => ({ ...prev, running: false }))
}
```

   - 串行而不是并发：避免打爆模型路由，也让进度与取消可控；
   - 结果按 `index` 去重、按 `severity` 排序；
   - 取消按钮只置 `reviewCancelRef`，当前批次跑完即停（不中断已在飞的请求，避免半截 JSON）。

3. **界面上加三个入口**：「审校本页」「只审高风险（N）」「继续下一批」；「只审高风险」在 `qa.risks` 为空时禁用并提示"规则检查没有发现高风险句段"。

**验收**：
- 60 段文档点「审校全文档」→ 3 次调用、进度 60/60、结果无重复；
- 点「只审高风险」→ 请求体的 `indexes` 恰好等于 `qa.risks` 里 `high` 的索引；
- 中途取消 → 不再发新批次，已返回的结果保留。

### 阶段 C：审校状态与报告（可选，2–3 天）

1. **落库**：`document.review = { [index]: { status: 'open'|'applied'|'ignored', severity, message, suggestion, at } }`。
   - 不要塞进 `store.json` 的句段对象里（会让 20k 句段的文件再大一圈），单独放 `store.documents[id].review`，随 store 一起持久化即可；
   - 迁移：`lib/restore.js` 里补一个 `restoreReview()`，旧文件缺字段就跳过。
2. **面板**：未处理数徽章、过滤（全部 / 高 / 未处理）、"忽略"按钮；`applied` 的条目在句段上留一个点。
3. **导出**：审校报告（CSV / Markdown），字段 `句段号 / 风险 / 问题 / 建议 / 处理状态`。
4. **与确认流程串联**：`applied` 只填草稿并标记待确认，绝不自动 `confirmSegment`。

## 4. 明确不做

- **后台自动审校**：每次调用都要花钱，且长文档会打满路由；必须由人显式发起。
- **逐段实时审校**：每次输入都调模型，成本与延迟都不可接受。
- **用 AI 替换规则检查**：规则检查是确定性的、免费的、每次打开文档都跑；AI 只做规则表达不了的部分（语义、语气、漏译）。

## 5. 成本估算

- 一批 20 段：输入约 3–5k tokens，输出约 0.5–1k tokens（中文→英文，含 brief 与上下文）；
- 1000 段文档全量审校 = 50 次调用；
- 因此"只审高风险"应该是默认推荐路径，而不是"全文档审校"。

## 6. 影响面

| 改动 | 文件 | 风险 |
| --- | --- | --- |
| `reviewDocument` 支持 `indexes` | `lib/review.js`、`lib/api.js`（handler 已是透传） | 低，向后兼容 |
| 队列与取消 | `client/workbench/controller.js` | 中，注意 `review` 状态形状变化会牵连 `panels.js` 的渲染 |
| 三个入口按钮 | `client/components/panels.js` | 低 |
| 审校结果落库 | `lib/restore.js`、`lib/persistence.js`、`client/...` | 中，注意旧文件迁移与回滚 |
| i18n | `client/locales.js` 三语各补 6–8 个键 | 低，`check:locales` 会守住 |

## 7. 建议的落地顺序

1. 先做 A（半天），当天就能消除"审校当前文档只审 20 段"这个错误承诺；
2. 观察一版，确认用户实际怎么用，再做 B；
3. C 只在确实需要跟踪审校进度时做，否则 B 的"本次结果"已经够用。

## 8. 实现记录（阶段 A + B + C，1.1.8-beta1）

按用户要求一次做完 A + B + C。

服务端 `lib/review.js`

- `reviewDocument({ documentId, from, count, indexes })`：`indexes` 优先于 `from/count`。实现是新增的纯函数 `reviewTargets({ indexes, from, count, total })`——去重、只保留 `0 <= index < total`、升序、最多 `MAX_REVIEW_SEGMENTS`（20）条；显式列表全部越界时不再回退，直接抛 `REVIEW_RANGE_INVALID`。
- `parseIssues(output, allowed)` 的第二个参数从区间改成 `Set`，模型返回未请求的索引一律丢弃（原来靠 `index < from || index >= to`，无法表达稀疏区间）。
- 返回体新增 `indexes`（实际送审的索引）；`from`/`to` 保留为 `indexes[0]` 与 `indexes.at(-1) + 1`，老调用方不受影响。

客户端 `client/workbench/controller.js`

- `runReview(target = 'page' | 'risk')`：先算目标索引——`page` 用 `readPageSize(localStorage)` 与当前 `selected` 推出页边界（与轨道翻页同一规则），`risk` 取 `qa.risks` 里 `risk === 'high'` 的索引。
- 按 `REVIEW_BATCH_SIZE = 20` 串行分批，每批 `rpc('reviewDocument', { documentId, indexes: batch })`；`review` 状态变成 `{ target, running, cancelled, done, total, indexes, issues }`。
- `mergeReviewIssues()` 按 index 去重，再按 `high → medium → low → index` 排序，避免多批结果交错。
- 取消与竞态：`reviewCancelRef` 让循环在下一批之前停下；`reviewRunRef` 是运行代号，切文档（`data?.activeDocument?.id` effect）与重新发起都会自增，旧运行的结果不再写回界面。
- 空目标不发请求：页内无句段提示 `qa.reviewEmptyRange`，没有高风险提示 `qa.reviewRiskEmpty`。

界面 `client/components/panels.js`、`client/components/workbench.js`

- 「检查」标题行：`审校本页` 从 `cait-linkbtn` 改成 `cait-btn cait-btn-primary` 主按钮，旁边是 `只审高风险（N）`（没有高风险时禁用）和原来的「重新检查」。
- 结果区标题右侧显示 `已审 {done}/{total} 段`，运行中显示「取消」，取消后补一行提示。
- 命令面板：`cmd.review` 改名「审校当前页」并加 hint；新增 `cmd.reviewRisk`「只审高风险句段」。两者都会先切到「检查」tab 再发起。

测试

- `_dev/test-review.mjs` 新增「review accepts an explicit index list」：6 段文档上送 `[5, 2, 2, 99, -1]`，断言 `indexes = [2, 5]`、`from = 2`、`to = 6`、提示词里没有 `[S3]`、模型多返回的索引 3 被丢弃；`indexes: []` 回退到 `from/count`；全部越界抛 `REVIEW_RANGE_INVALID`。
- `_dev/test-review-flow.mjs`（新，jsdom）：25 段文档点「审校本页」→ 断言两次 `reviewDocument`（20 + 5）、第二批索引是 `[20..24]`、首批提示词停在 `[S19]`、界面显示「已审 25/25 段」且两批的问题都合并成两行；另一组直接调 store 验证 `indexes: [2]` 时模型顺带的 0 被丢弃。

仍未做（阶段 C 已做，这里只记当时不做的理由）：后台自动审校、逐段实时审校、用 AI 替换规则检查。

## 9. 实现记录（阶段 C：审校报告落库）

### 存储

- 形状：`document.review = { updatedAt, issues: [{ index, severity, code, message, suggestion, status, at }] }`，仍是「一个句段一行」，按 index 去重，最多 `MAX_REVIEW_ISSUES_PER_DOC = 500` 行。
- 放在 `store.documents[id].review`，不塞进句段对象（20k 句段的文件不会被撑大）；`documentView()` 里带 `review` 出去，所以刷新、重开文档、切 tab 都还在。
- 迁移：`lib/restore.js` 的 `restoreReview(raw)` 逐行校验（index 必须是非负整数、severity 归一、status 归一），坏行丢弃而不是整份加载失败；`lib/persistence.js` 在 brief 之后调用它。
- 状态三值 `open | applied | ignored` 放在 `lib/review-status.js`（`REVIEW_STATUSES`、`normalizeReviewStatus`），避免 `review.js` 与 `restore.js` 互相 import。

### 语义

- 重跑审校时，**同一条发现**（`code` 与 `message` 都相同）保留人工决定的状态；发现变了就是新问题，重置为 `open`——否则重跑会把「已忽略」全部洗回待处理。
- 确认句段时，该段若有 `open` 的审校行，自动置 `applied`（确认是最强信号）；`ignored` 不覆盖。落盘失败时 `confirmSegment` 的 catch 会把它还原成 `open`。
- `reviewDocument` 从只读变成写操作：`touch()` + `persist({ strict: true })`，并登记进 `MUTATIONS`，因此每批都回整份 state，客户端不再自己合并（原来的 `mergeReviewIssues` 已删）。

### 接口

- 新增三个 store 方法（`lib/review.js`）：
  - `setReviewIssueState({ documentId, index, status })`：状态必须是三值之一（否则 `REVIEW_STATUS_INVALID`），找不到行抛 `REVIEW_ISSUE_NOT_FOUND`；
  - `clearReview({ documentId })`：清空整份报告，没有报告抛 `REVIEW_NOT_FOUND`；
  - `exportReview({ documentId, format })`：`csv` / `markdown`，返回 `{ filename, mime, content, count }`，非法格式抛 `REVIEW_FORMAT_INVALID`。
- 客户端只负责下载（`downloadFile`）与确认弹窗（`clearReview` 走 `openConfirm`），导出内容由服务端生成，agent 工具将来可以复用同一份实现。

### 界面

- 「检查」tab 的审校区块：标题行右侧是进度 + 取消 + `CSV` / `MD` 导出 + 清空；下面是筛选 chips（`待处理 / 已处理 / 已忽略 / 全部`，带计数）与筛选后的行。
- 每行有状态徽章与三个动作：`标为已处理`、`忽略`、`重新打开`；`applied` / `ignored` 的行整体弱化（`.is-applied` / `.is-ignored`）。
- 容器 class 从 `cait-review` 改成 `cait-reviewlist`：`editor.js` 里已有一个同名三列 grid，复用会把行挤成三列。
- 空态分两种：有报告但当前筛选为空 → `qa.reviewFilterEmpty`；完全没有报告 → `qa.reviewEmpty`。

### 测试

- `_dev/test-review-report.mjs`（新，6 组）：落库并重载后状态保留；确认句段自动 `applied` 且不覆盖 `ignored`；重跑同一条保留决定、换了发现则重开；CSV 与 Markdown 的内容、表头与转义；非法格式 / 无报告 / 清空的错误码；`restore` 丢弃坏行并按 severity + index 排序。
- `_dev/test-review-flow.mjs` 增加第三段（jsdom）：审校 → 点行内「忽略」→ store 里状态变成 `ignored`、chips 变成「已忽略 1」、切到「已处理 0」显示空筛选提示、切回「全部 1」看到徽章。
- 顺手修了测试夹具的两个真问题：
  - `_dev/lib/workbench-harness.mjs` 之前**没有 await 异步 handler**，`reviewDocument` 这类 async 写方法返回的 state 是调用前的快照（真实 HTTP 层是 `await handlers[method](params)`）；现在改成 await，并补了 `settle()` 等一次 RPC 的 promise 链跑完。
  - 同一个夹具把 `store.bootstrap()` 的结果**按引用**交给客户端，服务端就地改一个字段，客户端就会「没有 re-render 却看到新值」；现在响应体先 `JSON.parse(JSON.stringify())` 走一遍序列化，与线上一致。

