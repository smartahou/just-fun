# GOVERNANCE-CHECKPOINT v7.132.0 · 蓝色划线、复制与 EPUB 标记列表

## 根因与修复

1. 服务端 `jfReadingAddMark` 和 `recolor-mark` 把蓝色当默认色：为向后兼容而省略 `color` 字段。EPUB 的 `paint()` 却把缺省值当 `amber` 绘制，导致选择蓝色后仍显示茶褐线。按服务端持久化语义将缺省值改为 `blue`。
2. EPUB 选区工具条未提供复制。新增基于原文选区的复制，优先 Clipboard API，必要时退回临时 textarea + `document.execCommand('copy')`；回退节点在 document.body，不进入书页，不影响分页。
3. EPUB 正常章节 Flow 打开时，标记列表按钮保持隐藏。现在 PDF/EPUB/TXT 共用既有列表面板；保存、改色、删除标记后同步刷新打开的列表。标记按原文锚点排序。
4. 旧的 EPUB 标记列表点击后会调用 `jfDeskJumpToQuote`，后者插入 `<mark>`、修改正文 DOM，有破坏原文偏移及分页布局的风险。改为 `jfDeskShowChapter(chapter,0,anchorStart)`，沿现有源坐标恢复位置，不写入书页 DOM。

## 变更范围

- `src/client/scripts/99d-epub-selection.js`：蓝色默认、复制。
- `src/client/scripts/99-reading.js`：列表入口、数据保存后同步。
- `src/client/scripts/99a-pdfjs.js`：共用列表、EPUB 锚点跳转。
- `src/client/index.html`：标记列表通用名称。
- `tests/epub-selection-v7129.js` 与 `tests/epub-selection-v7129.py`：结构与 Playwright 浏览器回归。
- 版本与 README 同步更新。

## 验证口径

- 已核对服务端颜色存储契约、前端绑定逻辑，新增自动化用例。
- 本次通过 GitHub API 生成原子提交；本地完整 Node 构建和 Chromium 测试尚未执行，以 GitHub Actions 的实际结果判定，不预先声称通过。
- 没有修改 `dist/`、分页引擎、源文件数据或 PDF 标记存储格式。

## 首次 v7.132 CI 失败与修复

GitHub Actions 首次执行的构建成功，Chromium 的 EPUB 标记回归在“第二次点击列表按钮关闭面板”处失败：浮动面板默认 top=18px，与工具条同一区域，面板标题栏拦截了切换按钮的点击。修复初始开窗位置为标题栏下方，并让按钮在面板打开时保持可点击层级；增加浏览器几何断言，防止回归。失败记录：Actions 43544996374；该记录不可视为通过。新提交仍需单独通过 CI 验收。
