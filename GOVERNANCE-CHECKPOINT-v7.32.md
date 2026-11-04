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
