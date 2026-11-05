# Just Fun v7.32 · 真依赖链路与 CommonMark 笔记

日期：2026-11-04
父提交：13b40f009810c1df9e2debeb0ce69da3873419b2（v7.31.0）
变更范围：scripts/build.js、build.manifest.json、src/client/index.html、src/client/vendor.js（新增）、src/client/scripts/99c-note-editor.js、tests/notes-commonmark-v732.py（新增）

## 背景

项目所有者解除了两条历史约束：不再强制单文件交付，依赖可以按现代实践安装。此前所有第三方能力只能以 base64 内嵌（PDF.js）或手写实现（Markdown）的方式存在。

## 真实缺陷

1. **构建器替换缺陷（潜伏）**：`replaceOnce` 使用 `String.replace(needle, replacement)`。当被替换内容包含 `$&`、`$'` 等序列时，JS 会把它们当作替换模式展开。引入 markdown-it 后，其正则字符类中的 `$'` 直接把 `<script>\n/* JUSTFUN_VENDOR */\n</script>` 注入了产物，导致内联脚本被提前截断、整页脚本失效。此前手写代码极少出现该序列，缺陷一直未暴露。修法：改用函数式替换 `text.replace(needle, () => replacement)`。
2. **笔记 Markdown 仅支持子集**：`jfNoteMarkdownHtml` 是约 40 行手写扫描器，不支持表格、真正的嵌套列表、列表内多段、CommonMark 的边界规则。

## 修复

1. 新增 `src/client/vendor.js`：以 ESM `import` 引入 markdown-it，esbuild 打包为 IIFE，挂在 `window.JF.markdown`。配置 `html:false`（沿用"笔记不执行原始 HTML"的安全策略）、`breaks:true`（保持旧的单换行行为）、`linkify:true`。
2. 补齐旧渲染器已有的能力：GFM 删除线 `~~text~~` 自定义 inline 规则；外链自动补 `target="_blank" rel="noopener noreferrer"`。
3. `scripts/build.js` 增加 `bundleVendor()`：调用 esbuild 打包并注入新增的 `<!-- JUSTFUN_VENDOR -->` 标记位。旧模块的共享作用域拼接顺序完全不变。
4. `jfNoteMarkdownHtml` 优先使用 `window.JF.markdown`，vendor 缺失时回退到旧实现，避免旧缓存页面无法显示笔记。
5. `build-report.json` 增加 `vendorBytes` / `vendorSha256` 指纹。

## 本轮实际执行的验证

- 离线构建通过：`vendorBytes=209179`，`sourceSha256=57f1d8a3d1aaa649d227e184f0f83bdc2dc74e8e44daa3ba4d9241d6fcc15b11`。
- 产物内 `</script` 计数为 2（两个合法闭合标签），确认替换缺陷已修复。
- 真实 Chromium 探针：新渲染器输出 `<table>`、嵌套 `<ul>`、`<s>`、`target="_blank"`、`<pre><code>`；`javascript:` 链接被拒绝并保留原文，未生成 `href`。
- `tests/notes-one-surface-v682.py`：**22/22 PASS**（当前笔记 UI 与多块编辑面完整回归）。
- `tests/fullscreen-progress-v731.py`：**26/26 PASS**（确认本次改动未影响 v7.31 的全屏进度修复）。
- 截图为渲染实测：表格、二级列表、删除线、引用、代码块均正确。

## 环境事实（影响后续所有轮次）

- 本机存在 Python 3.12（`py -3.12`），PATH 默认的 3.7.6 会让门禁直接崩溃；`--doctor` 在 3.12 下通过。
- Windows 上必须设置 `PYTHONUTF8=1`，否则测试里的 `Path.read_text()` 用 GBK 解码而失败（实测 v682 因此报 `UnicodeDecodeError`）。
- 84 个测试文件硬编码 `executable_path='/usr/bin/chromium'`。本轮以 `C:\usr\bin` 目录联接指向独立的 Chromium 副本作为临时环境补丁，**未修改任何测试代码**；这是待修的 P0 移植性问题。
- `tests/notes-rich-markdown-v679.py` 与当前 UI 不兼容（v6.82 "单一表面" 改造后 `#jfDeskNoteBody` 被 CSS 隐藏），属僵尸用例，本轮未使用也未修复。

## 未做的验证（不得宣称）

- 未运行全量发布门禁（`release-gate-v703.py --full`）。
- 未在 Windows 实机由用户验收笔记预览与导出。
- 未验证 markdown-it 对历史笔记中极端内容的渲染差异（仅抽样）。

## 影响面与风险

- 产物增加约 209 KB（未压缩 vendor）；HTML 从 1.02 MB 增至 2.05 MB。
- 笔记渲染结果与旧实现存在差异（表格、嵌套列表、部分空白处理），属预期改进。
- 存储格式、摘录、书签、图片块均未改变。
## v7.32 追加 · 单命令入口

问题：日常使用需要依次双击 `更新.cmd` 和 `启动.cmd`。

实现：

1. 新增 `JustFun.cmd` → `local-deploy-v723.js auto`：检查远端 → 尽力快进 → 从当前 HEAD 构建/安装 → 启动。
2. **更新失败绝不阻塞启动**：离线、脏工作区、分支分叉、候选校验失败时，打印一行原因并直接启动现有运行版。
3. **单实例锁** `.justfun-runtime/instance.lock`：记录启动器 PID 并探测存活，重复双击只提示已在运行，不再开出第二个实例。
4. `ensureRepo({requireClean})`：只有需要 `git merge` 时才要求工作区干净。构建始终来自 `git worktree` 的提交快照，未提交改动不会进入产物，因此不应阻止离线启动；此时打印“改动不会生效”的提示。
5. 保留 `启动.cmd`（纯离线）、`更新.cmd`（强制更新）、`回退.cmd`（二进制回退）作为高级入口。

验证：`auto` 在更新被拒绝时成功降级启动 v7.30（日志实测：更新未完成，继续使用 7.30.0），并正常拉起 HTTP 服务。
## v7.32 追加 · 协作者交接

| 版本区间 | AI 协作者 | 模型 | 推理档位 |
| --- | --- | --- | --- |
| v6.20–v7.31 | ChatGPT | GPT-6（“推理型”为该会话自述） | 未核验 |
| v7.32 起 | DeepSeek Harness 编码代理 | deepseek-flash | 未核验 |

- Git 作者 `smartahou` 是仓库提交身份，不能用于识别具体 AI 模型。
- 本文件第 3 节列出的命令输出与测试结果，是 DeepSeek Harness 接管后的第一批可审计记录。
- 协作者披露同步更新于 `README.md`、`docs/DEVELOPMENT.md`。
## v7.32 追加 · EPUB 真渲染

### 真实缺陷

`jfReadingChapter` 对 EPUB 的最后一步固定是 `jfReadingHtmlToText()`：服务端把整章 XHTML 剥成纯文本再返回。
结果是**书内图片、标题层级、强调、列表、代码块、脚注锚点全部丢失**——用户看到的 EPUB 实际等同于 TXT。
ZIP 解析部分本身是可靠的（中央目录、inflateRaw、路径穿越防护、EPUB3 nav / EPUB2 NCX 目录），问题只在最后一步的投影方式。

### 修复

1. 章节接口在保留 `text` 的同时返回 `html`：`text` 仍是摘录锚点与进度的基准，`html` 只用于显示。
2. 新增 `jfReadingEpubChapterHtml()`：取 `<body>`、整段删除 script/style/iframe/object/embed/svg/form 等子树、
   把 `<img>` 重写为 `/api/reading/epub-asset`、只保留页内 `#anchor` 链接（其余扁平化为文字）、
   剥掉所有 `on*` 属性、含 `url()` 的 `style`、`srcset`/`ping`/`formaction`/`background`。
3. 新增 `/api/reading/epub-asset`：条目必须存在于该书的 ZIP 索引且扩展名在白名单内；按书籍 mtime/size 缓存最多 2 本；
   SVG 额外加 `Content-Security-Policy: default-src 'none'`。
4. 客户端 `jfReadApplyMask()` 增加 HTML 分支，并在 `41-reading.css` 里关掉 `white-space:pre-wrap` 并补齐排版规则。
5. 图文以外的行为不变：目录、进度、摘录、跳转、乱码遮罩仍走原来的纯文本路径。

### 本轮实际执行的验证

- 离线构建通过，`sourceSha256 = c1ddd111f42d2fc83bfe34e66326415466520593b84d9f563f16850bb24b2057`。
- 新增 `tests/epub-render-v732.py`：**21/21 PASS**。含服务端清洗契约、资源 200 + PNG magic、三类越界/缺失拒绝，
  以及 Chromium 中 `img.naturalWidth = 320` 的真实解码证明。
