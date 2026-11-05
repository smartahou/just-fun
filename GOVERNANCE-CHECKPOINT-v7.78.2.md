# Just Fun v7.78.2 · EPUB「目」与「笺」方案 A

## 基线与目标
- 基线 `main`：`5cb33bef44b853de9196531b32273b2ac7abbcab`（v7.78.1）。
- 独立开发分支：`feature/epub-paper-toc-notes-a`；PR #13。
- 仅 EPUB 旧纸分页视图；原文件不可变，普通 EPUB 流式阅读和 PDF/TXT 不改。
- 目录来源：OPF manifest `properties=nav`、EPUB3 nav 的结构层级和 EPUB2 NCX；相对链接 / fragment 解析；只跳过已确认 nav spine 或高置信度目录章节。
- 笺注来源：结构化 noteref/footnote/endnote 和能验证 href/id 的目标；旧式编号仅在明确「注释」标题、至少两条连续定义且正文一对一匹配时剥离。未知匹配一律保留。
- 分页：源章节编号保持不变；仅旧纸渲染副本过滤可确认的注释，零尺寸标记留在原引用位置；当前双页根据真实渲染标记计算可见笺注。经验证完全由注释构成的章节算作 0 页。
- 笺注文字安全：注释体先转义/剥离外部 HTML，前端以 `textContent` 输出；不执行 EPUB 的 HTML 事件或脚本。
- 纸签交互：目录树、互斥抽笺、Esc/点击外部/翻页关闭，键盘焦点；笺注定位使用标记附近真实 DOM Range 与 CSS Highlight，无全书字符串搜索。
- 仍有限制：复杂、不规范、跨嵌套容器的目录与脚注可能无法识别并按保留原文降级；对分散于其他文件但没有 href 锚点的数字注释不猜测。实际图像像素级验收需用户设备确认。

## 变更范围
- `src/server/46-reading-and-notes.js` + `46g-epub-folios.js`：解析与旧纸过滤
- `src/server/60-http-router.js`：仅明确 paper 参数才使用渲染副本
- `src/client/scripts/98f-epub-paper-tabs.js`、`99-reading.js`：纸签与页归属、翻页联动
- `src/client/styles/42-epub-paper-tabs.css`：局部朴素纸页视觉
- `build.manifest.json`、回归测试、发布元数据

## 验证
- `node tests/epub-paper-structure-v7782.js`：真实合成 EPUB ZIP、EPUB2/3 TOC、脚注及保守数字映射。
- `node scripts/build.js`：正式离线构建。
- `python tests/epub-paper-tabs-v7782.py`：隔离 Chromium 页签、目录定位和动态笺注。
- 以上命令仅在 GitHub CI 成功且有确切日志时标记通过；本报告创建时暂不预填成功结果。
- Windows 手动实机/真实复杂诗集 EPUB 尚未验收，不可据此宣称全部兼容。
