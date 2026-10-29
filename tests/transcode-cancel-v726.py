#!/usr/bin/env python3
"""Live HTTP cancellation of an FFmpeg H264 conversion in disposable media library."""
from isolated import ROOT,launch,stop,sha,media_entries,make_fixture
import tempfile,pathlib,json,time,threading,urllib.request,urllib.error,subprocess,uuid
count=0
def check(name,value,details=''):
 global count
 if not value:raise AssertionError(name+': '+str(details))
 count+=1;print('PASS',name,flush=True)
def req(port,route,payload=None,timeout=40):
 url='http://127.0.0.1:'+str(port)+route
 req=urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None,
      headers={'Content-Type':'application/json'} if payload is not None else {},
      method='POST' if payload is not None else 'GET')
 try:
  with urllib.request.urlopen(req,timeout=timeout) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-transcode-cancel-v726-') as td:
 root=pathlib.Path(td);lib=root/'source';home=root/'home';make_fixture(lib)
 large=lib/'大视频.mkv'
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',
     'testsrc2=size=640x360:rate=25:duration=42','-c:v','mpeg4','-q:v','14',str(large)],check=True,timeout=40)
 digest=sha(large)
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,home)
  item=None
  for _ in range(100):
   st,data=req(port,'/api/data')
   item=next((x for x in media_entries(data) if x.get('originalName')=='大视频.mkv'),None)
   if item:break
   time.sleep(.2)
  check('Synthetic transcode source indexed',item is not None)
  token=uuid.uuid4().hex; result={}
  def task():
   try:result['value']=req(port,'/api/video-transcode',{'key':item['key'],'mode':'encode','jobId':token},timeout=90)
   except Exception as e:result['error']=str(e)
  thread=threading.Thread(target=task,daemon=True);thread.start()
  seen=False
  for i in range(200):
   status,progress=req(port,'/api/media-progress?id='+token,timeout=4)
   if status==200 and progress.get('status')=='running' and progress.get('cancellable'):
    seen=True;break
   if not thread.is_alive():break
   time.sleep(.1)
  check('HTTP exposes cancellable running job',seen)
  start=time.monotonic()
  code,cancel=req(port,'/api/media-progress/cancel',{'id':token})
  check('Cancel API accepts active job',code==200 and cancel['ok'],(code,cancel))
  thread.join(timeout=12)
  check('Cancel terminates awaiting HTTP POST',not thread.is_alive() and 'value' in result,result)
  code,done=result['value']
  check('Transcode returned cancelled error',code==400 and '用户已取消转码' in done.get('error',''),(code,done))
  check('Cancellation bounded',time.monotonic()-start<12)
  status,job=req(port,'/api/media-progress?id='+token)
  check('Cancelled terminal job status',status==200 and job['status']=='cancelled',(status,job))
  code,second=req(port,'/api/media-progress/cancel',{'id':token})
  check('Second cancel rejected',code==409)
  check('Original bytes unchanged',sha(large)==digest)
  check('No committed conversion',not any('兼容转码' in p.name for p in (lib/'data').rglob('*') if p.is_file()))
  check('No partial temp files',not list((lib/'.douyin-nav-cache').glob('.compat-*')))
 finally:stop(proc,log)
print('TOTAL',count,'PASS',flush=True)
