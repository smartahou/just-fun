# GOVERNANCE-CHECKPOINT v7.153.0

> 日期：2026-11-18 · 基线：v7.152.1（`5c92963`）→ v7.153.0
> 范围：外壳与媒体页视觉重铸 · 第一轮（core-first：Feed 卡片 / 音频 / 图片墙 / 顶栏 / 导航 / 弹层）

## 本版变更

### 1. 设计层 `src/client/styles/35-refresh.css`（新增，约 470 行）

- **定位**：在 `30-overrides.css` 之后、`40-bookshelf.css`/`41-reading.css` 之前插入，保证阅读器/纸书/书架样式不被波及。
- **设计语言**：石墨底（`--jf-bg:#0a0f16`）+ 暖白文字 + 单一琥珀强调色（`--jf-amber:#e8b45f`）+ 玻璃 chrome + tabular-nums + 统一焦点环与过渡曲线（`--jf-ease`）。24px 栅格对齐（`--jf-gutter`）。
- **顶栏**：一条 72px 玻璃行（品牌｜搜索｜操作簇），sticky + `backdrop-filter`；搜索框 40px/12px 圆角、琥珀焦点环；操作按钮统一 36px 幽灵样式；排序按钮合并为分段控件（评分/修改时间一个容器，激活态琥珀）。
- **导航**：左下 `#studioRailToggle` 玻璃 FAB；弹出面板 `body>.mediaTabs#studioMediaRail` 收敛为 64px 宽图标坞（48×46 居中图标行、琥珀激活态、clipShelf 分隔行）；`index.html` 为五个分区按钮补 `title` 提示。
- **媒体页**：视频卡片（玻璃徽章、渐变信息罩、两行标题钳、评分片、斜纹空封面占位、悬停浮起）；音频瓦片（播放中琥珀侧条）；图片墙（玻璃文件名贴、选中环）；目录 chips（琥珀激活、虚线新建）；空态（虚线静默面板）；照片工具栏 / 批量栏 / 右键菜单 / 重命名弹窗全部玻璃化，模态主按钮琥珀实心。
- **移动端**（≤760px）：搜索整行、操作簇换行、栅格与 FAB 尺寸适配。

### 2. `scripts/visual-gallery.py`（新增，开发工具，不进 CI）

真实 Chromium + 合成媒体库自动截图 11 张（桌面 1440×900、移动 390×844，含导航展开态），输出到 `.jf-artifacts/visual-gallery/<label>/`（已被 .gitignore 忽略）。

### 3. 兼容与红线

- 阅读器、纸书分页、PDF、笔记、书架一行未动（层序保证 + 未写任何相关选择器）。
- 旧「PURE VIEWING」结构保留：单 sticky 顶栏、标题/状态行仍按原设计隐藏、导航仍为左下弹出坞——只做视觉升级，不改交互逻辑。
- 动效仅 hover/焦点层，`prefers-reduced-motion` 由既有规则继续覆盖静态场景。

## 实际执行过的验证（本机 Windows，2026-11-18）

- `node scripts/build.js`：PASS，`sourceSha256=ca6c1ed5…`，63 文件（新增 1 个样式文件）。
- `py -3.12 tests/browser.py`：PASS 15/15（JS 无异常、三种媒体模式切换、竖屏 DOM 稳定）。
- `scripts/visual-gallery.py after-final2`：11 张截图人工核对——1440 顶栏、图标坞、视频卡片、音频页；390 移动端搜索整行 + 操作换行正常。
- 迭代记录：v1 初版（顶栏/卡片 token）→ 发现滑轨为弹出坞结构后重写为图标坞（修复标签重叠）→ 修复移动端操作簇溢出。

## 未做的验证

- iPad / 手机实机局域网观感；
- 真实大媒体库（多卡片、长标题、横向视频）的网格密度与悬停；
- 阅读器与书架未跑视觉套件（本层不涉及，但未重跑以声明回归）；
- 浅色场景不存在（应用仅深色）。

## 回滚

删一行即可回到旧观感：从 `build.manifest.json` styles 数组移除 `src/client/styles/35-refresh.css` 后重建；`index.html` 的 title 属性无副作用可保留。
