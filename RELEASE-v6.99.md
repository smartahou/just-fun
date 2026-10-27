# Just Fun v6.99 · TXT 智能合行与启动提示精简

- 维护基线：v6.98 模块化完整源码。
- 已删除 Hash + 密码模式启动时的重复警示文本，保留密码校验及原有三次错误清空的行为。
- TXT **仅显示层**进行轻量智能合行：自动合并硬换行造成的单段拆行；保留空行、首行缩进、章节标题、短诗与列表的显式分隔；原始 TXT 文件及 API 章节文字保持原样。
- 通过原始偏移到显示偏移的映射，兼容历史 TXT 摘录的原始书籍定位；EPUB、PDF、MD 阅读行为不变。
- 风险边界：无完美的通用纯文本段落识别标准，极少数没有缩进或标点的人工分行仍可能需要保留/合并策略优化。
- 质量证据：tests/txt-smart-wrap-v699.py、tests/hash-password-mixed-v698.py 和 dist/test-logs、dist/full-regression-report.json。