- 回归 `tests/books-manage-v697.py`：**16/16 PASS**（书架、Hashed TXT、字体与边距偏好未受影响）。
- 实测截图：章节标题、加粗、图注、列表、代码均可读，深色主题无冲突。

### 顺带修复的部署缺陷

`ensureVendor()` 的 npm 参数含 `--omit=optional`，会删掉 esbuild 的平台二进制（它是 optional dependency），
导致下一次 `node scripts/build.js` 直接报 `Missing esbuild`。已改为 `--include=optional`。

### 新发现的测试债

`tests/reading-notes-v650.py` 与 v679 同病：操作 `#jfDeskNoteBody`，而该元素自 v6.82「单一表面」起被 CSS 隐藏。
本轮未修改该测试，也未把它当作回归依据。

### 未做的验证

- 未运行全量发布门禁（`release-gate-v703.py --full`）。
- 未在 Windows 实机由用户验收 EPUB 阅读（图片滚动性能、大图加载、夜间主题属未验证项）。
- 未覆盖固定版式 EPUB（fixed-layout）、EPUB 内嵌字体与音频视频。

## v7.32 追加 · 阅读器双滚动条

现象：EPUB 阅读时右侧出现两条竖滚动条，外侧那条贯穿整个视口且不承载任何内容。

真实根因：`.jfReader` 是 `position:fixed`，打开时底层媒体库页面仍然留在文档流里并保持可滚。
阅读器内部 `.jfReadCenter` 又是独立滚动容器，于是浏览器同时绘制了两条滚动条。
此问题在 headless Chromium 下不可见（overlay 滚动条不占位），只有真实浏览器的占位式滚动条才暴露。

修复：`html/body:has(.jfReader:not([hidden])){overflow:hidden}`，并给 `.jfReadCenter` 加 `overflow-x:hidden`
与 `overscroll-behavior:contain`。阅读器关闭后自动恢复，不影响媒体库列表滚动。

验证：`tests/epub-render-v732.py` 新增 3 条断言（打开锁定、关闭恢复、仅一个滚动容器），**24/24 PASS**。

同轮修复：`ensureVendor()` 改为按 lockfile 全量 `npm install`。原先安装单包会让 npm 重算依赖树并删掉
`devDependencies` 里的 esbuild，导致下一次构建报 `Missing esbuild`——本轮实际复现了两次。

## v7.32 追加 · EPUB 连续滚动阅读

需求：EPUB 原为一章一屏、手动翻页，与 PDF 的连续阅读体验差距明显。

实现：

1. 新增 flow 引擎：`#jfReadText` 内以 `<section data-chapter=N>` 拼接多个章节，整篇作为一个长文档滚动。
2. 打开时加载当前章 + 顺序预取后 2 章；滚动到距边缘 1400px 时自动追加下一章，向上同理前插上一章，
   前插时补偿 `scrollTop`，阅读位置不跳。
3. 挂载章节上限 15 章，超出时移除离视口最远的章节。
4. 摘录锚点仍为**章内偏移**：以选区所在的 section 为 scope 计算，历史笔记的 `chapter + anchorStart` 语义不变。
5. 跳转改为按 `chapter` 找到对应 section，用 TreeWalker 把文本偏移映射到节点后 `extractContents` 包裹，
   支持跨节点标记；不再把 `#jfReadText` 重置为纯文本（旧实现会把 EPUB 打回文字）。
6. 进度条按当前可见 section 的章号 + 章内比例计算。
7. 上一/下一章按钮在该章已挂载时滚动过去，否则重新加载；章节下拉选择清空后重载。
8. 章节之间加分隔线与留白，避免两章无缝相接。

调试中修复的两个真实缺陷：

- 预取并发导致章节顺序变成 [0,2,1]，改为串行 await。
- 边界判断用数组末尾章号，乱序后永远卡住，改为对已挂载章号取 min/max。

验证：tests/epub-render-v732.py **28/28 PASS**（新增 4 条：首屏挂载多章、滚到底追加下一章、章号保持升序、
摘录锚点为章内偏移且能在 section 内精确匹配原文）。真实书《崩溃的帝国》实测：从第 20 章打开，向上依次加载 19/18/17/16。

### 严重缺陷修复 · 更新器删除 node_modules

update() 把 node_modules 以 junction 挂进临时 worktree，清理时 git worktree remove --force 会顺着 junction 递归删除，
把真实 node_modules 整个清空。后果：用户每次双击 JustFun.cmd 更新后 esbuild 消失，下一次构建直接失败；
本轮实际复现三次（前两次被误判为 npm 参数问题）。
修复：清理前先 fs.rmdirSync 断开 junction，再移除 worktree。

未做：固定版式 EPUB、跨章搜索、大章节虚拟化（当前上限 15 章）。

## v7.32 追加 · 纸张质感、双页与笔记纸面

需求：EPUB/TXT 要接近纸书的观感；笔记要有纸张背景；宽屏时排成双页。

实现：

1. 纸张不是纯色平涂：`radial-gradient` 做中心高光，内联 SVG `feTurbulence` 做纤维噪点（180px 平铺，透明度 0.05），
   再用两层 `inset box-shadow` 做边缘暗角。全部 CSS，不产生任何额外请求。
2. 双页：`@media (min-width:1120px)` 时正文 `column-count:2`，`column-gap` 随视口伸缩，左右各留版心边距。
   书脊用 `.jfReadCenter::after` 的 `position:fixed` 渐变绘制——固定在视口中央，不随内容滚动。
   `img/figure/pre/table` 设 `break-inside:avoid`，避免插图被两栏切断。
3. 笔记：纸张刷在**书写画布** `#jfDeskNoteCanvas` 上（内部可编辑区只按内容撑高，刷它只会得到一条细带）。
   工具条保持深色配色，标题与模式按钮维持浅色文字以保证对比度。

调试中修正的三处：

- 起初把整个 `.jfDeskEditor` 刷成米色，导致工具条按钮和滑块在浅底上不可见；改为只刷书写区。
- 笔记标题输入框落在深色工具条上却继承了纸面深色文字，几乎不可读；恢复浅色。
- v6.82 起本应隐藏的遗留 `#jfDeskNoteBody` 在纸上被着色后显形；`display:none` 反而让 flex 画布塌陷，
  最终改为 `height:0 + opacity:0 + pointer-events:none` 保留 DOM、不占布局。

验证：`tests/epub-render-v732.py` **32/32 PASS**，新增 4 条——宽屏双栏、书脊为 fixed 覆盖层、
纸张主题带纤维噪点且底色为纸色而非渐变、纸面文字为深墨色。窄屏（900px）实测保持单栏。

未做：纸张纹理随缩放的状态一致性、打印样式、双页下的页眉页脚页码。

## v7.32 追加 · 纸书翻页模式（可选）

上一轮的实现与原意不符：纸色被做成了默认阅读外观。正确的产品定义是——
**默认保持连续滚动**，纸书是 header 上的一个按钮，进入后分页阅读。

实现：

1. header 新增 `#jfReadPaged` 按钮（书本图标），切换 `jfReader.paged` 并自动切到 paper 主题；
   退出时恢复进入前的主题。
2. 分页用 CSS 多列：`.jfReadCenter` 横向滚动、纵向锁定，`#jfReadText` 以 `column-width` 分列、
   `column-fill:balance` 让两页都排满（`auto` 会出现右页空白的半页）。
3. 翻页 = 按整屏滚动：`step = (列宽 + 列距) × 列数`。宽屏 2 列（双页），窄屏 1 列，阈值 1120px。
4. 交互：`←/→`、`PageUp/PageDown`、鼠标点击页面左右半区；点击前检查选区，避免选中文字时误翻页；
   忽略链接/按钮/输入控件上的点击。
5. 翻到倒数第二页时预取下一章；退出分页模式恢复连续滚动与原主题。

调试中修正：`column-count` 继承了宽屏双栏规则，导致一次翻页跨过两列；改为分页模式独占 `column-count:auto`。

验证：`tests/epub-render-v732.py` **39/39 PASS**，新增 7 条——默认非分页、分页后纵向锁定、页数大于一、
`ArrowRight` 前进、`ArrowLeft` 后退、点击右半区前进、退出后恢复连续滚动。

## v7.32 追加 · 按所有者反馈重做（沉浸、真两页、单栏、真实纸纹）

四条反馈与处理：

1. **沉浸按钮**：新增 `#jfReadImmersive`。开启后向下滚动收起页眉页脚（`.immersive-hidden`），
   向上滚动恢复；纸书模式下的纸张同时扩展到全屏。
2. **纸书不是真两页**：改为在 `.jfReadCenter::before` 上用多层背景画出**两块独立纸面**
   （各 `calc(50vw - 26px)` 宽，中间 28px 书脊露出深色桌面），每块纸各有内侧阴影；
   文字列宽按纸张宽度分配，落在纸面之内。
