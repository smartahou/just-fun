# Just Fun v7.23.1 · Windows npm 首次依赖安装兼容修复

- 根因：Node.js Windows 下 `spawnSync('npm.cmd', ...)` 直接执行批处理程序可能返回 `EINVAL`，尚未真正执行 npm。
- 修复：Windows 改为由 `ComSpec` (`cmd.exe /d /s /c`) 执行固定参数的 `npm.cmd install ...`；Linux/macOS 保留原 `npm` 直接执行。命令不包含用户媒体路径等动态输入。
- 严格保持 PDF.js 6.4.299 与核心模块 SHA 检查、构建门禁、Git 快进保护、运行版保留及回退行为。
- 新增 `tests/windows-npm-bootstrap-v7231.py` 8 项命令分派断言；同时重复 v7.23 本地部署隔离测试及全量发布门禁。
- Windows 实机安装仍需用户重试确认；Linux 只能模拟命令分派，不声称已运行 Windows CMD。
- 关键自举：从 v7.23 旧脚本直接双击更新会先执行旧版本 npm 安装命令，因此必须先运行 `git pull --ff-only origin main`，更新本地脚本，然后再双击「更新.cmd」。如已经手动 npm 安装成功，则旧版更新器也可继续构建。
- 用户数据、业务 JS、Workspace 及媒体文件不修改。
