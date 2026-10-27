#!/usr/bin/env python3
"""Real PDF.js v6.61 reader integration (actual same-origin Worker/Canvas/TextLayer); isolated fixture."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,json
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
import fitz
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-real-pdf-v661-') as td:
 base=pathlib.Path(td);lib=base/'books';lib.mkdir();pdf=fitz.open()
 for i in range(30):
  pg=pdf.new_page(width=500,height=700);pg.insert_text((40,90),'JUST FUN PAGE '+str(i+1),fontsize=18)
 pdf.save(lib/'Book.pdf');pdf.close();fingerprint=hashlib.sha256((lib/'Book.pdf').read_bytes()).hexdigest()
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage']);page=browser.new_page(viewport={'width':1280,'height':840});errors=[];logs=[]
   page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda msg:logs.append(msg.text) if msg.type=='error' else None)
   def proxy(route):
    rq=route.request;u=urllib.parse.urlsplit(rq.url);path=u.path or '/'
    req=urllib.request.Request(root+path+('?' +u.query if u.query else ''),data=rq.post_data.encode() if rq.method=='POST' else None,method=rq.method,headers={'Content-Type':'application/json'} if rq.method=='POST' else {})
    try:
     with urllib.request.urlopen(req,timeout=35) as res:status=res.status;body=res.read();ct=res.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e:status=e.code;body=e.read();ct=e.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=status,body=body,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   # Sandbox blocks direct local navigation; use the established HTML+API proxy route.
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=14000)
   page.wait_for_timeout(500)
   page.locator('#studioRailToggle').click()
   page.locator('[data-media-kind=books]').click()
   page.locator('.jfBookTile').first.click()
   try:page.wait_for_function('document.querySelector(".jfPdfVirtualPage canvas") !== null',timeout=12000)
   except Exception as e:
    print('UI DIAGNOSTIC',page.evaluate('''()=>({error:document.getElementById('jfReadError').innerText,format:document.getElementById('jfReadFormat').innerText,book:jfDeskBook?.id,window:jfPdfJsState.windowStart,loading:document.getElementById('jfPdfPageStatus').innerText,html:document.querySelector('#jfPdfJsSheet').innerHTML.slice(0,600)})'''),errors,logs,flush=True)
    raise
   values=page.evaluate('''()=>({count:document.querySelectorAll('.jfPdfVirtualPage').length,canvases:document.querySelectorAll('.jfPdfVirtualPage canvas').length,text:document.querySelector('.jfPdfVirtualPage .jfPdfTextLayer')?.textContent,workerSrc:jfPdfJsState.module?'loaded':'missing',mode:document.getElementById('jfReadPdf').hidden,error:document.getElementById('jfReadError').textContent})''')
   print('READER',values,flush=True);assert values['count']==10 and values['canvases']>=1 and values['mode'] and 'JUST FUN PAGE' in values['text'],values
   page.evaluate('jfPdfJsPage(28)');page.wait_for_function('Array.from(document.querySelectorAll(".jfPdfVirtualPage")).some(x=>x.dataset.pdfIndex==="28"&&x.querySelector("canvas"))',timeout=20000)
   page.locator('#jfPdfNight').click();assert page.locator('.jfPdfPageNight').count()==10
   page.screenshot(path='/mnt/data/jf_v661/pdf-reader-v661.png')
   # Move the actual scroll container repeatedly; only a window of ten pages may remain.
   for _ in range(4):
    page.evaluate('jfReadCenter.scrollTop=jfReadCenter.scrollHeight')
    page.wait_for_timeout(800)
   print('SCROLL',page.evaluate('''()=>({start:jfPdfJsState.windowStart,count:document.querySelectorAll('.jfPdfVirtualPage').length,chapter:jfDeskChapter,scroll:jfReadCenter.scrollTop})'''),flush=True)
   page.locator('#jfReadBack').click();assert page.locator('#jfReader').is_hidden()
   assert not errors,errors
   assert hashlib.sha256((lib/'Book.pdf').read_bytes()).hexdigest()==fingerprint
   page.screenshot(path='/mnt/data/jf_v661/pdf-real-v661.png',full_page=True)
   browser.close()
 finally:
  if proc:stop(proc,lg)
print('PASS actual pdf rendering and scroll UI')
