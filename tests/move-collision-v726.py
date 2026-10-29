#!/usr/bin/env python3
"""Target-collision guards for explicit source-to-managed moves. Disposable media only."""
from isolated import ROOT,make_fixture,launch,stop,sha,media_entries
import tempfile,pathlib,urllib.request,urllib.error,json,time,os
checks=0
def check(label,ok,extra=''):
 global checks
 if not ok:raise AssertionError(label+str(extra))
 checks+=1;print('PASS',label,flush=True)
def post(port,body):
 req=urllib.request.Request(f'http://127.0.0.1:{port}/api/media-move',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=15) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-move-collision-v726-') as td:
 t=pathlib.Path(td);lib=t/'media';make_fixture(lib);(lib/'readme.txt').write_text('ordinary file')
 src=lib/'教学';src.mkdir();data=lib/'data';data.mkdir()
 for name in ('冲突.mp4','悬空.mp4','普通.mp4'):(src/name).write_bytes((lib/'测试视频 1.mp4').read_bytes())
 victim=data/'冲突.mp4';victim.write_bytes(b'DO NOT OVERWRITE EXISTING FILE');victim_sha=sha(victim)
 dangling=data/'悬空.mp4';link_supported=True
 try:dangling.symlink_to(data/'missing_target.mp4')
 except (OSError,NotImplementedError):link_supported=False
 process=logger=None
 try:
  process,port,logger=launch(ROOT/'dist/douyin.js',lib,t/'home')
  catalog={}
  for _ in range(100):
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/data') as r:payload=json.load(r)
   catalog={x['originalName']:x for x in media_entries(payload)}
   if all(x in catalog for x in ('冲突.mp4','悬空.mp4','普通.mp4')):break
   time.sleep(.15)
  check('All source items scanned',all(x in catalog for x in ('冲突.mp4','悬空.mp4','普通.mp4')))
  original=sha(src/'冲突.mp4');keys=[catalog[x]['key'] for x in ('普通.mp4','冲突.mp4')]
  status,out=post(port,{'keys':keys,'target':'data'})
  check('Batch collision rejected',status==500 and out.get('ok') is False,(status,out))
  check('Preflight preserves all selected source files',all((src/x).exists() for x in ('普通.mp4','冲突.mp4')))
  check('Existing managed target unchanged',sha(victim)==victim_sha)
  check('Original content intact',sha(src/'冲突.mp4')==original)
  if link_supported:
   status,out=post(port,{'keys':[catalog['悬空.mp4']['key']],'target':'data'})
   check('Dangling symlink target rejected',status==500 and out.get('ok') is False,(status,out))
   check('Symlink untouched',dangling.is_symlink() and not dangling.exists())
   check('Source preserved after unsafe target', (src/'悬空.mp4').is_file())
  check('Unrelated office file intact',(lib/'readme.txt').read_text()=='ordinary file')
 finally:stop(process,logger)
print('TOTAL',checks,'PASS')
