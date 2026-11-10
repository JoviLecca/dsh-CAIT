# 下一轮指导（v.1.1.8_beta1 之后）

这份文档是**下一轮工作的唯一入口**：版本约定、优先级、结构红线、工具红线都在这里。
架构事实（目录、依赖方向、加东西的标准动作）在 [ARCHITECTURE.md](./ARCHITECTURE.md)，
两份冲突时以本文为准。上一份执行计划 `REFACTOR-PLAN.md` 的批次已收尾，已删除；它的
「结构约定」一节已经并进 `ARCHITECTURE.md`。

## 0. 版本与发布约定

- 这一轮的快照编号是 **`v.1.1.8_beta1`**（注意是 `v.` 开头、下划线接 `beta1`），
  `package.json` 里写 `1.1.8-beta1`（npm 只接受 semver，下划线不可用，两者是同一个版本）。
- **只推 tag，不发 Release。** 目的只是给这一轮结构治理留一个不丢的存档点。
- 已核实：`.github/workflows/publish.yml` 只在 `release: published` 与手动 `workflow_dispatch`
  时触发，**推 tag 不会发 npm**。所以「不打 Release」就是「不会发布」。
- 下一次真正要发版时，再按老流程：改 `package.json` → 打 `v1.1.9` → 建 Release → 由 CI 发 npm。

## 1. 这一轮已经做完了什么

从 `ab9ea1d`（加护栏）到本快照共 18 个提交，`npm run check` 九步全绿、49 个测试套件通过：

| 面 | 结果 |
| --- | --- |
| 工程护栏 | prettier + eslint + 5 个契约检查（locales/store/formats/shared/api/client）+ 测试 runner + CI |
| 客户端 | 六片段 → ESM + esbuild；`components.js` 6069 行 → 9 个模块；`Workbench` → controller/view 两层 |
| 服务端 | `store.js` 1400 → 156 行；27 个 mixin / 130 个方法走注册表，重名在装配期抛错 |
| 格式层 | 导出 370 行 if 链 → 适配器注册表；导入 218 行 if 链 → 一类型一 reader；`import-export.js` 982 → 338 行 |
| 同步 | 轮询先打 `currentRevision`（<100 B），版本没变不再拉整份快照 |
| 顺带修的真 bug | 预翻译循环里 `dirty` 读到旧闭包会覆盖用户输入；13 处裸 `setData` 丢草稿；Icon 重复键；CatPanel 死状态；本地化文件不在导入框里 |

## 2. 下一轮的优先级

### P1 错误消息国际化（已完成，2026-11-10）

现状（改之前）：服务端 121+ 处 `CatError('CODE', '中文文案')`，而客户端直接把 `error.message` 弹出来，
英文/日文用户操作失败时看到中文。

实际做法（与原计划不同，记录原因）：

1. **没有建 `lib/error-messages.js` 的「一码一条」大表**。116 个错误码里大多数只是措辞差异
   （`XLSX_PARSE` / `PPTX_PARSE` / `EPUB_PARSE` 读起来是一样的），写成 116×3 条是第二份需要同步的
   注册表，新增错误时最容易忘。改成 `client/errors.js` 里 16 条**类别规则**：
   前缀 `INVALID_` / `MISSING_` / `TOO_MANY_`，后缀 `_PARSE`、`_NO_UNITS`、`_NOT_FOUND`、
   `_NOT_MOUNTED`、`_BOUND`、`_TOO_LARGE`、`_TOO_LONG`、`_TOO_MANY`、`_FAILED`、`_REQUIRED`、
   `_UNSUPPORTED`、`_INVALID`、`_EMPTY`、`_MISMATCH`。
   专属键优先，类别兜底，所以想精修某个码时随时加一条即可。
2. **契约由脚本守**：`scripts/check-errors.mjs` 扫描 `lib/` 里真正会被抛出的码（含 `fail('CODE')`、
   `editError('CODE')`、`parseOrFail(parse, 'CODE')` 这类助手），要求每个码都能在字典里取到文案——
   专属键或类别键都行，取不到就 `npm run check` 失败。字典里多余的 `error.*` 孤儿键同样判失败。
