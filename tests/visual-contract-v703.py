#!/usr/bin/env python3
"""Baseline browser viewport and geometry for reading/notes. Only temp books."""
import hashlib,os,pathlib,tempfile,urllib.request,urllib.error,urllib.parse
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen

checks=0
def ck(label,condition):
 global checks
 if not condition:raise AssertionError(label)
 checks+=1;print('PASS',label,flush=True)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-visual-') as d:
 tmp=pathlib.Path(d);lib=tmp/'books';lib.mkdir();book=lib/'视觉基线.txt'
 book.write_text(('　　这是一段用于排版合同测试的示范内容，保留合适边距和布局宽度。'*12+'\n')*14,encoding='utf8')
 initial=hashlib.sha256(book.read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home')
  origin=f'http://127.0.0.1:{port}'
  out=ROOT/'dist'/'release-gate-v703'/'visual'
  out.mkdir(parents=True,exist_ok=True)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   for width,height in [(1440,900),(390,844)]:
    page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def proxy(route):
     req=route.request;u=urllib.parse.urlsplit(req.url)
     body=req.post_data_buffer if req.method=='POST' else None
     headers={'Content-Type':'application/json'} if body else {}
     r=urllib.request.Request(origin+u.path+('?' +u.query if u.query else ''),data=body,method=req.method,headers=headers)
     try:
      with urllib.request.urlopen(r,timeout=30) as response:status=response.status;data=response.read();mime=response.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:status=e.code;data=e.read();mime=e.headers.get('Content-Type','application/json')
     route.fulfill(status=status,body=data,headers={'Content-Type':mime})
    page.route('http://justfun.test/**',proxy)
    html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
    page.set_content(html,wait_until='domcontentloaded',timeout=30000)
    page.locator('#studioRailToggle').click()
    page.locator('[data-media-kind=notes]').click()
    page.locator('#jfDeskNewNote').click()
    page.locator('#jfDeskNoteTitle').fill('视觉基线')
    page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='视觉基线')",timeout=15000)
    dim=page.evaluate('''()=>{const title=document.getElementById('jfDeskNoteTitle').getBoundingClientRect(), notes=document.getElementById('jfDeskNotes').getBoundingClientRect(), editor=document.getElementById('jfDeskEditor').getBoundingClientRect(), body=document.getElementById('jfDeskExcerpt').getBoundingClientRect();return {notesW:notes.width,editorW:editor.width,bodyW:body.width,titleW:title.width,bodyLeft:body.left,notesLeft:notes.left,viewport:innerWidth};}''')
    ck(f'{width}px note input has positive width',dim['titleW']>70)
    ck(f'{width}px note body has positive width',dim['bodyW']>90)
    ck(f'{width}px note surface within viewport',dim['notesLeft']>=-5 and dim['notesLeft']+dim['notesW']<=width+25)
    ck(f'{width}px no runtime exception',not errors)
    page.screenshot(path=str(out/f'notes-{width}.png'))
    page.close()
   browser.close()
  ck('Real book bytes untouched',hashlib.sha256(book.read_bytes()).hexdigest()==initial)
 finally:
  if proc:stop(proc,log)
print('VISUAL CONTRACT',checks,'PASS',flush=True)
