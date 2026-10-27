#!/usr/bin/env python3
"""Password-bound metadata encryption, migration, rollback and tamper checks.
All media/temp files live in disposable jf-architecture-test-* directories.
"""
import hashlib,json,pathlib,tempfile,subprocess,time,os,sys
from isolated import ROOT,make_fixture,launch,stop,api_wait,urlopen,sha
PASS=[]
def check(name,condition):
 print(('PASS ' if condition else 'FAIL ')+name,flush=True)
 if not condition:raise AssertionError(name)
 PASS.append(name)
def envelope(file):
 d=json.loads(file.read_text(encoding='utf8'))
 return d.get('format')=='justfun-metadata-vault' and d.get('version')==1 and 'data' in d
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-vault-') as td:
 root=pathlib.Path(td)
 lib=root/'课程'; files=make_fixture(lib)
 p=log=None
 try:
  p,port,log=launch(ROOT/'dist/douyin.js',lib,root/'home',flags=['--pwd'],password='correct-horse-battery-staple')
  api_wait(port)
  # wait until catalog has indexed all fixture items
  time.sleep(.8)
 finally:stop(p,log)
 cache=lib/'.douyin-nav-cache'; main=cache/'data.json';backup=cache/'data.json.bak';salt=cache/'vault.json'
 check('Password-mode catalog ciphertext',envelope(main))
 check('Catalog backup also ciphertext',envelope(backup))
 check('Index contains no original names',b'\xe6\xb5\x8b\xe8\xaf\x95' not in main.read_bytes() and b'originalName' not in main.read_bytes())
 check('Vault salt separate from password',salt.is_file() and 'correct-horse' not in salt.read_text())
 check('Original media preserved',all(sha(lib/name)==h for name,h in files.items()))
 first=main.read_bytes()
 p=log=None
 try:
  p,port,log=launch(ROOT/'dist/douyin.js',lib,root/'home',password='correct-horse-battery-staple')
  content=api_wait(port)
  check('Restart with password restores indexed content',len(content.get('items',[]))>=3)
 finally:stop(p,log)
 check('No plaintext index after restart',envelope(main) and envelope(backup))
 check('Independent authenticated main and backup ciphertext',main.read_bytes()!=backup.read_bytes())
 # Main index corruption must recover from the independently authenticated backup.
 main_before=main.read_bytes();main.write_text('unreadable-json{',encoding='utf8')
 p=log=None
 try:
  p,port,log=launch(ROOT/'dist/douyin.js',lib,root/'home',password='correct-horse-battery-staple')
  recovered=api_wait(port)
  check('Corrupted primary falls back to encrypted backup',len(recovered.get('items',[]))>=3)
 finally:stop(p,log)
 check('Recovered primary stays encrypted',envelope(main))
 # Simulate upgrade of a former password-protected library with plain cache,
 # using ONLY disposable fixture: derive a structurally valid legacy index from
 # a no-password temp library and copy into a password fixture.
 legacy=root/'legacy'; make_fixture(legacy);p=log=None
 try:
  p,port,log=launch(ROOT/'dist/douyin.js',legacy,root/'home2')
  api_wait(port);time.sleep(.3)
 finally:stop(p,log)
 lcache=legacy/'.douyin-nav-cache';lmain=lcache/'data.json';lbackup=lcache/'data.json.bak'
 before=json.loads(lmain.read_text())
 check('Legacy plaintext sample actually exists',len(before.get('items',[]))>=3)
 # test-only retrofit of previously configured password setting
 cfg=lcache/'library-settings.json';config=json.loads(cfg.read_text());config['passwordEnabled']=True;cfg.write_text(json.dumps(config))
 # Simulated legacy notes/transcript/async task written before metadata encryption.
 aidir=lcache/'ai-learning';aidir.mkdir(exist_ok=True)
 key=next(x['key'] for x in before['items'] if x.get('kind') in ('audio','video') and x.get('state')=='ready')
 legacy_docs=[
  (f'{key}.json',{'version':1,'sourceKey':key,'notes':None,'outline':None,'secret':'legacy-notes-sentinel'}),
  (f'{key}.transcript.json',{'version':1,'sourceKey':key,'segments':[],'secret':'legacy-transcript-sentinel'}),
  (f'{key}.transcript-previous.json',{'version':1,'sourceKey':key,'segments':[],'secret':'legacy-previous-sentinel'}),
  (f'{key}.asr-task.json',{'version':1,'sourceKey':key,'taskId':'task-12345678','audioFingerprint':'a'*64,'secret':'legacy-task-sentinel'})]
 for name,doc in legacy_docs:(aidir/name).write_text(json.dumps(doc,ensure_ascii=False),encoding='utf8')
 p=log=None
 try:
  p,port,log=launch(ROOT/'dist/douyin.js',legacy,root/'home2',password='my-new-vault-password')
  api_wait(port)
  status,head,body=urlopen(f'http://127.0.0.1:{port}/api/ai-transcript?key={key}')
  print('LEGACY-API',status,body[:400],flush=True)
  check('Legacy transcript readable through encrypted vault API',status==200 and b'legacy-transcript-sentinel' in body)
 finally:stop(p,log)
 check('Existing plaintext main index migrated',envelope(lmain))
 check('Existing plaintext recovery index migrated',envelope(lbackup))
 check('Migration kept source images and videos unchanged',len(list(legacy.glob('*.mp4')))==1)
 check('Legacy names no longer in active index',b'originalName' not in lmain.read_bytes())
 check('AI notes, transcript, previous revision and queued task encrypted',all(envelope(aidir/name) for name,_ in legacy_docs))
 check('AI sensitive payload no longer on disk',all(b'legacy-' not in (aidir/name).read_bytes() for name,_ in legacy_docs))
 # Confirm both copies being tampered/corrupted fail CLOSED, no media deletion.
 original_main=lmain.read_bytes();original_bak=lbackup.read_bytes()
 m=json.loads(original_main);m['data']='AAAAAA'+m['data'];lmain.write_text(json.dumps(m))
 b=json.loads(original_bak);b['data']='BBBBBB'+b['data'];lbackup.write_text(json.dumps(b))
 cmd=['node',str(ROOT/'dist/douyin.js'),'--port=3865','--no-screenshot']
 env=dict(os.environ,HOME=str(root/'home2'),USERPROFILE=str(root/'home2'))
 result=subprocess.run(cmd,input=(str(legacy)+'\nmy-new-vault-password\n').encode(),cwd=root/'home2',env=env,
                      stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=25)
 check('GCM tamper causes safe startup refusal',result.returncode!=0 and b'\xe7\xbc\x93' in result.stdout)
 check('Tamper does not delete source videos',len(list(legacy.glob('*.mp4')))==1)
 # Restore test fixture ciphertext for cleanliness; no user data touched.
 lmain.write_bytes(original_main);lbackup.write_bytes(original_bak)
 print('RESULT',len(PASS),'/',len(PASS))
