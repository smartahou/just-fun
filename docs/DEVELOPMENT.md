# Just Fun 的真实开发模式 / The Real Development Workflow

## 中文说明

Just Fun 的起点不是一份完整的软件产品设计书，而是用户想更舒服地观看自己的短视频。随后从真实体验中出现大量细节需求：视频播放、沉浸 Feed、音视频共存、图片浏览、PDF 摘录、书籍阅读、笔记、滚动状态与快捷键。项目通过许多次短周期迭代逐步扩展，而不是一口气开发出全部模块。

### 参与者与职责

| 角色 | 真实职责 |
| --- | --- |
| 人类项目拥有者 | 定义产品目标、提出使用反馈、决定取舍、Windows 真机操作和最终验收 |
| ChatGPT | 跨会话代码分析、方案设计、增量实现、专项测试、回归、文档、质量审查和 GitHub 提交 |
| GitHub | 正式源码版本管理、Commit/分支与并行协作边界 |
| 隔离测试环境 | Node.js、Chromium、Python、FFmpeg 和合成媒体；只验证其实际覆盖的范围 |

### 开发与发行闭环

1. 从真实使用中发现问题，先限定范围，避免为优化而过度重构。
2. 读取 GitHub 远程最新 HEAD 与对应模块，不用聊天中的旧代码拼凑工程。
3. 在隔离环境修改模块化源码；不要直接维护构建产物，不碰真实媒体和用户数据。
4. 添加针对性回归，运行已有门禁；失败要修复，不删除测试、不降低断言。
5. 使用锁定依赖重新构建，校验产物 SHA-256、语法和只读诊断。
6. 提交有意义的 Git Commit，先检查远程 HEAD，再非强制推送并重新核对；冲突走分支或 PR。
7. 用户通过本地更新脚本取得新程序，并在真实 Windows 设备上反馈下一轮问题。

项目历史上曾长期使用“模块化开发 → 单文件 index.js ZIP 交付”。转向 GitHub 之后，改为本地一键更新与构建；**旧单文件构建器暂时保留，是为了兼容性，不是必须永远使用单文件的架构承诺。**

### 透明的限制

AI 没有天然可靠的记忆、完美的代码正确性或对个人硬件的直接体验能力。真实 Windows 硬盘、4K 视频与媒体解码等事项无法仅靠 Linux 合成测试证实；AI 生成的测试也必须经过独立检查。项目的隐私保护面向真实私人媒体、笔记和凭据，不表示公开源码能自动保护运行时数据。高风险数据迁移仍需专项评审和授权。

### 公开协作原则

欢迎小范围修复及可以复现的 Issue/PR。任何使用 AI 编码的人都需要自行负责代码来源、许可、测试证据和数据安全。不要为了架构时髦而破坏实际可用的用户体验。

---

## English

Just Fun began as a small short-video viewer for one person's media. Real use generated requirements for immersive feeds, audio, photos, PDF/EPUB/TXT reading, note-taking, and workflow polish. Features and engineering practices evolved through many small, concrete iterations instead of a predefined enterprise roadmap.

**Human-led, AI-assisted:** The owner makes product decisions and tests on a real Windows machine. ChatGPT assists with source analysis, implementation, review, tests, documentation, and GitHub commits. GitHub is the source of truth; chat history is not a substitute for current repository state.

**Typical loop:** real feedback → fetch current remote HEAD → scoped modular change → focused tests and existing regression gate → reproducible build and SHA verification → meaningful commit → safe remote push and HEAD verification → real user acceptance.

Synthetic Chromium/Linux tests do not establish real Windows device, USB drive, or high-bitrate decoding performance. AI-written code and tests may be wrong. User media, credentials and private data must remain outside the source repository, and high-risk migrations require explicit safeguards.

The historical single-file delivery format is no longer mandatory; the bundler remains for compatibility while the project evolves conservatively.
