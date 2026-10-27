#!/usr/bin/env python3
"""v7.02: screenshot fragments in one quote must share visual pixel density."""
import base64,hashlib,io,pathlib,tempfile,urllib.request,urllib.parse,urllib.error
from PIL import Image,ImageDraw,ImageFont
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
checks=0
def check(name,condition):
 global checks
 if not condition:raise AssertionError(name)
 checks+=1;print('PASS',name,flush=True)

def jpeg(w,h,words):
 im=Image.new('RGB',(w,h),'#f6f7f5');draw=ImageDraw.Draw(im)
 f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',36)
 draw.text((18,12),words,fill='#202b33',font=f)
 b=io.BytesIO();im.save(b,format='JPEG',quality=91)
 return 'data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v702-') as d:
 tmp=pathlib.Path(d);lib=tmp/'media';lib.mkdir()
 source=lib/'图书.txt';source.write_text('真实书籍内容。'*100,encoding='utf-8')
 digest=hashlib.sha256(source.read_bytes()).hexdigest()
 images=[jpeg(1200,165,'PAGE 35: longer excerpt text follows'),jpeg(410,75,'PAGE 36: end')]
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home');origin=f'http://127.0.0.1:{port}'
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1440,'height':900},accept_downloads=True)
   errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    body=req.post_data.encode() if req.method=='POST' and req.post_data else None
    request=urllib.request.Request(origin+u.path+('?' +u.query if u.query else ''),data=body,method=req.method,headers={'Content-Type':'application/json'} if body else {})
    try:
     with urllib.request.urlopen(request,timeout=45) as resp:status=resp.status;data=resp.read();mime=resp.headers.get('Content-Type','application/json')
    except urllib.error.HTTPError as e:status=e.code;data=e.read();mime=e.headers.get('Content-Type','application/json')
    route.fulfill(status=status,body=data,headers={'Content-Type':mime})
   page.route('http://justfun.test/**',proxy)
   html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
   page.set_content(html,wait_until='domcontentloaded',timeout=25000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click()
   page.locator('#jfDeskNewNote').click();page.locator('#jfDeskNoteTitle').fill('跨页字体一致性测试')
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='跨页字体一致性测试')",timeout=15000)
   page.evaluate('''async(images)=>{
     const note=jfDeskWorkspace.notes.find(n=>n.title==='跨页字体一致性测试');const book=jfBooks[0];
     const q={type:'image',image:images[0],pages:[{chapter:34,image:images[0]},{chapter:35,image:images[1]}],text:'',bookId:book.id,chapter:34,anchorStart:null};
     await jfDeskMutate({action:'note',note:{...note,quotes:[q],blocks:[{kind:'text',text:'测试正文'},{kind:'quote',index:0},{kind:'text',text:'后续想法'}]}});
     await jfDeskSelectNote(note.id);
   }''',images)
   page.wait_for_function("document.querySelectorAll('.jfDeskQuoteImageGroup .jfDeskQuotePage').length===2 && document.querySelector('.jfDeskQuoteImageGroup .jfDeskQuotePage:nth-child(2)')?.style.getPropertyValue('--jf-group-page-width')",timeout=15000)
   def size():
    return page.evaluate('''()=>{const card=document.querySelector('.jfDeskImageQuote'),sections=[...card.querySelectorAll('.jfDeskQuotePage')], imgs=sections.map(s=>s.querySelector('img')),boxes=imgs.map(img=>img.getBoundingClientRect()), labels=sections.map(s=>s.querySelector('span').getBoundingClientRect());return {card:card.getBoundingClientRect().width,frames:sections.map(s=>s.getBoundingClientRect().width),pixels:imgs.map(img=>img.naturalWidth),actual:boxes.map(b=>b.width),top:boxes.map(b=>b.top),labels:labels.map(b=>b.bottom),ratios:imgs.map((img,i)=>boxes[i].width/img.naturalWidth)};}''')
   data=size()
   check('One quote block contains both pages',page.locator('.jfDeskImageQuote').count()==1 and len(data['frames'])==2)
   check('Short page is proportionally narrower',.30<data['actual'][1]/data['actual'][0]<.39)
   check('Both pages have identical native-pixel screen scale',abs(data['ratios'][0]-data['ratios'][1])<.003)
   check('Page badges do not overlap image pixels',all(b+1<=t for b,t in zip(data['labels'],data['top'])))
   check('Page labels preserve both page identities',page.locator('.jfDeskQuotePageLabel').all_inner_texts()==['第 35 页','第 36 页'])
   check('An unscaled quote can display full width',data['frames'][0]>data['frames'][1]*2.5)
   # Scale the whole excerpt; every sub-image must keep identical scale.
   page.evaluate("""()=>{const input=document.querySelector('.jfNoteImageRange');input.value='50';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}""")
   half=size()
   check('Global quote slider scales first page',half['actual'][0]<data['actual'][0]*.90)
   check('Global quote slider preserves equal sub-page scale',abs(half['ratios'][0]-half['ratios'][1])<.003)
   page.evaluate('''async()=>{await jfDeskSaveEditor();await jfDeskSelectNote(jfDeskActiveNote)}''')
   page.wait_for_function("document.querySelector('.jfDeskQuoteImageGroup .jfDeskQuotePage:nth-child(2)')?.style.getPropertyValue('--jf-group-page-width')",timeout=12000)
   after=size()
   check('Saved quote loads with normalized image sizes',abs(after['ratios'][0]-after['ratios'][1])<.003)
   check('Original JPEG bytes are retained in note',page.evaluate('''(imgs)=>{const note=jfDeskWorkspace.notes.find(n=>n.title==='跨页字体一致性测试');return note.quotes[0].pages.every((p,i)=>p.image===imgs[i]);}''',images))
   check('Both source JPEGs are present in HTML export',page.evaluate('''(imgs)=>{const html=jfNoteExportContent().html;return imgs.every(img=>html.includes(img));}''',images))
   check('Both source JPEGs are present in Markdown export',page.evaluate('''(imgs)=>{const md=jfNoteExportContent().markdown;return imgs.every(img=>md.includes(img));}''',images))
   check('No unexpected page error',not errors)
   page.screenshot(path='/mnt/data/JustFun-v7.02-note-consistency.png')
   browser.close()
  check('Original book bytes untouched',digest==hashlib.sha256(source.read_bytes()).hexdigest())
 finally:
  if proc:stop(proc,log)
print('TOTAL',checks,flush=True)
