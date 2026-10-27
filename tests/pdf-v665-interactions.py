#!/usr/bin/env python3
"""v6.69 PDF: page-preserving pinch, screenshot-driven area marks and direct screenshot note chooser."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib
import fitz
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0
def ck(label,condition):
 global count
 if not condition:raise AssertionError(label)
 count+=1;print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v665-') as td:
 base=pathlib.Path(td);lib=base/'media';lib.mkdir()
 doc=fitz.open()
 for i in range(12):
  page=doc.new_page(width=510,height=720)
  page.insert_text((60,120),f'PAGE NUMBER {i+1} UNIQUE PDF TEXT',fontsize=21)
 doc.save(lib/'Original.pdf');doc.close()
 origin=hashlib.sha256((lib/'Original.pdf').read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':900})
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    data=req.post_data.encode() if req.method=='POST' and req.post_data else None
    r=urllib.request.Request(root+(u.path or '/')+('?' +u.query if u.query else ''),data=data,method=req.method,headers={'Content-Type':'application/json'} if data else {})
    try:
     with urllib.request.urlopen(r,timeout=50) as resp: st=resp.status;body=resp.read();ct=resp.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e:st=e.code;body=e.read();ct=e.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=body,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=20000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=30000)
   ck('PDF.js actual page rendered',page.locator('.jfPdfVirtualPage canvas').count()>0)
   page.evaluate('jfPdfJsPage(3)')
   page.wait_for_function('jfPdfJsState.pages.get(3)?.status==="ready"',timeout=30000)
   # Snapshot page-relative focal point at 42% vertical viewport.
   anch=page.evaluate('''()=>{
     const center=jfReadCenter.getBoundingClientRect(),y=center.top+center.height*.42,x=center.left+center.width*.5;
     const a=jfPdfJsTakeZoomAnchor(x,y);return {x,y,index:a.index,ratio:a.ratioY};
   }''')
   page.evaluate('''p=>{for(let i=0;i<8;i++)jfReadCenter.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-5,clientX:p.x,clientY:p.y,bubbles:true,cancelable:true}));}''',anch)
   page.wait_for_timeout(750)
   page.wait_for_function('jfPdfPinchBaseZoom===null',timeout=12000)
   page.wait_for_function('jfPdfJsState.pages.get(jfDeskChapter)?.status==="ready"',timeout=35000)
   after=page.evaluate('''p=>{
     const r=jfPdfJsState.pages.get(p.index)?.el.getBoundingClientRect();return r?r.top+r.height*p.ratio-p.y:null;
   }''',anch)
   ck('Zoom preserves exact PDF reading position within 5px',after is not None and abs(after)<5)
   ck('Pinch left user in same page window',page.evaluate('(n)=>jfPdfJsState.pages.has(n)',anch['index']))
   # Mark now flows through the screenshot selector: no separate header mark button.
   page.evaluate('getSelection().removeAllRanges()')
   page.locator('#jfPdfCapture').click()
   idx=page.evaluate('jfDeskChapter')
   page.wait_for_function('jfPdfJsState.pages.get(jfDeskChapter)?.status==="ready"',timeout=35000)
   overlay=page.locator(f'.jfPdfVirtualPage[data-pdf-index="{idx}"] .jfPdfCaptureLayer');overlay.wait_for(timeout=7000)
   page.evaluate('jfPdfJsState.pages.get(jfDeskChapter).el.scrollIntoView({block:"start",behavior:"instant"})')
   page.wait_for_timeout(150)
   rect=overlay.bounding_box();assert rect and rect['width']>200
   assert 0 <= rect['y'] < 900 and rect['y']+130>120, 'Capture page not in viewport'
   x=rect['x']+35;y=max(rect['y']+40,160)
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+130,y+95,steps=6);page.mouse.up()
   page.locator('.jfPdfCaptureMark:visible').click()
   page.wait_for_function('jfDeskWorkspace.marks?.some(m=>m.type==="area")',timeout=15000)
   ck('Screenshot action bar can mark without creating notes',page.evaluate('jfDeskWorkspace.marks.some(m=>m.type==="area") && jfDeskWorkspace.notes.length===0'))
   ck('Area marker appears in PDF',page.locator('.jfPdfSavedArea').count()>=1)
   page.locator('#jfPdfMarksListToggle').click()
   ck('Mark list opens with area mark',page.locator('#jfPdfMarksList').is_visible() and page.locator('.jfPdfMarkItem').count()==1)
   page.locator('.jfPdfMarkItem').first.click()
   ck('Mark list jumps to marked page',page.evaluate('jfDeskChapter===jfDeskWorkspace.marks[0].chapter && document.getElementById("jfPdfMarksList").hidden'))
   page.locator('#jfPdfMarksListToggle').click();page.keyboard.press('Escape')
   ck('Escape closes mark list without closing PDF',page.locator('#jfPdfMarksList').is_hidden() and page.locator('#jfReader').is_visible())
   # Capture goes STRAIGHT to notebook picker, never prompts description.
   page.locator('#jfPdfCapture').click()
   overlay=page.locator(f'.jfPdfVirtualPage[data-pdf-index="{idx}"] .jfPdfCaptureLayer');overlay.wait_for(timeout=7000)
   page.evaluate('jfPdfJsState.pages.get(jfDeskChapter).el.scrollIntoView({block:"start",behavior:"instant"})')
   page.wait_for_timeout(150)
   rect=overlay.bounding_box();assert rect and rect['width']>200
   assert 0 <= rect['y'] < 900 and rect['y']+130>120, 'Capture page not in viewport'
   x=rect['x']+55;y=max(rect['y']+60,180)
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+140,y+105,steps=6);page.mouse.up()
   page.locator('.jfPdfCaptureAccept:visible').click()
   page.locator('#jfPdfQuoteChooser').wait_for(timeout=20000)
   ck('Screenshot skips description and opens notebook chooser',page.locator('#jfPdfCapturePanel').is_hidden())
   ck('Notebooks offer create new',page.locator('#jfPdfQuoteOptions button[data-note-id="new"]').count()==1)
   page.locator('#jfPdfQuoteNewTitle').fill('阅读图片摘录')
   page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.notes.some(n=>n.title==="阅读图片摘录" && n.quotes.some(q=>q.type==="image"))',timeout=15000)
   ck('Screenshot inserted into chosen note',page.evaluate('jfDeskWorkspace.notes.some(n=>n.quotes.some(q=>q.type==="image"))'))
   # Repeat capture: last notebook should be preselected.
   page.locator('#jfPdfCapture').click()
   page.locator('#jfPdfCapture').click()
   ck('Source book bytes unchanged',hashlib.sha256((lib/'Original.pdf').read_bytes()).hexdigest()==origin)
   ck('No uncaught browser errors',not errors)
   browser.close()
 finally:
  if proc:stop(proc,log)
print('TOTAL',count,flush=True)
