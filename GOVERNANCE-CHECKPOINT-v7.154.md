# GOVERNANCE-CHECKPOINT v7.154

> 日期：2026-11-18 · 基线：v7.153.7（`4c7e252`）→ v7.154
> 性质：纸书质感触觉增强（所有者指定）：多层纸浆纤维噪声、边缘泛黄磨损、页顶光照、透背 ghost 与插图印入纸面。

## 根因 / 意图

v7.147–v7.153 的纸书模式表面仍是「一张旧纸照片 + 极弱纤维 + 若干线性渐变」：缺少上机施压后的印刷感（噪点从未盖过文字），没有对页透印，插图在旧纸上像贴上去的白卡。所有者要求把纸书做成可触摸的旧书：纤维各向异性、低频纸浆斑、边缘泛黄磨损、顶部光照、透背镜像，以及插图 sepia + multiply 印进纸里。

## 修复

1. **重写 `src/client/styles/42-paper-aging.css`**（新样式文件已加入 `build.manifest.json` 样式链，排在 41-reading.css 之后）：
   - 纸面底层：512px SVG feTurbulence 低频纸浆斑（`baseFrequency=0.011`，multiply）+ 两处按叶种子定位的 foxing 斑 + 四角磨损 + 四边泛黄 vignette + 页顶灯光 radial 渐变 + 页脚积尘渐变；
   - 印刷噪点层：`.jfSheetBody::after` 提到 `z-index:2`、`mix-blend-mode:multiply`，由各向异性纤维贴图（`baseFrequency=0.012 0.62`，横向长纤维）与细颗粒贴图（`0.86`）双层叠加，位置按叶偏移（`--jf-tex-x/y`）防止跨页镜像；
   - 叶片轮廓：两侧 `box-shadow` 顶亮、底沉、暖色描边、书脊折痕投影；
   - `prefers`/布局几何完全不变，仅装饰层。
2. **`99-reading.js` ageLeaf 旁注入 `.jfGhost`**：每页取对页 `innerText`，`scaleX(-1)`、`opacity .05`、`blur .5px` 的透背镜像；单页模式自动隐藏；`aria-hidden`、不参与交互与分页测量。
3. **paged 模式图片**：`filter: sepia(.14) contrast(.94)` + `mix-blend-mode: multiply`（`.jfInlineGlyph` 生僻字与已 key 出 alpha 的 `[data-jf-plate='done']` 只取色调、不重复 multiply，避免黑版二次压暗；漫画叶保持原有 normal 混合）。CSS 同步在 42 文件中。

## 实际执行的验证

- `node scripts/build.js`：PASS，`sourceSha256=f1431b4f99fca4db…`，`files=64`，产物 `htmlBytes=19,353,626`。
- 杀掉 3865 端口旧监听进程（pid 32704），删除 `D:\藏\个人学习\.douyin-nav-cache\instance.lock`，以 `cmd /c "echo D:\藏\个人学习| node dist\douyin.js"` 重启。
- `Invoke-WebRequest http://127.0.0.1:3865/`：HTTP 200，返回字节数 19,353,626，与本次构建一致（确认服务加载的是新产物）。
- 浏览器实机：书房 → 打开 JUSTFUN 开发计划（Markdown）→ 开启「纸书翻页模式」，单页纸书正常渲染：泛黄磨损边缘、顶部光照、纸浆斑与纤维噪点可见，文字几何未变。截图核对通过。
- 截图存于会话临时目录（page-2026-11-18T03-48-33-732Z.png 等）。

## 未做的验证

- 对页 ghost 的肉眼验收：当前浏览器视口为单页模式（`twoPages=false`，ghost 自动隐藏），双页展开下的镜像透背与透明度未经截图核对；
- 插图 sepia/multiply 在含 OCR 扫描插图的 EPUB 上未逐页截图（本会话仅以 Markdown 书冒烟）；
- iPad 局域网与旧纸照片模式下的叠加观感未验收。

## 影响面

`src/client/styles/42-paper-aging.css`（新）、`build.manifest.json`（样式链）、`src/client/scripts/99-reading.js`（ghost 注入）。无服务端变更，无数据结构变更，无分页/几何变更。
