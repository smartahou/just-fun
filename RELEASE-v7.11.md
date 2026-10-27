# Just Fun v7.11 · 只读关系巡检与断线恢复规程

## 来源

- 直接父版：v7.10 真实完整模块化源码 ZIP；经离线重建 `index.js` SHA-256 为 `baad0924899276bbcfec6403e09f82c69ac43daae9068adbbbfcc08bb36058d4`，与正式发布包一致。
- 从 v7.03 真实源码演进的归档链保留，未从单个 JS 逆向重建。

## 本轮变更

- `src/server/46b-reading-relations-audit.js`：纯只读关系检查（跨页顺序/笔记块/书签几何/标记组合/最近笔记/进度）。仅报告不改写；报告不包含笔记正文、书名或本地路径。
- `src/server/46-reading-and-notes.js`：现有 `/api/reading/integrity` 追加 `relations` 计数和新的匿名问题编码；原接口字段保持。
- 专项 `reading-relations-audit-v711` 进入正式门禁；保留旧 `reading-integrity-v708` 门禁，并补齐其纯函数引用。
- `scripts/verify-release-archive-v711.py`：对正式源码 ZIP / 用户 ZIP 做安全解包、测试指纹、离线清洁重建、JS 逐字节 SHA 核验；失败即拒绝。
- 文档 `GOVERNANCE-ROADMAP-v7.11.md` 固化中断恢复检查点 C0～C6 和后续阶段 C 工作。

## 验收及边界

- 全量 47/47 无跳过，构建 SHA `6e1c7d8c7aaaa0f1d6efbca51fea78805c20b0b6c3e1f49c85dc8f2e8ad548ab`，套件耗时 215.043 秒。
- 合成健康、16 类损坏、5k 笔记样本通过；输入不可变，旧版无 blocks/quotes 兼容。
- 未启用 Workspace v2 迁移；不触碰真实用户书库；Windows 实机专项未验证。
- 本轮属于阶段 B/C 的安全基础，不宣称整项工程治理已全部完成。
