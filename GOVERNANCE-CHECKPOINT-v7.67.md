# Just Fun v7.67 · CIP 版权信息排版与旧纸印墨质感

## 基线
- GitHub main `98c7a83d6cc4e4564773db8c8ff71ac2c87c5660`（v7.66.0）。
- 用户截图：版权/CIP 内容被普通正文两端对齐和两字首行缩进处理，导致 ISBN、电话、编辑、出版信息的短行字距显著拉大，文字与旧纸素材层分离。

## 根因
- `.jfSheetBody` 全局 `text-align:justify`，`p{text-indent:2em}`。原书资料页若使用若干 `p`，读起来像网页端强制排版，电话/英文/阿拉伯数字产生大片不自然空格。
- 专门样式只能作用于分页前的**克隆块**：若给上层 `.jfEpubChapter` 分类，`jfDeskBlocksFor` 将其内容提取后，分页组件不再有祖先分类，且测量的 DOM 和展示的 DOM 可能不一致。

## 变更
1. `jfDeskIsImprintChapter` 只在 EPUB 前八个章节、长度 30–4500 字范围内做多信号判定（CIP/ISBN/出版/编辑/版权资料），防止普通叙事章节误命中。支持 CIP+ISBN、或有出版编辑和版次等资料的连续版权页。
2. `jfDeskBlocksFor` 对 `document.importNode` 的文本块打 `jfPrintImprint`，首项显式 CIP 行增加轻微导语层级；图片、合并图注与 EPUB 原 DOM 不变。分页引擎的 Range 拆分能继续保留 CSS class 和字符偏移。
3. CIP 信息行左对齐、取消正文两字缩进、减少段距、略微收敛字号/行距；中文仍按正常断行规则，不使用会让中文整段溢出的 `keep-all`。
4. 在旧纸模式统一深褐墨色、字距/字偶与极细微印墨阴影，避免使用叠加重滤镜或失焦字体；不改变 WebP、纸页、书脊与分页几何盒模型。

## 验证
- 写入前：检查 GitHub HEAD、版本、唯一修改锚点，JS 静态解析与测试脚本语法检查。
- 新增 `node tests/imprint-typesetting-v767.js`：验证 CIP/ISBN、出版信息续页、普通正文及章节阈值，检查克隆块打标、源码不污染、字符 offset 保持与测量同 CSS，及旧纸墨色。
- 本会话未克隆仓库，因此**未运行**完整 `node scripts/build.js`、Chromium/Playwright GUI 截图、Python 分页基准与完整门禁，不能宣称视觉验收通过。
- 本地验收：`node tests/imprint-typesetting-v767.js && node scripts/build.js`，打开示例 EPUB 的 CIP/版权页、普通正文、图文页，观察行距、数字断行、页码和重开定位；可再跑 `python tests/paged-correctness-v736.py`。

## 范围
- 只修改阅读器模块 CSS 和 `jfDeskBlocksFor` 以及版本声明/测试。前端全局字体控件、PDF、媒体、笔记、阅读持久化和 16 张旧纸 WebP 均未改动。
