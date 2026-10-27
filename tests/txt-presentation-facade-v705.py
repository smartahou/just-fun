#!/usr/bin/env python3
"""Pure browser facade compatibility; no user files or network."""
import pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[1]
result=subprocess.run(['node',str(root/'tests/txt-presentation-facade-v705.js')],cwd=root,capture_output=True,text=True,timeout=20)
print((result.stdout+result.stderr).strip(),flush=True)
if result.returncode:raise SystemExit(result.returncode)