3. **普通模式不要双栏**：删除宽屏 `column-count:2`，普通阅读恒为单栏；双栏只存在于分页模式。
4. **纸纹太假**：弃用纯 CSS 噪点，改用 ffmpeg 生成的 512×512 纸张位图（纤维颗粒 + 斑驳），
   JPEG 压缩后仅 6 KB，以 data URI 内联并按页平铺，书脊缝隙不受影响。

调试记录：`::after` 右页伪元素一直不渲染——前面书脊规则的 `left:50%` 仍在生效，
即使改 `right` 也无法覆盖；最终放弃两个伪元素方案，改由单层背景绘制两块纸面。

验证：`tests/epub-render-v732.py` **40/40 PASS**。新增断言：普通阅读单栏、
沉浸模式向下滚动隐藏页眉、向上滚动恢复。

已知不足：纸张纹理为程序生成，不是实拍扫描；书脊尚无真实的书脊弧度与页码。

## v7.32 追加 · 两处布局缺陷修复

1. **沉浸模式没有真正让出空间**：header/footer 只用 `transform` 移出视口，仍参与 flex 布局，
   结果是一条空白灰带，内容区也没有扩大。改为 `position:absolute`，使其脱离文档流；
   实测 `centerTop=0`、`centerH=839`（= 视口高），内容区真正铺满。
2. **图片撑破纸面、跨过书脊**：CSS 多列布局中，带固有宽度的替换元素会把所在列撑宽，
   `max-width:100%` 在此形成循环依赖而失效。修复：`#jfReadText` 显式 `width:100%`，
   图片 `max-width:100% + width:auto + margin auto`，容器内所有元素 `min-width:0`。
   实测该章 6 张图片宽度 189–449px，均小于列宽 655px，不再溢出。

验证：人工核对截图与计算值；`epub-render-v732` 既有 40 项断言未受影响。

## v7.32 追加 · 分页错位修复（可自由横滚）

现象：分页模式停在了两屏交界处——左侧内容被裁切、右侧露出第三列、书脊压在正文上。

根因：`.jfReadCenter` 是 `overflow-x:auto`。章节目录是 CSS 多列，总宽远超视口，
因此触控板、Shift+滚轮或鼠标拖动都能把容器停在任意位置，而不是一屏一屏地对齐。

修复：

- `.jfReader.paged .jfReadCenter` 改为 `overflow:hidden`，禁止手动横向滚动；
- 翻页改为对 `#jfReadText` 施加 `translateX(-page * step)`，步长 = 整屏宽（列宽+列距）× 列数；
- 保留 `scrollWidth` 仅用于计算总页数。

验证：实测 `scrollLeft` 恒为 0；翻页后 `transform = matrix(1,0,0,1,-1414,0)`；
鼠标横向拖动后页面位置不变。截图确认左右两页各自完整、书脊居中、正文不越界。

## v7.32 追加 · 分页错位的真正根因（padding 与步长不一致）

实测数据：`padding-left = 66.5px`（宽屏版心规则 `clamp(30px,4.8vw,92px)`），
因此真实列宽为 `(1386-133-52)/2 = 600px`；而翻页步长按 `--jf-page-w` 估算的 655px 计算，
每翻一页多跳 74px，偏移累积后视口落在两屏交界，于是左列被裁、右侧露出第三列。

修复：

1. 用同等特异性的选择器（`.jfReader.paged:not(.jfPdfMode) .jfReadText.jfReadHtml`）
   把分页内边距强制为 12px——原先的选择器少了 `.jfReadHtml`，被版心规则压过。
2. `jfDeskPagedMetrics()` 改为**实测**列宽：取正文首个块级元素 `getClientRects()[0].width`，
   不再依赖估算值。任何 padding、边框或字体度量变化都不会再让步长失真。

验证：`padding 12px`、列宽 `655`、步长 `1414 = (655+52)×2`；连续翻三页后
首个段落的 `x` 依次为 12 / -1402 / -2816 / -4230，每页精确位移 1414px，无累积误差。

### 关于是否引入第三方分页库

评估结论：CSS 多列即业界做法，`foliate-js`、`epub.js` 的分页器内部同样基于它；
换库解决不了本次的数值不一致问题。若未来要更换内核，`foliate-js` 是唯一值得的候选，
但它会接管渲染层，摘录锚点、笔记关联、连续滚动都需重接，属独立任务。

## v7.32 追加 · 分页几何重写（顶底黑条 / 书脊过粗 / 文字贴边）

所有者反馈的三处硬伤，全部源于几何参数各自为政：

| 现象 | 根因 |
| --- | --- |
| 顶部和底部有黑色横条 | 纸张只画了 `top:64px;bottom:56px`，沉浸时未铺满 |
| 中间一条又黑又粗的线 | 缝隙 28px 且直接露出纯黑桌面色 |
| 左侧边缘盖住文字 | 纸张从 12px 起、文字也从 12px 起，等于没有页边距 |
| 翻页错位 | 列宽、边距、步长三套数值不同源 |

重写为单一几何：

```
sheet  = (cw - gutter) / 2      gutter = 14px，纸张从 x=0 铺到视口边缘
pad    = clamp(26px, 4vw, 58px) 文字距纸张边缘
column = sheet - 2 * pad        实际列宽
step   = (column + 2*pad + gutter) * cols   翻页位移
```

因为纸张起点为 0，文本盒恰好是 `cw - 2*pad`，于是「按 column-count 均分」与「按 step 平移」
在构造上必然一致，不再依赖两个独立的估算。高度改为 `100vh`，纸张铺满，没有上下黑条。

实测：pad 55.44、gap 124、列宽 576、step 1400；连翻四页，首个段落 x 依次
-1345 / -2745 / -4145，每页精确位移 1400px。

## v7.33 · 测量式分页引擎（纸书模式重做）

所有者规格要求「真正的数字书籍版式系统」，不再用 CSS columns 截断。本轮重写分页机制。

### 新增：`src/client/scripts/98d-page-engine.js`

- `paginate(blocks, pageH, host)`：把块逐个放入真实页容器，按**渲染高度**决定换页；
  超出页高的块用 `Range` 做真实布局二分（预算 400 次），拆成 head/tail，保证不丢字、不重字；
  无法拆分的（超高图片）独占一页，不裁切。
- 页是独立 DOM 容器（`.jfSheet`），内容天然不会跨书脊。

### 新版式

- 纸张 `#F5F1E8`，噪点透明度降到 0.028，不再泛黄、无斑驳暗角；
- 宋体优先（Source Han Serif → Noto Serif SC → Songti SC → STSong → SimSun）；
- 书脊：左右页内侧各一道柔和内阴影，取消白色竖带与黑缝；
- 中文长文默认：首行缩进 2em、段距 0.62em、行距 1.85、`text-align:justify` + `text-justify:inter-ideograph`、
  `line-break:strict`（标点禁则）、`orphans/widows:2`、标题 `break-after:avoid`、`figure` 整体不拆；
- 宽 ≥1000px 双页，窄屏单页；仅一页时单页居中，不显示空白对页。

### 集成

纸书模式不再复用连续滚动的列布局：切换时由引擎重新排版 `#jfDeskFlow` 的章节，
渲染到 `#jfPageView` 的两个 `.jfSheet`；`#jfReadText` 隐藏但保留，退出即恢复。
翻页改为切换页索引并重新渲染，键盘/点击/进度全部改走页模型。

### 验证

- `tests/epub-render-v732.py` **42/42 PASS**（含分页视图可见、页数>1、翻页前进/后退、点击不倒退、页内确有内容）；
- 真实书《崩溃的帝国》实测：第 6 章双页摊开，左页自序、右页承接，书脊处内阴影自然，无跨页溢出。

### 未完成（不得声称已具备）

- 孤行寡行只依赖 CSS `orphans/widows`，未在测量引擎中做行级校验；
- 字号/窗口变化会重新分页，但**尚未按阅读锚点恢复位置**（目前回到当前章首页）；
- 未做整本预排版与分片调度，超长 TXT 的分页耗时未测量；
- 图片密集 EPUB、超长段落、中英混排的专项测试尚未编写；
- 未做 Windows 实机验收。

## v7.33 补充 · 锚点恢复、TXT 分页与专项测试

### 修复的两个真实缺陷

1. **分页丢失 54% 的文字**：`jfDeskPagedLayout()` 在 `jfDeskShowChapterFlow()` 的异步取章
   完成之前执行，此时 `jfDeskFlow` 还是空的（或只有「正在载入…」占位），于是分出来的是空页。
   修复：首章落地后、以及每次 `jfDeskFlowAppend/Prepend` 之后都重新排版。
   专项测试实测：分页前后字符数一致（无丢失、无重复）。
