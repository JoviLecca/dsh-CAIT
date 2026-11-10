# CAIT 代码结构治理方案（1.1.7 之后）

> 本文是 2026-11 全量代码审计之后的结构治理路线，替代「想到哪改到哪」。
> 三个硬约束：**功能零回归**、**每一步可独立验证/回退**、**后续增删功能不破坏结构**。
> 进度以本文末尾的表格为准，每完成一项就勾掉。

## 1. 目标与非目标

目标：

1. 把「一个 1728 行的 Workbench + 一份 423KB 手拼 bundle」拆成有边界、可单独测试的模块。
2. 把「每次写操作回传整份状态」改成增量同步。
3. 把 21 个 mixin 拼成的 god object 改成显式组合、可静态发现的 store。
4. 把两条 200~400 行的格式 if 链改成注册表，新增格式只改一个文件。
5. 补上工程护栏：格式化、lint、单测入口、CI、接口清单校验、i18n 键校验。

非目标（本轮不做）：

- 不加新功能、不改 UI 交互、不改存储格式（除非迁移代码本身就是重构对象）。
- 不重写业务逻辑。重构的定义是「行为不变的前提下换形状」，任何行为差异都算 bug。
- 不追求 100% 测试覆盖，只要求「改动过的模块有测试，新增模块必须有测试」。

## 2. 现状基线（审计结论）

| 项 | 数值 |
| --- | --- |
| `client/components.js` | 6069 行，30 个组件 |
| `Workbench` 单组件 | 1728 行，38 个 `useState`、15 个 `useEffect`、66 个闭包 |
| `lib/store.js` | 1325 行，`Object.assign` 拼 21 个 mixin |
| `lib/api.js` | 74 个 handler + 52 项手写 `MUTATIONS` |
| 客户端 rpc 方法 | 64 个，字符串散落在组件里 |
| 重复实现 | `escapeRegExp`×3、`paragraphText`×3、`extractInline/renderInline`×2、`formatError`×2、`patchParagraph`×2、`csvCell`×2 |
| 测试 | 45 个 `_dev/test-*.mjs` 全绿，但 24 个 lib 模块没有任何测试直接 import |
| 护栏 | 无 lint、无 format、无 test 脚本、无 CI 测试 |

## 3. 分批路线

顺序按「先止漏 → 再拆最烫的 → 改协议 → 拆服务端 → 收格式层」排列。
每批结束都必须 `npm run check` 全绿才进入下一批。

### Batch 0 — 工程护栏（先做）

没有护栏就动 13K 行代码，等于闭眼改。本批只加工具，不改业务。

- 0.1 依赖：`prettier`、`eslint` + `@eslint/js` + `globals`、`esbuild`（为 Batch 1 预装）。
- 0.2 配置：`.prettierrc.json`（无分号/单引号/2 空格/CRLF）、`.prettierignore`、`eslint.config.js`、`.editorconfig`、`.gitattributes`（`client.js` 标记为生成物）。
- 0.3 校验脚本（全部零依赖，Node 直接跑）：
  - `scripts/run-tests.mjs`：串行执行 `_dev/test-*.mjs`，失败即非零退出。
  - `scripts/check-client.mjs`：重新构建并与 `client.js` 比对，防止「改了源码忘了 build」。
  - `scripts/check-locales.mjs`：ZH/EN/JA 键齐平、缺失键、疑似未使用键。
  - `scripts/check-api.mjs`：客户端 `rpc('x')` 的每个 `x` 必须在服务端 handler 表里；`MUTATIONS` 必须覆盖所有写方法。
- 0.4 npm scripts：`lint` / `format` / `format:check` / `test` / `check` / `build:client`。
- 0.5 CI：`.github/workflows/ci.yml`，push/PR 跑 `npm ci && npm run check`。
- 0.6 `docs/ARCHITECTURE.md`：目标结构、依赖方向、扩展点。

验收：

- `npm run check` 全绿；45 个既有测试仍全绿。
- 格式化提交用 `git diff --ignore-all-space` 验证只有空白变化。

### Batch 1 — 客户端模块化（最烫的一块）

- 1.1 打包器从「六段字符串拼接」换成 esbuild：
  - 输入 `client/index.js`（ESM），输出仍包在 `window.__ModuleLoader__.load({ id:'dsh-cait', factory(require){...} })` 里；
  - `react` 保持 external，由 factory 的 `require` 注入；
  - `__test` 导出保持不变（现有 4 个 vm 契约测试直接受益）。
- 1.2 目录切分：

  ```
  client/
    index.js            # export default { name, inject, apply, __test }
    core/               # 纯函数：分页、缩放、主题、常量、格式化
    i18n/               # 字典 + makeTranslator + interpolate
    transport/          # rpc、文件下载、剪贴板
    styles/             # CSS 片段（构建时拼接）
    components/         # 展示组件，一文件一个
    workbench/          # Workbench 与其 hooks / 命令表 / 弹窗
  ```

- 1.3 Workbench 拆 hook：
  - `useServerState`：`data + revision`，统一 `applyServerState(result, { resetDraft })`；
  - `useDraft`：草稿、dirty、撤销栈（650ms 合并、上限 200）；
  - `useSync`：轮询、首次 bootstrap、可见性；
  - `useActions`：把 24 段 `setBusy/try/catch/finally` 收成一个 `runAction(name, fn)`；
  - `useModals`、`useCommands`：弹窗状态与命令面板；
  - 组件通过 `WorkbenchContext` 取 `t/busy/data`，不再 40 个 prop 往下传。
