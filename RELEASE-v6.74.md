# Just Fun v6.74 · PDF 选区真实安全边距

维护基线：v6.73 完整模块化工程源，已以同 SHA 验证重新构建。仅调整 `src/client/scripts/99a-pdfjs.js` 中 PDF 截图条带几何、安全边距计算，以及与新需求对应的测试断言；并未反向修改最终 `index.js`。

## 修复

- v6.73 原因：`jfPdfCaptureSegments` 虽在字形边界加 padding，最后仍以初始手绘 `choice.area` 的左右界强制截断 `Math.max(left,...)` / `Math.min(right,...)`，导致首字、页正文行一旦贴近拖框时视觉上并无变化。
- v6.74：按真实显示行高取水平 8～13 CSS px、垂直 5～9 CSS px 安全区；所有行的上下左右按此扩展，最后只被 **PDF 页尺寸** 裁定，保留原行检测、段落独立收紧、弱标点保护和双 Handle 起止锚点。
- 选区的预览、标记持久化 geometry 与 JPEG 裁切共用 `choice.segments`，避免预览修改却不生效于导出。

## 验收口径

- PDF 专项 7 套，93 项测试断言通过；新增 `tests/pdf-breathing-room-v674.py` 对边界穿过字形的真实 PDF.js 像素重现验证，选区原起点 119px，实际 strip 起点 109px，PDF 原墨迹起点 115px，JPEG 解码测试确认原框外字形像素存在。
- `tests/pdf-selection-handles-v668.py` 原先要求中间行与鼠标框大小一模一样，现调整为要求 **中间行完整保持选区宽度且每侧增加至少 5px**，保留其余操作、持久化、安全测试。
- 正式 30 套历史回归由 `run-all.py --merge` 按单一产物 SHA 与测试脚本指纹严格合并通过。
- 用户包仅包含 `index.js`，内部编译产物 `dist/douyin.js` 仅为兼容旧 CI 路径，不在交付 ZIP 使用旧名。
- 数据使用单独的临时媒体库；Windows 实机呈现尚需用户本地确认。

## 维护

继续只从文件库 v6.74 完整模块化工程源开发，清理历史多会话缓存而不是依靠记忆重建代码。不要仅以“计算了 padding”替代选区实际像素、导出内容的端到端测试。
