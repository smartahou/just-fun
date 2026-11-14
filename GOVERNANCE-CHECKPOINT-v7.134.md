# GOVERNANCE-CHECKPOINT v7.134.0 · 跨页选区不自动扩选、下一页可靠触发

## 评估与根因
- v7.133 代码 `adjacentSource()` 根据左右方向返回整页边界（向前为 low、向后为 high），随后 `pageRendered()` 把 `virtual.focus` 设成边界；这种行为把“翻页”错误实现成“选中整组新书页”。
- 翻向后一组的右上角拖选更容易发生原生 `Selection` 在边界折叠、丢失，原实现 `else if(selecting())armEdge(direction)` 因为仅检查即时状态而不会启动计时器。
- v7.133 在每次 `pageRendered()` 后重新 `armEdge()`，指针不动也会反复翻页，进一步放大误选。

## 本轮修复
- `adjacentSource()` 只负责检查相邻书页的源坐标、安全边界及预渲染状态，返回目标页索引，**不修改选区范围**。
- `captureDragSeed()` 在实际原生选区有效时缓存轻量的 `bookId/session/chapter/anchor/focus`，原生 Range 在角落折叠时仍可按原文偏移进入跨页选择；不读几何、不绘制、不增加每帧文本重算。
- 两侧热区向书页外扩最多 20px，在纸页上沿上扩最多 12px，避免鼠标已经进入封面边沿而无法触发。
- 引入 `edgeLocked`：翻页后保持锚点和终点原值，只在指针移入正文后按真实 caret 更新 `focus`；不离开角落就不能自动翻第二次。
- 选区跨页后若暂时在当前书页不可见，工具条定位可退回到最后指针位置，原文选择仍可复制、标记、加入笔记。既有分页引擎、章节源文本、图片素材、笔记数据库不改。

## 回归
- 增强 `tests/epub-selection-v7129.py`：前后方向、右上角丢失原生选区、翻页前后原文完全相等、鼠标静止不连续翻页、进入新页正文后才延伸、松开后原文正确。
- 增强 `tests/epub-selection-v7129.js`：断言不自动扩选、不重复触发和右边界原生选区折叠的兼容机制。
- CI 与实际浏览器验证结果以 GitHub Actions 日志为准；运行前不得声称通过。
- iPad Safari 原生选择手柄事件是否能正确冒泡还需真机验证，不用合成 touch pointer 代替该结论。

## 补充验收：真实鼠标事件
既有 Chromium 合成 PointerEvent 验证通过后，额外增加 Playwright 原生 `page.mouse.down/move/up` 测试，实测在右侧纸页拖选、移到右上角、悬停翻页及保持指针不动。该测试能暴露合成事件未触发浏览器原生 Selection 的遗漏，属于本次“向后翻页无效”的必要覆盖，而非额外功能。以新 CI 结果为最终依据。
