# CAIT 架构说明

这份文档描述**当前**的代码形状与边界规则。重构路线、批次和验收标准在
[REFACTOR-PLAN.md](./REFACTOR-PLAN.md)，两者冲突时以路线图为准，并回来改这份文档。

## 1. 运行时形态

CAIT 是一个 DSH（Cordis）插件，同时提供 agent 工具和一块 Web 面板：

```
index.js  apply(ctx)
  ├─ new CatStore({ dataDir, mtRuntime })     服务端状态与全部业务逻辑
  ├─ registerCatTools(ctx, store)             agent 工具（lib/tools.js）
  └─ registerCatApi(ctx, store)               HTTP RPC（lib/api.js）
        └─ webServer.register('/cait/api')    同源校验 + JSON 信封
```

客户端源码在 `client/`，由 `scripts/build-client.mjs` 用 esbuild 打包成单文件 `client.js`
（外层仍是 DSH 的 `window.__ModuleLoader__.load` 契约，`react` 是 external）。
**`client.js` 不要手改**，改 `client/` 再构建。

## 2. 服务端分层

依赖方向自上而下，禁止反向 import：

| 层 | 模块 | 职责 |
| --- | --- | --- |
| 入口 | `index.js` | 组装、生命周期、卸载时 flush |
| 协议层 | `lib/api.js`、`lib/tools.js` | HTTP/工具的参数与错误信封，不含业务分支 |
| 状态层 | `lib/store.js` + `lib/store-mixins.js` 登记的 20 个方法模块 | `CatStore` 持有 `docs/tm/glossary/settings/revision`，接口由 mixin 挂到原型上 |
| 领域层 | `formats/localization/docx/xlsx/pptx/epub/qa/review/replace/...` | 纯函数或「只依赖传入参数」的模块 |
| 基础设施 | `lib/store-utils.js`、`lib/errors.js`、`lib/persistence.js` | 通用工具、错误类型、落盘与迁移 |

规则：

- 领域层不得 import `store.js`；需要 store 能力时由 store 传参进来。
- `store-utils.js` 只放纯函数与常量，不再接新职责（它已经是杂物抽屉，见路线图 Batch 2）。
- mixin 的所有权只在 `lib/store-mixins.js` 的 `STORE_MIXINS` 里登记一次；`applyMixins` 在装配时
  拒绝同名方法（含与 `CatStore` 类体重名），`npm run check:store` 会打印归属表，并在
  「模块导出了 `*Methods` 但没登记」时失败。
- **不要新增 mixin**。新方法写进已有的领域模块，或新建一个「接收 store 作为参数」的函数模块，
  由 store 里一行转发调用。mixins 目录只减不增。

## 3. 状态与持久化

`CatStore` 的内存状态是唯一事实来源：

- `docs[]`：打开的文档（含 `segments`、`brief`、`resources`、`history`）
- `tm[]` / `glossary[]`：记忆库与术语库（可挂载/卸载）
- `settings`：界面语言、TM 阈值、MT 路由等
- `revision`：每次写操作自增，客户端靠它判断是否需要重新拉取

`persist()` 把整份状态写入 `store.json`（tmp + rename 原子写，64MB 上限），
`restore()` 负责版本迁移。**加字段必须同时改迁移**，否则老用户的库会被静默丢字段。

`bootstrap()` 返回给客户端的是快照：文档列表 + 活动文档的全部句段。它目前是全量的，
Batch 3 会改成按 `revision` 增量下发。

## 4. 接口契约

一个 RPC 方法名会出现在三个地方，必须同时改：

1. `lib/store.js`（或其 mixin）里的实现
2. `lib/api.js` 的 `createHandlers` 表
3. 写操作还要登记进 `lib/api.js` 的 `MUTATIONS`（否则前端拿不到新 state）

`node scripts/check-api.mjs` 会核对：handler 指向的 store 方法存在、`MUTATIONS` 与 handler
对得上、客户端 `rpc('...')` 的方法名都存在。**动态方法名（三元/变量）无法静态核对**，
脚本会把它们打印出来，改动时要人工确认。

## 5. 客户端结构

`client/` 是真正的 ESM，依赖方向自上而下（`eslint.config.js` 用 `no-restricted-imports` 守着）：

```
client/index.js            注册 DSH 面板、i18n 适配（entry）
  ├─ workbench/controller.js  useWorkbenchController：全部状态与动作（数据层/动作层）
  ├─ workbench.js            纯视图：h() 树，只读 controller 的返回值
  └─ components/*.js         各界面：base/shell/rail/editor/panels/forms/dialogs/pages
        └─ helpers.js  rpc.js  locales.js  react.js   （叶子，不得 import 上层）
```

- `components/**` 不得 import `workbench/**`；`workbench/**` 不得 import `components/**`
  （唯一例外是 `components/workbench.js` 组合两者）。组件之间横向 import 只允许 `base.js`。
- `helpers.js` 是纯函数（分页、缩放、主题），`styles.js` 是一条 CSS 模板串 + 缩放，
  `rpc.js` 是 fetch 封装，`locales.js` 是三本字典 + `makeTranslator`（`t(key, vars)`）。
- 界面文案一律 `t('key', { name: value })`，不要用 `.replace('{name}', ...)`：
  `check:locales` 会校验三语占位符一致，手写 replace 会绕过这条检查。
- 新组件按界面归入 `components/` 下已有的文件；只有当现有文件出现第二个职责时才新建文件。

`Workbench` 的状态仍集中在一个 hook 里（35 个 `useState`），这是 Batch 1.3 的剩余项：
按面板拆成多个 hook，但 controller 对外暴露的字段名保持不变，视图层无需改动。

## 6. 测试

`_dev/test-*.mjs` 是独立进程的测试，`npm test` 逐个 spawn（输出写临时文件，
失败时打印末尾 40 行）。约定：

- 一个套件只测一个模块或一条链路，直接 `import` 被测模块，不启动 HTTP 服务
- 需要 store 时 `new CatStore({ dataDir: mkdtemp(...) })`，用完删目录
- 断言用 `node:assert/strict`，失败信息写清楚「期望/实际」
- 界面链路用 `_dev/lib/workbench-harness.mjs` 在 jsdom 里挂载 `client.js` 产物，配真实 store
  （`test-workbench-mount.mjs`、`test-workbench-flow.mjs` 是范例）

`npm run check` = lint + 格式检查 + 四个契约检查（locales/store/api/client）+ 全量测试，
CI 与 `prepublishOnly` 都跑它。

## 7. 加东西的标准动作

| 要做的事 | 改哪里 | 之后跑 |
| --- | --- | --- |
| 新 RPC | store 方法 → `createHandlers` → 写操作登记 `MUTATIONS` → 客户端 `rpc()` | `check:api` |
| 新 store 方法 | 加进对应的 `*Methods` 模块；**不要**新建 mixin，也**不要**往 `store.js` 类体堆 | `check:store` |
| 新界面文案 | `client/locales.js` 的 ZH/EN/JA 三处 | `check:locales` |
| 新导出格式 | Batch 4 之后加一条注册表项；当前先加 `import-export.js` 分支并补测试 | `npm test` |
| 新 store 字段 | 构造函数 → `persist()` → `restore()` 迁移 → `bootstrap()` | `npm test` |
| 改客户端 | `client/**` → `npm run build:client` | `check:client` + `npm test` |
