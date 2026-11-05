# Just Fun v7.65 · 阅读位置精确恢复与无动画打开

## 版本基线与范围
- 从 GitHub main `9eb46bc4f2d54abd018fb273bc569b111e39189a` (v7.64) 增量修改。
- 问题一：v7.64 虽已存 `offset`，恢复仍以窗口像素 `scrollTop` 为主，而按章节懒加载导致全局 scrollTop 不稳定；旧 `scroll-behavior:smooth` 会把恢复表现成讨厌的滚动。
- 问题二：纸书模式翻页只更新 UI 百分比，未保存真实书页位置，关书时依旧按连续滚动坐标快照。

## 修改
1. 连续 EPUB 的进度记录存 `chapter,offset,anchorY,ratio,scroll,mode`；`offset` 是章节文本字符锚点，`anchorY` 记录锚点相对阅读区顶端的位置。阅读恢复先定位章节文本 Range，计算即时 scrollTop；旧数据没有 offset 时回退章节比例，最后回退 scroll。
2. 打开时启用 `jf-reading-opening` 遮住初始布局、禁止滚动保存；第一章数据、必要的相邻章节与字体布局稳定后用 `behavior:'instant'` 一步到位。页面显示后短期复核锚点，用户一旦开始交互立即停止复位，避免和手动阅读抢滚动。
3. 纸书翻页按实际 `jfDeskPages[jfDeskPageIndex]` 的章节/字符偏移保存；恢复时以 `jfDeskPageForAnchor` 找到对应的书页并按双页对齐。保存阅读模式（paged/flow），同一本书再次打开默认延续上次模式。
4. 避免新书继承上一书的分页数组/缓存，模式切换时尽量保留章节文字锚点；快速关闭时不覆盖尚未恢复完成的旧书签。
5. CSS 禁止阅读区默认 smooth；用户明确键盘滚动时 JavaScript 显式 smooth 行为不变。服务器在原 Workspace v1 结构中兼容性增加 `anchorY`/`mode` 字段，不删除旧进度。

## 回归与证据
- 静态源代码与版本一致性检查已在 GitHub 写入前执行；提交后回查远端 HEAD。
- 新增 `node tests/reading-position-v765.js`：纯函数测试纸书锚点、双页对齐和文字定位 scrollTop，以及守卫/持久化相关源码断言。
- **当前环境未运行**完整 `node scripts/build.js`、Chromium/Playwright、Python 分页回归与全量门禁：本会话容器无法解析 github.com 克隆项目，请在本机执行后再做视觉验收。
- 本机推荐：`node tests/reading-position-v765.js`，`node scripts/build.js`，`python tests/paged-correctness-v736.py`；使用 EPUB 纯文字与图文混排，跨章/末段落及旧纸双页重开验证。

## 非影响面
- 不修改旧纸 WebP、折痕样式、EPUB 源文件、PDF.js/视频/笔记数据结构。
