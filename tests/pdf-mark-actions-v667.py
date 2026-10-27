#!/usr/bin/env python3
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,json
import fitz
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0
def ck(name,cond):
 global count
 if not cond: raise AssertionError(name)
 count+=1;print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v667-' ) as tmp:
 base=pathlib.Path(tmp);library=base/'media';library.mkdir()
 doc=fitz.open()
 for i in range(4):
  pp=doc.new_page(width=510,height=720);pp.insert_text((60,120),f'PAGE NUMBER {i+1} JUST FUN ANNOTATION EDIT',fontsize=19)
 doc.save(library/'mark-test.pdf');doc.close()
 original=hashlib.sha256((library/'mark-test.pdf').read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',library,base/'home')
  root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':900})
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    payload=req.post_data.encode() if req.method=='POST' and req.post_data else None
    r=urllib.request.Request(root+(u.path or '/')+('?'+u.query if u.query else ''),data=payload,method=req.method,headers={'Content-Type':'application/json'} if payload else {})
    try:
     with urllib.request.urlopen(r,timeout=45) as response:st=response.status;data=response.read();ct=response.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as exc:st=exc.code;data=exc.read();ct=exc.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=data,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=40000)
   ck('PDF.js actual page and text layer ready',page.locator('.jfPdfVirtualPage canvas').count()>=1 and page.locator('.jfPdfTextLayer').count()>0)
   # Seed a real text mark through the public mutation path; the dedicated
   # header button was intentionally removed in favor of screenshot-first UX.
   page.evaluate('''async()=>{
     const layer=jfPdfJsState.pages.get(0).el.querySelector('.jfPdfTextLayer');const raw=layer.textContent;const start=raw.indexOf('JUST FUN');
     const range=jfPdfJsTextRange(layer,start,8);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
     const ref=jfPdfJsSelectedText();
     await jfDeskMutate({action:'mark',mark:{...ref,type:'text',length:ref.text.length}});
     getSelection().removeAllRanges();
     jfPdfJsRenderMarks();
   }''')
   page.wait_for_function('jfDeskWorkspace.marks?.some(m=>m.type==="text")',timeout=15000)
   ck('Text marker persisted',page.evaluate('jfDeskWorkspace.marks.some(m=>m.type==="text")'))
   ck('Text highlight registered',page.evaluate('CSS.highlights.has("jf-pdf-marks-blue")'))
   def tap_text():
    page.evaluate('getSelection().removeAllRanges()')
    page.evaluate('''()=>{const h=jfPdfMarkHits.get(0).find(x=>x.kind==='text');const b=h.range.getClientRects()[0],v=jfReadCenter.getBoundingClientRect();jfReadCenter.scrollTop+=b.top-(v.top+100)}''')
    page.wait_for_timeout(100)
    coords=page.evaluate('''()=>{const h=jfPdfMarkHits.get(0).find(x=>x.kind==='text');const b=h.range.getClientRects()[0];return {x:(b.left+b.right)/2,y:(b.top+b.bottom)/2}}''')
    page.mouse.click(coords['x'],coords['y'])
   tap_text()
   ck('Click marked PDF text opens contextual menu',page.locator('#jfPdfMarkMenu').is_visible())
   page.locator('#jfPdfMarkMenu [data-color="amber"]').click()
   page.wait_for_function('jfDeskWorkspace.marks.some(m=>m.type==="text"&&m.color==="amber")',timeout=15000)
   ck('Change marker color saved',page.evaluate('jfDeskWorkspace.marks.find(m=>m.type==="text").color==="amber"'))
   ck('Amber PDF highlight applied',page.evaluate('CSS.highlights.has("jf-pdf-marks-amber")'))
   tap_text();page.locator('#jfPdfMarkMenu [data-action="excerpt"]').click()
   ck('Marked passage opens notebook chooser',page.locator('#jfPdfQuoteChooser').is_visible())
   page.locator('#jfPdfQuoteNewTitle').fill('测试摘录笔记');page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.notes.some(n=>n.title==="测试摘录笔记"&&n.quotes.length)',timeout=15000)
   ck('Excerpt saved to chosen notebook',page.evaluate('jfDeskWorkspace.notes.some(n=>n.quotes.some(q=>q.text.includes("JUST FUN")))'))
   tap_text();page.keyboard.press('Escape')
   ck('Esc dismisses menu without closing book',page.locator('#jfPdfMarkMenu').is_hidden() and page.locator('#jfReader').is_visible())
   tap_text();page.locator('#jfPdfMarkMenu [data-action="delete"]').click()
   page.wait_for_function('!jfDeskWorkspace.marks.some(m=>m.type==="text")',timeout=15000)
   ck('Deleting marker does not delete quote',page.evaluate('jfDeskWorkspace.notes.some(n=>n.quotes.some(q=>q.text.includes("JUST FUN")))'))
   # Page mark interactions still work for existing page marks.
   page.evaluate('''async()=>{await jfDeskMutate({action:'mark',mark:{bookId:jfDeskBook.id,chapter:0,type:'page'}});jfPdfJsRenderMarks();}''')
   page.wait_for_function('jfDeskWorkspace.marks.some(m=>m.type==="page")',timeout=15000)
   page.locator('.jfPdfPageBookmark').first.scroll_into_view_if_needed()
   rect=page.locator('.jfPdfPageBookmark').first.bounding_box();page.mouse.click(rect['x']+rect['width']/2,rect['y']+8)
   ck('Click page bookmark opens menu',page.locator('#jfPdfMarkMenu').is_visible())
   page.locator('#jfPdfMarkMenu [data-color="rose"]').click()
   page.wait_for_function('jfDeskWorkspace.marks.some(m=>m.type==="page"&&m.color==="rose")',timeout=15000)
   ck('Page mark color persists',page.evaluate('jfDeskWorkspace.marks.some(m=>m.type==="page"&&m.color==="rose")'))
   # Area highlight: clicking region can change color or quote its cropped image.
   page.evaluate('''async()=>{await jfDeskMutate({action:'mark',mark:{bookId:jfDeskBook.id,chapter:0,type:'area',area:[.15,.33,.32,.18]}});jfPdfJsRenderMarks()}''')
   rect=page.locator('.jfPdfSavedArea').first.bounding_box()
   page.mouse.click(rect['x']+rect['width']/2,rect['y']+rect['height']/2)
   ck('Click saved area opens actions',page.locator('#jfPdfMarkMenu').is_visible())
   page.locator('#jfPdfMarkMenu [data-color="violet"]').click()
   page.wait_for_function('jfDeskWorkspace.marks.some(m=>m.type==="area"&&m.color==="violet")',timeout=15000)
   ck('Area color saved and visual updates',page.locator('.jfPdfSavedArea[data-mark-color="violet"]').count()>=1)
   rect=page.locator('.jfPdfSavedArea').first.bounding_box();page.mouse.click(rect['x']+rect['width']/2,rect['y']+rect['height']/2)
   page.locator('#jfPdfMarkMenu [data-action="excerpt"]').click()
   ck('Area excerpt opens last notebook by default',page.locator('#jfPdfQuoteChooser').is_visible() and page.evaluate('jfDeskQuoteTarget===jfDeskQuoteLast'))
   page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.notes.some(n=>n.quotes.some(q=>q.type==="image"))',timeout=18000)
   ck('Area marker excerpt persists compressed note image',page.evaluate('jfDeskWorkspace.notes.some(n=>n.quotes.some(q=>q.type==="image"&&q.image.length<215000))'))
   awaitDummy=page.evaluate('''async()=>{await jfDeskLoadWorkspace();jfPdfJsRenderMarks();return jfDeskWorkspace.marks.some(m=>m.type==='area'&&m.color==='violet')}''')
   ck('Marker colors survive workspace reload',awaitDummy)
   # Atomic API rejection / previous mark unchanged.
   result=page.evaluate('''async()=>{try{await jfDeskMutate({action:'recolor-mark',mark:jfDeskWorkspace.marks.find(m=>m.type==='page'),color:'javascript:evil'});return 'unsafe';}catch(err){return String(err.message)}}''')
   ck('Invalid color rejected',result!='unsafe')
   ck('Rejected write retains mark and color',page.evaluate('jfDeskWorkspace.marks.some(m=>m.type==="page"&&m.color==="rose")'))
   ck('Original PDF untouched',hashlib.sha256((library/'mark-test.pdf').read_bytes()).hexdigest()==original)
   ck('No browser page error',not errors)
   browser.close()
 finally:
  if proc:stop(proc,log)
print('TOTAL',count)
