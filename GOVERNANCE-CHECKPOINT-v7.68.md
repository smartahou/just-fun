# Just Fun v7.68 · 旧书 WebP 纹理可见性恢复

## 源码基线
- GitHub main `0d527930a6760fbd24c4a81d44f477922c2881c1`（v7.67.0），直接增量修复，未回退刚完成的 CIP 版权页排版和旧纸墨色。
- 用户反馈截图：双页仍正常，书页呈纯米白色，16 张已批准的旧纸 WebP 的褶皱、污渍及边缘完全不可见。

## 根因与处理
- `98e-paper-textures.js` 的开关默认开启，但从 localStorage `jf-reader-aged-paper` 恢复。凡旧值为 `off`，`syncButton()` 都会移除 `jf-aged-paper` class，CSS 的 `:not(.jf-aged-paper)` 选择器强制对旧纸 `::after` 设置 `background-image:none!important;opacity:0!important`，于是出现普通白纸。
- v7.66 把「旧」按钮从 Header 移入 Aa 设置弹层；当状态此前被关闭后，肉眼看不到状态也不容易发现开关。
- **一次性向前兼容修复**：新开关键名改为 `jf-reader-aged-paper-v768`。旧版 `off` 不再被继承，升级后默认为用户确认的旧纸效果；今后在 Aa 中显式关闭、开启仍将保存，并在再次打开时生效。
- 打开书籍、切换分页与失败回滚时均调用 `JFPaperTextures.syncButton()` 同步纹理类；绘制书页时再确认静态 WebP 规则存在，避免动态阅读器节点重用丢失样式。
- 新增 `tests/aged-paper-default-v768.js` 模拟旧 off、再次加载、主动关闭/重开和成组纹理绑定。

## 验证范围
- 已在代码执行环境做源码静态断言、JS 语法校验和等价运行时规则模拟；新增 Node 回归脚本供本地执行。
- 未运行完整 `node scripts/build.js`、Chromium/Playwright 真实 UI 截图、用户真实媒体数据，不能宣称最终视觉已经过本地验收。
- 本机验证命令：`node tests/aged-paper-default-v768.js && node scripts/build.js`，打开原 EPUB 第 1–4 页与正文页确认成组 WebP 显示，进入 Aa 面板验证「旧」开关显隐及再次启动后状态保留。

## 影响边界
- 不更换/重压 16 张 WebP、不修改纸张折痕、文字、分页引擎、CIP 布局、笔记、书签或其他模块；只改旧纸开关状态兼容、初始化同步及版本和回归文件。

## 测试桩修正（同版本追加提交）
- 首次模拟审查发现新回归测试提供的 button/select DOM 模拟缺少 `addEventListener`，会在初始化事件注册阶段抛错；现已给测试桩补足空事件处理器。产品代码未发生变化。
- 在当前 V8 环境用隔离 DOM 与旧、新 localStorage 状态模拟执行真实 `98e-paper-textures.js`：默认恢复、16 条纹理规则、左右页配对及新开关持久化均通过。
