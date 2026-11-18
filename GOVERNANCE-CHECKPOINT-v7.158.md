# GOVERNANCE-CHECKPOINT v7.158

> 日期：2026-11-18 · 基线：v7.157 → v7.158
> 性质：唐诗三百首 EPUB 排版修复——中文分页禁则、成对标点保护、诗歌/评注的非强制两端对齐。

## 实机复现

在《唐诗三百首新注（典藏版）》（上海古籍）实机翻到「无题」评注页，看到新页第一行是孤立的 `》则以为唐人七律……`。DOM 显示该段为 `.jfPrintContinuation`，说明不是书源文字丢失，而是分页引擎在一个长段内按字符 offset 切割，恰好切在 `《大历诗略》` 的 `《` 与 `》` 之间。另见诗行继承 `text-align:justify`，在行内脚注标记附近有不必要的拉伸风险。

## 修复

1. `src/client/scripts/98d-page-engine.js`：
   - 新增 `KS_CLOSER`/`KS_OPENER`/`KS_PAIRS` 与 `ksPairStart`；
   - `snapKinsokuOffset`：不允许页首出现 `，。！？；：、）》】』」〕〉”’`，不允许页尾悬空 `《【『「（〔〈“‘`，切点落在成对标点内部时把整对移到下一页；
   - `splitCandidates`：从合法切点向前寻找最多 8 个合法候选，不再把原始非法 offset 作为 fallback；
   - 保留原有 Range 字符守恒、图片守恒、两行 widow/orphan 与组合测量校验；无布局 DOM 变化，无字符丢失/重复。
2. `src/client/styles/41-reading.css`：唐诗 EPUB 的诗歌段落与评注块显式 `text-justify:none`、`word-spacing:normal`；诗歌继续左对齐，避免中文短诗和内联注释标记被两端对齐拉散；测量探针与可见叶共用规则。
3. 新增 `tests/paged-kinsoku-v7158.js`：覆盖切点落在 `《大历诗略》` 内部、切点紧邻 `》` 两类情形，断言成对标点不拆、页首无收尾标点、页尾无悬空开标点、字符严格守恒；加入 `test:reading-controls` 与独立 `test:paged-kinsoku`。

## 实际执行的验证

- `node tests/paged-kinsoku-v7158.js`：PASS。
- `node tests/paged-composition-v778.js`：PASS。
- `node tests/paged-forward-boundary-v7103.js`：PASS。
- `node tests/reader-semantic-pagination-v7118.js`：PASS。
- `node tests/reader-incremental-pagination-v7119.js`：PASS。
- `node tests/reader-paginator-measure-v7123.js`：PASS。
- `node tests/reader-prepared-faces-v7122.js`：PASS。
- `node scripts/build.js`：PASS，`sourceSha256=51a94c76e68d8027…`，`htmlBytes=19,360,116`。
- 重启 3865 后实机重新打开《唐诗三百首新注》，连续抽查 10 次下一章；当前可见页的 `jfSheetBody` 均没有以收尾标点开头，违规列表为空。
- 截图：修复前 `page-2026-11-18T05-27-30-599Z.png`（孤立 `》`）；修复后 `page-2026-11-18T06-09-55-321Z.png`（诗文、评析、辑评节奏正常）。

## 未做的验证

- 尚未用 iPad 真设备验收字号、页宽与实际字体渲染；
- 右双引号/复杂嵌套书名号的长段落仅通过合成夹具验证，未逐本实机穷举；
- 唐诗另一册《中华经典藏书》已打开核对首屏和诗行，但尚未连续抽查十页。

## 影响面

`src/client/scripts/98d-page-engine.js`（分页切点）、`src/client/styles/41-reading.css`（诗歌/评注排版）、`tests/paged-kinsoku-v7158.js`（新回归）、`package.json`（版本号与测试脚本）。无服务端、数据结构、分页尺寸或阅读进度字段变更。
