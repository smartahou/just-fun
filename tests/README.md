# 自动化测试说明

测试都自动创建 `jf-architecture-test-*` 临时目录。不要改成接收真实媒体库参数；只在隔离数据上允许三次错误密码清空操作。

`parity-baseline.js` 验证本次工程迁移对照（新功能发布后需重新建立黄金基线）；`isolated.py` 对照同一套模拟视频、音频、图片，验证 HTML、manifest、ICO、媒体扫描、Range、四种模式、单文件脱离工程目录启动；`security.py` 检测密码错误情况下的删除边界；`browser.py` 运行 Chromium，通过 HTML 注入与数据代理绕开测试沙箱的 localhost 导航限制，验证真实页面脚本、三种媒体模式及不同视口。

请区分测试覆盖与正式验收：浏览器模式切换测试不等于全部播放器解码、长视频转码及 Windows 实机回归通过。

`browser-preview.py` 是 v6.22 的预览/启动动画专项；使用 FFmpeg 临时生成无隐私测试视频，以 Chromium 实际解码验证首帧渐入，并通过模拟 API 延迟验证启动遮罩。

`workspace.py` 为 v6.23 专项：递归工作目录、只读文件、HTTP 安全拦截、转码两种模式、进度与 Chromium 中文目录导航（沙箱禁止 localhost 时使用 HTML 注入）。所有媒体与文档仅在 TemporaryDirectory 中生成。


v6.24 运行 `python tests/run-all.py` 可自动构建、并行执行全部现有隔离测试，结果汇总在 `dist/full-regression-report.json`，细分耗时与输出保存在 `dist/test-logs/`。也可以单独运行 `python tests/startup-port-unicode.py`，测试中文路径、源媒体层级、无 Hash/Hash 中文目录操作、系统终端粘贴与端口冲突回退。Windows 的 PTY 细项在非 Windows 平台实测，Windows 需在本机另行补测。

`browser-frames-v625.py` 是 v6.25 专项，FFmpeg 在隔离临时目录生成 640×360 视频，Playwright 使用真实 Chromium 解码并频繁拖动逐帧滑块，检查横屏卡片信息层、进度条 ≥90vw、画布不反复隐藏、暂停 seek 的回退和最终画面稳定性；此测试已纳入 `run-all.py`。

`recovery-v626.py` 通过临时视频和模拟 FFmpeg 卡顿测试截图/封面阻塞、程序中断后重启与超长视频预览限制；不接受用户目录作为参数。

`keyboard-seek-v627.py`（v6.27）使用隔离 24 秒合成视频在 Chromium 中检查主 Feed / 模拟原生全屏的 `←/→` 每次 5 秒、起止边界，以及逐帧与输入滑块的快捷键隔离；加入统一 `run-all.py`。


## v6.39 新增
- `ai-transcription-v639.py`：隔离 Node HTTP/Chromium 人工校订流程 + `ai-transcription-v639.js` 假云端响应契约测试；绝不使用真实密钥或网络。
- 发布前需补齐所有历史套件完整回归；短时执行环境单次 timeout 不能视作通过。

## v6.47 · Zoom to Crop

`python tests/photo-crop-zoom-v647.py`：在隔离目录生成 PNG/JPEG，真实 Chromium 中裁剪后自动缩放居中、动画、再次改变裁剪边界、Alt 拖动底图保持框固定，以及导出原像素区域与原图 SHA-256。和 v6.46 裁剪专项共同纳入全量回归清单。

## v6.57 · PDF 连续阅读专项
运行 `python tests/pdf-reader-v657.py` 验证并发缓存、严格参数、黑屏防护、快速翻页、键盘导航、失败回退、源文件SHA。其余正式回归使用 `python tests/run-all.py --batch 1..4` 和 `--merge`。

## v7.144 · 本地 HLS/Hash

`node tests/hls-local-v7144.js` 使用自动生成并销毁的临时 HLS 主清单、子清单、视频分片、初始化片段和本地密钥，分别验证 Hash 开关：匿名物理命名、清单 URI 重写、同目录及子目录相对路径、已索引 .ts 去重、资源返回内容及异常中断后的 pending 恢复。需另行运行 Chromium 实际播放及完整离线构建，不应将源代码静态检查等同于真实解码验收。

## v7.144.1 · 发布依赖准备

`node tests/deploy-deps-v7145.js` 检查 GitHub 候选锁文件依赖核验、HLS.js 首次安装兼容旧部署器的构建兜底、隔离 npm 目录与 Windows junction 保护。该测试不安装 npm 包，不访问用户媒体目录，也不等于 Windows 真机更新验收。

