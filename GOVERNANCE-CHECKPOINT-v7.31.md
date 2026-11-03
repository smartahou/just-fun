# Just Fun v7.31 · 原生全屏退出后播放进度同步

日期：2026-11-03
父提交：6364e413f3528b74a2715f62694bf890d7af2997（v7.30.0）
变更范围：src/client/scripts/50-video-playback.js；新增 tests/fullscreen-progress-v731.py；发行门禁、版本及中英文 README。

## 真实根因
- 原生 Feed 视频进入全屏时，captureNativeFullscreenOrigin() 记录了当时的 currentTime。
- 退出时 restoreNativeFullscreenHost() 对同一视频也无条件重新写入 src 并执行 video.load()，随后尝试把 currentTime 设回进入全屏时的快照。因此原本已播放到更后位置的时间轴发生回退，且浏览器时间轴与自定义进度条可能短暂显示不同步。
- 在全屏内向上/下切换视频时，实际只有一个原生 video 元素复用不同视频源；该元素位于旧 Feed 卡片，退出后的新卡片此前没有继承真正播放到的秒数。

## 修复
1. 同一视频正常退出全屏：不再重载 src、不再把 currentTime 写回全屏入口快照，保留现有解码缓冲与真实时间；立即刷新 Feed 时间轴、文本、进度条。
2. 全屏内切换视频：先读取原生全屏所播放的**当前媒体 ID 和实际 currentTime**，再把复用的旧宿主恢复为原始视频；对当前选中 Feed 视频应用捕获的播放时间，已加载 metadata 即时应用，否则在 metadata 可用时应用。
3. 异步应用带 currentFeedKey、视频 DOM、dataset.itemKey、jfFeedSessionGeneration 守卫，不让旧全屏会话的延迟事件修改新页面或其他媒体。
4. 恢复原宿主时保持单声源约束，避免全屏退出后错误复活旧卡片的视频；不改变 Feed 热窗口、虚拟渲染、A-B、笔记、批量音轨提取、目录和 Hash 等其他功能。
5. 新增 tests/fullscreen-progress-v731.py：从实际构建 JS 读取 HTML，以独立 FFmpeg 合成 MP4 和 Chromium 实测桌面 1280×800、窄屏 390×844 两种布局的原生全屏、时间跳转、进度条与时间文字更新；覆盖全屏视频切换、单一音源、720 条视频虚拟列表、原始测试媒体 SHA 不变。

## 实际验收与限制
- 修复模块来源与 GitHub 父 Commit 中对应文件的 Git Blob SHA `e3490fb7328e9faeed96aa96387115517fd46324` 一致。
- 实际测试代码的新 Blob SHA `2d084964a0629259b675e9b53f7284e900ebdb98`；新增测试 Blob `7975e15ce04bafba948b79b426a661502ab5164e`。提交内容与本地测试指纹相符。
- 用原始 v7.22 代码反向运行新测试可复现失败；切回修复版后，新全屏进度专项 **26/26 PASS**。
- Feed 大列表及原生全屏压力回归 tests/video-feed-stress-v719.py：**27 PASS**；热窗口 v7.20 **17 PASS**；旧会话隔离 v7.21 **25 PASS**。
- v7.22 完整历史基线门禁：**61/61 PASS**，并通过 `--verify`；这是在 v7.22 可信完整模块化源码和与当前远程 Git SHA 一致的受影响 Feed 模块上执行，并非把 GitHub v7.31 最新完整代码重新克隆后运行全部最新 70+ 项测试。**新增 26 项在门禁之外单独实际执行成功，并已纳入今后的发行门禁。**
- 离线构建与 Node --check、只读 --doctor 通过，PDF.js 6.4.299 共 203 资源；历史离线构建产物 SHA-256 `445edf2a7b1fc6c1e6707eba2d53cabd08c08a7d34f94bf57e5a4dc59f4858c5`，不冒充最新全仓构建 SHA。
- Linux Chromium 合成媒体已通过；Windows 用户实机、真实视频解码和特定显卡环境尚未验收。
- 无任何用户个人媒体文件、私人元数据或磁盘迁移操作。

## 使用
关闭运行中的 Just Fun → 双击 `更新.cmd` → 完成后 `启动.cmd`。在同一个视频全屏播放并退出，检查播放位置和自定义进度条；再在全屏内上下切换一条视频并退出，检查当前视频的时间同步。
