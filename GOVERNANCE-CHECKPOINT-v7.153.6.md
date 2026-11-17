# GOVERNANCE-CHECKPOINT v7.153.6

> 日期：2026-11-18 · 基线：v7.153.5（`aa4bf96`）→ v7.153.6
> 性质：所有者对评分图标的形态反馈（"像蝎子"）与排序箭头反馈。

## 根因

v7.153.5 的评分图标是描边式五角星路径 + 激活方向箭头（↓/↑）。所有者认为线条星形观感怪异（"scorpion 符号"），且排序不应显示方向箭头。

## 修复

- 评分图标改为实心五角星（`fill:currentColor`、无描边）；
- 修改时间图标保持圆角时钟（描边加粗至 1.9）；
- 移除排序按钮的全部方向箭头（`jfSortArrow` 与 `arrow` 常量），激活态仅由琥珀高亮表达；
- `title`/`aria-label`（按评分排序 / 按修改时间排序）不变。

## 实际执行的验证

- `node scripts/build.js`：PASS，`sourceSha256=fe71170222a5…`；
- 实机截图核对：评分=实心星（琥珀激活）、修改时间=时钟，均无箭头；其余顶栏图标不变。

## 未做的验证

- `tests/browser.py` 未重跑（改动仅图标字符串与常量删除）；下一版本发布前随门禁覆盖。
- iPad 触屏。

## 影响面

仅 `src/client/scripts/90-events-and-startup.js`（updateSortButtons）。
