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
