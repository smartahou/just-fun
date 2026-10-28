# Just Fun v7.25 · 视频批量原音轨提取

日期：2026-10-29
上游主线：e943e2c31ff73db0e5ba0840fadfdf4446a5a199

## 范围
- 视频多选工具栏新增「提取音轨」；一次最多 150 个视频，顺序执行，失败不阻断后续，失败项保持选中供重试；显示结果摘要。
- 原沉浸 Feed 的单视频提取也切换到保真模式；原视频始终不写入。
- 以前无论原音轨为何种格式都使用 192kbps AAC 有损重编码；现在先用 FFprobe 检测首条音轨：
  - AAC→M4A，MP3→MP3，FLAC→FLAC，Opus→Opus，Vorbis→OGG，ALAC→M4A，PCM→WAV，用 FFmpeg -c:a copy 原样拷贝编码数据。
  - 不能直接封装的格式使用 FLAC 无损保存解码后的音频；不表示能够恢复原先有损压缩的数据。
- 完成后再用 FFprobe 校验真实输出编码；利用原有 data/1002 音频存放结构；HTTP 返回 method、codec、outputCodec。
- 沿用原生批量栏、FFmpeg 进度服务和本地构建，不引入其他 UI 库。
- 新增专项 audio-extraction-v725.js/.py 与 audio-batch-ui-v725.py，纳入 tests/release-gate-v703.py；README 和 package.json 更新至 v7.25.0。

## 实测与诚实边界
- 与 v7.24.2 GitHub SHA 核对：音频服务、HTTP 路由、HTML、多选状态、单视频提取原源码与归档 v7.22 一致，批量交互文件在真实最新 v7.24.2 上增量修改，保留 Alt+1～5 页面快捷键。
- 真实 FFmpeg 的 5 种编码样本（AAC、MP3、FLAC、Opus、AC3）加无音轨错误测试：23 项断言 PASS，逐个校验输出编码、格式、原视频哈希、任务锁清理。
- 独立 ffprobe packet SHA256 验证：AAC、MP3、FLAC、Opus 四种已复制音轨的压缩数据包与源视频一致。
- Chromium 桌面 1280×800 与窄屏 390×844：13/13 PASS，包括批量顺序、部分失败、失败项重试提示和原始媒体不变。
- 可信 v7.22 完整模块化归档在离线 Node 22 + PDF.js 6.4.299 / 203 资产条件下完成重建与测试；完整门禁结果按独立报告记录。不是对 GitHub 最新 7.25 全部历史门禁的远程环境复测，Windows 实机待用户确认。
- 仅在用户明确执行时增加生成音频，不修改原视频、密码库、媒体备份。
- FLAC 输出可能更大；采用第一个音轨（0:a:0），不会自动混合多声轨。
