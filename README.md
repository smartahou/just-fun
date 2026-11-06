# Just Fun

> 沉浸优先，工具第二。一个从短视频播放器自然成长起来的本地媒体、阅读与笔记工作台。
>
> Immersion first, tools second. A local-first media, reading and note-taking workspace.

**当前版本：v7.88.0 / Current version: v7.88.0** · 持续迭代 / Actively evolving

**源码许可证：[MIT](LICENSE)。** 可依照许可条款学习、修改和分发本项目有权授权的源码。仓库的 Public / Private 可见性由 GitHub 设置单独控制；源码开源不代表开放任何用户的私人媒体、笔记、缓存和密钥。

**v7.88 · 真图书口堆叠与书脊柔光**：根据用户提供的 ZIP，已将 11 档 22 张原始 RGBA WebP（64×1440）逐张按 SHA-256 校验、原样写入 `assets/paper-stacks/`，并接入离线单文件构建。旧纸双页模式用书外现有的 `.jfBookPile` 绘制真实图像，0–100% 按全书进度四舍五入到最近的 10% 左右同步切档，保持图片 64:1440 等比缩放并贴在书页后方；移除书口上的所有 CSS 假纹理、裁切与规则层线。书脊独立阴影中心暗度由 .112 恢复到 .215，保留柔和渐隐、不再引入实色缝条。正文分页、定位、读书笔记及书签图不动。新增 `tests/paper-stack-images-v788.js`。真实 Windows 视觉仍需人工验收。

**v7.87 · 中央纸缝真实接合**：旧纸两张 WebP 的内沿具有透明像素，v7.86 把漏出的黑底改为米色后成为醒目的浅灰白竖线。现在只裁左纸纹理的内右沿、右纸纹理的内左沿各 12px；保留外侧破损轮廓、书页几何和分页。旧纸在中缝直接接合，只留一层低对比的非对称凹陷暗部；无人工补色带、黑/白细线或整页浮膜。新增 `tests/paper-inner-edge-v787.js`。真实 Windows 画面仍待用户视觉验收。

**v7.86 · 书脊自然化与黑色矩形背景移除**：从用户实机截图定位两种独立视觉瑕疵：旧书双页的书脊由 v7.85 的高强度双层阴影/人工暖纸桥形成假竖带，纸张外围的四方黑边则来自固定宽高 `#jfReadCenter` 背景 `#141210`，而不是 WebP 的 Alpha 轮廓。现仅在旧纸模式下将阅读背景调整为与浅色工具栏相同的 `#e1ddd1`，让纸张不规则边缘直接呈现；用一层弱而连续、两侧逐渐透明的 64–90px 书缝光影替换双层填缝。未恢复浮膜、书板或卷曲层，也不改变分页、侧纸堆、按钮和文字。专项测试 `tests/paper-stage-and-spine-v786.js`；真实 Windows 画面仍需人工确认。

**v7.85 · 旧书书脊阴影恢复**：v7.83 去除底层实心书板及页内卷曲层后，旧纸 WebP 中央透明边缘露出 2～3px 黑色背景；旧独立书脊渐变宽度仅 28px、中心不透明度约 0.115，无法掩盖接缝，呈现不自然的黑色竖线。仅在双页、已加载成对旧纸纹理的模式，为既有独立 `.jfSpineShade` 增加局限于书缝的暖纸色过渡与左右柔和凹陷阴影。没有恢复整页覆盖膜、页内卷曲层、书板或修改 WebP 与阅读进度。专项回归 `tests/paper-spine-gutter-v785.js`；实际浏览器效果仍以 Windows 验收为准。

**v7.84 · 纸签与罕字微调**：按用户 v7.83 实机截图，仅将原图目录/笺注纸签尺寸从 32×116 收至 26×98（窄屏 27×98→23×86），保持两签相对位置与原图长宽比；将评论表格的行内罕字图片从 0.99em 收至 0.86em，限制宽高并轻微调整基线。两个调整均位于原 CSS 规则，不增加末尾覆盖样式；不改图片本体、书页纹理、正文、分页引擎或其他媒体功能。专项尺寸回归见 `tests/epub-size-tuning-v784.js`。

**v7.83 · 原图书签、罕字链路与真实纸边**：采用用户上传的两张纵向旧纸书签 PNG，经透明裁切与 WebP 缩小后作为原始图像内嵌在离线构建中，取代 CSS 仿制「目录」「笺注」标签；维持原抽屉交互。注释原文高亮仅选实际汉字，跳过逗号、句号等标点。修复《唐诗三百首新注》表格中 `kindle-cn-inline-image` 生僻字源类名被服务端 HTML 清理器丢失的问题，将语义作为 `data-jf-glyph-hint` 传到前端，沿用真实尺寸行内绘制。旧纸照片有 Alpha 透明轮廓，移除其下方实心浅色纸板及多余书板，恢复照片 100% 显示而非进一步放大裁切，继续保留侧面阅读进度纸堆。新增针对原图字节、无标点高亮、罕字语义传递的 Node 回归测试；真实 Windows 浏览器图像和四边 Alpha 效果仍需人工验收。

