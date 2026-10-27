# Just Fun v6.93 · 悬浮滑杆点击防跳与图库缩放平衡

- 真实维护基线：v6.92 完整模块化工程；修改前从源码离线重建 SHA `4aff621cb687075fe1af6d36ba7b26ca59c0b3bd8fa33935aefee86eeed09a0c` 与正式发行一致。
- 修改源码：`src/client/scripts/99-reading.js`、`src/client/scripts/00-state-and-api.js`、`src/client/scripts/80-library-actions.js`、`src/client/index.html`，以及 `tests/photo-zoom-fine-v692.py` 与新增 `tests/notes-image-click-stable-v693.py`。
- 修复笔记图片悬浮控制栏鼠标按下瞬间下移77px的根因：父级笔记弹层有 `backdrop-filter`，导致旧 `position:fixed` 的包含块不是 viewport。改为图片容器内 absolute 锁定屏幕位置，拖动时每次根据图片实际位置换算局部坐标，按下不跳位。
- 图库放大调整为中等灵敏度：标准 100px 滚轮步进约 8.9%（介于旧16%与v6.92的4.9%），高精度触控板仍按deltaY连续精调，极端增量上限不变；双指捏合距离比幂从0.72调为0.85；网格滑杆步进由2px调整到4px。
- 真实 Chromium 浏览器交互专项：笔记悬浮控制器点击/拖拽28/28 PASS；图库滚轮/触控板/双指缩放10/10 PASS；笔记数据与原媒体源文件保持完整。
- 历史正式30/30套全部通过，JS 构建指纹和测试脚本指纹严格合并一致，套件累计 `197.853s`。
- 最终 index.js SHA-256：`09882f6d5acb45a2f573e05e23dc8377c55a2ae25736968d693afcee161b3938`。
- Windows 用户实机与真实鼠标/触控板手感未经验证；以上是 Linux Chromium 的实测结果。
