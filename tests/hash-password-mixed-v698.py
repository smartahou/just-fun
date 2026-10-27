#!/usr/bin/env python3
"""Opted-in Hash+password mixed media/reading folder, tested ONLY in temp fixture."""
import hashlib,json,pathlib,tempfile
from isolated import ROOT,launch,stop,urlopen
from security import fail_login
count=0
def ck(name,cond):
 global count
 assert cond,name
 count+=1
 print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-hash-pwd-mixed-') as d:
 root=pathlib.Path(d);library=root/'我的私人书架';library.mkdir()
 nested=library/'中文书籍';nested.mkdir()
 txt=nested/'我自己的读书资料.txt';txt.write_text('这是一份可以清空的私有阅读资料。',encoding='utf-8')
 pdf=library/'测试阅读.pdf';pdf.write_bytes(b'%PDF-1.4\n%%EOF\n')
 document=nested/'非媒体.docx';document.write_bytes(b'user-chosen disposable file')
 original={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (txt,pdf,document)}
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',library,root/'home',flags=('--hash','--pwd'),password='correct-pass')
  ck('Mixed library accepts explicit --hash --pwd',proc.poll() is None)
  ck('No unwanted Hash+password startup reminder', '提醒：当前为 Hash+密码模式' not in (root/'home/server.log').read_text(encoding='utf-8',errors='replace'))
  _,_,raw=urlopen(f'http://127.0.0.1:{port}/api/books?refresh=1')
  books=json.loads(raw)['books']
  ck('TXT and PDF both indexed as books',set(b['name'] for b in books)=={txt.name,pdf.name})
  ck('Book filenames physically hashed in Hash mode',all(len(b['managedName'])==32 and (library/(b['managedName'] if b['relativeDir']=='root' else b['relativeDir']+'/'+b['managedName'])).exists() for b in books))
  ck('Book contents preserved after Hash rename',{hashlib.sha256((library/(b['managedName'] if b['relativeDir']=='root' else b['relativeDir']+'/'+b['managedName'])).read_bytes()).hexdigest() for b in books}=={original[txt.name],original[pdf.name]})
  ck('Nonbook document unaffected by successful unlock',hashlib.sha256(document.read_bytes()).hexdigest()==original[document.name])
 finally:
  if proc:stop(proc,log)
 # A restart without CLI mode flags must still use persisted library settings.
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',library,root/'home-reopen',password='correct-pass')
  books=json.loads(urlopen(f'http://127.0.0.1:{port}/api/books?refresh=1')[2])['books']
  ck('Restart keeps book titles and hashed files',set(b['name'] for b in books)=={txt.name,pdf.name})
 finally:
  if proc:stop(proc,log)
 code,msg=fail_login(ROOT/'dist/douyin.js',library,root/'home-wrong')
 ck('Three failed attempts still fail authentication',code!=0 and '密码错误'.encode() in msg.encode())
 ck('Three failed attempts erase opted-in mixed library files',not library.exists() or not any(library.rglob('*')))
print('RESULT',count,'/',count)
