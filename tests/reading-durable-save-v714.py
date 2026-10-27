#!/usr/bin/env python3
import pathlib,subprocess,sys
r=pathlib.Path(__file__).resolve().parents[1]
p=subprocess.run(['node',str(r/'tests'/'reading-durable-save-v714.js')],cwd=r,timeout=90)
sys.exit(p.returncode)
