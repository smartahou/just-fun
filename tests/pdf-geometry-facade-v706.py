#!/usr/bin/env python3
"""Pure v7.05 PDF coordinate parity; only local temporary test input."""
import pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[1]
r=subprocess.run(['node',str(root/'tests/pdf-geometry-facade-v706.js')],cwd=root,timeout=25,text=True,capture_output=True)
print(r.stdout,end='',flush=True);print(r.stderr,end='',file=sys.stderr,flush=True)
sys.exit(r.returncode)
