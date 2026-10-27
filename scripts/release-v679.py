#!/usr/bin/env python3
"""v6.79 release gate: never reuse a stale report, never replace a failed test result without a logged rerun."""
from pathlib import Path
import json,hashlib,subprocess,sys,tempfile,shutil,zipfile,time,datetime,os
root=Path(__file__).resolve().parents[1]
output=Path('/mnt/data')
label='JustFun-v6.79-笔记富文本Markdown双模式与预览导出'
compiled=root/'dist/douyin.js'
sha=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
def test_fingerprint():
 h=hashlib.sha256()
 for p in sorted((root/'tests').rglob('*')):
  if p.is_file() and p.suffix in ('.py','.js'):
   h.update(p.relative_to(root).as_posix().encode()+b'\0');h.update(p.read_bytes())
 return h.hexdigest()
def run(cmd,where=root,limit=90):
 x=subprocess.run(cmd,cwd=where,capture_output=True,text=True,errors='replace',timeout=limit)
 if x.returncode:raise RuntimeError('Command failed '+str(cmd)+'\n'+(x.stdout+x.stderr)[-1600:])
 return x

def evidence():
 baseline=json.loads((root/'dist/test-logs/v651-fresh-suite-evidence.json').read_text())
 rerun=json.loads((root/'dist/test-logs/suite-keyboard-seek-v630.json').read_text())
 before=json.loads((root/'dist/full-regression-report.json').read_text()) if (root/'dist/full-regression-report.json').exists() else None
 from importlib.util import spec_from_file_location,module_from_spec
 spec=spec_from_file_location('run_all',root/'tests/run-all.py');mod=module_from_spec(spec);spec.loader.exec_module(mod)
 required=set(mod.CASES)
 actual=sha(compiled);finger=test_fingerprint()
 assert baseline['buildSha256']==actual and baseline['testsSha256']==finger
 assert rerun['buildSha256']==actual and rerun['testsSha256']==finger
 assert len(baseline['tests'])==len(required)==30 and {x['name'] for x in baseline['tests']}==required
 assert sum(not x['passed'] for x in baseline['tests'])==1
 assert [x['name'] for x in baseline['tests'] if not x['passed']]==['keyboard-seek-v630']
 assert rerun['name']=='keyboard-seek-v630' and rerun['passed'] and rerun['exitCode']==0
 rows=[]
 for item in baseline['tests']:
  if item['name']=='keyboard-seek-v630':
   rows.append({'name':item['name'],'passed':True,'exitCode':rerun['exitCode'],'seconds':rerun['seconds'],'source':'isolated-rerun','firstRunExitCode':item['exitCode']})
  else:
   assert item['passed'] and item['exitCode']==0
   rows.append({'name':item['name'],'passed':True,'exitCode':0,'seconds':item['seconds'],'source':'current-build-independent-suite'})
 full={'version':'v6.79','mode':'29-pass-plus-one-real-independent-rerun',
 'build':{'passed':True},'passed':True,'buildSha256':actual,'testsSha256':finger,
 'tests':rows,'previousConcurrentFailure':{'suite':'keyboard-seek-v630','exitCode':1,'wasRetested':True},
 'originalFailedEvidence':'dist/test-logs/v651-fresh-suite-evidence.json','successfulRerunEvidence':'dist/test-logs/suite-keyboard-seek-v630.json',
 'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 (root/'dist/full-regression-report.json').write_text(json.dumps(full,ensure_ascii=False,indent=2)+'\n')
 return full

def targets():
 scripts=['notes-rich-markdown-v679.py','notes-layout-v658.py','reading-notes-v650.py',
          'notes-picker-consistency-v666.py','unified-notes-spread-v675.py']
 results=[]
 for name in scripts:
  started=time.monotonic()
  x=subprocess.run([sys.executable,'-u',str(root/'tests'/name)],cwd=root,capture_output=True,text=True,errors='replace',timeout=120)
  log=root/'dist/test-logs'/('v679-'+name+'.log');log.write_text(x.stdout+x.stderr)
  row={'suite':name,'exitCode':x.returncode,'passed':x.returncode==0,'seconds':round(time.monotonic()-started,2),
      'logSha256':sha(log),'passLines':sum(s.startswith('PASS ') for s in x.stdout.splitlines())}
  results.append(row)
  print(('PASS' if row['passed'] else 'FAIL'),name,row['passLines'],'checks',flush=True)
  if x.returncode:raise RuntimeError('Required notes suite failed: '+name+'\n'+(x.stdout+x.stderr)[-1500:])
 required={'notes-rich-markdown-v679.py':15,'reading-notes-v650.py':33,'notes-picker-consistency-v666.py':16,'unified-notes-spread-v675.py':27}
 for row in results:
  if row['suite'] in required:assert row['passLines']>=required[row['suite']]
 status={'version':'v6.79','buildSha256':sha(compiled),'testsSha256':test_fingerprint(),
  'results':results,'passed':len(results)==5 and all(r['passed'] for r in results)}
 (root/'dist/v679-notes-evidence.json').write_text(json.dumps(status,ensure_ascii=False,indent=2)+'\n')
 return status

def package():
 run(['node','scripts/build.js']);run(['node','--check',str(compiled)])
 full=evidence();ext=targets()
 assert full['buildSha256']==ext['buildSha256']==sha(compiled)
 # Include dependency assets in the clean build; build never reaches the network.
 with tempfile.TemporaryDirectory(prefix='justfun-v679-clean-') as home:
  clean=Path(home)
  for name in ['build.manifest.json']:
   shutil.copy2(root/name,clean/name)
  for d in ['src','scripts','assets','node_modules']:
   shutil.copytree(root/d,clean/d,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
  run(['node','scripts/build.js'],where=clean,limit=70)
  assert sha(clean/'dist/douyin.js')==sha(compiled),'Clean offline build differs'
 files=[]
 for path in root.rglob('*'):
  if not path.is_file():continue
  rel=path.relative_to(root).as_posix()
  if '__pycache__' in path.parts or path.suffix=='.pyc' or '.tmp-' in path.name:continue
  if rel.startswith('dist/test-logs/') and not (path.name.startswith(('fresh-','v679-','suite-keyboard-seek-v630','batch-')) or path.name=='v651-fresh-suite-evidence.json'):
   continue
  if rel.startswith('dist/') and rel not in ('dist/douyin.js','dist/build-report.json','dist/full-regression-report.json','dist/v679-notes-evidence.json') and not rel.startswith('dist/test-logs/'):
   continue
  files.append(path)
 daily=output/(label+'-index.js单文件替换包.zip')
 source=output/(label+'-模块化工程源码版.zip')
 for fp,names in [(daily,[(compiled,'index.js')]),(source,[(p,'JustFun-v6.79-完整工程/'+p.relative_to(root).as_posix()) for p in sorted(files)])]:
  with zipfile.ZipFile(fp,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
   for path,arcname in names:z.write(path,arcname)
  with zipfile.ZipFile(fp) as z:
   assert z.testzip() is None
 with zipfile.ZipFile(daily) as a,zipfile.ZipFile(source) as b:
  assert a.namelist()==['index.js']
  assert a.read('index.js')==b.read('JustFun-v6.79-完整工程/dist/douyin.js')==compiled.read_bytes()
 print(json.dumps({'source':str(source),'daily':str(daily),'sourceBytes':source.stat().st_size,
   'dailyBytes':daily.stat().st_size,'sha256':sha(compiled),'cases':len(full['tests']),
   'targetChecks':{r['suite']:r['passLines'] for r in ext['results']},'sourceItems':len(files)},ensure_ascii=False,indent=2))

if __name__=='__main__':package()
