#!/usr/bin/env python3
"""v7.21: queued feed-observer/animation callbacks cannot escape their session.
All media are synthetic MP4s within the browser. Never open a personal library.
"""
import base64, hashlib, json, pathlib, re, subprocess, tempfile
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
js=(ROOT/'dist/douyin.js').read_text(encoding='utf8')
match=re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',js)
assert match,'Cannot find offline browser HTML'
html=json.loads(match.group(1))
results=[]
def check(name,value,detail=None):
    results.append({'name':name,'passed':bool(value),'detail':detail})
    print(('PASS ' if value else 'FAIL ')+name,flush=True)
    if not value: raise AssertionError(f'{name}: {detail}')
with tempfile.TemporaryDirectory(prefix='jf-v721-feed-isolation-') as td:
    mp4=pathlib.Path(td)/'isolated.mp4'
    subprocess.run(['ffmpeg','-hide_banner','-nostdin','-loglevel','error','-y',
        '-f','lavfi','-i','testsrc2=size=96x54:rate=8:duration=3',
        '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-an',
        '-movflags','+faststart',str(mp4)],check=True,timeout=30)
    original_sha=hashlib.sha256(mp4.read_bytes()).hexdigest()
    src='data:video/mp4;base64,'+base64.b64encode(mp4.read_bytes()).decode()
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
            args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        for width,height in [(1440,900),(390,844)]:
            page=browser.new_page(viewport={'width':width,'height':height})
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.route('**/api/**',lambda route:route.fulfill(status=200,content_type='application/json',body='{"ok":true,"items":[],"folders":[]}'))
            page.set_content(html,wait_until='domcontentloaded',timeout=45000)
            tag=f'{width}x{height}'
            page.evaluate('''src=>{
                catalogRequestInFlight=true;
                window.feedCallbacks=[];window.feedPlayCalls=[];
                const RealIO=window.IntersectionObserver;
                window.IntersectionObserver=class extends RealIO {
                  constructor(cb,opt){
                    super(cb,opt);
                    if(opt?.root?.id==='feedScroller')feedCallbacks.push(cb);
                  }
                };
                const originalPlay=HTMLMediaElement.prototype.play;
                HTMLMediaElement.prototype.play=function(){
                  if(this.matches?.('video.feedVideo'))feedPlayCalls.push({attached:this.isConnected,key:this.closest('.feedItem')?.dataset.key});
                  return originalPlay.apply(this,arguments);
                };
                allItems=Array.from({length:720},(_,i)=>({key:'v-'+i,kind:'video',title:'video '+i,creator:'isolated',mediaUrl:src,rating:3}));
                currentRenderedItems=allItems;
                openFeed('v-350');
                window.oldSection=feedSections()[350];
                closeFeed();
                openFeed('v-500');
            }''',src)
            page.wait_for_timeout(180)
            initial=page.evaluate('''()=>({key:currentFeedKey,generation:jfFeedSessionGeneration,
                players:document.querySelectorAll('#feedScroller video.feedVideo').length,
                callbacks:feedCallbacks.length,ghost:feedPlayCalls.filter(c=>!c.attached)})''')
            check(tag+' new session owns the current feed',initial['key']=='v-500' and initial['generation']>=3,initial)
            check(tag+' fast reopen never plays detached video',not initial['ghost'],initial['ghost'])
            check(tag+' virtual feed keeps five media nodes',initial['players']<=5,initial)
            # Force-deliver an old callback even though the browser has disconnected it.
            old=page.evaluate('''()=>{
              feedCallbacks[0]([{isIntersecting:true,intersectionRatio:1,target:oldSection}]);
              return {key:currentFeedKey,nodes:document.querySelectorAll('#feedScroller video.feedVideo').length};
            }''')
            check(tag+' old observer cannot overwrite new feed key',old['key']=='v-500',old)
            check(tag+' old observer cannot mount extra videos',old['nodes']<=5,old)
            # Current-session callback remains functional for normal navigation.
            current=page.evaluate('''()=>{
              const sec=feedSections()[501];
              document.getElementById('feedScroller').scrollTop=sec.offsetTop;
              feedCallbacks[feedCallbacks.length-1]([{isIntersecting:true,intersectionRatio:1,target:sec}]);
              return {key:currentFeedKey,nodes:document.querySelectorAll('#feedScroller video.feedVideo').length};
            }''')
            check(tag+' current observer still handles valid sections',current['key']=='v-501',current)
            check(tag+' current observer respects player cap',current['nodes']<=5,current)
            # A callback for a section not owned by the current scroller is rejected.
            foreign=page.evaluate('''()=>{
              const detached=document.createElement('section');
              detached.className='feedItem';detached.dataset.index='666';detached.dataset.key='v-666';
              feedCallbacks[feedCallbacks.length-1]([{isIntersecting:true,intersectionRatio:1,target:detached}]);
              return currentFeedKey;
            }''')
            check(tag+' foreign DOM section is ignored',foreign=='v-501',foreign)
            after_close=page.evaluate('''()=>{
              const callback=feedCallbacks[feedCallbacks.length-1];
              const section=feedSections()[501];
              closeFeed();
              callback([{isIntersecting:true,intersectionRatio:1,target:section}]);
              return {key:currentFeedKey,open:document.querySelector('#feedOverlay').classList.contains('open'),
                nodes:document.querySelectorAll('#feedScroller video.feedVideo').length,virtual:jfFeedVirtualState};
            }''')
            check(tag+' callback after close leaves feed closed',after_close['key']=='' and not after_close['open'],after_close)
            check(tag+' callback after close leaves no media nodes',after_close['nodes']==0 and after_close['virtual'] is None,after_close)
            # Nonvirtual feeds must enjoy the same session isolation.
            small=page.evaluate('''src=>{
              allItems=Array.from({length:4},(_,i)=>({key:'small-'+i,kind:'video',mediaUrl:src,title:'small'}));
              currentRenderedItems=allItems;
              openFeed('small-1');
              const prev=feedCallbacks[feedCallbacks.length-1];
              const former=feedSections()[1];
              closeFeed();openFeed('small-2');
              prev([{isIntersecting:true,intersectionRatio:1,target:former}]);
              const ret={key:currentFeedKey,virtual:jfFeedVirtualState,nodes:document.querySelectorAll('#feedScroller video.feedVideo').length};
              closeFeed();return ret;
            }''',src)
            check(tag+' small-catalog stale observer blocked',small['key']=='small-2' and small['virtual'] is None and small['nodes']==4,small)
            check(tag+' no browser exceptions',not errors,errors)
            page.close()
        browser.close()
    check('synthetic MP4 unchanged',hashlib.sha256(mp4.read_bytes()).hexdigest()==original_sha)
(ROOT/'dist/feed-session-isolation-v721.json').write_text(json.dumps({
    'checks':results,'passed':len(results),
    'buildSha256':hashlib.sha256((ROOT/'dist/douyin.js').read_bytes()).hexdigest()
},ensure_ascii=False,indent=2)+'\n')
print('FEED SESSION ISOLATION',len(results),'PASS',flush=True)
