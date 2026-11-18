# GOVERNANCE-CHECKPOINT v7.155

> 日期：2026-11-18 · 基线：v7.154 → v7.155
> 性质：缺陷修复——v7.154 的纸书透背（ghost）与印刷纹理在默认的旧纸照片模式下完全不可见，所有者实机截图反馈「没看出来变化」。

## 根因（复现出来的真实原因）

层叠顺序错误，不是"效果太弱"：

1. 旧纸照片 WebP 挂在 `.jfSheet::after` 上。v7.61 给 `.jfSheet` 设置了 `isolation:isolate`，照片伪元素 `z-index:0` 且不透明（`opacity:1`）。DOM 内同等 `z-index` 的元素按树序绘制，伪元素 `::after` 视为最后的孩子，因此它压住所有 `z-index:0` 的真实子元素。
2. v7.154 的 `.jfGhost` 恰好是 `z-index:0` 且被插为 `.jfSheet` 的第一个孩子 → ghost 永远绘制在不透明照片之下，双页展开下也看不见。
3. v7.154 想补救的 `.jfReader.paged.jf-aged-paper .jfPageView .jfSheet[data-paper-index]::after{z-index:-1}` 匹配不到任何元素——v7.48 起照片属性已改名为 `data-paper-group`/`data-paper-side`，这是一条死规则。
4. 噪点层 `.jfSheetBody::after` 虽然叠在文字之上（`z-index:2`、multiply 正常生效），但 `opacity:.075` 的细颗粒在 100% 缩放下几乎不可辨，叠加在照片纸自身纹理上等于消失。

浏览器内实测证据（修复前，默认旧纸照片双页展开）：
`getComputedStyle` 得到 ghost `z-index:0 / opacity:.05`、`.jfSheetBody` `z-index:2`、`.jfSheet::after` `z-index:0` 且 `background-image` 为不透明 WebP；临时把 ghost 提到 `z-index:1` 后镜像文字立即显现——证明层叠是唯一阻断点。

## 修复

1. `src/client/styles/42-paper-aging.css`
   - `.jfGhost`：`z-index` 0→1（照片 0 之上、正文 2 之下），`opacity` .05→.085，`blur` .5→.55px，注释写明层叠契约；
   - 删除死规则 `[data-paper-index]::after{z-index:-1}`，以注释记录来龙去脉；
   - 印刷噪点：层 `opacity` .075→.13，纤维贴图瓦片 260→300px、`baseFrequency` `0.012 0.62`→`0.012 0.42`（纤维更长更粗），rect 0.4→0.5，使纤维在正常缩放下可读。
2. 无 JS、无 DOM、无分页/几何变更；`99-reading.js` 的 ghost 注入逻辑不需要改动（DOM 本来正确，只是被压住）。
3. 新增 `tests/paper-aging-visibility-v7155.js` 并把其并入 `npm run test:reading-controls`（另设 `test:paper-aging`）：断言照片层 z-index 0 与 isolation 契约、ghost 必须为 1 且介于照片与正文之间、ghost/噪点不透明度阈值、`data-paper-index` 死选择器不得回归、样式链顺序。

## 实际执行的验证

- `node tests/paper-aging-visibility-v7155.js`：PASS。
- `node tests/aged-paper-default-v768.js`：PASS（16 张照片叶、配对与模式同步不受影响）。
- `py -3.12 tests/css-cascade-v704.py`：环境缺 `tinycss2`，未运行成功（本机既有问题，与本改动无关）。
- `py -3.12 tests/css-budget-v703.py`：失败——`!important` 总量超 3307 基线（41-reading.css 单文件 1356）。本改动未新增任何 `!important`（42 文件始终 3 个），属既有测试债。
- `node scripts/build.js`：PASS，`sourceSha256=98cf08e9d6c99c0c…`，`files=64`，`htmlBytes=19,354,057`。
- 杀掉 3865 旧监听进程（pid 21120），删除 `D:\藏\个人学习\.douyin-nav-cache\instance.lock`，以 `cmd /c "echo D:\藏\个人学习| node dist\douyin.js"` 重启。
- `Invoke-WebRequest http://127.0.0.1:3865/`：HTTP 200，返回 19,354,057 字节，与构建一致；返回内容含新规则。
- 浏览器实机（构建产物，非注入样式）：书房 → 打开《崩溃的帝国——明信片中的晚清》→ 纸书模式；双页展开（`innerWidth=1680`，`twoSheets=true`）下 `getComputedStyle`：ghost `z-index:1 / opacity:.085`、正文 `z-index:2`、照片 `z-index:0`；截图可见对页文字以镜像方式透在照片纸上。截图存于会话临时目录（page-2026-11-18T04-33-36-536Z.png）。
- A/B 对照截图：修复前同位置无任何透背痕迹；临时提升 ghost 不透明度后镜像文字出现，确认效果本身正确、仅层叠阻断。

## 未做的验证

- 插图 sepia/multiply 在含 OCR 扫描插图的 EPUB 上仍未经逐页截图核对；
- iPad 局域网观感未验收；
- 噪点提升到 .13 后在实机 100% 缩放下的观感（是否过重）待所有者实机确认。

## 影响面

`src/client/styles/42-paper-aging.css`（层叠与强度）、`tests/paper-aging-visibility-v7155.js`（新）、`package.json`（版本号、`test:reading-controls`/`test:paper-aging`）。无服务端变更，无数据结构变更，无分页/几何变更。
