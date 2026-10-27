# Just Fun v6.61 · 沉浸式 PDF 连续阅读与截图标注

## 本轮
- PDF.js 6.4.299 官方模块、匹配 Worker 和资源仍构建期内嵌至单 JS。
- 阅读由单页替换改为**最多 10 页**的虚拟滚动窗口：IntersectionObserver 按需加载附近页，渲染并发上限 2，临近边界迁移窗口并释放离开的 Canvas/TextLayer，保留原始 PDF 字节。
- PDF 数字输入页码跳转代替 342 项原生 SELECT；PageUp/PageDown/滚轮可纵向滚动；←/→ 跨页跳转仍支持。
- 夜览只在 Canvas 显示层 CSS `filter:invert(1)`，不修改文件；切换多页同步生效。
- Header 截图入口：在 PDF 页面鼠标矩形框选，输入可选文字标注，生成带文字的 PNG 下载（当前**不把图片存入笔记，也不涂画原 PDF**）。PDF 原文划词摘录功能保留。
- Notes 独立页标题增大至 24px、收紧顶部与左侧间距，整体窗口隐藏主文档横向/纵向滚动，编辑区继续占用宽版心。

## 实测
- Node v22 离线构建成功；`dist/douyin.js` SHA256 `0b869f69797e5d7f44e101e2440ab54cc90d8fc683c4fda60ce4677e5765cf4d`。
- 新增专项 `pdf-scroll-v661.py` **13/13**（真实 Node+Chromium UI，342页虚拟窗口模拟输入，区域截图导出）；`pdf-v661-real-ui.py` **通过**（真实官方 PDF.js/Worker，真实30页 PDF、Canvas、TextLayer、跳转第29页、夜览和自然滚动）。
- 既有真 PDF.js 独立测试 `pdfjs-real-v660.py` **12/12**（真342页、Worker、Canvas、文字层）。
- 阅读笔记33/33、引用19/19、书房两组17/17+17/17。
- `tests/run-all.py --merge` 完整正式回归 **30/30**，四批严格验证一致 build SHA + tests SHA。
- 测试环境：Linux Node22 Chromium；未在用户 Windows 机器实测触控板、高 DPI 和真实扫描大文件性能。

## 数据与边界
- 来源：当前 `node douyin <媒体目录>`，不引入第二目录、npm 运行时安装、其他分发文件。
- PDF/书籍与原始媒体保持只读，截图 PNG 需用户主动保存；扫描 PDF 没有文字层时不能文字摘录。
- 复杂旋转页、大型扫描页性能和 Windows 触摸屏仍需实机复核。
