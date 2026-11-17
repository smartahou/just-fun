# GOVERNANCE-CHECKPOINT v7.152.1

> 日期：2026-11-18 · 基线：v7.152.0（`c45ca8d`）→ v7.152.1
> 说明：v7.143–v7.152 期间未单独写 checkpoint（治理断档）。这些版本的行为细节已记录在 `README.md` 顶部版本史与各自提交信息中；本文件起恢复"一版本一 checkpoint"纪律，并记录本版变更。

## 本版变更

### 1. API 写请求统一跨站守卫（src/server/60-http-router.js）

- **根因**：此前只有阅读（`/api/reading/*`、`/api/books/*`、`/api/jf-pdf/*`）与 ASR（`/api/ai-transcript/*`）链路调用来源校验；`/api/media-delete-batch`、`/api/media-move`、`/api/media-rename`、`/api/folder-*`、`/api/delete-images`、`/api/video-transcode`、`/api/clips*`、`/api/screenshot`、`/api/ai-learning/*` 等写接口只调用 `parseBody()`。`parseBody` 不校验来源；恶意网页可用 `enctype=text/plain` 的无预检表单 POST 直接构造 JSON 载荷触达本机接口（远程地址与 Host 均通过 `jfLanRequestAllowed`）。
- **修复**：在路由入口对**所有** `/api/` 非 GET/HEAD 请求统一执行：`jfAsrCheckOrigin`（Origin 若存在，必须为本机回环或已启用局域网接口、协议 http、Host 完全一致）+ `Sec-Fetch-Site` 存在时不得为 cross-site，否则 403。不限制 Content-Type（multipart 上传不受影响）；无 Origin/Sec-Fetch 的本机工具不受影响。`jfAsrCheckOrigin` 补充 `localhost` 为主机白名单（Host 精确匹配，无重绑定风险）。
- **影响面**：全部 API 写路径（含未来新增路径）；阅读/ASR 原有更严格校验保持不变（双重校验幂等）。

### 2. 同一媒体库单写者锁（src/server/10-security-and-settings.js、70-watch-and-lifecycle.js）

- **根因**：端口占用时监听器自动退让到空闲端口（`00-bootstrap.js:150`），且全仓无实例互斥；两个实例可同时读-改-写同一 `data.json`。
- **修复**：启动时（认证之前、任何缓存写入之前）在 `<库>/.douyin-nav-cache/instance.lock` 以 `open('wx')` 原子创建锁，内容 `{pid,host,startedAt}`；已存在时按序判定：同主机 PID 存活（`process.kill(pid,0)`，EPERM 视为存活）→ 拒绝；异主机且 startedAt 在 12 小时内 → 拒绝（防 SMB 共享双机写）；内容为空且 mtime <2s → 视为"正在启动"拒绝；其余（含损坏 JSON）视为陈旧 → 原子 `rename` 旁置后重试创建（避免竞争双方复用同一死锁）→ 失败 5 次则拒绝并提示锁路径。正常退出（`exit`/SIGINT/SIGTERM/shutdown）时若锁仍属于本进程则删除。
- **已知边界**：Windows 下 `TerminateProcess`（任务管理器结束/`terminate()`）不触发任何处理器，锁会残留，由下一次启动的存活检查接管；PID 复用存在理论误判，提示信息给出锁路径供人工处理。异主机锁只按时间老化，不做远程 PID 验证。

### 3. 构建注释与真实行为对齐（scripts/build.js）

`hls.js` 缺失且 `.jf-build-deps` 无缓存时，构建会执行一次网络 npm install（不影响 worktree 的 node_modules）。原头注释"no npm install or network"已改为明确描述该例外。

### 4. 交接文档与治理恢复

- 新增根目录 `PENDING-ACCEPTANCE.md`：只登记需要所有者实机确认的关键体验，完成后删除条目。
- `tests/README.md` 增加本版测试说明；`tests/run-all.py` CASES 加入新测试。

## 实际执行过的验证（本机 Windows，2026-11-18）

- `node scripts/build.js`：PASS，`sourceSha256=c93a21f4…`，62 文件。
- `py -3.12 tests/write-origin-and-instance-lock-v7152.py`（`PYTHONUTF8=1`）：PASS——跨站 text/plain POST 被 403 且文件未删；伪造同 Host + `Sec-Fetch-Site: cross-site` 被 403；同源写入 200；二实例被拒（输出含"另一个…实例"）；Windows 硬杀遗留锁被接管且新锁 PID 正确；损坏锁（mtime 老化后）被接管。
- `py -3.12 tests/security.py`：PASS 2/2（password-only 文件不变、hash+pwd 三错清空行为不变；`instance.lock` 不属于用户数据，不计入文件对比）。
- `py -3.12 tests/isolated.py`：PASS 20/20（构建、扫描对照、Range、四种模式、单文件脱离启动等）。

## 未做的验证

- 浏览器实机跨站复现（Chrome/Edge/Firefox 真实页面 + 真实攻击页面）；
- iPad mini 局域网模式下正常写操作（Origin 为局域网地址）的实机点击验收；
- 任务管理器结束进程后再次启动的 UI 文案实机确认；
- 未运行其他 Chromium 视觉套件（本次改动不涉及阅读/纸面渲染，但也未跑）。

## 回滚

单文件产物可用 `回退.cmd`；源码层面回退 60-http-router.js、10-security-and-settings.js、70-watch-and-lifecycle.js、50-ai-transcription.js 四处即可，无数据格式变化（锁文件是纯运行时状态）。