3. 客户端统一走 `describeError(error, t)`：专属键 → 类别键 → 服务端 message → `error.generic`。
   保留 message 作为倒数第二层，是为了让「客户端还没认识的新码」仍然能显示一句可读的话，
   而不是笼统的「操作失败」。四个展示点（`report`、`setLoadError`、`setTmError`、`setMtError`）都已切换。
4. `client/rpc.js` 的三条本地中文（网络失败 / HTTP 状态 / 剪贴板）改成带 code 的 `ClientError`
   （`NETWORK` / `HTTP` / `CLIPBOARD`），HTTP 那条用 `{status}` 占位符，由 `t(key, vars)` 填充。
5. 字典加在 `client/locales.js` 尾部三个 `Object.assign` 块里，共 48 键 × 3 语言；
   顺带把不是错误码的 UI 键 `error.load` 改名 `workbench.loadFailed`，避免和 `error.*` 命名空间混淆。
6. 服务端中文 message 全部保留（兜底与日志用），没有为了 i18n 去删。

守卫：`check:errors` 已并入 `npm run check`；`_dev/test-errors.mjs` 断言
「专属键优先 / 类别兜底 / 未知码回退 message / 占位符被填充 / 116 个码 × 3 语言都有文案」。

### P2 已测量：瓶颈不是协议，是 TM 查找

基准脚本 `scripts/bench-scale.mjs`（`npm run bench`）用临时 `dataDir` 建真实 store，
`--segments` / `--tm` 可调，每组取 3 次中位数。它先量一遍空 TM 的读路径，再灌 TM 复测，
这样才能把「全库 TM 扫描」从 `bootstrap()` 里单独摘出来。

20,000 句段 / 10,000 TM（Node 26，Windows）：

| 路径 | 中位数 | 载荷 |
| --- | --- | --- |
| `bootstrap()`（TM=0） | 4.5 ms | 6.0 MB |
| `JSON.stringify(state)` | 16.3 ms | 6.0 MB |
| `bootstrap()`（TM=10k） | 113.5 ms | 6.0 MB |
| `segmentDetail()`（TM=10k） | 111.1 ms | — |
| `selectSegment()`（点一下） | 109.8 ms | — |
| `confirmSegment()` | 206 ms | — |
| `API confirmSegment` 含回传 state | 309 ms | 6.0 MB |
| `persist()` | 58 ms | 13.5 MB 落盘 |

典型文档 500 句段 / 2,000 TM：点一下 21 ms、写一次 54 ms / 0.16 MB。

结论：**6 MB 状态本身只要 4.5 ms 构建 + 16 ms 序列化**，`bootstrap()` 的 113 ms 里约 109 ms
是 `lookupTM`。它给每条 TM 调 `similarity(text, entry.key)`，而 `diceCoefficient` 每条都重新
拆一遍 query 的 bigram/token，单条约 11 µs × 10k 条。所以在典型 2k TM 的文档里，
每次点句段也要白付 21 ms。

因此顺序改成：**先做 TM 查找索引，再复测，最后才谈 `bootstrap({ since })`**。
真要做增量下发，等于为 4.5 ms 的构建成本改协议（`api.js` 响应形状 + `adoptState` + 变更追踪），
不划算。

P2.1 已完成。做法不是「长度带预筛」，而是**按计数算上界**：

- `similarity.js` 暴露 `prepare(text)`（query 的 bigram 与 token 只算一次）、`textStats(key)`
  （一条 TM 的 bigram 数与 token 数，缓存在 entry 上）、`scoreCeiling()`；
- 上界是两个数学事实的合成：`dice <= 2*min(g1,g2)/(g1+g2)`、`jaccard <= min(t1,t2)/max(t1,t2)`，
  所以 `0.72*dice + 0.28*jaccard` 一定不超过这个 ceiling。低于阈值的 entry 直接跳过，
  **不参与打分**，也不改变结果；
