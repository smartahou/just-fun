#!/usr/bin/env python3
"""v6.32: isolated Chrome UI contract. No real media, filesystem writes or external API."""
import re,base64,json,subprocess,tempfile,pathlib
from playwright.sync_api import sync_playwright
from isolated import ROOT
checks=[]
def ck(s,v):
 checks.append((s,bool(v))); print(('PASS ' if v else 'FAIL ')+s,flush=True)
 if not v:raise AssertionError(s)
script=(ROOT/'dist/douyin.js').read_text(encoding='utf8')
m=re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',script)
assert m,'HTML embedding missing'
html=json.loads(m.group(1))
with tempfile.TemporaryDirectory(prefix='jf-ui-v632-') as d:
 p=pathlib.Path(d)/'video.mp4'
 subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=10:duration=5','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',str(p)],check=True,timeout=30)
 video='data:video/mp4;base64,'+base64.b64encode(p.read_bytes()).decode()
 with sync_playwright() as pw:
  a=pathlib.Path(d)/'audio.mp3'
  subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=360:duration=5','-c:a','libmp3lame','-b:a','96k',str(a)],check=True,timeout=30)
  audio_url='data:audio/mpeg;base64,'+base64.b64encode(a.read_bytes()).decode()
  browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  page=browser.new_page(viewport={'width':1440,'height':900},permissions=['clipboard-read','clipboard-write'])
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.evaluate('''()=>{window.__annotations=[];window.fetch=async(input,opts={})=>{
    const path=String(input?.url||input),body=opts.body?JSON.parse(opts.body):{};
    if(path.includes('/api/clips')){
      if(opts.method==='POST'){
        if(body.action==='create'){
          const clip={...body,id:'v632-'+window.__annotations.length,kind:'video',sourceTitle:'三小时学习视频.mp4',sourceAvailable:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};window.__annotations.push(clip);
          return {ok:true,json:async()=>({ok:true,clip})};}
        if(body.action==='update'){const clip=window.__annotations.find(x=>x.id===body.id);Object.assign(clip,body);return {ok:true,json:async()=>({ok:true,clip})};}
        if(body.action==='delete'){window.__annotations=window.__annotations.filter(x=>x.id!==body.id);return {ok:true,json:async()=>({ok:true})};}
      }
      return {ok:true,json:async()=>({ok:true,clips:window.__annotations.map(x=>({...x}))})};
    }
    return {ok:true,status:200,json:async()=>({items:window.__testMedia||[],folders:window.__testFolders||[],scanStatus:'ready'}),text:async()=>''};
  }}''')
  page.set_content(html,wait_until='load',timeout=20000)
  page.wait_for_timeout(1000)
  page.evaluate('''(v)=>{allItems=[{key:'v632-video',kind:'video',title:'三小时学习视频.mp4',creator:'Test',mediaUrl:v,duration:5}];window.__testMedia=allItems;currentRenderedItems=allItems;openFeed('v632-video');}''',video)
  page.wait_for_function('getCurrentFeedVideo()?.readyState>=1',timeout=8000)
  page.evaluate('''()=>{const v=getCurrentFeedVideo();v.pause();v.currentTime=1;}''')
  ck('Rate control available',page.locator('#feedScroller .jfTimelineRate').count()==1)
  page.locator('#feedScroller .jfTimelineRate').click()
  ck('Clicking rate changes speed',abs(page.evaluate('getCurrentFeedVideo().playbackRate')-1.25)<.01)
  video_el=page.locator('#feedScroller video.feedVideo')
  video_el.evaluate('(v)=>{v.pause();v.currentTime=1;}')
  # Native-like gesture support, single click should play once.
  video_el.click(force=True)
  page.wait_for_timeout(380)
  ck('Clicking video toggles playback',not page.evaluate('getCurrentFeedVideo().paused'))
  video_el.dblclick(force=True)
  page.wait_for_function('document.fullscreenElement?.matches("video.feedVideo")',timeout=6000)
  ck('Double click enters fullscreen',True)
  video_el.dblclick(force=True)
  page.wait_for_function('!document.fullscreenElement',timeout=6000)
  ck('Double click exits fullscreen',True)
  video_el.evaluate('(v)=>{v.pause();v.currentTime=1;}')
  ck('Video and marker rail are distinct',page.evaluate('''()=>{const t=document.querySelector('.jfTimelineTrack');const rail=t.querySelector('.jfAnnotationRail').getBoundingClientRect(),seek=t.querySelector('.jfVideoSeek').getBoundingClientRect();return rail.bottom<=seek.top+2}'''))
  page.locator('#feedBookmark').evaluate('(b)=>b.click()')
  page.wait_for_function('window.__annotations.length===1')
  page.locator('#feedScroller .jfAnnotationPoint').hover(force=True)
  page.wait_for_function('!document.querySelector("#jfMarkPopover").hidden')
  ck('No save button in popover',page.locator('#jfMarkPopover [data-jf-pop=save]').count()==0)
  field=page.locator('#jfMarkPopover input')
  field.fill('见闻与记忆')
  field.blur()
  page.wait_for_function('window.__annotations[0].name==="见闻与记忆"')
  ck('Blur autosaves new name',True)
  ck('No redundant per-video list',page.locator('#jfFeedMarksList').count()==0 and page.locator('#jfCurrentMarksPanel').count()==0)
  page.locator('#feedClipShelf').evaluate('(x)=>x.click()')
  page.wait_for_function('document.querySelectorAll("#clipShelfList .clipShelfRow").length===1')
  ck('Shelf is current video only',page.evaluate('''()=>document.querySelector('#clipShelfOnly').disabled&&document.querySelector('#clipShelfOnly').checked'''))
  ck('Shelf has no new/edit/seek buttons',page.locator('#clipShelfNew').count()==0 and page.locator('#clipShelfList [data-clip-action=edit],#clipShelfList [data-clip-action=play]').count()==0)
  ck('Close icon is SVG',page.locator('#clipShelfClose svg').count()==1)
  page.locator('#clipShelfList .clipShelfRow').dblclick()
  ck('Double clicking annotation closes library',page.evaluate('document.querySelector("#clipShelfBack").hidden'))
  ck('Double clicking point positions playback',abs(page.evaluate('getCurrentFeedVideo().currentTime')-1)<.25)
  page.evaluate('getCurrentFeedVideo().pause()')
  # Content-filtered directories. Empty folders stay available to move picker.
  page.evaluate('''()=>{
    closeFeed();
    allFolders=[{relativeDir:'source',parentDir:'all',readOnly:true},{relativeDir:'source/佛学',parentDir:'source',readOnly:true},{relativeDir:'source/佛学/讲座',parentDir:'source/佛学',readOnly:true},{relativeDir:'source/空目录',parentDir:'source',readOnly:true},{relativeDir:'data/1001',parentDir:'data',state:'ready'},{relativeDir:'data/1002',parentDir:'data',state:'ready'}];
    allItems=[{key:'v632-video',kind:'video',title:'三小时学习视频.mp4',relativeDir:'source/佛学/讲座',duration:5,mediaUrl:'test'}];
    window.__testMedia=allItems;window.__testFolders=allFolders;
    libraryMode='video';activeFolder='source';renderVideoFolders();
  }''')
  ck('Browsing shows populated child only',page.locator('#folderTiles [data-open-folder="source/佛学"]').count()==1 and page.locator('#folderTiles [data-open-folder="source/空目录"]').count()==0)
  page.evaluate('''()=>{activeFolder='source/佛学';renderVideoFolders();}''')
  ck('Nested media folder preserved',page.locator('#folderTiles [data-open-folder="source/佛学/讲座"]').count()==1)
  ck('Move targets still include empty managed folders',page.evaluate('unifiedFolderOptions().some(x=>x.relativeDir==="data/1002")'))
  page.evaluate('''()=>{openUnifiedMove(['v632-video']);}''')
  ck('Move picker includes all managed and work folders',page.evaluate('''()=>{const opts=[...document.querySelector('#unifiedMoveTarget').options];return opts.some(x=>x.value==='data/1002'&&!x.disabled)&&opts.some(x=>x.value==='source/空目录'&&x.disabled)}'''))
  page.evaluate('closeUnifiedMove()')
  ck('No browser errors',not errors)
  browser.close()
print('ANNOTATION UI V633',len(checks),'/',len(checks))
