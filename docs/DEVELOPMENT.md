# Just Fun 的真实开发模式 / The Real Development Workflow

## 中文说明

Just Fun 的起点不是一份完整的软件产品设计书，而是用户想更舒服地观看自己的短视频。随后从真实体验中出现大量细节需求：视频播放、沉浸 Feed、音视频共存、图片浏览、PDF 摘录、书籍阅读、笔记、滚动状态与快捷键。项目通过许多次短周期迭代逐步扩展，而不是一口气开发出全部模块。

### 参与者与职责

| 角色 | 真实职责 |
| --- | --- |
| 人类项目拥有者 | 定义产品目标、提出使用反馈、决定取舍、Windows 真机操作和最终验收 |
| ChatGPT | **v7.32 之前**的跨会话代码分析、方案设计、增量实现、专项测试、回归、文档、质量审查和 GitHub 提交 |
| DeepSeek Harness | **v7.32 起**接手的日常迭代：读码、实现、专项与回归、构建校验、文档和 GitHub 提交 |
| GitHub | 正式源码版本管理、Commit/分支与并行协作边界 |
| 隔离测试环境 | Node.js、Chromium、Python、FFmpeg 和合成媒体；只验证其实际覆盖的范围 |

### AI 协作模型、推理强度与归属（透明记录）

- **2026-10-28，本次开源文档维护：** 通过 ChatGPT 的 **GPT-6 推理型模型**协助审阅、编写和向 GitHub 提交文档。此处的模型名称来自当前会话可确认的模型身份。
- **具体推理档位：未核验。** ChatGPT 的 High、Extra High 等选项属于会话或产品配置；当前协作不提供可独立审计的精确档位记录，不声称本次必定是 High、Extra High、xhigh、超高或最高。
- **历史开发：** Just Fun 已跨越多个 ChatGPT 会话，但无法确认所有会话是否使用同一个模型版本；早前有建议使用「GPT-6 高推理强度」的交接文字，但建议不等于该版本的实际调用证明。现有发行记录与 Git 提交没有保存完整的「模型 × 推理档位 × 代码版本」对应表，所以不把历史所有代码归因于同一个 GPT 型号或思考级别。
- **作者身份：** GitHub Commit 显示仓库所有者的账号，是连接器提交身份；不能据此推断全部代码由该用户手敲，也不能用 Git 作者字段识别 AI。
- **运行时 AI：** 项目里可选的 Qwen ASR 是应用功能的一部分；其模型及用户 API Key 与协作编程使用的 GPT-6 是两种完全不同的角色。
- **后续记录原则：** 仅在能确认时，逐次记录 AI 服务、模型名、推理强度档位、日期、作用范围和验证环境；无法确认就标注「未记录 / Unknown」，不倒填猜测值，也不展示内部隐藏推理内容。

#### 2026-11-04 · 从聊天窗口迁移到 DeepSeek Harness

- **新的协作者：** **DeepSeek Harness** 编码代理，模型标识 **`deepseek-flash`**。**推理强度未核验**——Harness 不向被代理的模型暴露其思考档位，因此不写 High / Extra High / 最高 之类未经证实的档位。
- **接管边界：** 从 **v7.32** 开始。v7.31 及之前的功能、测试与文档由 ChatGPT 协作产生，**不归因于 DeepSeek Harness**；反之，DeepSeek Harness 也不为历史提交背书。
- **为什么迁移：** 聊天窗口无法直接执行命令、无法读取整个仓库、无法在失败时立刻重试；编码代理可以跑构建、跑测试、读失败日志并在同一轮闭环。这是能力差异，不是模型优劣的结论。
- **不变的部分：** 人类仍然是需求来源与最终验收人；GitHub 仍是唯一源码事实源；Windows 实机体验仍只能在真机确认。
- **可审计记录：** v7.32 的 `946c7b2`、`5b6b8f7`、`eff5f84`、`33016ee` 及其 `GOVERNANCE-CHECKPOINT-v7.32.md` 是本次交接的第一批证据，其中包含实际执行过的命令输出与未执行的验证项。
- **新工作流的固定动作：** 每个任务节点完成后直接 `push` 到 `main`（禁止 force push），并回查远端 HEAD；失败或无法执行时如实标注。详见 [AGENTS.md](../AGENTS.md)。

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

**Human-led, AI-assisted:** The owner makes product decisions and tests on a real Windows machine. **Up to v7.31** OpenAI ChatGPT assisted with source analysis, implementation, review, tests, documentation, and GitHub commits. **From v7.32** that role is held by **DeepSeek Harness**, a local coding agent with the model identifier `deepseek-flash`.

**Model and reasoning-effort transparency (2026-10-28, revised 2026-11-04):** The documentation revision of 2026-10-28 used **OpenAI ChatGPT GPT-6**; "reasoning model" is that session's own description, and its exact thinking-effort level is **not independently verifiable** and is not asserted. Since 2026-11-04, iteration is performed by **DeepSeek Harness** (`deepseek-flash`), whose reasoning-effort setting is likewise **unverified** — the harness does not expose a verifiable effort tier to the model it drives. Historical sessions and commits do not include an auditable model/effort-per-release record. A past recommendation to use GPT-6 with high reasoning effort is not proof of actual use. Neither agent's disclosure covers work the other did not perform: the boundary is commit `946c7b2` (v7.32), the first commit authored under Harness. Git author identity refers to the authenticated repository account, not the AI model. The app's optional Qwen ASR is a separate runtime integration. Unknown settings remain **unknown**, never reconstructed from guesswork. GitHub is the source of truth; chat history is not a substitute for current repository state.

**Typical loop:** real feedback → fetch current remote HEAD → scoped modular change → focused tests and existing regression gate → reproducible build and SHA verification → meaningful commit → safe remote push and HEAD verification → real user acceptance.

Synthetic Chromium/Linux tests do not establish real Windows device, USB drive, or high-bitrate decoding performance. AI-written code and tests may be wrong. User media, credentials and private data must remain outside the source repository, and high-risk migrations require explicit safeguards.

The historical single-file delivery format is no longer mandatory; the bundler remains for compatibility while the project evolves conservatively.
