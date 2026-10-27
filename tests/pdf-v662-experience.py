#!/usr/bin/env python3
"""v6.62 real PDF.js, actual Node note persistence, bounded thumbnail & virtual scrolling."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,json,sys,io
from PIL import Image,ImageChops
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
import fitz
passed=0
def ck(label,condition):
 global passed
 assert condition,label
 passed+=1;print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v662-') as td:
 base=pathlib.Path(td);lib=base/'media';lib.mkdir();pdf=fitz.open()
 for i in range(30):
  pg=pdf.new_page(width=500,height=700)
  pg.insert_text((35,80),f'JUST FUN PAGE {i+1}',fontsize=20)
  pg.insert_text((35,135),f'The page {i+1} of a real PDF book is readable.',fontsize=14)
 pdf.save(lib/'Document.pdf');pdf.close();finger=hashlib.sha256((lib/'Document.pdf').read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1280,'height':850},accept_downloads=True)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    rq=route.request;u=urllib.parse.urlsplit(rq.url);path=u.path or '/'
    req=urllib.request.Request(root+path+('?' +u.query if u.query else ''),data=rq.post_data.encode() if rq.method=='POST' else None,method=rq.method,headers={'Content-Type':'application/json'} if rq.method=='POST' else {})
    try:
     with urllib.request.urlopen(req,timeout=40) as res:st=res.status;body=res.read();ct=res.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e:st=e.code;body=e.read();ct=e.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=body,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=20000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('document.querySelector(".jfPdfVirtualPage canvas")!==null',timeout=25000)
   ck('Official PDF.js opens actual PDF, not native iframe',page.locator('#jfReadPdf').is_hidden() and 'JUST FUN PAGE' in page.locator('.jfPdfTextLayer').first.inner_text())
   ck('Precisely one bounded page window',page.locator('.jfPdfVirtualPage').count()==10)
   ck('Chevron SVG previous/next',page.locator('#jfReadPrev svg').count()==1 and page.locator('#jfReadNext svg').count()==1)
   original=page.locator('.jfPdfVirtualPage canvas').first.screenshot()
   page.locator('#jfPdfSharpen').click()
   page.wait_for_timeout(120)
   softened=page.locator('.jfPdfVirtualPage canvas').first.screenshot()
   diff=ImageChops.difference(Image.open(io.BytesIO(original)).convert('RGB'),Image.open(io.BytesIO(softened)).convert('RGB'))
   ck('Sharpen filter changes actual displayed pixels',diff.getbbox() is not None)
   ck('Single enhanced sharpening profile enabled',page.locator('#jfPdfSharpen').get_attribute('aria-pressed')=='true' and page.locator('.jfPdfVirtualPage.jfPdfSharpStrong').count()==10)
   ck('Enhanced mode uses actual convolution',page.evaluate("getComputedStyle(document.querySelector('.jfPdfSharpStrong canvas')).filter.includes('jfPdfSharpenStrong')"))
   page.locator('#jfPdfSharpen').click()
   ck('Next sharpening click directly switches off',page.locator('.jfPdfVirtualPage.jfPdfSharpStrong').count()==0)
   ck('No obsolete soft sharpening setting',page.locator('.jfPdfVirtualPage.jfPdfSharpSoft').count()==0)
   # Scroll boundary and verify the *same* Canvas is retained (before v6.62 all ten were torn down).
   page.evaluate("jfReadCenter.scrollTop+=jfPdfJsPagePosition(jfPdfJsState.pages.get(5))-90")
   page.wait_for_function("jfPdfJsState.pages.get(5)?.canvas!=null",timeout=15000)
   offset=page.evaluate('''()=>{window.__pageCanvas=document.querySelector('.jfPdfVirtualPage[data-pdf-index="5"] canvas');const a=jfPdfJsState.pages.get(5);jfReadCenter.scrollTop+=jfPdfJsPagePosition(a)-90;const before=jfPdfJsPagePosition(a);jfPdfJsBuildWindow(2,5,before);return {delta:Math.abs(jfPdfJsPagePosition(jfPdfJsState.pages.get(5))-before),before,after:jfPdfJsPagePosition(jfPdfJsState.pages.get(5)),scroll:jfReadCenter.scrollTop,win:jfPdfJsState.windowStart,anchor:document.querySelector('.jfPdfVirtualPage[data-pdf-index="5"]')?.offsetTop}}''')
   print("ANCHOR_OFFSET",offset,flush=True)
   ck("Window shift retains anchor within 2px",offset["delta"]<2)
   ck('Overlapping Canvas retained during virtual window shift',page.evaluate("jfPdfJsState.pages.get(5).canvas===window.__pageCanvas"))
   ck('Only 10 pages after virtual shift',page.locator('.jfPdfVirtualPage').count()==10)
   # Back to page one and capture from actual page canvas.
   page.evaluate('jfPdfJsPage(0)');page.wait_for_function("jfPdfJsState.pages.get(0)?.canvas!=null",timeout=20000)
   page.locator('#jfPdfCapture').click()
   overlay=page.locator('.jfPdfVirtualPage[data-pdf-index="0"] .jfPdfCaptureLayer');overlay.wait_for(timeout=5000)
   rect=overlay.bounding_box();assert rect
   page.mouse.move(rect['x']+45,rect['y']+45);page.mouse.down();page.mouse.move(rect['x']+240,rect['y']+180,steps=5);page.mouse.up()
   page.locator('.jfPdfCaptureAccept:visible').click()
   page.locator('#jfPdfQuoteChooser').wait_for(timeout=15000)
   ck('Screenshot opens notebook chooser without extra description',page.locator('#jfPdfCapturePanel').is_hidden())
   page.locator('#jfPdfQuoteChooser').wait_for()
   page.locator('#jfPdfQuoteCommit').click()
   page.locator('#jfReadNotes').click()
   page.wait_for_function('document.querySelector(".jfDeskQuoteImage")!==null',timeout=15000)
   ck('Capture directly creates image excerpt in note, not download',page.locator('.jfDeskQuoteImage').count()==1)
   imageinfo=page.evaluate("""()=>{const n=jfDeskWorkspace.notes.at(-1);const q=n?.quotes?.at(-1);return {noteId:n?.id,quote:q?{type:q.type,bookId:q.bookId,chapter:q.chapter,text:q.text,size:q.image?.length,imageHead:q.image?.slice(0,23)}:null}}""")
   ck('JPEG bounded and carries PDF page source',imageinfo['quote'] and imageinfo['quote']['size']<215001 and imageinfo['quote']['type']=='image' and imageinfo['quote']['chapter']==0 and imageinfo['quote']['imageHead']=='data:image/jpeg;base64,')
   ck('Screenshot is displayed as a scaled thumbnail',page.locator('.jfDeskQuoteImage').evaluate('(e)=>getComputedStyle(e).maxHeight')=='370px')
   status,_,response=urlopen(root+'/api/reading/workspace');workspace=json.loads(response)
   ck('Image quote persisted in workspace',status==200 and workspace['notes'][-1]['quotes'][-1]['type']=='image')
   ref=workspace['notes'][-1]['quotes'][-1]
   bad={**workspace['notes'][-1],'quotes':[{**ref,'image':'data:image/png;base64,aGk='}]}
   rq=urllib.request.Request(root+'/api/reading/workspace',data=json.dumps({'revision':workspace['revision'],'action':'note','note':bad}).encode(),headers={'Content-Type':'application/json'},method='POST')
   try:
    urllib.request.urlopen(rq,timeout=10);bad_status=200
   except urllib.error.HTTPError as err:bad_status=err.code
   ck('Malicious/non-JPEG image rejected by server',bad_status==413)
   page.locator('#jfDeskNotesClose').click()
   page.locator('#jfReadBack').click()
   ck('Original PDF bytes untouched',hashlib.sha256((lib/'Document.pdf').read_bytes()).hexdigest()==finger)
   ck('No uncaught browser errors',not errors)
   browser.close()
 finally:
  if proc:stop(proc,log)
print('TOTAL',passed)
