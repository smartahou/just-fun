# Just Fun v6.60 — PDF.js 真正集成

## 工程说明

- 维护源：v6.59 已验证模块化源码 + v6.60 PDF.js 集成实现
- 正式供应链：用户通过 `npm pack pdfjs-dist@6.4.299` 获取的原始 `pdfjs-dist-6.4.299.tgz`；本次已实际提取出一致版本主模块与 Worker。
- 建议构建：`node scripts/build.js`，开发期 `node_modules/pdfjs-dist` 内必须为 6.4.299。离线生成 `dist/douyin.js`；**最终运行仅需这一个 JS**。
- 运行：`node douyin.js <现有工作目录>`。
- 前端使用同源 `/api/jf-pdf/pdf.min.mjs` 和 `/api/jf-pdf/pdf.worker.min.mjs`，不是 PowerShell/Poppler / iframe。
- Canvas + PDF.js TextLayer，选中文字写入笔记的独立 quote，并可回到原页。扫描版无可选文字时不能假装有 OCR。
- 书架 PDF 首封采用浏览器端 PDF.js Canvas 懒加载，原书只读。
- 为 Chromium 的早期版本补齐新 Map upsert API，并对齐 PDF.js 文本层字体变量。
- 真正的系统 PDF 预览只保留故障后用户显式选择的应急回退，不自动冒充自定义阅读。
- 安全：仅在现有媒体根扫描 PDF，不执行 PDF 附件脚本，限制页图片素；文档与标记仍沿用既有存储/保险箱机制。

## 已知边界

- Windows 真实电脑尚未执行 GUI 实机验收；CI 的 Linux Chromium 与 Windows Chrome 不是等价的人工验收。
- 浏览器容器禁止网络 URL 导航，真实自动化采用本地模块/Worker 原字节及隔离 PDF 文件作浏览器解析/Canvas/文本层验证，资源服务另以真实 Node HTTP 验证；尚不是 Windows UI 全流程测试。
- PDF.js 是逐页阅读，不是完整的多页连续滚动；大型扫描 PDF 内存和性能有待用户真实书籍确认。
- PDF 图片没有文本层时，不提供文字摘录；截图摘录尚未实现。
- 不能因为本轮测试通过就承诺任意受损/加密/复杂 PDF 均可读取。
