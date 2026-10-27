#!/usr/bin/env python3
"""v6.96: IME composition snapshots, PDF original capture, display-only note inversion, variable gallery response."""
import base64,hashlib,io,pathlib,tempfile,urllib.parse,urllib.request,urllib.error,math
from PIL import Image
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
N=0
def ck(name,test):
 global N
 if not test: raise AssertionError(name)
 N+=1;print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v696-') as td:
 root=pathlib.Path(td);media=root/'media';media.mkdir();book=media/'验证.txt';book.write_text('这是测试书籍，包含段落文本。'*60,encoding='utf8');orig=hashlib.sha256(book.read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',media,root/'home');origin=f'http://127.0.0.1:{port}'
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1440,'height':900},accept_downloads=True);page.set_default_timeout(8500)
   errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    if u.path.startswith('/api/'):
     data=req.post_data_buffer if req.method=='POST' else None
     headers={'Content-Type':req.headers.get('content-type','application/json')} if data else {}
     rr=urllib.request.Request(origin+u.path+('?' +u.query if u.query else ''),data=data,method=req.method,headers=headers)
     try:
      with urllib.request.urlopen(rr,timeout=40) as res:st=res.status;body=res.read();mime=res.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:st=e.code;body=e.read();mime=e.headers.get('Content-Type','application/json')
     route.fulfill(status=st,body=body,headers={'Content-Type':mime})
    else: route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',proxy)
   html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
   page.set_content(html,wait_until='domcontentloaded',timeout=25000);page.wait_for_timeout(250)
   ck('PDF screenshot converter available',page.evaluate("typeof jfPdfJsAreaToJpeg==='function'"))
   uris=page.evaluate('''()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=100;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,320,100);ctx.fillStyle='#141414';ctx.fillRect(20,15,180,70);
      const node=document.createElement('div');node.style.cssText='width:320px;height:100px;position:absolute;left:0;top:0';document.body.append(node);
      const record={canvas,el:node};const area={x:0,y:0,w:320,h:100};
      jfPdfJsState.night=false;const day=jfPdfJsAreaToJpeg(record,area);
      jfPdfJsState.night=true;const night=jfPdfJsAreaToJpeg(record,area);
      jfPdfJsState.night=false;node.remove();return {day,night};
    }''')
   ck('Night and day generate identical original screenshot JPEG bytes',uris['day']==uris['night'])
   sample=Image.open(io.BytesIO(base64.b64decode(uris['day'].split(',')[1])))
   ck('Original photo stays white paper with dark ink',all(c>230 for c in sample.getpixel((3,3))) and all(c<55 for c in sample.getpixel((70,50))))
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click();page.locator('#jfDeskNewNote').click()
   page.locator('#jfDeskNoteTitle').fill('IME、原图展示测试')
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='IME、原图展示测试')",timeout=18000)
   # imitate actual IME: compositionstart, transient pinyin updates, commit Chinese characters
   history=page.evaluate('''()=>{
      const root=document.getElementById('jfDeskExcerpt'),c=root.querySelector('.jfNoteTextChunk');root.focus();
      const start=jfNoteHistory.states.length;
      root.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
      for(const str of ["s","s'z","s'z"]){
        c.textContent=str;root.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:str,isComposing:true}));
      }
      const during=jfNoteHistory.states.length;
      c.textContent='甚至';
      root.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'甚至'}));
      root.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'甚至'}));
      return {start,during};
    }''')
   page.wait_for_timeout(80)
   after=page.evaluate('''()=>({n:jfNoteHistory.states.length, text:document.getElementById('jfDeskExcerpt').innerText, last:jfNoteHistory.states.at(-1)?.blocks[0]?.text})''')
   ck('IME phonetic drafts produce zero history snapshots',history['start']==history['during'])
   ck('Composition commit generates only one new undo step',after['n']==history['start']+1 and '甚至' in after['text'])
   ck('No phonetic drafts recorded in snapshots',page.evaluate("jfNoteHistory.states.every(s=>s.blocks.every(b=>b.kind!=='text'||!b.text.includes(\"s'z\")))"))
   page.locator('#jfDeskExcerpt').focus();page.keyboard.press('Control+z');page.wait_for_timeout(50)
   ck('Ctrl+Z removes committed Chinese word in one step',page.locator('#jfDeskExcerpt').inner_text().find('甚至')<0)
   page.keyboard.press('Control+y');page.wait_for_timeout(50)
   ck('Ctrl+Y restores full committed Chinese word', '甚至' in page.locator('#jfDeskExcerpt').inner_text())
   page.wait_for_timeout(850)
   # inject original image excerpt; display inversion MUST NOT mutate original stored/exported image
   print('STEP image quote mutation begin',flush=True)
   page.evaluate('''async uri=>{
     await jfDeskSaveEditor();
     const note=jfDeskWorkspace.notes.find(n=>n.title==='IME、原图展示测试'),book=jfBooks[0];
     await jfDeskMutate({action:'note',note:{...note,quotes:[{type:'image',bookId:book.id,chapter:0,image:uri,imageWidth:100,imageAlign:'left',text:''}],blocks:[{kind:'text',text:'甚至'},{kind:'quote',index:0},{kind:'text',text:''}]}});
     await jfDeskSelectNote(note.id);
   }''',uris['day'])
   print('STEP image quote mutation complete',page.evaluate('''()=>({active:jfDeskActiveNote,notes:jfDeskWorkspace.notes.map(n=>({id:n.id,quotes:n.quotes?.length,blocks:n.blocks?.length,format:n.format})),img:document.querySelectorAll('.jfDeskQuoteImage').length,err:document.getElementById('jfDeskSaveState').textContent})'''),flush=True)
   card=page.locator('#jfDeskExcerpt .jfDeskImageQuote');card.wait_for()
   src_before=page.locator('.jfDeskQuoteImage').get_attribute('src')
   ck('Note display begins with original PDF image',src_before==uris['day'] and page.locator('#jfNoteImagesNight').get_attribute('aria-pressed')=='false')
   page.locator('#jfNoteImagesNight').click()
   ck('Note image night visual CSS is active without bitmap mutation',page.evaluate('''()=>getComputedStyle(document.querySelector('#jfDeskExcerpt .jfDeskQuoteImage')).filter.includes('invert(1)')'''))
   ck('Night mode never rewrites image src or note quote',page.locator('.jfDeskQuoteImage').get_attribute('src')==src_before and page.evaluate('jfNoteLiveQuotes[0].image')==src_before)
   before=page.evaluate('jfNoteExportContent()')
   ck('MD and HTML export reference original full data URL under dark mode',src_before in before['markdown'] and src_before in before['html'])
   page.locator('#jfNoteImagesNight').click()
   ck('Light mode removes inversion without altering export',page.evaluate("getComputedStyle(document.querySelector('.jfDeskQuoteImage')).filter==='none'") and page.evaluate('jfNoteExportContent().html')==before['html'])
   # Gallery zoom speed range and wheel response from same full application
   raw=Image.new('RGB',(200,120),'#b5dcd3');buf=io.BytesIO();raw.save(buf,format='PNG')
   uri='data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()
   print('STEP gallery begin',flush=True)
   page.evaluate('''src=>{const item={kind:'image',key:'test-pic',relativeDir:'',originalName:'图.png',title:'图.png',livePhoto:false,mediaUrl:src};allItems=[item];libraryMode='image';imageViewerList=[item];showImageViewer(0);}''',uri)
   page.wait_for_timeout(160)
   surface=page.locator('.photoImageSurface').bounding_box();assert surface
   x=surface['x']+surface['width']/2;y=surface['y']+surface['height']/2
   page.mouse.move(x,y);page.mouse.wheel(0,-100);page.wait_for_timeout(50)
   zoom=page.evaluate('photoViewerScale')
   ck('Faster default zoom is visibly stronger than v6.95',1.20<zoom<1.23)
   page.locator('#photoMoreToggle').click()
   ck('Gallery exposes persistent zoom speed range',page.locator('#photoZoomSpeedRange').count()==1 and '1.6×' in page.locator('#photoZoomSpeedValue').inner_text())
   page.eval_on_selector('#photoZoomSpeedRange',"el=>{el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}))}")
   ck('Zoom speed slider drives wheel factor rather than cosmetic label',page.evaluate('''()=>jfPhotoZoomSpeed===3 && Math.abs(jfPhotoWheelFactor(-100)-Math.exp(.354))<.00001'''))
   page.locator('#photoMoreToggle').click();page.evaluate('setPhotoScale(1)')
   page.mouse.move(x,y);page.mouse.wheel(0,-100);page.wait_for_timeout(60)
   ck('High-speed setting gives significantly faster zoom',page.evaluate('photoViewerScale')>1.40)
   ck('Uncaught JavaScript exceptions absent',not errs)
   browser.close()
  ck('Original library media unchanged',hashlib.sha256(book.read_bytes()).hexdigest()==orig)
 finally:
  if proc:stop(proc,log)
print('TOTAL',N,flush=True)
