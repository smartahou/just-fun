#!/usr/bin/env python3
"""Isolated Chromium keyboard seek regression: main video +/-5s, modal focus, frames.
No user directory or real media is ever accessed.
"""
import base64, json, pathlib, re, subprocess, tempfile
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
script = (ROOT/'dist/douyin.js').read_text(encoding='utf8')
m = re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}', script)
assert m, 'embedded UI missing'
html = json.loads(m.group(1))
checks=[]
def check(name, passed, detail=''):
    checks.append((name, bool(passed)))
    print(('PASS ' if passed else 'FAIL ')+name+(f' {detail}' if detail else ''),flush=True)
    if not passed: raise AssertionError(name+': '+str(detail))

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-seek-') as d:
    vid=pathlib.Path(d)/'seek.mp4'
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',
        'testsrc2=size=320x180:rate=10:duration=24','-c:v','libx264','-preset','ultrafast',
        '-pix_fmt','yuv420p','-movflags','+faststart','-an',str(vid)],check=True,timeout=30)
    src='data:video/mp4;base64,'+base64.b64encode(vid.read_bytes()).decode('ascii')
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
            args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        page=browser.new_page(viewport={'width':1440,'height':900})
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.evaluate('''()=>{window.fetch=async()=>({ok:true,status:200,json:async()=>({items:[],folders:[],scanStatus:'ready'})})}''')
        page.set_content(html,wait_until='load',timeout=20000)
        page.evaluate('''(src)=>{const item={kind:'video',key:'keyboard-seek-1',title:'Seek fixture',creator:'Test',mediaUrl:src};allItems=[item];currentRenderedItems=[item];openFeed(item.key);}''',src)
        page.wait_for_function("document.querySelector('#feedScroller .feedVideo')?.readyState>=1",timeout=10000)
        page.evaluate("()=>{let v=getCurrentFeedVideo();v.pause();v.currentTime=9;}")
        page.wait_for_function("Math.abs(getCurrentFeedVideo().currentTime-9)<.25",timeout=8000)
        page.locator('#feedOverlay').evaluate('(el)=>el.focus()')
        page.keyboard.press('ArrowRight')
        check('ArrowRight seeks forward exactly 5s',abs(page.evaluate('getCurrentFeedVideo().currentTime')-14)<.15)
        page.keyboard.press('ArrowLeft')
        check('ArrowLeft seeks backward exactly 5s',abs(page.evaluate('getCurrentFeedVideo().currentTime')-9)<.15)
        page.evaluate('getCurrentFeedVideo().currentTime=2')
        page.keyboard.press('ArrowLeft')
        check('Backward seek clamps to zero',page.evaluate('getCurrentFeedVideo().currentTime')<.05)
        page.evaluate('getCurrentFeedVideo().currentTime=22')
        page.keyboard.press('ArrowRight')
        check('Forward seek clamps at duration',abs(page.evaluate('getCurrentFeedVideo().currentTime')-24)<.1)
        page.evaluate('getCurrentFeedVideo().currentTime=8')
        page.evaluate("()=>{let el=document.createElement('input');el.id='seekTestInput';el.style.cssText='position:fixed;top:100px;left:100px;z-index:999999';document.body.appendChild(el)}")
        page.locator('#seekTestInput').fill('typing')
        page.keyboard.press('ArrowRight')
        check('Input arrow is not intercepted',abs(page.evaluate('getCurrentFeedVideo().currentTime')-8)<.1)
        page.evaluate("()=>{document.querySelector('#seekTestInput').remove();const el=document.createElement('div');el.className='shotStudioBack';document.body.appendChild(el)}")
        page.keyboard.press('ArrowRight')
        check('Screenshot studio owns arrow keys',abs(page.evaluate('getCurrentFeedVideo().currentTime')-8)<.1)
        page.evaluate("document.querySelector('.shotStudioBack').remove()")
        page.evaluate("()=>{document.querySelector('#clipShelfBack').hidden=false}")
        page.keyboard.press('ArrowRight')
        check('Clip editor owns arrow keys',abs(page.evaluate('getCurrentFeedVideo().currentTime')-8)<.1)
        page.evaluate("()=>{document.querySelector('#clipShelfBack').hidden=true}")
        page.keyboard.press('Control+ArrowRight')
        check('Modified arrow combination unchanged',abs(page.evaluate('getCurrentFeedVideo().currentTime')-8)<.1)
        page.evaluate("()=>{const slider=document.createElement('input');slider.type='range';slider.id='seekTestRange';slider.min='0';slider.max='100';document.body.appendChild(slider);slider.focus()}")
        page.keyboard.press('ArrowRight')
        check('Range sliders keep native arrow controls',abs(page.evaluate('getCurrentFeedVideo().currentTime')-8)<.1)
        page.evaluate("()=>{document.querySelector('#seekTestRange').remove();document.activeElement.blur()}")
        # Test when the full screen native video is a different host from currentFeedKey.
        page.evaluate("()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>getCurrentFeedVideo()})}")
        page.keyboard.press('ArrowRight')
        check('Native fullscreen video receives +5s',abs(page.evaluate('getCurrentFeedVideo().currentTime')-13)<.15)
        page.evaluate("()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>null});closeFeed()}")
        page.keyboard.press('ArrowRight')
        check('Keys outside playback do not open feed',not page.locator('#feedOverlay').evaluate('(el)=>el.classList.contains("open")'))
        check('No runtime exceptions',not errors,str(errors[:2]))
        browser.close()
print('KEYBOARD SEEK',sum(ok for _,ok in checks),'/',len(checks))
