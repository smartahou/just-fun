# v7.16 断线恢复检查点

- C0: 从文件库 v7.15 完整源码 ZIP 清洁解压，重建匹配上版发布 SHA `021b2614afcc0185733177de41dc2b5b55490caa4baf537513cb719821130b0b`。
- C1: v2 双读与多对象事务只在隔离测试目录，不开放任何生产 POST / migration/commit。
- C2: 修改 `build.manifest.json`、`src/server/46d-reading-v2-readonly.js`、`tests/release-gate-v703.py`；增加 `src/server/46f-reading-v2-sandbox-transaction.js`、`tests/reading-v2-sandbox-txn-v716.js/.py`、`scripts/pack-v716.py`。
- C3: 单独事务 25 场景 PASS。不能替代全量门禁。
- C4: 检查 `dist/release-gate-v703/full-report.json`，必须完整 53 项 `passed` 且匹配当前构建及测试指纹。
- C5: 从最终 ZIP 解压离线重建验证，用户 ZIP 中仅 index.js，校验 SHA 与验收指纹。
- C6: 文件库上传并再次列表验证成功后，才能声明正式发布。
- Windows: 无本轮 Windows 真机证据。