## v7.145 · HLS 真实播放链路与封面

`npm run test:hls` 先运行无网络的分片索引/Hash/清单 URL 测试，再运行 `tests/hls-ffmpeg-v7146.js`：创建临时的有效 H264 HLS 视频，启动仅测试使用的 loopback HTTP 服务，从匿名分片 URL 使用 FFprobe 解析视频元数据，并用 FFmpeg 产生真正的 JPEG 封面，分别检查 Hash 开/关。系统未安装 FFmpeg/FFprobe 时该后半项会标注 SKIP，不代表通过。实际 Chromium HLS.js 解码需要另行浏览器验收。

## v7.146 · 大型 HLS 清单

`node tests/hls-large-v7146.js` 创建超过旧版 5 MiB 上限的临时 HLS VOD 清单（大量引用同一分片），分别检查原名、Hash 两种模式的扫描、匿名映射、HTTP 清单改写、重复扫描幂等性，以及大容量分片索引缓存；不涉及真实媒体库。全量 HLS 入口 `npm run test:hls` 同时包含原有索引与 FFmpeg 解码测试。此项不等于 Windows 实机播放验收。

## v7.147 · 超过 64 MiB 的 HLS 流式回归

`node tests/hls-over64-v7147.js` 在临时目录生成 67 MiB 以上的合法 HLS 文本清单，分别使用 Hash/原名模式执行异步流式索引、真实 Node 文件读取、HTTP 清单按块输出、全部分片 URI 重写、缓存复用和 15 秒扫描幂等性验证。测试采用轻量响应模拟器计数字节而不将大体积响应再次缓存到内存；不操作用户媒体文件。旧 `hls-local-v7144.js`、`hls-large-v7146.js`、`hls-ffmpeg-v7146.js` 已适配新的异步索引；FFprobe/FFmpeg 回归中的 HTTP 请求改为异步子进程，避免被 `spawnSync` 阻塞事件循环。完整入口：`npm run test:hls`。需在 Windows 正式运行版补做浏览器和大文件实机验收。

## v7.148 · HLS 文件头与容器识别

`node tests/hls-sniff-v7148.js` 创建独立临时样本，测试 Hash 开启/关闭时能将真正的 HLS 清单、MP4、WebM、188 字节 MPEG-TS 和未知文件内容区分，不依赖后缀猜测；验证直接播放 MIME、虚拟 TS 分片 URL、Hash 不改动及重新扫描的稳定性。

`node tests/hls-ts-http-v7148.js` 需要 FFmpeg/FFprobe，使用临时目录生成真实 MPEG-TS 但故意命名为 .m3u8，HTTP Range 响应模拟 Just Fun 的匿名分片服务，由 FFprobe 对虚拟 HLS 清单进行实际解码，分别测试 Hash 开关；浏览器的 HLS.js 实机播放仍需额外检查。

## v7.149 · HLS 关闭后仍发声

`npm run test:hls-teardown`：不使用真实视频和媒体目录，通过模拟 HLS.js / video 与 DOM，运行 `closeFeed()` 的实际代码，验证同时打开多个 HLS 视频后关闭 Feed 会停止加载、销毁 HLS 实例、清空媒体源、释放解码器，并阻止延迟到达的 HLS 清单事件在关闭后重新播放；也覆盖小窗关闭、Feed 重建、原生视频清理与二次销毁的幂等性。该回归测试已加入 `npm run test:hls`。

## v7.150 · HLS 整组安全移动

`npm run test:hls-move` 使用独立临时目录进行原名和 Hash 两种场景的主清单 + `.ts` 分片 + 嵌套目录 + 本地密钥组合迁移；验证已索引分片的媒体 ID 及物理映射仍在、Hash 目录原名映射、成功后真实 HLS 扫描器可重新读取并隐藏相关子媒体、目标已存在共享资源时明确拒绝。注入第 2 次文件移动异常及目录索引写入异常来验证文件与元数据回滚，并模拟意外退出后的启动恢复记录。不会访问真实媒体库，也不会复制用户文件。可通过 `npm run test:hls` 运行组合测试；Windows 实机操作和磁盘异常仍需单独验证。

## v7.151 · 音视频慢速播放

`npm run test:media-speed` 检查视频时间轴循环倍速与音频菜单选择均包含 0.25× 和 0.5×，保留 1×、1.25×、1.5× 等既有档位，视频切换完整循环回到正常倍速；音频仍识别上次保存的倍速，视频界面显示当前倍速。测试不需要媒体文件，浏览器实际播放需单独验证。
