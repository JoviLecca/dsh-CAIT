<p align="center">
  <img src="icon.svg" width="76" alt="CAIT 图标" />
</p>

<h1 align="center">CAIT</h1>

<p align="center">
  <strong>在 DeepSeek Harness 中完成计算机辅助翻译。</strong><br/>
  翻译记忆 · 术语库 · 句段编辑器 · 机器翻译辅助 · 文档标签页 · Office / 字幕 / 本地化格式
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="版本 1.0.0" src="https://img.shields.io/badge/version-1.0.0-blue.svg" />
  <img alt="DSH 0.2.x" src="https://img.shields.io/badge/DSH-0.2.x-4d6bfe.svg" />
  <img alt="13 套测试" src="https://img.shields.io/badge/tests-13%20suites-brightgreen.svg" />
  <img alt="无需 API Key" src="https://img.shields.io/badge/API%20key-not%20required-6b7280.svg" />
</p>

CAIT 为 DSH Web UI 和 DSH 桌面端增加一个 CAT 翻译工作台。它从左侧栏入口打开，
工作台与七个 Agent 工具共用一个数据存储，覆盖从导入源文件到导出译文的完整流程。

> **已在 DSH `0.2.1-rc.5` 中验证。** CAIT 使用 DSH 自己的模型路由和凭据，
> 不会要求用户填写 API Key。内部回退提供方仍叫 `mock`，界面显示为
> **术语替换（离线）**。

## 为什么选择 CAIT

| | |
|---|---|
| **原生集成 DSH** | 真正的侧栏入口、主工作台、DSH 主题令牌，以及人和 Agent 共用的同一份数据。不是 iframe，也不是另一个独立应用。 |
| **可解释的翻译记忆** | 支持多个 TM 库、仅检索已挂载库、精确/近似精确/高/中/低模糊等级，确认句段时自动写回。 |
| **术语感知编辑** | 支持多个术语库、按源语言过滤、行内高亮、点击插入术语，以及按术语设置是否区分大小写。 |
| **完整文档流程** | 文档标签页、关闭/重新打开、最近文档清理、重复导入复用、逐文档进度。 |
| **真实格式覆盖** | TXT、Markdown、DOCX、TMX、CSV、SRT/VTT、PO、XLIFF 1.2/2.0/SDLXLIFF、HTML、JSON、XLSX、PPTX、RTF。 |
| **面向 Agent** | 七个工具共享当前文档和存储，Agent 可以与用户同时翻译。 |

## 快速开始

1. 安装 CAIT，然后从左侧栏的 **CAIT** 入口打开。
2. 选择 **新开页面**，拖入源文件或粘贴文本。
3. 设置源语言和目标语言。
4. 翻译当前句段；右侧面板会显示 TM 匹配、术语命中和 MT 建议。
5. 点击 **确认并下一句**，句对会写入默认挂载的 TM。
6. 导出纯译文、双语对照，或保留源格式的文档。

编辑器中的输入只是草稿，保存在内存里。确认句段（或执行明确的结构性修改）时
才会写入快照。打开的工作台每两秒轮询一次 Host revision，因此 Agent 触发的修改
无需手动刷新即可出现。

## 功能

### 翻译记忆

- 支持多个 TM 库，每个库有 id、名称、挂载状态和默认写入库。
- 支持精确、近似精确和三个模糊等级：
  - `near_exact` 使用忽略数字、标点和空白后的 key 比较，不依赖分数阈值。
  - `high_fuzzy` 为 `>= 0.85`，`medium_fuzzy` 为 `0.75–0.85`，
    `low_fuzzy` 低于 `0.75`（高于可配置下限，默认 `0.55`）。
- 模糊评分是词法级的：72% 字符二元组 Dice + 28% token Jaccard。
  拉丁文本按单词切分，CJK 文本按单字切分；不做词干、同义词或语义匹配。
- 检索只查已挂载的库。`cat_submit_translation` 支持可选 `targetTmId`；
  未挂载的目标库会以 `TM_NOT_MOUNTED` 拒绝写入。
- `bootstrap().tm.entries` 是已挂载条目的 40 条预览；
  `bootstrap().tm.count` 是已挂载数量，`bootstrap().tm.total` 是所有库的总数。
  完整数据请使用 `cat_lookup_tm` 或库面板。