2. **TXT 无法分页**：TXT 走单章纯文本路径，不产生 `[data-chapter]`，`jfDeskFlow` 为空导致 0 页。
   修复：TXT 时把 `jfReadRawText` 按空行切成段落，构造成块后交给同一测量引擎。

### 锚点恢复

块带稳定 `key`（`章节号:块序`，拆分的块用 `#1/#2` 后缀）。重排前记录当前页首块的 key，
重排后按 key 找回所在页；找不到则退回同一章节首页。字号、字体、窗口尺寸变化都会触发重排。

### 新增测试 `tests/paged-typography-v733.py`（11 项，全部通过）

- 超长段落（约 5000 字单块）拆成多页；
- 任一页的 `scrollHeight` 不得超过内容区；
- **分页前后字符总数完全相等**（无丢失、无重复）；
- 图片源已解码、渲染宽度不超版心；
- 改字号后仍停在同一章，且页数随字号增大；
- 40k 字 TXT 能分页、无溢出、耗时在阈值内。

已登记进 `run-all.py` 的 CASES，纳入正式门禁。

### 仍未完成

- 标点禁则仅依赖 CSS `line-break:strict`，未在引擎内做行级校验；
- 孤行寡行仅依赖 `orphans/widows`，拆分长段时未强制最少行数；
- 未做整本预排版与分片调度；
- 未做 Windows 实机验收。

## v7.33 补充 · 页面溢出（最后一行被裁）

现象：少数页面底部文字被裁掉半个字高。

根因：`outerHeight()` 用 `getBoundingClientRect().height` 累加，行高取整与 margin 折叠会让
块的实测量比实际绘制高度短 1–2px；当累计高度刚好等于内容区高度时，最后一行落到裁剪区内。

修复：排版预算取 `innerH - 6`（下限 120px），留出半行余量。

验证：三个 `.jfSheetBody` 的 `scrollHeight - clientHeight` 全为 0；
`paged-typography-v733` 11/11、`epub-render-v732` 42/42 通过。

## v7.34 · 分页算法第二轮：填充剩余空间

### 审计确认的四个缺陷（与所有者诊断一致）

1. `paginate()` 只在块自身超出整页时拆分，放不进剩余空间就整块下移；
2. `splitOversized()` 让拆出的前半段独占一页，不利用之前页的余量；
3. 所谓 Range 拆分并未用 DOM Range 提取结构；
4. `MIN_LINES` 未参与决策。

### 三个根因（实测定位）

**① 测量容器有固定高度**：`jfDeskMeasureHost()` 设了 `height:innerH`，于是 `scrollHeight` 永远
不小于该高度，任何内容都报告「恰好填满」，引擎持续接受本应溢出的块。改为 `height:auto`。
这一条同时解释了上一轮为什么要靠 `-6px` 猜数。

**② 标题防孤行分支丢弃标题**：`flush(); continue;` 把标题推入旧页后直接跳过当前块，
标题从未进入新页。这正是「分页前后字符数差 4」的来源。

**③ 拆分后不复核**：拆出的 head 单独测高通过，放进整列后因 margin 折叠更高，直接溢出。
改为加入当前页后按整列复测，超限就放弃拆分、整段下移。

### 算法改动

- 每加一块都按**组装后的整列**测量（`columnHeight`），不再累加单块高度；
- 拆分用 `Range.cloneContents()` 提取 `[0,n)` 与 `[n,total)`，保留 `<strong>/<a>` 等内联结构；
- 拆分前后校验 `head.textContent + tail.textContent === 源文本`，不等则逐字符回退，最多 4 次，
  仍不等就放弃拆分——宁可整段下移，不丢字；
- `MIN_LINES=2` 参与决策：拆出的两半各至少 2 行，否则不拆；
- 标题若会落在页底，连同下一块一起下移（且标题本身不再被丢弃）；
- figure 视为原子块，超高时等比缩放（`max-height` + `width:auto`），不裁切；
- 新增 `jfDeskPagedReportFill()`：填充率低于 72% 时在控制台说明原因（章末/缩放图/不可拆块）。

### 实测（《崩溃的帝国》第 6 章起，双页 1386×839）

| 指标 | 结果 |
| --- | --- |
| 页数 / 强制溢出 | 6 页 / **0 页溢出** |
| 填充率 | 71 / 96 / 69 / 89 / 98 / 19（末页为章末） |
| 平均填充 | 74%（此前为溢出 116%） |
| 段落拆分 | 1 次（9 行 + 2 行，满足孤寡约束） |
| 字符完整性 | 1606 = 1606，零丢失零重复 |

### 测试

- `paged-typography-v733.py` **11/11 PASS**；`epub-render-v732.py` **42/42 PASS**。

### 仍未完成

- 填充率的剩余差距集中在**章节边界**（新章另起一页是正确行为），但尚未做跨章页序优化；
- 图文联动只到「figure 原子 + 超高缩放」，未做「图随文走」的浮动或独立插图页；
- 标点禁则仍依赖 CSS `line-break:strict`，未在引擎内做行首标点回退；
- 未做整本预排版与分片调度；Windows 实机验收未做。

## v7.35 · 纸书阅读 P0 稳定性修复

### 复现到的三个根因（源码位置）

**P0-A 章节重复追加**：`jfDeskFlowAppend()` 只在 `await fetch` **之前**检查
`jfDeskFlow.some(x=>x.n===n)`。两个并发请求（滚动预取 + 章节边界预取）都能通过该检查，
各自 await 返回后各追加一次 → 同一章挂载两遍 → 分页两遍 → 阅读位置跳动。

**P0-B 重排后页面倒退**：锚点只保存块级 `key`，而重排会改变块的切分方式（拆分产生的
`#1/#2` 与被拆的原块 key 不同），于是 `findIndex` 找不到，退回「同章节第一页」。
另外 `jfDeskPagedLayout` 无代际控制，晚完成的旧排版会覆盖新结果。

**P0-C 图片偶发裁切**：`isFigure()` 只识别 `<figure>` 或含 `<figcaption>` 的块；
EPUB 中常见的 `<p><img></p>`、`<div><img></div>` 不被识别。这类块超高时要么被
`trySplit` 按文本偏移拆开（图片是元素节点，`textNodes` 不统计它 → 拆分后图片丢失），
要么落入 `oversized` 独占一页，再被 `.jfSheetBody` 的 `overflow:hidden` 裁掉。
图片尚未解码时高度是占位值，进一步让测量失真。

### 修复

1. **按 (书, 章) 的 in-flight 表**：`jfDeskFlowFetchOnce()` 复用同一个 Promise，
   解析后再次校验会话代际与是否已挂载；`jfDeskSession` 每次打开书递增，旧会话结果丢弃。
2. **文本锚点**：块带 `offset`（章内累计字符偏移），重排按 `chapter + offset` 恢复，
   不再依赖块 key；找不到精确位置时回退到同章节、再回退到首页。
3. **分页代际**：`jfDeskPageGen` 递增，异步排版完成时若代际已变则丢弃；
   `jfDeskPages` 整体替换，翻页永远读不到半成品列表。
4. **图片原子化**：`hasImage()` 覆盖 `<img>/<picture>/<svg>/<object>`，含图块一律不拆分；
   超高时等比缩放（`max-height` + `width:auto`），不做裁切。
5. **图片就绪门控**：排版前 `await document.fonts.ready` 并等待所有 `<img>` 的
   load/error（2.5s 超时），把 `loading` 提升为 `eager`，避免用占位高度分页。

### 新增测试 `tests/paged-stability-v735.py`（8 项，全部通过）

- 同一章不得挂载两次（DOM 与数组双向校验）；
- **连续 50 次快速翻页，锚点序列单调不减**（不回退）；
- 可见图片矩形不超出内容区、宽高比误差 < 4%；
- 图注不得脱离其 figure；
- 三个并发 `jfDeskFlowAppend(同一章)` 只挂载一次；
- 字号变化后仍停在同一章且偏移接近；
- 全程无页面异常。

### 验证

- `paged-stability-v735` **8/8 PASS**；
- `paged-typography-v733` **11/11 PASS**；
- `epub-render-v732` **42/42 PASS**。

### 仍未完成

- 图片加载失败时的降级只有「保留占位、不裁切」，没有显式的错误占位图；
- 图注关联仅覆盖 `<figure>` 结构，独立 `<p>（明信片）</p>` 形式的图注未做启发式合并；
- 未做跨章页序优化与整本预排版；Windows 实机验收未做。

## v7.35 · 纸书翻页流畅度专项

### 优化前基线（真实 Chromium，Performance API）

