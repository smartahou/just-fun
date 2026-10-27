#!/usr/bin/env python3
"""v6.51 independent-suites release audit; zero historical evidence reuse."""
import concurrent.futures,subprocess,sys,pathlib,hashlib,json,time,datetime,os,signal
import importlib.util
spec=importlib.util.spec_from_file_location('run_all',str(pathlib.Path(__file__).with_name('run-all.py')))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
CASES=module.CASES;test_fingerprint=module.test_fingerprint
ROOT=pathlib.Path(__file__).resolve().parents[1]
LOGS=ROOT/'dist'/'test-logs';LOGS.mkdir(parents=True,exist_ok=True)
BUILD_SHA=hashlib.sha256((ROOT/'dist/douyin.js').read_bytes()).hexdigest()
TESTS_SHA=test_fingerprint()
def run(name):
    start=time.monotonic()
    with open(LOGS/('fresh-'+name+'.log'),'wb') as log:
        p=subprocess.Popen([sys.executable,'-u',str(ROOT/'tests'/f'{name}.py')],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        try:returncode=p.wait(timeout=85)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid,signal.SIGKILL);p.wait();returncode=124
    result={'name':name,'passed':returncode==0,'exitCode':returncode,'seconds':round(time.monotonic()-start,2)}
    print(('PASS ' if returncode==0 else 'FAIL ')+name+' '+str(result['seconds'])+'s',flush=True)
    if returncode!=0:print((LOGS/('fresh-'+name+'.log')).read_text(errors='replace')[-900:],flush=True)
    return result
results=[run('annotations-v631')]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    future=[pool.submit(run,name) for name in CASES if name!='annotations-v631']
    for x in concurrent.futures.as_completed(future):results.append(x.result())
report={'version':'v6.51','mode':'fresh-independent-processes','buildSha256':BUILD_SHA,'testsSha256':TESTS_SHA,
  'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tests':sorted(results,key=lambda r:r['name']),
  'passed':len(results)==len(CASES) and all(x['passed'] for x in results)}
(LOGS/'v651-fresh-suite-evidence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('OVERALL',len([x for x in results if x['passed']]),'/',len(CASES),'SHA',BUILD_SHA,'passed',report['passed'],flush=True)
sys.exit(0 if report['passed'] else 1)
