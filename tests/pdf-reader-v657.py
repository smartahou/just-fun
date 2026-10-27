#!/usr/bin/env python3
"""v6.57 PDF frame retention, concurrent cache, fallback & source integrity.
No user data; temporary books, fake browser origin and local Node only.
"""
import sys,hashlib,tempfile,pathlib,urllib.parse,urllib.request,urllib.error,json,concurrent.futures
from playwright.sync_api import sync_playwright
import fitz
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from isolated import ROOT,launch,stop,urlopen
checks=[]
def ck(name,condition):
 assert condition,name
 checks.append(name);print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-pdf-v657-') as tmp:
 root=pathlib.Path(tmp);library=root/'library';library.mkdir()
 doc=fitz.open()
 for i in range(5):
  p=doc.new_page(width=410,height=620);p.insert_text((44,84),f'PDF READER v6.57 test page {i+1}',fontsize=20)
 doc.save(str(library/'连续阅读.pdf'));doc.close()
 original=hashlib.sha256((library/'连续阅读.pdf').read_bytes()).hexdigest()
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',library,root/'home');base=f'http://127.0.0.1:{port}'
  books=json.loads(urlopen(base+'/api/books?refresh=1')[2]);bid=books['books'][0]['id']
  endpoint=base+'/api/reading/pdf-page?id='+bid+'&page=3&width=590'
  with concurrent.futures.ThreadPoolExecutor(max_workers=7) as executor:
   futures=[executor.submit(urlopen,endpoint,timeout=30) for _ in range(7)]
   frames=[f.result() for f in futures]
  ck('seven concurrent equal frames accepted, never 503',all(r[0]==200 for r in frames))
  ck('concurrent render shares exact PNG bytes',len({hashlib.sha256(r[2]).hexdigest() for r in frames})==1)
  for suffix in ('page=0&width=590','page=2.5&width=590','page=2&width=50','page=2&width=1999'):
   code=urlopen(base+'/api/reading/pdf-page?id='+bid+'&'+suffix,timeout=10)[0]
   ck('malformed page request rejected '+suffix,code==400)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1400,'height':920});errors=[]
   page.on('pageerror',lambda err:errors.append(str(err)))
   def proxy(route):
    u=urllib.parse.urlsplit(route.request.url)
    if u.path.startswith(('/api/books','/api/reading')):
     req=urllib.request.Request(base+u.path+('?' +u.query if u.query else ''),data=route.request.post_data.encode() if route.request.method=='POST' else None,method=route.request.method,headers={'Content-Type':'application/json'} if route.request.method=='POST' else {})
     try:
      with urllib.request.urlopen(req,timeout=32) as r:status=r.status;body=r.read();mime=r.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:status=e.code;body=e.read();mime=e.headers.get('Content-Type','application/json')
     route.fulfill(status=status,body=body,headers={'Content-Type':mime})
    else:route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',proxy)
   html=urlopen(base+'/')[2].decode('utf8');page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded')
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click()
   page.locator('.jfBookTile').first.click()
   page.wait_for_function('''()=>{let i=document.querySelector('#jfPdfPageImage');return !i.hidden&&i.complete&&i.naturalWidth>0}''',timeout=30000)
   ck('first frame decoded and remains readable',page.locator('#jfPdfPageImage').is_visible())
   # Artificial latency tests actual client state independent of machine speed.
   page.evaluate('''()=>{const original=window.fetch.bind(window);window.fetch=(url,...args)=>{if(String(url).includes('/pdf-page?')&&String(url).includes('page=5&'))return new Promise(resolve=>setTimeout(()=>resolve(original(url,...args)),950));return original(url,...args)};}''')
   page.evaluate('() => { void jfDeskShowPdfPage(4); }')
   ck('during delayed page turn previous frame not hidden',page.locator('#jfPdfPageImage').is_visible() and page.locator('#jfPdfPageStatus').is_visible())
   page.evaluate('() => { void jfDeskShowPdfPage(3); }')
   page.wait_for_function("document.querySelector('#jfReadProgress').textContent==='4 / 5'",timeout=30000)
   page.wait_for_timeout(1350)
   ck('stale page response cannot replace newer page',page.locator('#jfReadProgress').inner_text()=='4 / 5' and page.evaluate('jfDeskPdfVisiblePage===3'))
   ck('adjacent page prefetch is bounded',page.evaluate('jfDeskPdfWarm.size<=1'))
   page.keyboard.press('ArrowLeft');page.wait_for_function("document.querySelector('#jfReadProgress').textContent==='3 / 5'",timeout=30000)
   ck('PDF arrow key navigates pages not scroll',page.locator('#jfReadProgress').inner_text()=='3 / 5')
   page.locator('#jfReadBack').click()
   ck('close reader releases frame URL and warm cache',page.evaluate('jfDeskPdfWarm.size===0 && jfDeskPdfVisiblePage===-1 && document.querySelector("#jfPdfPageImage").getAttribute("src")===null'))
   # Force a page endpoint error after info loads to confirm native fallback.
   page.evaluate('''()=>{const old=window.fetch.bind(window);window.fetch=(u,...opts)=>String(u).includes('/pdf-page?')?Promise.resolve(new Response('error',{status:503})):old(u,...opts)}''')
   page.locator('.jfBookTile').first.click()
   page.wait_for_function('''()=>document.querySelector('#jfReadFormat').textContent.includes('系统兼容预览')''',timeout=20000)
   ck('first raster failure falls back to native PDF rather than dead reader',page.locator('#jfReadPdf').is_visible())
   ck('browser has no uncaught exceptions',not errors)
   browser.close()
  ck('original PDF unchanged',hashlib.sha256((library/'连续阅读.pdf').read_bytes()).hexdigest()==original)
 finally:
  if proc:stop(proc,lg)
print('TOTAL',len(checks))
