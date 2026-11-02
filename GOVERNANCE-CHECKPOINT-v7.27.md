# Just Fun v7.27 · 混合工作目录 Hash 导入回归修复

日期：2026-11-03
父 Commit：9c09141bdf04e84ddbff143e4f137af352165d35（v7.26.0）

## 故障根因
- src/server/30-media-library.js 的 isMixedWorkspace() 只要检测到非空工作子目录或普通非媒体文件，就让 worktree=true。
- ingestNewFiles() 使用 if (!HASH_ENABLED || worktree) 分支，把「混合工作目录」误当成用户撤销了 Hash 授权；即便 library-settings.json 明确 hashEnabled=true，也将新增根目录视频保留原文件名。
- 旧逻辑还会把这类混合媒体库中的已有根目录项一概标为 readOnly，影响已正确 Hash 的媒体项。

## 修复
- **明确的 Hash 设置优先**：启用 Hash 时，新增到媒体库根目录的普通媒体走原有 pending 索引 → 32 位匿名物理名称 → ready 的安全两阶段导入，保留 originalName 和媒体内容；不因存在其他目录或文档退回原名分支。
- **历史媒体不自动迁移**：通过现有索引中的根目录 managedName 去重，已由 v7.26 以原名索引的媒体不会在启动时再被匿名重命名、生成重复条目或更换 key。
- **目录边界不变**：工作学习子目录经 source/ 虚拟索引继续保留原文件名，不移动或删除办公文档。未启用 Hash 的库仍按原名规则导入。
- **只读标记不再误伤 Hash 媒体**：仅非 Hash 混合目录按原有逻辑将历史根目录普通媒体标记为只读；启用 Hash 时不再批量更改根目录媒体的 readOnly 标志。
- 新增 tests/hash-mixed-import-v727.py（全新独立临时目录、FFmpeg 合成媒体和模拟历史 catalog），纳入 tests/release-gate-v703.py；版本与中英文 README、GitHub 本地部署说明更新至 7.27.0。

## 实际验证范围
- 从已验证的 v7.22 完整模块化离线工程还原，先重放 v7.26 的 src/server/30-media-library.js 同步指纹改动并以 Git Blob SHA **f1fbab96d32b34dc8c14ab9fbd65dde805fb0a5f** 核对当前 GitHub 源码；本轮修正后的本地 Git Blob SHA **fe8291d6e75700ba1c12fe6532fafc1b3b15e6af** 与准备提交的远程新 Blob 逐字匹配。
- 本轮 Hash 混合目录专项 **30/30 PASS**：Hash 模式下混合目录根媒体首次导入、实时新增、重启续扫、原音频/视频数据 SHA 不变、原名显示、旧 v7.26 原名目录记录兼容、无重复索引、原书籍/办公文件不变、纯媒体 Hash、不启用 Hash 的原名规则、Hash+密码组合及重启读取。
- 既有 tests/hash-password-mixed-v698.py：**9/9 PASS**。
- 既有 tests/workspace.py（v7.22 基线）：**29/29 PASS**。
- 既有 tests/scan-lifecycle-v717.py：PASS（50 次 watcher 事件折叠为 2 次串行扫描）。
- 既有 tests/security.py：PASS（原有密码模式与失败次数保护）。
- 既有 tests/books-hash-epub-v697.py：**7/7 PASS**。
- 离线本地重建 node scripts/build.js、node --check dist/douyin.js、node dist/douyin.js --doctor：PASS；pdfjs-dist 6.4.299 和 203 项资源。该验证发生在上述真实归档 + SHA 核对模块的隔离环境，不应称为从最新 GitHub 7.27 克隆的完整门禁复测。
- 此版本未重新跑公开仓库最新 70+ 项完整门禁；Linux 隔离验证无法代替 Windows 真机和用户真实媒体库验收。
- 不在实际用户目录运行测试，不迁移、删除或重命名任何既有用户文件和私有数据。新媒体 Hash 仅在用户现有 library-settings.json 的 hashEnabled=true 时生效。

## 用户升级
关闭 Just Fun → 双击 更新.cmd → 完成后双击 启动.cmd。建议在一个已经启用 Hash 且包含工作学习子目录的测试媒体库根目录放入一份新视频，确认物理名称为 32 位匿名 Hash 而 UI 显示仍是原名；旧原名视频不被自动重命名。