- 进入纸书模式：72 ms；
- 翻页同步耗时：P50 2.8 ms / P95 5.3 ms；
- **主线程长任务：65 / 70 / 105 / 256 / 315 / 463 / 430 / 543 / 584 / 620 / 1198 ms**。

结论：翻页本身不慢，**瓶颈是分页计算**。根因是 `jfDeskFlowAppend()` 每追加一章就调用
`jfDeskPagedLayout()` 重排**所有已加载章节**，随阅读推进每次都重算一遍，长任务累积到秒级。

### 改动

1. **按章节分页 + 缓存**：新增 `jfDeskChapterPages`，以章节号缓存分页结果。
   书的分页边界本就是章节边界，因此每章可独立排版；追加新章只排版新章。
2. **签名失效**：`jfDeskLayoutSignature()` 汇总书 ID、字号、字体、边距、页面内宽内高，
   签名变化时清空章节缓存。
3. **占位内容失效**：章节先以「正在载入…」挂载，fetch 完成后调用 `delete(number)` 清掉
   该章的占位分页，否则会缓存空章节（本轮实际踩到，表现为字符数只剩 54%）。
4. **翻页过渡**：`.jf-turning` 类 + CSS `transform/opacity` 动画 160ms，不动布局；
   尊重 `prefers-reduced-motion`。
5. 版本号由 7.32.0 修正为 **7.35.0**（此前提交与包版本不一致）。

### 优化后实测

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| 翻页 P50 | 2.8 ms | **0.1 ms** |
| 翻页 P95 | 5.3 ms | **3.8 ms** |
| 翻页 max | 6.4 ms | **5.3 ms** |
| 最长长任务 | **1198 ms** | **195 ms** |
| 100 次连续翻页顺序 | — | **单调无倒退** |

### 验收对照

| 要求 | 结果 |
| --- | --- |
| 已缓存翻页 P95 ≤ 100 ms | ✅ 3.8 ms |
| 已缓存翻页不调用分页 | ✅ 100 次翻页中 10 次分页全部来自跨章预取 |
| 翻页路径无 ≥50ms 长任务 | ✅ 单次翻页最高 5.3 ms |
| 连续 100 次翻页无倒退/重复 | ✅ 锚点序列单调 |
| 大章节分页不长期阻塞 | ⚠️ 单章分页仍有 108–195 ms |
| 图片完整、不裁切 | ✅ `paged-stability-v735` 覆盖 |
| 字号/缩放/跨章锚点 | ✅ 同上 |

### 未达标项与原因

**单章分页仍有 108–195 ms 的同步长任务**，未做分片调度。原因：`JFPageEngine.paginate()` 是
同步函数，二分测量与整列复测必须连续完成才能保证页面边界一致；改成分片需要把它重写为
可中断的生成器并维护中间排版状态。本轮未做，留作下一轮。

### 测试

- `paged-stability-v735` **8/8**；`paged-typography-v733` **11/11**；`epub-render-v732` **42/42**。

## v7.36 · 分页正确性治理（P0）

### 审计确认的 P0 根因

**分页片段的 offset 从未被传递**。`98d-page-engine.js` 的 `paginate()` 在构造每个页项时
只复制了 `chapter / node / key`，`offset` 全部丢失（grep 整个引擎，`offset` 一次也没被读取）。
因此 `jfDeskCurrentAnchor()` 里的 `first.offset || 0` 恒为 0——**锚点永远指向章首**，
任何重排都会把读者送回该章第一页。这是「翻页后位置不对」的直接原因。

### 修复（最小变更，只动 offset 传递）

引擎的 7 个构造点全部带上 offset：

| 位置 | offset |
| --- | --- |
| 常规入页 | `item.offset` |
| 标题下移 | `item.offset` |
| 缩放图独占页 | `item.offset` |
| 不可拆块独占页 | `item.offset` |
| 拆分 head | `item.offset` |
| 拆分 tail | `item.offset + head.textContent.length` |

tail 的偏移必须等于 head 结束位置，否则跨页文本会重叠或缺口。

### 新增 `tests/paged-correctness-v736.py`（10 项，全部通过）

1. **逐字符**比对阅读流与源文（失败时输出首个分歧的章节、页、偏移与两侧文本）；
2. **跨页 offset 连续性**：每页首块 offset 必须等于前一块 offset + 其文本长度；
3. 图片身份与顺序与源文档一致；
4. **每页是所属章节的连续切片**（无重复、无跳过）；
5. 前进 6 页再后退 6 页回到同一锚点；
6. 同参数重复分页结果确定；
7. 窗口缩放后仍在同一章；
8. 缩放后偏移接近；
9. 无页面异常；
10. TXT 流逐字符一致（段落分隔由 `<p>` 表达，空白归一化后比对）。

### 真实书验证（《崩溃的帝国》，1386×839 双页）

- 阅读流 vs 源文：**2059 = 2059，逐字符一致**；
- 跨页 offset 缺口：**0**；
- 前进 8 页再后退 8 页：锚点完全回到原值；
- 11 页，无页面异常。

### 口径说明（不是放宽容差）

比对前对空白做归一化。原因：EPUB 的 XML 缩进会在 section 下留下纯空白文本节点，
分页只消费元素子节点，这些空白不属于内容；TXT 的段落分隔由 `<p>` 结构表达。
非空白字符仍逐字符严格比对，任何丢字、重字、乱序都会让断言失败并打印分歧位置。

### 版本

`package.json` / `README.md` 由 7.35.0 提升到 **7.36.0**；运行版同步安装。

### 仍未完成

- 中文行首标点禁则仍依赖 CSS `line-break:strict`，引擎内无回退；
- 独立 `<p>（明信片）</p>` 形式的图注未与图片合并（仅 `<figure>` 内保证同页）；
- 章节仍一律另起一页，未按 EPUB 语义区分；
- Windows 实机未验收。

## v7.37 · 翻页偶发跳页（P0）

### 复现

连续翻页 200 次并记录每屏的源内容区间，出现 **67 处不连续**。典型样本：

```
i=20  前进前 end=253  →  前进后 start=243   重叠 10 字符
i=16  前进前 end=321  →  前进后 start=0     回到章首
```

### 根因

**异步追加章节触发的那次重排会改写 `jfDeskPageIndex`。**

`jfDeskFlowAppend()` 完成后调用 `jfDeskPagedLayout(true,'append')`。该函数无条件按
阅读锚点重新计算页码：

```js
if(anchor){ /* findIndex by chapter+offset; jfDeskPageIndex = found */ }
```

但追加只会在数组**末尾**增加页，前面的页及其索引完全没变。重新定位时若锚点落在
页边界附近，`findIndex` 会命中相邻页——用户看到的就是「前进一页却跳过了本应出现的那页，
后退才看到」。重叠与回退到章首同源。

次要缺陷：双页模式 `step=2`，末屏用 `length-step` 限制索引，当总页数为奇数时索引可能落在
奇数位置上，导致左右页组与上一屏重复一页。

### 修复

1. **追加类重排保持索引**：`reason` 为 `append`/`prepend` 时不再按锚点重算页码；
   只有真正的版式重排（字号、字体、边距、窗口尺寸）才重新定位。
2. **Spread 网格对齐**：翻页前先把索引对齐到 `step` 的整数倍，末屏上限取
   `floor((length-1)/step)*step`，保证不会以奇数索引开始一屏。

### 验证（真实书《崩溃的帝国》，1386×839 双页）

| 项 | 修复前 | 修复后 |
| --- | --- | --- |
| 200 次翻页的内容缺口 | **67 处** | **0 处** |
| A→B→A 可逆 | — | 30 轮全部一致 |

### 新增 `tests/paged-no-skip-v737.py`（6 项，全部通过）

1. 200 次翻页不跳页、不重叠（按源区间校验，不是页码单调）；
2. 每个跨页前进再后退回到**完全相同的源区间**；
3. 跨页索引始终对齐 `step` 网格；
4. 异步追加章节**不移动当前跨页**；
5. 字号变化后继续翻页仍连续；
6. 200+ 次翻页无页面异常。

### 回归

`paged-correctness-v736` 10/10、`paged-stability-v735` 8/8、
`paged-typography-v733` 11/11、`epub-render-v732` 42/42。

### 仍未完成

- 独立 `<p>（明信片）</p>` 图注未与图片合并；
- 行首标点禁则仍依赖 CSS；
- 章节仍一律另起一页；
- Windows 实机未验收。

## v7.38 · 纸书模式视觉精修

### 版式

- 行距 1.85 → **1.78**，段距 0.62 → **0.58em**：当前字号下更接近文学书密度；
- 保留宋体栈（Source Han Serif → Noto Serif SC → Songti SC → STSong → SimSun）；
- 书脊内阴影由 `-14px 0 22px -18px` 收敛为 `-9px 0 20px -22px`，读作纸张弯曲而非画线。

### 实体书细节

