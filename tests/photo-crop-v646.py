#!/usr/bin/env python3
"""v6.46 isolated crop UI, save, security, pixel boundaries. Never touches user media."""
import pathlib,tempfile,hashlib,urllib.request,urllib.error,json,time,io,urllib.parse
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
from PIL import Image,ImageDraw

def ck(name,pass_):
    if not pass_:raise AssertionError(name)
    print('PASS',name,flush=True)

def req(url,data,headers):
    try:
        with urllib.request.urlopen(urllib.request.Request(url,data=data,headers=headers,method='POST'),timeout=30) as resp:
            return resp.status,json.load(resp)
    except urllib.error.HTTPError as e:
        return e.code,json.load(e)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-crop-646-') as tmp:
    root=pathlib.Path(tmp);lib=root/'中文媒体资料';lib.mkdir();home=root/'isolated-home'
    pic=lib/'彩色测试图片.png'
    img=Image.new('RGB',(800,600),'white');draw=ImageDraw.Draw(img)
    draw.rectangle((0,0,399,299),fill='red');draw.rectangle((400,0,799,299),fill='blue')
    draw.rectangle((0,300,399,599),fill='green');draw.rectangle((400,300,799,599),fill='yellow')
    img.save(pic)
    jpg=lib/'风景 例子.jpg';Image.new('RGB',(900,500),'purple').save(jpg,quality=92)
    jpg_hash=hashlib.sha256(jpg.read_bytes()).hexdigest()
    source_hash=hashlib.sha256(pic.read_bytes()).hexdigest()
    p=l=None
    try:
        p,port,l=launch(ROOT/'dist/douyin.js',lib,home)
        base=f'http://127.0.0.1:{port}'
        deadline=time.time()+22
        while time.time()<deadline:
            data=json.loads(urlopen(base+'/api/data')[2]);rows=[i for i in data['items'] if i.get('originalName')==pic.name]
            if rows:break
            time.sleep(.2)
        ck('Indexed real Chinese-name PNG',bool(rows))
        key=rows[0]['key']
        code,r=req(base+'/api/photo-crop',b'abcd'*30,{'Content-Type':'image/png','X-JustFun-Media-Key':key,'Origin':'http://evil.example'})
        ck('Cross-origin binary crop rejected',code==400 and not r['ok'])
        code,r=req(base+'/api/photo-crop',b'abcd'*30,{'Content-Type':'image/png','X-JustFun-Media-Key':key})
        ck('Fake PNG binary rejected',code==400 and not r['ok'])
        code,r=req(base+'/api/photo-crop',b'abcd'*30,{'Content-Type':'text/plain','X-JustFun-Media-Key':key})
        ck('Unsafe MIME rejected',code==400)
        code,r=req(base+'/api/photo-crop',b'abcd'*30,{'Content-Type':'image/png','X-JustFun-Media-Key':'0123456789abcdef'})
        ck('Missing media key rejected',code==400)
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1180,'height':800},accept_downloads=True)
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('console',lambda m:print('CONSOLE',m.type,m.text[:250],flush=True) if m.type=='error' else None)

            page.on('dialog',lambda d:(print('DIALOG',d.message,flush=True),d.dismiss()))
            # Execution browser forbids direct loopback. Route through a local Python HTTP proxy
            # while retaining a coherent synthetic browser origin and real Node API behavior.
            def proxied(route):
                r=route.request
                path=urllib.parse.urlsplit(r.url)
                if r.method=='OPTIONS':
                    route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'content-type,x-justfun-media-key'})
                    return
                headers={k:v for k,v in r.headers.items() if k.lower() in ('content-type','x-justfun-media-key','if-none-match')}
                request=urllib.request.Request(base+path.path+('?' + path.query if path.query else ''),data=r.post_data_buffer if r.method not in ('GET','HEAD') else None,headers=headers,method=r.method)
                try:
                    with urllib.request.urlopen(request,timeout=25) as response:
                        body=response.read();code=response.status;ctype=response.headers.get('Content-Type','application/octet-stream')
                except urllib.error.HTTPError as ex:
                    body=ex.read();code=ex.code;ctype=ex.headers.get('Content-Type','application/json')
                route.fulfill(status=code,body=body,headers={'Content-Type':ctype,'Access-Control-Allow-Origin':'*'})
            page.route('http://justfun.test/**',proxied)
            html=urlopen(base+'/')[2].decode('utf8')
            page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded')
            page.wait_for_timeout(350)
            page.evaluate('''(key)=>{const item=allItems.find(x=>x.key===key);libraryMode='image';imageViewerList=[item];showImageViewer(0);}''',key)
            page.locator('#assetViewImg').wait_for(state='visible')
            page.locator('#photoMoreToggle').click()
            page.locator('#photoCropOpen').click()
            dialog=page.locator('#jfPhotoCropDialog')
            ck('Crop modal visible in real Chromium',dialog.is_visible())
            ck('Crop preview full-resolution metadata loaded',page.locator('#jfPhotoCropImage').evaluate('e=>e.naturalWidth===800&&e.naturalHeight===600'))
            crop=page.locator('#jfPhotoCropBox')
            r=crop.bounding_box()
            page.screenshot(path=str(ROOT/'dist/photo-crop-v646-preview.png'))
            ck('Crop selection fitted within actual viewport',r is not None and r['x']>=0 and r['x']+r['width']<=1180 and r['y']>=0 and r['y']+r['height']<=800)
            # First resize the lower-right handle toward its center, then drag crop body.
            handle=page.locator('[data-jf-crop-handle="se"]');hr=handle.bounding_box()
            page.mouse.move(hr['x']+hr['width']/2,hr['y']+hr['height']/2)
            page.mouse.down();page.mouse.move(hr['x']-50,hr['y']-30,steps=6);page.mouse.up()
            ck('Bottom-right handle resizes selection',page.evaluate('jfCropRect.w<.8&&jfCropRect.h<.8'))
            prev=page.evaluate('({...jfCropRect})')
            r=crop.bounding_box();page.mouse.move(r['x']+r['width']*.42,r['y']+r['height']*.45)
            page.mouse.down();page.mouse.move(r['x']+r['width']*.42+35,r['y']+r['height']*.45+24,steps=5);page.mouse.up()
            ck('Crop box moves freely',page.evaluate('old=>jfCropRect.x>old.x&&jfCropRect.y>old.y',prev))
            dims=page.evaluate('''()=>{const r=jfCropRect;const img=document.querySelector('#jfPhotoCropImage');return [Math.round((r.x+r.w)*img.naturalWidth)-Math.round(r.x*img.naturalWidth),Math.round((r.y+r.h)*img.naturalHeight)-Math.round(r.y*img.naturalHeight)];}''')
            page.locator('#jfPhotoCropSave').click()
            try:page.wait_for_function('document.querySelector("#jfPhotoCropDialog").hidden',timeout=8000)
            except Exception:
                print('CROP STATE',page.evaluate('''()=>({busy:document.querySelector('#jfPhotoCropSave').textContent,src:document.querySelector('#jfPhotoCropImage').currentSrc,base:document.baseURI,error:window.__cropErr||''})'''))
                raise
            created=list(lib.glob('*-裁剪-*'))
            ck('One new crop image saved in source directory',len(created)==1)
            with Image.open(created[0]) as result:
                ck('Saved pixels reflect adjustable crop bounds',result.size==tuple(dims))
                ck('Crop image is a real readable PNG',result.format=='PNG')
            ck('Original file bytes unchanged',hashlib.sha256(pic.read_bytes()).hexdigest()==source_hash)
            ck('UI restores normal image viewer after crop',not dialog.is_visible() and page.locator('#assetView').is_visible())
            ck('New cropped image indexed into gallery',any(i.get('originalName')==created[0].name for i in json.loads(urlopen(base+'/api/data')[2])['items']))
            # JPEG uses a JPEG output rather than accidentally converting to PNG.
            jpg_item=next(x for x in json.loads(urlopen(base+'/api/data')[2])['items'] if x.get('originalName')==jpg.name)
            page.evaluate('''item=>{imageViewerList=[item];showImageViewer(0);}''',jpg_item)
            page.locator('#photoMoreToggle').click();page.locator('#photoCropOpen').click()
            page.locator('#jfPhotoCropImage').wait_for(state='visible')
            page.locator('#jfPhotoCropSave').click()
            page.wait_for_function('document.querySelector("#jfPhotoCropDialog").hidden',timeout=18000)
            jpg_created=list(lib.glob('风景 例子-裁剪-*.jpg'))
            ck('JPEG crop saved as a new JPEG file',len(jpg_created)==1)
            with Image.open(jpg_created[0]) as jpeg_result:
                ck('JPEG crop has original-resolution dimensions',jpeg_result.format=='JPEG' and jpeg_result.size==(720,400))
            ck('JPEG source remains byte-for-byte untouched',hashlib.sha256(jpg.read_bytes()).hexdigest()==jpg_hash)
            # Restore original PNG as current media for live / Escape tests.
            page.evaluate('''item=>{imageViewerList=[item];showImageViewer(0);}''',next(x for x in json.loads(urlopen(base+'/api/data')[2])['items'] if x.get('originalName')==pic.name))
            # Never modify live photos: the menu must visibly disallow it.
            page.evaluate('''()=>{imageViewerList[0].livePhoto=true;}''')
            page.locator('#photoMoreToggle').click()
            ck('Live Photo crop enabled by newer still-frame export',page.locator('#photoCropOpen').is_enabled())
            # Simulate reopening and cancel through Esc with zero file writes.
            page.evaluate('''()=>{imageViewerList[0].livePhoto=false;showImageViewer(0);}''')
            page.locator('#photoMoreToggle').click()
            page.locator('#photoCropOpen').click()
            page.keyboard.press('Escape')
            ck('Escape closes crop without closing viewer',not dialog.is_visible() and page.locator('#assetView').is_visible())
            ck('Cancel does not add extra files',len(list(lib.glob('*-裁剪-*')))==2)
            ck('No uncaught browser errors',not errors)
            browser.close()
    finally:
        if p:stop(p,l)
