#!/usr/bin/env python3
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib
import fitz
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0

def ck(name,cond):
 global count
 if not cond: raise AssertionError(name)
 count+=1;print('PASS',name,flush=True)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v674-') as td:
 base=pathlib.Path(td);lib=base/'media';lib.mkdir()
 doc=fitz.open();pdoc=doc.new_page(width=560,height=720)
 font='/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'
 assert pathlib.Path(font).is_file(), '需要系统 Noto Serif CJK 测试字体'
 pdoc.insert_font(fontname='BookCJK',fontfile=font)
 # Exactly identical baseline spacing for every row: no paragraph-gap cue.
 # This reproduces the "好兆头。" -> "1月10日" transition in the supplied screenshot.
 content=[
  (63,115,'国民党统治区内的报纸，也很难引用那一套'),
  (63,162,'中央日报那一套来了，甚至恰恰相反。'),
  (63,209,'但是对这位敏感的老报人来说，这是个'),
  (63,256,'好兆头'),
  (115,303,'1月10日，蒋介石在日记中又写道：'),
  (63,350,'时到行辕会议，听取报告。对于敌情'),
  (63,397,'殊为忧虑，与宜生谈增援东北事项。'),
 ]
 for x,y,line in content:pdoc.insert_text((x,y),line,fontname='BookCJK',fontsize=19)
 # The last ideograph is strong ink, while its separately drawn faint circle
 # emulates a low-contrast Chinese full stop, 0.4 glyph widths farther right.
 # Use actual vector content rendered through PDF.js, never an overlay fake.
 pdoc.draw_circle((146,251),3.4,color=(.89,.89,.89),width=1.9)
 doc.save(lib/'paragraph-trim.pdf');doc.close()
 origin=hashlib.sha256((lib/'paragraph-trim.pdf').read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home');root=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':940})
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    data=req.post_data.encode() if req.method=='POST' and req.post_data else None
    r=urllib.request.Request(root+(u.path or '/')+('?' +u.query if u.query else ''),data=data,method=req.method,headers={'Content-Type':'application/json'} if data else {})
    try:
      with urllib.request.urlopen(r,timeout=45) as resp: st=resp.status;body=resp.read();ct=resp.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e: st=e.code;body=e.read();ct=e.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=st,body=body,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(root+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
   page.wait_for_function('jfPdfJsState.pages.get(0)?.status==="ready"',timeout=40000)
   page.locator('#jfPdfCapture').click()
   overlay=page.locator('.jfPdfVirtualPage[data-pdf-index="0"] .jfPdfCaptureLayer');overlay.wait_for(timeout=10000)
   page.evaluate('jfReadCenter.scrollTop+=jfPdfJsPagePosition(jfPdfJsState.pages.get(0))-20')
   page.wait_for_timeout(120)
   rect=overlay.bounding_box();assert rect and rect['width']>250
   # Draw a region spanning both paragraphs.
   x=rect['x']+119;y=rect['y']+150
   page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+720,y+570,steps=9);page.mouse.up()
   info=page.evaluate('''()=>{const c=jfPdfJsState.selection;const groups=jfPdfCaptureParagraphGroups(c.rows,Math.min(c.start.row,c.end.row),Math.max(c.start.row,c.end.row),c.area);
     return {areaW:c.area.w,area:c.area,rows:c.rows,segments:c.segments.map(s=>({x:s.x,w:s.w,y:s.y})),groups};}''')
   ck('Real PDF still has two paragraphs',len(info['groups'])==2)
   ck('Seven CJK rows remain selected',len(info['segments'])==7)
   a=info['area'];seg=info['segments'];rows=info['rows'];start=a['x']
   print('DRAGGED_START',start,'FIRST_STRIP_START',seg[0]['x'],'MIDDLE_STRIP_START',seg[1]['x'],flush=True)
   ck('First strip exceeds dragged boundary by 8-13px',8<=start-seg[0]['x']<=13)
   ck('Full-width middle strip also exceeds dragged boundary',8<=start-seg[1]['x']<=13)
   ck('Actual short line maintains 8-13px left ink clearance',8<=rows[3]['left']-seg[3]['x']<=13)
   ck('Short paragraph still excludes major trailing whitespace',seg[3]['w']<a['w']*.40)
   ck('Faint punctuation remains included',seg[3]['x']+seg[3]['w']>=149.4/560*1000)
   # Read genuine PDF canvas ink near the left drag border.
   px=page.evaluate('''()=>{
     const choice=jfPdfJsState.selection,record=jfPdfJsState.pages.get(0),c=record.canvas;
     const rx=c.width/record.el.offsetWidth,ry=c.height/record.el.offsetHeight;
     const row=choice.rows[0],ctx=c.getContext('2d');
     const sx=Math.round((choice.area.x-24)*rx),ex=Math.round((choice.area.x+8)*rx);
     const sy=Math.max(0,Math.round(row.top*ry)),ey=Math.min(c.height,Math.round(row.bottom*ry));
     const data=ctx.getImageData(sx,sy,ex-sx,ey-sy).data;
     let inkX=Infinity;
     for(let y=0;y<ey-sy;y++)for(let x=0;x<ex-sx;x++){
       const i=(y*(ex-sx)+x)*4;
       if(data[i]*.3+data[i+1]*.59+data[i+2]*.11<185)inkX=Math.min(inkX,(sx+x)/rx);
     }
     const ss=choice.segments;
     return {inkX,selectionLeft:ss[0].x,dragLeft:choice.area.x};
   }''')
   print('ORIGINAL_RASTER_INK',px,flush=True)
   ck('Actual ink outside initial drag is safely inside preview',px['inkX']<px['dragLeft'] and px['inkX']-px['selectionLeft']>=5)
   jpeg=page.evaluate('''async(inkX)=>{
     const choice=jfPdfJsState.selection,record=jfPdfJsState.pages.get(0),ss=choice.segments;
     const left=Math.min(...ss.map(s=>s.x)),top=Math.min(...ss.map(s=>s.y));
     const right=Math.max(...ss.map(s=>s.x+s.w)),bottom=Math.max(...ss.map(s=>s.y+s.h));
     const uri=jfPdfJsAreaToJpeg(record,choice.area,ss),image=new Image();image.src=uri;await image.decode();
     const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
     const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
     const row=choice.rows[0];let lowest=255;
     for(let xx=inkX;xx<=inkX+3;xx+=1)for(let yy=row.top+3;yy<row.bottom-3;yy+=2){
       const u=Math.floor((xx-left)/(right-left)*canvas.width),v=Math.floor((yy-top)/(bottom-top)*canvas.height);
       if(u<0||v<0||u>=canvas.width||v>=canvas.height)continue;
       const pixels=ctx.getImageData(u,v,1,1).data;
       lowest=Math.min(lowest,pixels[0],pixels[1],pixels[2]);
     }
     return {lowest,bytes:uri.length};
   }''',px['inkX'])
   print('JPEG_OUTSIDE_DRAG_INK',jpeg,flush=True)
   ck('Saved JPEG includes glyph ink originally outside dragged rectangle',jpeg['lowest']<200)
   ck('Original PDF bytes unchanged',hashlib.sha256((lib/'paragraph-trim.pdf').read_bytes()).hexdigest()==origin)
   ck('No uncaught browser exception',not errors)
   browser.close()
 finally:
  if proc: stop(proc,log)
print('TOTAL',count,flush=True)
