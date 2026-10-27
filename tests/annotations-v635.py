#!/usr/bin/env python3
"""v6.35 regression: annotation colors, user interactions, audio pin connector and Esc.
Only temporary fixture libraries. No user media accessed.
"""
import base64,hashlib,json,pathlib,re,subprocess,tempfile,urllib.request,urllib.error
from isolated import ROOT,make_fixture,launch,stop,api_wait,urlopen
from playwright.sync_api import sync_playwright
passed=[]
def ck(label,yes):
    print(('PASS ' if yes else 'FAIL ')+label,flush=True);passed.append(bool(yes));assert yes,label
def post(port,payload):
    req=urllib.request.Request(f'http://127.0.0.1:{port}/api/clips',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
    try:
        with urllib.request.urlopen(req,timeout=12) as result:return result.status,json.load(result)
    except urllib.error.HTTPError as error:return error.code,json.loads(error.read())
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v635-') as folder:
    tmp=pathlib.Path(folder);lib=tmp/'中文测试课程';originals=make_fixture(lib)
    proc=log=None
    try:
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home')
        data=api_wait(port)
        v=next(x for x in data['items'] if x['kind']=='video')
        a=next(x for x in data['items'] if x['kind']=='audio')
        st,old=post(port,{'action':'create','sourceKey':v['key'],'a':.5,'b':None,'name':'旧版默认颜色'})
        ck('Old-style creation defaults to cyan',st==200 and old['clip']['color']=='default')
        st,created=post(port,{'action':'create','sourceKey':a['key'],'a':.5,'b':1.5,'name':'音频区间','color':'rose'})
        ck('Audio interval accepts rose palette',st==200 and created['clip']['color']=='rose')
        st,updated=post(port,{'action':'update','id':old['clip']['id'],'color':'amber'})
        ck('Video point can change to amber',st==200 and updated['clip']['color']=='amber')
        st,invalid=post(port,{'action':'update','id':old['clip']['id'],'color':'red;position:fixed'})
        ck('Reject arbitrary CSS colors',st==400 and not invalid.get('ok'))
        st,invalid=post(port,{'action':'create','sourceKey':v['key'],'a':1,'b':None,'name':'bad','color':'#fff'})
        ck('Reject unknown palette at creation',st==400 and not invalid.get('ok'))
        _,_,raw=urlopen(f'http://127.0.0.1:{port}/api/clips');colors={x['id']:x['color'] for x in json.loads(raw)['clips']}
        ck('GET reflects persisted video/audio colors',colors[old['clip']['id']]=='amber' and colors[created['clip']['id']]=='rose')
        ck('No source media changed by color updates',all(hashlib.sha256((lib/name).read_bytes()).hexdigest()==h for name,h in originals.items()))
        stop(proc,log);proc=log=None
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home');api_wait(port)
        _,_,raw=urlopen(f'http://127.0.0.1:{port}/api/clips');colors={x['id']:x['color'] for x in json.loads(raw)['clips']}
        ck('Colors survive server restart',colors[old['clip']['id']]=='amber' and colors[created['clip']['id']]=='rose')
    finally:
        if proc:stop(proc,log)
    code=(ROOT/'dist/douyin.js').read_text()
    html=json.loads(re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',code).group(1))
    clip=tmp/'fake-video.mp4'
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=10:duration=3','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',str(clip)],check=True,timeout=30)
    video='data:video/mp4;base64,'+base64.b64encode(clip.read_bytes()).decode()
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        page=browser.new_page(viewport={'width':1400,'height':900})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.evaluate('''()=>{window.__marks=[];window.fetch=async(input,opts={})=>{
          const path=String(input?.url||input),b=opts.body?JSON.parse(opts.body):{};
          if(path.includes('/api/clips')){
           if(opts.method==='POST'){
            if(b.action==='create'){
             const clip={...b,id:'test'+window.__marks.length,kind:b.sourceKey==='v'?'video':'audio',color:b.color||'default',sourceAvailable:true,sourceTitle:'学习课程',createdAt:'2026',updatedAt:'2026'};
             window.__marks.push(clip);return {ok:true,json:async()=>({ok:true,clip})};
            }
            if(b.action==='update'){
             const clip=window.__marks.find(x=>x.id===b.id);Object.assign(clip,b);return {ok:true,json:async()=>({ok:true,clip})};
            }
           }
           return {ok:true,json:async()=>({ok:true,clips:window.__marks})};
          }
          return {ok:true,status:200,json:async()=>({items:[],folders:[],scanStatus:'ready'}),text:async()=>''};
        }}''')
        page.set_content(html,wait_until='load',timeout=20000)
        page.wait_for_timeout(550)
        page.evaluate('''(src)=>{
          allItems=[{key:'v',kind:'video',title:'学习课程',duration:3,mediaUrl:src},
                    {key:'a',kind:'audio',title:'录音',duration:3,mediaUrl:'data:audio/mpeg;base64,'}];
          currentRenderedItems=[allItems[0]];openFeed('v');
        }''',video)
        page.wait_for_function('getCurrentFeedVideo()?.readyState>=1',timeout=7000)
        page.evaluate('''()=>{getCurrentFeedVideo().pause();getCurrentFeedVideo().currentTime=1.25;}''')
        ck('Video playback bar has point + interval controls',page.locator('.jfTimelineMarkPoint').count()==1 and page.locator('.jfTimelineMarkRange').count()==1)
        page.locator('#feedScroller .jfTimelineMarkPoint').evaluate('(b)=>b.click()')
        page.wait_for_function('window.__marks.length===1')
        ck('Timeline quick button saved 1.25 second point',abs(page.evaluate('window.__marks[0].a')-1.25)<.1)
        page.locator('#feedScroller .jfAnnotationPoint').first.hover(force=True)
        page.wait_for_function('!document.querySelector("#jfMarkPopover").hidden')
        ck('Six labeled color presets visible',page.locator('#jfMarkPopover [data-jf-color]').count()==6)
        page.locator('#jfMarkPopover [data-jf-color="violet"]').click()
        page.wait_for_function('window.__marks[0].color==="violet"')
        ck('Popover persists violet and updates marker CSS',page.evaluate('''()=>document.querySelector('#feedScroller .jfAnnotationPoint').style.getPropertyValue('--jf-mark-color')==='#bdacf5' '''))
        ck('Popover pressed state reflects color',page.locator('#jfMarkPopover [data-jf-color="violet"]').get_attribute('aria-pressed')=='true')
        page.evaluate('''()=>{jfPopoverHide();getCurrentFeedVideo().currentTime=.4;}''')
        page.locator('#feedScroller .jfTimelineMarkRange').evaluate('(b)=>b.click()')
        ck('Range quick button activates',page.locator('#feedScroller .jfTimelineMarkRange').get_attribute('aria-pressed')=='true')
        page.evaluate('getCurrentFeedVideo().currentTime=1.8')
        page.locator('#feedScroller .jfTimelineMarkRange').evaluate('(b)=>b.click()')
        page.wait_for_function('window.__marks.length===2')
        ck('Range quick button creates interval',page.evaluate('''()=>window.__marks[1].b>window.__marks[1].a'''))
        page.evaluate('''()=>{closeFeed();openAudioDock('a');libraryMode='audio';syncAudioDockMode();}''')
        page.wait_for_timeout(200)
        page.evaluate('''()=>{const dock=document.querySelector('#audioDock');const root=dock.querySelector('.jfAnnotationAudioMarks');clipShelfRecords=[{id:'aa',sourceKey:'a',kind:'audio',name:'录音标记',a:1,color:'amber'}];jfAnnotationPaint(root,{duration:3});}''')
        position=page.evaluate('''()=>{
          const dot=document.querySelector('#audioDock .jfAnnotationPoint'),line=getComputedStyle(dot,'::after');
          const p=dot.getBoundingClientRect(),seek=document.querySelector('#audioDock .audioSeek').getBoundingClientRect();
          const rail=dot.parentElement.getBoundingClientRect();
          return {tip:p.top+parseFloat(line.top)+parseFloat(line.height),seekY:seek.top+seek.height/2,railBottom:rail.bottom,stemHeight:parseFloat(line.height)};
        }''')
        ck('Audio mark stem visibly meets seek track',abs(position['tip']-position['seekY'])<3.5 and position['stemHeight']>=7)
        dims=page.evaluate('''()=>{const v=document.querySelector('#audioDock .jfAudioShelf svg'),other=document.querySelector('#audioDock .jfAudioBookmark svg');const a=v.getBoundingClientRect(),b=other.getBoundingClientRect();return [a.width,a.height,b.width,b.height,getComputedStyle(v).stroke,getComputedStyle(other).stroke]}''')
        ck('Audio annotation library icon matches size/paint',abs(dims[0]-dims[2])<1 and abs(dims[1]-dims[3])<1 and dims[4]==dims[5])
        page.locator('body').click(position={'x':2,'y':2},force=True)
        page.keyboard.press('Escape')
        ck('Escape minimizes expanded audio on audio page',page.evaluate('''()=>document.querySelector('#audioDock').classList.contains('isMinimized')'''))
        ck('Audio remains loaded on minimization',page.evaluate('''()=>document.querySelector('#audioDock audio')?.isConnected'''))
        ck('No browser script errors',not errors)
        browser.close()
print('V635',len(passed),'/',len(passed))
