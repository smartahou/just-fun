#!/usr/bin/env python3
"""v6.85 real Chromium: undo/redo, quote restoration, divider size, persistent image layout."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,io,base64,json
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
checks=0
def ck(label,value):
 global checks
 if not value:raise AssertionError(label)
 checks+=1;print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v685-') as d:
 tmp=pathlib.Path(d);lib=tmp/'media';lib.mkdir();(lib/'甲.txt').write_text('书中真实文字。'*120,encoding='utf8')
 src=hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest();proc=lg=None
 im=Image.new('RGB',(650,220),'white');ImageDraw.Draw(im).text((20,100),'JUST FUN IMAGE',fill='black');buf=io.BytesIO();im.save(buf,format='JPEG',quality=86)
 jpeg='data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,tmp/'home');origin=f'http://127.0.0.1:{port}'
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1440,'height':900},accept_downloads=True)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url);body=req.post_data.encode() if req.method=='POST' and req.post_data else None
    r=urllib.request.Request(origin+u.path+('?' +u.query if u.query else ''),data=body,method=req.method,headers={'Content-Type':'application/json'} if body else {})
    try:
     with urllib.request.urlopen(r,timeout=40) as res:status=res.status;data=res.read();mime=res.headers.get('Content-Type','application/json')
    except urllib.error.HTTPError as e:status=e.code;data=e.read();mime=e.headers.get('Content-Type','application/json')
    route.fulfill(status=status,body=data,headers={'Content-Type':mime})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=25000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click()
   page.wait_for_timeout(100)
   sep=page.locator('#jfDeskNotesDivider');box=sep.bounding_box();assert box
   before=page.evaluate("()=>{const p=document.getElementById('jfDeskNotes'),l=document.getElementById('jfDeskNoteList');return {width:l.getBoundingClientRect().width,inner:p.clientWidth-parseFloat(getComputedStyle(p).paddingLeft)-parseFloat(getComputedStyle(p).paddingRight)}}")
   page.mouse.move(box['x']+box['width']/2,box['y']+100);page.mouse.down();page.mouse.move(box['x']+220,box['y']+100,steps=6);page.mouse.up()
   after=page.evaluate("()=>{const p=document.getElementById('jfDeskNotes'),l=document.getElementById('jfDeskNoteList');return {width:l.getBoundingClientRect().width,inner:p.clientWidth-parseFloat(getComputedStyle(p).paddingLeft)-parseFloat(getComputedStyle(p).paddingRight)}}")
   ck('Divider dragged notes index wider',after['width']>before['width']+30)
   ck('Index width never exceeds 45% of work area',after['width']<=after['inner']*.45+2)
   page.locator('#jfDeskNewNote').click();page.locator('#jfDeskNoteTitle').fill('图片控制与撤销测试')
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='图片控制与撤销测试')",timeout=15000)
   page.evaluate('''async(img)=>{
     const old=jfDeskWorkspace.notes.find(n=>n.title==='图片控制与撤销测试');
     const b=jfBooks[0];const q={type:'image',image:img,text:'来自原书',bookId:b.id,chapter:0,anchorStart:null};
     await jfDeskMutate({action:'note',note:{...old,quotes:[q],blocks:[{kind:'text',text:'前面的想法'},{kind:'quote',index:0},{kind:'text',text:'后面的想法'}]}});
     await jfDeskSelectNote(old.id);
   }''',jpeg)
   card=page.locator('.jfDeskImageQuote');card.wait_for()
   ck('Image appears in native note document',card.count()==1)
   ck('Image defaults to left alignment',card.get_attribute('data-image-align')=='left')
   page.locator('#jfNoteAllImageWidth').select_option('60')
   ck('Toolbar applies width to all note images',card.locator('.jfNoteImagePercent').inner_text()=='60%')
   card.locator('[data-image-align=right]').click()
   ck('Per-image alignment changes to right',card.get_attribute('data-image-align')=='right')
   page.locator('.jfNoteImageRange').fill('40')
   ck('Per-image width control works',card.locator('.jfNoteImagePercent').inner_text()=='40%')
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='图片控制与撤销测试'&&n.quotes?.[0]?.imageWidth===40&&n.quotes?.[0]?.imageAlign==='right')",timeout=15000)
   ck('Image width and alignment stored durably',page.evaluate("()=>{const q=jfDeskWorkspace.notes.find(n=>n.title==='图片控制与撤销测试').quotes[0];return q.imageWidth===40&&q.imageAlign==='right'}"))
   page.locator('.jfDeskNoteItem.active').click()
   ck('Image settings survive note reopening',page.locator('.jfDeskImageQuote').get_attribute('data-image-align')=='right' and page.locator('.jfNoteImagePercent').inner_text()=='40%')
   # first backspace confirms, second removes, then undo restores even after autosave.
   page.locator('.jfDeskImageQuote').click(position={'x':10,'y':10});page.keyboard.press('Backspace')
   ck('Quote deletion requires initial confirmation',page.locator('.jfDeskQuoteDeleteArmed').count()==1)
   page.keyboard.press('Backspace')
   ck('Second delete removes quote',page.locator('.jfDeskImageQuote').count()==0)
   page.keyboard.press('Control+z')
   ck('Ctrl+Z restores deleted image quote',page.locator('.jfDeskImageQuote').count()==1)
   page.keyboard.press('Control+y')
   ck('Ctrl+Y removes restored quote again',page.locator('.jfDeskImageQuote').count()==0)
   page.keyboard.press('Control+z')
   ck('Second undo again restores image',page.locator('.jfDeskImageQuote').count()==1)
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='图片控制与撤销测试'&&n.quotes?.length===1)",timeout=16000)
   ck('Undo restored quote persisted',page.evaluate("jfDeskWorkspace.notes.some(n=>n.title==='图片控制与撤销测试'&&n.quotes.length===1)"))
   # Ctrl+Z/Y also handles ordinary prose, not just atomic image blocks.
   chunk=page.locator('#jfDeskExcerpt .jfNoteTextChunk').first
   chunk.click();page.keyboard.press('End');page.keyboard.type('XYZ')
   ck('Normal text typed into one editor', 'XYZ' in chunk.inner_text())
   page.keyboard.press('Control+z')
   ck('Ctrl+Z restores earlier prose text', 'XYZ' not in page.locator('#jfDeskExcerpt .jfNoteTextChunk').first.inner_text())
   page.keyboard.press('Control+y')
   ck('Ctrl+Y redoes normal text edits', 'XYZ' in page.locator('#jfDeskExcerpt .jfNoteTextChunk').first.inner_text())
   page.screenshot(path='/mnt/data/jf-v685-note-ui.png')
   ck('No uncaught page errors',not errors)
   browser.close()
  ck('Book file was not touched',hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest()==src)
 finally:
  if proc:stop(proc,lg)
print('TOTAL',checks,flush=True)
