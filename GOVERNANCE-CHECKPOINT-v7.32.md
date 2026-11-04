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