- 支持 TMX 1.4 `<tu>/<tuv>/<seg>` 导入/导出。TMX 内联占位符会扁平化为
  纯文本，并给出明确警告。

### 术语库

- 支持多个术语库，每个库有挂载状态和默认写入库。
- 源文行内高亮，点击术语 chip 即可插入。
- 支持 CSV/TSV 导入、术语备注、源语言过滤，以及工作台和
  `cat_lookup_glossary` 都遵循的 `caseSensitive` 标记。
- 语言代码会规范化（`EN` → `en`，`ZH_cn` → `zh-CN`）。

### 工作台

- 按段落/句子切分，并逐句编辑译文。
- 支持保存草稿、确认并下一句、上一句/下一句导航和进度。
- 文档标签页；关闭标签页不会删除文档。
- **打开已有文档** 可重新打开已关闭的文档。
- 下拉框旁的垃圾桶按钮可删除一个或全部已关闭文档；删除是永久性的，
  不会影响 TM、术语库或其他文档。
- 同格式、同内容的再次导入会复用已有文档，而不是新建重复文档。
  指纹覆盖语言、源文、格式和交换元数据。
- 响应式密度：工作台测量自身 DSH 面板，并应用 1×–1.8× 的 `--cait-u`
  缩放系数。1600×900 面板约为 1.32×，2560×1440 面板为 1.8×；
  窗口较矮时保持 1×，不会继续缩小。

### MT 辅助

CAIT 不持有 endpoint 或 key，选择器完全来自 DSH：

- `ctx.llm.listProviders()` 提供已注册的提供方路由。
- 可用时通过 `ctx.loader.entries()` 查询 `config.providers`。
- `ctx.llm.listModels(provider)` 提供模型 id；CAIT 默认选择第一个模型。
- `ctx.llm.stream({ provider, model, messages, temperature, purpose: 'cait-mt' })`
  执行调用；CAIT 只拼接 `text-delta` chunk。

如果没有可用路由、所选路由消失或没有模型，CAIT 会回退到离线术语替换，
并在 UI 和 `cat_suggest_mt` 结果中明确说明。流式调用失败时，Host 日志记录
provider/model/code/status，客户端只会收到 `MT_PROVIDER_FAILED`。

## 支持的格式

| 格式 | 导入 | 导出 | 说明 |
| --- | :---: | :---: | --- |
| TXT / Markdown | ✅ | ✅ | 按段落和句子切分 |
| CSV | ✅ | ✅ | 可通过表头名称或从 1 开始的列号指定源/目标列；现有双语导出 |
| DOCX | ✅ | ✅ | 正文段落；导入时排除表格块。导出会修改原包，保留样式、编号、图片、页眉、表格和版式。 |
| TMX 1.4 | ✅ | ✅ | 常见 `<tu>/<tuv>/<seg>` 子集；内联标记扁平化并警告 |
| SRT / WebVTT | ✅ | ✅ | 一个字幕 cue 对应一个句段；保留时间轴/设置/标识；保留语义标签；非法时间范围会拒绝 |
| PO | ✅ | ✅ | 支持上下文、复数形式、译者注释和废弃 `#~` 条目 |
| XLIFF 1.2 | ✅ | ✅ | 内联标签转换为 `{n}` token；缺少 token 时阻止确认 |
| XLIFF 2.0 | ✅ | ✅ | 基础 `<unit><segment><source>/<target>` 子集 |
| SDLXLIFF | ✅ | ✅ | 走基础 XLIFF 1.2 路径；SDL 专有扩展不会完整往返 |
| HTML | ✅ | ✅ | 仅文本块；不保留原始标记/CSS |
| JSON | ✅ | ✅ | 字符串路径子集；通过模板保留对象/数组结构；key 和数字不翻译 |
| XLSX | ✅ | ✅ | 第一个工作表；识别 `Source`/`Target` 表头或 A/B 列；导出为新的两列表格 |
| PPTX | ✅ | ✅* | 保留源格式导出；需要导入时保留的 `.pptx` 包。仅正文；备注/图表/SmartArt 不导入。 |
| RTF | ✅ | ✅ | 基础段落、`\uN`、`\'hh`、控制字；不往返原始样式 |

\* 如果保留的源包不存在，PPTX 导出会以 `PPTX_SOURCE_REQUIRED` 失败，
而不是静默生成一个没有格式的演示文稿。

