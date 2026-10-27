# Just Fun v7.05 · 阶段 B / TXT 展示纯逻辑边界

> 2026-10-26。基线为文件库 `JustFun-v7.04-CSS减债与跨页标记稳定化-模块化工程源码版.zip`，已离线重建并严格比对正式单文件 `index.js`：`a7633969f7a9acb1012d7eee00843d279488cfe1da470e97e48278382770d921`。

## 本轮范围

1. 新建 `src/client/scripts/98a-txt-presentation.js`：使用冻结的 `jfTextPresentation` facade 输出 `reflow(raw)` 和 `mask(value)`。实现只含纯逻辑，不引用 DOM、全局 Workspace、媒体目录或网络。
2. `99-reading.js` 保留历史全局 API `jfTxtSmartReflow(raw)`、`jfReadMaskString(value)`，内部委托 facade。原文 TXT、文本偏移映射、章节选取、截图乱码交互与摘录仍沿用原协议；无数据迁移。
3. 构建清单显式添加新模块，继续离线拼接形成一份 `index.js`。
4. 加 `tests/txt-presentation-facade-v705.js/.py`：从真实 v7.04 函数锁定 SHA 金标准，覆盖 522 条确定性 TXT/offset 夹具和 68 条显示掩码，作为阶段 B 增量接口验收；纳入全量门禁的专项列表。

## 非目标与后续

- 未重写阅读器布局、CSS、图片对象协议、PDF 几何算法、Notes 快照或密码机制。
- 下一批候选：从 `99-reading.js` 抽离图片控件的独立协调接口；收拢 PDF 页面缩放/跨页坐标几何，设计不可变图片 ID 的读写实现并先做隔离迁移和回滚验证。
- 阶段 C 仍未完成，尤其 Windows 真机与真实书库完整性/迁移验证，不得因 Linux 通过而宣称跨平台认证。

## 质量门禁

- Node syntax + clean offline rebuild + ZIP 单文件 SHA 同源；新增模块纯逻辑基准哈希。
- 真实 Chromium TXT v6.99、v7.00 两套专项；阶段 B 正式全量门禁由 `tests/release-gate-v703.py --full` 生成同 SHA+测试指纹的客观证据。
- 绝不触碰用户真实媒体目录、笔记或密码库。
