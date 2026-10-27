# Just Fun v6.92 · 图库缩放灵敏度优化

- 真实前一正式维护基线：v6.91，初始 SHA-256 `c08ea89185dc01a3b75a9704f988593da55f8382107979ce14b22ae22ee7be3c`，已在修改前离线构建核实。
- 本次源码文件：`src/client/scripts/00-state-and-api.js`、`src/client/scripts/80-library-actions.js`、`src/client/index.html`、`src/client/styles/00-foundation.css`。
- 大图滚轮按实际 delta 动态缩放，标准 100px 滚轮输入约 4.9%，取代原固定 16%；高分辨率触控板可微调，单次极端 wheel 增量限定120px。
- 图片和实况照片共用的双指缩放幅度缓和（距离比的0.72次幂），保留缩放中心与原本 1×–8× 范围。
- 图库缩略图大小滑杆步距由10px降至2px，标准桌面宽度由110px增加至170px，增强可微调性。
- 新增实际 Chromium 专项 `tests/photo-zoom-fine-v692.py`：10/10 检查通过；历史正式30套独立批次严格合并通过，SHA和测试指纹一致。
- 最终 index.js SHA-256: `4aff621cb687075fe1af6d36ba7b26ca59c0b3bd8fa33935aefee86eeed09a0c`。
- Windows 用户实机和真实触控板手感未经验证；以上数据来自 Linux Chromium。
