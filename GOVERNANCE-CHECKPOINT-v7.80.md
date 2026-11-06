# Just Fun v7.80.0 · EPUB「目」「笺」纸签 · 保守首版

日期：2026-11-06

## 任务范围

按用户上传的《EPUB目录与笺注A-实施Prompt》实现：

1. EPUB3 NAV / EPUB2 NCX 目录解析，提供标题、层级、原文档路径、fragment 与不变的 spine 章节索引。
2. 仅在沉浸旧书纸页模式中跳过 manifest 明确标记的导航 XHTML。普通 EPUB 流式模式保留源文档，不凭「目录」一词删除正文。
3. 独立于测量书页的「目」纸签目录抽屉，条目跳转并按源 id 锚点定位；Esc、外部点击收起。
4. 显式 `epub:type=noteref` 或 `role=doc-noteref` 与真实标注 `footnote/endnote` 目标双重匹配时，仅为旧书模式生成去除引用编号及同文件注释块的渲染投影；源 EPUB 不变，流式 EPUB 不使用投影。
5. 当前双页的实际零尺寸锚点决定「笺」纸签可见性。抽笺仅显示对应注释、来源词句；同章节重复引用同一注释去重。点击条目使用真实锚点之前的文本 Range 生成短时淡赭色高亮，原书正文 DOM 不修改。
6. 两纸签互斥，切书、切模式及翻页进行清理；没有可靠注释时保留原文，不删数字、评析、辑评。

## 变更文件

- `src/server/46-reading-and-notes.js`：TOC 元数据、保守显式注释关联、纸书模式单独正文投影
- `src/client/scripts/98f-epub-paper-tabs.js`：纸签、目录与笺注的客户端逻辑
- `src/client/scripts/99-reading.js`：纸书投影加载、页内真实注释锚点、清理及恢复联动
- `src/client/styles/41-reading.css`：朴素旧纸目录与笺注层、不参与排版的瞬时高亮
- `build.manifest.json`：在阅读器脚本前加载纸签模块
- `tests/epub-paper-slips-v780.js`：合成 NAV、NCX、无导航、跨文件脚注、同文件嵌套脚注、重复引用、未关联编号测试
- `tests/epub-paper-slips-ui-v780.js`：模拟 DOM 测试目录/笺注抽签、两侧注释、无注释、重复引用、互斥与 Escape
- `package.json`、`package-lock.json`、`README.md`：版本与测试命令

## 实际验证（不要夸大）

- 已直接从 GitHub main 读取并修改模块化源码，无 dist 产物直改。
- V8 语法解析：服务端 EPUB 模块、阅读器脚本和纸签控制器三份 JS 均通过。
- 合成 EPUB 函数体测试：在 V8 中使用模拟 Node/ZIP 依赖执行真实解析函数，涵盖两级 EPUB3 NAV、两级 EPUB2 NCX、无目录正文、跨 XHTML 脚注、同文嵌套脚注、未匹配数字与相同注释重复引用，结果 PASS。
- 孤立模拟 DOM 的纸签控制器测试：V8 环境中执行实际模块，通过目录、双页笺注、重复引用去重、互斥、Esc、切换非 EPUB 这几种状态（模拟 DOM，不是 Chromium）。
- 新增 `tests/epub-paper-slips-ui-v780.js`，并纳入 `npm run test:epub-paper`。
- **未运行** `npm run test:epub-paper` 在完整 Node 仓库下的执行、`node scripts/build.js`、完整回归门禁、真实 Chromium UI 与 Windows 实机检查。本会话无法克隆仓库到容器并安装所需全套依赖。因此这是一份代码完成、**尚未经过最终集成验收**的交付。

## GitHub Actions 完整 Node 构建验证（追加）

- CI：[`EPUB paper slips regression` #42146067445](https://github.com/smartahou/just-fun/actions/runs/42146067445)
- Commit：`6f5e56493d1ab07682f34bd602b53886b1bb7fba`
- 运行环境：GitHub Actions Ubuntu + Node 24；`npm ci` PASS。
- `npm run test:epub-paper` PASS（真实 Node 环境中的 EPUB3 NAV/EPUB2 NCX、跨文件/同文件脚注、无目录、UI 模拟 DOM 测试）。
- `npm run test:reading-print` PASS（v7.73 至 v7.78 共六项阅读/分页回归）。为解决升级版本导致的假失败，已修复 `tests/paged-composition-v778.js` 原来写死 `7.78.0` 的断言，使其表示 v7.78 起适用。
- `node scripts/build.js` PASS；`node --check dist/douyin.js` PASS。
- 正式构建 `sourceSha256`：`ae81241b83fa69ffb290db4dfb904910ed8d3f063a6893ff10a89f51963daf1c`。
- **尚未执行**：带真实 EPUB 文件的 Chromium 可视化验收、Windows 实机交互/截图、完整全项目发布门禁、v7.79 16 组纸纹资产的整合；不能把这些记为通过。

## 明确不支持及保守降级

- 纯文本人工「目录」页不能依据标题直接删除，未实施高风险的启发式过滤。
- 没有显式 noteref / footnote 语义的 EPUB2 数字注释仍保持原样，以避免误删。
- 某些复杂嵌套的 XHTML、未声明目标、脚注正文单独列在 spine 的注释章节、跨大篇幅碎片/特殊内联标签的精准高亮，尚未做真书验证。
- 目录抽屉目前呈现层级缩进，不具备分级折叠按钮。
- 浏览器屏幕阅读器与窄屏真实可用性需要人工验收。
- 不应把此版称为用户最终验收通过。

## 本机验证命令

```bash
npm ci
npm run test:epub-paper
npm run test:reading-print
node scripts/build.js
node dist/douyin.js --doctor
```

请使用隔离样本 EPUB 进一步验证多页翻页及旧纸纹理；不得对真实个人媒体作破坏性测试。
