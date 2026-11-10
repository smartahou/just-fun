# Just Fun · 协作约定

本文件是接手本项目的 AI 工程协作者的第一份必读材料。产品背景见 `README.md`，
架构沿革见 `ARCHITECTURE.md`，最新变更见 `GOVERNANCE-CHECKPOINT-v*.md`。

## 交付契约（所有者明确要求）

**每个任务节点完成后直接 push 到 GitHub，不需要再询问。一次迭代原则上一笔原子提交、一次推送，不要逐文件提交。**

1. 改真实模块化源码，不直接改 `dist/` 产物。
2. 先跑专项，再跑相关回归；新增行为必须有可执行的回归用例。
3. `node scripts/build.js` 必须通过，并记录 `sourceSha256`。
4. 写 `GOVERNANCE-CHECKPOINT-vX.XX.md`：真实根因、修复、**实际执行过的**验证、未做的验证、影响面。
5. 更新 `package.json` 版本号与 `README.md` 顶部的版本行。
6. 将源码、测试、版本与 checkpoint 一并暂存；先完成可运行的测试和构建，再一次性 `git commit` → `git push origin main` → `git ls-remote origin refs/heads/main` 回查远端 HEAD。通过 GitHub API 操作时使用 create_tree + create_commit + update_ref，禁止逐文件 update_file 造成重复 Push。
7. **禁止 force push。** 远端有新提交时先 fetch 并快进；冲突走分支，不覆盖历史。
8. 拿不出执行证据的事情不要写进报告：没有跑过的测试写"未运行"，不要写"应通过"。

变更记录习惯：一个版本原则上一笔提交；确实需要修复失败测试或处理并发冲突时才额外提交。主分支只由统一 CI 自动触发；历史专项 Actions 可手动 dispatch 复核，不能当作被删除的测试。

## 本机环境事实（踩过坑，别重踩)

| 事实 | 说明 |
| --- | --- |
| `py -3.12` | PATH 里的 `python` 是 3.7.6，会让 `release-gate-v703.py` 直接崩（`Path.unlink(missing_ok)` 需要 3.8+）。一律用 3.12。 |
| `PYTHONUTF8=1` | Windows 默认 GBK，测试里的 `read_text()` 会 `UnicodeDecodeError`。跑任何 Python 测试前先设置。 |
| `C:\usr\bin\chromium*` | 84 个测试硬编码 `executable_path='/usr/bin/chromium'`。当前用目录联接 + Chromium 副本假扮该路径；**这是环境补丁，不是代码修复**。 |
| Node | 24.19.0；构建的 `node --check` 步骤需要能创建子进程，受限沙箱下会 `EPERM`。 |
| 依赖 | `node_modules` 内已有 `pdfjs-dist@6.4.299`、`markdown-it`、`esbuild`。`package-lock.json` 已提交。 |

## 禁止事项

- 用真实用户媒体做任何破坏性测试；所有回归只用隔离临时目录与合成素材。
- 恢复已废除的 `AI_USAGE_NOTICE.txt` 自动生成机制。
- 未经审查升级 `pdfjs-dist`（版本与 `pdfjsModuleSha256` 是构建契约）。
- 无需求地把现有共享作用域模块整体改写成 ESM/TS，或更换前端框架。
- 把 `dist/`、`.justfun-runtime/`、`node_modules/` 提交进仓库。

## 已知的测试债

- `tests/notes-rich-markdown-v679.py` 与 `tests/reading-notes-v650.py` 是僵尸用例：二者都操作 `#jfDeskNoteBody`，
  而该元素自 v6.82「单一表面」改造起被 CSS 隐藏。它们失败不代表新代码有问题，也不能当作回归依据。
- 发布门禁 `--full` = `run-all.py` 的 `CASES` + `SMOKE`（起于 v6.82）；v6.49–v6.81 的一批专项不在任何一条里。
- 上述两项尚未修复，修之前不要声称"全量门禁通过"。
