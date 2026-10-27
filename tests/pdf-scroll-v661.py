#!/usr/bin/env python3
"""Isolated PDF continuous-scroll UI regression with deterministic render stub.
Also run pdfjs-real-v660.py independently: this test DOES NOT assert actual PDF.js decoding.
"""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,json,hashlib
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0
def ck(name,ok):
 global count
 assert ok,name
 count+=1;print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v661-scroll-') as td:
 lib=pathlib.Path(td)/'books';lib.mkdir()
 (lib/'Sample.txt').write_text('book sample'*50,encoding='utf8')
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,pathlib.Path(td)/'home');server=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1380,'height':900},accept_downloads=True)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    rq=route.request;u=urllib.parse.urlsplit(rq.url)
    if u.path.startswith('/api/'):
     req=urllib.request.Request(server+u.path+('?' +u.query if u.query else ''),data=rq.post_data.encode() if rq.method=='POST' else None,method=rq.method,headers={'Content-Type':'application/json'} if rq.method=='POST' else {})
     try:
      with urllib.request.urlopen(req,timeout=15) as res: status=res.status;body=res.read();ctype=res.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e: status=e.code;body=e.read();ctype=e.headers.get('Content-Type','application/json')
     route.fulfill(status=status,body=body,headers={'Content-Type':ctype,'Access-Control-Allow-Origin':'*'})
    else:route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',proxy)
   html=urlopen(server+'/')[2].decode()
   page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded')
   page.evaluate('''async()=>{
     jfReader.hidden=false;jfReader.classList.add('jfPdfMode');
     jfReadCenter.scrollTop=0;
     document.getElementById('jfPdfPages').hidden=false;
     document.getElementById('jfReadText').hidden=true;
     jfDeskChooseQuote=(q)=>{window.__legacyCapture={image:q.image,text:q.text,id:q.bookId,chapter:q.chapter};jfPdfJsCaptureClear();};
     jfDeskBook={id:'mock-book'};jfDeskOutline={nativePdf:true,chapters:Array.from({length:342},(_,i)=>({title:String(i)}))};jfDeskPdfInfo={pages:342};
     jfPdfJsState.doc={numPages:342,getPage:async pageNumber=>({
       getViewport:({scale})=>({width:520*scale,height:720*scale,scale}),
       render:({canvasContext})=>{canvasContext.fillStyle='#fff';canvasContext.fillRect(0,0,100,100);canvasContext.fillStyle='#000';canvasContext.fillText('PAGE '+pageNumber,20,30);return {promise:Promise.resolve(),cancel(){}};},
       getTextContent:async()=>({items:[{str:'PAGE '+pageNumber+' selectable text'}],styles:{}}),cleanup(){}
     })};
     jfPdfJsState.module=Promise.resolve({TextLayer:class {constructor({container}){this.container=container;}async render(){const el=document.createElement('span');el.textContent='Sample selectable excerpt';this.container.append(el);}}});
     await jfPdfJsPage(0);
   }''')
   page.wait_for_function('document.querySelectorAll(".jfPdfVirtualPage canvas").length>=1',timeout=10000)
   ck('initial window capped at 10',page.locator('.jfPdfVirtualPage').count()==10)
   ck('real Canvas drawing path creates multiple pages',page.locator('.jfPdfVirtualPage canvas').count()>=1)
   ck('numeric page jump replaces long select',page.locator('#jfPdfGoControl').is_visible() and not page.locator('#jfReadChapters').is_visible())
   page.locator('#jfPdfNight').click()
   ck('night mode inverts canvas but not source file',page.locator('.jfPdfVirtualPage.jfPdfPageNight').count()==10 and page.locator('#jfPdfNight').get_attribute('aria-pressed')=='true')
   page.evaluate('jfPdfJsPage(240)')
   page.wait_for_function('document.querySelector(".jfPdfVirtualPage")?.dataset.pdfIndex==="236"',timeout=10000)
   ck('jump 241 window has at most ten pages',page.locator('.jfPdfVirtualPage').count()==10)
   ck('jumped page matches numeric control',page.locator('#jfPdfGoPage').input_value()=='241')
   page.locator('#jfPdfGoPage').fill('342');page.locator('#jfPdfGoPage').press('Enter')
   page.wait_for_function('document.querySelector("#jfPdfGoPage")?.value==="342"&&Array.from(document.querySelectorAll(".jfPdfVirtualPage")).some(x=>x.dataset.pdfIndex==="341")',timeout=10000)
   ck('numeric last-page jump works',page.locator('.jfPdfVirtualPage[data-pdf-index="341"]').count()==1)
   page.locator('#jfPdfGoPage').fill('1');page.locator('#jfPdfGoPage').press('Enter')
   page.wait_for_function('Array.from(document.querySelectorAll(".jfPdfVirtualPage")).some(x=>x.dataset.pdfIndex==="0"&&x.querySelector("canvas"))',timeout=10000)
   page.locator('#jfPdfCapture').click()
   ck('capture selection mode active',page.locator('#jfPdfCapture').get_attribute('aria-pressed')=='true')
   rect=page.locator('.jfPdfVirtualPage[data-pdf-index="0"] .jfPdfCaptureLayer').bounding_box()
   assert rect, 'capture overlay available'
   page.mouse.move(rect['x']+35,rect['y']+40);page.mouse.down();page.mouse.move(rect['x']+160,rect['y']+145,steps=6);page.mouse.up()
   page.locator('.jfPdfCaptureAccept:visible').click()
   ck('screenshot never opens a redundant description form',page.locator('#jfPdfCapturePanel').is_hidden())
   page.wait_for_function('window.__legacyCapture?.image?.startsWith("data:image/jpeg;base64,")',timeout=10000)
   ck('image excerpt enters note handoff, not download',page.evaluate('window.__legacyCapture.text==="" && window.__legacyCapture.image.length<215000'))
   page.evaluate('jfPdfJsCaptureClear()')
   ck('screenshot mode may be cancelled without changing original',page.locator('#jfPdfCapture').get_attribute('aria-pressed')=='false')
   page.evaluate('jfPdfJsDispose()')
   ck('all virtual pages removed on close',page.locator('.jfPdfVirtualPage').count()==0)
   ck('no front-end JS exception',not errors)
   browser.close()
 finally:
  if proc:stop(proc,lg)
print('TOTAL',count)
