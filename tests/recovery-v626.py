#!/usr/bin/env python3
"""Regression for UI/server recovery after a hung screenshot/cover.
Only temporary generated media and disposable cache. Never accepts user paths.
"""
import hashlib,json,os,pathlib,shutil,socket,subprocess,tempfile,threading,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
BUILD=ROOT/'dist/douyin.js'
checks=[]
def check(name,value):
 print(('PASS' if value else 'FAIL'),name,flush=True)
 checks.append({'name':name,'passed':bool(value)})
 if not value:raise AssertionError(name)
def freeport():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def req(port,api='/',data=None,timeout=2):
 start=time.monotonic()
 url=f'http://127.0.0.1:{port}{api}'
 x=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,
   headers={'Content-Type':'application/json'} if data is not None else {})
 with urllib.request.urlopen(x,timeout=timeout) as r:return r.status,r.read(),time.monotonic()-start
def launch(lib,home,extra_env=None,flags=()):
 home.mkdir(parents=True,exist_ok=True)
 port=freeport();env=dict(os.environ,HOME=str(home),USERPROFILE=str(home),**(extra_env or {}));
 proc=subprocess.Popen(['node',str(BUILD),'--port='+str(port),*flags],cwd=str(home),env=env,
  stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
 proc.stdin.write((str(lib)+'\n').encode());proc.stdin.flush();proc.stdin.close()
 for i in range(100):
  try:
   if req(port,'/manifest.webmanifest',timeout=.5)[0]==200:return proc,port
  except Exception:pass
  if proc.poll() is not None:raise AssertionError('startup failed '+proc.stdout.read().decode(errors='replace')[-600:])
  time.sleep(.05)
 proc.kill();raise TimeoutError('server did not start')
def stop(p):
 if p is None:return
 if p.poll() is None:
  p.terminate()
  try:p.wait(timeout=4)
  except subprocess.TimeoutExpired:p.kill();p.wait(timeout=3)
 if p.stdout:p.stdout.close()
def get_video(port):
 for i in range(80):
  data=json.loads(req(port,'/api/data')[1]);vid=next((i for i in data.get('items',[]) if i.get('kind')=='video'),None)
  if vid and vid.get('duration'):return vid
  time.sleep(.15)
 raise AssertionError('video scan did not settle')
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-hang-') as td:
 base=pathlib.Path(td);lib=base/'素材';lib.mkdir();home=base/'home';home.mkdir()
 f=lib/'讲座.mp4';subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',
 '-f','lavfi','-i','testsrc2=size=160x90:rate=24:duration=4','-c:v','mpeg4','-q:v','5',str(f)],check=True,timeout=15)
 before=hashlib.sha256(f.read_bytes()).hexdigest()
 p=None
 try:
  p,port=launch(lib,home,flags=['--no-screenshot']);item=get_video(port)
  check('Boot and metadata scan work',bool(item.get('duration')))
  shot=json.loads(req(port,'/api/screenshot',{'key':item['key'],'time':1},timeout=12)[1])
  check('Actual original-resolution screenshot succeeds',shot.get('ok') and bool(shot.get('key')))
  check('Original video preserved after successful screenshot',hashlib.sha256(f.read_bytes()).hexdigest()==before)
 finally:stop(p)
 # avoid triggering cover regeneration on startup, for an isolated request benchmark
 cache=lib/'.douyin-nav-cache';catalog_path=cache/'data.json';catalog=json.loads(catalog_path.read_text());
 for item in catalog['items']:
  if item.get('kind')=='video':item['cover']='covers/testhold';item['coverAttemptFingerprint']=item.get('fingerprint');
 (cache/'assets'/'covers').mkdir(parents=True,exist_ok=True)
 (cache/'assets'/'covers'/'testhold').write_bytes(b'fake cover placeholder')
 catalog_path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf8')
 p=None
 try:
  p,port=launch(lib,home)
  item=get_video(port)
  result=json.loads(req(port,'/api/set-cover',{'key':item['key'],'time':1,'precise':True},timeout=12)[1])
  check('Actual FFmpeg cover generation succeeds',result.get('ok') and bool(result.get('cover')))
 finally:stop(p)
 # PATH wrapper emulates a decoder with an unresponsive input for 2.5 seconds.
 mock=base/'mockbin';mock.mkdir();exe=mock/'ffmpeg';
 exe.write_text('#!/bin/sh\nsleep 2.5\nexit 72\n');exe.chmod(0o755)
 p=None
 try:
  p,port=launch(lib,home,extra_env={'PATH':str(mock)+os.pathsep+os.environ['PATH']})
  item=get_video(port);key=item['key'];finish=[]
  def background():
   try:finish.append(req(port,'/api/set-cover',{'key':key,'time':1,'precise':True},timeout=7))
   except Exception as e:finish.append(str(e))
  th=threading.Thread(target=background);th.start();time.sleep(.18)
  status,body,elapsed=req(port,'/manifest.webmanifest',timeout=1)
  check('Hung cover FFmpeg does not freeze HTTP server',status==200 and elapsed<.8)
  th.join(timeout=7)
  check('Failed cover request terminates and reports an error',bool(finish) and '500' in str(finish[0]))
  check('Original video untouched after failed cover',hashlib.sha256(f.read_bytes()).hexdigest()==before)
  check('Startup announces current stage',p.poll() is None)
  # Reproduce the user's exact sequence: screenshot freezes, user closes Node,
  # then launches the same library again. No test touches other directories.
  shot=[]
  def save_screenshot():
   try:shot.append(req(port,'/api/screenshot',{'key':key,'time':1},timeout=7))
   except Exception as e:shot.append(str(e))
  t=threading.Thread(target=save_screenshot);t.start();time.sleep(.16)
  check('Screenshot processing keeps HTTP responsive',req(port,'/manifest.webmanifest',timeout=1)[0]==200)
  stop(p);p=None;t.join(timeout=4)
  p,port=launch(lib,home,extra_env={'PATH':str(mock)+os.pathsep+os.environ['PATH']})
  check('Restart after interrupted screenshot',get_video(port).get('key')==key)
  check('Restart keeps original media intact',hashlib.sha256(f.read_bytes()).hexdigest()==before)
 finally:stop(p)
 # Long videos must not spawn frame-per-JPEG thumbnail factories.
 biglib=base/'课程';biglib.mkdir();big=biglib/'长课.mp4'
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i',
 'color=c=blue:s=96x96:r=30:d=90','-c:v','mpeg4','-q:v','15',str(big)],check=True,timeout=35)
 p=None
 try:
  p,port=launch(biglib,base/'bighome',flags=['--no-screenshot'])
  vid=get_video(port)
  frame=json.loads(req(port,'/api/frame-times',{'key':vid['key'],'duration':90},timeout=16)[1]);
  check('Long video retains frame timeline',frame.get('ok') and len(frame.get('times',[]))>2400)
  response=json.loads(req(port,'/api/frame-preview/start',{'key':vid['key']},timeout=16)[1]);
  check('Long video avoids bulk JPEG generation',response.get('ok') and '长视频' in response.get('error',''))
  check('Long-video HTTP remains responsive',req(port,'/manifest.webmanifest',timeout=1)[0]==200)
 finally:stop(p)
result={'passed':all(x['passed'] for x in checks),'total':len(checks),'checks':checks}
(ROOT/'dist'/'recovery-v626-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('RESULT',len(checks),'/',len(checks))
