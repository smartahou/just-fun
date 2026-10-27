#!/usr/bin/env python3
"""v6.78: real PDF.js two-page latency and progressive paint checks."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,json
import fitz
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0
def ck(name,ok,detail=''):
 global count
 if not ok:raise AssertionError(f'{name}: {detail}')
 count+=1;print('PASS',name,detail,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v678-') as td:
 base=pathlib.Path(td);lib=base/'media';lib.mkdir()
 pdf=fitz.open()
 for j in range(10):
  p=pdf.new_page(width=520,height=720)
  for k in range(35):p.insert_text((35,35+18*k),f'PAGE {j+1} LINE {k} Reading performance regression.',fontsize=10)
 pdf.save(lib/'Reader.pdf');pdf.close()
 source_sha=hashlib.sha256((lib/'Reader.pdf').read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':940})
   errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    data=req.post_data.encode() if req.method=='POST' and req.post_data else None
    r=urllib.request.Request(root+(u.path or '/')+('?' +u.query if u.query else ''),data=data,method=req.method,headers={'Content-Type':'application/json'} if data else {})
    try:
     with urllib.request.urlopen(r,timeout=50) as resp:st=resp.status;body=resp.read();ct=resp.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e:st=e.code;body=e.read();ct=e.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=body,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready" && jfPdfJsState.pages.get(1)?.status==="ready"',timeout=45000)
   # Inject a deterministic delayed text extraction to reproduce a large PDF.
   page.evaluate('''()=>{
      window.__delayTextMs=500;
      const original=jfPdfJsState.doc.getPage.bind(jfPdfJsState.doc);
      jfPdfJsState.doc.getPage=async function(n){
        const p=await original(n);
        if(n<=2 && !p.__delayedGetText){
          p.__delayedGetText=true;
          const orig=p.getTextContent.bind(p);
          p.getTextContent=async function(...args){await new Promise(r=>setTimeout(r,window.__delayTextMs));return orig(...args);};
        }
        return p;
      };
    }''')
   # Capture progressive paint before TextLayer is ready.
   data=page.evaluate('''async()=>{
     jfDeskPdfScale(.55);
     await new Promise(r=>setTimeout(r,120));
     const original=jfPdfJsState.pages.get(0).canvas;
     const now=performance.now();
     jfDeskPdfScale(.45);
     const layoutReady=document.getElementById('jfPdfJsSheet').classList.contains('jfPdfTwoPage');
     return {layoutReady,old:original?.width||0,at:now};
   }''')
   ck('Crossing 50% switches spread layout synchronously',data['layoutReady'])
   page.wait_for_function('jfPdfJsState.pages.get(0)?.canvas?.width>600',timeout=30000)
   early=page.evaluate('''()=>({status:jfPdfJsState.pages.get(0).status,canvas:jfPdfJsState.pages.get(0).canvas.width,hasLayer:!!jfPdfJsState.pages.get(0).el.querySelector('.jfPdfTextLayer'),spread:document.getElementById('jfPdfJsSheet').classList.contains('jfPdfTwoPage')})''')
   print('EARLY_PAINT',early,flush=True)
   ck('Actual newly rendered canvas becomes visible',early['canvas']>data['old'])
   ck('New canvas appears before delayed text layer completes',early['status']!="ready" and not early['hasLayer'])
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready" && jfPdfJsState.pages.get(1)?.status==="ready"',timeout=35000)
   ck('Both facing pages receive completed selectable text',page.evaluate('''()=>[0,1].every(i=>!!jfPdfJsState.pages.get(i).el.querySelector('.jfPdfTextLayer'))'''))
   first=page.evaluate('''()=>({width:jfPdfJsState.pages.get(0).canvas.width,status:jfPdfJsState.pages.get(0).status,revision:jfPdfJsState.pages.get(0).revision})''')
   page.evaluate('jfDeskPdfScale(.30)')
   after=page.evaluate('''()=>({width:jfPdfJsState.pages.get(0).canvas.width,status:jfPdfJsState.pages.get(0).status,revision:jfPdfJsState.pages.get(0).revision})''')
   ck('Zoom changes below 50% without needless identical-width redraw',after==first)
   # Test physical wheel debounce; suppress new work on a no-op floor-width change.
   page.evaluate('jfDeskPdfScale(.55)')
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=35000)
   page.evaluate('''()=>{window.__finishAt=0;const orig=jfPdfGestureFinish;jfPdfGestureFinish=function(){window.__finishAt=performance.now();return orig()};window.__wheelAt=performance.now();jfReadCenter.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:27,clientX:340,clientY:270,bubbles:true,cancelable:true}));}''')
   page.wait_for_function('window.__finishAt>0',timeout=3000)
   delay=page.evaluate('window.__finishAt-window.__wheelAt');print('WHEEL_COMMIT_MS',round(delay,1),flush=True)
   ck('Wheel settle is noticeably faster than old 380 ms',delay<290,round(delay,1))
   ck('Wheel zoom commits below 50%',page.evaluate('jfDeskPdfZoom<.5 && jfPdfJsIsSpread()'))
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=25000)
   page.evaluate('''()=>{window.__floorCanvas=jfPdfJsState.pages.get(0).canvas;window.__floorRevision=jfPdfJsState.pages.get(0).revision;jfPdfGestureZoom(jfDeskPdfZoom*.78,'wheel',340,270);}''')
   page.wait_for_function('jfPdfPinchBaseZoom===null',timeout=3000)
   ck('Ctrl-wheel below 44vw floor reuses existing canvas and text layer',page.evaluate('''()=>jfPdfJsState.pages.get(0).canvas===window.__floorCanvas && jfPdfJsState.pages.get(0).revision===window.__floorRevision && jfPdfJsState.pages.get(0).status==='ready' '''))
   ck('Source PDF bytes untouched',hashlib.sha256((lib/'Reader.pdf').read_bytes()).hexdigest()==source_sha)
   ck('No uncaught browser errors',not errors,errors)
   browser.close()
 finally:
  if proc:stop(proc,log)
print('TOTAL',count,flush=True)
