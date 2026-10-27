#!/usr/bin/env python3
"""v6.36 UX + PAX sidecar regression. All data in disposable fixture libraries."""
import pathlib,tempfile,hashlib,json,time,re
from isolated import ROOT,make_fixture,launch,stop,urlopen,api_wait
from playwright.sync_api import sync_playwright
checks=[]
def ck(label,value):
    value=bool(value);checks.append(value)
    print(('PASS ' if value else 'FAIL ')+label,flush=True)
    if not value:raise AssertionError(label)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v636-') as td:
    tmp=pathlib.Path(td);lib=tmp/'佛学 课程资料'
    originals=make_fixture(lib)
    pax=lib/'南怀瑾'/'PaxHeader';pax.mkdir(parents=True)
    fake=pax/'01-听课.mp3';fake.write_bytes(b'31 path=some fake file.mp3\n')
    mac=lib/'__MACOSX';mac.mkdir();(mac/'音频.mp3').write_bytes(b'mac metadata')
    valid=lib/'南怀瑾'/'第01讲.mp3';valid.write_bytes((lib/'测试音频 2.mp3').read_bytes())
    ignored=lib/'南怀瑾'/'._第02讲.mp3';ignored.write_bytes(b'not audio')
    header_like=lib/'南怀瑾'/'第03讲.mp3';header_like.write_bytes(b'38 path=recorded metadata, not audio\n')
    first={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in lib.rglob('*') if p.is_file()}
    proc=log=None
    try:
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home')
        data=api_wait(port)
        items=data['items'];folders=data['folders']
        ck('PaxHeader files hidden from catalogue',all('PaxHeader' not in str(i.get('relativeDir','')) for i in items))
        ck('PaxHeader folder hidden from directory tree',all('PaxHeader' not in f.get('relativeDir','') for f in folders))
        ck('AppleDouble metadata and __MACOSX hidden',all('._' not in str(i.get('originalName','')) and '__MACOSX' not in str(i.get('relativeDir','')) for i in items))
        ck('Real nested audio still detected',any(i.get('originalName')=='第01讲.mp3' for i in items))
        ck('Misnamed PAX payload ignored by header signature',all(i.get('originalName')!='第03讲.mp3' for i in items))
        ck('All original files remain byte-identical',all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in first.items()))
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
            page=browser.new_page(viewport={'width':1280,'height':800})
            js_errors=[];page.on('pageerror',lambda e:js_errors.append(str(e)))
            # Browser policy may block localhost: use tested standalone HTML injection
            # with deterministic fixture API responses (service was tested above).
            build=(ROOT/'dist/douyin.js').read_text(encoding='utf8')
            html=json.loads(re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',build).group(1))
            page.evaluate('(data)=>{window.__v636Fixture=data;window.fetch=async(input,opts={})=>{const url=String(input?.url||input);if(url.includes("/api/clips"))return {ok:true,json:async()=>({ok:true,clips:[]})};return {ok:true,status:200,json:async()=>window.__v636Fixture,text:async()=>""};}}',data)
            page.set_content(html,wait_until='load',timeout=20000)
            page.wait_for_function('typeof allItems!=="undefined" && allItems.length>=4',timeout=20000)
            ck('Shot button is fourth toolbar control',page.evaluate('''()=>[...document.querySelectorAll('#feedToolPanel .feedTool')].slice(0,5).map(b=>b.id).join(',')==='feedBookmark,feedRangeMark,feedClipShelf,feedScreenshot,feedSetA' '''))
            ck('Second menu row is A/B entertainment',page.evaluate('''()=>[...document.querySelectorAll('#feedToolPanel .feedTool')].slice(4,8).map(b=>b.id).join(',')==='feedSetA,feedSetB,feedABLoop,feedGhostLoop' '''))
            ck('Logo focus/keyboard semantics',page.locator('.studioBrandLogoOnly').get_attribute('role')=='button' and page.locator('.studioBrandLogoOnly').get_attribute('tabindex')=='0')
            page.evaluate('''()=>{document.querySelector('[data-media-kind="audio"]').click()}''')
            ck('Switching to audio works',page.evaluate('libraryMode')=='audio')
            page.locator('.studioBrandLogoOnly').click()
            ck('Logo returns to video homepage',page.evaluate('libraryMode')=='video' and page.evaluate('activeFolder')=='root')
            audio_item=next(x for x in items if x['kind']=='audio')
            page.evaluate('(key)=>{openAudioDock(key);setAudioDockMinimized(false);}',audio_item['key'])
            ck('Expanded music can be shown outside audio page',page.evaluate('libraryMode==="video"&&!document.querySelector("#audioDock").classList.contains("isMinimized")'))
            page.keyboard.press('Escape')
            ck('Escape minimizes expanded music from video-list page',page.evaluate('document.querySelector("#audioDock").classList.contains("isMinimized")'))
            ck('Escape does not pause music',page.evaluate('!!document.querySelector("#audioDock audio")'))
            page.evaluate('''()=>{setAudioDockMinimized(false);document.querySelector('#unifiedMoveBack').hidden=false;}''')
            page.keyboard.press('Escape')
            ck('Active move modal has priority over audio minimization',page.evaluate('!document.querySelector("#audioDock").classList.contains("isMinimized")'))
            page.evaluate('document.querySelector("#unifiedMoveBack").hidden=true')
            page.keyboard.press('Escape')
            ck('Subsequent Escape minimizes music',page.evaluate('document.querySelector("#audioDock").classList.contains("isMinimized")'))
            # Test snap on both halves, and that hover expansion remains in the viewport.
            page.evaluate('''()=>{snapBgmMini(innerWidth*.2,66); }''')
            ck('Left-half drag release snaps left',page.evaluate('''()=>{const r=document.querySelector('#audioDock').getBoundingClientRect();return r.left>=13 && r.left<=26;}'''))
            page.evaluate('''()=>{snapBgmMini(innerWidth*.8,66); }''')
            ck('Right-half drag release snaps right',page.evaluate('''()=>{const d=document.querySelector('#audioDock'),r=d.getBoundingClientRect();return d.classList.contains('isSnappedRight') && innerWidth-r.right>=13 && innerWidth-r.right<=26;}'''))
            page.locator('.bgmMiniOpen').hover()
            page.wait_for_timeout(160)
            ck('Hovered right mini stays within viewport',page.evaluate('''()=>{const r=document.querySelector('#audioDock').getBoundingClientRect();return r.right<=innerWidth-12 && r.width>=80;}'''))
            page.evaluate('''()=>{setAudioDockMinimized(false);document.querySelector('[data-media-kind="audio"]').click();}''')
            ck('Audio pending-range state visible on button',page.evaluate('''()=>{jfAnnotationPendingRanges.set(activeAudioKey,1);jfAnnotationSetRangeButton(activeAudioKey);return document.querySelector('.jfAudioRange').getAttribute('aria-pressed')==='true' && getComputedStyle(document.querySelector('.jfAudioRange')).animationName.includes('jfRangeHeartbeat');}'''))
            ck('Muted annotation messages removed from source UI', '已标记 · 悬停可命名' not in (ROOT/'src/client/scripts/95-annotations.js').read_text())
            ck('No uncaught browser errors',not js_errors)
            browser.close()
    finally:
        if proc:stop(proc,log)
print('UX V636',sum(checks),'/',len(checks))
