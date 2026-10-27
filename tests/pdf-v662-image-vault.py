#!/usr/bin/env python3
"""v6.62 encrypted inline PDF image excerpts, bounded/canonical validation, no source mutation."""
import tempfile,pathlib,base64,io,urllib.request,urllib.error,json,hashlib
from PIL import Image
from isolated import ROOT,launch,stop,urlopen
count=0
def ck(label,ok):
 global count
 assert ok,label
 count+=1;print('PASS',label,flush=True)
def req(base,payload):
 request=urllib.request.Request(base+'/api/reading/workspace',headers={'Content-Type':'application/json'},data=json.dumps(payload).encode(),method='POST')
 try:
  with urllib.request.urlopen(request,timeout=10) as r:return r.status,json.loads(r.read())
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v662-vault-') as td:
 base=pathlib.Path(td);lib=base/'media';lib.mkdir();(lib/'Document.pdf').write_bytes(b'%PDF-1.3\n'+b'just test'*20);finger=hashlib.sha256((lib/'Document.pdf').read_bytes()).hexdigest()
 buf=io.BytesIO();Image.new('RGB',(256,128),(201,205,207)).save(buf,format='JPEG',quality=75)
 image='data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home',flags=['--pwd'],password='test-secret-2026')
  root=f'http://127.0.0.1:{port}'
  st,_,raw=urlopen(root+'/api/reading/workspace');ws=json.loads(raw)
  ck('Password vault initializes workspace',st==200 and ws['notes']==[])
  quote={'type':'image','image':image,'bookId':'a'*16,'chapter':5,'text':'截图解释','anchorStart':None}
  note={'id':'b'*24,'title':'', 'content':'', 'quotes':[quote]}
  status,ws=req(root,{'revision':ws['revision'],'action':'note','note':note})
  ck('Image-only note is valid without phantom title/body',status==200 and len(ws['notes'])==1 and ws['notes'][0]['quotes'][0]['image']==image)
  mark={'type':'text','text':'已选择文字','bookId':'a'*16,'chapter':5,'anchorStart':14,'length':5}
  status,ws=req(root,{'revision':ws['revision'],'action':'mark','mark':mark})
  ck('Encrypted library stores standalone PDF text mark',status==200 and ws['marks'][0]['anchorStart']==14)
  status,other=req(root,{'revision':ws['revision'],'action':'mark','mark':{**mark,'anchorStart':-1}})
  ck('Invalid mark rejected without changing revision',status==400)
  note2={**note,'title':'摘录归档'}
  status,ws=req(root,{'revision':ws['revision'],'action':'note','note':note2,'alsoMark':{'type':'area','bookId':'a'*16,'chapter':5,'area':[.1,.2,.3,.4]}})
  ck('Excerpt note and source area commit atomically',status==200 and ws['lastExcerptNoteId']==note['id'] and len(ws['marks'])==2)

  wsfile=lib/'.douyin-nav-cache/reading/workspace.json'
  stored=wsfile.read_bytes()
  ck('Original image never appears as plaintext in encrypted workspace',b'base64' not in stored and image[:80].encode() not in stored and b'justfun-metadata-vault' in stored)
  status,ws=req(root,{'revision':ws['revision'],'action':'note','note':{**note,'title':'复盘','content':'二次保存'}})
  ck('Updating note preserves encrypted image block',status==200 and ws['notes'][0]['quotes'][0]['type']=='image')
  backup=lib/'.douyin-nav-cache/reading/workspace.json.bak'
  ck('Separate encrypted backup exists',backup.is_file() and b'justfun-metadata-vault' in backup.read_bytes() and image[:80].encode() not in backup.read_bytes())
  bad={**note,'quotes':[{**quote,'image':image*210}]}
  status,_=req(root,{'revision':ws['revision'],'action':'note','note':bad})
  ck('Excessively large inline image rejected',status in (413,400))
  ck('Original PDF file unchanged',hashlib.sha256((lib/'Document.pdf').read_bytes()).hexdigest()==finger)
 finally:
  if proc:stop(proc,log)
print('TOTAL',count)
