# GOVERNANCE-CHECKPOINT v7.142.0 · EPUB 图文组合标记的完整索引、按钮焦点与多余摘录入口

## 用户可见问题
截图中旧书左页第一幅插图及随后的文字已有蓝色选中标注框，右侧“标记列表”却仅显示这一组的首条文字摘要，标注图片被藏在组里。顶部列表图标被打开时套用 PDF 通用青绿色背景，突兀；紧邻的 ❞ “摘录选中文字”没有独立价值，且在没有文字选区时只会提示先选正文。

## 根因与修复
1. `jfPdfJsMarkUnits()` 正确使用 `groupId` 把同组图文标记归为一个 unit，但 `jfPdfJsMarksListRender()` 的非 PDF 分支直接将 `unit[0]` 的 `mark.text` 作为整组唯一正文，其他文字/epub-image 成员没有任何列表节点。现在新增 `jfPdfJsEpubListUnit()`：同一组内每条标记都有自己的 `button.jfEpubMarkPart`，图片区用当前已加载源章节图片的 URL 渲染缩略图，失败/源章节未加载时使用显式插图占位；文字区显示准确摘录。排序时优先使用 `jfDeskFlow` 源图 `data-jf-epub-image-offset` 与原文 `anchorStart`，而不是只按 `unit[0]`。每项点击调用现有 `jfDeskShowChapter()` + `JFEpubSelection.jumpImage()` 定位；没有修改或复制书籍 DOM。
2. 只给 EPUB 阅读器加 `jfEpubMode` 类，在 CSS 中隐藏顶部 `#jfReadExcerpt`：该按钮作用是“摘录选中文字”，已由原生选区工具条“加入笔记”覆盖。PDF 中的独立摘录按钮仍保留，TXT 仍可使用。
3. EPUB 标记列表按钮 `aria-expanded=true` 的背景与文字由 PDF 通用绿青色调整为灰褐色 9% 底色、低对比边框；`:focus-visible` 用单像素边线保留无障碍键盘焦点，鼠标点击后不出现大片彩色块。
4. EPUB 列表中的同组标记清晰呈现缩略图、类型、原文内容，沿用 PDF 既有深色浮层，未改变 PDF 专用预览或其管理操作、旧书真书纹理、分页与选区解析。

## 可执行回归
- `tests/epub-selection-v7129.js` 静态检查组内逐条渲染、缩略图与定位、EPUB 摘录按钮隐藏及按钮展开色。
- `tests/epub-selection-v7129.py` 真实 Chromium 的旧书双图+中间图注合成 EPUB，新建图文同组标注后核对列表成员数 3、图片 2、文字 1、真实图片缩略图的 naturalWidth、组序、展开态按钮计算背景、重复摘录入口隐藏以及点击第二幅插图跳回原书。
- 验证状态：此次通过 GitHub API 修改，提交时无本地 Node build 或 Chromium 环境；以后续 GitHub Actions 实际执行结论为准，不提前声称全部成功。
- 图书章节未加载时仍显示图片标记及其来源序号占位，不单独为索引预加载全书的潜在大量高清原图，以免拖累翻页性能。图书源图片在章节加载时可在下一次打开列表中正常显示。
