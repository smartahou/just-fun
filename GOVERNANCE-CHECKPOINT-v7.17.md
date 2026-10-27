# v7.17 断线恢复检查点 · 2026-10-27

- C0（已证实）：从真实 v7.16 完整模块化源码 ZIP 清洁解压，`node scripts/build.js` 所得 SHA-256 与 v7.16 正式包 `bf672b695339795fa8655168e73e3fe0461a467d295bebefff9c117c81fd3d4e` 完全一致。
- C1：不变更 Workspace v1 数据协议、目录结构、Hash 改名及 Workspace v2 迁移开关；只处理后台扫描与书房请求生命周期。
- C2：修改 `src/server/70-watch-and-lifecycle.js`（15 秒兜底扫描期间若已有扫描则跳过、磁盘保活不复制完整媒体列表）、`src/server/30-media-library.js`（重复扫描之间主动让出 HTTP 事件循环）和 `src/client/scripts/98-bookshelf.js`（慢请求只允许一条在途，显式刷新合并一次，离开页面的旧响应失效）。
- C3：新增 `tests/scan-lifecycle-v717.js/.py`、`tests/books-poll-coalesce-v717.py`、`tests/lifecycle-stress-v717.py`，并纳入 `tests/release-gate-v703.py` 的 Smoke / Full 门禁。
- C4：基线 Chromium 双视口各 45 次跨页面切换测试，无残留相簿或活跃观察器；堆内存（Chromium 主动 GC 后）每视口约增加 0.18 MiB。结果只适用于短时合成测试，不能替代一小时连续播放/重度 PDF 或 Windows 真机。
- C5：正式交付必须从最终源码归档清洁解压，重新离线构建后对照用户 ZIP 唯一 `index.js` 进行 SHA 比对。完整发布门禁需 56/56 通过，证据与代码指纹一致。
- C6：上传完整模块化源码和单文件替换包至文件库并二次列表核验，避免中断造成未归档。
- 尚未完成：Windows NTFS / USB / 真断电 / v2 生产对象迁移专项。不能声称已验收。

## 恢复命令

```bash
node scripts/build.js
python tests/release-gate-v703.py --verify
python tests/release-gate-v703.py --full --resume --timeout 80
python scripts/pack-v717.py
```

## 测试证据路径

- `dist/release-gate-v703/full-report.json` 绑定当前构建 SHA 和测试脚本指纹。
- `dist/release-gate-v703/logs/` 为每个套件保留完整 stdout/stderr。
- 单项重跑不等同完整验收；修复后必须重新确保 56 个套件属于最终 SHA。
