# Just Fun v7.12 — Workspace v2 事务设计契约及预检边界

## 范围与实施状态

**已实施**：原 Workspace v1 的只读迁移预检、唯一 JPEG 对象清单、SHA 归档路径、容量/去重预算，以及独立临时目录内的明文/密码库恢复演习。新增只读 `GET /api/reading/migration-preflight`，沿用原阅读 API 的 Origin 检查。外部结果只包含数量/字节数、匿名阻断码和未验项，不返回图片内容、SHA、文件路径或笔记正文。

**未实施、仍锁定**：Workspace v2 写入与读取、图片对象物理存储、用户数据迁移、HTTP opt-in 写入口、生产回滚、Windows 断电一致性保证。`migrationEnabled:false` 固定；本阶段绝不修改 `workspace.json` 或其备份。

## 数据契约

| 属性 | v1（现行） | v2（设计阶段） |
|---|---|---|
| 结构 | `version:1`，revision，notes/quotes/progress/marks | `version:2`，保留原有非图引用 |
| JPEG 图片 | `data:image/jpeg;base64,...` | 仅在存储层替换成 `imageRef:sha256(jpegBytes)` |
| 跨页 | `quote.pages[i].image`，第一页和根摘录可重复 | 每页独立 ref，顺序和起始页语义不变 |
| 对象位置 | 内嵌 workspace | `reading/objects/<sha[0:2]>/<sha>.jpg`（相对 reading 根） |
| API GET | 原图 data URI | **必须**恢复相同 data URI；没有完成双读验证前不能启用 v2 |
| 密码库 | 主 / backup 各自路径 AES-GCM AAD | 对象将按自身完整路径独立 AES-GCM + SHA 验真 |

对象路径只能由内容 SHA 推导，不允许接纳外部传入路径。预检清单仅存在于内存中，不生成对象文件。数值 `estimatedEncryptedObjectBytes` 是容量预估，不是可用磁盘空间保证；它不包含目录元数据、临时副本和系统保留量。

## 事务状态机（供 v7.13 实装）

1. `V1_AUTHENTICATED`：主数据、独立 backup 路径认证，固定原版本和数据 SHA。
2. `OBJECTS_STAGED`：临时对象落盘与认证；不能提前修改主 workspace；断点可留下孤儿对象。
3. `OBJECTS_VERIFIED`：逐一对照 SHA 与对象内容，构造新 v2 workspace。
4. `SNAPSHOT_PREPARED`：在独立路径创建 *使用该路径 AAD 重新加密* 的 v1 恢复副本，完整认证；不得用原主密文复制充当 backup，也不得把 backup 密文直接重命名成主文件。
5. `INDEX_COMMITTED`：原子更新主 workspace 后验证新版本、对象引用完整性与 API 输出。此步骤不是单个 rename 能实现的跨文件系统多对象事务。
6. `ROLLBACK_VERIFIED`：发生错误时，从有效快照读取明文字节，针对目标主路径重新加密和写入，认证并恢复原 v1 内容。失败时不删除对象或用户数据，应保留证据并进入人工恢复状态。

**中断规则**：尚未实装运行时事务日志与崩溃后重放，因此当前不能声称真正具备跨进程/断电自动回滚。v7.12 演习仅验证：两个路径的 AAD 相互排斥、写前失败保持原主、写后可用认证的快照恢复、不将用户原图写入不安全位置。

## 测试与阻断

- 密码/非密码：模拟 `before_snapshot`、`after_snapshot`、`before_commit`、`after_commit` 共八个故障点，全部使用 `os.tmpdir()` 隔离目录，测试后删除。
- 输入纯逻辑测试：多页重复图、SHA 去重、数据不可变、非法图片/结构拒绝，不能泄露对象 SHA。
- 真实运行时不可变规则：预检只能通过 GET 调用，返回 `migrationEnabled:false`，不能提供 v2 写入 API。
- Windows 真实 DPAPI、磁盘空间不足与突然断电、完整 HTML/MD v2 双读等均**未通过验收**，必须在新版本中补做。

## 接下来的验收

v7.13 先增兼容双读、不可变对象落盘及可靠回滚 *隔离实验*，经过完整故障注入后再考虑显式 opt-in；不能暗中升级既有私人书房。
