#!/usr/bin/env python3
"""v6.55 four-customer-feedback regression, bounded/offline/isolated."""
import tempfile,pathlib,os,hashlib,json,urllib.parse,urllib.request,urllib.error,stat
from playwright.sync_api import sync_playwright
from PIL import Image,ImageDraw
import fitz
from isolated import ROOT,launch,stop,urlopen
checks=[]
def ck(name,ok):
 assert ok,name
 checks.append(name);print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v655-') as tmp:
 p=pathlib.Path(tmp); lib=p/'多媒体书籍';lib.mkdir()
 im=Image.new('RGB',(760,1040),'#eef0e2');d=ImageDraw.Draw(im);d.rectangle((55,55,705,980),outline='#516e5a',width=8);d.text((110,170),'ACTUAL FIRST PAGE',fill='#303d40');im.save(p/'first.jpg',quality=85)
 pdf=fitz.open(); page=pdf.new_page(width=390,height=535);page.insert_image(page.rect,filename=str(p/'first.jpg'));pdf.save(str(lib/'扫描试验.pdf'));pdf.close()
 (lib/'短篇.txt').write_text('这是一篇文章'*400,encoding='utf8')
 hashes={x.name:hashlib.sha256(x.read_bytes()).hexdigest() for x in lib.iterdir()}
 bin=p/'bin';bin.mkdir(); stub=bin/'pdftoppm';stub.write_text('#!/bin/sh\nexit 127\n');stub.chmod(0o755)
 original_path=os.environ.get('PATH','');os.environ['PATH']=str(bin)+':'+original_path
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,p/'home');base=f'http://127.0.0.1:{port}'
  st,_,raw=urlopen(base+'/api/books?refresh=1');books=json.loads(raw)['books'];pdf_book=next(b for b in books if b['ext']=='PDF')
  ck('existing work directory scans books',st==200 and len(books)==2)
  st,headers,data=urlopen(base+'/api/books/cover?id='+pdf_book['id'],timeout=14)
  ck('JPEG first-page preview works without Poppler',st==200 and headers.get('Content-Type')=='image/jpeg' and data[:3]==b'\xff\xd8\xff' and len(data)>4000)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    if u.path.startswith(('/api/books','/api/reading')):
     target=base+u.path+('?' +u.query if u.query else '')
     q=urllib.request.Request(target,data=req.post_data.encode() if req.method=='POST' else None,method=req.method,headers={'Content-Type':'application/json'} if req.method=='POST' else {})
     try:
      with urllib.request.urlopen(q,timeout=12) as response: status=response.status;body=response.read();mime=response.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as ex:status=ex.code;body=ex.read();mime=ex.headers.get('Content-Type','application/json')
     route.fulfill(status=status,body=body,headers={'Content-Type':mime})
    else:route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',proxy)
   html=urlopen(base+'/')[2].decode();page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded')
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click()
   page.wait_for_timeout(450);page.locator('#jfDeskNewNote').click()
   ratio=page.evaluate('''()=>{let n=document.querySelector('#jfDeskNotes').getBoundingClientRect();let e=document.querySelector('.jfDeskEditor').getBoundingClientRect();let l=document.querySelector('.jfDeskNoteList').getBoundingClientRect();return {width:n.width,editor:e.width,list:l.width,body:innerWidth}}''')
   print('NOTES_GEOMETRY',ratio,flush=True)
   ck('notes compact index with full-width manuscript',ratio['width']>=1350 and ratio['width']<=1440 and ratio['editor']>=1100 and ratio['list']<=140 and ratio['editor']>400)
   # exercise precise touchpad ctrl+wheel on synthetic video and its parent, not via deleted zoom button.
   pinch=page.evaluate('''()=>{
      const surface=document.createElement('div');surface.style.cssText='position:fixed;left:80px;top:80px;width:620px;height:360px';
      const video=document.createElement('video');surface.append(video);document.body.append(surface);
      Object.defineProperty(video,'videoWidth',{value:1280});Object.defineProperty(video,'videoHeight',{value:720});
      installFocusZoom(video);
      let ev=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-120});
      video.dispatchEvent(ev);
      const first=getFocusState(video);
      const zoom=first.zoom,enabled=first.enabled,prevented=ev.defaultPrevented;
      for(let i=0;i<15;i++){video.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:150}));}
      const restored=!getFocusState(video).enabled;
      surface.remove();return {zoom,enabled,prevented,restored};
   }''')
   ck('Windows trackpad Ctrl+Wheel zooms without button',pinch['enabled'] and pinch['zoom']>1 and pinch['prevented'])
   ck('pinching smaller returns to normal video',pinch['restored'])
   ck('no page errors',not errors)
   browser.close()
  ck('book sources remain byte identical',all(hashlib.sha256((lib/k).read_bytes()).hexdigest()==v for k,v in hashes.items()))
 finally:
  os.environ['PATH']=original_path
  if proc:stop(proc,lg)
print('PASS TOTAL',len(checks))
