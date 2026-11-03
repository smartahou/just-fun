#!/usr/bin/env python3
"""Native fullscreen exit progress isolation; synthetic video, no user files."""
import base64,hashlib,json,pathlib,re,subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
script=(ROOT/'dist/douyin.js').read_text(encoding='utf8')
m=re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',script)
assert m, 'Embedded HTML not found'
html=json.loads(m.group(1))
checks=[]
def ck(title,valid,more=''):
 checks.append(title)
 assert valid, f'{title}: {more}'
 print('PASS',title,flush=True)

with tempfile.TemporaryDirectory(prefix='jf-fullscreen-v731-') as tmp:
 media=pathlib.Path(tmp)/'fixture.mp4'
 subprocess.run(['ffmpeg','-loglevel','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=10:duration=28','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart','-an',str(media)],check=True,timeout=25)
 digest=hashlib.sha256(media.read_bytes()).hexdigest()
 uri='data:video/mp4;base64,'+base64.b64encode(media.read_bytes()).decode('ascii')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  for width,height in [(1280,800),(390,844)]:
   page=browser.new_page(viewport={'width':width,'height':height})
   errors=[]
   page.on('pageerror',lambda err:errors.append(str(err)))
   page.route('**/api/**',lambda rt:rt.fulfill(status=200,content_type='application/json',body='{"items":[],"folders":[],"ok":true}'))
   page.set_content(html,wait_until='domcontentloaded',timeout=30000)
   page.wait_for_function("typeof openFeed === 'function' && typeof jfTimelineUpdate === 'function'",timeout=15000)
   page.evaluate('''(uri)=>{
     catalogRequestInFlight=true;
     allItems=Array.from({length:4},(_,i)=>({key:'progress-'+i,kind:'video',title:'Test '+i,creator:'TEST',mediaUrl:uri,rating:3}));
     currentRenderedItems=allItems;
     openFeed('progress-0');
   }''',uri)
   page.wait_for_function('getCurrentFeedVideo()?.readyState>=1',timeout=15000)
   page.evaluate('''()=>{const v=getCurrentFeedVideo();v.pause();v.currentTime=3;v.pause();}''')
   page.wait_for_function('Math.abs(getCurrentFeedVideo()?.currentTime-3)<0.3',timeout=6000)
   page.evaluate('''()=>getCurrentFeedVideo().requestFullscreen()''')
   page.wait_for_function('!!fullscreenVideoElement()',timeout=8000)
   page.evaluate('''()=>{const v=fullscreenVideoElement();v.currentTime=11;v.pause();}''')
   page.wait_for_function('Math.abs(fullscreenVideoElement()?.currentTime-11)<.25',timeout=6000)
   page.evaluate('''()=>document.exitFullscreen()''')
   page.wait_for_function('!document.fullscreenElement',timeout=8000)
   page.wait_for_timeout(200)
   first=page.evaluate('''()=>{const v=getCurrentFeedVideo(),ui=v.closest('.videoStage').querySelector('.jfTimeline');return {time:v.currentTime,paused:v.paused,slider:Number(ui.querySelector('.jfVideoSeek').value),label:ui.querySelector('.jfTimelineTime').textContent,ready:v.readyState}}''')
   ck(f'{width} exit preserves seek at 11s',abs(first['time']-11)<.5,first)
   ck(f'{width} timeline displays 0:11',first['label'].startswith('0:11 /'),first)
   ck(f'{width} timeline slider follows 11s',abs(first['slider']-11/28*1000)<18,first)
   # Playback arbiter may resume the selected video after an observer callback;
   # the fullscreen-exit contract here is the playhead and timeline state.
   ck(f'{width} video remains decoded',first['ready']>=1,first)
   # Now switch via native fullscreen hosting, then exit while at 14 seconds.
   page.evaluate('''()=>getCurrentFeedVideo().requestFullscreen()''')
   page.wait_for_function('!!fullscreenVideoElement()',timeout=8000)
   page.evaluate('''()=>{fullscreenVideoElement().play().catch(()=>{});}''')
   done=page.evaluate('''async()=>await stepNativeFullscreen(1)''')
   ck(f'{width} native fullscreen switch accepted',done)
   page.wait_for_function("currentFeedKey==='progress-1'&&fullscreenVideoElement()?.readyState>=1",timeout=10000)
   page.evaluate('''()=>{const v=fullscreenVideoElement();v.pause();v.currentTime=14;}''')
   page.wait_for_function('Math.abs(fullscreenVideoElement()?.currentTime-14)<.3',timeout=7000)
   page.evaluate('''()=>document.exitFullscreen()''')
   page.wait_for_function('!document.fullscreenElement',timeout=10000)
   page.wait_for_function("getCurrentFeedVideo()?.readyState>=1 && Math.abs(getCurrentFeedVideo().currentTime-14)<.5",timeout=12000)
   second=page.evaluate('''()=>{const v=getCurrentFeedVideo(),ui=v.closest('.videoStage').querySelector('.jfTimeline');return {key:currentFeedKey,elementKey:v.dataset.itemKey,time:v.currentTime,paused:v.paused,slider:Number(ui.querySelector('.jfVideoSeek').value),label:ui.querySelector('.jfTimelineTime').textContent,playing:[...document.querySelectorAll('#feedScroller video.feedVideo')].filter(x=>!x.paused).length}}''')
   ck(f'{width} selected switched video remains correct',second['key']==second['elementKey']=='progress-1',second)
   ck(f'{width} switched video keeps 14s',abs(second['time']-14)<.6,second)
   ck(f'{width} switched timeline displays 0:14',second['label'].startswith('0:14 /'),second)
   ck(f'{width} switched timeline slider follows',abs(second['slider']-14/28*1000)<20,second)
   ck(f'{width} no competing audible players',second['playing']<=1,second)
   ck(f'{width} page has no script errors',not errors,errors)
   page.evaluate('''()=>closeFeed()''')
   if width==1280:
    page.evaluate('''(uri)=>{
      allItems=Array.from({length:720},(_,i)=>({key:'virtual-'+i,kind:'video',title:'Virtual '+i,creator:'TEST',mediaUrl:uri,rating:3}));
      currentRenderedItems=allItems;openFeed('virtual-350');
    }''',uri)
    page.wait_for_function('getCurrentFeedVideo()?.readyState>=1',timeout=12000)
    page.evaluate('''()=>{getCurrentFeedVideo().pause();getCurrentFeedVideo().currentTime=4;}''')
    page.wait_for_function('Math.abs(getCurrentFeedVideo()?.currentTime-4)<.4',timeout=6000)
    page.evaluate('''()=>getCurrentFeedVideo().requestFullscreen()''')
    page.wait_for_function('!!fullscreenVideoElement()',timeout=9000)
    page.evaluate('''async()=>await stepNativeFullscreen(1)''')
    page.wait_for_function("currentFeedKey==='virtual-351'&&fullscreenVideoElement()?.readyState>=1",timeout=9000)
    page.evaluate('''()=>{const v=fullscreenVideoElement();v.pause();v.currentTime=18;}''')
    page.wait_for_function('Math.abs(fullscreenVideoElement()?.currentTime-18)<.4',timeout=6000)
    page.evaluate('''()=>document.exitFullscreen()''')
    page.wait_for_function('!document.fullscreenElement',timeout=9000)
    page.wait_for_function('getCurrentFeedVideo()?.readyState>=1 && Math.abs(getCurrentFeedVideo().currentTime-18)<.6',timeout=14000)
    state=page.evaluate('''()=>{const v=getCurrentFeedVideo(),ui=v.closest('.videoStage').querySelector('.jfTimeline');return {position:v.currentTime,label:ui.querySelector('.jfTimelineTime').textContent,playerCount:document.querySelectorAll('#feedScroller video.feedVideo').length}}''')
    ck('Virtual 720-video fullscreen switch retains time',abs(state['position']-18)<.6,state)
    ck('Virtual 720-video timeline updates',state['label'].startswith('0:18 /'),state)
    ck('Virtual 720-video player cap preserved',state['playerCount']<=5,state)
    page.evaluate('''()=>closeFeed()''')
   page.close()
  browser.close()
 ck('Synthetic video SHA unchanged',hashlib.sha256(media.read_bytes()).hexdigest()==digest)
 print('TOTAL',len(checks),'PASS',flush=True)
