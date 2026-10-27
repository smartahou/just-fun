#!/usr/bin/env python3
"""Strict endpoint boundary checks in real production JS, local only."""
import subprocess,pathlib
p=pathlib.Path(__file__).with_suffix('.js')
r=subprocess.run(['node',str(p)],capture_output=True,text=True,timeout=20)
print(r.stdout,end='')
if r.stderr:print(r.stderr)
raise SystemExit(r.returncode)
