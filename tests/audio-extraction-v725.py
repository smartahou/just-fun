#!/usr/bin/env python3
"""Run the real, disposable FFmpeg codec-copy/FLAC extraction contract."""
import pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
result=subprocess.run(['node',str(ROOT/'tests/audio-extraction-v725.js')],cwd=ROOT,
                      capture_output=True,text=True,timeout=125)
print(result.stdout,flush=True)
if result.stderr:print(result.stderr,file=sys.stderr,flush=True)
if result.returncode!=0 or 'TOTAL 26 PASS' not in result.stdout:
    raise SystemExit(1)
