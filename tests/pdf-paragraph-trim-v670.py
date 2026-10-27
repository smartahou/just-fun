#!/usr/bin/env python3
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib
import fitz
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0

def ck(name,cond):
 global count
 if not cond: raise AssertionError(name)
 count+=1;print('PASS',name,flush=True)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v670-') as td:
 base=pathlib.Path(td);lib=base/'media';lib.mkdir()
 doc=fitz.open();page=doc.new_page(width=560,height=820)
 # Paragraph 1
 page.insert_text((70,120),'THIS IS A LONG FIRST PARAGRAPH LINE FOR TESTING',fontsize=20)
 page.insert_text((70,162),'GOOD OMEN.',fontsize=20)
 # Paragraph gap
 # Paragraph 2 with indent + varied line widths
 page.insert_text((112,254),'JAN 10 DIARY ENTRY BEGINS WITH AN INDENTED LINE',fontsize=20)
 page.insert_text((70,296),'SECOND LINE OF THE NEXT PARAGRAPH STAYS QUITE LONG',fontsize=20)
 page.insert_text((70,338),'ENDING SHORT LINE.',fontsize=20)
 doc.save(lib/'paragraph-trim.pdf');doc.close()
 origin=hashlib.sha256((lib/'paragraph-trim.pdf').read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':940})
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    data=req.post_data.encode() if req.method=='POST' and req.post_data else None
    r=urllib.request.Request(root+(u.path or '/')+('?' +u.query if u.query else ''),data=data,method=req.method,headers={'Content-Type':'application/json'} if data else {})
    try:
      with urllib.request.urlopen(r,timeout=45) as resp: st=resp.status;body=resp.read();ct=resp.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e: st=e.code;body=e.read();ct=e.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=body,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=40000)
   page.locator('#jfPdfCapture').click()
   overlay=page.locator('.jfPdfVirtualPage[data-pdf-index="0"] .jfPdfCaptureLayer');overlay.wait_for(timeout=10000)
   page.evaluate('jfReadCenter.scrollTop+=jfPdfJsPagePosition(jfPdfJsState.pages.get(0))-20')
   page.wait_for_timeout(120)
   rect=overlay.bounding_box();assert rect and rect['width']>250
   # Draw a region spanning both paragraphs.
   x=rect['x']+48;y=rect['y']+52
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+420,y+560,steps=9);page.mouse.up()
   info=page.evaluate('''()=>{const c=jfPdfJsState.selection;const groups=jfPdfCaptureParagraphGroups(c.rows,Math.min(c.start.row,c.end.row),Math.max(c.start.row,c.end.row),c.area);
     return {areaW:c.area.w,segments:c.segments.map(s=>({x:s.x,w:s.w,y:s.y})),groups};}''')
   ck('Paragraph-aware grouping detects 2 blocks',len(info['groups'])==2)
   ck('Selection produced five row strips',len(info['segments'])==5)
   area=info['areaW']; widths=[s['w'] for s in info['segments']]
   # row 2 = paragraph 1 last line, row 3 = paragraph 2 first line (indented),
   # row 4 = paragraph 2 middle full-width, row 5 = paragraph 2 last short line.
   ck('First paragraph ending trims right-side blank area',widths[1] < area*0.65)
   ck('Second paragraph first line trims its own indent/blank margin',widths[2] < area*0.75 and info['segments'][2]['x'] > 150)
   ck('Middle line of second paragraph keeps wide body width',widths[3] > area*0.9)
   ck('Second paragraph ending trims trailing blank area',widths[4] < area*0.88)
   ck('Original PDF remains untouched',hashlib.sha256((lib/'paragraph-trim.pdf').read_bytes()).hexdigest()==origin)
   ck('No uncaught browser page error',not errors)
   browser.close()
 finally:
  if proc: stop(proc,log)
print('TOTAL',count,flush=True)
