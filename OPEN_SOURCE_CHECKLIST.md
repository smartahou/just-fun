# 正式公开前检查清单 / Public Release Checklist

**当前状态：不要直接将现有 Private 仓库改成 Public。** 此文件用于公开前准备，不表示已经发放开源许可。

- [ ] **提交历史的作者身份**：原有 Commit 包含个人邮箱元数据。后续在 GitHub 中设置邮箱私密不会自动隐藏历史。**推荐保留原私有仓库，将审查后的源码以全新、干净的初始 Commit 发布到独立公开仓库**；不强推或重写原私有 main。
- [ ] **重复审计源码及历史**：扫描 Git 对象、曾删除的文件、测试 fixtures、日志、实际路径、token、个人资料和仓库设置。扫描无法保证绝对无风险。
- [ ] **确定许可和版权**：由项目拥有者选择明确的开源许可证并提交 LICENSE；在此之前不能宣称已合法开源。许可授予后通常无法简单撤回。
- [ ] **澄清历史 AI 使用约定**：旧代码含“AI 使用约定”，应与正式源代码许可证协调，区分源码可以被阅读/修改的权利和用户私人媒体/笔记/密钥的隐私。
- [ ] **第三方授权**：确认 PDF.js Apache-2.0 许可义务、图标来源、历史测试材料；若发行 FFmpeg 或其他资源需额外检查。
- [ ] **安全复核**：本机监听、Origin/CSRF、秘密存储、潜在删除操作、依赖供应链及 Windows 实机情况。自动化通过不是独立安全审计。
- [ ] **协作与报告渠道**：检查公开 Issue/PR 模板不泄露私人信息，提供适合的私密安全漏洞反馈机制。
- [ ] **开发过程透明**：首页用中文为主、英文补充，明确人类负责产品决策和实机验收，ChatGPT 协助研发、测试和 GitHub 提交。

## 建议路线

**原私有仓库继续作为完整开发历史与恢复点；新建独立公开仓库，从清理后源码创建干净历史。** 在配置新仓库 Git 身份时使用 GitHub 的 noreply 邮箱，并在首次公开推送前重新审阅 Commit 作者信息。先确定 LICENSE，再作正式公开决定。

---

## English

**Do not simply change the existing private repository to Public.** Past commits contain a personal author email; changing current GitHub email privacy settings will not erase previous metadata. Prefer a new public repository created from an audited, sanitized source snapshot with clean history, while preserving the original private repository.

Before publication: select a legally clear LICENSE, reconcile historic AI-use notices, check third-party rights and security, inspect all Git objects and commit metadata, and clearly credit human-led, AI-assisted development. A public GitHub URL by itself is not an open-source license.
