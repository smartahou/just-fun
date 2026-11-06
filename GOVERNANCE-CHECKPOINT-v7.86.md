# Just Fun v7.86.0 · 真纸轮廓与自然书缝

- 日期：2026-11-06
- 修改基线：`fdf32dd0d64ac1fb948082f4dda1039361202c8f`（v7.85.0）。
- 实书问题：图中整个纸书台的黑色长方形背景，与书页的 Alpha 不规则轮廓形成截然不同的边界；中心又呈现一条贯穿整页的灰暗竖带。
- 实际 CSS 根因：`.jfReader.paged .jfReadCenter{background:#141210!important}` 是黑色背景的来源；v7.85 高优先级 `.jfSpineShade` 同时叠加中心强度约 0.34 的暗渐变和一条高不透明度暖色“补缝”，视觉过于人工。均非原图损坏。
- 本次修复：对 `.paged.jf-aged-paper #jfReadCenter` 背景设为 `#e1ddd1`，精确匹配实机工具栏取样的 RGB(225,221,209)，去除书页外的**规整黑框**；换掉旧 v7.85 两层书脊填缝，只保留 64–90px 一层渐淡阴影，中心暗度约 0.103、两端为 0。无强制中缝纸色条，也无 1px 黑线。
- 尽量限缩修改范围：没有恢复 `.jfBookBoard`、`.jfSheetCurl` 或实心 `.jfSheet` 背景；保留 WebP Alpha 边缘和独立 `.jfBookPile` 阅读进度，不触碰文本、阅读位置和书签逻辑。
- 更新 `tests/paper-spine-gutter-v785.js` 为“后续版本继续保留核心不变量”的语义；新增 `tests/paper-stage-and-spine-v786.js` 对背景色和阴影叠层数量进行静态回归。
- 仍需 Windows 真实浏览器视觉验收。不能把通过的 CSS/构建测试称为已经满足用户审美要求。
## GitHub CI 验证

- [EPUB paper slips regression #42188776717](https://github.com/smartahou/just-fun/actions/runs/42188776717)：**PASS**。Node 24 依赖安装、EPUB v7.86 专项、原有阅读回归、完整离线构建以及生成 JS 语法检查全部成功。
- 构建 `sourceSha256`：`5b98826753ba74b089203b8aee24cb9fb6840a45f1bf352abc715cad54ba2ff7`（源码指纹，不是打包 JS 的 SHA-256）。
- 仍需用户在 Windows 本机核验黑色背景是否完全消失、书脊柔光是否自然；CI 不能代替视觉验收。
