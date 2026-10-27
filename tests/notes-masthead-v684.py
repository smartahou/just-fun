#!/usr/bin/env python3
"""Measured notes/gallery heading match and actual title/button separation on desktop and narrow viewport."""
import pathlib,tempfile,urllib.request,urllib.parse,urllib.error,hashlib
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0
def check(label,ok):
 global count
 if not ok:raise AssertionError(label)
 count+=1; print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v684-') as tmp:
 base=pathlib.Path(tmp);library=base/'media';library.mkdir()
 source=library/'original.txt';source.write_text('不可变原文。'*100,encoding='utf-8');before=hashlib.sha256(source.read_bytes()).hexdigest()
 proc,port,log=launch(ROOT/'dist/douyin.js',library,base/'home');origin=f'http://127.0.0.1:{port}'
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   for width,height in ((1440,900),(390,844)):
    page=browser.new_page(viewport={'width':width,'height':height});errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    def proxy(route):
     r=route.request;uri=urllib.parse.urlsplit(r.url)
     if not uri.path.startswith('/api/'):
      route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'});return
     data=r.post_data.encode() if r.method=='POST' and r.post_data else None
     req=urllib.request.Request(origin+uri.path+('?' +uri.query if uri.query else ''),data=data,method=r.method,headers={'Content-Type':'application/json'} if data else {})
     try:
      with urllib.request.urlopen(req,timeout=35) as response: status=response.status;body=response.read();mime=response.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as exc:status=exc.code;body=exc.read();mime=exc.headers.get('Content-Type','application/json')
     route.fulfill(status=status,body=body,headers={'Content-Type':mime})
    page.route('http://justfun.test/**',proxy)
    page.set_content(urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded')
    page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click()
    measurements=page.evaluate('''()=>{
      const title=document.querySelector('#jfDeskNotes .jfDeskNotesHead h3'),button=document.querySelector('#jfDeskNewNote'),gallery=document.querySelector('.photoToolbarHead strong');
      const t=title.getBoundingClientRect(),b=button.getBoundingClientRect();
      const tc=getComputedStyle(title),gc=getComputedStyle(gallery),bc=getComputedStyle(button);
      return {font:tc.fontSize,weight:tc.fontWeight,match:tc.fontSize===gc.fontSize&&tc.fontWeight===gc.fontWeight, gap:b.top-t.bottom,
        btnWeight:Number(bc.fontWeight),btnHeight:b.height,editableArea:document.querySelector('#jfDeskExcerpt')?.getAttribute('contenteditable')};}''')
    print('MEASURE',width,measurements,flush=True)
    check(f'{width}px title matches gallery',measurements['match'])
    check(f'{width}px title-to-button visible gap 15-25px',15<=measurements['gap']<=25)
    check(f'{width}px new-note button slim weight/height',measurements['btnWeight']<=550 and measurements['btnHeight']<=36)
    check(f'{width}px has no browser errors',not errors)
    page.close()
   browser.close()
  check('Original book SHA remains unchanged',hashlib.sha256(source.read_bytes()).hexdigest()==before)
 finally:stop(proc,log)
print('TOTAL',count,flush=True)
