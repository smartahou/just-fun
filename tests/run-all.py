#!/usr/bin/env python3
"""Just Fun offline CI: build, concurrent isolated checks, timing + report.
Every destructive test creates its own temp library; never pass user directories.
"""
import concurrent.futures,datetime,json,pathlib,subprocess,sys,time,tempfile,os,signal,hashlib

ROOT=pathlib.Path(__file__).resolve().parents[1]
CASES=['isolated','security','workspace','browser','browser-preview','startup-port-unicode','browser-frames-v625','recovery-v626','keyboard-seek-v627','keyboard-seek-v630','long-video-frames-v628','long-real-server-v628','delete-drive-v629','annotations-v631','annotations-ui-v632','annotations-ui-v633','annotation-alignment-v634','annotations-v635','ux-v636','ai-audio-preparation-v637','ai-learning-v638','ai-transcription-v639','ai-transcript-ux-v642','ai-transcript-ranges-v643','ai-transcript-ux-v643','live-photo-v644','live-photo-gestures-v645','photo-crop-v646','photo-crop-zoom-v647','metadata-vault-v648']

def test_fingerprint():
    """Bind saved test evidence to the exact test scripts used to produce it."""
    h=hashlib.sha256()
    for p in sorted(ROOT.joinpath('tests').rglob('*')):
        if p.is_file() and p.suffix in ('.py','.js'):
            h.update(p.relative_to(ROOT).as_posix().encode('utf8')+b'\0')
            h.update(p.read_bytes())
    return h.hexdigest()


