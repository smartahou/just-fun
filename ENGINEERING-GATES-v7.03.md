# Just Fun v7.03 · 工程治理与发布门禁

## 范围

这是 v7.02 审计后的**第一阶段（确定性与证据闭环）**整改，不是重构应用架构。唯一开发源仍然是完整模块化源码，用户发布物仍为单文件 `index.js` ZIP。

### 本轮实现

1. `node index.js --doctor`：不读取用户媒体目录、不要求密码、不创建媒体缓存、不启动 HTTP 服务；只检查宿主 Node 平台、FFmpeg/FFprobe 与内置 PDF.js 资源。普通启动不变。
2. `tests/release-gate-v703.py`：将既有 30 套历史测试与 9 组受影响专项作为**两个显式维度**运行。每套独立进程组、独立日志、硬超时、清理进程组、每套原子落盘进度，可在 SHA 与测试脚本指纹完全一致时 `--resume`。缺少套件、运行失败、超时、SHA 变化、脚本变更均不得标为通过。`--verify` 是发布前必须通过的强制门禁。
3. `tests/visual-contract-v703.py`：在隔离书库、真实 Chromium 下对 1440px/390px 笔记界面生成静态视觉证据，并检查布局边界、笔记可编辑区、浏览器异常；不生成或使用真实媒体数据。截图归档 `dist/release-gate-v703/visual/`。
4. `scripts/css-audit-v703.py`：把 v7.02 的 3,487 处 `!important` 设为不增长预算。**这只是开始控制债务，不代表 3,487 处已清除**。以后局部移除旧覆盖必须通过 Chromium 视觉回归后再下调预算。
5. `tests/release-gate-v703.py --self-test`：模拟 PASS、FAIL、TIMEOUT、衍生子进程回收、报告原子写和报告缺项，保证门禁**失败时严格失败**。

### 操作方法（开发机）

```bash
node index.js --doctor
python tests/release-gate-v703.py --doctor
python tests/release-gate-v703.py --self-test
python tests/release-gate-v703.py --smoke
python tests/release-gate-v703.py --full --timeout 75
python tests/release-gate-v703.py --verify
```

如果某套超时或环境短暂异常，保留当前报告并用 `--full --resume` 续跑。续跑只接受完全相同 `index.js` SHA、测试源指纹和测试运行环境指纹。`--verify` 永远从报告逐条比对，拒绝仅凭人类说“已经跑过”发布。

### 版本验收标准

- **稳定版**：30 个历史套件和 9 个现行专项（v7.04）全部通过、同一个构建 SHA 和脚本/环境指纹；源 ZIP 解压后重新构建 SHA 一致；用户 ZIP 内仅一个 `index.js` 且 CRC 通过；独立启动；文件库上传后二次列表核验。
- **候选版**：任何必要测试未完成/失败，或无法取得完整同 SHA 证据。不可将 v6.99 或其他版的旧报告借来充数。
- Windows 的路径、PowerShell/DPAPI、移动硬盘验证与 Chromium 检测是两种证据，只有做过才可宣称 Windows 实机通过。

### 后续阶段（本轮未动）

- **笔记图片对象外置**：先写 immutable SHA 对象设计、旧内嵌图双读、备份与回滚测试，再开始真实数据格式迁移；本轮**未修改**用户现有 Workspace、笔记协议或图片数据。
- **CSS 减债**：当前只建预算/视觉基线，后续按阅读器、笔记、播放器的单一责任域逐步删除冗余规则。不允许用新增覆盖补丁伪装治理成功。
- **共享作用域拆分**：在有测试门禁和视觉保护后分批封装业务模块，不更换框架或交付模式。

## 安全界限

所有 CI 回归仍使用 `jf-architecture-test-` 前缀隔离库；绝不能把用户的真实媒体目录交给自动化测试。`--doctor` 默认无用户目录参数，不检查真实书库的文件。所有本轮操作均不改变 `--hash --pwd` 的既有清空规则。