- 计数只在 `entry.updatedAt` 变化时重算（`WeakMap` 挂在 store 上），所以一次查询里每个 entry 只付一次。

20k 句段 / 10k TM 复测：

| 路径 | 改前 | 改后 |
| --- | --- | --- |
| `bootstrap()` | 113.5 ms | **5.2 ms** |
| `selectSegment()`（点一下） | 109.8 ms | **1.3 ms** |
| `segmentDetail()` | 111.1 ms | **1.1 ms** |
| `confirmSegment()` | 206 ms | 92.9 ms |
| `API confirmSegment` 含回传 state | 309 ms / 6.0 MB | **115 ms / 6.0 MB** |

最坏情况（10k 条 TM 全都和查询近似，ceiling 拦不住）仍有 75 ms——这是「每条都要真算一次」的下限，
没有 gram 缓存就降不下去，而 gram 缓存要多占约 25 MB 内存，不值。

**结论：`bootstrap({ since })` 不做。** 现在一次写操作 115 ms（目标 < 200 ms），唯一超标的是
6 MB 载荷；那是极端的 20k 句段文档才会碰到，典型 500 句段只有 0.16 MB。真有大文档抱怨再单独做。

`_dev/test-tm-index.mjs`（第 51 个套件）把这次替换钉住：它内嵌一份改动前的暴力实现，
对 1152 组（query × threshold × limit）逐字段比对 `lookupTM` 的结果，并单独校验 ICE 等级。


### P3 顺手项（已完成，2026-11-10）

- ✅ `lib/store-utils.js`（40 个导出、23 个 importers）按职责拆成 `limits.js` / `lang.js` /
  `settings.js` / `text-utils.js` / `segment-state.js` / `restore.js`，43 个 import 由脚本改写；
- ✅ `lib/tools.js` 21 个工具的 `try/catch + failure()` 收敛成 `guard(spec)`，每个工具只剩 `run()`；
- ✅ 32 个死 i18n 键删除（621 → 589，三语同步），`locale/*.json` 只保留 `meta.*`，重复的
  `match.*` 交给 `check:locales` 的重叠校验兜住；
- ✅ `lib/import-export.js` → `lib/file-ops.js`（`fileMethods` / mixin 名 `files`）。

### P4 性能收尾（已完成，2026-11-10）

| 路径（20k 句段 / 10k TM） | 改前 | 改后 |
| --- | --- | --- |
| `importTM`（2000 对） | 70 ms（每条线性扫全表） | **37 ms**（identity 索引） |
| `confirmSegment()` | 92.9 ms | **70.7 ms**（不再整表拷贝 TM 做 undo） |
| `persist()` | 58 ms / 13.5 MB | **52 ms / 9.2 MB**（紧凑 JSON） |
| `API confirmSegment` 含回传 state | 115 ms | **103 ms** |

`upsertTM` 的 undo 从「拷贝整个 `tm` 数组」改成「记一行 `before` + `evictedAll`」：
写失败时 `undoTMWrite` 只回滚这一条，`_dev/test-tm*.mjs` 覆盖了成功与回滚两条路径。
`persist()` 不再缩进输出——几 MB 的 `store.json` 没人肉眼读，省下的 4MB 与 ~15ms 更实在。

### 明确不做

**不要把 `controller.js` 的 35 个 `useState` 按面板拆成多个 hook。** 现在 controller/view 的边界
是清楚的；再拆每个 hook 都要接 `data / busy / notify / report / adoptState / replaceRemoteState`
一长串依赖，只是把属性透传从组件层搬到 hook 层，同时引入 hook 顺序这种隐式契约。收益低、风险高。

## 3. 结构红线（新功能必须遵守）

细节见 `ARCHITECTURE.md` §4/§5，这里只列最容易被忘的四条：

