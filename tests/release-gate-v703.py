#!/usr/bin/env python3
"""Deterministic Just Fun release gate. Never opens a user media directory.

Usage:
  python tests/release-gate-v703.py --doctor
  python tests/release-gate-v703.py --self-test
  python tests/release-gate-v703.py --smoke
  python tests/release-gate-v703.py --full [--resume] [--timeout 75]
  python tests/release-gate-v703.py --verify

Evidence is checkpointed *after each case*, atomically, with SHA256 of the
build and the entire test source tree. A skipped/timed-out case never passes.
"""
import argparse
import ast
import datetime as dt
import hashlib
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

ROOT=pathlib.Path(__file__).resolve().parents[1]
# The historical 30-case inventory has exactly one source of truth.
_suite_tree=ast.parse((ROOT/'tests/run-all.py').read_text(encoding='utf8'))
CASES=next(ast.literal_eval(node.value) for node in _suite_tree.body
           if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CASES' for t in node.targets))
SMOKE=['notes-group-image-consistency-v702','pdf-mark-merge-v701',
       'txt-reflow-screenshot-v700','notes-one-surface-v682',
       'notes-ime-pdf-original-and-gallery-v696','books-manage-v697',
       'visual-contract-v703','css-budget-v703','css-cascade-v704',
       'txt-presentation-facade-v705','pdf-geometry-facade-v706',
       'pdf-projection-v707','reading-image-identity-v707',
       'reading-integrity-v708','reading-save-budget-v709',
       'catalog-batch-v710','reading-relations-audit-v711',
       'reading-migration-preflight-v712','navigation-isolation-v713','reading-v2-dual-read-v713','reading-durable-save-v714',
       'reading-recovery-v715','reading-v2-sandbox-txn-v716',
       'scan-lifecycle-v717','books-poll-coalesce-v717','lifecycle-stress-v717',
       'video-home-stress-v718','video-feed-stress-v719','feed-warm-window-v720',
       'feed-session-isolation-v721','media-tab-memory-v722']
EVIDENCE=ROOT/'dist'/'release-gate-v703'
ARTIFACT=ROOT/'dist'/'douyin.js'

def hash_file(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def fingerprint_tests():
    h=hashlib.sha256()
    for p in sorted((ROOT/'tests').rglob('*')):
        if not p.is_file() or p.suffix not in ('.py','.js'):continue
        h.update(str(p.relative_to(ROOT)).encode()+b'\0');h.update(p.read_bytes())
    return h.hexdigest()

def atomic_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        os.replace(temp,path)
    finally:temp.unlink(missing_ok=True)

def check_runtime():
    tools={}
    for command in ('node','npm','ffmpeg','ffprobe','chromium'):
        located=shutil.which(command)
        data={'found':bool(located),'path':located}
        if located:
            try:
                flag='-version' if command.startswith('ff') else '--version'
                result=subprocess.run([located,flag],capture_output=True,text=True,timeout=8)
                data['version']=(result.stdout or result.stderr).strip().split('\n')[0][:200]
                data['ok']=result.returncode==0
            except Exception as e:data['ok']=False;data['error']=str(e)
        tools[command]=data
    package=ROOT/'node_modules/pdfjs-dist/package.json'
    pdf=None
    if package.exists():
        try:
            pdf=json.loads(package.read_text(encoding='utf8')).get('version')
        except (OSError,ValueError):pass
    # Temp test is specifically outside user library directories.
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-doctor-') as scratch:
        a=pathlib.Path(scratch)/'probe';b=a.with_suffix('.renamed')
        a.write_bytes(b'just-fun-write-test');os.replace(a,b)
        fs_ok=b.read_bytes()==b'just-fun-write-test'
    document={'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
              'nodeOk':bool(tools['node'].get('ok')),
              'pdfjsVersion':pdf,'pdfjsPinned':pdf=='6.4.299',
              'tempFsAtomicRename':fs_ok,'commands':tools,
              'explicitlyDidNotInspectUserLibrary':True}
    print(json.dumps(document,ensure_ascii=False,indent=2),flush=True)
    atomic_json(EVIDENCE/'doctor.json',document)
    return 0 if document['nodeOk'] and document['pdfjsPinned'] and fs_ok else 1

def kill_group(proc):
    if proc is None:return
    if os.name=='posix':
        try:os.killpg(proc.pid,signal.SIGTERM)
        except (ProcessLookupError,PermissionError):pass
    elif proc.poll() is None:proc.terminate()
    try:proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        if os.name=='posix':
            try:os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        else:proc.kill()
        try:proc.wait(timeout=3)
        except subprocess.TimeoutExpired:pass

def execute(cmd,log_path,timeout):
    started=time.monotonic();proc=None;timedout=False;spawn_error=None;code=None
    log_path.parent.mkdir(parents=True,exist_ok=True)
    with open(log_path,'wb') as output:
        try:
            proc=subprocess.Popen(cmd,cwd=ROOT,stdin=subprocess.DEVNULL,
                                  stdout=output,stderr=subprocess.STDOUT,
                                  start_new_session=(os.name=='posix'))
            try:code=proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:timedout=True
        except Exception as error:spawn_error=repr(error)
        finally:kill_group(proc)
    duration=round(time.monotonic()-started,3)
    # Only read the tail into memory; full log remains on disk for diagnosis.
    with open(log_path,'rb') as f:
        f.seek(0,os.SEEK_END);size=f.tell();f.seek(max(0,size-2400));tail=f.read().decode('utf8','replace')
    return {'passed':code==0 and not timedout and spawn_error is None,
            'exitCode':code,'timedOut':timedout,'spawnError':spawn_error,
            'seconds':duration,'logBytes':size,'logTail':tail[-1500:]}

def build_once():
    r=execute(['node',str(ROOT/'scripts/build.js')],EVIDENCE/'build.log',45)
    if not r['passed']:raise RuntimeError('Build failed: '+r['logTail'])
    return hash_file(ARTIFACT)

def env_key():
    # Includes Python and the executable paths, to reject stale resumed records.
    return hashlib.sha256((sys.executable+'\n'+sys.version+'\n'+(shutil.which('node') or '')+'\n'+(shutil.which('chromium') or '')).encode()).hexdigest()

def verify_report(data, expected_sha=None):
    expected=CASES+SMOKE if data.get('mode')=='full' else SMOKE
    seen=data.get('cases',{})
    return (data.get('mode') in ('full','smoke')
            and data.get('buildSha256')==(expected_sha or hash_file(ARTIFACT))
            and data.get('testsSha256')==fingerprint_tests()
            and data.get('environmentSha256')==env_key()
            and len(seen)==len(expected)
            and set(seen)==set(expected)
            and all(seen[n].get('passed') and not seen[n].get('timedOut')
                    and seen[n].get('exitCode')==0
                    and seen[n].get('buildSha256')==data['buildSha256'] for n in expected))

def run_gate(mode,resume,timeout):
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    sha=build_once();fp=fingerprint_tests();env=env_key()
    path=EVIDENCE/(mode+'-report.json')
    current=json.loads(path.read_text(encoding='utf8')) if resume and path.exists() else None
    if not(current and current.get('buildSha256')==sha and current.get('testsSha256')==fp and current.get('environmentSha256')==env and current.get('mode')==mode):current=None
    if current is None:
        current={'format':1,'mode':mode,'status':'running','startedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
                 'buildSha256':sha,'testsSha256':fp,'environmentSha256':env,'cases':{}}
    selected=CASES+SMOKE if mode=='full' else SMOKE
    print('GATE START',mode,len(selected),'SHA',sha,flush=True)
    for idx,name in enumerate(selected,1):
        prev=current['cases'].get(name)
        if resume and prev and prev.get('passed') and not prev.get('timedOut') and prev.get('exitCode')==0 and prev.get('buildSha256')==sha:
            print(f'REUSED {idx}/{len(selected)} {name}',flush=True);continue
        log=EVIDENCE/'logs'/f'{name}.log'
        # A test may itself rebuild dist. Refuse to accept changes to the release artifact.
        result=execute([sys.executable,str(ROOT/'tests'/(name+'.py'))],log,timeout)
        if hash_file(ARTIFACT)!=sha:
            result['passed']=False;result['artifactChanged']=True
        result['buildSha256']=sha
        current['cases'][name]=result
        current['lastCompletedAt']=dt.datetime.now(dt.timezone.utc).isoformat()
        current['status']='running'
        atomic_json(path,current)
        print(f"{'PASS' if result['passed'] else 'FAIL'} {idx}/{len(selected)} {name} {result['seconds']}s"+
              (' TIMEOUT' if result['timedOut'] else ''),flush=True)
        if not result['passed']:print(result['logTail'][-500:],flush=True)
    current['completedAt']=dt.datetime.now(dt.timezone.utc).isoformat()
    current['status']='passed' if verify_report(current,sha) else 'incomplete'
    current['sumSuiteSeconds']=round(sum(r['seconds'] for r in current['cases'].values()),3)
    atomic_json(path,current)
    print('GATE',current['status'].upper(),len([x for x in current['cases'].values() if x['passed']]),'/',len(selected),flush=True)
    return 0 if current['status']=='passed' else 1

def self_test():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-gate-') as td:
        p=pathlib.Path(td);count=0
        a=execute([sys.executable,'-c','print("OK")'],p/'success.log',5)
        assert a['passed'] and not a['timedOut'];count+=1
        b=execute([sys.executable,'-c','import time;time.sleep(20)'],p/'timeout.log',.5)
        assert b['timedOut'] and not b['passed'] and b['seconds']<4;count+=1
        c=execute([sys.executable,'-c','raise SystemExit(3)'],p/'fail.log',5)
        assert c['exitCode']==3 and not c['passed'];count+=1
        target=p/'atomic.json';atomic_json(target,{'complete':True})
        assert json.loads(target.read_text())['complete'];count+=1
        assert not verify_report({'mode':'full','cases':{},'buildSha256':'fake'});count+=1
        # A child inherited by the test must be killed with its process group.
        if os.name=='posix':
            shell=[sys.executable,'-c','import subprocess,time;subprocess.Popen(["sleep","30"]);time.sleep(30)']
            before=time.monotonic();d=execute(shell,p/'descendant.log',.4)
            assert d['timedOut'] and time.monotonic()-before<5;count+=1
        print('GATE SELF TEST PASS',count,'/',count,flush=True)
    return 0

def cli():
    parser=argparse.ArgumentParser(description=__doc__)
    action=parser.add_mutually_exclusive_group(required=True)
    for a in ('--doctor','--self-test','--smoke','--full','--verify'):action.add_argument(a,action='store_true')
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--timeout',type=int,default=75)
    args=parser.parse_args()
    if args.doctor:return check_runtime()
    if args.self_test:return self_test()
    if args.smoke or args.full:return run_gate('full' if args.full else 'smoke',args.resume,args.timeout)
    path=EVIDENCE/'full-report.json'
    if not path.exists():print('FAIL: missing full report');return 1
    data=json.loads(path.read_text(encoding='utf8'))
    passed=verify_report(data)
    print('RELEASE GATE', 'PASS' if passed else 'INCOMPLETE',flush=True)
    return 0 if passed else 1

if __name__=='__main__':raise SystemExit(cli())
