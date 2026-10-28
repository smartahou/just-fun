# Just Fun v7.22 · 媒体工作台独立现场与滚动位置恢复

日期：2026-10-28

## 变更边界
- 基线：GitHub `smartahou/just-fun` `main`，迁移 Commit `d3d048f1d0e3897c273c2a727e091a473cc1f2d1`，Tree `d2da79eae1b3df13ed03f1b28d1f2964cd31f548`。本次提交前已核对本地相关源码 Git Blob 与远程一致。
- 修改 `src/client/scripts/00-state-and-api.js` 与 `src/client/scripts/80-library-actions.js`。不变更后台 API、媒体播放器、持久化协议、PDF.js 和用户媒体目录。
- 视频、图片、音频三个工作台在当前浏览器页面会话中独立记录并恢复：滚动位置、当前目录、搜索、收藏筛选、排序、创作者过滤及选择状态。首次打开媒体页从顶部开始。
- 取消从其他媒体页返回视频时强制重置为「原媒体目录」的旧规则。首次进入视频仍以「原媒体目录」为默认。
- 导航完成后以一次同步与一次 requestAnimationFrame 恢复滚动，附加会话令牌防止快速切换时旧恢复任务污染新页面。虚拟视频网格同步刷新可见区域。
- 所有页面快照只在浏览器运行内存中，不写入本地存储、不保留历史，不触碰 Workspace 与密码库。暂不扩大到书房/笔记编辑器内部上下文（保留既有安全关闭流程）。

## 验证范围
- 新增 `tests/media-tab-memory-v722.py`：隔离真实 HTTP 服务与桌面 / 手机 Chromium，720 条合成视频、160 条音频、100 张图片，42 项断言。原始测试媒体校验未改变。
- 正式发布门禁使用 `tests/release-gate-v703.py --full --timeout 110`，纳入新版专项。
- 独立清洁重建、正式 JS SHA、`node --check`、`--doctor`、GitHub HEAD 更新及发行 ZIP 内容均应在发布时核实。
- Linux 合成测试不能代表 Windows 高码率真实视频的解码首帧、USB 机械盘唤醒、NTFS 故障恢复；Workspace v2 仍非生产迁移。
