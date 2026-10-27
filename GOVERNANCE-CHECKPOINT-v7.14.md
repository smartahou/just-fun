# Just Fun v7.14 — 可恢复工程检查点

- 原始不可变基线：`JustFun-v7.13-导航隔离与Workspace只读双读基础-模块化工程源码版.zip`（SHA-256 `7a232591093e06da5d821d69092a6cc2035f11a50fbeab23423880be7d9081fa`）。其离线输出 SHA-256 `56372a3219d1168ada343eacd5ef8a420faf3672ba72297ec7874ba0363d3183`。
- 只使用 ZIP 中模块化工程继续开发；没有将单文件 `index.js` 反向当成源码，也未扫描个人媒体库。
- 当前修改范围：`src/server/15-metadata-vault.js`、`src/server/46-reading-and-notes.js`、`tests/reading-save-budget-v709.js`、`tests/release-gate-v703.py`；新增 `tests/reading-durable-save-v714.js/.py`、`scripts/pack-v714.py`、`RELEASE-v7.14.md` 和本文件。
- 用户接口和 Workspace 持久化格式仍是 v1。只有 `jfReadingSave` 采用显式同步、备份读回认证、主文件读回比对、失败时旧版原路径重加密恢复。
- 缺陷与限制：Windows 目录 fsync 能力视操作系统而定，不把 Linux 合成测试当 Windows 断电测试；如果回滚自身失败，保留现存内容与备份并报错。v2 多对象事务尚未进入生产。
- 正式交付门禁：51/51，不容忍跳过；完成后从源码归档清洁解压离线重建，逐字节比对用户 ZIP 内唯一的 `index.js`；语法与 `--doctor`，然后才上传文件库。
- 若在执行中连接中断：检查本文件、`dist/release-gate-v703/full-report.json`、`dist/release-gate-v703/logs/`、`/mnt/data/jf-v714/full-gate.log`。可按相同 SHA 与测试指纹运行 `python tests/release-gate-v703.py --full --resume --timeout 90`，而不是重跑已证实通过的套件。
