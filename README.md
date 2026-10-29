# Just Fun

> 沉浸优先，工具第二。一个从短视频播放器自然成长起来的本地媒体、阅读与笔记工作台。
>
> Immersion first, tools second. A local-first media, reading and note-taking workspace.

**当前版本：v7.26.0 / Current version: v7.26.0** · 持续迭代 / Actively evolving

**源码许可证：[MIT](LICENSE)。** 可依照许可条款学习、修改和分发本项目有权授权的源码。仓库的 Public / Private 可见性由 GitHub 设置单独控制；源码开源不代表开放任何用户的私人媒体、笔记、缓存和密钥。

## 它是什么

Just Fun 最初用于个人短视频观看。真实使用中的问题推动它逐步加入长视频、音频、图片、TXT/EPUB/PDF 阅读与笔记；不是流媒体平台、社交产品或云端内容服务。

- **视频**：媒体浏览、沉浸式 Feed、时间轴标记和片段、长视频体验。
- **批量提取音轨**：在视频页多选后点击「提取音轨」。AAC/MP3/FLAC/Opus/Vorbis/ALAC/部分 PCM 格式使用 FFmpeg `-c:a copy` 保留原流；其他格式转为 FLAC 无损编码的解码音频，避免重复有损压缩。原视频不修改，失败项可重试。默认提取第一条音轨，结果在「音频 → 提取的音轨」。
- **文件管理**：允许对工作学习来源视频明确执行删除与移入受管理的 data 目录；默认不会自动整理、改名或迁移来源。失败时提示具体原因、保留失败项选中；目标冲突不覆盖任何文件。
- **视频转码**：支持在浮动进度窗点击「取消转码」，由本地服务真实终止 FFmpeg 并清理半成品；H.264 CRF 18 采用 medium 预设以降低等待。源视频始终保留。
- **音频**：独立 MP3/其他音频浏览与播放。
- **图库**：查看、缩放、裁剪和相关操作。
- **书房**：PDF、EPUB、TXT 阅读与摘录。
- **笔记**：富文本与 Markdown，关联摘录和媒体标记。
- **本地优先**：用户自己选择媒体目录，按需要启用密码、Hash 和元数据保护。
- **页面体验**：独立记忆浏览状态和滚动位置，Alt+1～5 快速切换视频、图库、音频、书房、笔记。

部分 AI 语音转写功能需要用户主动配置第三方服务与自己的 API Key，并非全部离线或默认启用。

## Windows 安装与使用

准备 Git for Windows、Node.js 22.13+（22.x）或 24+、FFmpeg/FFprobe。首次安装锁定 PDF.js 依赖需要 npm 网络。克隆仓库：

~~~powershell
git clone https://github.com/smartahou/just-fun.git D:\JustFun
~~~

在工程目录使用以下入口：

| 文件 | 用途 |
| --- | --- |
| **更新.cmd** | 获取正式分支，隔离构建、验证并安装新版 |
| **启动.cmd** | 启动已验证的版本，不自动联网更新 |
| **回退.cmd** | 恢复上一份已验证的运行程序，不回滚用户数据 |

首次运行 **更新.cmd → 启动.cmd**。启动后按提示选择自己的媒体目录。更新之前先关闭正在运行的程序。详见 [本地部署使用说明](本地部署使用说明.md)。

## 模块化源码与构建

| 路径 | 内容 |
| --- | --- |
| src/client/ | 页面、样式与交互 |
| src/server/ | Node.js 本地服务、索引、安全、路由 |
| src/media/ | 媒体处理 |
| scripts/ | 离线构建、部署和诊断 |
| tests/ | 隔离回归与合成测试素材 |
| build.manifest.json | 显式模块拼接顺序 |

~~~bash
npm install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund pdfjs-dist@6.4.299
node scripts/build.js
node dist/douyin.js --doctor
python tests/release-gate-v703.py --full --timeout 110
python tests/release-gate-v703.py --verify
~~~

构建工具本身使用 Node 内置模块，并从锁定版本 PDF.js 读取第三方资源；生成的 dist/douyin.js 不是源码维护入口。历史模块仍有共享作用域与拼接顺序约束，不能在未经测试的情况下直接全部改写为 ESM。回归测试应使用隔离媒体目录，不使用真实个人媒体。

## 真实开发模式 / How we really build this

**这不是传统团队开发，也不是 AI 完全自动写完的软件。**

