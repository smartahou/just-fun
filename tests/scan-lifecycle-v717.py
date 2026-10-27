#!/usr/bin/env python3
import subprocess,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
subprocess.run(['node',str(ROOT/'tests/scan-lifecycle-v717.js')],cwd=ROOT,check=True,timeout=15)