**v7.82 · 诗歌排版、生僻字与纸签整体校正**：以用户《唐诗三百首新注》实书截图和源 EPUB 为基准：诗歌段落（`kindle-cn-poem-left` 等）取消误加的首行两字缩进；表格或诗文中的小尺寸 `kindle-cn-inline-image` 生僻字图片按一枚行内字形排版（原 EPUB 和其他照片不动）；“目／笺”书签改为完整竖排「目录／笺注」；抽屉保留右侧浮出但不再缩放书本和影响分页；NCX 目录卷目与子项按真实 depth 分组并用有效像素缩进；笺注改成核对过的“〔原书序号〕+解释”简洁清单；旧纸模式停用多余的纸面渐变和内部卷曲图层，略微内裁照片四边扫描透明边缘。新增真实节点模拟测试 `tests/epub-visual-fixes-v782.js`；GitHub Node CI 运行情况见版本检查点，Windows 实机截图仍需复核。

**v7.81 · 旧纸目录与笺注实书修复**：针对用户实际上传的《唐诗三百首新注》增加 Calibre/Kindle `noteBack_N` ↔ `note_N` 双向链接和「【注释】」分段联合验证，确认后从纸书投影移走编号、注释段和完整已验证的标题；保留诗词、评析、辑评和不确定编号。对 EPUB2 NCX 指向的独立人工目录，新增“导航元数据 + 目录标题 + 至少八个有效不同目标链接”高置信排除。旧版覆盖右页的软件式抽屉改为书页外侧朴素泛黄纸笺，展开时临时等比缩放/退让整本书（不改纸页原本字号和分页数据），收起还原；修复纸笺点击误翻页与键盘干扰。详见 `GOVERNANCE-CHECKPOINT-v7.81.md`。

**v7.80 · EPUB「目」「笺」纸签（保守首版）**：在旧书双页模式中，从 EPUB3 NAV 或 EPUB2 NCX 读取结构化目录，将明确由 manifest 标识的导航 XHTML 从纸书页数中跳过，并在右书口用「目」抽出目录进行章节及 fragment 跳转。仅识别经 EPUB 显式 noteref 与 footnote/endnote 目标双重确认的注释；纸书正文隐藏已关联标记和同章注释块，「笺」仅按当前双页真实锚点出现，点击短暂高亮原位置。无可靠关系的数字、评析和辑评一律保留。未实现无语义标记的数字注释推断与任意人工目录页过滤。真实浏览器验收仍待执行。

**v7.78.1 · 旧纸外缘浮膜热修复**：修正 v7.52 意外重新启用的旧式内嵌 `.jfSheetStack` 书口做旧层。这层半透明装饰覆盖于真实纸张 WebP 外缘，造成左右书页出现独立竖向“膜”。恢复 v7.43 已废止它的设计；外侧独立 `.jfBookPile` 继续呈现阅读进度，保留书脊光影、纸纹、正文与分页，不修改图片母版。

**v7.54 书页阅读进度与书口精修**：左右书口厚度按整本书阅读位置独立计算：开头左薄右厚，中段接近，末尾左厚右薄；页数核算完成后使用真实全书页数，未完成时仅采用可读章节位置的明确估计，不被局部加载窗口干扰。进度曲线增强两侧辨识度，最高约 29px；外侧书边采用克制、不重复的纸层纵向纹路与微弱翘曲，保留原有 8 组、16 张旧纸 WebP，不改分页引擎、页码或阅读状态。

**v7.53 用户认可的实体旧纸素材**：原样保存用户验收的 8 组、16 张 960×1440 WebP 母图（逐张 SHA-256 核验），额外提供相同分辨率的 WebP Q83 轻量运行版（来自原图重编码而非重新生成图片，两套 SHA 均核验）。离线单文件只嵌入轻量版以控制解码开销，图案与左右成组映射不变；移除大范围泛白渐变，保留做旧三档、旧纸开关和相邻预解码。封面、分页、页码与其他模块不变。

**v7.52 旧书做旧程度**：纸书 header 在「旧」开关旁新增轻／中／重三档；保持原有 8 组成组 WebP，调档只影响纸边磨损与浅褶皱，不把更旧等同于更黄。左右书口细化为清晰且稀疏的纸层边线，取消模糊感，不更动分页或图片解码策略。

