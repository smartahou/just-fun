#!/usr/bin/env python3
from pathlib import Path
import subprocess,sys
root=Path(__file__).resolve().parents[1]
result=subprocess.run([sys.executable,str(root/'scripts/css-audit-v703.py'),'--check'],cwd=root,capture_output=True,text=True)
if result.returncode:raise AssertionError('CSS importance budget exceeded: '+result.stdout[-600:])
print('PASS CSS importance debt does not grow past v7.02 baseline')
