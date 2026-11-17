# GOVERNANCE-CHECKPOINT v7.153.2

> 日期：2026-11-18 · 基线：v7.153.1（`428ccc4`）→ v7.153.2
> 性质：所有者实机视觉反馈（导航图标坞特写截图）后的样式修订。

## 根因

v7.153.1 定稿后，工作区残留一批未提交的"icon-first"探索（顶部按钮去文字、排序按钮图标化、导航坞再改回纯图标并 `display:none` 标签）。对照所有者截图确认三个问题：

1. **导航坞纯图标无语义**：书房/笔记/标注库三个书类图标互相难辨，标签被隐藏后只剩 1s 延迟的原生 tooltip；
2. **标注库渲染成怪块**：按钮自身挂 `border-top` + `border-radius:13px`，1px 顶线贴圆角悬空，即 v7.153.1 修过、又被该探索改回的贴边裁切问题；
3. **激活态偏弱**，且与 v7.153.1 "图标 + 9.5px 两行式"的书面决策互相矛盾。

## 修复

- 导航坞恢复两行式：`flex column`、56×52 按钮、图标 20px 静态流 + `studioTabLabel` 9.5px；面板 68px 宽、padding 6 / gap 3；
- 标注库分隔线改为 `#clipShelfTop::before` 伪元素（left/right 8px、top -5px），移除按钮自身的 border-top 与圆角怪框；
- 激活态底色加深一档（`rgba(232,180,95,.18)`）+ 琥珀描边 + 暖白文字；
- 顶部工具栏保留 icon-first：名称/选择/视图为 36px 方形图标按钮，排序按钮为图标 + 激活箭头，`title`/`aria-label` 齐备（沿用工作区已有改动）。

## 实际执行的验证

- `node scripts/build.js`：PASS，`sourceSha256=b94db8865124…`，63 个文件；
- `python tests/browser.py`：PASS 15/15；
- `python tests/write-origin-and-instance-lock-v7152.py`：首跑因刚终止旧实例的瞬时文件占用报 `PermissionError`，立即重跑 PASS（环境瞬态，非代码问题，如实记录）；
- `node tests/media-speed-v7151.js`：PASS（改动了按钮事件所在脚本，防误伤）；
- 实机截图核对：`D:\藏\个人学习` 真实媒体库，导航坞两行式无叠印、标注库分隔线正常、激活态清晰；顶部图标按钮渲染正常（824px 窄视口与所有者 1024px 视口均核对）。

## 未做的验证

- iPad/手机实机触屏（两行式标签在小屏的缩放未核对）；
- 超长目录名/长标签对滑轨宽度的影响（标签固定 ≤3 字，未做动态截断检查）；
- `scripts/visual-gallery.py` 本轮未跑双档截图（实机截图替代，1440/390 基线下一轮补）。

## 影响面

仅 `src/client/styles/35-refresh.css`、`src/client/index.html`（顶栏按钮图标化）、`src/client/scripts/90-events-and-startup.js`（排序按钮图标渲染）；服务端零改动。阅读器/纸书/Feed 样式不受影响（35-refresh 层在书籍样式之前）。
