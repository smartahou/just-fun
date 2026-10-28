#!/usr/bin/env python3
"""v7.23.1: Windows npm.cmd EINVAL prevention; no npm network or real media access."""
import json, pathlib, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
script=r"""
'use strict';
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const realSpawnSync=cp.spawnSync;
let called=[];
cp.spawnSync=(program,args,options)=>{
  called.push({program,args,options});
  return {status:0,stdout:'',stderr:''};
};
const deploy=require('./scripts/local-deploy-v723.js');
const win=deploy.npmInstallCommand('win32','C:\\Windows\\System32\\cmd.exe');
assert.equal(win.program,'C:\\Windows\\System32\\cmd.exe');
assert.deepEqual(win.args.slice(0,3),['/d','/s','/c']);
assert.match(win.args[3],/^npm\.cmd install --no-save .*pdfjs-dist@6\.4\.299$/);
assert.equal(win.args.some(v=>v.includes('&&')||v.includes('|')||v.includes('>')),false);
assert(!win.args[3].includes('\n'));
const fallback=deploy.npmInstallCommand('win32','');
assert.equal(fallback.program,'cmd.exe');
const linux=deploy.npmInstallCommand('linux');
assert.equal(linux.program,'npm');
assert.deepEqual(linux.args,win.args[3].replace(/^npm\.cmd /,'').split(' '));
// Integration-style: execute the selected command via the project's spawnSync-compatible API semantics.
// Stub spawnSync to verify the dispatched Windows executable is cmd.exe rather than npm.cmd.
const simulated=realSpawnSync(process.execPath,['-e',`const c=require('node:child_process'); const x=${JSON.stringify(win)}; if(x.program.toLowerCase().endsWith('npm.cmd')) process.exit(2); if(x.args[0]!=='/d'||x.args[2]!=='/c')process.exit(3);`],{cwd:process.cwd(),encoding:'utf8'});
assert.equal(simulated.status,0,simulated.stderr);
cp.spawnSync=realSpawnSync;
console.log(JSON.stringify({checks:8,winProgram:win.program,windowsSyntax:'cmd.exe /d /s /c npm.cmd install',linuxProgram:linux.program}));
"""
r=subprocess.run(['node','-e',script],cwd=ROOT,capture_output=True,text=True,timeout=20)
assert r.returncode==0,(r.stdout+r.stderr)[-2000:]
d=json.loads(r.stdout.strip())
assert d['checks']==8
print('Windows npm.cmd launcher: 8/8 PASS (command-dispatch simulation, not real Windows)',flush=True)
