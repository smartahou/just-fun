# v7.18 恢复检查点
- v7.17 基线正式 JS SHA 39c146c0693352b8b9fc6336be1ccbc9bb0625aa1413def89053f477653caa15。
- v7.18 修改 `40-library-cards.js` 和 `30-overrides.css`，构建 JS SHA 7db12c8d0daa765246c4e53d0aebaa69451552aecdf5a365d83ba28a3c9e6e1d，与首次完整门禁通过候选版本相同。
- 历次失败：首次 CSS 测试预算超限，已在最终 CSS 去除新增 important；中途临时工作容器重置，已恢复同 SHA 源码并将中间补丁检查点上传文件库。
- 必须对恢复后的完整测试目录重新执行全量回归，源码及用户包清洁离线构建一致后才能发布。
- 不冒充 Windows 真实 700 个视频的直接实机验收。
