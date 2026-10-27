#!/usr/bin/env python3
import tempfile,pathlib,hashlib,zipfile,json,urllib.parse,urllib.request,urllib.error
from isolated import ROOT,launch,stop,urlopen
n=0
def ck(name,ok):
 global n
 assert ok,name;n+=1;print('PASS',name,flush=True)
def get(base,path):return urlopen(base+path)[0],json.loads(urlopen(base+path)[2])
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v697-') as d:
 base=pathlib.Path(d);lib=base/'media';lib.mkdir();epub=lib/'优秀的中文书籍.epub';pdf=lib/'PDF测试.pdf'
 with zipfile.ZipFile(epub,'w') as z:
  z.writestr('META-INF/container.xml','''<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>''')
  z.writestr('OEBPS/content.opf','''<package><manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>''')
  z.writestr('OEBPS/chapter1.xhtml','<html><body><p>苍山如海，残阳如血</p></body></html>')
 pdf.write_bytes(b'%PDF-1.4\nfake-placeholder\n%%EOF')
 original={x.name:hashlib.sha256(x.read_bytes()).hexdigest() for x in [epub,pdf]}
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home',flags=('--hash',));url=f'http://127.0.0.1:{port}'
  _,res=get(url,'/api/books?refresh=1')
  ck('Hash library lists EPUB and PDF',res['ok'] and set(b['name'] for b in res['books'])==set(original))
  ck('Book names removed from filenames in hash mode',not any((lib/name).exists() for name in original))
  ck('Hashed book bytes preserved',set(hashlib.sha256((lib/b['managedName']).read_bytes()).hexdigest() for b in res['books'])==set(original.values()))
  e=next(b for b in res['books'] if b['ext']=='EPUB')
  _,outline=get(url,'/api/reading/outline?id='+e['id'])
  ck('Hashed EPUB correctly parsed',outline.get('ok') and outline['format']=='EPUB' and outline['chapters'])
  _,chapter=get(url,'/api/reading/chapter?id='+e['id']+'&chapter=0')
  ck('Hashed EPUB chapter readable',chapter.get('ok') and '苍山如海' in chapter.get('text',''))
  meta=lib/'.douyin-nav-cache/reading/book-names.json'
  ck('Hash name mapping persisted',meta.exists() and b'book-names' not in meta.read_bytes())
 finally:
  if proc:stop(proc,log)
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home',password=None);url=f'http://127.0.0.1:{port}'
  _,res2=get(url,'/api/books?refresh=1')
  ck('Hash library restart restores EPUB and PDF labels',set(b['name'] for b in res2['books'])==set(original))
 finally:
  if proc:stop(proc,log)
print('TOTAL',n)
