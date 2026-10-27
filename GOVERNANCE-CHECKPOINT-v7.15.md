# Just Fun v7.15 可恢复开发检查点

- **C0** v7.14 全量模块化源码与正式 JS SHA 匹配：`8aedd7e77b4db69c69f2c26eb8e136f7c730f49c8b074452026973206959e0a2`。
- **C1** 只做显式恢复与主备认证，禁止静默恢复、生产 v2 迁移、自动删除对象。
- **C2** 源码修改 `build.manifest.json`、`src/server/60-http-router.js`、`tests/release-gate-v703.py`；新增 `src/server/46e-reading-recovery.js`、`tests/reading-recovery-v715.js/.py`，以及本文档、发行文档、打包脚本。
- **C3** 18 种明文/加密故障专项 PASS；工作区实际写入仅发生在 Node 系统临时目录。
- **C4** 完整 52 项回归、证据哈希和测试指纹请检查 `dist/release-gate-v703/full-report.json`；运行 `python tests/release-gate-v703.py --verify`。
- **C5** `python scripts/pack-v715.py` 从真实源码和门禁证据生成源码/用户两 ZIP；从最终源码 ZIP 清洁解压离线构建并匹配 `index.js` 后才能发布。
- **C6** 交付前必须文件库上传成功并二次列表核对。任何一项缺失，版本保持候选状态。
- **Windows** 目录 fsync 与真实断电、NTFS 文件系统及移动硬盘断连仍为待验证，不得转换为通过。
