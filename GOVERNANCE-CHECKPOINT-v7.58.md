# Just Fun v7.58 · 旧纸白边和书脊阴影修复

## 基线与目标
- 基线 main commit: `b9c55998f8a66bce107233a24d2c74066b1bac46`；仅修改模块化 CSS、版本声明和回归测试。
- 用户截图显示旧纸外缘亮边、书脊阴影不足。原始 8 组 16 张 WebP 和分页布局不动。

## 根因与修改
1. **书脊阴影失效**：`src/client/styles/41-reading.css` 的 v7.58 草稿把 `!important` 插入 `background` 多层渐变列表的中间（`)!important,`），导致整个背景属性被浏览器拒绝，只剩旧的弱渐变。修正为列表尾部唯一的 `!important`。
2. **人为白边**：v7.54 的 `inset 1px` 亮色书页描线虽然在后续规则被覆盖，但仍是错误来源。原地删除，保留不泛白的投影。
3. **纸堆亮线**：旧 `.jfSheetStack` 被 v7.52 重新启用，保留了更早的亮白 `border-left`。仅在旧纸双页模式取消该装饰边框及残留阴影；外侧按阅读进度计算的 `.jfBookPile` 独立保留。
4. **图层边缘**：旧纸插图 `::after` 的上下 inset 描线去掉，对 16 张成组素材的同一伪元素使用居中 4px overscan，裁切亮色像素边缘而不裁改原文件。书脊反光条收窄且减亮，避免盖住阴影。

## 验证记录
- 已执行：对 GitHub 最新基线 CSS 做精确字符串匹配、关键替换前置断言与修改后静态校验，确认两处非法 `!important,` 已清除，旧 inset 亮边已移除，并检查 overscan、纸堆 border 规则存在。
- 新增：`node tests/paper-edge-spine-v758.js` 静态回归（提交后可在本机执行）。
- **本会话未运行** `node scripts/build.js`、真实浏览器 computed style、视觉截图、Python 专项或全量门禁；当前执行环境无法直接克隆 GitHub 仓库，故不宣称已完成本机端到端验收。
- 建议所有者拉取并执行 `node tests/paper-edge-spine-v758.js`、`node scripts/build.js`，进入 EPUB 旧纸双页模式检验四边/中缝及首中末页。

## 影响边界
- 仅旧纸双页渲染的装饰图层；不改变阅读分页、文字盒、进度、图片源数据、PDF/视频/其他模块。
