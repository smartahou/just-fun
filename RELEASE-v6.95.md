# Just Fun v6.95 · 图库缩放速度折中

2026-10-25

## 增量修改
- 从 ChatGPT 文件库 v6.94 的完整模块化源码及实际交付 index.js 核对相同 SHA 后接力开发。
- 图库查看器滚轮响应系数 0.00085 → 0.00118，标准 100px 事件倍率 exp(0.118)=1.1252，即约 12.5%，位于此前 8.9% 与最初 16% 之间。
- 双指缩放指数 0.85 → 0.95，适度加快，继续保留图片中心锚点、1x~8x 边界、触控板微小滚动和图库网格 4px 步进。
- 只更改 `src/client/scripts/00-state-and-api.js`、`src/client/scripts/80-library-actions.js` 的缩放参数；未更改静态图片裁剪、实况图片提取或服务端数据。
- 更新 v6.46/v6.47 旧回归中已过期的“实况图片不可裁剪”验收条件，以符合 v6.94 正式新增功能；添加新专项 `tests/photo-zoom-balance-v695.py`。

## 实测
- Chromium 新缩放专项 10/10 PASS。
- 历史正式全量 30/30 PASS，4批使用同一正式 JS SHA 与测试指纹，套件累加执行 185.039s，详见 `dist/full-regression-report.json` 和 `dist/test-logs`。
- 纯净源码解压、离线重新构建、ZIP CRC、独立单 index.js 启动 HTTP 200 均在发布流程单独核验。
- Windows 实机真实滚轮与触控板手感仍需用户确认。
