# GOVERNANCE-CHECKPOINT v7.131.0 · EPUB 划线交互与索引

## 真实根因
- 原来的选区工具条存在独立“取消”操作。鼠标按下即清空 active 与工具条，但正文翻页在 click 阶段另行判断，导致一次点击书页空白可能直接翻页。
- 同一可见块的原文位置解析使用 DOM Range.toString() 统计前缀，绘制每条标记重新创建 TreeWalker；大量标记时重复遍历文本节点。
- 后端已提供 `recolor-mark` 原子更新，但 EPUB 菜单没有配色入口；前端标记刷新条件也未覆盖这一动作。

## 本轮源码
- 以一次点击消费关闭临时选区（并阻止该次 click 冒泡翻页）；拖拽新选区仍交给浏览器；菜单内操作与页眉页脚控件不受阻断。
- 去掉“取消”按钮，增加五色小圆点、已选状态及无障碍标签；既可创建带色标记，也可将已存标记原地换色。
- 对每个当前书页文字块仅建立一次文本节点起始偏移索引；选区端点以 O(1) 字符定位，划线范围使用已索引节点，避免每次从头遍历。
- 不触碰 EPUB 原文、分页引擎、旧书图片素材、笔记记录模型或 PDF 渲染。
- 补充 EPUB 专项结构契约，保留旧回归测试所依赖的“取消标记”文案。

## 验证与限制
- 已完成：GitHub 当前源代码及服务端 `recolor-mark` 契约核对；补充静态回归断言。
- 未运行：本机 Node 专项测试、Chromium 实测、`node scripts/build.js` 与完整回归门禁（当前执行环境未挂载完整仓库与 npm 依赖）。
- 需要由 CI 和实际浏览器复核：长段落、跨自然段、跨双页拖选、触摸设备、标记改色及误翻页事件路径；请以实际执行日志为准，不能视作已通过。

## 影响面
`src/client/scripts/99d-epub-selection.js`、`src/client/scripts/99-reading.js`、
`src/client/styles/41-reading.css`、`tests/epub-selection-v7129.js`，
以及版本、README 与本 checkpoint。