**v7.51 旧纸边缘微修**：16 张原始对页 WebP 保持不变；通过原有纹理层的静态渐变进一步减黄。取消书口周期性机械条纹，以轻微非规则轮廓及浅褐自然明暗呈现旧化，不新增逐页 SVG、运行时随机生成、滤镜或分页重排。

**v7.50 旧纸材质精修**：复用原有 8 组成组 WebP，在同一静态纹理层内提亮纸张中心、保留暖色边缘；旧纸书口降低机械感，末尾空白对页沿用同组右侧材质，不新增正文页。

**v7.48 对页成组旧纸**：8 组 16 张原始 WebP 随离线单文件打包，同一实际双页始终使用一组左右素材；相邻对页预解码，页码与版心对齐，旧纸模式可关闭。

**v7.47 纸书做旧**：12 张原始静态 WebP 随单文件离线构建；同书同逻辑页固定纹理，预取相邻页；顶部「旧」按钮可关闭旧纸效果。书脊阴影严格限定在书页上下边缘之间，不再越界。

## 它是什么

Just Fun 最初用于个人短视频观看。真实使用中的问题推动它逐步加入长视频、音频、图片、TXT/EPUB/PDF 阅读与笔记；不是流媒体平台、社交产品或云端内容服务。

- **视频**：媒体浏览、沉浸式 Feed、时间轴标记和片段、长视频体验。
- **原生全屏进度同步**：退出视频全屏后保留真实播放位置，同步 Feed 自定义时间轴、时间数字与拖动条；在全屏内切换视频后也同步到当前选中的视频。
- **批量提取音轨**：在视频页多选后点击「提取音轨」。AAC/MP3/FLAC/Opus/Vorbis/ALAC/部分 PCM 格式使用 FFmpeg `-c:a copy` 保留原流；其他格式转为 FLAC 无损编码的解码音频，避免重复有损压缩。原视频不修改，失败项可重试。默认提取第一条音轨，结果在「音频 → 提取的音轨」。
- **全库统一 Hash 规则**：Hash 是整个媒体库的可选配置，不存在独立的「Hash 目录 / 工作目录」模式。启用后，根目录和任意普通子目录中的视频、音频、图片都采用 32 位匿名物理文件名，界面保留原始名称与层级。此前错误索引的原名媒体会在扫描时按写前日志安全改名，保持媒体 ID、标注和内容；非媒体文档及实体文件夹名称不自动修改。关闭 Hash 则全库保留媒体原名。
- **移动目标目录**：移动弹窗会显示媒体库内已存在的普通子目录，包括空目录、仅含文档的目录，以及媒体已移出的旧目录。目录的物理存在与是否包含媒体无关；隐藏缓存、依赖目录和符号链接不作为移动目标。不会自动修改文档或创建新目录。
- **目录显示兼容**：`/api/data` 现在明确返回目录 `state:'ready'`；移动弹窗也兼容旧版本接口省略 `state` 的记录，防止已经正确扫描的原有子目录被 UI 二次过滤。空目录、只有文档的目录及移走媒体后的旧目录均正常列出。
- **文件管理**：根目录、普通子目录与 data 目录使用同一套媒体操作；用户可明确删除或移动受管理媒体，移动目标包括已有普通子目录与 data 目录。目标重名、符号链接及失败回滚继续受保护；单项失败显示原因并保留选中。除 Hash 开启时修复旧媒体物理名称外，不自动迁移其他文件。
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
| **JustFun.cmd** | **日常唯一入口**：检查更新 → 隔离构建校验 → 安装 → 启动；更新失败时直接用现有版本启动 |
| 更新.cmd | 只检查并更新，不启动（需要先关闭正在运行的程序）|
| 启动.cmd | 纯离线启动，不联网检查 |
| 回退.cmd | 切换回上一份已验证的运行程序，不回滚用户数据 |

首次运行直接双击 **JustFun.cmd**，按提示选择自己的媒体目录。重复双击不会打开第二个实例。详见 [本地部署使用说明](本地部署使用说明.md)。

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
- **AI 工程协作者**：**v7.32 之前**为 ChatGPT（GPT-6，推理档位未核验）；**v7.32 起**为 DeepSeek Harness（`deepseek-flash`，推理档位未核验）。二者都参与需求分析、源码修改、测试、审计、工程治理及 Git 提交，但**各自只对实际参与的那部分负责**。
- **GitHub** 保存模块化源码和正式提交历史；聊天内容不是最新代码的替代品。
- **隔离 Node/Chromium 测试**验证可复现的功能；**Windows 真实设备**检验最终体验。二者不能混为一谈。
- 每轮依次进行：真实问题 → 读取最新远程 HEAD → 最小改动 → 专项与回归 → 清洁构建和 SHA 校验 → Commit/Push → 验证远程 HEAD → 用户实际使用。

这是一项由**人类作决策、AI 协作开发、自动化测试校验、真实使用持续反馈**的长期迭代工程。AI 生成的代码同样可能出错，测试未执行就不能宣称通过。