交换元数据（字幕时间轴、PO 上下文/复数/注释、XLIFF id 和内联 token 映射、
JSON 路径/模板、XLSX 行号、PPTX 幻灯片/段落位置）会保存在文档/句段上，
并随快照持久化。

## 安装

### DSH 桌面端

通过应用内插件管理器安装本地包（`desktop` 配置档由 Electron 应用管理）。
等价的 Agent 调用是：

```text
plugin_manager install_bundle target: /absolute/path/to/dsh-CAIT
```

然后重新加载 DSH。左侧栏会出现 **CAIT** 入口。

### `dsh` CLI（Web / CLI 管理的配置档）

```sh
git clone <this-repository> dsh-CAIT
dsh plugin --profile web add /absolute/path/to/dsh-CAIT
```

将 `web` 替换为你的配置档名称。如果 Host 需要重启，请重启 `dsh web`。
桌面端应用管理自己的配置档；请通过应用的插件页面或 plugin manager 安装，
不要使用 CLI 配置档。

### 从源码安装

```sh
git clone <this-repository> dsh-CAIT
cd dsh-CAIT
npm run build:client
```

本地 `--patch` 覆盖层可以添加一行指向当前目录：

```yaml
# _dev/cait.patch.yml
- insert:
    - id: cait-dev
      name: 'C:\absolute\path\to\dsh-CAIT'
```

```powershell
dsh web --patch C:\absolute\path\to\dsh-CAIT\_dev\cait.patch.yml
```

`--patch` 是启动器选项；放在应用名（`web`）之后、应用自身参数之前。
覆盖层和配置档中已安装的 bundle 二选一，不要同时使用。

## 配置

| 选项 | 默认值 | 含义 |
| --- | --- | --- |
| `dataDir` | `""` | `store.json` 和 `sources/` 的目录。为空时使用 `$DSH_HOME/cait`。支持绝对路径、相对路径和 `~/...`。 |

```yaml
- id: cait
  name: cait
  config:
    dataDir: 'D:\CAT\cait-data'
```

快照保存文档、打开的标签页、TM、术语库、库、挂载关系和非敏感设置。
导入的 DOCX/PPTX 源包放在 `sources/` 下。

句段确认使用严格写入：如果快照无法写入，确认会以 `PERSISTENCE_FAILED`（503）
失败，并回滚内存中的确认。其他结构性修改采用尽力写入，并通过工作台横幅显示
`bootstrap().storage.error`。

如果快照损坏或版本未知，CAIT 会记录警告，将其移动到
`store.json.corrupt-<timestamp>`，然后以空状态启动，而不是让插件激活失败。
版本 1 快照会迁移到版本 2，并创建默认 TM 和术语库。

## Agent 工具

| 工具 | 用途 |
| --- | --- |
| `cat_get_segment` | 获取当前句段及 TM 匹配、术语命中 |
| `cat_submit_translation` | 确认译文，写入已挂载 TM（可选 `targetTmId`），前进到下一句 |
| `cat_lookup_tm` | 在已挂载库中按等级检索 TM |
| `cat_lookup_glossary` | 查询已挂载术语库；遵循 `caseSensitive` |
| `cat_list_documents` | 列出文档和进度 |
| `cat_switch_document` | 选择活动文档 |
| `cat_suggest_mt` | 通过所选 DSH 路由调用 MT，或使用明确的离线回退 |

工作台和工具共用一个 `CatStore`，因此 Agent 可以翻译用户当前打开的同一份文档。

## 架构

```mermaid
flowchart LR
  UI["DSH Web UI<br/>(侧栏 + 工作台)"] --> Client["client.js<br/>生成的 Web bundle"]
  Client --> API["/cait/api/rpc<br/>同源 JSON"]
  Tools["7 个 Agent 工具"] --> Store["CatStore"]
  API --> Store
  Store --> Snapshot[("store.json<br/>+ sources/")]
```

- **Host**（`index.js`、`lib/`）负责存储、持久化、导入/导出、工具和私有 API。
- **Client**（`client/`）是通过 DSH 模块加载器加载的普通 React，渲染到
  `sidebar.panellist` 和 `main`。样式只使用 `--dsw-alias-*` 令牌。
- `client.js` 是生成文件；请修改 `client/*.js`，然后运行 `npm run build:client`。

