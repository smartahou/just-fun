# GOVERNANCE-CHECKPOINT v7.157

> 日期：2026-11-18 · 基线：v7.156 → v7.157
> 性质：透背密度按书脊加权（非对称遮罩）；顺手完成漫画叶与整页扫描书的压力测试。

## 根因 / 意图

所有者「继续吧」。v7.156 的透背已可见，但遮罩是对称的（两侧 9% 起渐隐、中部全密度），墨迹像通篇均匀水印。物理上，装订处受压最重，对页墨色以书脊为峰、向书口衰减并留有裁切边。同时对两类高风险页面（漫画叶、整页扫描图版书）做了显式核对，确认 v7.154–v7.156 的叠层不会把它们做脏。

## 修复

1. **`.jfGhost` 密度遮罩非对称化**（`42-paper-aging.css`）：
   - 左叶（书口在左、书脊在右）：`transparent 0% → .38 13% → .62 52% → .92 86% → #000 100%`；
   - 右叶镜像：书脊侧 `#000 0%`，书口侧 `transparent 100%`；
   - 书口最外 1–2% 完全清空，避开像素级裁切边；基础透明度仍为 .09。
2. 测试扩充（`tests/paper-aging-visibility-v7155.js` 第 7 断言块）：左右遮罩必须存在且方向互为镜像（左叶透明起、右叶实色起）。

## 实际执行的验证

- 压力测试（浏览器实机，构建产物）：
  - 《名侦探柯南（卷1）》：`jf-comic-leaf` 叶上 `.jfAging` 与噪点叠加后画面干净，`img` 保持 `normal` 混合、无 sepia/multiply（预期，漫画通道）；无 ghost（innerText 为空自动隐藏）。
  - 《故宫藏影》：该 PDF 为整页扫描，图片页按 `jf-comic-leaf` 通道处理（`blend:normal / filter:none`），未被误上 multiply——与 v7.154 的设计一致，非缺陷。
  - 《崩溃的帝国》文字页插图：仍为 `sepia(.14) contrast(.94)` + multiply。
- `node tests/paper-aging-visibility-v7155.js`：PASS。
- `node scripts/build.js`：PASS，`sourceSha256=8beb507ebe2acd0b…`，`htmlBytes=19,357,730`。
- 杀掉 3865 旧监听进程，删除 `D:\藏\个人学习\.douyin-nav-cache\instance.lock`，重启。
- 浏览器实机双页（emulation 1680 宽）：左叶 ghost 计算样式 `mask-image:linear-gradient(90deg, rgba(0,0,0,0) 0%, …)`（书口透明、书脊实色）；截图核对书口侧透印消失、向书脊渐浓。截图存于会话临时目录（page-2026-11-18T05-08-35-299Z.png）。

## 未做的验证

- iPad 局域网观感未验收；
- 透背 .09 与书脊加权后的最终浓度待所有者实机确认；
- 右叶（书脊在左）镜像遮罩仅在计算样式层面核对，未单独截图（左右使用同一规则组镜像，风险低）。

## 影响面

`src/client/styles/42-paper-aging.css`（ghost 遮罩）、`tests/paper-aging-visibility-v7155.js`（断言）、`package.json`（版本号）。无 JS、无布局、无分页变化。
