# Just Fun v7.77《书页空白真实成因修复》

## 文件实证
- 读取用户提供的原始 `道光皇帝 (CCTV10百家讲坛) (喻大华) (Z-Library).epub`（27 HTML 文件），检查 EPUB 原始 XHTML/CSS：共计 **137** 个直系 `<div class="empty"></div>`，另有 36 个空 DIV（其中部分具有显式 `page-break-after:always`，不得混为一谈）。
- 截图第 34–35 页：`OEBPS/text00007.html` 在“在这种状态下猝死...”和“嘉庆皇帝驾崩...”之间，确有一个 `div.empty`。
- 截图第 54–55 页：`OEBPS/text00008.html` 在“可以说，嘉庆皇帝根本没有重视...”和“对于乾隆皇帝出生地的分歧...”之间，亦有同样的 `div.empty`。
- 原书 CSS `OEBPS/flow0002.css` 给 `.empty` 设置原本约 2.2em 的上下段落间隔；Just Fun 的 `src/client/styles/00-foundation.css` 更有全局 `.empty{padding:70px;text-align:center;color:#8d939d}`，对阅读区中的同名 EPUB class 造成 **140px 的占位**。这是两张截图大洞的确定性根因，而非分页引擎无故空页。
- 第二本 `崩溃的帝国——明信片中的晚清 - 曾讲来.epub`（34 HTML 文件）未出现同类直接子元素 `div.empty`；本次不改变其图片/图注编排。

## 修复方案
1. 在 `jfDeskIsBookBlank` 中把**确实为空且无媒体的 EPUB div.empty** 加入判定，不把普通空 DIV 或显式分页 DIV 误删。已存在的 P 空段识别保留。
2. 仍只给 `document.importNode` 产生的纸书分页块添加 `jfPrintQuietBreak` / `jfPrintRedundantBlank`。单个间隔压至约 .62em + .43em 底距；连续多余空块隐藏；不删除 EPUB 文本、不改变字符 offset、章节顺序或书签。
3. 在 `41-reading.css` 以 **EPUB 阅读器作用域**覆盖全局 `.empty` 的 70px padding，同时补齐普通连续 EPUB 阅读样式；不触碰工作台其他模块原有的 `.empty` 空态设计。
4. 分页测量与可见纸页共享 `.jfSheetBody` CSS，所以结果在计算和展示时一致，无需硬凑“填满页面”。
5. 本版保持字体及暖墨方案，不擅自加重楷体或引入新字体；此轮优先真正解决结构性空洞，不影响已有图书、图片和进度。
6. 更新版本为 v7.77.0，新增 `tests/epub-empty-spacers-v777.js` 并纳入 `npm run test:reading-print`。测试使用人工构造的原书 DOM **结构**，不上传整本受版权保护的 EPUB。

## 验证与边界
- 源 EPUB + 源代码交叉查证完成，根因是 CSS 类名碰撞，不再依靠截图猜测。
- 提交前后验证 JS 语法、分类逻辑、CSS 作用域、版本与原版回归兼容性，回查 GitHub HEAD。
- 完整浏览器跨 EPUB 可视化、所有功能门禁和本地 Node 构建仍需单独验证，不能宣称全部功能已视觉验收。建议本地在旧两组截图的第 34–35 / 54–55 页验收，再检查《崩溃的帝国》的图文页。

## 测试桩修正
- 首次运行新专项测试发现负例意外把字符串 `'empty'` 作为 class 列表传入，实际该节点确实具有 empty 类。已改为传入空数组，明确验证「无 class 的普通 DIV 不按空白分隔符处理」；产品代码无需修补。

- 回归脚本第二个误报：检测是否出现“裸全局 .empty 选择器”的正则没有要求行首，意外把有阅读作用域的 `div.empty{` 也识别为全局。现已用行首匹配限定真正全局选择器，功能 CSS 不变。