- 1.4 i18n 收口：`t(key, vars)` 支持插值，清掉 17 处 `.replace('{count}', …)`。
- 1.5 顺手消除 3 处 `escapeRegExp` 重复（客户端只保留一份）。

验收：

- 4 个 bundle 契约测试（mounts/pagination/theme-tokens/ui-scale）不改一行仍通过；
- 45 个既有测试全绿；
- `npm run lint` 覆盖 `client/`，无 `no-undef`/`no-unused-vars` 错误；
- Workbench ≤ 400 行，单文件组件 ≤ 500 行；
- 新增 `_dev/test-client-*.mjs` 覆盖 reducer 与 `runAction`。

### Batch 3 — 增量同步（提到 Batch 2 之前）

客户端拆完后，服务端改动更容易验证；而增量同步会改 RPC 契约，先改协议再拆服务端，能少改一遍。

- 3.1 `bootstrap({ since, documentId })`：
  - 无 `since`：保持现在的全量结构（旧客户端兼容）；
  - 有 `since` 且 `revision` 未变：返回 `{ revision, unchanged: true }`（<200B）；
  - 有 `since` 且已变：返回 `{ revision, documents: [...], active: {...}, removed: [...] }`。
- 3.2 客户端 `applyServerState` 支持增量合并（按 `documentId` upsert，按 `revision` 丢弃乱序响应）。
- 3.3 2 秒轮询与预翻译的每块刷新都改走增量。
- 3.4 大文件：导入/附件不再走 32MB base64 JSON，评估改为原始 body 上传（单独小批次，可延后）。

验收：

- 轮询空转的响应体 < 200B（用测试断言）；
- 旧请求（无 `since`）返回结构不变；
- 新增 `_dev/test-sync.mjs` 覆盖增量合并与乱序丢弃。

### Batch 2 — 服务端拆分

- 2.1 `composeMethods(target, methods, { name })`：显式组合 + 重名即抛错，替代裸 `Object.assign`。
- 2.2 `store.js` 瘦身：把文档/句段核心（`createDocument`/`documentView`/`bootstrap` 等）抽到 `lib/documents.js`，`store.js` 只留状态、持久化接线、组合。
- 2.3 `store-utils.js`（40 个导出、6 类职责）拆成 `lib/limits.js`、`lib/lang.js`、`lib/restore.js`、`lib/export-cells.js`。
- 2.4 给 24 个没有测试的模块补最小 smoke test（走 store 的公开方法即可）。

验收：

- `store.js` ≤ 300 行；
- 任一 mixin 重名会在 import 期抛错（有测试）；
- `store-utils.js` 不再被 23 个模块直接 import（改为按职责导入）。

### Batch 4 — 格式注册表

- 4.1 `lib/formats/registry.js`：每项 `{ id, label, extensions, canImport, canExport, parse, build }`。
- 4.2 `import-export.js` 的 218 行导入链、369 行导出链改成查表 + 统一适配。
- 4.3 每个格式一条 round-trip 测试（parse → build → parse）。

验收：

- 新增一种格式 = 新建一个文件 + 注册表加一行，不改 `import-export.js`；
- 现有全部格式测试通过（docx/xlsx/pptx/epub/csv/srt/vtt/po/xliff/html/json/rtf/tmx/strings）。

## 4. 结构约定（未来增删功能必须遵守）

这一节是「不破坏结构」的规则来源，新功能 PR 按此检查。

### 4.1 依赖方向

```
client:  components → workbench(hooks) → transport → core
         i18n 可被任意层引用，但不得反向依赖 components
lib:     api/tools → store → domain modules → infra(store-utils/persistence)
         禁止反向 import；禁止 lib 依赖 client
```

用 ESLint `no-restricted-imports` + 依赖图脚本守护，出现反向边 CI 失败。

### 4.2 单一注册点

| 要加的东西 | 唯一改动点 | 守护 |
| --- | --- | --- |
| RPC 方法 | `lib/api.js` 的 `METHODS` 表（名字、handler、是否 mutation） | `check-api` |
| 导入/导出格式 | `lib/formats/registry.js` 一行 | round-trip 测试 |
| UI 面板 | `client/components/` 新文件 + `panels.js` 注册 | lint 未使用导出 |
| 界面文案 | `client/i18n/{zh,en,ja}.js` 三份同时加 | `check-locales` |
| 测试 | `_dev/test-*.mjs` 放进目录即可 | `run-tests` 自动收集 |

### 4.3 删功能的流程

1. 先标 `/** @deprecated since 1.x */`，RPC 别名保留一个 minor 版本；
2. `check-api` 报出「客户端已无引用」的服务端方法；
3. 再删实现 + 删注册项 + 删文案（三语一起）；
4. CI 必须仍然全绿。

### 4.4 提交与验收

- 一批一个 commit（过大时按「纯格式化 / 纯移动 / 行为变更」拆开），提交信息 `refactor(batchN): …`。
- 纯移动的 commit 只允许改路径和 import，便于 review 时 `--follow`。
- 任何行为变化必须单独成 commit 并附测试。

## 5. 验收命令

```bash
npm run check     # format:check + lint + check:client + check:locales + check:api + test
npm run build:client
npm run test
```

CI 与本地跑同一套命令，避免「本地过、CI 挂」。

## 6. 进度

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| 0 | 工程护栏 | 进行中 |
| 1 | 客户端模块化 | 未开始 |
| 3 | 增量同步 | 未开始 |
| 2 | 服务端拆分 | 未开始 |
| 4 | 格式注册表 | 未开始 |

> 每批完成后在此表更新状态，并补一行「验收记录」（命令、日期、结果）。