详见 [开发协作实录 / Development Workflow](docs/DEVELOPMENT.md)。

## AI 模型与推理强度 / AI model disclosure

| 项目 | 已确认的信息 |
| --- | --- |
| **v7.32 起（2026-11-04– ）** | **DeepSeek Harness 编码代理**；模型标识 `deepseek-flash`；推理强度**未核验** |
| **v6.20–v7.31（–2026-11-03）** | **OpenAI ChatGPT · GPT-6**（"推理型"描述来自当次会话自述）；具体档位**未核验** |
| **推理强度（High / Extra High 等）** | **没有任何可独立审计的档位记录**，因此不标「最高」「超高」或任何具体档位 |
| **协作载体变更** | 2026-11-04 起由 DeepSeek Harness（本地编码代理）接管日常迭代，取代单一聊天窗口；GitHub 仍是唯一源码事实源 |
| **分工边界** | ChatGPT 负责 v7.32 之前的实现与文档；DeepSeek Harness 负责 v7.32 及其后的实现与文档。**两者都不覆盖对方未参与的工作** |
| **Git 作者** | `smartahou` 是仓库提交身份，**不代表代码由人手写，也不能用于识别具体 AI 模型** |

**可追溯性。** 声明不是结论，提交才是。v7.32 由 DeepSeek Harness 完成的部分对应提交 `946c7b2`（笔记 CommonMark）、`5b6b8f7`（单命令入口）、`eff5f84`、`33016ee`（文档），提交信息与 `GOVERNANCE-CHECKPOINT-v7.32.md` 中记录的实际测试输出可逐条比对。

模型名称和推理强度属于**开发时所用 AI** 的信息，不等同于 Just Fun 运行时可选的 Qwen 语音转写模型。新增记录只在能确认时逐条注明日期、模型、作用范围和验证环境；无法确认的保持「未知」，不倒填、不推断。详见 [真实开发过程](docs/DEVELOPMENT.md)。

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

**Fullscreen playhead continuity:** Exiting native fullscreen retains the actual current video time and updates the Feed seek slider and time label, including when switching Feed items while fullscreen. **Human-led, AI-assisted development:** The owner determines product requirements, tests actual Windows behavior, and accepts changes. **AI disclosure:** Work up to and including v7.31 (2026-11-03) was produced with **OpenAI ChatGPT · GPT-6**; the "reasoning model" wording comes from that session's own description, and no exact thinking-effort level is recorded or inferable. From **v7.32 (2026-11-04)** onward, daily iteration is handled by **DeepSeek Harness**, a local coding agent whose model identifier is **`deepseek-flash`**; its reasoning-effort setting is likewise unverified. Neither statement covers work the other did not perform. The v7.32 commits `946c7b2`, `5b6b8f7`, `eff5f84` and `33016ee` are the auditable record. GitHub — not a chat transcript — is the canonical source history. Linux/Chromium synthetic tests supplement, but never replace, real device acceptance.

**Uniform Hash policy:** Hash mode is one library-wide setting, independent of folder depth or other documents. All media in the root and nested folders use 32-character anonymous physical filenames; previously indexed original-name media are safely adopted with a write-ahead journal, preserving IDs and metadata. Nonmedia files and physical directory names are left untouched. Existing original-name media files may be renamed once on upgrade, so back up the library first. **Folder API contract:** The server explicitly returns `state: ready`, while the move picker also accepts older server responses without this field; nested folders are not silently filtered out. **Move targets:** Existing regular subfolders remain selectable even if empty, document-only, or vacated by a previous media move. Hidden caches, dependency folders and symlinks are excluded. **File operations:** Media in the library root, nested folders and data/ share the same operations. Explicit moves may target existing nested folders or managed data folders, with file-identity validation, no overwrite, rollback and per-file error reporting. H.264 compatibility encoding offers a real FFmpeg cancel action (medium preset, CRF 18), leaving source media unchanged. **Audio quality:** Video batch extraction preserves supported original audio packets via `-c:a copy`; other codecs are decoded and saved as FLAC without additional lossy compression. Original video files remain untouched. **Windows:** Clone the repository; run 更新.cmd (Update) once, then 启动.cmd (Start). 回退.cmd (Rollback) switches to a previous verified runtime without undoing user data. Git, compatible Node.js, FFmpeg/FFprobe and pinned PDF.js build assets are needed.

**Privacy:** Do not submit personal media, credentials, notes, cache databases, or real user paths. Optional AI features can send data to the third-party services you choose. This is not an Internet-hardened multi-user server.

**License/publication:** Project-owned code is MIT-licensed (see LICENSE). The owner controls GitHub visibility separately. This does not grant rights over users' personal content or third-party components.
