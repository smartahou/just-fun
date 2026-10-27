# Just Fun v6.83 · PDF 摘记邻接空行退格修复

维护基线：文件库 v6.82 完整模块化工程，先 CRC 校验并重新离线构建，基线 JS SHA-256 `377ac99be4da3c52d022dd3d09ffd5519d64552d0f0564f2ae9b578f1b19050d`。

## 修复

- 纠正 `contenteditable` 光标落在摘录前节点边界时，Chromium 原生 Backspace 直接删除 `contenteditable=false` 摘录块的风险；正文和空行优先编辑，摘录需显式首次聚焦高亮、第二次 Backspace/Delete 才删除。
- 末尾换行属于用户文本，不再在 `jfDeskChunkValue` 序列化阶段无条件裁剪；空文本块的占位 `<br>` 不计入笔记正文。
- 修复行末换行与中文字符紧邻时，Chromium Backspace 错误跳过换行而删除前一个汉字的情况。
- 照顾正文节点与摘录块之间的独立空文本块，删除该空块不牵连引用。
- 维持 PDF 标记/高清缩略图、单编辑区、富文本/Markdown 双模式、摘录回跳，以及历史数据兼容。

## 验证

- `tests/notes-blank-before-quote-v683.py`：真实 Chromium 专项（全套断言均 PASS 后方可发布）。
- `tests/notes-one-surface-v682.py`：22 项完整单编辑区与摘录二次删除验收（PASS）。
- 正式历史回归：`python3 tests/run-all.py` 的当轮完整报告必须包含30套 PASS，同构建 SHA 与测试指纹一致。
- 交付前从新归档源码完整离线重建并校对 SHA，解压含且仅含 `index.js` 的用户 ZIP，运行语法和独立启动测试。

## 范围与限定

本轮不改变媒体源文件，浏览器专项仅在 Linux Chromium 测试。Windows 用户真实媒体库尚未实测。
