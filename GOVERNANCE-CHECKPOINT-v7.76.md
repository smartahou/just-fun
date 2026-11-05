# Just Fun v7.76 ·《异体字行内接缝与旧纸印墨》

## 实证输入
- 用户提供截图第34–35页和浏览器里实际渲染的 HTML 元素（GB18030 文本）。
- 逐节点核验发现一个段落含**四张已经归一化的 `img.jfInlineGlyph`**，每张后面紧接一个 `Text('\n 匣…')` 节点。这不是跨 `<p>`，v7.74 仅在桥接 P 时移除空白，因此后续 v7.75 裁透明边也无法解决字形右侧真实源空格。这次针对已确认结构修复，而不再猜测。
- 大面积留白的源 DOM 未在此次 HTML 片段中出现，不能武断压缩章节结构。

## 代码
- 新增 `jfDeskHideInlineGlyphSeams(root)`，仅检查 `img.jfInlineGlyph` 的紧邻文本节点，对其后 `\n ` + 中文、或前中文 + 排版空白做定向隐藏。依赖已存在的 `jfDeskHideGlyphSeamSpace`，把原字符包裹为 `jfGlyphSeamSpace` 而不删除，保持 `textContent`、持久阅读 offset 一字不变。
- 只对 `jfDeskBlocksFor` 创建的打印块**克隆**应用，源章节不变；测量页与显示页使用同一块内容，分页器仍可保留字形和阅读锚点。
- 微调旧纸文字为更有墨量的暖深褐 `rgba(53,37,24,.93)`，比上一版 87% 覆盖稍浓，同时无模糊或文字投影。
- 不改 16 张旧纸 WebP、堆叠、书脊、历史照片、Header、持久化、字体设置。

## 回归
- 新增 `tests/inline-gaiji-whitespace-v776.js`，模拟与真实 HTML 同构的四字形段落，检查尾部空白、Latin 空格、普通照片排除、重复应用无二次影响、文本字符不变。
- `tests/glyph-tight-ink-v775.js` 改成验证当前墨色及最低版本，不因升级版本误报。
- 继续保留 `npm run test:reading-print`，将本轮测试加入一键门禁。未拿到原 EPUB 全量书页，无法把所有大留白的成因归于空段。
