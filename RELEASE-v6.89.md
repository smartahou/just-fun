# Just Fun v6.89 · 滑杆真实垂直对齐

## 根因与修复
v6.88 以滑杆 input 的外框中线判断对齐，遗漏了继承的 CSS `padding-bottom: 16px`：
`body.jfNotesMode .jfDeskEditor input` 把标题输入框的底部内边距错误应用于笔记顶部与摘录中的 `type=range`。
即使外框中线对齐，真实圆点和滑轨仍然上浮。
本版以具有更高优先级的 `type=range` 精确规则清除 padding/border/margin，其他文本输入框保持不变。

## 像素级验收
真实 Chromium 1600×960 下，保存渲染截图并通过像素颜色提取圆点实际中心：
- 全部图片滑杆圆点和百分比文本框中线误差：0.32px
- 摘录单张滑杆圆点和百分比文本框中线误差：0.71px
- 二者继承底部内边距均为 0px
- 摘录卡片保留图片控制区最小宽度保护。

验收脚本：`tests/notes-optical-v689.py`（8项真实浏览器检查）及 v6.88 光标/编辑区等专项。
正式30套回归报告 `dist/full-regression-report.json` 以本构建 SHA 和测试指纹进行严格合并。

仅用户 `index.js` ZIP 用于替换，完整工程另行存档。Windows 实机尚未验证。
