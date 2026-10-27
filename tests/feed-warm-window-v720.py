#!/usr/bin/env python3
"""v7.20: measured, bounded in-memory Feed reuse on isolated synthetic MP4.

No disk caching and no real media/Workspace access. Guard against repeated
video.load() churn for alternating swipes while preserving playback isolation.
"""
import base64,hashlib,json,pathlib,re,subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
text=(ROOT/'dist/douyin.js').read_text(encoding='utf8')
match=re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',text)
assert match, 'Missing embedded HTML'
html=json.loads(match.group(1))
results=[]
def check(title,value,detail=None):
    results.append({'name':title,'passed':bool(value),'detail':detail})
    print(('PASS ' if value else 'FAIL ')+title,flush=True)
    if not value: raise AssertionError(title+': '+str(detail))
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-feedwarm-v720-') as td:
    media=pathlib.Path(td)/'test.mp4'
    subprocess.run(['ffmpeg','-hide_banner','-nostdin','-loglevel','error','-y',
       '-f','lavfi','-i','testsrc2=size=96x54:rate=8:duration=6',
       '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-an',
       '-movflags','+faststart',str(media)],check=True,timeout=28)
    orig_hash=hashlib.sha256(media.read_bytes()).hexdigest()
    url='data:video/mp4;base64,'+base64.b64encode(media.read_bytes()).decode('ascii')
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
            args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        for width,height in [(1440,900),(390,844)]:
            page=browser.new_page(viewport={'width':width,'height':height})
            errors=[];page.on('pageerror',lambda exc: errors.append(str(exc)))
            page.route('**/api/**',lambda route:route.fulfill(status=200,content_type='application/json',body='{"ok":true,"items":[],"folders":[]}'))
            page.set_content(html,wait_until='domcontentloaded',timeout=40000)
            page.wait_for_timeout(80)
            result=page.evaluate('''src=>{
                catalogRequestInFlight=true;
                const base=HTMLMediaElement.prototype.load;
                window.jfWarmCalls=[];
                HTMLMediaElement.prototype.load=function(){
                  if(this.matches?.('video.feedVideo'))window.jfWarmCalls.push({key:this.closest('.feedItem')?.dataset.key,hasSrc:!!this.getAttribute('src')});
                  return base.apply(this,arguments);
                };
                allItems=Array.from({length:720},(_,i)=>({key:'warm-'+i,kind:'video',title:String(i),creator:'isolated',mediaUrl:src,rating:3}));
                currentRenderedItems=allItems;
                openFeed('warm-350');
                const startup=window.jfWarmCalls.length;
                for(let i=0;i<30;i++)stepFeed(i%2?-1:1);
                const alternating={startup,extra:window.jfWarmCalls.length-startup,
                    requests:window.jfWarmCalls.slice(),current:currentFeedKey,
                    loaded:[...document.querySelectorAll('#feedScroller video.feedVideo')].filter(v=>v.dataset.loaded==='1').length,
                    nodes:document.querySelectorAll('#feedScroller video.feedVideo').length};
                stepFeed(1);stepFeed(1);stepFeed(1);
                const forward={current:currentFeedKey,loaded:[...document.querySelectorAll('#feedScroller video.feedVideo')].filter(v=>v.dataset.loaded==='1').length,
                    nodes:document.querySelectorAll('#feedScroller video.feedVideo').length};
                return {alternating,forward};
            }''',url)
            a=result['alternating'];f=result['forward'];tag=f'{width}x{height}'
            check(tag+' 30 alternating swipes avoid repeated load()', a['extra']<=3,a)
            check(tag+' no more than five players or loaded resources',a['nodes']<=5 and a['loaded']<=5 and f['nodes']<=5 and f['loaded']<=5,result)
            check(tag+' directional step reaches correct video',a['current']=='warm-350' and f['current']=='warm-353',result)
            page.wait_for_function("getCurrentFeedVideo()?.readyState>=1",timeout=12000)
            check(tag+' real MP4 metadata decoded',page.evaluate('''()=>getCurrentFeedVideo().videoWidth===96 && getCurrentFeedVideo().duration>5'''))
            check(tag+' inactive video never plays',page.evaluate('''()=>[...document.querySelectorAll('#feedScroller video.feedVideo')].filter(v=>!v.paused).length<=1'''))
            page.evaluate('''()=>{closeFeed()}''')
            check(tag+' closeFeed clears all media',page.evaluate('''()=>document.querySelectorAll('#feedScroller video').length===0&&jfFeedVirtualState===null'''))
            # Small library remains on the untouched, nonvirtualized path.
            check(tag+' small feed unchanged',page.evaluate('''src=>{
               allItems=Array.from({length:5},(_,i)=>({key:'small-'+i,kind:'video',mediaUrl:src,title:'small'}));
               currentRenderedItems=allItems;openFeed('small-2');
               const ret=jfFeedVirtualState===null&&document.querySelectorAll('#feedScroller video.feedVideo').length===5;
               closeFeed();return ret;
            }''',url))
            check(tag+' no browser exceptions',not errors,errors)
            page.close()
        browser.close()
    check('fixture unchanged',hashlib.sha256(media.read_bytes()).hexdigest()==orig_hash)
(ROOT/'dist/feed-warm-window-v720.json').write_text(json.dumps({'passed':len(results),'checks':results,
  'buildSha256':hashlib.sha256((ROOT/'dist/douyin.js').read_bytes()).hexdigest()},ensure_ascii=False,indent=2)+'\n')
print('FEED WARM WINDOW',len(results),'PASS',flush=True)