- **页码**：`jfSheet::before` 显示 `data-page`，11px、字距 0.08em、透明度 0.42、等宽数字；
- **页眉**：`jfSheetBody::before` 显示 `data-running`（当前章标题），10px、字距 0.16em、透明度 0.30；
- 两者在沉浸模式下隐藏（`.immersive-hidden`）；
- 页码取自跨页首块的页序，右页空时（末屏）不显示页码。

### 插图与图注

- 图注：`.76em`、行距 1.7、透明度 0.72、居中、与图片间距 0.72em；
- 插图居中，`max-width:100%`、`height:auto`、`object-fit:contain`，不裁切不拉伸；
- **独立段落图注合并**（语义修正）：EPUB 常把说明写成图片后的独立 `<p>`。
  `jfDeskBlocksFor()` 现识别「含图块 + 紧随的短说明块」并合并为 `<figure>+<figcaption>`，
  从结构上保证图注不会落到下一页。识别规则：块为 `<p>`、长度 ≤ 90、以括号开头或含
  `（…明信片…）`/`（…图…）` 形式的括注。

### 验证

真实书《崩溃的帝国》第 6 章：3 处独立图注全部合并，页面内 `figure`/`figcaption` 一一对应，
`orphan: 0`；页码 9/10 与章节页眉显示正常。

### 回归（视觉与语义改动后必须重跑）

`paged-correctness-v736` 10/10、`paged-no-skip-v737` 6/6、
`paged-stability-v735` 8/8、`epub-render-v732` 42/42。

### 仍未完成

- 图片章出现「一页一图、下半页留白」：figure 为原子块，剩余空间不足以再放一组时自然留白，
  未实现「等比缩小以容纳第二组图」的策略；
- 行首标点禁则仍依赖 CSS `line-break:strict`；
- 章节仍一律另起一页；
- Windows 实机未验收。

## v7.39 · 沉浸加载与真实纸书视觉

### 素材集成

所有者提供的 `JustFun-纸书纹理素材包-v1.zip` 已选择性使用：

| 文件 | 大小 | 用途 |
| --- | --- | --- |
| `paper-fiber.webp` | 16 KB | 纸面纤维，`background-size:340px`，透明度 **0.055** |
| `spine-crease.png` | 3.5 KB | 中央折痕，宽 30px，透明度 0.5，`multiply` |
| `page-edge-strata.png` | 2.9 KB | 左右外缘书页堆叠，宽度随进度 3–12px |

三张图以 base64 内联进 `41-reading.css`（约 30 KB），源文件保留在 `assets/` 便于替换；
构建产物仍为单文件，不依赖外部资源。

### P0：沉浸切换反馈

**根因**：`jfDeskImmersiveToggle()` 只切换 class，从不重排。页眉页脚隐藏后
`jfReadCenter` 的高度已经变化，但分页仍按旧高度计算——用户看到的是「尺寸变了、排版没变」，
随后翻页才触发一次静默重排。

修复：新增 `jfDeskPagedRelayoutWithBusy(reason)`——先显示加载层，
`requestAnimationFrame` 两次确保它**真实绘制**，再执行分页；超时 4s 兜底，
异常时保留当前页面并打印警告。沉浸切换、字号/字体变化、窗口缩放都走这条路径。

**过程中修掉一个自身缺陷**：最初用 `jfDeskPageGen` 判断「我是不是最新请求」，
但 `jfDeskPagedLayout` 内部会自己递增该计数器，导致 `finally` 永远不成立、
加载层永远不关（实测 `busy after: false`）。改为独立的 `jfDeskBusyToken`。

### P1：纸书视觉

- **已读/未读堆叠**：`.jfSheetStack` 贴在左右外缘，宽度由 `--jf-stack-read/unread`
  驱动，公式 `3 + progress*9`，随翻页实时变化；只放在 sheet 自身 padding 内，
  不动版心、`pointer-events:none`。
- **书脊**：`.jfPageView::after` 叠折痕纹理 + 两侧内阴影，替换原硬线；单页模式自动隐藏。
- **纸张**：纤维叠在 `::after`，透明度 0.055、`multiply`，不压字。
- **页码**：移到左右外角（左页 `left:26px` 左对齐、右页 `right:26px` 右对齐），
  **沉浸模式保留页码**，只隐藏页眉。

### 验证（真实 Chromium，1386×839）

- 材质状态：`--jf-stack-read:3.0px`、`--jf-stack-unread:12.0px`（进度 12%），
  书脊/纸纤维均已加载为 data URI；
- 加载层：切换瞬间 `hidden:false`，完成后 `hidden:true`，无残留；
- 沉浸模式：`folio: block`（页码保留）、`head: none`（页眉隐藏）；
- 无页面异常。

### 回归

`paged-correctness-v736` 10/10、`paged-no-skip-v737` 6/6、`paged-stability-v735` 8/8、
`paged-typography-v733` 11/11、`epub-render-v732` 42/42。

### 仍未完成

- 加载层在极快切换时只显示一帧，肉眼近乎不可见（分页已增量缓存，耗时很短）；
- 书页堆叠厚度是线性映射，未按实际章节页数加权；
- 封面/版权页未做专属版式；
- Windows 实机未验收。

## v7.40 · 真实纸书视觉重构

### 上一版为什么看不出差异

v7.39 的 `.jfSheetStack` 只有 3–12px，而且画在 `.jfSheet` **内部**——sheet 的
`overflow:hidden` 把它裁在纸面里，等于给平面加了一条边。用户判断正确。

### 改动

**书页厚度**：`.jfSheet{overflow:visible}`，堆叠层移到纸页**外部后方**
（左页 `left:-14px`、右页 `right:-14px`），上下延伸 `top:7px / bottom:-13px`，
宽度 10–24px 随进度变化。三层错位（本体 + `::before` 偏移 2.5px + `::after` 偏移 5px），
每层带亮边 `inset 1px 0 0 rgba(255,255,255,.9)` 与暗边，叠加 `repeating-linear-gradient(90deg)`
画出**竖向纸页线**——这是「一叠纸」和「一条阴影」的区别。

关键取舍：文字容器的几何完全没动。`.jfSheetBody` 仍是 `overflow:hidden`，
装饰只在 sheet 外部溢出，不参与测量、不拦截点击（`pointer-events:none`）。

**书脊**：新增 `.jfSpineShade`，宽 150px，三层叠加——折痕纹理（38px）+
径向暗部（`ellipse 46% 92%`）+ 横向渐变（中央 `.30`、两侧回落到 0）。
原来的 30px 窄线关闭，避免两层叠加。

**纸张**：纤维 `background-size` 340→210px、透明度 0.055→0.082，`multiply`，仍在文字下方。

**整书投影**：`.jfPageView` 加 `drop-shadow(0 26px 44px)`，书从深色背景上浮起。

### 视觉验收（真实 Chromium，1386×839，同一章节）

整书截图 `.jf-artifacts/v740-full.png`；局部放大 `v740-edge.png`（外缘 180×520）、
`v740-spine.png`（书脊 280×420）。

- 外缘：可见多层竖线 + 亮边，100% 缩放下可辨；
- 书脊：中央连续暗部带，宽度约 150px，无硬线；
- 实测 `--jf-stack-w`：左 10px（进度较低）、右 24px。

### 性能

翻页 P50 **5.6ms**、P95 **6.9ms**、max 7.2ms（v7.39 为 0.1/3.8/5.3ms）。
变慢来自 `filter:drop-shadow` 与更多合成层，仍远低于 100ms 目标。

### 回归

`paged-correctness-v736` 10/10、`paged-no-skip-v737` 6/6、
`paged-stability-v735` 8/8、`epub-render-v732` 42/42。分页算法与缓存未改动。

### 仍未完成

- 左下角页码在窄边上略显拥挤（10px 堆叠时距纸边 26px）；
- 封面/版权页未做专属版式；
- Windows 实机未验收。

## v7.41 · 书脊与书页堆叠重建（P0 视觉结构）

### 两个结构性错误

**书脊是一大团灰黑罩层**。v7.40 的 `.jfSpineShade` 宽 150px，中央叠了径向暗部、
横向渐变和折痕纹理——三层叠加的结果是一块横向 150px 的脏阴影，中间还有一条深缝。
真实摊开书的装订处不是这样：**凹槽很窄，暗只暗在折线上**。

**堆叠是固定宽度的装饰条**。v7.40 的宽度是 `10 + progress*14`，与真实页码无关；
12 页的书和 900 页的书厚度几乎一样。而且它紧贴 sheet 边缘，看起来像贴了条纹理。

### 书脊重做

拆成两件事：

