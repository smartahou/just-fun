# Just Fun v7.78.1 · 旧纸纸面浮膜热修复

- 日期：2026-11-06
- 基线：main HEAD `c4d806b36c6acc4f9c376cc8bd5b2ab9dd5cc353`（v7.78.0）
- 真实根因：v7.43 引入独立外侧 `.jfBookPile` 后已隐藏过时的子元素 `.jfSheetStack`；v7.52 的高优先级 `display:block!important` 又将其打开，让有底色、遮罩、渐变和历史伪元素的半透明条覆盖在真实摄影纸张 WebP 上。
- 修复：仅将做旧纸模式专用 `.jfSheet>.jfSheetStack` 重新设为 `display:none!important`，沿用 v7.43 的设计；原 WebP、`.jfBookPile` 进度厚度、`.jfSheetCurl` 内侧卷曲、书脊、排版与分页逻辑不变。
- 新增专项：`node tests/paper-surface-no-film-v7781.js`，断言子叠层不可见、原图层/书脊/外侧纸堆保留。
- 本轮实测：GitHub 端完整源码执行了等效的静态断言；由于本会话容器无 GitHub 网络克隆及完整依赖，**未运行仓库完整 Node 专项/构建/浏览器集成测试或 Windows 实机测试**。不能声明视觉完成验收。
- 特别说明：v7.79 扩展为 16 组素材的本地应用包尚未合并进远端 main；与该计划独立。本热修复作为 v7.79 之前的补丁，后续应用 16 组素材不得恢复子叠层。
