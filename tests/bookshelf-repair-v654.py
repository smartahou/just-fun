#!/usr/bin/env python3
"""v6.54: realistic chromium+Node repairs; never touch user media."""
import pathlib,tempfile,hashlib,json,urllib.request,urllib.parse,urllib.error
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
checks=[]
def ck(s,ok):
 assert ok,s
 print('PASS',s,flush=True);checks.append(s)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v654-') as t:
 p=pathlib.Path(t);root=p/'私人媒体';root.mkdir();(root/'文章.txt').write_text('第一章\n'+('这是文章要引用的文字。'*1300),encoding='utf-8')
 dig={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in root.iterdir() if f.is_file()}
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',root,p/'home');base=f'http://127.0.0.1:{port}'
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1400,'height':900});errors=[]
   page.set_default_timeout(9000)
   page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    r=route.request;u=urllib.parse.urlsplit(r.url)
    if u.path.startswith(('/api/books','/api/reading')):
     req=urllib.request.Request(base+u.path+('?' +u.query if u.query else ''),data=r.post_data.encode() if r.method=='POST' else None,method=r.method,headers={'Content-Type':'application/json'} if r.method=='POST' else {})
     try:
      with urllib.request.urlopen(req,timeout=20) as response: status=response.status;body=response.read();mime=response.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:status=e.code;body=e.read();mime=e.headers.get('Content-Type','application/json')
     route.fulfill(status=status,body=body,headers={'Content-Type':mime})
    else:route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',proxy)
   html=urlopen(base+'/')[2].decode();page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.wait_for()
   ck('book caption and cover titles limited to two lines',page.locator('.jfBookTileTitle').first.evaluate('e=>getComputedStyle(e).webkitLineClamp')=='2' and page.locator('.jfBookCoverText').first.evaluate('e=>getComputedStyle(e).webkitLineClamp')=='2')
   ck('no redundant PDF metadata row',page.locator('.jfBookTileInfo').count()==0)
   page.evaluate('window.__bookNode=document.querySelector(".jfBookTile")')
   page.evaluate('jfBooksLoad()');page.wait_for_timeout(400)
   ck('routine scan leaves existing book DOM and cover intact',page.evaluate('document.querySelector(".jfBookTile")===window.__bookNode'))
   ck('notes icon differs from annotations icon',page.evaluate('document.querySelector("[data-media-kind=notes] svg").outerHTML !== document.querySelector("#clipShelfTop svg").outerHTML'))
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click();page.locator('#jfDeskNewNote').click();page.wait_for_timeout(1200)
   ck('empty note is not auto-created in memory index',page.evaluate('jfDeskWorkspace.notes.length===0'))
   st,_,raw=urlopen(base+'/api/reading/workspace');ck('empty note is not saved on disk',st==200 and len(json.loads(raw)['notes'])==0)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.wait_for_timeout(300)
   ck('discard empty draft while returning to books',page.evaluate('jfDeskWorkspace.notes.length===0'))
   page.locator('.jfBookTile').first.click();page.wait_for_function('jfDeskBook&&jfDeskOutline&&!jfDeskOutline.nativePdf')
   page.locator('#jfReadNotes').click();page.wait_for_timeout(300)
   ck('opening notes during reading does not create a note',page.evaluate('jfDeskWorkspace.notes.length===0'))
   page.locator('#jfDeskNotesClose').click()
   page.evaluate('''()=>{const node=document.querySelector('#jfReadText').firstChild;const full=node.textContent;const i=full.indexOf('这是文章');const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+10);const s=getSelection();s.removeAllRanges();s.addRange(range)}''')
   page.locator('#jfReadExcerpt').click();page.locator('#jfPdfQuoteChooser').wait_for();page.locator('#jfPdfQuoteCommit').click();page.wait_for_function('jfDeskWorkspace.notes.some(n=>n.quotes?.length)',timeout=10000)
   page.locator('#jfReadNotes').click()
   note=page.evaluate('jfDeskWorkspace.notes.find(n=>n.quotes?.length)')
   ck('only explicit excerpt creates a citation note',len(page.evaluate('jfDeskWorkspace.notes'))==1 and len(note['quotes'])==1)
   ck('note standalone, reference scoped to quote',note.get('bookId','')=='' and note['quotes'][0]['bookId'] and not note.get('excerpt',''))
   ck('per-quote jump visible and no generic false source link',page.locator('.jfDeskQuote button').count()==1 and page.locator('#jfDeskJump').is_hidden())
   page.locator('.jfDeskQuote button').click();page.wait_for_function('!document.querySelector("#jfReadText mark")?false:true',timeout=14000)
   ck('excerpt jumps to original and highlights text',page.locator('#jfReadText mark').count()==1)
   ck('zoom action removed from feed and mini player',not page.locator('#feedMagnify').is_visible() and page.evaluate('getComputedStyle(document.querySelector("#feedMagnify")).display')=='none')
   # Synthetic 2-touch video: real browser dispatch, actual production gesture handlers.
   zoom=page.evaluate('''()=>{
     const stage=document.createElement('div');stage.style.cssText='position:fixed;left:40px;top:60px;width:600px;height:340px;z-index:0';
     const v=document.createElement('video');v.style.cssText='width:600px;height:340px;display:block';stage.append(v);document.body.append(stage);
     Object.defineProperty(v,'videoWidth',{value:1280});Object.defineProperty(v,'videoHeight',{value:720});
     installFocusZoom(v);
     function evt(type,id,x,y){v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,clientX:x,clientY:y,isPrimary:id===11}));}
     evt('pointerdown',11,180,150);if(typeof feedTouchGesture!=='undefined')feedTouchGesture.pointerId=11;evt('pointerdown',12,280,150);
     const cancelled=typeof feedTouchGesture==='undefined'||feedTouchGesture.pointerId===null;
     const active=focusZoomStates.get(v)?.enabled;
     evt('pointermove',12,380,150);
     const factor=focusZoomStates.get(v)?.zoom;
     evt('pointerup',12,380,150);evt('pointerup',11,180,150);
     stage.remove();return {active,factor,cancelled};
   }''')
   ck('pinch gesture activates zoom without old button',zoom['active'] and zoom['factor']>1.5)
   ck('pinch cancels feed swipe to avoid accidental video switching',zoom['cancelled'])
   ck('no uncaught chromium exceptions',not errors)
   browser.close()
  ck('all book originals left unchanged',all(hashlib.sha256((root/k).read_bytes()).hexdigest()==v for k,v in dig.items()))
 finally:
  if proc:stop(proc,lg)
print('PASS TOTAL',len(checks))
