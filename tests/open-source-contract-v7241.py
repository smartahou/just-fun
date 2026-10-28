#!/usr/bin/env python3
"""License and private media boundary contract: offline, read-only."""
from pathlib import Path
import hashlib
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
 ('Legacy notice no longer auto-generated','const AI_USAGE_NOTICE =' not in security and 'function ensureAiUsageNotice()' not in security),
 ('Safe legacy-notice retirement helper exists','function retireLegacyGeneratedNotice()' in security and 'LEGACY_GENERATED_NOTICE_DIGESTS' in security),
 ('Original local-first security flags preserved','const ERASE_AFTER_THREE=HASH_ENABLED && PWD_ENABLED;' in security),
 ('Logo asset remains present for compatibility',(ROOT/'assets/favicon.ico').stat().st_size>1000),
]
for name,ok in checks:check(name,ok)
print(f'TOTAL {len(checks)} PASS',flush=True)
