# Just Fun v7.16 · Workspace 多对象事务隔离演练

- 父版：v7.15 完整模块化工程；父版 JS SHA-256 `021b2614afcc0185733177de41dc2b5b55490caa4baf537513cb719821130b0b`，本轮修改前清洁重建一致。
- 新增 `src/server/46f-reading-v2-sandbox-transaction.js`：完整 v1→v2 SHA 图片规划，重复图片去重，对象 `wx` 写入、文件/目录同步、逐个读取认证；工作区备份的独立 AAD 认证；主文件原子提交、读回验证、v1 双读语义比对；失败以主文件路径 AAD 重加密回滚，原对象不删除。
- **安全硬门禁**：写入事务仅接受 `os.tmpdir()` 下 `jf-v716-tx-*` 临时库；生产 Workspace 依然只有 v1 写入，不存在 v2 迁移 POST 路由。仅实验验证，不能称为生产迁移已完成。
- 额外兼容：v1 无摘录字段的历史笔记在 v2 读取中照原样保留。
- 事务测试：明文、路径绑定 AES-GCM，8 个故障断点、不同文件类型/软链接/已有损坏对象等 25 组隔离断言。所有测试数据使用 Node 临时目录，与用户媒体文件隔离。
- 测试与打包：`node tests/reading-v2-sandbox-txn-v716.js`，`python tests/release-gate-v703.py --full`，`python scripts/pack-v716.py`。
- 未验事项：生产双写/回滚、Windows NTFS 断电、DPAPI、移动硬盘、长时压力。不得默认启用真实迁移。
