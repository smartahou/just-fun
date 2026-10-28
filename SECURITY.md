# 安全与隐私 / Security & Privacy

Just Fun 是**本地单用户工作台**，不是经过互联网安全加固的云服务。HTTP 服务默认绑定 127.0.0.1；请勿通过公网 IP、反向代理或端口映射直接暴露。Hash、密码和元数据保护不等于全部原始媒体加密，也不能代替设备和系统备份。

## 保护真实数据

- 不得提交用户的媒体、书籍、笔记、缓存索引、Workspace 状态、实际目录路径、账号、密码或 API Key。
- 不在真实私人媒体库运行自动化删除、数据迁移或故障注入；所有回归使用临时合成样本。
- 公开 Issue、日志和截图前应清除用户名、路径、媒体文件名与凭据。
- Git 提交的作者邮箱属于 Git 历史元数据；公开前必须检查**全部提交历史**。
- AI 转写等可选网络功能可能向用户配置的第三方服务传送数据；使用前请自行确认服务条款和数据流向。

## 漏洞报告

请优先使用 GitHub 私密漏洞报告机制（如果已启用）。若没有可用的私密渠道，先向维护者询问，不要直接通过公开 Issue 发布可利用的漏洞细节或真实用户资料。

自动化测试、--doctor、静态源码审阅均不是完整渗透测试或供应链审计。风险较高的媒体文件操作、密钥和持久化迁移需要独立复核。

---

## English

Just Fun is a **local, single-user workspace**, not an Internet-hardened service. It binds the HTTP listener to 127.0.0.1 by default. Do not expose it through public networking or a reverse proxy. Password and metadata protections do not encrypt every original media file.

Never upload private media, notes, caches, Workspace data, real paths, credentials, or API keys. Automated tests must use disposable synthetic media. Redact logs and screenshots, and inspect **all Git history**, including commit author email metadata, before making a repository public. Optional cloud-assisted AI features may transmit user-selected data to the configured provider.

Report suspected vulnerabilities privately where possible. Regression tests do not constitute a comprehensive security certification.
