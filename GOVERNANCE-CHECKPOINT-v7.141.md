# GOVERNANCE-CHECKPOINT v7.141.0 · 两图之间图注缺少源偏移，图文标记只显示两张图片

## 用户现场
《崩溃的帝国——明信片中的晚清》纸书左页上下两张明信片图片可一同出现边框，但它们之间的说明文字没有对应的选区和标记。前几个版本以图片命中和拖动手势为重心，未针对打印分页器合并图注导致的 source-offset 不一致做修复。

## 代码根因
`jfDeskBlocksFor()` 对原书中的 `<p><img></p><p>（漫画明信片）...</p>` 做原有照片+图注同页规则，生成 `figure.jfPrintPlateWithCaption`；拷贝图片节点后将下一段的 `textContent.trim()` 写入新 `figcaption`，并把该合成图块的 `sourceOffset` 指向图片段落开始。两段原始节点间的 XHTML 空白、图片段落内空白与被 trim 的图注使新 figure 的 `textContent` 与 `source.slice(sourceOffset,sourceOffset+len)` 不再全等。`99d-epub-selection.js` 的 `blocks()` 将它跳过，导致 `owner()`、`textPointAt()` 与 `rangesFor()` 无法将图注映射回原文。图片标记仍按 imageIndex 独立生效，于是出现“只框两张图片、文字完全没效果”的假象。

## 实现
1. `src/client/scripts/99-reading.js` 在合成图注前使用原章节 `sourceStarts.get(next)`，加上 `next.textContent` 原文左侧 trim 的字符数，保存 `data-jf-epub-caption-source-start`。仅给 clone 的 figcaption 添源定位元数据，不修改原文或文字布局。
2. `src/client/scripts/99d-epub-selection.js` 识别打印合并的 `figure.jfPrintPlateWithCaption`，不再把它当作可直接按连续字符串映射的普通块，而是只将真实显示的 `figcaption` 用已保存的原文偏移索引；要求对应的 `source.slice(start,end)` 与当前显示图注逐字一致，否则明确拒绝猜测。其余普通 EPUB 文字、图片索引、跨页选区与分页路径均不变。
3. 单次页渲染缓存 `blocks()`，不给 `pointermove` 新增整书解析或区域扫描；保留 CSS Highlights 的细线和 9% 同色底色，以及多图片标注原子分组逻辑。

## 验收
- `tests/epub-selection-v7129.js` 静态契约检查合并图注的源起始偏移和选区映射。
- `tests/epub-selection-v7129.py` 新增特殊 EPUB：两个独立 `<p><img>` 与各自 `<p>图注</p>`，且保留真实 XHTML 空白和图注前后空格。真实 Chromium 先对两段图注分别建立 Range 以验证精确原文偏移，再用鼠标从第一幅图拖到第一幅图注，继续拖至第二幅图，验证两图预览 + 原文图注文字 CSS Highlights；松手后工具条可见，保存为一组 2 个图片标记 + 1 个文字标记，并验证文字和图片同时渲染保存样式。
- 仍未获得截图原书 EPUB 文件的自动化访问权限，本次使用同结构的合成 EPUB 精确复现数据模型，原书待用户实际检验。
- GitHub Actions 实际验证结论只能在对应 commit 的构建/Chromium 作业结束后填写，不预判通过。
