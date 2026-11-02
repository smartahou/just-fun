#!/usr/bin/env python3
"""Real deletion/move regression for one library-wide Hash policy, no work mode."""
from isolated import ROOT,make_fixture,launch,stop,sha,media_entries
import tempfile,pathlib,json,time,re,urllib.request,urllib.error
count=0
HEX=re.compile(r'^[a-f0-9]{32}$')
def check(title,cond,detail=''):
 global count
 if not cond:raise AssertionError(title+' '+str(detail))
 count+=1;print('PASS',title,flush=True)
def post(port,route,obj):
 req=urllib.request.Request(f'http://127.0.0.1:{port}'+route,
     data=json.dumps(obj).encode(),method='POST',headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=25) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def media(port):
 with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/data') as r:return media_entries(json.load(r))
def match(port,predicate):
 for _ in range(100):
  found=[m for m in media(port) if predicate(m)]
  if found:return found[0]
  time.sleep(.2)
 raise AssertionError('Missing media')
def indexed(lib,key):
 obj=json.loads((lib/'.douyin-nav-cache/data.json').read_text())
 return next(x for x in obj['items'] if x['key']==key)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-move-delete-v726-') as td:
 for hashed in (False,True):
  base=pathlib.Path(td);lib=base/('hash' if hashed else 'plain');home=base/('home-hash' if hashed else 'home-plain')
  original_files=make_fixture(lib)
  note=lib/'office.docx';note.write_bytes(b'KEEP OFFICE DOCUMENT')
  nested=lib/'普通子文件夹';nested.mkdir();src=nested/'讲课视频.mp4'
  src.write_bytes((lib/'测试视频 1.mp4').read_bytes());source_sha=sha(src)
  proc=log=None
  try:
   proc,port,log=launch(ROOT/'dist/douyin.js',lib,home,flags=['--hash'] if hashed else [])
   item=match(port,lambda x:x.get('originalName')=='讲课视频.mp4')
   for _ in range(100):
    ix=indexed(lib,item['key']);source_path=nested/ix['managedName']
    if source_path.exists() and (not hashed or HEX.fullmatch(ix['managedName'])):break
    time.sleep(.15)
   check('Nested file is a managed asset '+str(hashed),item.get('readOnly') is not True)
   check('Nested file observes Hash policy '+str(hashed),bool(HEX.fullmatch(source_path.name))==hashed)
   check('Nested bytes unchanged '+str(hashed),source_path.exists() and sha(source_path)==source_sha)
   status,reply=post(port,'/api/media-move',{'keys':[item['key']],'target':'data'})
   check('Nested media moves into data '+str(hashed),status==200 and reply.get('moved')==1,(status,reply))
   after=match(port,lambda x:x.get('key')==item['key'])
   check('Move preserves key '+str(hashed),after.get('relativeDir')=='data')
   output=next((x for x in (lib/'data').iterdir() if x.is_file() and sha(x)==source_sha),None)
   check('Move preserves bytes without duplicates '+str(hashed),output is not None and not source_path.exists())
   check('Document unaffected by move '+str(hashed),note.read_bytes()==b'KEEP OFFICE DOCUMENT')
   status,reply=post(port,'/api/media-delete-batch',{'keys':[item['key']]})
   check('Explicit deletion of moved media '+str(hashed),status==200 and reply.get('deleted')==1,(status,reply))
   check('Deleted media physically removed '+str(hashed),not output.exists())
   check('Document unaffected by deletion '+str(hashed),note.read_bytes()==b'KEEP OFFICE DOCUMENT')
   root=match(port,lambda x:x.get('originalName')=='测试视频 1.mp4')
   for _ in range(100):
    root_idx=indexed(lib,root['key']);root_path=lib/root_idx['managedName']
    if root_path.exists() and (not hashed or HEX.fullmatch(root_idx['managedName'])):break
    time.sleep(.15)
   check('Root file follows same policy '+str(hashed),root.get('readOnly') is not True and bool(HEX.fullmatch(root_path.name))==hashed)
   status,reply=post(port,'/api/media-delete-batch',{'keys':[root['key']]})
   check('Root deletion allowed '+str(hashed),status==200 and reply.get('deleted')==1)
   check('Root file removed '+str(hashed),not root_path.exists())
   audio=match(port,lambda x:x.get('originalName')=='测试音频 2.mp3')
   audio_record=indexed(lib,audio['key'])
   audio_path=lib/audio_record['managedName']
   check('Unrelated audio survives '+str(hashed),audio_path.exists() and sha(audio_path)==original_files['测试音频 2.mp3'])
  finally:stop(proc,log)
print('TOTAL',count,'PASS',flush=True)
