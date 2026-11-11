# Just Fun v7.123.0 · Trace 定向分页器性能治理

## 性能证据与根因

用户上传 Chrome Performance Trace: `Trace-20261112T000439.json.gz`，约 31.5 秒，212,654 条事件。根据 renderer main thread 的 devtools timeline 归因：
- `UpdateLayoutTree` 4,094 次，总 15,964.14ms。
- 其中 `columnHeight > paginate > jfDeskPagedLayout` 2,211 次、9,105.77ms。
- `measure > paginate > jfDeskPagedLayout` 1,300 次、5,301.43ms。
- 上述两条路径合计 14,407.2ms，约 90.25% 的 UpdateLayoutTree 时间；Paint 仅约 147.45ms。瓶颈不是纸面图片的最终绘制。
- 旧版本对每个文本块先单独克隆/测量 `measure()`，再为候选纸页从头克隆整列 `columnHeight()`，最后强制读取 `scrollHeight`。每章高频重复，造成主线程长任务和约一秒的渐进显字。

## 代码改造

1. `src/client/scripts/98d-page-engine.js`：
   - 候选纸页优先进行真实组合高度判断，**只有无法容纳时**调用单块 `measure()` 来处理大图、长段拆分等情况；
   - 每个独立测量宿主使用 `WeakMap` 缓存「原始节点引用列表 ↔ 测量克隆节点」；常规新段落仅 append 一棵克隆子树，不再清空并重复克隆整张纸上的历史子树；
   - 若其他函数更改了宿主结构，或几何/重排开始新会话，自动放弃缓存重建。完整页、DOM Range、行数限制、辑评结构语义仍按原真实高度计算，不采用逐块简单相加近似。
   - 暴露 `JFPageEngine.diagnostics()`：输入块数、单块测量次数、合成测量次数、克隆/复用节点数、物理页数、执行时间，仅供测试和性能排查。
2. `src/client/styles/41-reading.css`：仅隐藏的 `.jfPageMeasure` 增加 `contain:layout style`，减小测量时对可见 DOM 的样式计算波及；**不使用 size containment**，确保 `scrollHeight` 仍反映全部文字高度。
3. `tests/reader-paginator-measure-v7123.js`：60 个独立段落模拟真实页面追加，保证 6 页字符守恒、单块测量接近每页边界次数、原有页内克隆得到重用。
4. `tests/fixtures/page-engine-v7122-baseline.js`：冻结上一版分页器供测试比较，不在运行时加载、不改造用户 EPUB。
5. `tests/reader-paginator-measure-v7123.py`：真实 Chromium 在两种正文宽度，复用同一套 220 段混合标题和正文，与原版逐叶 compare 物理页数、拆分 key/offset/字符长度及全书文字守恒；报告浏览器测量耗时与引擎复用计数。测试结果不预设速度倍数，避免 CI 设备噪声导致假阳性。
6. 统一主 CI 中新增快速 Node 回归和 Chromium 逐叶对照，同时保留真实 36、52、110 章节快速往返和纸书表面双缓冲测试。

## 风险与验收声明

本轮根本目的是大幅削减分页测量所需的克隆/样式失效工作，不更换字体、封面、纸张 WebP、EPUB 原始字符、PDF.js 版本。**不应将单机 Chromium 基准时间直接当成用户设备的实时成绩。** 优化后仍有按段真实测量和可能由书页 DOM、前台章节预载引起的长任务，需在用户原 Trace 的复现动作中重新录制一次 Performance 才能量化实机改善。

统一 CI 须成功；原文、页码锚点及长距离前后翻页不允许以性能为代价破坏。
