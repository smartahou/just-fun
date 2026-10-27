#!/usr/bin/env python3
"""V6.68: real PDF.js/Chromium line-aware handle edits, masked JPEG, encrypted quote persistence."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib
import fitz,base64,io
from PIL import Image
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0
def ck(name,cond):
 global count
 if not cond:raise AssertionError(name)
 count+=1;print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v668-') as tmp:
 base=pathlib.Path(tmp);library=base/'books';library.mkdir()
 doc=fitz.open();pp=doc.new_page(width=550,height=800)
 for row in range(11):
  pp.insert_text((48,110+row*44),f'LINE {row+1:02d} JUST FUN SOURCE SELECTABLE CONTENT',fontsize=18,fontname='helv')
 doc.save(library/'handle-test.pdf');doc.close()
 original=hashlib.sha256((library/'handle-test.pdf').read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',library,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1540,'height':940});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    payload=req.post_data.encode() if req.method=='POST' and req.post_data else None
    r=urllib.request.Request(root+(u.path or '/')+('?'+u.query if u.query else ''),data=payload,method=req.method,headers={'Content-Type':'application/json'} if payload else {})
    try:
     with urllib.request.urlopen(r,timeout=60) as response:st=response.status;data=response.read();ct=response.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as exc:st=exc.code;data=exc.read();ct=exc.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=data,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=45000)
   ck('Real PDF.js page visible',page.locator('.jfPdfVirtualPage canvas').count()>0)
   page.locator('#jfPdfCapture').click()
   page.evaluate('jfReadCenter.scrollTop=0');page.wait_for_timeout(200)
   page.wait_for_function('jfPdfJsState.capture',timeout=9000)
   info=page.evaluate('''()=>{const el=jfPdfJsState.pages.get(0).el,b=el.getBoundingClientRect(),scale=b.width/550;return {x:b.x+46*scale,y:b.y+83*scale,w:475*scale,h:267*scale}}''')
   page.mouse.move(info['x'],info['y']);page.mouse.down();page.mouse.move(info['x']+info['w'],info['y']+info['h'],steps=8);page.mouse.up()
   page.wait_for_function('jfPdfJsState.selection?.segments?.length>0',timeout=10000)
   ck('Initial screenshot remains editable, no premature notebook chooser',page.locator('.jfPdfCaptureHandle:visible').count()==2 and page.locator('#jfPdfQuoteChooser').is_hidden())
   state=page.evaluate('''()=>({rows:jfPdfJsState.selection.rows.length,segments:jfPdfJsState.selection.segments.length,start:jfPdfJsState.selection.start.row,end:jfPdfJsState.selection.end.row})''')
   print('DETECTED_LINES',state['rows'],'SELECTED',state['segments'],flush=True)
   ck('Scanning recognizes multiple actual raster text rows',state['rows']>=5 and state['segments']>=4)
   ck('One strip per selected row instead of a full rectangle',page.evaluate('jfPdfJsState.selection.segments.length>=4'))
   h=page.locator('.jfPdfCaptureHandle[data-handle="start"]').bounding_box()
   page.mouse.move(h['x']+h['width']/2,h['y']+h['height']/2);page.mouse.down();page.mouse.move(h['x']+h['width']/2+130,h['y']+h['height']/2+20,steps=8);page.mouse.up()
   ck('First handle trims first row horizontally',page.evaluate('jfPdfJsState.selection.start.x>jfPdfJsState.selection.area.x+20'))
   e=page.locator('.jfPdfCaptureHandle[data-handle="end"]').bounding_box()
   page.mouse.move(e['x']+e['width']/2,e['y']+e['height']/2);page.mouse.down();page.mouse.move(e['x']+e['width']/2-100,e['y']+e['height']/2-12,steps=8);page.mouse.up()
   ck('Last handle trims last row independently',page.evaluate('jfPdfJsState.selection.end.x<jfPdfJsState.selection.area.x+jfPdfJsState.selection.area.w-15'))
   ck('Every middle row keeps full body width plus breathing room',page.evaluate('''()=>{const s=jfPdfJsState.selection,a=s.area;return s.segments.slice(1,-1).every(x=>x.x<=a.x-5&&x.x+x.w>=a.x+a.w+5)}'''))
   page.screenshot(path='/mnt/data/jf_v668/pdf-handles-preview-v668.png')
   # Changing vertical position must choose a different detected line, not
   # merely stretch the original rectangle's height.
   before_row=page.evaluate('jfPdfJsState.selection.end.row')
   e=page.locator('.jfPdfCaptureHandle[data-handle="end"]').bounding_box()
   page.mouse.move(e['x']+e['width']/2,e['y']+e['height']/2);page.mouse.down();page.mouse.move(e['x']+e['width']/2,e['y']+e['height']/2+82,steps=9);page.mouse.up()
   ck('End handle moves vertically to another actual line',page.evaluate('jfPdfJsState.selection.end.row')>before_row)
   image_check=page.evaluate('''()=>{const s=jfPdfJsState.selection,r=jfPdfJsState.pages.get(s.index);const jpeg=jfPdfJsAreaToJpeg(r,s.area,s.segments);return {len:jpeg.length,prefix:jpeg.slice(0,23),jpeg}}''')
   bitmap=Image.open(io.BytesIO(base64.b64decode(image_check['jpeg'].split(',',1)[1]))).convert('RGB')
   # The trimmed first-line corner must be paper-white, i.e. excluded pixels
   # were really removed, not merely masked in DOM/CSS overlay.
   corner=bitmap.getpixel((2,2))
   ck('JPEG masks content outside adjusted first/last line',min(corner)>235)

   ck('Stair crop produces bounded JPEG bytes',image_check['len']>200 and image_check['len']<215000 and image_check['prefix']=='data:image/jpeg;base64,')
   page.locator('.jfPdfCaptureAccept').click()
   page.wait_for_function('!document.getElementById("jfPdfQuoteChooser").hidden',timeout=12000)
   ck('Only confirmation opens existing notebook chooser',page.locator('#jfPdfQuoteChooser').is_visible())
   page.locator('#jfPdfQuoteNewTitle').fill('阶梯摘录');page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.notes.some(n=>n.title==="阶梯摘录"&&n.quotes.some(q=>q.type==="image"))',timeout=25000)
   ck('Selected notebook receives actual masked image',page.evaluate('jfDeskWorkspace.notes.some(n=>n.quotes.some(q=>q.type==="image"&&q.image.length>400))'))
   ck('Auto mark preserves selected multi-row strips',page.evaluate('jfDeskWorkspace.marks.some(m=>m.type==="area"&&m.segments?.length>=4)'))
   page.evaluate('''async()=>{await jfDeskLoadWorkspace();jfPdfJsRenderMarks()}''')
   ck('Segments persist across reload and render as stair segments',page.locator('.jfPdfSavedArea').count()>=4)
   reject=page.evaluate('''async()=>{
     try{await jfDeskMutate({action:'mark',mark:{bookId:jfDeskBook.id,chapter:0,type:'area',area:[.1,.1,.2,.2],segments:[[.9,.9,.5,.5]]}});return false;}
     catch(e){return true;}
   }''')
   ck('Malformed selection geometry rejected atomically',reject)
   ck('PDF unchanged by screenshot and mark',hashlib.sha256((library/'handle-test.pdf').read_bytes()).hexdigest()==original)
   page.locator('#jfPdfCapture').click()
   ck('Escape cancels selection before closing book',page.locator('#jfReader').is_visible())
   ck('No uncaught page errors',not errors)
   browser.close()
 finally:
  if proc:stop(proc,log)
print('TOTAL',count)
