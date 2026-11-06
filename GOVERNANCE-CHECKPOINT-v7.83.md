# Just Fun v7.83.0 · 原图纸签、真纸边与罕字修复

日期：2026-11-06

## 用户本轮反馈

用户在《唐诗三百首新注》实机截图中指出：
1. 点击笺注时的正文临时突出高亮把相邻中文标点一并选中。
2. 书页四边仍有明显的透明膜/底色框，尤其圆角处能看到独立的浅色覆盖。
3. 《晨诣超师院读禅经》评注表格里，`images/00003.jpeg` 生僻字（34×34）仍被放成一个不合比例的图块。
4. 用户提供了两张新的原始纸张书签图，要求取代当前 CSS 仿制图标，分别用于「目录」「笺注」。

## 根因和修改

- `src/client/scripts/98f-epub-paper-tabs.js`：从“截取锚点前最后六个字符”改为“以真实注释锚点为界，向前取最多五个连续汉字”，自动越过尾随逗号、句号、引号及空白；非汉字区域不高亮。放在非侵入式覆盖层，不写回正文。
- `src/server/46-reading-and-notes.js`：原 EPUB 的 `<img class="kindle-cn-inline-image" alt="075-01" src="../images/00003.jpeg"/>` 在服务端 HTML 清理阶段丢失原 CSS 类名，因此 v7.82 的前端 `kindle-cn-inline-image` 检测无法命中。现在于 `jfReadingEpubImageLayoutHints` 输出原有的 `data-jf-glyph-hint="1"`，只对明确标记的行内字图启用已有前端识别，不影响普通照片、外部图片或原 EPUB 内容。
- `src/client/styles/41-reading.css`：本轮不再扩大纹理 overscan。已分组真实旧纸 WebP 具有 Alpha 轮廓，老 `.jfSheet` 实心米色底层会通过边缘透明像素露出，外侧的 `.jfBookBoard` 暗色书板也会形成第二重轮廓。已在真实旧纸模式且页面具有素材时让 `.jfSheet` 背景透明，禁用重复书板，WebP 恢复 100% 映射（不继续裁切）、停用重复内侧卷曲和旧书口贴膜层。独立阅读进度侧纸堆 `.jfBookPile`、正文分页及书脊阴影保留。
- `src/client/scripts/98e5-paper-tab-assets.js`：**用户原图真正入仓**，非 CSS 重绘。经透明边界裁切，再缩到 44px 适配实际书签，以带 Alpha 的 WebP 编成 JavaScript data URI。目录与笺注图片区分存放，供离线单文件构建直接使用。
- `src/client/scripts/98f-epub-paper-tabs.js`、`build.manifest.json`、`src/client/styles/41-reading.css`：图片资源在纸签控制器之前加载，书签按钮保留可点击和 aria 标签，视觉由原图的透明材质而非 CSS 渐变/菱角构成；打开右侧抽屉依然**不缩放书本、不重分页**。

## 用户提供图片的可复核摘要

| 用途 | 原 PNG SHA-256 | 裁切/缩放后的嵌入 WebP | 嵌入 WebP SHA-256 |
|---|---|---|---|
| 目录 | `7ee8a884cbc6585e79746fb51ed46b8dbe8350140c6338430a5f1e6a264cd984` | 44×162，1724 B | `7766956f18b1deb6dfc23c05e740f53c54141dc5a62477bcbf79fc455296fec0` |
| 笺注 | `58734313eaafb651305fb66ab4d4021e370263e644b782fe9914f111afd2de35` | 44×159，1708 B | `058f73e4efe68bcf5bc877317aaeeede6df0a56d20585a0a6521e5b6dd9c5772` |

原始 PNG 没有提交到 GitHub，也没有对用户上传的 EPUB 进行任何更改。

## 验证范围

- 新增 `tests/epub-paper-tabs-v783.js`：用 Node VM 实际解码并验签两份 WebP data URI（RIFF/WEBP）、检查离线脚本加载顺序、注释高亮不包含相邻标点、真实 EPUB 的 `kindle-cn-inline-image` 语义经服务端转换为强罕字标记，以及旧纸真 Alpha 配置。
- `npm run test:epub-paper` 现在包含 NAV/NCX、注释匹配、纸笺 UI 仿真、v7.82 和 v7.83 专项。
- GitHub CI：[42163400902](https://github.com/smartahou/just-fun/actions/runs/42163400902)：Ubuntu Node 24 `npm ci`、EPUB 专项、`npm run test:reading-print`、`node scripts/build.js`、`node --check dist/douyin.js` 均 PASS。
- **尚未完成** Windows 本机 Chromium 浏览器对真实 EPUB 的人眼视觉验收，特别是四边透明膜和特殊字的位置；不能宣称实机已完全解决。没有修改远端素材组数量（v7.79 十六组纸张尚未并入 GitHub `main`）。

## 后续本地核对

`git pull`，按项目既定构建命令重新构建并刷新阅读器：
1. 点击《子夜吴歌》的对应笺注，突出区域仅有汉字，不再包含「，。！？」。
2. 打开《晨诣超师院读禅经》，右页辑评表格中的原 34×34 图片应只占一枚字的面积，不再突出为孤立大图。
3. 对照截图放大检查右页四个角和所有边缘；实书纸面应由 WebP 的不规则轮廓决定，不应露出实心米色矩形或额外书板。
4. 目录/笺注右侧纸签应为用户原来的两张磨损旧纸图，不再显示竖排文字按钮；右抽屉正常打开/关闭且书本大小不变。
