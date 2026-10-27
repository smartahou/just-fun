#!/usr/bin/env python3
"""v7.04 keeps the reading/photo CSS cascade cleanup deterministic.
Run in the isolated release gate. Zero edits to the media library.
"""
import json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
result=subprocess.run([sys.executable,str(ROOT/'scripts/css-debt-trim-v704.py'),'--check'],cwd=ROOT,capture_output=True,text=True,timeout=15)
assert result.returncode==0, result.stdout+result.stderr
report=subprocess.run([sys.executable,str(ROOT/'scripts/css-audit-v703.py'),'--check'],cwd=ROOT,capture_output=True,text=True,timeout=15)
assert report.returncode==0, report.stdout+report.stderr
info=json.loads(report.stdout)
assert info['importantCurrent']<=3307, info
assert info['importantBudget']==3307,info
assert info['importantCurrent'] == sum(item['important'] for item in info['files'])
assert len(info['files'])==6
print('PASS v7.04 CSS dedup idempotent, budget reduced by 180 (3487 -> 3307), six stylesheet audit')
