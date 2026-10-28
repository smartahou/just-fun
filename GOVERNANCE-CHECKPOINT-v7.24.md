# Just Fun v7.24 · 媒体工作台页面快捷键

- 日期：2026-10-28
- 来源：GitHub main 9cb5c4c6ee6b55124259b3f0e2b46aa6c9a63ad5，旧版 src/client/scripts/80-library-actions.js Blob `3af99d0b300bb586eaf7eb4b2f275249c95303f5`。
- 业务范围：只增加 Alt+1（视频）、Alt+2（图库）、Alt+3（音频）、Alt+4（书房）、Alt+5（笔记）五个页面导航快捷键。
- 实现：复用现有导航按钮 click 处理器与 v7.22 分页现场保存/恢复，不新增独立状态机或数据持久化；重复按当前页快捷键不重建页面；按钮 title/aria-keyshortcuts 提供提示。
- 安全边界：文本输入及 contenteditable、IME 合成、自动重复、AltGraph、Ctrl/Meta/Shift 组合、视频沉浸 Feed、原生全屏、图片查看/裁剪、标注/重命名/移动弹窗、阅读器开启时不劫持按键。无视频文件、音频文件、用户元数据迁移。
- 新增：tests/media-tab-shortcuts-v724.py，1440×900 和 390×844 两种真实 Chromium 视口，合计 44/44 断言 PASS，包含五页切换、720 条视频虚拟列表滚动恢复、音频搜索状态恢复、重复切换、禁止劫持及隔离媒体哈希不变。
- 原有业务全套 + 新专项：在锁定 pdfjs-dist 6.4.299 的完整离线工程验证 62/62 PASS，python tests/release-gate-v703.py --verify PASS；门禁自检 6/6 PASS。该 Linux 离线工程取自 v7.22 完整备份，业务文件对应 GitHub 迁移基线（v7.23.x 未修改业务源代码），本轮已核对目标源文件的 Git Blob。
- Windows CRLF 构建专项另跑：11/11 PASS。
- 全量业务测试累计：见本地 dist/release-gate-v703/full-report.json。
- JS 离线清洁重建 SHA-256：`15f6d6d2f959afedbbbd559130df385a307c0f91e600109025fa17ef90dce9e4`，字节数 11900973，独立构建逐字节一致，Node --check/只读 --doctor PASS，PDF.js 203 资源。
- 限制：v7.23.x 新增的 npm/部署专项在先前版本已验收，但这次没有作为一份新的 65/65 远程全套重新执行；不得把 62/62 误写成 v7.24 完整 65/65。Windows 实机 Alt 键交互尚待用户确认。
- 交付：GitHub 直接提交模块化源码；用户运行 更新.cmd 更新，启动.cmd 使用。不发替换 ZIP。
