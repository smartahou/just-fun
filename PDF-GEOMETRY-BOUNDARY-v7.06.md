# Just Fun v7.06 · PDF 几何坐标模型边界

> 范围：阶段 B，纯逻辑抽离，保持 v7.05 行为不变。没有修改保存格式，不运行数据迁移。

## 本轮模块边界

- 新建 `src/client/scripts/98b-pdf-geometry.js`，独立并冻结 `jfPdfGeometry` API；不读取 DOM、浏览器状态、PDF.js canvas 或网络。
- `closestRow(rows, y)`：以 CSS px 选择最近行（含空集行为）。
- `paragraphGroups(rows, first, last, area)`：按行间距、段首缩进分组，保留原规则。
- `stripPadding(row)`：算出行周围留白。
- `segments(choice)`：根据页内选区与行边界生成多个裁剪条带，继承原边缘裁剪及 40 行上限。
- `normalized(choice, width, height)`：将页内 **CSS 像素坐标**归一化为 [0,1] 范围的原有 `area` 与 `segments` 数组。
- `99a-pdfjs.js` 内保留五个原函数名；只有 DOM 侧 `jfPdfCaptureNormalized(choice,record)` 读取实际页宽高并委托纯逻辑模型。

## 保持不变的行为与协议

1. 截图手势、逐行调整 handle、像素采样、RGB 与 JPEG 绘制继续在 PDF.js UI 层执行；几何模块只计算坐标，不访问文件和 DOM。
2. 每页的 `area`/`segments` 仍是四个单位化浮点数 `[x,y,w,h]`；跨页标记是 **多个页级区域** 的组合，不会误把第 1 页底部和第 2 页顶部换算进同一个大坐标系。
3. 图片摘录、彩色区域标记、跨页合并、笔记导出、旧 workspace 持久化 schema 不变。
4. 本轮维持原有浮点运算、边界裁剪及容差；没有借重构名义更改段落识别或优化裁剪算法。

## 可重复验证

- `tests/fixtures/pdf-geometry-v705-golden.json`：v7.05 真实源码生成的 1,158 项冻结金标准；固定 SHA，涵盖异常 40 行边界、零行、边距和大小不一的页。
- `tests/pdf-geometry-facade-v706.js`：无 DOM 沙盒逐项对比，检查纯接口冻结、输入不被修改及旧函数声明仍存在。
- `tests/pdf-geometry-facade-v706.py`：通过 `tests/release-gate-v703.py --full` 纳入发布门禁。
- 真实浏览器测试覆盖原生 PDF 选择、标记、翻页、跨页组合摘录、截图、笔记保存及缩放等。

## 未完成

- PDF 预览矢量渲染和像素采样仍在较大的 `99a-pdfjs.js` 中；未来应在 UI 真实回归覆盖下进一步整理。
- 暂未统一 PDF 缩放锚点与标记预览变换为一个所有场景共用的投影 API；本轮只负责已验证的 **页内截图选择** 坐标。
- Windows 真机兼容与阶段 C 数据对象迁移尚未完成。
