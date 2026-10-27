#!/usr/bin/env python3
"""v6.56 isolated PDF rendering + cover + navigation + progressive repair."""
import sys,os,json,hashlib,tempfile,pathlib,urllib.parse,urllib.request
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from isolated import ROOT,launch,stop,urlopen
from playwright.sync_api import sync_playwright
import fitz
C=[]
def ck(label,value):
 assert value,label
 C.append(label);print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-pdf-') as tmp:
 basepath=pathlib.Path(tmp);lib=basepath/'媒体和书';lib.mkdir()
 pdf=fitz.open()
 for i in range(4):
  p=pdf.new_page(width=420,height=620);p.insert_text((50,115),f'Just Fun REAL PDF PAGE {i+1}',fontsize=18);p.draw_rect((40,150,350,340),color=(0,0.6,0.6),fill=(0.8,0.95,0.95))
 pdf.save(str(lib/'真实矢量书.pdf'));pdf.close()
 book=lib/'真实矢量书.pdf';digest=hashlib.sha256(book.read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,basepath/'home');base=f'http://127.0.0.1:{port}'
  _,_,out=urlopen(base+'/api/books?refresh=1');bookid=json.loads(out)['books'][0]['id']
  status,_,out=urlopen(base+'/api/books/cover?id='+bookid,timeout=25)
  ck('actual vector PDF page 1 cover rendered',status==200 and out.startswith(b'\x89PNG\r\n\x1a\n') and len(out)>2000)
  status,_,out=urlopen(base+'/api/reading/pdf-info?id='+bookid,timeout=25);info=json.loads(out)
  ck('PDF native info exposes actual page count',status==200 and info['pages']==4)
  images=[]
  for n in (1,4):
   status,head,out=urlopen(base+f'/api/reading/pdf-page?id={bookid}&page={n}&width=670',timeout=25)
   ck(f'PDF real page {n} rendered by own route',status==200 and head.get('Content-Type')=='image/png' and out[:8]==b'\x89PNG\r\n\x1a\n')
   images.append(out)
  ck('PDF page data is different across pages',images[0]!=images[1])
  try:
   urllib.request.urlopen(base+f'/api/reading/pdf-page?id={bookid}&page=0&width=670',timeout=12)
   ck('page zero rejected',False)
  except urllib.error.HTTPError as e:ck('page zero rejected',e.code==400)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1440,'height':900});errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
   def proxy(route):
    u=urllib.parse.urlsplit(route.request.url);path=u.path+('?' +u.query if u.query else '')
    if u.path.startswith(('/api/books','/api/reading')):
     req=urllib.request.Request(base+path,data=route.request.post_data.encode() if route.request.method=='POST' else None,method=route.request.method,headers={'Content-Type':'application/json'} if route.request.method=='POST' else {})
     try:
      with urllib.request.urlopen(req,timeout=26) as r: status=r.status;body=r.read();mime=r.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:status=e.code;body=e.read();mime=e.headers.get('Content-Type','application/json')
     route.fulfill(status=status,body=body,headers={'Content-Type':mime,'Access-Control-Allow-Origin':'*'})
    else:route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',proxy)
   html=urlopen(base+'/')[2].decode();page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded')
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('''()=>{let e=document.querySelector('#jfPdfPageImage');return !e.hidden && e.complete && e.naturalWidth>0}''',timeout=25000)
   ck('custom PDF page visible, native iframe hidden',page.locator('#jfPdfPageImage').is_visible() and not page.locator('#jfReadPdf').is_visible())
   ck('PDF 4 page chapter list available',page.locator('#jfReadChapters option').count()==4)
   page.locator('#jfReadNext').click()
   page.wait_for_function("document.querySelector('#jfReadProgress').textContent.includes('2 / 4')",timeout=25000)
   ck('next page updates page counter',page.locator('#jfReadProgress').inner_text()=='2 / 4')
   page.locator('#jfPdfZoomIn').click()
   page.wait_for_function("document.querySelector('#jfPdfZoomLabel').textContent==='115%'",timeout=25000)
   ck('page zoom rerenders at new resolution',page.locator('#jfPdfZoomLabel').inner_text()=='115%')
   page.screenshot(path=str(basepath/'pdf-reader.png'))
   ck('no browser script error',not errs)
   browser.close()
  ck('original PDF byte identical',hashlib.sha256(book.read_bytes()).hexdigest()==digest)
 finally:
  if proc:stop(proc,log)
print('TOTAL',len(C),'checks')
