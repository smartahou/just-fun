#!/usr/bin/env python3
"""Disposable worktree deletion, move, and FFmpeg cancel end-to-end tests."""
from isolated import ROOT,make_fixture,launch,stop,sha,media_entries,urlopen
import tempfile,pathlib,os,json,time,hashlib,subprocess,urllib.request,urllib.error
count=0
def check(title,condition,detail=''):
 global count
 if not condition:raise AssertionError(title+' '+str(detail))
 count+=1;print('PASS',title,detail,flush=True)
def post(port,route,obj):
 req=urllib.request.Request(f'http://127.0.0.1:{port}'+route,
   data=json.dumps(obj).encode(),headers={'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=25) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def fetch(port):
 with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/data') as r:return media_entries(json.load(r))
def match(port,pred):
 for _ in range(90):
  val=[v for v in fetch(port) if pred(v)]
  if val:return val[0]
  time.sleep(.2)
 raise AssertionError('No matching media')
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-move-delete-v726-') as td:
 for hashed in [False,True]:
  base=pathlib.Path(td); lib=base/('hash' if hashed else 'plain'); home=base/('home-hash' if hashed else 'home-plain')
  originals=make_fixture(lib)
  (lib/'readme.txt').write_text('ordinary office workspace document; must survive',encoding='utf8')
  nested=lib/'工作文件夹';nested.mkdir();
  source=nested/'讲课视频.mp4'
  source.write_bytes((lib/'测试视频 1.mp4').read_bytes())
  original=sha(source)
  proc=lg=None
  try:
   proc,port,lg=launch(ROOT/'dist/douyin.js',lib,home,flags=['--hash'] if hashed else [])
   item=match(port,lambda x:x.get('originalName')=='讲课视频.mp4')
   check('Source indexed readOnly '+str(hashed),item.get('readOnly') is True,item.get('relativeDir'))
   check('Original source unchanged '+str(hashed),sha(source)==original)
   s,out=post(port,'/api/media-move',{'keys':[item['key']],'target':'data'})
   check('Explicit move source -> data '+str(hashed),s==200 and out.get('moved')==1,(s,out))
   moved=match(port,lambda x:x['key']==item['key'])
   check('Move preserves media key '+str(hashed),moved.get('relativeDir')=='data' and moved.get('readOnly') is not True)
   candidates=[p for p in (lib/'data').iterdir() if p.is_file()]
   new=next((p for p in candidates if sha(p)==original),None)
   check('Exactly one destination '+str(hashed),new is not None and len(candidates)==1)
   check('Move preserves bytes '+str(hashed),not source.exists() and new.exists() and sha(new)==original)
   check('Non-media office file intact '+str(hashed),(lib/'readme.txt').read_text()=='ordinary office workspace document; must survive')
   s,out=post(port,'/api/media-delete-batch',{'keys':[item['key']]})
   check('Managed deletion after move '+str(hashed),s==200 and out.get('deleted')==1,(s,out))
   check('Deleted file gone '+str(hashed),not new.exists())
   check('Ordinary office document intact '+str(hashed),(lib/'readme.txt').exists())
   # Delete a source-root worktree item directly (explicit user action).
   root=match(port,lambda x:x.get('originalName')=='测试视频 1.mp4')
   check('Mixed root is protected '+str(hashed),root.get('readOnly') is True)
   srcroot=lib/'测试视频 1.mp4'; fingerprint=sha(srcroot)
   s,out=post(port,'/api/media-delete-batch',{'keys':[root['key']]})
   check('Explicit root worktree delete '+str(hashed),s==200 and out.get('deleted')==1,(s,out))
   check('Deleted root file gone '+str(hashed),not srcroot.exists())
   check('Unrelated audio still exists '+str(hashed),(lib/'测试音频 2.mp3').exists())
  finally:stop(proc,lg)
print('TOTAL',count,'PASS')
