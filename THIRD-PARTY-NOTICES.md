# 第三方组件 / Third-Party Notices

## Mozilla PDF.js

本项目构建时使用锁定的 **pdfjs-dist@6.4.299**。正式离线依赖包的 package.json 声明 **Apache License 2.0**。Git 仓库不提交 node_modules/，但构建后的运行 JS 会嵌入 PDF.js 模块与相关资源。未来发行打包产物时，需要核查并保留适用的许可证、版权声明及 NOTICE 文件；以上游软件包自带文本为准。

## FFmpeg / FFprobe

程序调用用户电脑已安装的 FFmpeg/FFprobe，不随此源码仓库分发其可执行文件。若未来制作附带 FFmpeg 的发行版，需根据实际编译选项检查 LGPL/GPL 和分发义务。

## 图标与媒体素材

项目现用 Logo 系此前由项目拥有者提供的图像资源，assets/favicon.ico 根据该图转换制作；未发现来自 Element UI 等第三方图标库的证据。维护者仍应确认底图的使用与分发权利。任何字体、视频、音频、截图和其他第三方素材须另行核对版权。测试中的随机生成数据不代表真实私人媒体可以公开。源码公开不意味着用户私人资料或第三方受版权保护的内容获得授权。

---

## English

The build pins **Mozilla PDF.js (pdfjs-dist@6.4.299)**, whose package metadata declares **Apache-2.0**. The source repository excludes node_modules/, but built distributions embed PDF.js and must carry any required license/notice materials. FFmpeg/FFprobe are host-provided; bundling their binaries would require an independent LGPL/GPL compliance review. The logo was previously supplied by the project owner, and assets/favicon.ico was made from it; no Element UI or other third-party icon library origin has been identified. The owner should still confirm underlying artwork rights; non-original fonts and media require independent review.
