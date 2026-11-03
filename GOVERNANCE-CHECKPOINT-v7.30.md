# Just Fun v7.30 · 移动弹窗目录彻底被过滤问题

日期：2026-11-03
父版本：v7.29.0
父提交：51e34fff07373bd6ce556e34312547810704ea69

## 真正根因（前后端契约不一致）
- v7.29 修复了目录索引的发现问题，但仍未让移动弹窗显示旧目录。
- `src/server/60-http-router.js` 的 GET /api/data 会筛选 `f.state === 'ready'` 的目录，但实际序列化时只输出 `relativeDir/parentDir/originalName/readOnly`，不输出 `state`。
- v7.28 引入的 `src/client/scripts/80-library-actions.js` 中 `unifiedFolderOptions()` 严格要求 `x.state === 'ready'`；来自真实服务的目录一概无法通过，界面只剩人为写死的 root/data 入口。
- 历史浏览器测试使用了带 state 的模拟数据，使这个真实前后端协议缺陷没有暴露。

## 修复
1. 服务端 /api/data 在已筛选 ready 目录后，明确增加 `state:'ready'`，使响应契约一致。
2. 客户端移动候选目录兼容旧服务器省略 state 的数据：`state === undefined || state === 'ready'`；但仍拒绝显式 `pending` 等非 ready 状态。
3. 不改变任何物理目录、Hash 命名、媒体扫描、删除、移动及权限逻辑。此前 v7.29 对空目录、仅文档目录和已移空目录的扫描修复继续保留。
4. 新增 `tests/move-target-api-contract-v730.js`：从真实服务端路由源码提取目录序列化逻辑、从真实浏览器脚本提取移动候选/弹窗函数，验证当前与旧式两种 API 数据都可显示原目录，尚未完成的记录不会误入。
5. 包装成 `tests/move-target-api-contract-v730.py` 并纳入正式发行门禁；更新中英双语 README 和本地部署说明。

## 本轮已执行的验证
- 首先使用 GitHub v7.29 的真实前端/服务端代码片段复现：实际 API 类型缺少 state，3 个目录全被过滤；这次从接口到 UI 的故障链已确认。
- 在经过隔离构建的完整 v7.22 历史模块化工程中，仅重放本轮服务端/前端契约修复，实启本地 HTTP 和 Chromium：
  **9/9 PASS**：真实 API 返回 ready 字段、当前移动弹窗包含新建的 Hash 管理目录、浏览器旧 API 兼容、嵌套源目录候选、显式 pending 拒绝、无脚本异常。
- 新增的源码契约测试：**10/10 PASS**；真实 GitHub 最新版的修订后 Blob 在 V8 直接执行契约验证：**8/8 PASS**，覆盖原目录/空目录/旧式无 state 数据及 DOM select 选项。
- 历史隔离工作目录测试：**29/29 PASS**；扫描生命周期测试 PASS（50 watcher 事件折叠为 2 次串行扫描）。
- 本地隔离离线构建 PASS、PDF.js 6.4.299/203 资源、Node --check 和只读 doctor PASS。
- 此次没有从 GitHub 完整克隆最新 v7.30 并运行全部正式回归，因此**不声明最新完整门禁通过**；Windows 实机、真实用户的目录显示仍以本人验收为准。
- 未访问、删除、移动、重命名或复制用户的私人媒体库文件。

## 升级
关闭 Just Fun → 更新.cmd → 启动.cmd。待自动目录扫描完成后，多选媒体点击「移动到…」，应重新出现原来保存的普通子目录。若仍不出现，应获取当前 /api/data 的 folders 字段样本（事先删除敏感目录名），检查是否是其它目录路径映射问题；不可继续盲改目录扫描逻辑。
