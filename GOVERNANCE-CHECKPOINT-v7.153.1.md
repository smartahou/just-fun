# GOVERNANCE-CHECKPOINT v7.153.1

> 日期：2026-11-18 · 基线：v7.153.0（`b1a11d2`）→ v7.153.1
> 性质：v7.153.0 的所有者实机反馈修正（三轮截图核对后收敛）。

## 根因与修复

1. **导航图标坞"图标与标签叠印"**
   - 根因：历史样式把 `.studioTabIcon` 设为 `position:absolute`（早期纵向迷你轨时代的排版手段）。我 v7.153.0 的 icon-only 方案掩盖了它；恢复标签后图标仍在文档流外，与居中的标签重叠。
   - 修复：`body>.mediaTabs#studioMediaRail .studioTabIcon{position:static!important;inset:auto;transform:none;margin:0}`，按钮改为 `flex column`（图标 20px + `small.studioTabLabel` 9.5px），面板宽 68px、行高 52px。`index.html` 中五个分区与标注库按钮的裸文本改为 `<small class="studioTabLabel">`。

2. **按下态/激活态颜色分裂**
   - `#studioNameToggle`、`#videoViewToggle`、`.studioSort .sortBtn.active`、`#creatorToggle` 的按下态此前沿用旧蓝色高亮或 `font-size:0` + `⌁` 替换，与琥珀语言冲突。
   - 修复：统一 `--jf-amber-soft` 背景 + `--jf-amber-line` 描边 + 琥珀文字；`#creatorToggle` 恢复 12px 文字与 `▾`，移除 `:after` 替换。

3. **标注库行贴边裁切**：面板 padding/gap 收紧（6px/3px），标注库行独立圆角并与分区间加分隔线，底部不再被圆角裁切。

## 验证

- `node scripts/build.js`：PASS，`sourceSha256=8bb4699d…`。
- `tests/browser.py`：PASS 15/15。
- 截图核对（`scripts/visual-gallery.py` + clip 探针）：导航坞标签两行式无叠印；顶栏"名称/评分"按下态为琥珀；标注库入口完整可见。
- 探针数据：按钮 56×52、子项 icon(20×20 静态流) + label(9.5px 琥珀继承色)。

## 未做

- iPad/手机实机；真实库长标签（>4 字目录名不影响滑轨，标签固定三字内）。
