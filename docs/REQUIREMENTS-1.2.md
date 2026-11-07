# CAIT 1.2 需求：上下文感知的翻译记忆

> 状态：**草案，未开发**
> 基线：`v1.1.0`（`bb5c403`）
> 目标版本：`1.2.0`
> 关联：`docs/REQUIREMENTS-1.1.1.md`（库管理，先做）

## 一、为什么做

1.1.0 之后 CAIT 的记忆库在「写入时机」和「管理面」上已经接近主流 CAT 工具，但有一个结构差距：

**同一句原文只能存一条译文。**

`lib/tm.js:18-31` 用 `key = normalizeText(source)` 做唯一索引，同库 + 同语言对 + 同 key 命中就覆盖译文。后果是「Close」在按钮上和在菜单标题上只能有一个译法，谁最后确认谁赢。下一句遇到相反的场景，要么手动改回来（然后下次又被打回去），要么干脆不用这条记忆。

主流 CAT 工具（Trados / memoQ）解决这个问题的办法是上下文匹配：一个 TU 可以有多条，每条记录前后句段；检索时上下文一致的给 101%（ICE），只有当前句一致的给 100%。

这一版要把这层补上，顺带把「匹配分级」从四档扩到五档，让 101% 在界面上有位置。

## 二、现状与差距

| 能力 | 现状 | 位置 |
| --- | --- | --- |
| TM 条目字段 | `id / tmId / key / source / target / sourceLang / targetLang / createdAt / updatedAt`，无上下文 | `lib/tm.js:32-42` |
| 唯一性 | `key` 即规范化原文，同库同语言对覆盖 | `lib/tm.js:18-31` |
| 匹配分级 | `exact` / `near_exact`（忽略数字与标点）/ `high_fuzzy` ≥0.85 / `medium_fuzzy` ≥0.75 / `low_fuzzy` | `lib/similarity.js:47-54` |
| 检索 | `lookupTM` 按 score 倒序，平分时按 `updatedAt` 倒序 | `lib/tm.js:118-140` |
| 预翻译 | 只吃**精确命中**，`tmExactIndex` 建 `normalizeText(source) → entry` 单值 Map | `lib/pre-translate.js` |
| TMX 导入 | 只取 `<seg>` 文本，丢掉全部 `<prop>`；逐条 `upsertTM`，重复原文会被合并 | `lib/tmx.js:20-64`、`lib/import-export.js:138-149` |
| TMX 导出 | 只写 `<tu>/<tuv>/<seg>`，无 `<prop>` | `lib/tmx.js:66-80` |

结论：**上下文这一层完全没有，连字段都没有**；而 TMX 往返会把多上下文条目压回一条，所以只加字段不够，导入导出要一起动。

## 三、设计

### 3.1 数据模型（STORE_VERSION 3 → 4）

TM 条目增加两个字段：

```js
{
  id, tmId, key, source, target, sourceLang, targetLang,
  context: { prev: '<规范化前句>', next: '<规范化后句>' } | null,
  contextHash: '<8 位十六进制>' | null,
  createdAt, updatedAt,
}
```

- `context` 只在「从文档确认写入」时记录；手工新增、TMX 导入（无 prop）、CSV 导入一律为 `null`。
- `contextHash` 是 `prev + '\u0001' + next` 的短哈希（FNV-1a 32 位即可，不需要加密强度），用于索引与去重，`context` 原文保留供界面显示与导出。
- 唯一性从 `key` 升级为 `(tmId, sourceLang, targetLang, key, contextHash)`。`contextHash === null` 的旧条目不参与 ICE，只参与 100% 及以下。
- 每个 `(tmId, key, 语言对)` 下**上下文条目上限 8 条**，超出时淘汰 `updatedAt` 最旧的一条，并在返回值的 `warnings` 里说明（不静默丢）。

### 3.2 上下文指纹

```js
function contextOf(doc, index) {
  const prev = index > 0 ? normalizeText(doc.segments[index - 1].source) : '';
  const next = index < doc.segments.length - 1 ? normalizeText(doc.segments[index + 1].source) : '';
  if (!prev && !next) return { prev: '', next: '', hash: null }; // 单句文档不产生 ICE
  return { prev, next, hash: fnv1a(prev + '\u0001' + next) };
}
```

