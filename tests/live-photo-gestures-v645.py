#!/usr/bin/env python3
"""v6.45: isolated real Chromium audio, aspect, transform, touch pinch and fallback tests."""
import pathlib, tempfile, subprocess, json, base64, time
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop, urlopen

def check(title, value):
    assert value, title
    print('PASS', title, flush=True)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v645-touch-') as tmp:
    root=pathlib.Path(tmp); media=root/'图像媒体';media.mkdir();home=root/'home'
    # Real video WITH audio, both landscape and portrait variants.
    for name, size in [('motion-horizontal.mp4','320x240'),('motion-vertical.mp4','180x320')]:
        subprocess.run(['ffmpeg','-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i',f'testsrc2=size={size}:rate=15:duration=2',
                       '-f','lavfi','-i','sine=frequency=440:duration=2','-shortest','-c:v','libx264','-pix_fmt','yuv420p',
                       '-c:a','aac','-y',str(media/name)],check=True,timeout=35)
    subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-f','lavfi','-i','color=red:s=320x240:d=1',
                    '-frames:v','1','-y',str(media/'still.jpg')],check=True,timeout=20)
    probe=subprocess.check_output(['ffprobe','-v','error','-select_streams','a','-show_entries','stream=codec_name','-of','csv=p=0',str(media/'motion-horizontal.mp4')],text=True)
    check('Sample Live Photo has a real AAC audio track', 'aac' in probe)
    proc=log=None
    try:
        proc,port,log=launch(ROOT/'dist/douyin.js',media,home)
        html=urlopen('http://127.0.0.1:'+str(port)+'/')[2].decode('utf8')
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            ctx=browser.new_context(viewport={'width':1100,'height':850},has_touch=True)
            page=ctx.new_page()
            errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
            page.set_content(html,wait_until='domcontentloaded');page.wait_for_timeout(250)
            def mk(file,index,live=True):
                mime='video/mp4' if live else 'image/jpeg'
                return {'kind':'image','key':'test'+str(index),'relativeDir':'root','originalName':file,
                        'title':file,'livePhoto':live,'mediaUrl':'data:'+mime+';base64,'+base64.b64encode((media/file).read_bytes()).decode()}
            items=[mk('still.jpg',0,False),mk('motion-horizontal.mp4',1),mk('motion-vertical.mp4',2)]
            page.evaluate('''items=>{allItems=items;libraryMode='image';activeFolder='all';renderAssets();}''',items)
            check('All three items rendered in photo wall',page.locator('.pictureTile').count()==3)
            page.locator('.pictureTile[data-media-key="test1"]').click()
            v=page.locator('.jfLivePhotoVideo');v.wait_for()
            page.wait_for_timeout(500)
            check('Real click opens Live Photo unmuted with volume',v.evaluate('e=>!e.muted && e.volume===1 && e.autoplay && e.loop && e.playsInline'))
            check('Real click starts audible Live Photo motion',v.evaluate('e=>!e.paused && e.readyState>=2'))
            check('No sound-unlock overlay after user-initiated playback',page.locator('.jfLivePhotoSound').count()==0)
            box=v.bounding_box()
            check('Live Photo respects landscape aspect ratio',box is not None and abs(box['width']/box['height']-4/3)<0.03)
            page.evaluate('setPhotoScale(2.2,550,425)')
            check('Wheel/zoom transform applies to Live Photo video',v.evaluate('e=>e.style.transform.includes("scale(2.2)")'))
            page.mouse.move(540,410);page.mouse.down();page.mouse.move(575,435,steps=3);page.mouse.up()
            check('Mouse pan moves enlarged Live Photo',page.evaluate('Math.abs(photoViewerPanX)>20 && Math.abs(photoViewerPanY)>15'))
            page.mouse.move(530,420);previous=page.evaluate('photoViewerScale');page.mouse.wheel(0,-180)
            page.wait_for_timeout(80)
            check('Mouse wheel changes Live Photo zoom',page.evaluate('(previous)=>photoViewerScale>previous',previous))
            page.evaluate('showImageViewer(imageViewerList.findIndex(x=>x.key==="test0"))')
            still=page.locator('#assetViewImg');still.wait_for(state='visible')
            b2=still.bounding_box()
            check('Still image uses matching landscape aspect ratio',b2 is not None and abs(b2['width']/b2['height']-4/3)<0.03)
            check('Switching to photo stops and removes live video',page.locator('.jfLivePhotoVideo').count()==0)
            page.evaluate('setPhotoScale(2,550,425)')
            check('Ordinary photo still gets shared zoom transform',still.evaluate('e=>e.style.transform.includes("scale(2)")'))
            page.evaluate('setPhotoScale(1)')
            session=ctx.new_cdp_session(page)
            def multi(points,event='touchMove'):
                session.send('Input.dispatchTouchEvent',{'type':event,'touchPoints':[{'x':x,'y':y,'id':i+1} for i,(x,y) in enumerate(points)]})
            multi([(510,425),(590,425)],'touchStart')
            multi([(470,420),(630,430)],'touchMove')
            page.wait_for_timeout(100)
            check('Real two-finger pinch zoom works for normal image',page.evaluate('photoViewerScale>1.4'))
            check('Two-finger pinch uses same image transform',still.evaluate('e=>e.style.transform.includes("scale(")'))
            multi([], 'touchEnd')
            page.evaluate('showImageViewer(imageViewerList.findIndex(x=>x.key==="test2"))')
            v=page.locator('.jfLivePhotoVideo');v.wait_for();page.wait_for_timeout(400)
            box=v.bounding_box()
            check('Portrait Live Photo keeps original orientation',box is not None and abs(box['width']/box['height']-180/320)<0.03)
            check('Live Photo video remains unmuted on switching',v.evaluate('e=>!e.muted && e.volume>0'))
            multi([(510,425),(590,425)],'touchStart')
            multi([(475,425),(625,425)],'touchMove')
            page.wait_for_timeout(100)
            check('Real two-finger pinch zoom works for Live Photo',page.evaluate('photoViewerScale>1.4'))
            check('Shared scale applies to Live Photo video',v.evaluate('e=>e.style.transform.includes("scale(")'))
            multi([], 'touchEnd')
            page.evaluate('hideImageViewer()')
            check('Close stops playback and removes video',page.locator('.jfLivePhotoVideo').count()==0)
            check('No uncaught browser exceptions',not errors)
            # New isolated browser context: programmatic open has no activation.
            # Browser may deny audible autoplay; the explicit user-gesture unlock must work.
            ctx2=browser.new_context(viewport={'width':1100,'height':850})
            denied=ctx2.new_page();bad=[];denied.on('pageerror',lambda exc:bad.append(str(exc)))
            denied.set_content(html,wait_until='domcontentloaded');denied.wait_for_timeout(180)
            denied.evaluate('''item=>{imageViewerList=[item];showImageViewer(0);}''',items[1])
            denied.wait_for_timeout(850)
            sound=denied.locator('.jfLivePhotoSound')
            if sound.count():
                check('Blocked audible autoplay presents an explicit sound action',sound.is_visible())
                sound.click()
                denied.wait_for_timeout(200)
                check('User gesture unlocks audible Live Photo',denied.locator('.jfLivePhotoVideo').evaluate('e=>!e.muted && !e.paused'))
                check('Sound prompt disappears after successful playback',sound.count()==0)
            else:
                check('Browser permitted programmatic audible playback',denied.locator('.jfLivePhotoVideo').evaluate('e=>!e.muted && !e.paused'))
            denied.evaluate('hideImageViewer()')
            check('Second context has no page errors',not bad)
            # Force the browser's autoplay-policy rejection deterministically.
            policy=browser.new_context(viewport={'width':1100,'height':850})
            blocked=policy.new_page();blocked.set_content(html,wait_until='domcontentloaded')
            blocked.evaluate('''() => {
              const native=HTMLMediaElement.prototype.play;
              let denyOnce=true;
              HTMLMediaElement.prototype.play=function(){
                if(!this.muted && denyOnce){denyOnce=false;return Promise.reject(new DOMException('Gesture needed','NotAllowedError'));}
                return native.call(this);
              };
            }''')
            blocked.evaluate('''item=>{imageViewerList=[item];showImageViewer(0);}''',items[1])
            blocked.locator('.jfLivePhotoSound').wait_for(timeout=5000)
            check('Forced autoplay rejection exposes sound-unlock control',blocked.locator('.jfLivePhotoSound').is_visible())
            check('Fallback keeps muted motion running',blocked.locator('.jfLivePhotoVideo').evaluate('e=>e.muted && !e.paused'))
            # A real click is required to remove the muted fallback.
            blocked.locator('.jfLivePhotoSound').click()
            blocked.wait_for_timeout(150)
            check('Manual sound activation restores unmuted playback',blocked.locator('.jfLivePhotoVideo').evaluate('e=>!e.muted && !e.paused'))
            check('Successful unlock hides control',blocked.locator('.jfLivePhotoSound').count()==0)
            browser.close()
    finally:
        if proc:stop(proc,log)
