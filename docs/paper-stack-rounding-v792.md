# Just Fun v7.92 · 真实书口圆润收口

- 新资源：`assets/paper-stacks/embedded-v792.json`，11 档进度、22 张 WebP（含书首/书尾 2 张全透明）。
- 修改范围：将 v7.90 成品书口图的外侧顶端、底端裁成柔和椭圆弧，维持中段纸纤维纹理和纸层凹凸，不使用运行时随机纹理或锯齿形 CSS 遮罩。
- 书口左右分别在当前左右书页后面，保持内侧直线接合；CSS 仅调整 1px 左右的遮挡与纵向收口，不新增假阴影、贴膜或条纹。
- 旧 `embedded-v790.json`、v7.88 `stack-*.webp` 源素材保留以便回滚。
- 真实的离线资源来自 `scripts/build.js` 指向的 `embedded-v792.json`，手动替换 v7.88 源图**不会**改变线上显示。
- 验证：`node tests/paper-stack-corners-v792.js`、`npm run test:epub-paper`、`node scripts/build.js`、双页 Chromium 截图，对比书首、20%、50%、80%、书尾，确保两侧弧度与正面旧纸贴合。
