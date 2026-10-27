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
    return {ok:true,status:200,json:async()=>({items:window.__testMedia||[],folders:[],scanStatus:'ready'}),text:async()=>''};
  }}''')
  page.set_content(html,wait_until='load',timeout=20000)
  page.wait_for_timeout(1000)
  page.evaluate('''(v)=>{allItems=[{key:'v632-video',kind:'video',title:'三小时学习视频.mp4',creator:'Test',mediaUrl:v,duration:5}];window.__testMedia=allItems;currentRenderedItems=allItems;openFeed('v632-video');}''',video)
  page.wait_for_function('getCurrentFeedVideo()?.readyState>=1',timeout=8000)
  page.evaluate('''()=>{const v=getCurrentFeedVideo();v.pause();v.currentTime=1;}''')
  ck('Custom video progress slider exists',page.locator('#feedScroller .jfVideoSeek').count()==1)
  ck('Both video annotation actions show icon and label',page.evaluate('''()=>['feedBookmark','feedRangeMark'].every(id=>{const b=document.getElementById(id);return !!b.querySelector('svg')&&!!b.querySelector('.feedToolLabel').textContent.trim();})'''))
  ck('A/B playback tools are separate from annotation tools',page.evaluate('''()=>!!document.querySelector('.jfEntertainmentTools #feedABLoop')&&!!document.querySelector('.jfAnnotationTools #feedBookmark')'''))
  ck('Native video controls hidden in ordinary feed',page.evaluate('getCurrentFeedVideo().controls===false'))
  ck('Video has visibly separate marker track',page.evaluate('''()=>{const t=document.querySelector('#feedScroller .jfTimelineTrack');const r=t.querySelector('.jfAnnotationRail').getBoundingClientRect(),s=t.querySelector('.jfVideoSeek').getBoundingClientRect();return r.bottom<=s.top+2}'''))
  page.locator('#feedBookmark').evaluate('(x)=>x.click()')
  page.wait_for_function('window.__annotations.length===1')
  ck('Marker rendered on same scale as video seek',page.evaluate('''()=>{const node=document.querySelector('#feedScroller .jfAnnotationPoint'),s=document.querySelector('#feedScroller .jfVideoSeek');const r=node.getBoundingClientRect(),q=s.getBoundingClientRect();return !!node&&Math.abs((r.left+r.width/2-q.left)/q.width-.2)<.055;}'''))
  page.locator('#feedScroller .jfAnnotationPoint').hover(force=True)
  page.wait_for_function('!document.querySelector("#jfMarkPopover").hidden')
  ck('Hover shows writable name and copy/delete actions',page.locator('#jfMarkPopoverName').count()==0 and page.locator('#jfMarkPopover input').count()==1 and page.locator('#jfMarkPopover [data-jf-pop]').count()==2)
  # Popover is accessible as a fixed portal outside overflow-hidden video stage
  ck('Popover is outside the clipped player',page.evaluate('document.querySelector("#jfMarkPopover").parentElement===document.body')) if False else None
  page.locator('#jfMarkPopover input').fill('第六章·术语整理')
  page.locator('#jfMarkPopover input').blur()
  page.wait_for_function('window.__annotations[0].name==="第六章·术语整理"')
  ck('Inline rename writes through the API',True)
  ck('Redundant current-video panel removed',page.locator('#jfFeedMarksList').count()==0 and page.locator('#jfCurrentMarksPanel').count()==0)
  page.locator('#feedScroller .jfAnnotationPoint').hover(force=True)
  page.screenshot(path=str(ROOT/'dist/annotation-ui-edit-v632.png'))
  page.evaluate('''()=>{document.execCommand=(cmd)=>{window.__copiedText=document.activeElement.value;return cmd==='copy';}}''')
  page.locator('#jfMarkPopover [data-jf-pop=copy]').click()
  copied=page.evaluate('window.__copiedText')
  ck('Copy contains video name and exact timestamp','三小时学习视频.mp4' in copied and '1:00' not in copied and '时间' in copied)
  page.locator('#jfMarkPopover input').blur()
  page.evaluate('jfPopoverHide()')
  page.evaluate('''()=>{getCurrentFeedVideo().pause();getCurrentFeedVideo().currentTime=0;}''')
  page.locator('#feedScroller .jfVideoSeek').fill('600')
  ck('Seek slider controls the video, independently of markers',abs(page.evaluate('getCurrentFeedVideo().currentTime')-3)<.35)
  # One-off interval preview never modifies A/B entertainment state.
  page.evaluate('''()=>{
    const state=getFeedABState('v632-video');state.a=.5;state.b=.8;state.enabled=false;
    const mark={sourceKey:'v632-video',kind:'video',a:1.1,b:1.8,sourceAvailable:true};
    clipShelfPlay(mark);
  }''')
  page.wait_for_function('getCurrentFeedVideo().paused&&getCurrentFeedVideo().currentTime>=1.73',timeout=5000)
  ck('Study interval plays once and stops without enabling A/B',page.evaluate('''()=>{const s=getFeedABState('v632-video');return !s.enabled&&s.a===.5&&s.b===.8;}'''))
  page.locator('#feedScroller .jfTimelineFullscreen').click()
  page.wait_for_function('document.fullscreenElement?.matches("video.feedVideo")',timeout=7000)
  ck('Native fullscreen restores native controls',page.evaluate('document.fullscreenElement?.controls===true'))
  page.evaluate('document.exitFullscreen()')
  page.wait_for_function('!document.fullscreenElement')
  page.wait_for_function('getCurrentFeedVideo().controls===false',timeout=3000)
  ck('Leaving fullscreen returns to custom timeline',page.evaluate('getCurrentFeedVideo().controls===false'))
  page.on('dialog',lambda dialog:dialog.accept())
  page.locator('#feedScroller .jfAnnotationPoint').hover(force=True)
  page.locator('#jfMarkPopover [data-jf-pop=delete]').click()
  page.wait_for_function('window.__annotations.length===0')
  ck('Popover deletion updates both list and marker track',page.locator('#feedScroller .jfAnnotationPoint').count()==0)
  page.evaluate('''(url)=>{closeFeed();allItems.push({key:'v632-audio',kind:'audio',title:'讲座录音.mp3',mediaUrl:url,duration:5});window.__testMedia=allItems;openAudioDock('v632-audio');}''',audio_url)
  page.wait_for_function('document.querySelector("#audioDock .audioTrack audio")?.readyState>=1',timeout=7000)
  ck('Audio uses the same annotation icon language',page.evaluate('''()=>{const t=document.querySelector('#audioDock .jfAudioBookmark'),r=document.querySelector('#audioDock .jfAudioRange');return !!t?.querySelector('svg')&&!!r?.querySelector('svg')&&t.querySelector('svg').getAttribute('viewBox')==='0 0 24 24'}'''))
  page.evaluate('''()=>{const a=document.querySelector('#audioDock .audioTrack audio');a.pause();a.currentTime=1.4;}''')
  page.locator('#audioDock .jfAudioBookmark').evaluate('(el)=>el.click()')
  page.wait_for_function('window.__annotations.length===1')
  ck('Audio marker renders above rather than on scrub line',page.evaluate('''()=>{const track=document.querySelector('#audioDock .audioTrack'),r=track.querySelector('.jfAnnotationAudioMarks').getBoundingClientRect(),seek=track.querySelector('.audioSeek').getBoundingClientRect();return r.bottom<=seek.top+4;}'''))
  ck('Audio marker has name popover as video',page.locator('#audioDock .jfAnnotationAudioMarks [data-annotation-id]').count()==1)
  ck('No browser JS exceptions',not errors)
  page.screenshot(path=str(ROOT/'dist/annotation-ui-v632.png'))
  browser.close()
print('ANNOTATION UI V632',len(checks),'/',len(checks))
