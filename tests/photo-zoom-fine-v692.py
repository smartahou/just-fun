#!/usr/bin/env python3
"""Real Chromium fine gallery zoom: wheel, high-resolution trackpad, pinch, grid slider."""
import base64,hashlib,pathlib,tempfile
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
TOTAL=0
def check(name,passed):
 global TOTAL
 if not passed: raise AssertionError(name)
 TOTAL+=1;print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-zoom-692-') as temp:
 root=pathlib.Path(temp);media=root/'media';media.mkdir();pic=media/'小图.png'
 img=Image.new('RGB',(960,540),'#e4e8ef');ImageDraw.Draw(img).rectangle((70,70,890,460),outline='#1a1f30',width=4);img.save(pic)
 source_hash=hashlib.sha256(pic.read_bytes()).hexdigest();proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',media,root/'home')
  html=urlopen(f'http://127.0.0.1:{port}/')[2].decode('utf8')
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   ctx=browser.new_context(viewport={'width':1250,'height':850},has_touch=True)
   page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.set_content(html,wait_until='domcontentloaded');page.wait_for_timeout(250)
   data='data:image/png;base64,'+base64.b64encode(pic.read_bytes()).decode()
   page.evaluate('''src=>{const item={kind:'image',key:'fixture-photo',relativeDir:'root',originalName:'小图.png',title:'小图.png',livePhoto:false,mediaUrl:src};allItems=[item];libraryMode='image';activeFolder='all';renderAssets();showImageViewer(0);}''',data)
   page.locator('#assetViewImg').wait_for(state='visible')
   page.evaluate("document.getElementById('jfAppSplash')?.remove()")
   photo=page.locator('.photoImageSurface').bounding_box();assert photo
   x=photo['x']+photo['width']*.5;y=photo['y']+photo['height']*.5
   page.mouse.move(x,y)
   page.mouse.wheel(0,-100);page.wait_for_timeout(70)
   value=page.evaluate('photoViewerScale')
   check('Balanced wheel notch increases about 9%, not 5% or 16%',1.075<value<1.105)
   page.mouse.wheel(0,100);page.wait_for_timeout(70)
   check('Opposite wheel tick returns smoothly near original size',abs(page.evaluate('photoViewerScale')-1)<.015)
   page.evaluate('setPhotoScale(2)')
   for _ in range(5):page.mouse.wheel(0,-4)
   page.wait_for_timeout(100)
   check('Precision trackpad small events remain controlled',2.01<page.evaluate('photoViewerScale')<2.10)
   page.mouse.wheel(0,1500);page.wait_for_timeout(100)
   check('Oversized wheel event capped to a moderate jump',page.evaluate('photoViewerScale')>1.80)
   page.evaluate('setPhotoScale(1)')
   check('Gallery zoom still clamps at 1x and 8x',page.evaluate('''()=>{setPhotoScale(.25);const a=photoViewerScale;setPhotoScale(900);const b=photoViewerScale;setPhotoScale(1);return a===1&&b===8;}'''))
   session=ctx.new_cdp_session(page)
   def touch(points,kind): session.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'x':xx,'y':yy,'id':i+1} for i,(xx,yy) in enumerate(points)]})
   touch([(x-40,y),(x+40,y)],'touchStart')
   touch([(x-80,y),(x+80,y)],'touchMove');page.wait_for_timeout(80)
   pinch=page.evaluate('photoViewerScale')
   check('Pinch is midway between original and over-damped',1.75<pinch<1.87)
   touch([], 'touchEnd')
   check('Gallery grid slider has balanced 4px steps',page.locator('#photoCellSize').get_attribute('step')=='4')
   page.evaluate('''()=>{document.getElementById('photoCellSize').value='154';document.getElementById('photoCellSize').dispatchEvent(new Event('input',{bubbles:true}));}''')
   check('Fine grid size updates grid without rebuilding media',page.evaluate("photoTileSize===154&&document.getElementById('grid').style.getPropertyValue('--photo-cell')==='154px'"))
   check('Original photo content is unchanged',hashlib.sha256(pic.read_bytes()).hexdigest()==source_hash)
   check('No browser exceptions during zoom and resize',not errors)
   browser.close()
 finally:
  if proc:stop(proc,log)
print('TOTAL',TOTAL,'PASS',flush=True)
