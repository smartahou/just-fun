# Just Fun v7.88.0 · 原图书口堆叠与真实书脊

2026-11-06。直接从 GitHub main 的 v7.87.0 模块化源码实施，不再交付需要用户自行应用的补丁包。

## 用户提供的图片真正入库

来源：用户提供的 `JustFun-旧书书口堆叠-11档22张.zip`。原样上传 `assets/paper-stacks/stack-000-left.webp` 到 `stack-100-right.webp` 共 22 张，均为 **64×1440、WebP lossless VP8L、透明 RGBA**。未重新压缩、裁切、重绘或重复生成。随资产保存用户原始 `manifest.json`，每张都经 Git Blob SHA 与源 ZIP 校验，构建阶段另执行 SHA-256、长度、RIFF/WEBP/VP8L 标记和画布尺寸校验。

实际素材 0% 左图为全透明、100% 右图全透明，全部正确保留。

## 真正改动的生产路径

1. `src/client/scripts/98e3-paper-stacks.js`：与书页纹理模块同级加载，接收构建时嵌入的 22 张 WebP data URI。按 **全书阅读进度**而非局部挂载页数使用 `Math.round(progress*10)` 取得 0～10 档。两个图片同时采用这一档。保持原来的左右 `.jfBookPile` 兄弟元素，不修改书页、正文、页码或任何 DOM 测量盒；只同步对应的图片 URL、透明端点和独立宽度。
2. `src/client/scripts/99-reading.js`：在分页完成、已有全书准确/估算 progress 算出后调用 `JFPaperStacks.apply(pageView, progress, geo.pageH, twoPages)`。不会为了换图改变页码、保存进度或重排。
3. `src/client/styles/41-reading.css`：仅在 EPUB/TXT 的旧纸双页图片模式，用真实 WebP 替换旧 `.jfBookPile` 的重复条纹、假金边、伪随机裂痕、裁切和阴影。书口图片位于 `z-index:1`，纸张正文在 `z-index:2`，目录/笺注书签不受影响；左右分别以图片右/左端抵住书页外缘。图片宽 = 当前纸页高 ×64/1440，保持原图宽高比，不拉伸、不裁切。单页不启用外部双纸堆。
4. 书脊仍使用真实旧纸相接的 v7.87 内侧 Alpha 处理；将中央可见阴影由过淡的 0.112 提升为约 0.215，宽 76～110px 且左右渐淡。仍只有一层柔和的渐变，不新添黑线、白线、实色填缝或整页覆盖膜。
5. `scripts/build.js`、`build.manifest.json`：增加 22 张源资产读取、完整性验证及离线 data URI 内联；注意源图是 VP8L，64×1440 尺寸字段从偏移 21 开始的 4 字节 14-bit 位域解析。未改 16 张现有旧纸面纹理，保留原有 PDF.js 固定版本。
6. `tests/paper-stack-images-v788.js`：逐张比对原始 Manifest SHA-256、单调进度档、0/100 透明端点、两边同档、切换旧纸/单页时不绘制、正确缩放以及仅保留真实图像而非 CSS 绘制。旧 v7.87 阴影数值断言更新为真正的 v7.88 行为。

## 最终验收边界

- GitHub CI 必须验证 Node 24 `npm ci`、`npm run test:epub-paper`、`npm run test:reading-print`、`node scripts/build.js`、`node --check dist/douyin.js`，并在 `dist/build-report.json` 里包含 `paperStackStates=11` 和 22 个原资产 SHA-256。将最终成功的运行 ID 追加在本文件中。
- 此轮未接触用户 EPUB 原件或其阅读记录、笔记。
- 浏览器实机的主观书脊真实程度，仍须用户查看截图；GitHub CI 和静态检查不能替代实际视觉验收。
- 书中「乐府」独占空白页属于单 XHTML 强制分页的另一个问题，本轮不修改，不可误称解决。
