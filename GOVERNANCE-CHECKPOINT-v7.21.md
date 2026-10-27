# Just Fun v7.21 · Feed 会话隔离与异步回调防串扰

日期：2026-10-27

## 基线与变更范围

基线是 v7.20《Feed 有限热窗口复用与低风险流畅度优化》完整模块化源码 ZIP。修改前使用离线构建确认 `dist/douyin.js` SHA-256 为：
`052855999040b85cca5e9723431173d369940f8984dec99153ef192c6c868e03`，与 v7.20 正式 ZIP 中 `index.js` 完全一致。

本轮生产代码**只改** `src/client/scripts/60-video-tools.js`。新增 `jfFeedSessionGeneration`，每次进入或退出 Feed 都将旧一轮滚动观察回调和首帧启动 RAF 失效；观察器仅接受仍属于当前滚动容器的 section；返回首页的延迟定位也不会跨越新的 Feed 打开操作。

不变：播放器 DOM 窗口半径 2（最多 5 个视频节点）、热窗口预加载预算、沉浸手势、时间标注、原生全屏、多开/音频共存、Workspace、密码库、后端 API、用户数据与媒体文件。

## 为什么要改

`IntersectionObserver.disconnect()` **不保证**取消已经排队的回调。旧 Feed 关闭／重新打开后，旧回调可能在新 DOM 里更新 `currentFeedKey`、触发 `hydrateFeedWindow()`，造成切换状态回退。类似地，`requestAnimationFrame()` 启动首帧也可能在会话已退出后被调用。修复仅使用会话令牌和轻量 DOM 所属检查，不引入新的缓存或复杂状态机。

## 测试证据

- 新增 `tests/feed-session-isolation-v721.py`，真实 Chromium 1440×900 与 390×844，720 条合成 MP4，**25/25 断言通过**。
- 复现/验证旧回调强制迟到、关闭后回调、快速开关、旧 RAF 被拦截、窗口媒体节点上限、来自脱离 DOM 的 section、小列表回调隔离及文件未变。
- 正式 `python tests/release-gate-v703.py --full --timeout 110`：**60/60 PASS**，无跳过；`--verify` 二次校验 PASS。
- 全量测试累计执行 **262.776 秒**；正式构建 SHA-256：`29bea900604b103de493bcfceeb2f4cbea84a71507521b605f966ecf9159de74`。
- 仍覆盖 v7.18 首页 720 条视频、v7.19 沉浸 Feed、v7.20 热窗口，以及 Workspace 数据与 PDF/书房/图库专项。

## 环境与界限

Node 22.16.0、系统 Chromium、FFmpeg、Python Playwright，Linux 隔离媒体样本。不能由此宣称 Windows 真实高码率视频首帧、USB 硬盘唤醒、NTFS 异常断电已测试。该版本是**防串扰稳定性修复**，而不是提供未经测量的帧率、磁盘缓存或真实解码提升。

## 后续断点恢复规程

1. 只以本版完整模块化源码 ZIP 为下一轮基线；先清洁重建并核对正式 `index.js` 的 SHA。
2. 正式发布先检查全量门禁绑定的源码 SHA/测试指纹，再独立从源码归档解压离线重建。
3. 用户发行包严格只包含 `index.js`，不包含媒体、测试库、内部日志或隐私数据。
4. Windows 真实文件系统与 4K/高码率媒体首帧问题属于尚未完成的独立实测，不要拿 Linux 合成数据替代。
