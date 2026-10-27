#!/usr/bin/env python3
"""v6.63 end-to-end PDF.js + actual notes/marks persistence regression."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,json
import fitz
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0
def ck(label,ok):
 global count
 if not ok: raise AssertionError(label)
 count+=1;print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v663-') as td:
 base=pathlib.Path(td);lib=base/'media';lib.mkdir();pdf=fitz.open()
 for i in range(4):
  p=pdf.new_page(width=500,height=700);p.insert_text((25,85),f'PDF TEST PAGE {i+1} ORIGINAL',fontsize=20)
 pdf.save(lib/'Reader.pdf');pdf.close();original=hashlib.sha256((lib/'Reader.pdf').read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':900})
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    rq=urllib.request.Request(root+(u.path or '/')+('?' +u.query if u.query else ''),data=req.post_data.encode() if req.method=='POST' else None,method=req.method,headers={'Content-Type':'application/json'} if req.method=='POST' else {})
    try:
     with urllib.request.urlopen(rq,timeout=40) as res:st=res.status;body=res.read();ct=res.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e:st=e.code;body=e.read();ct=e.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=body,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=20000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=35000)
   ck('Real PDF.js canvas loaded',page.locator('.jfPdfVirtualPage canvas').count()>0)
   ck('Zoom HUD hidden',page.locator('#jfPdfPageActions').is_hidden())
   page.evaluate("jfReadCenter.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-50,bubbles:true,cancelable:true}))")
   page.wait_for_timeout(320)
   ck('Ctrl-wheel pinch increases PDF zoom',page.evaluate('jfDeskPdfZoom>1.2'))
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=35000)
   old_quality=page.evaluate('jfPdfJsState.pages.get(0)?.canvas?.width')
   page.locator('#jfPdfSharpen').click()
   page.wait_for_function('(old)=>jfPdfJsState.pages.get(0)?.status==="ready" && jfPdfJsState.pages.get(0)?.canvas?.width>old',arg=old_quality,timeout=30000)
   ck('Sharpen mode regenerates a higher-resolution PDF canvas',page.evaluate('(old)=>jfPdfJsState.pages.get(0).canvas.width>old',old_quality))
   page.locator('#jfPdfCapture').click();ck('Capture mode enters',page.evaluate('jfPdfJsState.capture'))
   page.keyboard.press('Escape')
   ck('Escape cancels capture, preserves reader',page.locator('#jfReader').is_visible() and not page.evaluate('jfPdfJsState.capture'))
   # Use actual selectable text nodes rather than a mock getSelection shim.
   page.evaluate('''()=>{
     const layer=document.querySelector('.jfPdfVirtualPage[data-pdf-index="0"] .jfPdfTextLayer');
     const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT);let n,selected=null;
     while((n=walker.nextNode()))if(n.textContent.includes('PDF TEST PAGE')){selected=n;break;}
     if(!selected)throw Error('no selectable PDF text');
     const start=selected.textContent.indexOf('PDF TEST PAGE');const range=document.createRange();
     range.setStart(selected,start);range.setEnd(selected,start+13);
     getSelection().removeAllRanges();getSelection().addRange(range);
   }''')
   page.locator('#jfReadExcerpt').click()
   ck('Excerpt opens notebook chooser',page.locator('#jfPdfQuoteChooser').is_visible())
   page.locator('#jfPdfQuoteOptions button[data-note-id="new"]').click()
   page.locator('#jfPdfQuoteNewTitle').fill('测试读书札记')
   page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.notes.some(n=>n.title==="测试读书札记")',timeout=15000)
   ck('New note receives source excerpt',page.evaluate('jfDeskWorkspace.notes.find(n=>n.title==="测试读书札记").quotes.length===1'))
   ck('Excerpt also adds persistent page mark',page.evaluate('jfDeskWorkspace.marks?.some(m=>m.type==="text"&&m.chapter===0)'))
   ck('Last excerpt note persisted',page.evaluate('jfDeskWorkspace.lastExcerptNoteId===jfDeskWorkspace.notes.find(n=>n.title==="测试读书札记").id'))
   # mark-only should not create another note; area marks now come from the screenshot selector.
   count_notes=page.evaluate('jfDeskWorkspace.notes.length')
   page.locator('#jfPdfCapture').click()
   overlay=page.locator('.jfPdfVirtualPage[data-pdf-index="0"] .jfPdfCaptureLayer');overlay.wait_for(timeout=10000)
   # After pinch zoom, place the source page inside the viewport before
   # sending real pointer events. Off-viewport coordinates cannot be clicked.
   page.evaluate('jfReadCenter.scrollTop+=jfPdfJsPagePosition(jfPdfJsState.pages.get(0))-20')
   page.wait_for_timeout(120)
   rect=overlay.bounding_box();assert rect
   page.mouse.move(rect['x']+30,rect['y']+40);page.mouse.down();page.mouse.move(rect['x']+190,rect['y']+160,steps=5);page.mouse.up()
   page.locator('.jfPdfCaptureMark:visible').click()
   page.wait_for_function('jfDeskWorkspace.marks?.some(m=>m.type==="area")',timeout=15000)
   ck('Mark-only does not create note',page.evaluate(f'jfDeskWorkspace.notes.length==={count_notes}'))
   # capture -> chooser, not implicit active note; destination retained
   page.locator('#jfPdfCapture').click()
   overlay=page.locator('.jfPdfVirtualPage[data-pdf-index="0"] .jfPdfCaptureLayer');overlay.wait_for(timeout=10000)
   # After pinch zoom, place the source page inside the viewport before
   # sending real pointer events. Off-viewport coordinates cannot be clicked.
   page.evaluate('jfReadCenter.scrollTop+=jfPdfJsPagePosition(jfPdfJsState.pages.get(0))-20')
   page.wait_for_timeout(120)
   rect=overlay.bounding_box();assert rect
   page.mouse.move(rect['x']+30,rect['y']+40);page.mouse.down();page.mouse.move(rect['x']+190,rect['y']+160,steps=5);page.mouse.up()
   page.locator('.jfPdfCaptureAccept:visible').click()
   page.locator('#jfPdfQuoteChooser').wait_for(timeout=15000)
   ck('Screenshot skips caption and opens notebook chooser',page.locator('#jfPdfCapturePanel').is_hidden())
   ck('Image excerpt shows destination selector',page.locator('#jfPdfQuoteChooser').is_visible())
   ck('Defaults to previously used note',page.locator('#jfPdfQuoteOptions button[aria-pressed="true"]').get_attribute('data-note-id')==page.evaluate('jfDeskWorkspace.lastExcerptNoteId'))
   page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.notes.find(n=>n.title==="测试读书札记")?.quotes.length===2',timeout=15000)
   ck('Image excerpt saved to selected note',page.evaluate('jfDeskWorkspace.notes.find(n=>n.title==="测试读书札记").quotes[1].type==="image"'))
   ck('Image mark retained as separate source region',page.evaluate('jfDeskWorkspace.marks.some(m=>m.type==="area")'))
   status,_,raw=urlopen(root+'/api/reading/workspace');payload=json.loads(raw)
   ck('Backend returns persistent independent quotes and marks',status==200 and len(payload['notes'])==1 and len(payload['marks'])>=3)
   ck('Original source PDF never changed',hashlib.sha256((lib/'Reader.pdf').read_bytes()).hexdigest()==original)
   ck('No uncaught browser exception',not errors)
   browser.close()
 finally:
  if proc:stop(proc,log)
print('TOTAL',count)
