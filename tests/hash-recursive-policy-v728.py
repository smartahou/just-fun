#!/usr/bin/env python3
"""Every directory inherits one library-wide Hash policy, including legacy records."""
import hashlib,json,pathlib,re,subprocess,tempfile,time
from isolated import ROOT,launch,stop,urlopen

SHA=re.compile(r'^[a-f0-9]{32}$')
checks=0

def test(name,predicate):
 global checks
 assert predicate,name
 checks+=1
 print('PASS',name,flush=True)

def video(path):
 subprocess.run(['ffmpeg','-loglevel','error','-y','-f','lavfi','-i',
                 'color=s=48x48:r=2:d=1','-c:v','mpeg4',str(path)],
                check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def data(port):
 return json.loads(urlopen(f'http://127.0.0.1:{port}/api/data')[2])

def start(lib,home,flags=(),pwd=None):
 p,port,log=launch(ROOT/'dist/douyin.js',lib,home,flags=flags,password=pwd)
 for i in range(90):
  d=data(port)
  if d.get('scanStatus')=='ready':return p,port,log,d
  time.sleep(.2)
 stop(p,log)
 raise AssertionError('startup scan timeout')

def items(d):return {x['originalName']:x for x in d['items']}

def hashed_file(directory):return [x for x in directory.iterdir() if x.is_file() and SHA.fullmatch(x.name)]

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-recursive-hash-v728-') as td:
 root=pathlib.Path(td)
 # 1: Hash mode: all media in root and deep nested directories use the same policy.
 lib=root/'hash-lib';deep=lib/'学习'/'电影'/'短视频';deep.mkdir(parents=True)
 note=deep/'课件.docx';note.write_bytes(b'private work stays untouched')
 org_root=lib/'new-root.mp4';org_deep=deep/'深层新视频.mp4'
 video(org_root);video(org_deep)
 root_sha=digest(org_root);deep_sha=digest(org_deep)
 p,port,log,d=start(lib,root/'home-hash',('--hash',))
 try:
  i=items(d)
  test('Opted-in Hash setting',json.loads((lib/'.douyin-nav-cache/library-settings.json').read_text())['hashEnabled'])
  test('Root video is anonymized',not org_root.exists() and len(hashed_file(lib))==1)
  test('Deep nested video is also anonymized',not org_deep.exists() and len(hashed_file(deep))==1)
  test('Root video SHA conserved',digest(hashed_file(lib)[0])==root_sha)
  test('Nested video SHA conserved',digest(hashed_file(deep)[0])==deep_sha)
  test('Nested media name and hierarchy preserved in catalog',i['深层新视频.mp4']['relativeDir']=='source/学习/电影/短视频')
  test('Nested media is managed rather than read-only',i['深层新视频.mp4'].get('readOnly') is not True)
  test('Unrelated document left untouched',note.read_bytes()==b'private work stays untouched')
  test('No duplicate indexed video',sum(x['originalName']=='深层新视频.mp4' for x in d['items'])==1)
  test('Root video is indexed once',sum(x['originalName']=='new-root.mp4' for x in d['items'])==1)
  # Live rescan/watcher handles new media in a nested directory as well as root.
  live=deep/'随后加入.mp4';video(live);live_sha=digest(live)
  for _ in range(90):
   fresh=data(port)
   if any(x['originalName']=='随后加入.mp4' for x in fresh['items']) and not live.exists():break
   time.sleep(.2)
  test('Live nested import uses Hash',not live.exists() and any(digest(x)==live_sha for x in hashed_file(deep)))
  test('Live nested import catalog has original name',any(x['originalName']=='随后加入.mp4' for x in fresh['items']))
 finally:stop(p,log)

 # 2: Persisted legacy original-name entries must be adopted, not ignored.
 old=lib/'old-root.mp4';old_nested=deep/'过去视频.mp4';video(old);video(old_nested)
 stat=old.stat();stat2=old_nested.stat()
 cache=lib/'.douyin-nav-cache';record=json.loads((cache/'data.json').read_text())
 def legacy(path,relative,stat,marker):
  name=path.name
  return {'key':hashlib.sha1((marker+name).encode()).hexdigest()[:16],
    'relativeDir':relative,'managedName':name,'originalName':name,'originalExt':'.mp4',
    'readOnly':True,'kind':'video','state':'ready','title':'用户原有标题',
    'displayName':'自定义名称','favorite':True,'rating':5,
    'fingerprint':f'{stat.st_size}-{int(stat.st_mtime_ns/1000000)}',
    'size':stat.st_size,'modifiedTimeMs':stat.st_mtime_ns/1000000}
 entry1=legacy(old,'',stat,'root/')
 entry2=legacy(old_nested,'source/学习/电影/短视频',stat2,'source/source/学习/电影/短视频/')
 record['items'] += [entry1,entry2]
 cache.joinpath('data.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
 p,port,log,d=start(lib,root/'home-repair')
 try:
  for _ in range(100):
   d=data(port)
   indexed={x['originalName']:x for x in json.loads((cache/'data.json').read_text())['items']}
   if all(SHA.fullmatch(indexed[n]['managedName']) for n in ['old-root.mp4','过去视频.mp4']):break
   time.sleep(.2)
  ii=items(d)
  for name,orig,path0 in [('old-root.mp4',entry1,old),('过去视频.mp4',entry2,old_nested)]:
   cur=ii[name]
   test('Legacy media '+name+' physically Hash',not path0.exists() and SHA.fullmatch(indexed[name]['managedName']) is not None)
   test('Legacy media '+name+' key preserved',cur['key']==orig['key'])
   test('Legacy media '+name+' user metadata preserved',cur.get('displayName')=='自定义名称' and cur['favorite'] and cur['rating']==5)
   test('Legacy media '+name+' managed, not readOnly',cur.get('readOnly') is not True)
  test('Legacy source folder document preserved',note.read_bytes()==b'private work stays untouched')
  test('No duplicate legacy index',sum(x['originalName']=='过去视频.mp4' for x in d['items'])==1)
 finally:stop(p,log)

 # 3: Unchecked Hash setting means *every* folder keeps names, including nested.
 plain=root/'plain-lib';sub=plain/'普通子目录';sub.mkdir(parents=True)
 one=plain/'normal.mp4';two=sub/'也普通.mp4';video(one);video(two)
 p,port,log,d=start(plain,root/'home-plain')
 try:
  test('No-Hash root name retained',one.exists())
  test('No-Hash nested name retained',two.exists())
  test('No-Hash no anonymous names anywhere',not hashed_file(plain) and not hashed_file(sub))
  test('No-Hash nested file is managed',items(d)['也普通.mp4'].get('readOnly') is not True)
 finally:stop(p,log)

 # 4: Interrupted write-ahead migration journal recovers destination on restart.
 pending=root/'pending-lib';d0=pending/'inner';d0.mkdir(parents=True)
 origin=d0/'crash.mp4';video(origin);st=origin.stat()
 p,port,log,d=start(pending,root/'pending-home',('--hash',))
 finally_p=p;stop(p,log)
 # The initial import hashed 'crash.mp4': introduce a separate simulated older
 # source path and a pending journal with an originalName different from the
 # physical name. This tests pendingOriginalName recovery specifically.
 original=d0/'legacy-physical.mp4';video(original)
 record=json.loads((pending/'.douyin-nav-cache/data.json').read_text())
 target='a'*32
 record['items'].append({'key':'f'*16,'relativeDir':'source/inner',
   'managedName':target,'originalName':'friendly-name.mp4','pendingOriginalName':'legacy-physical.mp4',
   'originalExt':'.mp4','kind':'video','readOnly':True,'state':'pending'})
 (pending/'.douyin-nav-cache/data.json').write_text(json.dumps(record),encoding='utf8')
 p,port,log,d=start(pending,root/'pending-restart')
 try:
  rec=next(x for x in json.loads((pending/'.douyin-nav-cache/data.json').read_text())['items'] if x['key']=='f'*16)
  test('Crash journal recovers physical rename',not original.exists() and (d0/target).exists())
  test('Crash journal restores ready state and metadata',rec['state']=='ready' and rec['originalName']=='friendly-name.mp4')
  test('Crash journal drops stale pending helper','pendingOriginalName' not in rec)
  test('Crash journal clears legacy readOnly',rec.get('readOnly') is not True)
 finally:stop(p,log)


 # 4b: Encrypted media library applies the same Hash policy in child folders.
 encrypted=root/'encrypted';child=encrypted/'子目录';child.mkdir(parents=True)
 encrypted_video=child/'private.mp4';video(encrypted_video);encrypted_sha=digest(encrypted_video)
 p,port,log,d=start(encrypted,root/'encrypted-home',('--hash','--pwd'),'test-password')
 try:
  check_video=next((x for x in d['items'] if x['originalName']=='private.mp4'),None)
  test('Encrypted child video keeps original display name',check_video is not None)
  test('Encrypted child video Hashes physically',not encrypted_video.exists() and len(hashed_file(child))==1)
  test('Encrypted child video bytes retained',digest(hashed_file(child)[0])==encrypted_sha)
 finally:stop(p,log)
 p,port,log,d=start(encrypted,root/'encrypted-home-reopen',pwd='test-password')
 try:
  test('Encrypted child video survives relaunch',any(x['originalName']=='private.mp4' for x in d['items']))
 finally:stop(p,log)

 # 5: A hashed media file in an ordinary subfolder remains fully manageable.
 import urllib.request, urllib.error
 def post(port,url,payload):
  req=urllib.request.Request(f'http://127.0.0.1:{port}{url}',
      data=json.dumps(payload).encode('utf8'),method='POST',
      headers={'Content-Type':'application/json'})
  try:
   with urllib.request.urlopen(req,timeout=12) as res:
    return res.status,json.loads(res.read())
  except urllib.error.HTTPError as e:
   return e.code,json.loads(e.read())
 ops=root/'ops';nested=ops/'any-subfolder';nested.mkdir(parents=True)
 document=nested/'合同.docx';document.write_bytes(b'do-not-touch')
 movie=nested/'editable.mp4';video(movie);movie_sha=digest(movie)
 p,port,log,d=start(ops,root/'ops-home',('--hash',))
 try:
  rec=items(d)['editable.mp4'];key=rec['key']
  physical=next(x for x in nested.iterdir() if SHA.fullmatch(x.name))
  status,result=post(port,'/api/media-rename',{'key':key,'name':'已重命名的标题'})
  test('Hash nested media display rename succeeds',status==200 and result.get('ok') is True)
  test('Display rename never changes physical Hash bytes',physical.exists() and digest(physical)==movie_sha)
  status,result=post(port,'/api/media-move',{'keys':[key],'target':'data'})
  test('Hash nested media moves to managed data folder',status==200 and result.get('moved')==1)
  now=next((ops/'data').iterdir())
  test('Moving hashed nested media retains checksum and anonymous name',now.name==physical.name and digest(now)==movie_sha and not physical.exists())
  test('Moving hashed media does not touch neighboring documents',document.read_bytes()==b'do-not-touch')
  status,result=post(port,'/api/media-move',{'keys':[key],'target':'source/any-subfolder'})
  test('Managed media can return to an existing subfolder',status==200 and result.get('moved')==1)
  test('Move back preserves Hash bytes', (nested/physical.name).exists() and digest(nested/physical.name)==movie_sha)
  status,result=post(port,'/api/media-move',{'keys':[key],'target':'data'})
  test('Can move again without changing media identity',status==200 and result.get('moved')==1 and now.exists())
  status,result=post(port,'/api/media-delete-batch',{'keys':[key]})
  test('Explicit delete of formerly nested hashed media succeeds',status==200 and result.get('deleted')==1)
  test('No remaining moved media; document still intact',not now.exists() and document.read_bytes()==b'do-not-touch')
 finally:stop(p,log)

print('TOTAL',checks,'PASS',flush=True)
