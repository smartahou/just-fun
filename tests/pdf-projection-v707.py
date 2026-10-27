#!/usr/bin/env python3
import pathlib,subprocess,sys
r=pathlib.Path(__file__).resolve().parents[1]
p=subprocess.run(['node',str(r/'tests'/'pdf-projection-v707.js')],cwd=r,timeout=25)
sys.exit(p.returncode)