1. **凹槽**（`.jfSpineShade`）：宽度 150px → **30px**，只有中央 3–4px 真正变暗
   （`.38`），两侧在 26% 处就回落到 `.10`。加一条 1px 的折线（`.55`，两端淡出）
   和折线外 2px 的微弱反光（`screen` 混合）——这条反光让折痕读成「两片纸相交」
   而不是「一条画上去的线」。
2. **曲率**：从 `.jfSpineShade` 里拿出来，改为每页**自身的 `background-image`**，
   5 段非线性色标（`.16 → .085 → .035 → .012 → 0`），跨度 48% 页宽。
   因为它属于纸面背景，所以自动位于文字和纤维之下，不可能压住字，也不需要任何
   3D 变换。外侧另加 5% 宽的高光（`rgba(255,252,244,.30)`）表示纸页离开桌面翘起。

### 堆叠重做

**按真实页码计算**：

```js
readPages   = leftPageNumber - 1          // 左侧：已读页数
unreadPages = totalPages - rightPageNumber // 右侧：未读页数
```

**压缩映射**（`BASE=5, MAX=34`）：

```js
px(n) = BASE + (MAX - BASE) * (1 - e^(-n / K))
K = Math.max(12, totalPages * 0.35)
```

`K` 必须随文档长度自适应：固定 `K=110` 时，12 页的文档读 4 页只得到 3.8px（实测），
完全看不出差异；按总页数取 `K` 后，同一位置是 13.2px。指数曲线保证前几页也有厚度、
中段差异明显、接近读完时反转明确，且 900 页的书不会堆出 900px 的怪物。

**位置**：`.jfSheetStack` 仍是 sheet 的绝对定位子元素，但用负偏移落在 sheet **外侧**
（`left:-14px` / `right:-14px`），上下延伸到 `bottom:-15px`，并加 `mask-image` 让上下
两端淡出——它读起来是「从书页背后露出来的一叠纸」，不是贴上去的边框。
`pointer-events:none`，不参与测量。

**形态**：底色 `#f7f0de`（纸色，不再被压暗），叠 3.4px 周期的竖向细线表示纸页断面，
最外缘只有 1px 真正暗（`rgba(96,78,50,.42)`）——只有最后一张纸的边缘是深色。

### 实测（《崩溃的帝国》第 6 章起，1386×839，共 12 页）

| 进度 | 左页码 | 右页码 | 已读 | 未读 | 左厚度 | 右厚度 |
| --- | --- | --- | --- | --- | --- | --- |
| 刚开始 | 1 | 2 | 0 | 10 | **5.0px** | **21.4px** |
| 中间 | 5 | 6 | 4 | 6 | **13.2px** | **16.4px** |
| 接近读完 | 11 | 12 | 10 | 0 | **21.4px** | **5.0px** |

截图：`v741-start/mid/end.png`（整书）、`v741-gutter.png`（书脊 220×380）、
`v741-left.png` / `v741-right.png`（左右外侧 140×420）。

### 回归

`paged-correctness-v736` 10/10、`paged-no-skip-v737` 6/6、
`paged-stability-v735` 8/8、`epub-render-v732` 42/42。
分页算法、章节缓存、锚点、图注合并逻辑均未改动。

### 仍未完成

- 堆叠是 2D 投影，没有随书页张开的透视（真实书口在中缝附近最厚）；
- 书脊折线在深色主题下未单独调校；
- Windows 实机未验收。

## v7.42 · 书页厚度数据真实性（P0）

### 两个错误（所有者指出，已核实）

**1. 零页仍有 5px 厚度**：`stackPx(0)` 返回 `BASE`，等于用装饰冒充厚度。

**2. 把 `jfDeskPages.length` 当作全书总页数**：该数组只含当前挂载章节的分页结果。
页码同样错误——`data-page` 取的是 `jfDeskPageIndex+1`，即挂载数组内的索引，
不是全书页码。打开第 6 章时它显示「1」，而实际是全书第 17 页。

### 数据模型

新增 `jfDeskChapterPageCounts`（章节号 → 页数）与 `jfDeskRecountBookPages()`：

```js
exact = (已知章节数 === 总章节数)
total = exact ? 求和 : 平均页数 * 总章节数   // 非精确时带 exact:false
```

页码：`pagesBefore(chapter) + inChapter + 1`；任一前置章节未知则回退到按章节比例
外推，并置 `data-folio-exact="false"`（CSS 降低不透明度）。

**后台普查** `jfDeskMeasureBook()`：分片（`requestIdleCallback`）逐章 fetch + 分页，
只记录页数不保留 DOM。实测 34 章 **约 10 秒**完成，阅读与翻页不阻塞。

关键细节：普查必须在**离屏真实容器**里等图片解码后再分页。第一版直接用原始 HTML
测，图片高度为 0，三次打开得到 135 / 138 / 151 三个不同的「精确」总数——那是在撒谎。

### 零页零厚度

```js
stackPx(sheets) = sheets <= 0 ? '0px' : BASE + (MAX-BASE)*(1-e^(-(sheets-1)/K))
K = max(10, totalSheets * 0.3)
```

`data-empty='true'` 时整层 `display:none`——宽度和阴影一起消失，而不是画一条很细的边。

### 书口纹理方向修正

原来用 `repeating-linear-gradient(90deg)` 画**竖向**条纹，那是错的：书口看的是每张纸的
断面边缘，应当是从上到下排列的**水平**细线（`180deg`）。这就是「像装饰条纹」的直接原因。

### 实测

| 场景 | read | unread | 左宽 | 右宽 | 左层 | 右层 |
| --- | --- | --- | --- | --- | --- | --- |
| 书首（第 0 章） | 0 | 137 | 0px | 32.9px | display:none | block |
| 中段（第 16 章） | 72 | 209 | 21.4px | 31.5px | block | block |
| 书末（末页） | 139 | 0 | 32.6px | 0px | block | display:none |

普查：`{total:283, exact:true, known:34/34}`，10 秒。
同一会话内 12 次翻页 + 预取新章后 `total` 不变（drift 0 次）。

### 已知限制（不掩饰）

**普查与真实挂载的页数有约 3% 差异**：同一版式下，第 33 章挂载后全书为 292 页，
而纯普查得到 283。原因是挂载章节的图片在主文档中解码更完整，离屏容器仍可能有个别
图片赶上 3 秒超时。挂载过的章节会用真实页数覆盖普查值，因此会话内稳定、且越读越准；
但「精确」的含义是「34 章都已测量」，不是「与挂载测量逐页一致」。

### 回归

`paged-correctness-v736` 10/10、`paged-no-skip-v737` 6/6、
`paged-stability-v735` 8/8、`epub-render-v732` 42/42。

### 仍未完成

- 封面/版权页仍套用正文版式（截图中封面被排入正文流）；
- 普查在超大书上会持续发起网络请求，未做带宽约束；
- Windows 实机未验收。

## v7.54 · 书页边缘打磨（图片问题 vs 实现问题）

### 先分清责任

四张特写（顶边、底边、左上角、右下角）暴露两类完全不同的缺陷：

**图片的问题**：`spread-01-left.webp` 左上角是 rgb(207,217,235) 的蓝灰，
`spread-01-right.webp` 右下角是 rgb(10,25,41) 的近黑。`ffprobe` 确认
`pix_fmt=yuv420p`——**没有 alpha**，所以不是透明露底，而是照片本身的像素：
素材里「撕开的卷边露出底层」被拍进了图。边缘采样 `dark<40: 0`、`bright>235: 0`，
说明图**没有白边或黑框**，问题只在四角的破损像素。

**实现的问题**：`.jfSheet` 圆角是 `2px 1px 1px 2px`——四角都圆但小到看不见，
而且**书脊侧也圆了**。真书书口（外缘）因翻阅而圆润，装订侧（书脊）是折缝，必须锐角。
这就是截图里「直角感 + 贴图感」的来源。

### 修复（只改几何，不动图）

```css
.jfSheet[data-side='left'] { border-radius:5px 0 0 5px }
.jfSheet[data-side='right']{ border-radius:0 5px 5px 0 }
```

`::after`（纸纹层）继承同一轮廓；另加 1px 切边高光，**只加在书口一侧**——切边受光，折缝不受光。
阴影从 `0 1px 2px .24 + 0 12px 30px .5` 收敛到 `0 1px 2px .16 + 0 4px 10px .12`，
去掉深色桌面上那圈白晕。

### 验证

- 左上角 / 右下角 3 倍放特写：圆角可见、切边有高光、书脊侧保持锐角；
- `paged-correctness-v736` 10/10、`paged-no-skip-v737` 6/6、
  `paper-perf-v747` 通过（`samePageStable: true`、`textureRules: 16`）。

### 未解决（属于图片，不属于实现）

左上角的蓝灰破损仍在。消掉它只有两条路：用 CSS 遮一角（会露出背景，更糟），
或换一张四角干净的纸纹（需要新素材）。按「别改坏了」，本轮不动。