规则：
- 只用**源文**，不用译文；只用相邻一句，不扩窗（扩窗收益低、误判高）。
- 首段/末段的空侧用空串参与哈希，因此「文档第一句」本身也是一种上下文——连续两篇都以同一句开头时会命中，这是可接受的。
- 段落切分变化会让上下文失配，退回 100%，不报错。

### 3.3 匹配与排序

`lookupTM` 返回值增加两个字段：`contextHash`、`contextMatch`（`'ice' | 'same-document' | null`）。

排序改为三段：

1. `contextMatch === 'ice'`（上下文哈希相等且非 null）→ 101%
2. `exact`（key 相等）→ 100%
3. 其余按 `score` 倒序；平分时 `contextMatch === 'same-document'`（同文档的条目）优先，再按 `updatedAt` 倒序。

`percent` 的计算：ICE 显示 101，`exact` 显示 100，其余 `Math.round(score * 100)`。
`classifyMatchType` 增加 `'context'` 档，阈值逻辑不动（`lib/similarity.js:47-54` 保持原样，只在上层前置 ICE 判断）。

**不做**：模糊匹配的上下文加权。模糊本来就是在猜，叠加上下文只会让分数更难解释。

### 3.4 写入路径

- `confirmSegment`（`lib/store.js:460`）在 `upsertTM` 时传入 `contextOf(doc, index)`。
- `adoptSuggestion` 采纳后不额外写 TM（保持现状，确认时才写）。
- `preTranslate` 的 `tmExactIndex` 改为按 `(key, contextHash)` 建索引：先找 ICE，再找 `contextHash === null` 的通用条目；命中 ICE 的段 `origin` 仍是 `'tm'`，但返回结构里多一个 `ice: true` 供工具文案使用。
- `updateTM`（手工改译文）保留原 `context`，不清空；`deleteTM` 不变。
- 新增 `clearTmContext({ id })`？**不做**，1.2 不提供单独清上下文；要清就删了重加。

### 3.5 迁移 v3 → v4

`lib/persistence.js` 的 `restoreSegments` 同级增加 TM 条目归一化：

- 缺 `context`/`contextHash` 的条目补 `null`，其余字段不变；
- 版本号写回 4；
- v1/v2/v3 全部可读（沿用现有 `payload.version !== 1 && !== 2 && !== 3 && !== STORE_VERSION` 的写法，改成白名单集合更清楚）。

迁移是**纯增量**：旧条目全部 `contextHash = null`，行为与 1.1.0 完全一致，直到用户重新确认句段。不需要回填历史文档的上下文（回填需要重新打开每篇文档并把整库重写一遍，风险大于收益）。

### 3.6 TMX 往返

- 导出：`<tu>` 内写 `<prop type="x-context">prev\u0001next</prop>`（标准允许 `x-` 前缀自定义 prop，其他工具会原样保留或忽略）。`contextHash` 不导出，导入时重算。
- 导入：`parseTmx` 解析 `<tu>` 下的 `<prop type="x-context">`，拆回 `prev/next`；无 prop 的 TU 得到 `null`。
- **导入去重必须改**：`importTmx` 目前逐条 `upsertTM` 会把同 key 的多条上下文条目合并成一条（最后一条赢）。改为按 `(key, contextHash)` upsert，与 3.1 的唯一性一致。
- 兼容性验证：导出的 TMX 用 1.1.0 的 `parseTmx` 读，`units` 数量不变、文本不变（prop 被忽略），所以老版本读新文件不会报错。

### 3.7 体积

上下文让每条 TM 条目多出约 2 倍源文长度的字符。按 20,000 条、平均 40 字估算，约 1.6MB 额外，`MAX_STORE_BYTES = 64MB` 仍有余量。若逼近上限，先在 `persist()` 里截断 `context.prev/next` 到 160 字符（哈希不变），不删条目。

## 四、界面

1. **匹配卡**（`client/components.js` `TmMatchCard`）：`101% · 上下文匹配` 徽标，下方一行小字 `前：…｜后：…`（各截 20 字，`text-overflow: ellipsis`）；100% 且无上下文的条目不显示这一行。
2. **并列排序**：同一句段返回多条时按 3.3 顺序渲染，101% 永远在最上；不超过 `settings.tmLimit`（默认 5）。
3. **库页面条目行**（1.1.1 交付）：增加「上下文」列，`null` 显示 `—`，有值时显示 `前… / 后…` 的截断文本，hover 显示全文。
4. **配色**：`'context'` 档徽标用主色描边，其余档维持现有灰阶；不新增颜色令牌。

