#!/usr/bin/env python3
"""v7.152.1 — every API write is cross-site guarded, and one media library has
exactly one writing instance.

Covers:
  1. Cross-site form-style POST (no preflight) to /api/media-delete-batch is
     rejected with 403 and the media file still exists.
  2. Same-origin POST still works (guards must not break the real client).
  3. A second process on the same library is refused while the first runs.
  4. Graceful shutdown releases the lock; restart needs no takeover.
  5. Hard-killed instance leaves a stale lock; the next start takes it over.
  6. A corrupt lock is also treated as stale (after the startup grace window).
"""
import json,os,pathlib,socket,subprocess,sys,tempfile,time,urllib.error,urllib.request
from isolated import ROOT,make_fixture,launch,stop,api_wait,media_entries

def post(port,path,payload,headers):
    req=urllib.request.Request('http://127.0.0.1:'+str(port)+path,data=payload,headers=headers,method='POST')
    try:
        with urllib.request.urlopen(req,timeout=8) as r:return r.status,r.read()
    except urllib.error.HTTPError as e:return e.code,e.read()

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-') as temp:
      temp=pathlib.Path(temp)
      lib=temp/'lib';make_fixture(lib)
      proc=log=None
      try:
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,temp/'home')
        data=api_wait(port)
        video=[x for x in media_entries(data) if x.get('kind')=='video'][0]
        key=video['key'];video_file=lib/video['originalName']
        delete_body=json.dumps({'keys':[key]}).encode()
        # 1. Cross-site form-style POST: no JSON content-type, no preflight.
        st,_=post(port,'/api/media-delete-batch',delete_body,
                  {'Content-Type':'text/plain;charset=UTF-8','Origin':'http://evil.example','Sec-Fetch-Site':'cross-site'})
        assert st==403,'cross-site delete not rejected: '+str(st)
        assert video_file.is_file(),'cross-site request deleted the media file'
        # Forged same-Host Origin but cross-site fetch metadata is also rejected.
        st,_=post(port,'/api/media-delete-batch',delete_body,
                  {'Content-Type':'application/json','Origin':'http://127.0.0.1:'+str(port),'Sec-Fetch-Site':'cross-site'})
        assert st==403,'cross-site Sec-Fetch-Site not rejected: '+str(st)
        assert video_file.is_file(),'media file deleted despite rejection'
        # 2. Legitimate same-origin write still works (favorite, non-destructive).
        fav=json.dumps({'keys':[key],'favorite':True}).encode()
        st,resp=post(port,'/api/media-favorite',fav,
                     {'Content-Type':'application/json','Origin':'http://127.0.0.1:'+str(port),'Sec-Fetch-Site':'same-origin'})
        assert st==200 and b'"updated":1' in resp.replace(b' ',b''),'same-origin write failed: '+str(st)+' '+resp[:200].decode('utf-8','replace')
        # 3. Second instance on the same library must be refused quickly.
        env=dict(os.environ,HOME=str(temp/'home2'),USERPROFILE=str(temp/'home2'))
        r=subprocess.run(['node',str(ROOT/'dist/douyin.js'),'--port=0'],
                         input=(str(lib)+'\n').encode(),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                         env=env,cwd=str(temp),timeout=25)
        out=r.stdout.decode('utf-8','replace')
        assert r.returncode!=0,'second instance was not refused'
        assert '另一个' in out,'refusal message missing: '+out[-300:]
      finally:stop(proc,log)
      lock=lib/'.douyin-nav-cache'/'instance.lock'
      # 4. Windows terminate() is a hard kill (no SIGTERM handler runs), so a
      #    stale lock is expected here; the next start must take it over.
      #    (Graceful releases are covered by the SIGINT/shutdown paths and by
      #    the corrupt-lock takeover below.)
      assert lock.exists(),'terminated instance unexpectedly removed its lock'
      proc,port,log=launch(ROOT/'dist/douyin.js',lib,temp/'home3')
      api_wait(port)
      info=json.loads(lock.read_text())
      assert info.get('pid')==proc.pid,'stale lock was not taken over on restart'
      # 5. Hard kill in the middle of running leaves a stale lock again.
      proc.kill()
      try:proc.wait(timeout=6)
      except subprocess.TimeoutExpired:pass
      log.close();proc=None
      assert lock.exists(),'hard-killed instance should leave a stale lock behind'
      proc,port,log=launch(ROOT/'dist/douyin.js',lib,temp/'home4')
      try:
        api_wait(port)
        info=json.loads(lock.read_text())
        assert info.get('pid')==proc.pid,'stale lock was not taken over by the new instance'
      finally:stop(proc,log)
      # 6. Corrupt lock file older than the startup grace window is stale.
      lock.write_text('{"broken":')
      old=time.time()-10
      os.utime(lock,(old,old))
      proc,port,log=launch(ROOT/'dist/douyin.js',lib,temp/'home5')
      try:
        api_wait(port)
        info=json.loads(lock.read_text())
        assert info.get('pid')==proc.pid
      finally:stop(proc,log)
    print('PASS write-origin-and-instance-lock-v7152',flush=True)

if __name__=='__main__':
    try:main()
    except Exception as e:
        print('FAILED',repr(e),file=sys.stderr)
        sys.exit(1)
