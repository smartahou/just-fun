#!/usr/bin/env python3
"""v6.64 PDF pinch compositing, single sharpen stage, centered navigator.
All data and servers are isolated. Real bundled PDF.js, Worker and Chromium.
"""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib
import fitz
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
cnt=0
def ck(label,ok):
 global cnt
 if not ok:raise AssertionError(label)
 cnt+=1;print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v664-') as tmp:
 base=pathlib.Path(tmp);lib=base/'media';lib.mkdir();pdf=fitz.open()
 for i in range(6):
  page=pdf.new_page(width=500,height=700)
  page.insert_text((30,95),f'PDF ZOOM TEST PAGE {i+1}',fontsize=22)
 pdf.save(lib/'Document.pdf');pdf.close()
 original=hashlib.sha256((lib/'Document.pdf').read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':900});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    body=req.post_data.encode() if req.method=='POST' else None
    rq=urllib.request.Request(root+(u.path or '/')+('?' +u.query if u.query else ''),data=body,method=req.method,headers={'Content-Type':'application/json'} if body else {})
    try:
     with urllib.request.urlopen(rq,timeout=35) as res:st=res.status;data=res.read();ct=res.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e:st=e.code;data=e.read();ct=e.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=data,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=16000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=25000)
   ck('Real PDF.js page and Canvas render',page.locator('.jfPdfVirtualPage canvas').count()>0)
   geom=page.evaluate('''()=>{let a=document.querySelector('#jfReadPrev').getBoundingClientRect(),b=document.querySelector('#jfPdfGoControl').getBoundingClientRect(),c=document.querySelector('#jfReadNext').getBoundingClientRect();return {leftGap:b.left-a.right,rightGap:c.left-b.right,yLeft:(a.top+a.bottom)/2,yCenter:(b.top+b.bottom)/2,yRight:(c.top+c.bottom)/2}}''')
   print('NAV_GEOMETRY',geom,flush=True)
   ck('Previous and next icons vertically aligned',abs(geom['yLeft']-geom['yCenter'])<=1 and abs(geom['yRight']-geom['yCenter'])<=1)
   ck('Pager arrows have tight spacing',-1<=geom['leftGap']<=5 and -1<=geom['rightGap']<=5)
   page.evaluate('''()=>{window.__oldCanvas=jfPdfJsState.pages.get(0).canvas;window.__zoomResizeCalls=0;let original=jfPdfJsResize;jfPdfJsResize=function(){window.__zoomResizeCalls++;return original();};}''')
   page.evaluate('''()=>{for(let i=0;i<12;i++)jfReadCenter.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-4,bubbles:true,cancelable:true}));}''')
   page.wait_for_timeout(110)
   ck('Continuous pinch uses CSS preview, not expensive PDF renderer',page.evaluate('window.__zoomResizeCalls===0 && jfPdfJsState.pages.get(0).canvas===window.__oldCanvas && document.getElementById("jfPdfJsSheet").style.transform.includes("scale(")'))
   page.wait_for_timeout(500)
   ck('Pinch settled and rendered at most once',page.evaluate('window.__zoomResizeCalls===1 && jfDeskPdfZoom>1.2'))
   ck('PDF ten-page window is retained after pinch',page.evaluate('jfPdfJsState.pages.get(0).el.isConnected && jfPdfJsState.pages.size===6'))
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=25000)
   ck('High resolution PDF Canvas ready after gesture',page.evaluate('jfPdfJsState.pages.get(0).canvas.width>window.__oldCanvas.width'))
   page.locator('#jfPdfSharpen').click()
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=30000)
   ck('Sharpen one strong setting',page.evaluate('jfPdfJsState.sharp===1 && document.querySelectorAll(".jfPdfSharpStrong").length===6 && document.querySelectorAll(".jfPdfSharpSoft").length===0'))
   ck('Strong sharpen filter installed',page.evaluate('getComputedStyle(document.querySelector(".jfPdfSharpStrong canvas")).filter.includes("jfPdfSharpenStrong")'))
   page.locator('#jfPdfSharpen').click()
   ck('Sharpen next click turns directly off',page.evaluate('jfPdfJsState.sharp===0 && !document.querySelector(".jfPdfSharpStrong")'))
   # Two-finger gesture must not start expensive PDF.js redraws until lift.
   touch=page.evaluate('''()=>{
     const el=jfReadCenter;
     const mk=(id,x,y)=>new Touch({identifier:id,target:el,clientX:x,clientY:y,pageX:x,pageY:y});
     const send=(type,pts)=>el.dispatchEvent(new TouchEvent(type,{touches:pts,targetTouches:pts,changedTouches:pts,bubbles:true,cancelable:true}));
     window.__zoomTouchBefore=window.__zoomResizeCalls;
     send('touchstart',[mk(1,370,240),mk(2,470,240)]);
     send('touchmove',[mk(1,350,240),mk(2,490,240)]);
     return {trans:document.querySelector('#jfPdfJsSheet').style.transform,zoom:jfDeskPdfZoom};
   }''')
   page.wait_for_timeout(90)
   ck('Two touch points also use composite preview',page.evaluate('window.__zoomResizeCalls===window.__zoomTouchBefore && jfPdfPinchBaseZoom!==null && jfDeskPdfZoom>1.2'))
   page.evaluate('''()=>{let el=jfReadCenter;el.dispatchEvent(new TouchEvent('touchend',{touches:[],targetTouches:[],changedTouches:[],bubbles:true}));}''')
   page.wait_for_timeout(100)
   ck('Two-finger lift commits one final re-render',page.evaluate('window.__zoomResizeCalls===window.__zoomTouchBefore+1 && jfPdfPinchBaseZoom===null'))
   ck('Source PDF unchanged',hashlib.sha256((lib/'Document.pdf').read_bytes()).hexdigest()==original)
   ck('No uncaught browser exception',not errors)
   browser.close()
 finally:
  if proc:stop(proc,log)
print('TOTAL',cnt,flush=True)