def run(name):
    start=time.monotonic()
    try:
        # Isolate process groups so web servers spawned by old integration tests
        # cannot outlive their test or hold the next suite's resources.
        with tempfile.TemporaryFile(mode='w+',encoding='utf8',errors='replace') as output:
            proc=subprocess.Popen([sys.executable,str(ROOT/'tests'/f'{name}.py')],cwd=ROOT,
                                  stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,
                                  start_new_session=True)
            try:
                pcode=proc.wait(timeout=115)
            finally:
                try:os.killpg(proc.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                if proc.poll() is None:
                    try:proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        try:os.killpg(proc.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                        proc.wait()
            output.seek(0)
            log=output.read()
        return {'case':name,'ok':pcode==0,'exitCode':pcode,
                'seconds':round(time.monotonic()-start,3),'output':log}
    except Exception as exc:
        return {'case':name,'ok':False,'exitCode':-1,'seconds':round(time.monotonic()-start,3),
                'output':f'{type(exc).__name__}: {exc}'}

def main():
    start=time.monotonic()
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    buildStart=time.monotonic()
    build=subprocess.run(['node','scripts/build.js'],cwd=ROOT,
                         stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,errors='replace')
    buildSeconds=round(time.monotonic()-buildStart,3)
    logs=ROOT/'dist'/'test-logs';logs.mkdir(parents=True,exist_ok=True)
    (logs/'build.log').write_text(build.stdout,encoding='utf8')
    print(('PASS' if build.returncode==0 else 'FAIL')+f' offline build ({buildSeconds}s)',flush=True)
    cases=[]
    if build.returncode==0:
        # The integration suite must own its fixture ports before other browsers start.
        result=run('annotations-v631');cases.append(result)
        (logs/'annotations-v631.log').write_text(result['output'],encoding='utf8')
        print(('PASS' if result['ok'] else 'FAIL')+f" annotations-v631 ({result['seconds']}s)",flush=True)
        if not result['ok']:print(result['output'][-1200:],flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            futures={pool.submit(run,name):name for name in CASES if name!='annotations-v631'}
            for future in concurrent.futures.as_completed(futures):
                result=future.result();cases.append(result)
                (logs/(result['case']+'.log')).write_text(result['output'],encoding='utf8')
                print(('PASS' if result['ok'] else 'FAIL')+f" {result['case']} ({result['seconds']}s)",flush=True)
                if not result['ok']:print(result['output'][-900:],flush=True)
        # This legacy integration suite starts a full HTTP server plus two browser sessions.
        # Run it after parallel Chromium suites finish to prevent intermittent executor stalls.

    report={'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'wallSeconds':round(time.monotonic()-start,3),
            'build':{'passed':build.returncode==0,'seconds':buildSeconds},
            'buildSha256':hashlib.sha256((ROOT/'dist/douyin.js').read_bytes()).hexdigest() if build.returncode==0 else None,
            'testsSha256':test_fingerprint(),
            'tests':[{'name':x['case'],'passed':x['ok'],'seconds':x['seconds'],'exitCode':x['exitCode']} for x in cases],
            'passed':build.returncode==0 and len(cases)==len(CASES) and all(x['ok'] for x in cases)}
    (ROOT/'dist'/'full-regression-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    print('OVERALL', 'PASS' if report['passed'] else 'FAIL',f"{report['wallSeconds']}s",flush=True)
    return 0 if report['passed'] else 1


# Batch mode for short-lived execution environments. The normal no-argument entry
# remains compatible with the existing one-command full CI on developer machines.
BATCHES={
  1:['browser-preview','startup-port-unicode','browser-frames-v625','recovery-v626','ai-audio-preparation-v637','ai-learning-v638','ai-transcription-v639','ai-transcript-ux-v642','ai-transcript-ranges-v643','ai-transcript-ux-v643','live-photo-v644','live-photo-gestures-v645','photo-crop-v646','photo-crop-zoom-v647','metadata-vault-v648'],
  2:['keyboard-seek-v627','keyboard-seek-v630','long-video-frames-v628','delete-drive-v629','long-real-server-v628'],
  3:['annotations-ui-v632','annotations-ui-v633','annotation-alignment-v634','annotations-v635','ux-v636','browser','isolated'],
  4:['security','workspace','annotations-v631'],
}
def batch_run(number):
    t0=time.monotonic();root=ROOT/'dist'/'test-logs';root.mkdir(parents=True,exist_ok=True)
    build=subprocess.run(['node','scripts/build.js'],cwd=ROOT,capture_output=True,text=True)
    if build.returncode:print(build.stdout+build.stderr);return 1
    import hashlib
    sha=hashlib.sha256((ROOT/'dist/douyin.js').read_bytes()).hexdigest()
    results=[]
    for name in BATCHES[number]:
        result=run(name);results.append(result)
        (root/(name+'.log')).write_text(result['output'],encoding='utf8')
        print(('PASS' if result['ok'] else 'FAIL')+f" {name}: {result['seconds']}s",flush=True)
        if not result['ok']:print(result['output'][-1200:],flush=True);break
    saved={'batch':number,'buildSha256':sha,'testsSha256':test_fingerprint(),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'wallSeconds':round(time.monotonic()-t0,3),'tests':[{'name':r['case'],'passed':r['ok'],'seconds':r['seconds'],'exitCode':r['exitCode']} for r in results]}
    (root/f'batch-{number}.json').write_text(json.dumps(saved,indent=2),encoding='utf8')
    return 0 if len(results)==len(BATCHES[number]) and all(r['ok'] for r in results) else 1

def suite_run(name):
    if name not in CASES:raise SystemExit('Unknown test suite.')
    import hashlib
    subprocess.run(['node','scripts/build.js'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
    sha=hashlib.sha256((ROOT/'dist/douyin.js').read_bytes()).hexdigest()
    result=run(name)
    directory=ROOT/'dist/test-logs';directory.mkdir(exist_ok=True)
    (directory/(name+'.log')).write_text(result['output'],encoding='utf8')
    record={'buildSha256':sha,'testsSha256':test_fingerprint(),'name':name,'passed':result['ok'],'seconds':result['seconds'],'exitCode':result['exitCode']}
    (directory/('suite-'+name+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
    print(('PASS' if result['ok'] else 'FAIL')+' '+name+' '+str(result['seconds'])+'s',flush=True)
    if not result['ok']:print(result['output'][-1800:],flush=True)
    return 0 if result['ok'] else 1

def batch_merge():
    import hashlib
    sha=hashlib.sha256((ROOT/'dist/douyin.js').read_bytes()).hexdigest()
    results=[];batches=[];used=[]
    for n,names in BATCHES.items():
        p=ROOT/'dist'/'test-logs'/f'batch-{n}.json'
        obj=json.loads(p.read_text(encoding='utf8')) if p.exists() else None
        whole=obj and obj.get('buildSha256')==sha and obj.get('testsSha256')==test_fingerprint() and [v['name'] for v in obj['tests']]==names and all(v['passed'] for v in obj['tests'])
        if whole:
            results.extend(obj['tests']);batches.append({'batch':n,'wallSeconds':obj['wallSeconds']});used.append('batch-'+str(n));continue
        for name in names:
            f=ROOT/'dist'/'test-logs'/('suite-'+name+'.json')
            if not f.exists():raise SystemExit('Missing independent suite: '+name)
            item=json.loads(f.read_text(encoding='utf8'))
            if item.get('buildSha256')!=sha or item.get('testsSha256')!=test_fingerprint() or item.get('name')!=name or not item.get('passed'):
                raise SystemExit('Failed or outdated independent suite: '+name)
            results.append({k:item[k] for k in ('name','passed','seconds','exitCode')});used.append('suite-'+name)
    if set(x['name'] for x in results)!=set(CASES) or len(results)!=len(CASES):raise SystemExit('Missing or duplicated test suite')
    report={'passed':True,'mode':'independent-batches-and-suites','version':'v6.74','buildSha256':sha,'testsSha256':test_fingerprint(),
      'startedAt':None,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'wallSeconds':None,'sumSuiteSeconds':round(sum(x['seconds'] for x in results if isinstance(x['seconds'],(int,float))),3),
      'build':{'passed':True},'batches':batches,'evidence':used,'tests':results}
    (ROOT/'dist/full-regression-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('OVERALL PASS',len(results),'suites verified for one SHA',flush=True)
    return 0

if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--batch' and sys.argv[2] in '1234':
        sys.exit(batch_run(int(sys.argv[2])))
    if len(sys.argv)==3 and sys.argv[1]=='--suite':sys.exit(suite_run(sys.argv[2]))
    if sys.argv[1:]==['--merge']:sys.exit(batch_merge())
    sys.exit(main())

