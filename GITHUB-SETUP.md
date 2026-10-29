# Just Fun · GitHub 工作流 / GitHub Workflow

当前工程版本 **v7.26.0**。项目有权授权的源码采用 MIT 许可证；私人媒体、笔记、密码与第三方组件不随源码一并授权。GitHub main 是唯一正式源码基线，ChatGPT 聊天历史和旧离线 ZIP 仅用于上下文、审计和恢复，不能覆盖更新的远程源码。

## 本地部署

1. 安装 Git for Windows、Node.js 22.13+（22.x）或 24+、FFmpeg/FFprobe。
2. 克隆仓库，首次双击 **更新.cmd**：获取 main、准备锁定 PDF.js 6.4.299、隔离构建并检查 SHA/语法/只读诊断。
3. 双击 **启动.cmd** 使用；后续版本更新之前先关闭程序，再双击 更新.cmd。
4. 双击 **回退.cmd** 可切回上一个已验证的运行版，不回滚媒体与笔记数据。

本地部署详见 [使用说明](本地部署使用说明.md)。模块化源码通过 scripts/build.js 按 build.manifest.json 的顺序生成 dist/douyin.js；不要提交 dist/、node_modules/、凭据、媒体或私人配置。构建器对 Windows CRLF/LF 行尾具有兼容性。

## 工程协作

读取远程 HEAD → 增量修改 → 隔离专项/全量回归 → 清洁重建、SHA、--doctor → Git Commit → 核实 HEAD 后非强制 Push → 再次核实远程 HEAD → Windows 真实验收。并行修改通过独立分支/PR 解决，不用强推丢弃别人的工作。

ChatGPT 协助代码实现、验证、审计与提交；人类项目拥有者决定需求、体验取舍、真实验收和公开授权。GitHub 连接器与代码运行容器的网络能力不同；本地 Commit 不等于远程 Push。

详情：[真实开发模式](docs/DEVELOPMENT.md) · [安全与隐私](SECURITY.md) · [公开准备](OPEN_SOURCE_CHECKLIST.md)。

---

## English

The canonical development baseline is GitHub main (v7.24). On Windows, clone the repository, run 更新.cmd to fetch/build/verify, then 启动.cmd to start. 回退.cmd restores a previous verified runtime, not user data. The source is modular; the build artifact is generated and ignored by Git. Never commit local media, notes, credentials or node_modules/.

Human product decisions and real Windows acceptance are complemented by ChatGPT-assisted implementation, isolated regressions, and verified GitHub commits. Always read the latest remote HEAD, avoid force pushes, and document actual test coverage. A public license and privacy-safe publication history are still pending.
