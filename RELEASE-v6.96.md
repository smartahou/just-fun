# Just Fun v6.96 · 图库缩放、中文输入撤销与笔记原图

- 基线：v6.95 完整模块化工程，离线重建 `dist/douyin.js` SHA256 为 `f63e2305a0edf5044d2aa73f68467314cce649eedef216db24bcca535cad3749`，无从历史文字/单文件 JS 重建。
- 图库查看器：滚轮与双指速度基于 `jfPhotoZoomSpeed`，默认1.6×相对 v6.95，图片操作菜单新增 0.6–3.5× 滑杆，localStorage 记忆；图片浏览器没有修改媒体像素或文件。
- 笔记输入历史：中文 IME `compositionstart`–`compositionend` 之间的临时拼音输入不再写撤销快照，中文候选提交后生成一个语义快照，Ctrl+Z/Ctrl+Y 撤销/重做已确认内容。标题输入同处理。
- PDF 截图：`jfPdfJsAreaToJpeg` 始终从 PDF.js 原始页面 Canvas 抽取白底原图，不再根据 PDF 夜间模式写入反色像素；阅读器夜间显示保持独立。
- 笔记工具栏：「图片关灯」仅对摘录图片加 CSS `filter:invert(1)`，不修改存储的 data URL；关闭显示恢复原图，MD/HTML 导出仍使用原图；偏好保存在本地 localStorage。
- 兼容说明：旧版在 PDF 夜间模式下**已经保存为反色像素**的历史摘录，不会自动还原，因为旧数据没有保存“曾经反色”的标识。新截取内容不再受此影响。
- 测试：真实 Chromium 新专项（截图像素、IME历史、展示/导出、图库速度），正式30套历史回归（见 `dist/full-regression-report.json`）。
- 打包模式：模块化源码唯一维护源，交付文件 ZIP 中只包含 `index.js`。
