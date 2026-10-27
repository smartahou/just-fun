#!/usr/bin/env python3
import pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[1]
try:
    r=subprocess.run(['node',str(root/'tests/reading-migration-preflight-v712.js')],cwd=root,timeout=35)
    sys.exit(r.returncode)
except subprocess.TimeoutExpired:
    print('FAIL v7.12 preflight timed out',file=sys.stderr)
    sys.exit(1)
