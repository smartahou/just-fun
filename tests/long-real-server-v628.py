#!/usr/bin/env python3
"""Real Node/FFprobe HTTP endpoint test for a sparse synthetic 02:56:00 file.
It has only three video samples with stretched timestamps, so creates no large file.
No real user library is opened or modified.
"""
import hashlib,json,os,pathlib,socket,subprocess,tempfile,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
def check(name,value):
 assert value,name
 print('PASS',name,flush=True)
def freeport():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def request(port,pathname,body=None):
 req=urllib.request.Request(f'http://127.0.0.1:{port}'+pathname,
  data=json.dumps(body).encode() if body is not None else None,
  headers={'Content-Type':'application/json'} if body is not None else {})
 with urllib.request.urlopen(req,timeout=9) as resp:return json.loads(resp.read())
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-long-v628-') as td:
 base=pathlib.Path(td);media=base/'佛学讲座';media.mkdir()
 movie=media/'二小时五十六分钟.mp4'
 subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
   '-f','lavfi','-i','testsrc2=size=96x96:rate=30:duration=0.1',
   '-vf','setpts=PTS*158400','-fps_mode','vfr','-c:v','libx264','-preset','ultrafast',
   '-pix_fmt','yuv420p',str(movie)],check=True,timeout=20)
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(movie)]))
 duration=float(probe['format']['duration'])
 check('Sparse synthetic file declares approximately 2h56m duration',abs(duration-10560)<.2)
 before=hashlib.sha256(movie.read_bytes()).hexdigest()
 port=freeport();home=base/'isolated-home';home.mkdir();env=dict(os.environ,HOME=str(home),USERPROFILE=str(home))
 proc=subprocess.Popen(['node',str(ROOT/'dist/douyin.js'),'--port='+str(port),'--no-screenshot'],cwd=str(home),env=env,
  stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
 try:
  proc.stdin.write((str(media)+'\n').encode());proc.stdin.flush();proc.stdin.close()
  video=None
  for _ in range(90):
   if proc.poll() is not None:raise RuntimeError('Server exited unexpectedly')
   try:
    data=request(port,'/api/data');video=next((it for it in data.get('items',[]) if it.get('kind')=='video' and it.get('duration')),None)
    if video:break
   except Exception:pass
   time.sleep(.12)
  check('Actual Node scans sparse long movie',video is not None)
  frame=request(port,'/api/frame-times',{'key':video['key'],'duration':10560})
  check('Actual FFprobe endpoint covers more than 120000 frames',frame['ok'] and frame['count']>120000)
  check('Endpoint uses compact response, not full array',frame['compact'] and frame['times']==[])
  preview=request(port,'/api/frame-preview/start',{'key':video['key']})
  check('Long movie does not start giant thumbnail job',preview['ok'] and preview['total']==frame['count'] and '长视频已跳过' in preview['error'])
  check('Original video file unchanged',hashlib.sha256(movie.read_bytes()).hexdigest()==before)
 finally:
  proc.terminate()
  try:proc.wait(timeout=4)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
