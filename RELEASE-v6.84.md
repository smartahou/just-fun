# Just Fun v6.84 · 笔记标题轻量化与舒适间距

- 开发唯一基线：v6.83 文件库真实完整模块化工程；重建 SHA 验证一致后修改。
- 变更范围：`src/client/styles/41-reading.css`；历史 `notes-one-surface-v682.py` 更新旧字号断言；新浏览器样式专项 `notes-masthead-v684.py`。
- 笔记标题直接复用图库实际 computed 样式：20px / 510 / letter-spacing -.045em；原标题 23px / 710。
- 布局修复：原第一行 32px，但 header 被强制 min-height45px，标题与按钮实际重叠约 2px；现 grid 28px / 36px / 17px，桌面与 390px 视口实测两者可见距离 19.5px。
- 按钮：34px 高 / 12px / 550字重，比原按钮更轻。
- 用户数据：未更改阅读、笔记存储、文本编辑、媒体服务逻辑。
- 新专项 9/9，单笔记编辑区 22/22，退格边界 10/10，三套合计 41/41 PASS。
- 正式历史回归 30/30，wall=166.204s，全数 exit0；测试指纹 61c63b645cd5c1505cb103308f9d8ed64454cfc64d7847081ee4785dac945f09。
- 正式 JS SHA-256：a04bca51656afadee23a7eff26604be743fb0c85e92201da2eb2818c123d2aa5。
- Windows 实机尚未验；本轮验证环境 Linux Chromium。
