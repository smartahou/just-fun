# Just Fun v7.23 · GitHub 维护与本地部署

主代码库 `smartahou/just-fun`（Private，`main`）。本仓库跟踪可维护的源代码、构建器和回归测试；不包含第三方 `node_modules`、生成产物 `dist`、`.justfun-runtime`、用户媒体、Workspace、密码和密钥。**源码开发在 GitHub，用户使用本地已验证运行版。**

## Windows 用户首次部署

- 安装 Git for Windows、Node.js 22.13+、FFmpeg/FFprobe（已安装无需重复）。
- 登录私有仓库后 `git clone https://github.com/smartahou/just-fun.git`；仓库必须完整克隆至固定文件夹。
- 双击 `更新.cmd`，第一次拉取 GitHub 并从锁定的 `pdfjs-dist@6.4.299` 构建。完成后双击 `启动.cmd` 使用。
- 后续更新仅需双击 `更新.cmd`；需要切回上次已验证运行版可双击 `回退.cmd`。

参见 [`本地部署使用说明.md`](./本地部署使用说明.md)。

## 发布流程（维护者）

1. 每轮开始重新读取 `main` HEAD，禁止强推覆盖。
2. 只改模块化源码，运行新增专项及 `python tests/release-gate-v703.py --full --timeout 120` 与 `--verify`。
3. 清洁克隆或干净工作树用固定版本 PDF.js 离线构建，核对 Git Tree/JS SHA，保持业务协议稳定。
4. Git commit 并条件性更新远程 HEAD，重新核对 `main` 指向；再按需提供发行归档备份。
5. 实测 Windows 安装更新前，不声称 CMD、NTFS 文件锁与 Git 凭据交互已在实机通过。

## 本地部署安全边界

`更新.cmd` 由 `scripts/local-deploy-v723.js` 执行：Git fetch -> 快进检查 -> 临时 Git worktree 候选构建 -> SHA/语法/只读 doctor 校验 -> 本地 main 快进 -> `.justfun-runtime/current.js` 安装。安装前验证旧版并保存可回退版本；失败时保留可运行旧版。源码有未提交更改就拒绝覆盖。原有媒体目录提示、密码库、Hash 和 Workspace 数据原样保留。用户可根据需要关闭程序后再更新。

PDF.js 仅为构建时锁定版本依赖。正常启动不需要 `node_modules`、联网或 GitHub 登录，运行入口不读取媒体目录之外的数据。

**Workspace v2 生产迁移依然未开放。** 不因升级发行方式自动迁移真实数据。
