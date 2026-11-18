# GOVERNANCE-CHECKPOINT v7.156

> 日期：2026-11-18 · 基线：v7.155 → v7.156
> 性质：纸书视觉继续加压——统一成品老化层（页顶光、边缘泛黄、四角磨损、foxing）进入照片纸模式；透背与噪点在 v7.155 基础上再提一档。

## 根因 / 意图

所有者认可 v7.155 的透背修复后指示「继续压」。检查后发现：v7.147–v7.155 的老化层（纸浆斑、foxing、四角磨损、页顶灯光、边缘氧化、页脚积尘）全部挂在 `.jfSheet` 背景与 `.jfSheetBody::after` 上；旧纸照片 WebP 是不透明 `::after`（z 0），把 sheet 背景整层盖住，所以在照片模式里这些层从未到达眼睛，8 组照片纸各自为政，不像同一本书；可见的只有噪点（盖在文字上）和透背。

## 修复

1. **`99-reading.js`**：ghostLeaf 旁新增 `agingLeaf(sheet)`——为每张叶插入惰性 `.jfAging` div（`aria-hidden`，位于第一个 `.jfSheetBody` 之前 = 照片 z 0 之上、正文 z 2 之下），每帧渲染时左右叶各确保一次。
2. **`42-paper-aging.css` 新增第 6 节**：
   - `.jfAging`：`position:absolute;inset:0;z-index:1;pointer-events:none`，普通混合，携带页顶灯光（白色 radial）、按叶种子 `--jf-age-x1/y1/x2/y2` 的两处 foxing、四角磨损、四边泛黄 linear 渐变、页脚积尘；强度约为主层的一半；
   - `.jfReader.paged:not(.jf-aged-paper) .jfAging{display:none}`：纯 CSS 纸模式背景已有同一套，避免叠加两遍。
3. **继续加压**：`.jfGhost` 不透明度 .085→.09；印刷噪点层 `.jfSheetBody::after` .13→.15。
4. 无布局/分页/DOM 语义变化；覆盖层不接收事件、不参与测量。

## 实际执行的验证

- `node tests/paper-aging-visibility-v7155.js`（已扩充 v7.156 断言：`.jfAging` 层级 1、非照片模式隐藏、99-reading 注入与 aria-hidden、双叶每次渲染）：PASS。
- `node tests/aged-paper-default-v768.js`、`node tests/reading-preferences-v7108.js`：PASS。
- `node scripts/build.js`：PASS，`sourceSha256=e6ac3142f06d1847…`，`files=64`，`htmlBytes=19,356,836`。
- 杀掉 3865 旧监听进程，删除 `D:\藏\个人学习\.douyin-nav-cache\instance.lock`，以 `cmd /c "echo D:\藏\个人学习| node dist\douyin.js"` 重启。
- 浏览器实机（构建产物）：书房 →《崩溃的帝国——明信片中的晚清》→ 纸书双页展开（emulation 1680 宽，`twoSheets=true`）。DOM 顺序实测 `jfGhost → jfSheetStack → jfSheetCurl → jfAging → jfSheetBody×3`；计算样式：`.jfAging` `z-index:1 / display:block`、`.jfGhost` `z-index:1 / opacity:.09`、噪点 `opacity:.15`。截图核对：页顶带灯、四角与四边轻微泛黄、透背镜像文字可见，与插图页（袁世凯肖像，multiply + sepia 生效）观感一致。截图存于会话临时目录（page-2026-11-18T04-50-01-248Z.png）。
- `Invoke-WebRequest` 之前一轮构建已核对端口产物一致性；本轮 dist 重建后重载即取自磁盘产物（服务重启于构建之后）。

## 未做的验证

- iPad 局域网观感未验收；
- 噪点 .15、老化覆盖层强度在实机 100% 缩放下的最终接受度待所有者确认（可再调档）；
- 漫画书中 `.jfAging` 覆盖层与 `.jf-comic-leaf` 的叠加观感未逐页核对（逻辑上同样生效）。

## 影响面

`src/client/scripts/99-reading.js`（agingLeaf 注入）、`src/client/styles/42-paper-aging.css`（第 6 节 + 两处强度）、`tests/paper-aging-visibility-v7155.js`（扩充断言）、`package.json`（版本号）。无服务端变更，无数据结构变更，无分页/几何变更。
