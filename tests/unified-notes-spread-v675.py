#!/usr/bin/env python3
"""v6.75: browser verification of actual two-page PDF, previews and in-flow notes."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,json
import fitz
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0
def ck(name,ok):
 global count
 if not ok: raise AssertionError(name)
 count+=1;print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v675-') as td:
 base=pathlib.Path(td);lib=base/'media';lib.mkdir()
 doc=fitz.open()
 for i in range(8):
  p=doc.new_page(width=520,height=720)
  p.insert_text((50,135),f'PDF PAGE {i+1}: READING NOTATION TEST',fontsize=19)
 doc.save(lib/'Reader.pdf');doc.close()
 original=hashlib.sha256((lib/'Reader.pdf').read_bytes()).hexdigest()
 (lib/'Text.txt').write_text('这是 TXT 章节原文。' * 40,encoding='utf-8')
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':920})
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    data=req.post_data.encode() if req.method=='POST' and req.post_data else None
    r=urllib.request.Request(root+(u.path or '/')+('?' +u.query if u.query else ''),data=data,method=req.method,headers={'Content-Type':'application/json'} if data else {})
    try:
     with urllib.request.urlopen(r,timeout=45) as resp:st=resp.status;body=resp.read();ct=resp.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e:st=e.code;body=e.read();ct=e.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=body,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click()
   page.locator('.jfBookTile').filter(has_text='Reader').first.click()
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=40000)
   ck('PDF opens in single-page mode',not page.locator('#jfPdfJsSheet').evaluate('(el)=>el.classList.contains("jfPdfTwoPage")'))
   page.evaluate('jfDeskPdfScale(.45)')
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"&&jfPdfJsState.pages.get(1)?.status==="ready"',timeout=35000)
   a=page.evaluate('''()=>{const b=jfPdfJsState.pages.get(0).el.getBoundingClientRect(),c=jfPdfJsState.pages.get(1).el.getBoundingClientRect();return {spread:jfPdfJsIsSpread(),width:b.width,otherWidth:c.width,dy:Math.abs(b.top-c.top),dx:c.left-b.left,viewport:innerWidth};}''')
   print('SPREAD',a,flush=True)
   ck('PDF becomes a paired spread below 50%',a['spread'] and a['dx']>a['width']*.9 and a['dy']<8)
   ck('Each side stays >=44vw',a['width']+1>=a['viewport']*.44 and a['otherWidth']+1>=a['viewport']*.44)
   ck('Zoom value is really below 50%',abs(page.evaluate('jfDeskPdfZoom')-.45)<.001)
   page.evaluate('jfDeskPdfScale(.5)')
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=35000)
   ck('50% returns to single page',not page.evaluate('jfPdfJsIsSpread()') and not page.locator('#jfPdfJsSheet').evaluate('(el)=>el.classList.contains("jfPdfTwoPage")'))
   # Return to spread and capture a region on the right-hand page.
   page.evaluate('jfDeskPdfScale(.45)')
   page.wait_for_function('jfPdfJsState.pages.get(1)?.status==="ready"',timeout=35000)
   page.locator('#jfPdfCapture').click()
   page.evaluate('jfReadCenter.scrollTop+=jfPdfJsPagePosition(jfPdfJsState.pages.get(1))-20')
   page.wait_for_timeout(150)
   overlay=page.locator('.jfPdfVirtualPage[data-pdf-index="1"] .jfPdfCaptureLayer')
   r=overlay.bounding_box();assert r and r['width']>100
   x=r['x']+60;y=r['y']+60
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+180,y+140,steps=6);page.mouse.up()
   page.locator('.jfPdfVirtualPage[data-pdf-index="1"] .jfPdfCaptureMark:visible').click()
   page.wait_for_function('jfDeskWorkspace.marks.some(m=>m.type==="area"&&m.chapter===1)',timeout=12000)
   ck('Right-hand spread screenshot marks its actual page',page.evaluate('jfDeskWorkspace.marks.some(m=>m.type==="area"&&m.chapter===1)'))
   page.locator('#jfPdfMarksListToggle').click()
   ck('Mark list uses renamed heading',page.locator('#jfPdfMarksListHead').count()==0 and '标记列表' in page.locator('.jfPdfMarksListHead').inner_text())
   page.wait_for_function('document.querySelector(".jfPdfMarkPreview")?.naturalWidth>0',timeout=30000)
   ck('Area mark shows rendered image preview',page.locator('.jfPdfMarkPreview').count()==1)
   ck('Page number is secondary metadata',page.locator('.jfPdfMarkPage').first.inner_text().startswith('第 2 页'))
   panel_metrics=page.evaluate('''()=>{const p=document.getElementById('jfPdfMarksList').getBoundingClientRect(),img=document.querySelector('.jfPdfMarkPreview').getBoundingClientRect(),source=document.querySelector('.jfPdfMarkPreview');return {rightGap:window.innerWidth-p.right,top:p.top,imgWidth:img.width,panelWidth:p.width,sourceWidth:source.naturalWidth,sourceHeight:source.naturalHeight};}''')
   print('PREVIEW_RESOLUTION',panel_metrics,flush=True)
   ck('Mark list defaults to upper-right',panel_metrics['rightGap']<60 and panel_metrics['top']<70)
   ck('Preview takes most available width',panel_metrics['imgWidth']>panel_metrics['panelWidth']*.72)
   ck('Preview is high resolution rather than upscaled 250px thumbnail',panel_metrics['sourceWidth']>=panel_metrics['imgWidth']*1.9 and panel_metrics['sourceWidth']>800)
   decoded=page.evaluate('''async()=>{const img=document.querySelector('.jfPdfMarkPreview');await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(Math.min(pixels[i],pixels[i+1],pixels[i+2])<185)ink++;return {ink,width:canvas.width,height:canvas.height};}''')
   print('PREVIEW_INK',decoded,flush=True)
   ck('Full-resolution preview contains rendered PDF ink',decoded['ink']>100)
   page.locator('#jfPdfMarksList').screenshot(path='/mnt/data/jf-v677-preview-proof.png')

   drag_head=page.locator('.jfPdfMarksListHead');hb=drag_head.bounding_box();assert hb
   page.mouse.move(hb['x']+70,hb['y']+18);page.mouse.down();page.mouse.move(hb['x']-60,hb['y']+110,steps=8);page.mouse.up()
   moved=page.evaluate('''()=>{const p=document.getElementById('jfPdfMarksList').getBoundingClientRect();return {left:p.left,top:p.top,right:p.right};}''')
   ck('Mark list title bar remains draggable',moved['top']>panel_metrics['top']+65)
   handle=page.locator('#jfPdfMarksListResize');rb=handle.bounding_box();assert rb
   before=page.evaluate('''()=>{const p=document.getElementById('jfPdfMarksList').getBoundingClientRect();return {left:p.left,right:p.right,top:p.top,width:p.width,height:p.height};}''')
   page.mouse.move(rb['x']+8,rb['y']+8);page.mouse.down();page.mouse.move(rb['x']-115,rb['y']+80,steps=8);page.mouse.up()
   after=page.evaluate('''()=>{const p=document.getElementById('jfPdfMarksList').getBoundingClientRect();return {left:p.left,right:p.right,top:p.top,width:p.width,height:p.height};}''')
   print('RESIZE',before,after,flush=True)
   ck('Lower-left grip grows panel toward the left',after['left']<before['left']-70 and after['width']>before['width']+70)
   ck('Upper-right remains fixed while resizing',abs(after['right']-before['right'])<3 and abs(after['top']-before['top'])<3)
   page.evaluate('(n)=>window.__jfTestOldPreviewWidth=n',panel_metrics['sourceWidth'])
   page.wait_for_function('''()=>{const i=document.querySelector('.jfPdfMarkPreview'),panel=document.getElementById('jfPdfMarksList');return i?.naturalWidth>window.__jfTestOldPreviewWidth+80;}''',timeout=30000)
   ck('Larger panel generates new high resolution image',page.locator('.jfPdfMarkPreview').evaluate('(i)=>i.naturalWidth')>panel_metrics['sourceWidth'])
   page.locator('#jfPdfMarksListClose').click()
   page.evaluate('''async()=>{await jfDeskMutate({action:'mark',mark:{bookId:jfDeskBook.id,chapter:3,type:'page'}});jfPdfJsRenderMarks();}''')
   page.locator('#jfPdfMarksListToggle').click()
   page.wait_for_function('''()=>[...document.querySelectorAll('.jfPdfMarkItem')].some(x=>x.textContent.includes('PDF PAGE 4: READING'))''',timeout=15000)
   ck('Legacy page bookmarks preview actual PDF text',page.locator('#jfPdfMarksListItems').inner_text().find('PDF PAGE 4: READING')>=0)
   page.locator('#jfPdfMarksListClose').click()
   # Text selection quote flows into a note; edited prose before and after it
   page.locator('#jfPdfCapture').click() if page.evaluate('jfPdfJsState.capture') else None
   page.evaluate('jfDeskPdfScale(.75)')
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=35000)
   page.evaluate('''()=>{const layer=jfPdfJsState.pages.get(0).el.querySelector('.jfPdfTextLayer'),word=layer.textContent,at=word.indexOf('READING');const range=jfPdfJsTextRange(layer,at,7);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);}''')
   page.locator('#jfReadExcerpt').click()
   page.locator('#jfPdfQuoteNewTitle').fill('连续笔记')
   page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.notes.some(n=>n.title==="连续笔记")',timeout=12000)
   page.locator('#jfReadNotes').click()
   page.locator('#jfDeskNoteBody').fill('摘录前我先写下想法。')
   page.locator('#jfDeskExcerpt .jfDeskInlineNoteText').last.fill('摘录后继续写自己的思考。')
   page.wait_for_function('jfDeskWorkspace.notes.some(n=>n.title==="连续笔记"&&n.blocks?.filter(b=>b.kind==="text"&&b.text).length===2)',timeout=15000)
   ordering=page.evaluate('''()=>{const n=jfDeskWorkspace.notes.find(n=>n.title==='连续笔记');return {blocks:n.blocks,content:n.content,quotes:n.quotes.length}}''')
   ck('One note interleaves prose and original extract', [b['kind'] for b in ordering['blocks']]==['text','quote','text'] and ordering['quotes']==1)
   ck('Both prose sections saved durably', '摘录前' in ordering['content'] and '摘录后' in ordering['content'])
   ck('One scrolling note canvas contains prose and quote',page.locator('#jfDeskNoteCanvas .jfDeskQuote').count()==1 and page.locator('#jfDeskNoteCanvas textarea').count()==2)
   ck('Lead writing and quote are siblings in one actual flow', page.evaluate('''()=>{const box=document.querySelector('#jfDeskExcerpt'),lead=document.querySelector('#jfDeskNoteBody'),quote=box.querySelector('.jfDeskQuote'),next=box.querySelector('.jfDeskInlineNoteText');return box.contains(lead) && [...box.children].indexOf(lead)<[...box.children].indexOf(quote) && [...box.children].indexOf(quote)<[...box.children].indexOf(next); }'''))
   footer=page.evaluate('''()=>{const a=document.querySelector('.jfDeskQuoteMeta').getBoundingClientRect(),b=document.querySelector('.jfDeskQuoteJump').getBoundingClientRect();return {offset:Math.abs(a.y+a.height/2-b.y-b.height/2),label:document.querySelector('.jfDeskQuoteJump').textContent}}''')
   ck('Quote source and Open original are vertically aligned',footer['offset']<4 and footer['label']=='打开原书')

   # TXT saved text markers share the same content-first list.
   page.locator('#jfDeskNotesClose').click()
   page.locator('#jfReadBack').click()
   page.locator('.jfBookTile').filter(has_text='Text').first.click()
   page.wait_for_function('jfDeskBook?.name?.includes("Text")&&jfReadText.textContent.includes("这是 TXT")',timeout=15000)
   page.evaluate('''()=>{const node=jfReadText.firstChild,r=document.createRange();r.setStart(node,0);r.setEnd(node,8);getSelection().removeAllRanges();getSelection().addRange(r);}''')
   page.locator('#jfReadExcerpt').click()
   page.locator('#jfPdfQuoteOptions [data-note-id="new"]').click()
   page.locator('#jfPdfQuoteNewTitle').fill('文字标记')
   page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.marks.some(m=>m.type==="text" && m.text.includes("TXT"))',timeout=15000)
   ck('TXT excerpt also creates an anchored text mark',page.evaluate('jfDeskWorkspace.marks.some(m=>m.text?.includes("TXT"))'))
   page.locator('#jfPdfMarksListToggle').click()
   ck('TXT mark list shows original content',page.locator('.jfPdfMarkText').first.inner_text().find('TXT')>=0)
   ck('TXT mark list uses small chapter metadata',page.locator('.jfPdfMarkPage').first.inner_text().startswith('第 1 章'))
   page.locator('.jfPdfMarkItem').first.click()
   page.wait_for_function('jfDeskBook?.name?.includes("Text")',timeout=12000)
   ck('TXT mark remains navigable',page.evaluate('jfDeskChapter===0'))
   ck('Source PDF not modified',hashlib.sha256((lib/'Reader.pdf').read_bytes()).hexdigest()==original)
   ck('No uncaught JS errors',not errors)
   browser.close()
 finally:
  if proc:stop(proc,log)
print('TOTAL',count,flush=True)