<details>
<summary><strong>项目结构</strong></summary>

```text
cait/
├─ package.json
├─ cordis.patch.yml
├─ index.js                 # Host 端
├─ client.js                # 生成的 Web bundle
├─ client/                  # helpers、styles、RPC、components、locales、entry
├─ scripts/build-client.mjs
├─ icon.svg
├─ locale/{en,zh}.json
├─ README.md
├─ README.zh-CN.md
├─ CHANGELOG.md
├─ lib/
│  ├─ store.js              # CatStore 门面 + 文档/句段核心
│  ├─ errors.js
│  ├─ store-utils.js
│  ├─ libraries.js          # TM/术语库注册表 + 挂载
│  ├─ tm.js
│  ├─ glossary.js
│  ├─ persistence.js
│  ├─ import-export.js
│  ├─ formats.js            # CSV/SRT/VTT/PO/XLIFF/HTML/JSON/RTF
│  ├─ xlsx.js
│  ├─ pptx.js
│  ├─ segmenter.js
│  ├─ similarity.js
│  ├─ tmx.js
│  ├─ docx.js
│  ├─ markdown.js
│  ├─ xml.js
│  ├─ mt.js
│  ├─ tools.js
│  └─ api.js
└─ _dev/                    # 测试、fixture、本地 patch 覆盖层
```

</details>

## 开发

需要 Node.js 22+ 和 DSH `0.2.x`。已在 DSH `0.2.1-rc.5`、Node `26.7.0`
中测试。

```sh
npm run build:client
node --check client.js

node _dev/test-core.mjs
node _dev/test-imports.mjs
node _dev/test-formats.mjs
node _dev/test-second-tier.mjs
node _dev/test-docx-export.mjs
node _dev/test-api.mjs
node _dev/test-plugin.mjs
node _dev/test-persistence.mjs
node _dev/test-documents.mjs
node _dev/test-libraries.mjs
node _dev/test-mounts.mjs
node _dev/test-ui-scale.mjs
node _dev/test-mt.mjs
```

导入/导出 fixture 为 `_dev/sample.docx`、`_dev/sample-table.docx` 和
`_dev/sample-format.docx`；可用对应的 `python _dev/make-*.py` 脚本重新生成。
13 套测试应全部通过。

## 安全模型

- Host API 挂载在 `/cait/api`，通过 `ctx.connection.requestRejection`
  限制为同源/受信任请求。
- RPC 请求体为 JSON，上限 32 MB；超过时返回 `413 BODY_TOO_LARGE`。
- `clearTM` / `clearGlossary` 除了浏览器信任检查外，还要求
  `params.confirm === true`；UI 会在发送前询问。
- CAIT 从不接收、存储或返回 API Key。DSH 凭据保留在所选提供方适配器内部。
- 持久化使用单个快照，语义为最后写入者获胜；它不是多用户日志。

## 已知限制与路线图

- 暂不支持 PDF、EPUB 或图片 OCR 导入。
- DOCX 导入会跳过表格、页眉、脚注、域、替代文本和修订删除内容。
  DOCX 导出时这些区域保持源语言。
- DOCX/PPTX 中混合 run 的段落会继承第一个 run 的格式。
- PPTX 导入只覆盖正文，不包含备注、图表或 SmartArt。
- XLSX 导入/导出是两列表格；不保留单元格样式、公式、合并单元格、图片和额外工作表。
- HTML/RTF 导出不往返原始样式；JSON 只翻译字符串值。
- TM 匹配是词法级的，不是语义级；没有词干、同义词或向量。
- 库重命名/删除和逐标签页挂载状态不属于 v1.0.0。
- 工作台界面为中英双语；README 提供英文和简体中文两个版本。

后续计划：PDF 与 EPUB 适配器、通过多模态 DSH 路由支持图片/视觉输入、
更完整的库管理、保留样式的 XLSX 输出，以及 XLIFF `<alt-trans>` / 注释支持。

## 变更日志与版本

见 [CHANGELOG.md](CHANGELOG.md)。`v1.0.0` 是首个公开发布版本；项目在开发阶段
使用 `0.1.0`，发布到 GitHub 前统一改为 `1.0.0`。

> **License：** 当前尚未包含 `LICENSE` 文件。发布或分发前请先添加。
