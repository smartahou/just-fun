# 正式公开前检查清单 / Public Release Checklist

**当前状态：项目有权授权的源码采用 MIT。** 是否把 GitHub 仓库从 Private 改成 Public 仍由项目拥有者决定；此清单不是完整的独立安全审计。

- [x] **历史作者邮箱**：Commit 中含项目拥有者的个人 QQ 邮箱；已告知，项目拥有者表示接受公开。若将来改变主意，干净历史的新仓库比事后改写公开历史更可靠。
- [ ] **重复审计源码及历史**：扫描 Git 对象、曾删除的文件、测试 fixtures、日志、实际路径、token、个人资料和仓库设置。扫描无法保证绝对无风险。
- [x] **源码许可**：MIT，根目录 LICENSE。只覆盖项目有权授权的源码和资源，不赋予任何人对用户私人数据的权利。已授予的开源许可通常不能简单撤回。
- [x] **区分 AI 与私人数据**：现行源码将 MIT 源码许可与用户个人数据保护分开。tests/reference 中冻结的 v6.21 旧源码仅供历史回归，不是新的软件许可条款。
- [ ] **第三方授权**：PDF.js 为 Apache-2.0；Logo 来自项目拥有者曾提供的图片，但维护者仍应确认底图权利。公开预编译包需保留 PDF.js 许可/NOTICE；若附带 FFmpeg 需要独立评估其构建许可。
- [ ] **安全复核**：本机监听、Origin/CSRF、秘密存储、潜在删除操作、依赖供应链及 Windows 实机情况。自动化通过不是独立安全审计。
- [ ] **协作与报告渠道**：检查公开 Issue/PR 模板不泄露私人信息，提供适合的私密安全漏洞反馈机制。
- [ ] **开发过程透明**：首页用中文为主、英文补充，明确人类负责产品决策和实机验收，ChatGPT 协助研发、测试和 GitHub 提交。

## 建议公开路线

1. 项目拥有者确认 Logo 底图有分发权利，知悉 Git 提交里仍有自己的邮箱。
2. 由项目拥有者在 GitHub **Settings → General → Danger Zone → Change repository visibility** 将 Private 改成 Public。
3. 公开后复核仓库首页、MIT LICENSE、第三方说明、安全声明及是否存在意外提交的私人媒体。

不需要为了一个 Logo 引入 Element UI 全套框架。保留当前图标和原有构建链，按需局部引用经过许可审查的轻量 SVG 图标即可。
---

## English

The project-owned source now uses the MIT License; GitHub visibility remains an owner's separate decision. The owner has acknowledged exposure of personal Git author email metadata. Before making the repository public, verify logo rights and third-party license obligations; do not publish private media, credentials, notes, or cached data. Historical reference fixtures are not the current license terms.
