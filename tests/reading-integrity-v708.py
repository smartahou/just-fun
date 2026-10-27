#!/usr/bin/env python3
import pathlib,subprocess,sys
r=pathlib.Path(__file__).resolve().parents[1]
p=subprocess.run(['node',str(r/'tests'/'reading-integrity-v708.js')],cwd=r,timeout=25)
sys.exit(p.returncode)
