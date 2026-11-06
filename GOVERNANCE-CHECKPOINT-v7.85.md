# Just Fun v7.85.0 · 书脊阴影回归

- 2026-11-06；基线 `b232c2242ae9aec49fdf9271a9553ed04c213857` (v7.84.0)。
- 用户反馈：旧书双页中缝的渐柔阴影消失，成为硬黑线。
- 图片核验：用户截图的中线大致在 x=692–695px，中心像素接近 rgb(20,18,15)，两侧纸张约 rgb(200–220,190–210,160–190)，可见黑底穿透；而非单纯阴影变淡。
- 根因：v7.83 为修复纸页四周半透明浮膜，将成对摄影旧纸下方的 `.jfBookBoard` 与 `.jfSheetCurl` 取消。WebP 中心边缘存在 Alpha，原本被遮住的底部深色桌面显露；`.jfSpineShade` 仍沿用仅 28px 且中心很浅的旧渐变，不足以遮盖接缝。
- 修复：**只在双页、已加载成对旧纸纹理时**扩展独立 `.jfSpineShade`，使用两层 CSS gradient：窄约 4–7px 的暖纸色衔接挡住中央 Alpha 缝隙；一条宽 40～64px、中心适中、左右逐渐透明的柔和阴影恢复纸张向书脊内凹的真实感。
- 没有重新启用整页浅色浮膜、书板、单页阴影或两侧 `.jfSheetCurl`；不修改分页/正文/进度/纸张素材，也不引入对阅读位置的副作用。
- 回归命令：`node tests/paper-spine-gutter-v785.js`，并集成 `npm run test:epub-paper`。
- GitHub Actions [#42172059556](https://github.com/smartahou/just-fun/actions/runs/42172059556) **PASS**：Node 24 `npm ci`、EPUB 专项（含 v7.85 书脊回归）、原有阅读排版回归、`node scripts/build.js` 与生成 JS 语法检查全部通过。
- 构建 `sourceSha256`：`fdd634601bd7430198f11ddb31f7fd776af76db1edd8d557aac655831f8a0631`（源码指纹，非正式 JS 二进制 SHA）。
- **待人工验证**：Windows 实机实际旧书视觉；无法仅凭 CSS 源码断言阴影主观真实度。
