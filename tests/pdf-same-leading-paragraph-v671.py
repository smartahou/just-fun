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

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v671-') as td:
 base=pathlib.Path(td);lib=base/'media';lib.mkdir()
 doc=fitz.open();pdoc=doc.new_page(width=560,height=720)
 font='/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'
 assert pathlib.Path(font).is_file(), '需要系统 Noto Serif CJK 测试字体'
 pdoc.insert_font(fontname='BookCJK',fontfile=font)
 # Exactly identical baseline spacing for every row: no paragraph-gap cue.
 # This reproduces the "好兆头。" -> "1月10日" transition in the supplied screenshot.
 content=[
  (63,115,'国民党统治区内的报纸，也很难引用那一套'),
  (63,162,'中央日报那一套来了，甚至恰恰相反。'),
  (63,209,'但是对这位敏感的老报人来说，这是个'),
  (63,256,'好兆头。'),
  (115,303,'1月10日，蒋介石在日记中又写道：'),
  (63,350,'时到行辕会议，听取报告。对于敌情'),
  (63,397,'殊为忧虑，与宜生谈增援东北事项。'),
 ]
 for x,y,line in content:pdoc.insert_text((x,y),line,fontname='BookCJK',fontsize=19)
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
   x=rect['x']+77;y=rect['y']+150
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+765,y+570,steps=9);page.mouse.up()
   info=page.evaluate('''()=>{const c=jfPdfJsState.selection;const groups=jfPdfCaptureParagraphGroups(c.rows,Math.min(c.start.row,c.end.row),Math.max(c.start.row,c.end.row),c.area);
     return {areaW:c.area.w,area:c.area,rows:c.rows,segments:c.segments.map(s=>({x:s.x,w:s.w,y:s.y})),groups};}''')
   print('GEOMETRY',info,flush=True)
   ck('Same leading: seven actual Chinese text bands',len(info['segments'])==7)
   ck('Same leading: two paragraphs despite identical baselines',len(info['groups'])==2 and info['groups'][0]['end']==3 and info['groups'][1]['start']==4)
   seg=info['segments'];area=info['areaW']
   ck('好兆头。 right whitespace excluded',seg[3]['w'] < area*.35)
   ck('1月10日 first-line indent excluded',seg[4]['x'] > seg[3]['x']+45)
   ck('Other full-body middle lines preserved',seg[1]['w'] > area*.9 and seg[5]['w'] > area*.9)
   ck('No line disappears from selection',len(seg)==len(info['rows']))
   ck('Original PDF remains untouched',hashlib.sha256((lib/'paragraph-trim.pdf').read_bytes()).hexdigest()==origin)
   ck('No uncaught browser page error',not errors)
   browser.close()
 finally:
  if proc: stop(proc,log)
print('TOTAL',count,flush=True)
