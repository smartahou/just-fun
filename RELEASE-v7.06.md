# Just Fun v7.06 · PDF 选区几何模型边界

- 基线：v7.05 `index.js` SHA-256 `caaf56f99d587d5cd92e413db46678f4f464ee340163e2ec0f8a062d1eb95c4a`；从完整模块化源码 ZIP 原样解压离线构建 SHA 完全一致后才开始修改。
- 改动：新增 `src/client/scripts/98b-pdf-geometry.js`，冻结纯计算接口，供原 PDF 选区行定位、段落分组、条带裁剪、保存时坐标归一化调用。原函数名、页面 UI、JPEG、标记和笔记存储格式均保留。
- 测试：添加 1,158 项来自原 v7.05 几何算法的固定金标准样本，在无 DOM 沙盒逐项比对；整合进 v7.03 发布门禁。实际正式回归数量、结果、耗时以本轮 `dist/release-gate-v703/full-report.json` 为准。
- 安全：所有测试在隔离临时书库；不输入真实书库目录、不进行存储迁移。
- 后续：阶段 B 仍需处理预览投影与剩余共享作用域，阶段 C 的数据对象迁移与 Windows 实机验收尚未完成。

完整边界见 `PDF-GEOMETRY-BOUNDARY-v7.06.md`。
