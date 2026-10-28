# Just Fun v7.23.2 — Windows Git CRLF 清洁构建兼容

日期：2026-10-28
父版 GitHub main: a1c9a08bd812941c993fda36890df9245b66465c

## 原因与修复
- Windows Git 配置可能把 `src/client/index.html` 等文本输入检出为 CRLF。
- 原构建器精确匹配 LF 版 `<style>\n<!-- JUSTFUN_CSS -->\n</style>`，因此错误报 `Missing/duplicate build marker`。
- `scripts/build.js` 在读取构建所需的文本源码时统一 `CRLF → LF`，不改变仓库内其他内容，不转换 PDF.js、ICO 或其他二进制资源。
- 新增 `.gitattributes` 固定应用、构建、测试文本的 Git 检出行尾；已有 CRLF 工作区无需清理或重克隆。
- 新增 `tests/windows-crlf-build-v7232.py`，并列入正式门禁；版本升至 7.23.2。

## 本次已完成的验证
- Linux Node 22.16.0 + 锁定 pdfjs-dist 6.4.299 的完整离线构建：PASS。
- Windows CRLF 全源码模拟、混合 LF/CRLF、真实占位符损坏/重复拒绝、恢复：11/11 PASS。
- v7.22 全量业务回归：61/61 PASS，`--verify` PASS；累计 266.778 秒；隔离合成媒体库。
- v7.23.1 的另外两个部署专项在上一轮已通过，本次未在现有 Linux 归档上复跑，不宣称新远程 64/64 实测。
- 新版及原 LF 构建均得到相同业务 JS SHA-256：`9507b1cad3d386aae49d0d7063997787a5588b678d327a61988d420f9bb5cc1a`。
- `node --check scripts/build.js` PASS，正式 JS 旧版已通过诊断。

## 用户侧升级
原有 `更新.cmd` 已能成功 `npm.cmd`，但候选版本构建被 CRLF 阻断。补丁发布到 main 后，直接再次双击原 `更新.cmd` 即可；其自动 fetch 的候选 `scripts/build.js` 会采用新修复，无须事先运行 git pull 或重新克隆。

## 保留边界
未修改媒体/播放器/书房/笔记/Workspace、安全逻辑或用户媒体数据；无强推。Windows 本机实际构建成功需用户再次验证。
