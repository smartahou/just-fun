#!/usr/bin/env python3
"""Read-only source contract: server folder JSON and the browser move picker."""
import pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
script=ROOT/'tests'/'move-target-api-contract-v730.js'
result=subprocess.run(['node',str(script)],cwd=ROOT,
                      capture_output=True,text=True,timeout=30)
print(result.stdout,end='',flush=True)
if result.stderr:print(result.stderr,file=sys.stderr,end='',flush=True)
if result.returncode!=0 or 'TOTAL 10 PASS' not in result.stdout:
    raise SystemExit(1)
