#!/usr/bin/env python3
"""Isolated v7.19 large-feed lifecycle and real MP4 navigation regression.
No user media, external network, user storage, or real Workspace access.
"""
import base64, hashlib, json, pathlib, re, subprocess, tempfile
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
script=(ROOT/'dist/douyin.js').read_text(encoding='utf8')
m=re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',script)
assert m,'No embedded html'
html=json.loads(m.group(1))
checks=[]
def ck(name,passed,detail=''):
 checks.append({'name':name,'ok':bool(passed),'detail':str(detail)[:600]})
 print(('PASS' if passed else 'FAIL'),name,str(detail)[:300],flush=True)
 if not passed:raise AssertionError(name+': '+str(detail))

with tempfile.TemporaryDirectory(prefix='jf-video-feed-v719-') as d:
 testmp4=pathlib.Path(d)/'isolated.mp4'
 subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=10:duration=14',
                 '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart','-an',str(testmp4)],check=True,timeout=35)
 media_sha=hashlib.sha256(testmp4.read_bytes()).hexdigest()
 source='data:video/mp4;base64,'+base64.b64encode(testmp4.read_bytes()).decode('ascii')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
       args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  for size in [(1440,900),(390,844)]:
   page=browser.new_page(viewport={'width':size[0],'height':size[1]})
   errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
   page.route('**/api/**',lambda r:r.fulfill(status=200,content_type='application/json',body='{"items":[],"folders":[],"ok":true}'))
   page.set_content(html,wait_until='domcontentloaded',timeout=40000)
   page.wait_for_timeout(120)
   begin=page.evaluate('''(src)=>{
     catalogRequestInFlight=true;
     allItems=Array.from({length:720},(_,i)=>({key:'long-feed-'+i,kind:'video',title:'第 '+i+' 条',creator:'TEST',mediaUrl:src,rating:3}));
     currentRenderedItems=allItems;
     const start=performance.now();openFeed('long-feed-350');
     return {openMs:performance.now()-start,sections:document.querySelectorAll('#feedScroller .feedItem').length,
       players:document.querySelectorAll('#feedScroller video.feedVideo').length,
       current:currentFeedKey};
   }''',source)
   ck(str(size)+' complete navigation structure',begin['sections']==720 and begin['current']=='long-feed-350',begin)
   ck(str(size)+' at most five media elements',begin['players']<=5,begin)
   page.wait_for_function("getCurrentFeedVideo()?.readyState>=1",timeout=14000)
   ck(str(size)+' MP4 decodes',page.evaluate('''()=>{const v=getCurrentFeedVideo();return v && v.duration>13 && v.videoWidth===160}'''))
   toggled=page.evaluate('''()=>{
     let costs=[];
     for(let i=0;i<25;i++){const start=performance.now();stepFeed(i%2? -1 : 1);costs.push(performance.now()-start);}
     return {current:currentFeedKey,mean:costs.reduce((a,b)=>a+b,0)/costs.length,max:Math.max(...costs),
       players:document.querySelectorAll('#feedScroller video.feedVideo').length,
       mounted:jfFeedVirtualState.mounted.size};
   }''')
   ck(str(size)+' rapid back/forth bounded',toggled['players']<=5 and toggled['mounted']<=5 and toggled['current']=='long-feed-351',toggled)
   edges=page.evaluate('''()=>{
     const scroller=document.querySelector('#feedScroller');
     let info=[];
     for(const key of ['long-feed-0','long-feed-719','long-feed-710','long-feed-350']){
       const section=feedSections().find(x=>x.dataset.key===key);
       const index=feedSectionIndex(section);currentFeedKey=key;hydrateFeedWindow(index);
       scroller.scrollTop=section.offsetTop;
       info.push({key,video:!!section.querySelector('video.feedVideo'),loaded:!!getCurrentFeedVideo(),
         players:scroller.querySelectorAll('video.feedVideo').length,scrollTop:scroller.scrollTop});
     }
     return info;
   }''')
   ck(str(size)+' middle and terminal reachable',all(x['video'] and x['loaded'] and x['players']<=5 for x in edges),edges)
   page.wait_for_function("getCurrentFeedVideo()?.readyState>=1",timeout=14000)
   page.evaluate('''()=>{getCurrentFeedVideo().pause();getCurrentFeedVideo().currentTime=5;}''')
   page.wait_for_function("Math.abs(getCurrentFeedVideo().currentTime-5)<.4",timeout=8000)
   ck(str(size)+' video seeks',page.evaluate('''()=>seekCurrentFeedSeconds(5)&&Math.abs(getCurrentFeedVideo().currentTime-10)<.5'''))
   page.evaluate('''()=>{const v=getCurrentFeedVideo();v.requestFullscreen()}''')
   page.wait_for_function('!!document.fullscreenElement',timeout=8000)
   switched=page.evaluate('''async()=>{const before={key:currentFeedKey,nativeFullscreenKey,nativeFullscreenSwitching};const res=await stepNativeFullscreen(1);return {before,res,key:currentFeedKey,nativeFullscreenKey,nativeFullscreenSwitching,playerCount:document.querySelectorAll('#feedScroller video.feedVideo').length}}''')
   print('NATIVE STEP',switched,flush=True)
   ck(str(size)+' native step progress',switched['key']=='long-feed-'+str(int(switched['before']['key'].split('-')[-1])+1),switched)
   ck(str(size)+' native fullscreen switch',page.evaluate('''()=>!!fullscreenVideoElement()&&getCurrentFeedItem().key===nativeFullscreenKey&&document.querySelectorAll('#feedScroller video.feedVideo').length<=6'''))
   page.evaluate('''()=>document.exitFullscreen()''')
   page.wait_for_function('!document.fullscreenElement',timeout=9000)
   page.wait_for_timeout(100)
   ck(str(size)+' no old media background',page.evaluate('''()=>[...document.querySelectorAll('#feedScroller video.feedVideo')].filter(v=>!v.paused).length<=1'''))
   reopened=page.evaluate('''()=>{render();openFeed('long-feed-650');return {mounted:jfFeedVirtualState.mounted.size,players:document.querySelectorAll('#feedScroller video.feedVideo').length};}''')
   ck(str(size)+' reopen cleans old player nodes',reopened['players']<=5 and reopened['mounted']<=5,reopened)
   page.evaluate('''()=>closeFeed()''')
   page.wait_for_timeout(200)
   home=page.evaluate('''()=>({scroll:scrollY,tiles:document.querySelectorAll('#grid .jfCoverTile').length,visible:!!document.querySelector('#grid [data-feed-key="long-feed-650"]')})''')
   ck(str(size)+' return from deep feed restores home position',home['scroll']>300 and home['visible'] and home['tiles']<150,home)
   ck(str(size)+' full teardown',page.evaluate('''()=>document.querySelectorAll('#feedScroller video.feedVideo').length===0 && document.querySelector('#feedScroller').children.length===0 && jfFeedVirtualState===null'''))
   ck(str(size)+' no page exceptions',not errors,errors)
   page.close()
  browser.close()
 ck('fixture SHA unchanged',hashlib.sha256(testmp4.read_bytes()).hexdigest()==media_sha)
 report={'passed':len(checks),'failures':[x for x in checks if not x['ok']], 'checks':checks,'buildSha256':hashlib.sha256((ROOT/'dist/douyin.js').read_bytes()).hexdigest()}
 out=ROOT/'dist/video-feed-stress-v719.json';out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print('VIDEO FEED STRESS',len(checks),'PASS',flush=True)
