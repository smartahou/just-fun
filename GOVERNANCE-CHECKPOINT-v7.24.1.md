# Just Fun v7.24.1 · MIT 开源准备与私人数据边界

日期：2026-10-28

## 范围
- 对现行项目有权授权的源码采用标准 MIT License，Copyright (c) 2026 smartahou。
- GitHub 仓库 Private/Public 可见性不在本次 Git 提交内修改，只有所有者自行切换。
- 现用 Logo 由项目所有者此前上传的图片转换生成 favicon.ico，暂无来自 Element UI 等第三方库的证据；未替换图标、未新增 UI 框架。
- 更新现行源代码头部和 AI_USAGE_NOTICE 文本：**源码授权以 LICENSE 为准；用户自己的媒体、笔记、索引、密码、API Key 不受 MIT 自动授权。**
- 保留历史 tests/reference/v6.21.douyin.js 为真实历史冻结夹具，其中旧文案不代表现行许可。
- 更正 README、CONTRIBUTING、第三方通知、开源检查清单和本地构建说明；package.json 版本 7.24.1，保留 private:true 防止误上架 npm。
- 新增纯只读 tests/open-source-contract-v7241.py，正式门禁清单加入专项。

## 本轮已实际执行
- 从 v7.22 全量离线归档验证现行涉及的两份 server 源码与 v7.24.0 GitHub HEAD Git blob SHA 一致（其它业务源码未改动）。
- 自主修改的这两份模块在隔离离线构建中通过 Node 语法检查、pdfjs-dist 6.4.299 的 203 个资源校验、node --check dist/douyin.js、只读 --doctor；验证通过。
- 源码许可与私人数据界限专项 8/8 PASS。
- tests/security.py：两种密码/Hash 隔离模式结果符合预期。
- tests/startup-port-unicode.py：24/24 PASS。
- tests/metadata-vault-v648.py：20/20 PASS。
- 不宣称完成 v7.24.1 全部 66 项门禁（本轮未执行 GitHub HEAD v7.24 的完整浏览器/Feed 回归）。
- 构建验收发生在真实 v7.22 离线归档 + 经 Git SHA 比对一致的生产模块之上，不把它冒充最终 v7.24.1 完整构建哈希。
- 运行时仅会按既有机制同步私人媒体库下 AI_USAGE_NOTICE.txt 的文案，不搬迁、删除或重命名任何媒体与笔记。

## 公开条件
维护者已明确接受 Git Commit 历史里公开自己的 QQ 邮箱。决定切换 Public 前，仍需自行确认 Logo 原图有分发授权，并评估第三方 PDF.js 预编译分发许可。项目源码许可并不覆盖用户数据。
