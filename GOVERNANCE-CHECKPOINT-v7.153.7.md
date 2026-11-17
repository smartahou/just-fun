# GOVERNANCE-CHECKPOINT v7.153.7

> 日期：2026-11-18 · 基线：v7.153.6（`58607ad`）→ v7.153.7
> 性质：所有者否定手绘 SVG 质感（"丢到 icon site 里都会被嘲笑"），全套图标换为 Lucide 官方几何。

## 根因

此前所有界面图标（顶栏、导航坞、目录条、排序键、搜索、刷新、＋）都是我手写的近似路径，比例、圆角、线条节奏不统一，质感业余。

## 修复

统一采用 **Lucide**（MIT，24×24、stroke 2、round cap/join）官方路径，逐项对应：
- 搜索 search、刷新 refresh-cw、收藏 star（描边）、视图切换 layout-list、名称 tag、选择 square-check、创作者 user、评分 star（实心 currentColor）、修改时间 clock；
- 导航坞：视频 clapperboard、图片 image、音频 music、书房 book-open、笔记 notebook-pen、标注库 bookmark；导航开关 panel-left；
- 目录条：全部视频/全部素材 layout-grid、原媒体目录 folder、新建 plus（原文本 "＋" 改为 SVG）；
- 排序按钮初始态清空文本，由启动时的 `updateSortButtons()` 注入官方图标（修复首次加载前显示文字的窗口期）。

## 实际执行的验证

- `node scripts/build.js`：PASS，`sourceSha256=d8bf85cf6bbc…`（前置 486d0de3 版本因 ＋ 按钮 SVG 缺尺寸修正后替代）；
- 实机截图核对（824px 与 1024px 视口）：顶栏 / 目录条 / 导航坞全部渲染为 Lucide 图标，＋ 按钮正常；导航坞六图标无变形。
- 未跑 browser.py（改动为静态 SVG 字符串与一处 CSS 尺寸）。

## 未做的验证

- browser.py 与 iPad 实机；图片/音频页的目录条与排序未单独截图。

## 影响面

`src/client/index.html`、`35-refresh.css`、`30-photo-library.js`、`90-events-and-startup.js`。无服务端变更。