## v7.55 · 纸纹素材替换（16 张 argb 原图）

### 素材变化

所有者替换了全部 16 张配对纸纹。新旧差异：

| | 旧 | 新 |
| --- | --- | --- |
| 像素格式 | `yuv420p`（无 alpha） | **`argb`（带 alpha）** |
| 单张体积 | 230–320 KB | 1.2–1.5 MB |
| 16 张合计 | 4.3 MB | **21.1 MB** |
| 尺寸 | 960×1440 | 960×1440（不变） |

**带 alpha 是关键的质变**：v7.54 之前左上角那块 rgb(207,217,235) 的蓝灰破损，
是旧图「撕开的卷边露出底层」被拍进像素里、且没有透明通道可以透出背景。
新图把纸张轮廓做成透明区域，角上的破损直接透出页面底色，黑角与蓝灰块同时消失。

### 管线处理

原图 21.1 MB 不能直接内联，否则单文件失控。沿用既有两段式：

1. `manifest.json` 记录原图的 `bytes / sha256 / width / height`（原图字节不动）；
2. `runtime/group-XX.json` 存 quality-83 + `yuva420p` 转码的 base64，
   并记录 `sourceSha256` 与 `runtimeSha256` 双向绑定。

实测压缩：16 张 **21.1 MB → 2.34 MB**（11%），单张 132–179 KB，与旧版运行时持平。
`scripts/build.js` 的 16 道 SHA-256 校验全部通过，`paperRuntimeBytes: 2458480`。

### 验证

- `paper-perf-v747` 通过：`textureRules: 16`、`samePageStable: true`、`domNodes: 827`；
- `paged-correctness-v736` 10/10、`paged-no-skip-v737` 6/6；
- 实机截图：纸边毛边、卷角、破损均为素材自带，圆角 5px 与书脊直角保持；
- `stack` 仍为 `read 5 → 4.3px` / `unread 293 → 28.7px`，与 v7.54 的进度逻辑一致。

### 注意

原图从 4.3 MB 涨到 21.1 MB 后，`assets/` 目录的仓库体积增加约 17 MB。
离线单文件不受影响（只内联转码后的 2.34 MB）。

## v7.56 · 插图融入纸面 + 恢复中央折痕

### 白色矩形

**根因**：`.jfSheetBody img` 没有任何混合处理，扫描版明信片是白底 JPEG，
直接贴在旧纸纹理上就是一张白卡片。

**修复**：`mix-blend-mode:multiply`。白色与纸色相乘时保持纸色不变，
相当于让白底「透明」，而墨色保留——这正是印刷图版落在纸上的物理表现。
同时去掉 `box-shadow`（它给图片加了一圈亮边，加重了贴纸感）。

实测：`imgBlend: multiply`、`imgBg: rgba(0,0,0,0)`，截图里白框消失
（残留的极淡边界来自 JPEG 底色不是纯白，属于素材精度）。

### 中央折痕

**根因**：v7.53 把 `.jfSpineShade` 的中央暗度压到 `.16`，并且
`.jfSpineShade::before`（1px 折线）和 `::after`（反光）都被 `display:none!important` 关掉了。
三层折痕只剩下一层很淡的渐变，所以「阴影没了」。

**修复**：按原设计恢复，不重做——

- 中央暗度回到 `.32 / .38 / .32`（v7.52 的数值）；
- `::before` 折线恢复：1px、`.42–.48`、两端淡出；
- `::after` 反光恢复：折线右侧 9px、`.22` 递减。

实测：`beforeDisplay: block`、`afterDisplay: block`，中央重新出现连续凹槽。

### 回归

`paper-perf-v747`（`textureRules: 16`、`samePageStable: true`）、
`paged-correctness-v736` 10/10、`paged-no-skip-v737` 6/6。

### 仍未完成

- 插图底色不是纯白（扫描件），multiply 后仍有极淡的矩形边界；
  要彻底消除需要预处理图片（改素材），或在 CSS 里做亮度归一化（会压暗墨色）。

## v7.57 · 书脊恢复 + 去掉我上一轮加的白边

### 上一轮为什么看起来没变化（是我的责任）

v7.54 我给每页加了 `inset 1px 0 0 rgba(255,251,242,.55)` 与
`inset 0 1px 0 rgba(255,251,242,.28)` 作为「切边高光」。在深色桌面上，
这两条就是页面四周的一圈**白色描边**——所有者指出的「边缘白边」正是我加的。

v7.56 恢复的折痕渐变没有 `!important`，被 v7.53 后续的 `!important` 规则压掉，
computed 仍是 `.08/.16`，所以「阴影没回来」。

**我连续两轮交付前没有验证 computed style，只看了 build 成功就报告，这是过程错误。**

### 实际修复

1. **移除全部 inset 高光**，只保留投射阴影：
   `0 1px 2px rgba(52,38,22,.18), 0 5px 12px rgba(0,0,0,.13)`；
   实测 `hasInset: false`。
2. **书脊重建为三层**（宽度 30 → 54px）：
   - 1px 折线 `.55–.62`（画进背景层，不再依赖被覆盖的 `::before`）；
   - 径向暗池 `rgba(26,17,8,.42)`，中部深、上下更深；
   - 横向渐进渐变，中央 `.46`。
   `.44` 叠在 `#f4f0e7` 上算出来是 `rgb(146,140,130)` 中灰——所以之前像一条灰线而不是阴影；
   现在中央到 `.62`，并加宽到 54px 让渐变有地方展开。

### 图片白底：CSS 已经试到尽头

扫描件底色 `rgb(240,235,225)`，纸色 `rgb(244,240,231)`——**接近但不相等**。
四种 CSS 方案全部失败：

| 方案 | 结果 |
| --- | --- |
| `multiply` | 白底变纸色，但米白仍暗一档，矩形可见 |
| `darken` | 取较暗者，扫描件比纸暗，整块保留 |
| `darken` + 提亮 | 同上 |
| `multiply` + `brightness(1.17)` | 反而把底背提得更亮 |

**根因**：任何混合模式都是「保留差异」或「取其一」，无法把「接近纸色但不等于纸色」变成「等于纸色」。
数学上只有把底背变成纯白（或透明）才行。

### 新增 Canvas 抠白（对白底线稿有效，对本例无效）

`jfDeskKnockOutPlate()`：加载后读像素，`lum>234` 置透明、`212–234` 做软边，
结果以 WebP(alpha) 回写。带 22% 浅色面积阈值，避免误伤彩色照片。

实测：慈禧那张是**彩色照片**，浅色像素不足 22%，被判定 `skip`——抠白对它不适用，
行为正确（不误伤），但解决不了这一页。

### 结论与选项

页面四边的白边、书脊阴影：**已修**。
插图自带的浅色底背：**CSS 与浏览器端抠白都做不到**，只有两条路——

1. 素材层：把书里的明信片换成去背 PNG/WebP（工作量大，但一劳永逸）；
2. 接受：真实旧书里贴上去的照片本来就有底边，这也是一种真实。

### 回归

`paper-perf-v747`、`paged-correctness-v736` 10/10、`paged-no-skip-v737` 6/6。

## v7.58 · 书脊阴影：从「一条线」到「两页纸的弯」

### 为什么之前假

v7.57 把中央做成了 1px 深色描边 + 两侧对称渐变，`::after` 还有 `.34` 的白色反光。
局部特写里看得很清楚：一条笔直等宽的硬黑线，两边各一圈亮带——像一根发光的管子。

### 这一版的思路

**书脊没有「线」**。它是两页纸朝装订方向卷下去、光进不去的那片区域。所以不再画描边：

1. **一片宽的暗池**：`.jfSpineShade` 宽 150px，单个径向渐变，中央 `.38` → 30% `.30` →
   52% `.20` → 72% `.11` → 88% `.04`，`filter: blur(3px)`；
2. **两页各自的内阴影**：`.jfSheet[data-side]` 内侧 6 段渐变（`.20 → .13 → .075 → .035 →
   .012 → 0`，跨 46% 页宽），装在纸张自己的背景层里，位于文字之下；
3. **删掉 `::before` 描边和 `::after` 反光**——它们是「管子感」的主要来源。

### 验证

- 局部特写：无硬线，中央连续暗部，亮度从中缝向两侧平缓回升；
- 整版：左页目录右缘自然变暗，与右页左侧形成对称的弯；
- `paper-perf-v747`、`paged-correctness-v736` 10/10、`paged-no-skip-v737` 6/6。

### 说明

这一版不再有「折线」：真实摊开的书在中缝处看不到线，看到的是两页纸的边缘与各自的阴影。
如果仍需要一条极细分界，可单独加 1px `.18` 的暖褐色，不再用深色。
