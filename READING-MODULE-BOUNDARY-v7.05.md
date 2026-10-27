# Reader 边界合同 · v7.05

- 单一纯函数边界：`jfTextPresentation.reflow(sourceText)` 返回 `{text,rawToDisplay:Uint32Array}`。数组长为原始 JS 字符串 `length+1`，原始偏移 `rawToDisplay[i]` 对应展示文本偏移，终点始终映射到输出长度。
- `jfTextPresentation.mask(displayText)` 返回仅展示用的等宽全角替换字符；不得更改源书籍、缓存或用户笔记。
- facade 使用 `Object.freeze` 防运行时重绑。浏览器运行时仍支持原 `jfTxtSmartReflow` / `jfReadMaskString`；现有书籍查看、旧摘录定位、截图乱码模式和章节还原沿用它们。
- `98a-txt-presentation.js` 必须在 `99-reading.js` 之前加载。新增渲染逻辑与 DOM 绑定必须放在后者，不能让纯模块反向访问页面节点。
- 基准不应从新实现自动学习：SHA 金标准固定采自 v7.04 原始纯函数，未来刻意修改 TXT 合行语义必须明确更新语义版本与回归夹具。
- 下一阶段才考虑进一步分层 `99-reading.js` 的笔记历史、引用图片与通用状态；先测试再抽离，避免凭文件行数假设解耦完成。