## 五、API 变更

| 方法 | 变更 |
| --- | --- |
| `lookupTM` | 返回项增加 `contextHash`、`contextMatch`；`matchType` 可能出现 `'context'` |
| `upsertTM` | 接受第 6 个参数 `context`（内部调用方传，工具层不暴露） |
| `preTranslate` | 返回段信息增加 `ice` 布尔；`tm` 模式下 ICE 也算命中 |
| `importTmx` | 解析 `<prop type="x-context">`，按新唯一性去重 |
| `exportDocument`（`format: 'tmx'`） | 写 `x-context` prop |
| `listTmEntries`（1.1.1 新增） | 返回项增加 `context` |

无新增 mutation。`MUTATIONS` 集合不变。

## 六、测试

新增 `_dev/test-tm-context.mjs`（目标 10 节）：

1. 同句在不同上下文确认两次 → 库里两条，互不覆盖。
2. 回到第一个上下文 → `lookupTM` 首条为 `matchType: 'context'`、`percent: 101`。
3. 上下文不同但当前句相同 → 100%，不是 101。
4. 单句文档确认 → `contextHash: null`，永远只能 100%。
5. 每 key 超过 8 条上下文 → 淘汰最旧一条并返回 warning。
6. v3 存档迁移：旧条目 `contextHash === null`，`version` 写回 4，行为不变。
7. TMX 导出含 `x-context`，重新导入后条目数不变、101% 仍成立。
8. 用 1.1.0 的 `parseTmx` 读新导出文件（直接 import 老解析逻辑断言 units 数）→ 不报错。
9. `preTranslate` 在 `tm` 模式下优先填 ICE 段，返回 `ice: true`。
10. 手工 `updateTM` 改译文后 `context` 保留。

回归：22 个既有套件全绿，尤其 `test-three-state`、`test-pretranslate`、`test-formats`、`test-e2e-1.1`。

## 七、不做

- 语义/向量匹配、同义词表。
- 模糊匹配的上下文加权。
- 按客户/项目/领域的 TM 字段与筛选（另开一版）。
- 术语库的上下文（术语是全局约定，加上下文只会让维护更难）。
- 从历史文档批量回填上下文。
- 上下文的手工编辑。

## 八、估时

| 项 | 天 |
| --- | --- |
| 3.1 数据模型 + 3.5 迁移 | 1–1.5 |
| 3.2 指纹 + 3.3 匹配排序 | 1–1.5 |
| 3.4 写入路径 + 淘汰策略 | 0.5 |
| 3.6 TMX 往返 + 导入去重改造 | 1 |
| 四、界面（匹配卡 + 徽标） | 0.5–1 |
| 六、测试 | 0.5–1 |
| **合计** | **4.5–6.5** |

## 九、风险

| 风险 | 应对 |
| --- | --- |
| 上下文把 100% 变成 101%，老用户觉得「分数变高了但译文不对」 | 101% 只在前后句都一致时给；界面写明「上下文匹配」，不是「更准确的匹配」 |
| 同 key 条目变多，库页面/导出看起来重复 | 条目行显示上下文摘要；导出带 prop，可追溯来源 |
| 导入去重改动波及 TMX 与 CSV 两条路径 | CSV 无上下文列，行为不变；只改 TMX 路径并补第 7、8 节测试 |
| 存档体积增长 | 3.7 的截断策略；`MAX_STORE_BYTES` 保持 64MB |

## 十、顺手修

**已勘误（2026-11-07）**：源码里并没有乱码。`lib/tmx.js:53` 的 `message` 是正确的
中文，`lib/store-utils.js:368` 的中文表头正则也一样。之前看到的乱码来自
`pwsh Get-Content`：控制台按本地代码页显示 UTF-8，只影响**显示**，文件本身没有问题。

结论与做法：

- 判断中文文件内容一律用 `read` / `grep` 工具，不要用 `Get-Content` 的屏幕输出下结论。
- 改写中文文件只用 `edit` / `write`，不要用 `Set-Content`（会写成 ANSI 并损坏文件）。
- 因此 1.2 不需要改这个字符串；若想留一道防线，可以在 1.2 的测试里断言
  `lib/tmx.js` 的这条 message 含「内联占位符」等关键片段即可，不必再做编码转换。
