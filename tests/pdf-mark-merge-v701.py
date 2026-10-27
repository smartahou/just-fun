#!/usr/bin/env python3
"""v7.01 multi-page area mark grouping, single note excerpt, roundtrip + export."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,json,io,base64,time
import fitz
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
checks=0
def ck(label,truth):
 global checks
 if not truth:raise AssertionError(label)
 checks+=1;print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v701-') as tmp:
 base=pathlib.Path(tmp);library=base/'media';library.mkdir()
 doc=fitz.open()
 for i in range(3):
  page=doc.new_page(width=510,height=720)
  page.insert_text((70,560),f'BOTTOM OF PAGE {i+1} - SENTENCE CONTINUES',fontsize=17)
  page.insert_text((70,95),f'NEXT PAGE {i+1} CONTINUES HERE',fontsize=17)
 doc.save(library/'merge-test.pdf');doc.close()
 original=hashlib.sha256((library/'merge-test.pdf').read_bytes()).hexdigest();proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',library,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':900},accept_downloads=True)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url);payload=req.post_data.encode() if req.method=='POST' and req.post_data else None
    r=urllib.request.Request(root+(u.path or '/')+('?'+u.query if u.query else ''),data=payload,method=req.method,headers={'Content-Type':'application/json'} if payload else {})
    try:
     with urllib.request.urlopen(r,timeout=50) as response:st=response.status;data=response.read();ct=response.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as exc:st=exc.code;data=exc.read();ct=exc.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=data,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('jfPdfJsState.doc && jfPdfJsState.pages.get(0)?.status==="ready"',timeout=40000)
   ck('Native PDF page loaded',page.evaluate('!!jfPdfJsState.doc'))
   page.evaluate('''async()=>{const id=jfDeskBook.id;
    await jfDeskMutate({action:'mark',mark:{bookId:id,chapter:0,type:'area',area:[.12,.71,.70,.09]}});
    await jfDeskMutate({action:'mark',mark:{bookId:id,chapter:1,type:'area',area:[.12,.08,.70,.09]}});
    jfPdfJsRenderMarks();jfPdfJsMarksListRender();}''')
   ck('Two separate source areas',page.evaluate('jfPdfJsMarkUnits().length===2'))
   page.locator('#jfPdfMarksListToggle').click();page.wait_for_timeout(100)
   ck('Two separate list entries before merge',page.locator('.jfPdfMarkUnit').count()==2)
   # Deliberately reload persisted workspace WITHOUT re-rendering the old DOM;
   # UI menu must resolve the source anchor rather than stale object identity.
   page.evaluate('''async()=>{await jfDeskLoadWorkspace();}''')
   page.locator('.jfPdfMarkUnitMenu').first.click()
   # The list can be rendered in either reading direction; use the actual
   # available neighbor, not an assumed next-direction for the first DOM row.
   direction=page.evaluate('''()=>{const root=document.querySelector('#jfPdfMarkMenu');return ['merge-next','merge-prev'].find(a=>{const el=root?.querySelector('[data-action="'+a+'"]');return el&&!el.hidden&&getComputedStyle(el).display!=='none';})||null}''')
   ck('Contextual adjacent-merge action enabled',direction in ('merge-next','merge-prev'))
   page.locator('#jfPdfMarkMenu [data-action="'+direction+'"]').click()
   page.wait_for_function('jfDeskWorkspace.marks?.length===2 && jfDeskWorkspace.marks[0].groupId && jfDeskWorkspace.marks[0].groupId===jfDeskWorkspace.marks[1].groupId',timeout=15000)
   ck('Merge groups both source marks atomically',page.evaluate('jfDeskWorkspace.marks.length===2 && jfDeskWorkspace.marks[0].chapter!==jfDeskWorkspace.marks[1].chapter'))
   ck('Merged visual list has one unit',page.locator('.jfPdfMarkUnit').count()==1)
   ck('Merged unit retains both page previews',page.locator('.jfPdfMarkUnitPart').count()==2)
   ck('Merged unit indicates page range', '1–2' in page.locator('.jfPdfMarkPage').first.inner_text())
   # Make one combined note quote and assert per-page JPEG sources retained.
   page.locator('.jfPdfMarkUnitMenu').first.click()
   page.locator('#jfPdfMarkMenu [data-action="excerpt"]').click()
   page.locator('#jfPdfQuoteChooser').wait_for(state='visible',timeout=20000)
   page.locator('#jfPdfQuoteNewTitle').fill('跨页摘录')
   page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.notes?.some(n=>n.title==="跨页摘录"&&n.quotes?.[0]?.pages?.length===2)',timeout=25000)
   ck('Single note quote contains two page images',page.evaluate('''()=>{const n=jfDeskWorkspace.notes.find(n=>n.title==='跨页摘录');return n.quotes.length===1&&n.quotes[0].pages[0].chapter===0&&n.quotes[0].pages[1].chapter===1}'''))
   ck('Both pages are original JPEG bytes',page.evaluate('jfDeskWorkspace.notes.find(n=>n.title==="跨页摘录").quotes[0].pages.every(p=>p.image.startsWith("data:image/jpeg;base64,"))'))
   page.evaluate('''async()=>{await jfDeskLoadWorkspace();jfPdfJsMarksListRender()}''')
   ck('Group and note survive reload',page.evaluate('jfPdfJsMarkUnits().length===1&&jfDeskWorkspace.notes.find(n=>n.title==="跨页摘录").quotes[0].pages.length===2'))
   # Recolor all group members via contextual menu.
   page.locator('.jfPdfMarkUnitMenu').first.click();page.locator('#jfPdfMarkMenu [data-color="mint"]').click()
   page.wait_for_function('jfDeskWorkspace.marks.every(m=>m.color==="mint")',timeout=15000)
   ck('Recolor affects whole group',page.evaluate('jfDeskWorkspace.marks.length===2&&jfDeskWorkspace.marks.every(m=>m.color==="mint")'))
   # verify two-page card in notes and export both JPEGs.
   page.evaluate('''async()=>{jfPdfJsMarksListClose();await jfDeskOpenNotes();const note=jfDeskWorkspace.notes.find(n=>n.title==='跨页摘录');await jfDeskSelectNote(note.id);}''')
   page.locator('.jfDeskImageQuote').wait_for(timeout=15000)
   ck('Two images displayed within one excerpt block',page.locator('.jfDeskImageQuote').count()==1 and page.locator('.jfDeskImageQuote .jfDeskQuoteImage').count()==2)
   ck('Export includes both original images',page.evaluate(r'jfNoteExportContent().html.match(/<img /g)?.length===2 && jfNoteExportContent().markdown.match(/data:image\/jpeg;base64,/g)?.length===2'))
   # Group editing remains reversible and atomic.
   page.evaluate('''async()=>{const first=jfDeskWorkspace.marks[0];await jfDeskMutate({action:'unmerge-marks',mark:first});jfPdfJsMarksListRender();}''')
   ck('Unmerge keeps both independent source annotations',page.evaluate('jfDeskWorkspace.marks.length===2&&jfPdfJsMarkUnits().length===2&&jfDeskWorkspace.marks.every(m=>!m.groupId)'))
   page.evaluate('''async()=>{const [a,b]=jfDeskWorkspace.marks;await jfDeskMutate({action:'merge-marks',mark:a,neighbor:b});jfPdfJsMarksListRender();}''')
   ck('Re-merge returns to one logical unit',page.evaluate('jfPdfJsMarkUnits().length===1&&jfPdfJsMarkUnits()[0].length===2'))
   page.evaluate('''async()=>{const id=jfDeskBook.id;await jfDeskMutate({action:'mark',mark:{bookId:id,chapter:0,type:'area',area:[.2,.88,.38,.06]}});jfPdfJsMarksListRender();}''')
   ck('Inserting another mark does not split established group',page.evaluate('jfPdfJsMarkUnits().length===2&&jfPdfJsMarkUnits().some(unit=>unit.length===2)'))
   page.evaluate('''async()=>{const mark=jfDeskWorkspace.marks.find(m=>m.groupId);await jfDeskMutate({action:'delete-mark',mark});jfPdfJsMarksListRender();}''')
   ck('Delete group removes both source marks but not unrelated mark',page.evaluate('jfDeskWorkspace.marks.length===1&&!jfDeskWorkspace.marks[0].groupId'))
   ck('Deleting group does not delete historical combined note excerpt',page.evaluate('jfDeskWorkspace.notes.find(n=>n.title==="跨页摘录").quotes[0].pages.length===2'))
   ck('Original PDF unchanged',hashlib.sha256((library/'merge-test.pdf').read_bytes()).hexdigest()==original)
   ck('No page errors',not errors)
   page.screenshot(path='/mnt/data/JustFun-v7.01-merged-note-test.png')
   browser.close()
 finally:
  if proc:stop(proc,log)
print('TOTAL',checks,flush=True)
