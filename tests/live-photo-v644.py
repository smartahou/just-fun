#!/usr/bin/env python3
"""Offline living photo classification / viewer test; media always isolated."""
import pathlib,tempfile,subprocess,json,time,urllib.request
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen,media_entries

def check(name,yes):
    assert yes,name
    print('PASS',name,flush=True)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-livephoto-') as td:
    base=pathlib.Path(td);library=base/'中文媒体';library.mkdir();home=base/'home';
    for file,color in [('Live_A.mp4','cyan'),('Short_B.mp4','yellow')]:
        subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i',f'color=c={color}:s=320x240:d=3','-an','-c:v','libx264','-pix_fmt','yuv420p','-y',str(library/file)],check=True,timeout=25)
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=320x240:d=0.1','-frames:v','1','-y',str(library/'Live_A.jpg')],check=True,timeout=25)
    proc=log=None
    try:
        proc,port,log=launch(ROOT/'dist/douyin.js',library,home)
        baseurl=f'http://127.0.0.1:{port}'
        def load():return media_entries(json.loads(urlopen(baseurl+'/api/data')[2]))
        items=[]
        for n in range(90):
            items=load()
            if len(items)>=3 and all(x.get('duration') for x in items if x['originalExt']=='.mp4'):break
            time.sleep(.4)
        one=next(x for x in items if x['originalName']=='Live_A.mp4')
        other=next(x for x in items if x['originalName']=='Short_B.mp4')
        check('Companion photo yields automatic Live Photo',one['kind']=='image' and one['livePhoto'])
        check('Standalone ordinary 3-second MP4 remains video',other['kind']=='video' and not other['livePhoto'])
        check('Video still accessible by original media endpoint',urlopen(baseurl+one['mediaUrl'],{'Range':'bytes=0-31'})[0]==206)
        thumb=urlopen(baseurl+'/api/image-thumb/'+one['key'])
        check('Generated image thumbnail for Live Photo',thumb[0]==200 and thumb[1].get('Content-Type')=='image/jpeg' and thumb[2][:2]==b'\xff\xd8')
        def toggle(key,on):
            request=urllib.request.Request(baseurl+'/api/media-live-photo',data=json.dumps({'key':key,'enabled':on}).encode(),headers={'Content-Type':'application/json'},method='POST')
            with urllib.request.urlopen(request,timeout=8) as response:return json.loads(response.read())
        check('Manual override marks standalone clip as Live Photo',toggle(other['key'],True)['item']['livePhoto'])
        check('Manual override persists in catalog',next(x for x in load() if x['key']==other['key'])['kind']=='image')
        check('Undo returns clip to video',toggle(other['key'],False)['item']['kind']=='video')
        check('Explicit undo protects against automatic reclassification',toggle(one['key'],False)['item']['kind']=='video')
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
            page=browser.new_page(viewport={'width':1200,'height':840})
            errs=[];page.on('pageerror',lambda error:errs.append(str(error)))
            import base64
            html=urlopen(baseurl+'/')[2].decode('utf-8')
            page.set_content(html,wait_until='domcontentloaded')
            page.wait_for_timeout(250)
            mp4=base64.b64encode((library/'Live_A.mp4').read_bytes()).decode()
            item=dict(one,kind='image',livePhoto=True,mediaUrl='data:video/mp4;base64,'+mp4)
            page.evaluate("""(item)=>{
              allItems=[item];libraryMode='image';activeFolder='all';renderAssets();
              imageViewerList=[item];showImageViewer(0);
            }""",item)
            vid=page.locator('#assetView .jfLivePhotoVideo')
            check('Photo viewer renders video for Live Photo',vid.count()==1 and vid.is_visible())
            check('Audible looping autoplay configured',vid.evaluate('(el)=>!el.muted&&el.loop&&el.autoplay&&el.playsInline&&el.volume>0'))
            page.wait_for_timeout(650)
            check('Motion video actually starts playing',vid.evaluate('(el)=>!el.paused && el.readyState>=2'))
            check('Photo image hidden while video active',page.locator('#assetViewImg').evaluate('(el)=>getComputedStyle(el).display')=='none')
            page.evaluate('hideImageViewer()')
            check('Video element removed on close',page.locator('#assetView .jfLivePhotoVideo').count()==0)
            check('No browser page errors',not errs)
            browser.close()
    finally:
        if proc:stop(proc,log)
