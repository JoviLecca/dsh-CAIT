# Changelog

All notable changes to CAIT are documented here. The project follows
[Semantic Versioning](https://semver.org/) and the format is based on
[Keep a Changelog](https://keepachangelog.com/).

## [1.1.5] - 2026-11-08

Project resources, delivery output, and TM upkeep: each document can bind its own
TM and glossary libraries, the workbench can price a job and hand off a bilingual
or XLIFF review package, and TM libraries can be merged, deduplicated, or pruned.

### Added

- **Per-document resources.** A document can inherit the global mounts or bind its
  own TM/glossary libraries and default write TM. Writes are checked against the
  document scope (`NO_TM_BOUND`, `TM_NOT_MOUNTED`, `TM_NOT_BOUND`), and deleting a
  library removes dangling document references.
- **Word count and leverage analysis.** `analyzeDocument` reports segments, words,
  characters, translated/confirmed counts, duplicates, ICE/exact/fuzzy/new buckets,
  match rate, and leverage. The workbench shows the breakdown and downloads it as
  CSV or JSON.
- **Bilingual review DOCX.** Export a three-column Source/Target/Status table for
  reviewers who do not use CAIT.
- **XLIFF 1.2 review packages.** Export carries the segment uid, target state, and
  a note; re-import applies only segments matched by uid, XLIFF id, or a unique
  source, refuses source mismatches, and reports unmatched entries.
- **TM maintenance.** Preview and confirm merge, deduplicate, and prune operations;
  merges preserve the target library and optionally delete the source.

### Changed

- Confirmations write to the document's default write TM when one is bound.
- TM lookup, glossary hits, QA term checks, and pre-translation all honor the
  document's effective resource scope.

## [1.1.4] - 2026-11-08

Brief and context: CAIT now carries a per-document translation brief and the
neighbouring source sentences into pre-translation and agent work, and lets a
reviewer undo a confirmation without losing the translation-memory record.

### Added

- **Document brief.** Six optional fields — domain, audience, tone, notes,
  do-not-translate terms, and a style sample — are stored with the document,
  editable from the workbench, and injected into single and batch MT prompts.
  Agents read and write it with `cat_get_brief` and `cat_set_brief`.
- **Context for agents.** `cat_get_context` returns the brief, the current
  segment, its previous/next source segments, and paragraph information, so an
  agent can resolve pronouns and omitted subjects before translating.
- **Context-aware batch pre-translation.** Pre-translation now sends up to eight
  segments per request with the brief and neighbouring source sentences, then
  falls back to one-segment calls for anything the model omits. A partial batch
  no longer aborts the document.
- **Terminology status.** Glossary entries can be marked `forbidden` (never use
  this rendering) or `preferred` (must use it when the source term appears).
  The flags survive CSV/JSON/TBX export, CSV import, the glossary UI, and
  `cat_add_terms`.
- **Risk-graded QA.** Findings are graded high / medium / low; forbidden terms
  and length drift are new checks. The report returns `risks` and `riskCounts`,
  and the rail can filter to segments that need attention.
- **QA panel and fixes.** A QA tab lists risk counts and findings with jump,
  copy-source, clear-target, and insert-term actions. A concordance tab and
  `cat_concordance` search every mounted TM for a word or phrase.
- **Undo confirmation.** `cat_unconfirm_segment` and the editor button revoke a
  confirmation, keep the text as a draft, and leave TM untouched. Editing a
  confirmed segment now revokes its confirmation automatically; confirming it
  again updates the same TM entry.
- **Stable segment identity.** Every segment gets a `uid`; the store schema moves
  to version 5 and migrates version 4 snapshots in place.
- **Bulk pre-translation cleanup.** The rail can clear every unconfirmed
  pre-translated or auto-propagated target in the document after a confirmation
  dialog that states the count and the MT/TM/auto breakdown. Confirmed segments,
  manual drafts, and saved TM entries are left untouched.

### Changed

- Pre-translation uses batched MT requests with per-segment fallback instead of
  one request per segment.
- `getQaReport` also reports `risks` and `riskCounts`; `counts` includes
  `TERM_FORBIDDEN` and `LENGTH_DRIFT`.
- `segmentView` includes `uid`; document summaries include `brief`; glossary CSV
  exports use seven columns including `forbidden` and `preferred`.

### Fixed

- Batch pre-translation now asks for stable segment ids and rejects ambiguous
  positional output; a dropped, merged, or renumbered entry falls back to
  one-segment calls instead of shifting later translations onto the wrong
  segment.
- `cat_concordance` renders the previous/next context of a match instead of
  assuming an array.
- TM and glossary toolbars now use the import/export icon in the direction the
  button actually moves data; the document toolbar follows the same convention.
- The library toolbar has an explicit **default write** selector again, and the
  scope checkboxes no longer silently choose which library receives new entries,
  imports, exports, or clears.
- Unconfirming a segment that was just auto-unconfirmed by saving an edit is
  treated as idempotent instead of showing a `NOT_CONFIRMED` error.

## [1.1.3] - 2026-11-07

Alignment, repetition and terminology: CAIT can now build a translation memory
out of two finished files, fill repeated sentences by itself, and propose
terminology with evidence instead of guessing.

### Added

- **Aligner.** Give it the source file and the translated file — two independent
  documents, different languages allowed — and it pairs them segment by segment.
  Scoring is cross-language: anchors (numbers, `{0}` placeholders, URLs,
  capitalised names), length normalised per language, and paragraph structure.
  Word-level similarity is deliberately not used, because it cannot compare two
  languages. Blocked dynamic programming admits 1:1, 1:0, 0:1, 2:1 and 1:2 pairs;
  rows are graded high / to-review / doubtful, and each row can be merged,
  split or removed before writing to a library.
- **`readUploadText`** reads text out of any supported upload (docx, epub, xlsx,
  pptx, html, csv, srt, vtt, po, json, rtf, xliff, markdown, plain text) without
  creating a document.
- **Automatic propagation.** Confirming a segment copies its translation into
  every other unconfirmed segment with the same source (`origin: auto`); editing
  a draft keeps those copies in sync. "Fill repeated segments" does the same for
  the whole document, and the rail only offers it when something would change.
- **Terminology mining.** `lib/term-extract.js` counts candidates — Latin word
  n-grams and repeated CJK substrings filtered by boundary entropy — and ranks
  them C-value style. The library workspace lists them with occurrence counts,
  existing glossary hits and any wording translation memory already contains.
- **Agent tools** `cat_propose_translation`, `cat_align`,
  `cat_consistency_report`, `cat_term_candidates` and `cat_add_terms`.

### Changed

- QA gained two checks: `UNTRANSLATED_RESIDUE` (the target is still the source)
  and `INCONSISTENT_TARGET` (one source, several translations). Both are advisory
  and never block confirming or exporting.
- `proposeTranslation` writes only a `suggestion` plus its reason, never the
  target: an agent can propose, the user keeps the last word.
- The fuzzy-match threshold now defaults to **70%** instead of 55%: below that a
  match usually shares only function words, so showing it costs review time and
  saves none. Settings explains this and offers a **Reset** button that appears
  only while the slider sits away from the default.

### Fixed

- Editing one copy of a repeated sentence no longer leaves its siblings stale.

## [1.1.2] - 2026-11-07

Context-aware translation memory: the same sentence can now keep one
translation per surrounding text, and an exact context match scores 101%.

### Added

- **Context matches (ICE).** Every confirmation stores the two neighbouring
  source segments with the entry, hashed into `contextHash`. When a segment is
  looked up with the same neighbours, it scores **101%** and is graded
  `context`; a text match with different neighbours stays at 100%. Covered in
  the review panel by a 101% badge and a `previous · next` line under the source.
- **Pre-translation uses context.** The block loop resolves ICE first, falls back
  to the generic entry, then to machine translation, and each filled segment
  reports `ice: true`, which `cat_pre_translate` summarises.
- **Library context column.** The library workspace shows each TM entry's
  neighbouring text, so variants of one source can be told apart.

### Changed

- Translation memory is keyed by `(library, language pair, normalised source,
  contextHash)` instead of the source alone. `addTM` / `importTM` without a
  context write the generic variant; confirming a segment writes its variant.
- Each key keeps at most 8 context variants; the oldest is evicted (the
  generic entry never is).
- TMX export writes `<prop type="x-context">` and import reads it back, so
  context survives a round-trip; TMX import now dedupes by key **and** context.
- Store version 4. Version 1–3 stores load unchanged: entries get a null
  context, which behaves exactly like before.

## [1.1.1] - 2026-11-07

A library workspace that works without a document open.

### Added

- **Library workspace.** A new top-level view (topbar `Documents` / `Libraries`)
  browses every translation-memory entry and glossary term, whether or not a
  document is open and whether or not the library is mounted. It pages through
  entries, filters by language, scopes the search to any combination of
  libraries, and edits entries in a side panel without leaving the table.
- **Library exports.** A translation-memory library exports to TMX and a
  glossary exports to TBX, CSV, or JSON, straight from the workspace.
- **Segment pagination.** The segment rail pages through filtered segments with a
  20/50/100/200 page size (remembered in `localStorage`) and accepts a typed
  segment number to jump to, clearing the filter when the target is hidden.
- **Panel-to-library jump.** The right panel's library button opens the workspace
  with the panel's current search text (and the glossary tab) applied, so looking
  something up in the panel continues in the full list.

### Changed

- The glossary tab no longer dumps the mounted glossary into the side panel with
  a hard 200-term cut-off. It lists only the terms that match the current
  segment and links to the workspace for everything else.
- Glossary entries can be edited or deleted in libraries that are not mounted;
  mounting a library is still the explicit toggle it was.

## [1.1.0] - 2026-11-07

Agent-assisted pre-translation and a stacked review workbench.

### Added

- **Pre-translation.** `cat_pre_translate` (and the `preTranslate` RPC) fills a
  block of segments from exact translation-memory matches first, then machine
  translation, in small concurrent batches. Confirmed segments and segments that
  already carry a target are skipped, so repeated or interrupted runs never
  overwrite human work. The workbench adds a topbar button that walks the
  document block by block, shows `done/total`, and can be stopped between blocks.
- **Stacked review.** The editor lays source, the machine/agent baseline, and the
  editable target out top to bottom, so each block gets the full pane width. The
  baseline is stored on `suggestion`, so editing the target always has the
  original to compare against.
- **Suggestion adoption.** `adoptSuggestion` copies a suggestion into the target
  while keeping its origin and the suggestion itself for later comparison.
- **Batch reading and confirmation for agents.** `cat_get_segments` lists a
  bounded window with status, origin, and suggestions; `cat_confirm_segments`
  confirms a list of indices or every segment awaiting review, reporting what it
  skipped instead of guessing.
- **Advisory QA.** A derived report flags missing placeholders/tags, mismatched
  numbers, unused glossary terms, and segments marked as translated but empty.
  Issues appear as a marker in the segment rail and as a banner in the export
  dialog; they never block an export and nothing is written to disk.
- **Translation memory and library maintenance.** Single TM entries can be
  edited or deleted from the match cards, and TM/glossary libraries can be
  renamed or deleted (the last library of a kind stays protected).
- **Theme adaptation.** The workbench follows the host light/dark theme: the
  root sets `color-scheme` (so native selects, checkboxes, and scrollbars match),
  primary button labels use the inverted label token, and the segment rail search
  now also matches suggestions.

### Changed

- Segments move through three states — `pending`, `translated`, `confirmed` —
  with `origin` (`tm`/`mt`/`agent`/`manual`) recording who produced the text.
  Progress now separates "awaiting review" from "pending" instead of counting
  both as unfinished.
- The store format is version 3. Versions 1 and 2 still load and migrate in
  place; a version-2 draft with text but no confirmation becomes `translated`
  with `origin: manual`.
- UI scaling is damped above the design size (`1 + (fit - 1) × 0.6`, capped at
  1.45×) so a maximized window no longer grows the interface far beyond the host
  UI.
- MT route discovery no longer filters providers by what the loader configuration
  happens to mention: every registered provider is listed, configured ones first,
  and providers without models stay visible but disabled.

### Fixed

- Adding a custom model provider no longer hides the built-in DeepSeek route from
  the model-route list.
- The selected segment and an unsaved draft are now persisted (debounced, plus a
  flush on unload) instead of only travelling along with unrelated writes.
- The primary button label no longer uses a surface token, which produced
  unreadable text in the dark theme.

## [1.0.5] - 2026-11-06

EPUB support, an import preprocessing stage, and format hardening.

### Added

- EPUB 3 import and export. Import walks the OPF spine, turns XHTML text blocks
  into segments, and keeps inline tags as placeholder tokens; export patches the
  translations back into the retained source package, preserving chapters,
  styles, images, and navigation. Documents created from plain text export as a
  fresh EPUB 3 package. DRM, fixed-layout, and scripted EPUBs are out of scope.
- Import preprocessing: whitespace normalization, invisible/control character
  stripping, and blank-line collapsing before segmentation. Each step has a
  settings toggle, applies to file imports and `createDocument`, and is stored
  with the other settings.
- A shared HTML/XHTML run scanner (`lib/html.js`) used by both HTML and EPUB, so
  headings and inline markup survive import and are patched back on export.
- CSV delimiter detection (comma, semicolon, tab, pipe) and richer RTF escapes
  (`\cell`, `\row`, `\page`, `\sect`, symbol characters).

### Changed

- PDF import is explicitly out of scope. All three READMEs explain why PDF is a
  poor fit for AI-assisted translation and recommend converting it with pandoc,
  Acrobat, or LibreOffice first.
- The supported-formats table, project layout, roadmap, and “Known limits”
  sections now describe EPUB, preprocessing, and the PDF policy.

### Fixed

- Settings persistence now stores `uiLang` and the preprocessing flags instead of
  falling back to defaults on reload.
- The EPUB `mimetype` entry is written uncompressed, as the OCF specification
  requires, and every other entry stays deflated.
- HTML import no longer flattens headings and inline markup into blank-line
  paragraphs.

### Development

- New `_dev/test-epub.mjs` and `_dev/test-preprocess.mjs` suites; the full suite
  count is 15.

## [1.0.4] - 2026-11-05

Provenance publishing.

### Added

- `README.md`, `README.zh-CN.md` and `README.ja.md` carry the live npm badge, so
  the package page and the repository show the published version.

### Changed

- Releases from this version on are produced by `.github/workflows/publish.yml`,
  which attaches npm provenance and validates the GitHub trusted publisher.
  `npm publish` from a local checkout still works and still asks for an OTP.

## [1.0.3] - 2026-11-05

npm distribution.

### Added

- The package can now be installed from the npm registry:
  `plugin_manager install_bundle target: dsh-cait` in DSH Desktop, or
  `dsh plugin --profile <name> add dsh-cait`. Pin a release with
  `dsh-cait@1.0.3`; the GitHub and local-checkout routes still work.
- `engines.dsh` (`>=0.2.2-rc.1`), so the plugin manager refuses an older host
  with a compatibility report instead of a broken mount.
- `publishConfig.access: public`, an `author` field, and the `dsh-plugin` /
  `cordis` keywords for the registry listing.
- `prepublishOnly` rebuilds the client bundle and syntax-checks it, so a
  release cannot ship a stale `client.js`.
- `.github/workflows/publish.yml` publishes a GitHub release through npm
  Trusted Publishing with `--provenance`; it checks the tag against
  `package.json`, runs the whole test suite, and never stores an npm token.
- `@deepseek-ai/schemastery` is a `devDependency` as well as a peer dependency,
  so a fresh checkout can run the tests.

### Changed

- `README.ja.md` ships in the package (`files`).
- The README install section leads with the npm route and keeps the GitHub and
  local-checkout routes as alternatives.
- The repository no longer tracks `node_modules/`; packed tarballs are ignored.

### Removed

- `"private": true`, which blocked `npm publish`.

## [1.0.2] - 2026-11-04

Interface-language fix.

### Added

- Japanese README (`README.ja.md`), linked from the language switcher of all
  three READMEs and listed in the project layout.

### Fixed

- **Follow DSH language** now follows the DSH locale instead of staying on
  English. The client plugin declared only `slots` in its inject list, so
  Cordis rejected the `ctx.locale` access with a throw that the registration
  `try`/`catch` swallowed: the DSH-bound translator stayed `null`, every lookup
  fell through to the English dictionary, and a Simplified-Chinese DSH looked
  English. `locale` is now a declared dependency.
- `auto` resolves the locale service snapshot itself (`zh-CN` → `zh`,
  `ja-JP` → `ja`, `en-US` → `en`) before consulting the DSH-bound translator,
  so a locale tag without a registered fallback chain no longer degrades to
  English. The export `resolveUiLang` covers this mapping.
- The workbench and the sidebar label subscribe to DSH locale changes, so
  switching the DSH language while `auto` is selected re-renders CAIT
  immediately instead of requiring a reload.

## [1.0.1] - 2026-11-04

UI languages and license metadata.

### Added

- Japanese (`ja`) UI dictionary. The workbench now ships three interface
  languages: Simplified Chinese, English, and Japanese.
- **Settings → Interface → Interface language**, with *Follow DSH language*
  (default), 简体中文, English, and 日本語. The choice is stored as
  `settings.uiLang` in the CAIT store, applies to the workbench and the sidebar
  label immediately, and only affects the CAIT interface — document source and
  target languages are untouched.
- `NOTICE`, the attribution supplement for Apache-2.0 (section 4(d)), and an
  explicit `license` field in `package.json`.

### Changed

- `LICENSE` appendix copyright line now reads `Copyright 2026 Jovi Lecca`.
- Version bumped to `1.0.1` (`package.json`, `CAIT_VERSION`, and the exported
  document metadata move together).
- Verified against DSH `0.2.2-rc.1`; the README badges and development notes use
  that version.

### Fixed

- `saveSettings` rejects an unsupported interface language with
  `INVALID_UI_LANG` instead of silently storing it.

## [1.0.0] - 2026-11-04

First public release. CAIT was developed as `0.1.0` and renumbered to `1.0.0`
for the first GitHub release.

The npm package and Cordis entry are named `dsh-cait`; the UI entry, data
directory (`$DSH_HOME/cait`), and API route (`/cait/api`) keep the CAIT name.

### Highlights

- A complete CAT workbench inside DeepSeek Harness: sidebar entry, main panel,
  segment list/editor, TM/glossary/MT side panel, and export flow.
- Seven agent tools that share the exact store used by the UI.
- Multiple TM and glossary libraries with mounted-only lookup and default write
  targets.
- Format-preserving DOCX and PPTX export, plus a broad text, subtitle,
  localization, and Office format matrix.
- Persistence with atomic snapshots, corrupt-file recovery, strict confirm
  writes, and revision polling between agents and the open workbench.

### Added

#### Plugin and UI

- Host + Client bundle structure (`index.js`, `client.js`, `cordis.patch.yml`,
  `package.json`, locale metadata, icon).
- New two-bubble A/文 icon: a bilingual speech-bubble pair that reads as
  source/target, used both for the package icon and the DSH sidebar mark.
- Left-sidebar entry `cait` and main panel `cait`; all styling uses DSH
  `--dsw-alias-*` theme tokens.
- English and Chinese UI dictionaries; plugin metadata locales.
- Workbench with document tabs, segment rail, source highlighting, glossary
  chips, target editor, confirm/next/previous/draft actions, progress, and
  responsive density scaling from 1× to 1.8×.
- Document tabs with close, reopen, new-page import, duplicate-import reuse,
  and a recent-document cleanup dialog for one or all closed documents.
- Settings modal for source/target languages, fuzzy threshold, TM result limit,
  MT route/model/temperature, and library mounts.
- Lightweight **库 / Libraries** modal to create, mount, and choose default TM
  and glossary libraries.
- Visual save-failure/stale banner and a two-second revision poll so
  agent-triggered document switches and confirmations appear in an open
  workbench without discarding a dirty draft.

#### Translation memory and glossary

- Multiple TM libraries with id, name, mount state, default write library, and
  per-library deduplication.
- Graded TM matching: `exact`, independent `near_exact` (ignores digits,
  punctuation, and whitespace), `high_fuzzy >= 0.85`,
  `medium_fuzzy 0.75–0.85`, `low_fuzzy < 0.75` above the configurable floor.
- Lexical fuzzy scoring: character-bigram Dice (72%) + token Jaccard (28%);
  Latin words and CJK characters are tokenized separately.
- Multiple glossary libraries, source-language filtering, live highlighting,
  click-to-insert terms, case-sensitive terms, CSV/TSV import, and notes.
- Mounted-only lookups in the UI and tools; unmounted write targets are rejected
  with `TM_NOT_MOUNTED` / `GLOSSARY_NOT_MOUNTED`.
- Clear operations default to mounted libraries, accept explicit mounted ids, and
  require `all: true` plus `confirm: true` to clear every library.
- Canonical language tags via `Intl.getCanonicalLocales` (`EN` → `en`,
  `ZH_cn` → `zh-CN`).

#### Agent tools

- `cat_get_segment` — current segment, TM matches, glossary hits.
- `cat_submit_translation` — confirm target, optional mounted `targetTmId`,
  write to TM, advance.
- `cat_lookup_tm` — mounted-library graded lookup.
- `cat_lookup_glossary` — mounted glossary query with language/case handling.
- `cat_list_documents` — document list and progress.
- `cat_switch_document` — switch active document.
- `cat_suggest_mt` — MT through the selected DSH route, or explicit offline
  glossary-substitution fallback.

#### MT

- MT provider-route selector built from `ctx.llm.listProviders()` and
  `ctx.llm.listModels()`, optionally filtered by `ctx.loader.entries()`.
- Calls through `ctx.llm.stream()`; concatenates `text-delta` chunks only.
- No CAIT-managed `baseUrl` or API key; DSH resolves credentials.
- Explicit offline fallback labelled **术语替换（离线） / Glossary substitution
  (offline)** (internal id `mock`) when no route/model is available.
- Host-only detailed logging of stream failures; clients receive the generic
  `MT_PROVIDER_FAILED`.

#### Persistence and configuration

- Schemastery `dataDir` config; default `$DSH_HOME/cait` or `~/.dsh/cait`.
- Versioned JSON snapshot (`version: 2`) containing documents, segments, open-tab
  ids, TM, glossary, libraries, mounts, and non-secret settings.
- Atomic temp-file + rename writes; strict confirm writes that roll back on disk
  failure and return `PERSISTENCE_FAILED` (503); best-effort structural writes
  with a visible storage-error banner.
- Corrupt/unknown-version snapshots are backed up as
  `store.json.corrupt-<timestamp>` and replaced with empty state.
- v1 → v2 migration to default TM/glossary libraries.
- DOCX and PPTX source sidecars under `sources/<document-id>.*` for
  format-preserving export; sidecars are removed when the document is deleted.
- Open tabs and `activeDocId` persist; draft text and per-document cursor do not.
- Duplicate import guard based on SHA-256 of languages, source, format, and
  exchange metadata.

#### Formats

- TXT, Markdown, DOCX body text, TMX 1.4, CSV, SRT, WebVTT, PO, XLIFF 1.2,
  basic XLIFF 2.0, basic SDLXLIFF, HTML, JSON string paths, XLSX, PPTX, and RTF
  import.
- Target-only TXT/Markdown/HTML/RTF/SRT/WebVTT export; bilingual
  Markdown/CSV/TMX; document exports for PO, XLIFF, XLSX, and PPTX;
  current-document JSON; structure-preserving JSON; DOCX source-package export.
- CSV column mapping by header name or 1-based number.
- SRT/VTT cue timing/settings/identifier metadata; semantic inline tags retained;
  invalid ranges rejected; untimed cues follow the previous cue end + 2 s.
- PO contexts, plural forms, translator comments, and obsolete `#~` entries.
- XLIFF inline placeholders converted to `{n}` tokens and expanded back on
  export; confirmation rejects dropped tokens with `PLACEHOLDER_MISMATCH`.
- DOCX export patches translated text into the original package, preserving
  paragraph/run properties, styles, numbering, images, headers, tables, and
  layout.
- PPTX export patches translated body text into the retained source package,
  preserving slides, masters, shapes, images, and layout.
- XLSX two-column Source/Target workbook import/export.
- JSON original-template preservation through `formatMeta.jsonTemplate`.

#### API and security

- Same-origin JSON bridge at `GET /cait/api/health` and
  `POST /cait/api/rpc`.
- `ctx.connection.requestRejection` browser/Origin check.
- 32 MB body limit (`413 BODY_TOO_LARGE`), JSON content-type check, and
  allow-listed handlers.
- `clearTM` / `clearGlossary` require `confirm: true` (`409
  CONFIRMATION_REQUIRED` otherwise).
- No API key in the browser, snapshot, RPC response, or logs.

### Changed

- Renamed the UI fallback from “mock” to **术语替换（离线） / Glossary
  substitution (offline)** while keeping internal ids compatible.
- Replaced CAIT-managed OpenAI-compatible HTTP calls with DSH provider routes.
- Split the 1,718-line `lib/store.js` into a `CatStore` facade plus
  `libraries.js`, `tm.js`, `glossary.js`, `persistence.js`,
  `import-export.js`, `store-utils.js`, and `errors.js`.
- Split the Web UI into `client/helpers.js`, `rpc.js`, `styles.js`,
  `components.js`, `locales.js`, and `entry.js`; `client.js` is now generated by
  `scripts/build-client.mjs`.
- JSON export was renamed from a purported “project backup” to
  `*.document.json` (current document only); structured JSON export is a
  separate `json-tree` format.
- Subtitle export now renumbers cues in file order and maintains a monotonic
  cursor for untimed cues instead of overlapping `index * 2s`.
- Removed the never-incremented `usageCount` TM metric.
- `cat_submit_translation` now returns `tm.count` as the mounted count and
  `tm.total` as the all-library count.
- Open documents persist `openDocIds` and `activeDocId`; settings persist, but
  drafts, cursor, and library-modal UI state do not.
- API key and endpoint fields were removed from settings; `publicSettings()`
  exposes only route/model/temperature.
- README rewritten for GitHub; this changelog added.

### Fixed

- Mount checkbox was disabled for every unmounted library when only one was
  mounted; unmounted libraries are now selectable and only the last mounted one
  is protected.
- `loadDemo()` TM entries were not persisted; demo state now survives reload.
- Save errors were swallowed and confirmations could report success without a
  disk write; strict confirm + rollback + banner now surface the failure.
- Agent-driven document switches/confirmations were invisible in an open
  workbench; revision polling and stale/draft handling fixed this.
- DOCX table paragraphs were flattened into the body text despite the docs; table
  blocks are now excluded during import.
- TMX inline `bpt/ept/ph` markup was silently dropped; imports now return a
  `TMX_INLINE_MARKUP_LOST` warning with a count.
- Glossary language matching was case-sensitive in hits but case-insensitive in
  the tool; both paths now canonicalize.
- XLIFF placeholders, PO plurals/comments/obsolete blocks, and subtitle semantic
  tags were dropped in earlier adapters; all are preserved now.
- Subtitle zero/negative-duration cues were silently rewritten; they now fail
  with an explicit parse error.
- Duplicate imports always created a new document; identical content now reuses
  the existing document.
- Closed documents could not be cleaned up; the recent-documents dialog can now
  delete one or all closed documents.
- `cat_lookup_glossary` parameter text still claimed case-insensitive matching
  after case-sensitive support was added; corrected.
- PPTX export no longer silently emits an unformatted deck when the source
  package is missing; it returns `PPTX_SOURCE_REQUIRED`.
- JSON `formatMeta.jsonTemplate`, XLSX metadata, and PPTX source sidecars were
  not preserved through reload in the first integration pass; fixed and tested.
- Save-label text was invisible in the settings modal because the generic button
  reset overrode `.cait-btn-primary`; fixed and covered by the mount test.

### Security

- Removed the CAIT-managed `baseUrl` and API key path, eliminating the SSRF /
  keyless-regex / remote-error-body findings from the audit.
- MT failures expose only `MT_PROVIDER_FAILED`; provider/model/code/status stay in
  the Host log.
- All RPC calls retain the DSH Origin/browser-trust check; clear methods require
  explicit confirmation.
- Snapshot excludes API keys by design; MT credentials remain inside DSH.

### Tests

- 13 suites: `test-core`, `test-imports`, `test-formats`,
  `test-second-tier`, `test-docx-export`, `test-api`, `test-plugin`,
  `test-persistence`, `test-documents`, `test-libraries`, `test-mounts`,
  `test-ui-scale`, and `test-mt`.
- Coverage includes TM grading and boundaries, multi-library mounts,
  mounted-only lookup, unmounted-target rejection, clear scope/confirmation,
  corruption fallback, v1 migration, strict persistence rollback, demo reload,
  document tabs/dedupe/delete, DOCX/XLSX/PPTX source preservation, CSV mapping,
  SRT/VTT timelines, PO plurals/comments/obsolete, XLIFF 1.2/2.0 placeholders,
  second-tier round-trips, API 413/403/404/409/415, and UI helper logic.
- Fixtures: `sample.docx`, `sample-table.docx`, `sample-format.docx` with
  `make-*.py` regeneration scripts.

### Documentation

- Replaced the long development README with a GitHub-oriented README: badges,
  quick start, feature overview, format matrix, install paths, configuration,
  tools, architecture, development, security, and limits.
- Added this changelog and set `package.json` version to `1.0.0`.
- Added a complete Simplified Chinese README (`README.zh-CN.md`) and a language
  switcher; the English README now contains English-only prose and UI labels.

### Known limitations

- No PDF, EPUB, or image/OCR import yet; no PDF layout-preserving export.
- DOCX: tables, headers/footers, footnotes, fields, alt text, and tracked
  deletions are not imported; mixed-run translation inherits the first run style.
- PPTX: body text only; notes, charts, SmartArt, and fields are not imported.
- XLSX: two-column table only; styles, formulas, merged cells, images, and extra
  sheets are not preserved.
- HTML/RTF export does not round-trip original styling; JSON only translates
  string values.
- TM matching is lexical, not semantic.
- Library rename/delete and per-tab mount state are not part of v1.0.0.
- Persistence is one snapshot with last-write-wins semantics, not a multi-user
  journal.
- No browser pixel/click test is included; the generated client is validated by
  `node --check`, helper tests, and plugin slot activation.

## Development history

| Date | Milestone |
| --- | --- |
| 2026-11-03 | Plugin skeleton, Host/Client split, CAT store, segmentation, TM, glossary, three tools, workbench UI, TXT/MD/DOCX/TMX import/export, mock MT. |
| 2026-11-03 | Persistence layer (`dataDir`, v1 snapshot, atomic writes, corrupt fallback), `tmId`/`glossaryId` reservations, reload/corruption tests. |
| 2026-11-03 | Graded `matchType` (`exact`/`near_exact`/three fuzzy bands) with locale labels and boundary tests. |
| 2026-11-03 | Four additional agent tools (`cat_lookup_glossary`, `cat_list_documents`, `cat_switch_document`, `cat_suggest_mt`). |
| 2026-11-03 | Multi-library TM/glossary mounts, `targetTmId`, v1→v2 migration, library modal, mounted-only semantics. |
| 2026-11-03 | Read-only audit and hardening: mount checkbox, MT route reuse, clear confirmation, mounted write boundaries, strict persistence, revision polling, language/metadata fixes, store/client split. |
| 2026-11-04 | Document tabs, close/reopen, duplicate fingerprint, recent-document cleanup. |
| 2026-11-04 | Source-format-preserving DOCX export with sidecar storage and fixtures. |
| 2026-11-04 | First-tier exchange formats: CSV mapping, SRT, WebVTT, PO, XLIFF 1.2, metadata persistence, timeline fixes. |
| 2026-11-04 | Second-tier formats: HTML, JSON, XLSX, PPTX, RTF; binary upload/export; source-preserving PPTX. |
| 2026-11-04 | Responsive UI density 1×–1.8×; button contrast fix; v1.0.0 release. |
| 2026-11-06 | EPUB 3 import/export with source-package patching, shared HTML/XHTML scanner, import preprocessing stage, CSV/RTF hardening, PDF out of scope; v1.0.5 release. |
