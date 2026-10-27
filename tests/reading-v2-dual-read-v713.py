#!/usr/bin/env python3
"""Run Workspace v2 decoder contracts; no user data paths."""
import pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[1]
p=subprocess.run(['node',str(root/'tests/reading-v2-dual-read-v713.js')],cwd=root,timeout=40)
sys.exit(p.returncode)
