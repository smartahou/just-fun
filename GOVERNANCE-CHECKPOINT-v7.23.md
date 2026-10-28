# Just Fun v7.23 · GitHub 本地一键部署与可恢复更新

日期：2026-10-28

## 变更范围

自远程 main v7.22 正式提交 `320327798280f638dee2a90c61b06f474a57f805` 起，仅变更交付与维护入口；服务端媒体处理、浏览器交互、Workspace 协议、密码库、Hash、阅读、笔记与播放器生产源码均未改动。

- 新增 Windows `启动.cmd`、`更新.cmd`、`回退.cmd`；无需今后每轮下载/替换单 JS ZIP。
- 新增 `scripts/local-deploy-v723.js`：GitHub 最新代码检查、只能快进、隔离临时 Git worktree 构建、内嵌 PDF.js 版本和模块 SHA 校验、`node --check` 与只读 `--doctor` 门禁，成功后安装至 Git 忽略的 `.justfun-runtime/current.js`。
- 旧运行版及元数据保留于 `.justfun-runtime/previous.*`，支持一键回退；安装中断或文件 SHA 不一致时优先恢复上一个经过验证的运行版。
- 首次安装需要 Git for Windows、Node.js 22.13+ 或 24+、既有 FFmpeg 与网络可达的 GitHub 私有仓库（以及首次准备 PDF.js 的 npm 网络或离线缓存）。平时 `启动.cmd` 不联网、不调用 Git、不重新编译。
- PDF.js 固定版本 6.4.299；内嵌核心模块 SHA `57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2`；构建仍包含 203 项资产。

## 验证结果

- 新增 `tests/local-deploy-v723.py`，本地完全隔离的 Git bare remote 两个客户端，首次编译、远程快进、已验证运行版保留、回退、再升级、构建故障注入、修复升级、干净工作树检测、中断恢复、文件哈希和私人媒体模拟哨兵：18/18 PASS。
- 正式发布门禁：`python tests/release-gate-v703.py --full --timeout 120` **62/62 PASS**，无跳过；`--verify` 复核通过。累计 case 耗时 **279.985 秒**。
- clean worktree 隔离构建、JS SHA、语法和只读 `--doctor` 均通过。
- 业务 JS 未改变，正式生成 `dist/douyin.js` SHA-256：`9507b1cad3d386aae49d0d7063997787a5588b678d327a61988d420f9bb5cc1a`，与 v7.22 已发布单文件一致。

## 边界与下一步

- Windows CMD 中文输出、Git for Windows 凭据、NTFS 文件占用/杀毒软件、中文路径首次安装与更新需要用户 Windows 实机验收。Linux 测试不证明 Windows 已全部通过。
- 不生成新的单文件 ZIP 作为默认交付；GitHub 是唯一日常源码演进主线，ChatGPT 文件库保留冻结恢复和测试证据。
- 未启用 Workspace v2 生产迁移，不对任何真实媒体库做测试或迁移。
