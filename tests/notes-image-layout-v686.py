#!/usr/bin/env python3
"""v6.86 real Chromium: bulk image slider, centered controls, no wrap at small image sizes, and room after divider."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,io,base64
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
checks=0

def ck(label,value):
 global checks
 if not value: raise AssertionError(label)
 checks+=1; print('PASS',label,flush=True)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v686-') as d:
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
   sep=page.locator('#jfDeskNotesDivider'); box=sep.bounding_box(); assert box
   note_spacing=page.evaluate("""()=>{const editor=document.getElementById('jfDeskEditor'); const s=getComputedStyle(editor); return {pad:parseFloat(s.paddingLeft)||0};}""")
   ck('Editor keeps extra left padding away from divider', note_spacing['pad'] >= 16)
   page.locator('#jfDeskNewNote').click();page.locator('#jfDeskNoteTitle').fill('图片布局测试')
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='图片布局测试')",timeout=15000)
   page.evaluate('''async(img)=>{
     const old=jfDeskWorkspace.notes.find(n=>n.title==='图片布局测试');
     const b=jfBooks[0];const q={type:'image',image:img,text:'来自原书',bookId:b.id,chapter:0,anchorStart:null};
     await jfDeskMutate({action:'note',note:{...old,quotes:[q],blocks:[{kind:'text',text:'前面的想法'},{kind:'quote',index:0},{kind:'text',text:'后面的想法'}]}});
     await jfDeskSelectNote(old.id);
   }''',jpeg)
   card=page.locator('.jfDeskImageQuote'); card.wait_for()
   toolbar_range=page.locator('#jfNoteAllImageWidth')
   page.evaluate("el=>el.value='60'", toolbar_range.element_handle())
   toolbar_range.dispatch_event('input')
   ck('Toolbar bulk slider updates all image widths', card.locator('.jfNoteImagePercent').inner_text()=='60%')
   page.evaluate("el=>el.value='20'", toolbar_range.element_handle())
   toolbar_range.dispatch_event('input'); toolbar_range.dispatch_event('change')
   ck('Bulk slider can shrink image to 20 percent', card.locator('.jfNoteImagePercent').inner_text()=='20%')
   ck('Toolbar bulk percentage mirrors slider value', page.locator('#jfNoteAllImagePercent').inner_text()=='20%')
   layout=page.evaluate("""()=>{const card=document.querySelector('.jfDeskImageQuote').getBoundingClientRect(); const frame=document.querySelector('.jfDeskQuoteImageFrame').getBoundingClientRect(); const controls=document.querySelector('.jfDeskImageControls').getBoundingClientRect(); const range=document.querySelector('.jfDeskImageControls .jfNoteImageRange').getBoundingClientRect(); const pct=document.querySelector('.jfDeskImageControls .jfNoteImagePercent').getBoundingClientRect(); const left=document.querySelector('.jfDeskImageControls [data-image-align="left"]').getBoundingClientRect(); const center=document.querySelector('.jfDeskImageControls [data-image-align="center"]').getBoundingClientRect(); const right=document.querySelector('.jfDeskImageControls [data-image-align="right"]').getBoundingClientRect(); const cstyle=getComputedStyle(document.querySelector('.jfDeskImageControls')); return {cardW:card.width,frameW:frame.width,controlsW:controls.width,rangeMid:range.y+range.height/2,pctMid:pct.y+pct.height/2,leftMid:left.y+left.height/2,centerMid:center.y+center.height/2,rightMid:right.y+right.height/2,flexWrap:cstyle.flexWrap};}""")
   ck('Image card stays full width while image frame shrinks', layout['cardW'] > layout['frameW'] * 2)
   ck('Image controls stay on a single row without wrapping', layout['flexWrap']=='nowrap' and abs(layout['rangeMid']-layout['pctMid'])<3 and abs(layout['leftMid']-layout['centerMid'])<3 and abs(layout['centerMid']-layout['rightMid'])<3)
   # Per-image range also uses centered handle-friendly geometry.
   geom=page.evaluate("""()=>{const s=getComputedStyle(document.querySelector('.jfDeskImageControls .jfNoteImageRange'));return {h:parseFloat(s.height)||0};}""")
   ck('Per-image range keeps stable click height', geom['h'] >= 20)
   page.screenshot(path='/mnt/data/jf-v686-note-ui.png')
   ck('No uncaught page errors', not errors)
   browser.close()
  ck('Book file was not touched', hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest()==src)
 finally:
  if proc: stop(proc,lg)
print('TOTAL',checks,flush=True)
