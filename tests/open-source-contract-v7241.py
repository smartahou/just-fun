#!/usr/bin/env python3
"""License and private media boundary contract: offline, read-only."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def check(name,condition):
    if not condition:raise AssertionError(name)
    print('PASS '+name,flush=True)

license=(ROOT/'LICENSE').read_text(encoding='utf8')
bootstrap=(ROOT/'src/server/00-bootstrap.js').read_text(encoding='utf8')
security=(ROOT/'src/server/10-security-and-settings.js').read_text(encoding='utf8')
checks=[
 ('Canonical MIT license text',license.startswith('MIT License\n') and 'Copyright (c) 2026 smartahou' in license),
 ('MIT requires copyright notice redistribution','The above copyright notice and this permission notice shall be included' in license),
 ('Boot source directs to license','See LICENSE' in bootstrap and 'Open-source code licensing does not license individual users' in bootstrap),
 ('No source-level AI analysis prohibition in active bootstrap','未经权利人事先明确许可' not in bootstrap),
 ('Runtime notice explicitly separates source and private media','项目源码的许可以仓库 LICENSE 为准' in security and '源码开源不代表用户私人媒体' in security),
 ('Runtime still writes compatibility notice file','AI_USAGE_NOTICE_FILE' in security and 'function ensureAiUsageNotice()' in security),
 ('Original local-first security flags preserved','const ERASE_AFTER_THREE=HASH_ENABLED && PWD_ENABLED;' in security),
 ('Logo asset remains present for compatibility',(ROOT/'assets/favicon.ico').stat().st_size>1000),
]
for name,ok in checks:check(name,ok)
print(f'TOTAL {len(checks)} PASS',flush=True)