1. **依赖方向**：`client/workbench/**` 不许 import `components/**`；`components/**` 不许 import
   `workbench/**`（`workbench.js` 除外）；`helpers/rpc/locales/react` 是叶子，不许 import 相对路径。
   `eslint` 的 `no-restricted-imports` 已经在守，别绕过。
2. **单一注册点**：新 RPC 要过 `createHandlers` + `MUTATIONS`；新 store 方法进已有的 `*Methods`
   模块（不要新建 mixin，也不要往 `store.js` 类体堆）；新格式进 `EXPORTERS` / import 表。
3. **新增文案走 `t(key, vars)`**，不许 `t(key).replace('{x}')`——`check:locales` 会查占位符一致性。
4. **改客户端必须 `npm run build:client`**，`check:client` 比对的是产物与源码是否一致。

提交纪律：一个提交一个主题、`npm run check` 全绿再提交、不做"顺手重构 + 功能"混合提交。

## 4. 自我校准：这一轮踩过的工具坑（硬性红线）

这一轮 18 个提交里，有两次"文件被我写坏"的事故，**都不是设计判断错，而是改文件的方式错**。
下一轮直接按下面的规则做，不要再重复：

1. **绝对不要用 PowerShell 的 `Set-Content` / `Get-Content | -replace | Set-Content` 改源码。**
   PS 5.1 按 ANSI 解码 UTF-8 文件：中文注释变 GBK 乱码、注释吞掉换行、`export function` 被并进
   注释行。本轮 `client/components/workbench.js` 与 `package.json` 各被弄坏一次。
2. **批量改写只走两条路**：单个位置用 `edit` / `write` 工具；成规模的机械改写写一个 Node 脚本
   （`readFileSync` / `writeFileSync`，`split(/\r?\n/)` 处理 CRLF，脚本放 `%TEMP%` 或
   `scripts/_*.mjs`，跑完即删）。
3. **不要用 `Get-Content | Out-String` 判断文件是否乱码。** 控制台解码会骗人：本轮曾误报
   「JA 字典乱码」「`lib/tools.js` 乱码」两次，实际文件都是合法 UTF-8。要判定就实测：
   `node -e` 或临时 `.mjs` 读文件数 U+FFFD，或直接看 `git diff`。
4. **多行提交信息用 `git commit -F <文件>`**，别在 pwsh 里内联长 message（PS 会把引号拆成 pathspec）。
5. **本机 pwsh 是 Low 完整性**：写 `.git` / 需要 node 写盘（prettier、build、git commit/push）时
   单次 `danger-full-access`；改工作区源码优先用 `edit`/`write` 工具，它走宿主进程不受这个限制。

## 5. 验收门槛（每批收尾都跑）

```bash
npm run check        # lint + format:check + locales + errors + store + formats + shared + api + client + test
npm run build:client # 改过 client/** 时
```

`check` 全绿才算做完；新增能力要配对应的契约检查或测试，不要只靠"我看了一眼"。

### 进度记录

| 日期 | 内容 | 提交 |
| --- | --- | --- |
| 2026-11-10 | 快照 `v.1.1.8_beta1` | `68403ad` + tag |
| 2026-11-10 | P1 错误消息 i18n：类别规则 + `describeError` + `check:errors` + `test-errors` | `cda9c5f` |
| 2026-11-10 | P2 基准与 TM 索引：`bench-scale.mjs`、`prepare/scoreCeiling`、`test-tm-index` | `5a10bf2`、`c6859bc` |
| 2026-11-10 | P3/P4：文档同步、tools 样板、死键、`file-ops.js`、utils 六拆、TM 写入索引、紧凑落盘 | 见 `git log` |
| 2026-11-10 | AI 审校 A+B：当前页/高风险分批、进度、取消、`indexes` 参数 | `8fcc6b2` |
| 2026-11-10 | AI 审校 C：报告落库、三态筛选、CSV/Markdown 导出、清空 | `2b49317` |