- **人类项目拥有者**负责发现需求、界定功能、审美与交互决策、Windows 真实体验和最终验收。
- **ChatGPT** 作为跨会话 AI 工程协作者，参与需求分析、源码修改、测试、审计、工程治理及 Git 提交。
- **GitHub** 保存模块化源码和正式提交历史；聊天内容不是最新代码的替代品。
- **隔离 Node/Chromium 测试**验证可复现的功能；**Windows 真实设备**检验最终体验。二者不能混为一谈。
- 每轮依次进行：真实问题 → 读取最新远程 HEAD → 最小改动 → 专项与回归 → 清洁构建和 SHA 校验 → Commit/Push → 验证远程 HEAD → 用户实际使用。

这是一项由**人类作决策、AI 协作开发、自动化测试校验、真实使用持续反馈**的长期迭代工程。AI 生成的代码同样可能出错，测试未执行就不能宣称通过。

详见 [开发协作实录 / Development Workflow](docs/DEVELOPMENT.md)。

## AI 模型与推理强度 / AI model disclosure

| 项目 | 已确认的信息 |
| --- | --- |
| **本次文档协作者（2026-10-28）** | **OpenAI ChatGPT · GPT-6（推理型模型）** |
| **当前推理强度（High / Extra High 等）** | **未获得可核验的精确档位记录**，不擅自标为「最高」或「超高」 |
| **Just Fun 历史迭代** | 多轮、跨会话的 ChatGPT 协作；既有 Git 提交与发行记录**没有逐版本记录模型及推理强度**，不得推断整个工程始终使用 GPT-6 |
| **Git 作者** | GitHub 上的 `smartahou` 是仓库提交身份，**不代表代码全部由人手写，也不能证明具体 AI 模型** |

模型名称和推理强度属于**开发时所用 AI** 的信息，不等同于 Just Fun 运行时可选的 Qwen 语音转写模型。未来可在验收记录中逐版注明模型名称与**实际可验证**的推理档位；未记录的保持「未知」。详见 [真实开发过程](docs/DEVELOPMENT.md)。

## 安全、贡献与许可

不要将私人媒体、笔记、缓存、密码、API Key、本机用户路径或实际个人内容上传到本仓库及公开 Issue。服务默认仅供本机使用，不应用于直接公网部署。这里没有完整渗透测试或全媒体加密承诺。

- [安全与隐私 / Security](SECURITY.md)
- [贡献指南 / Contributing](CONTRIBUTING.md)
- [第三方组件 / Third-party notices](THIRD-PARTY-NOTICES.md)
- [开源前检查 / Public release checklist](OPEN_SOURCE_CHECKLIST.md)
- [架构沿革](ARCHITECTURE.md) · [测试说明](tests/README.md)

**许可：MIT。** 第三方组件仍适用各自的许可证；用户私人媒体与个人数据不在源码许可范围内。

---

## English summary

Just Fun is a **local-first personal workspace** for video, audio, pictures, books (PDF/EPUB/TXT), and notes. It started as a small personal short-video viewer and grew through repeated real-world use. Its guiding principle is **immersion first, tools second**.

**Human-led, AI-assisted development:** The owner determines product requirements, tests actual Windows behavior, and accepts changes. ChatGPT assists across conversations with engineering, testing, reviews, documentation and verified GitHub commits. **AI disclosure:** This documentation update (2026-10-28) was assisted by OpenAI ChatGPT **GPT-6** (reasoning model). The exact High/Extra High thinking-effort setting is not independently verifiable here, and prior project iterations have no reliable per-commit model/effort record; neither should be invented. GitHub — not a chat transcript — is the canonical source history. Linux/Chromium synthetic tests supplement, but never replace, real device acceptance.

**File operations:** Explicit user-initiated deletion or moving source media into a managed data folder is supported, with validation, no overwrite, rollback, and failure details. H.264 compatibility encoding offers a real FFmpeg cancel action (medium preset, CRF 18), leaving source media unchanged. **Audio quality:** Video batch extraction preserves supported original audio packets via `-c:a copy`; other codecs are decoded and saved as FLAC without additional lossy compression. Original video files remain untouched. **Windows:** Clone the repository; run 更新.cmd (Update) once, then 启动.cmd (Start). 回退.cmd (Rollback) switches to a previous verified runtime without undoing user data. Git, compatible Node.js, FFmpeg/FFprobe and pinned PDF.js build assets are needed.

**Privacy:** Do not submit personal media, credentials, notes, cache databases, or real user paths. Optional AI features can send data to the third-party services you choose. This is not an Internet-hardened multi-user server.

**License/publication:** Project-owned code is MIT-licensed (see LICENSE). The owner controls GitHub visibility separately. This does not grant rights over users' personal content or third-party components.
