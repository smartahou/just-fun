#!/usr/bin/env python3
import subprocess,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
p=subprocess.run(['node',str(root/'tests/reading-v2-sandbox-txn-v716.js')],cwd=root,timeout=80)
raise SystemExit(p.returncode)
