#!/usr/bin/env python3
import pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[1]
p=subprocess.run(['node',str(root/'tests/reading-recovery-v715.js')],cwd=root,timeout=60)
raise SystemExit(p.returncode)
