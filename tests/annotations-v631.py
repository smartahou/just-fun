#!/usr/bin/env python3
"""Just Fun v6.31: real isolated annotation persistence, API and Chromium UI.
Only ephemeral generated media; never uses actual libraries or deletes source material.
"""
import base64,hashlib,json,pathlib,re,tempfile,urllib.request,urllib.error,subprocess,time
from isolated import ROOT,make_fixture,launch,stop,api_wait,urlopen
from playwright.sync_api import sync_playwright

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def post(port,body,route='/api/clips'):
    req=urllib.request.Request(f'http://127.0.0.1:{port}{route}',data=json.dumps(body,ensure_ascii=False).encode(),headers={'Content-Type':'application/json'},method='POST')
    try:
        with urllib.request.urlopen(req,timeout=12) as res:return res.status,json.loads(res.read())
    except urllib.error.HTTPError as exc:return exc.code,json.loads(exc.read())

checks=[]
def ck(msg,ok):
    checks.append((msg,bool(ok)));print(('PASS ' if ok else 'FAIL ')+msg,flush=True)
    if not ok:raise AssertionError(msg)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v631-') as tmp:
    base=pathlib.Path(tmp);lib=base/'工作与课程';originals=make_fixture(lib)
    proc=log=None
    try:
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home')
        data=api_wait(port)
        video=next(x for x in data['items'] if x['kind']=='video')
        audio=next(x for x in data['items'] if x['kind']=='audio')
        ck('Both media types indexed',bool(video['key'] and audio['key']))
        # Audio duration is filled asynchronously by the existing ffprobe sweep.
        for _ in range(40):
            item_data=json.loads(urlopen(f'http://127.0.0.1:{port}/api/data')[2])
            current=next((x for x in item_data.get('items',[]) if x['key']==audio['key']),{})
            if float(current.get('duration') or 0)>0: break
            time.sleep(.2)
        ck('Audio metadata resolved',float(current.get('duration') or 0)>0)
        for item in (video,audio):
            for end in [None,1.75]:
                st,response=post(port,{'action':'create','sourceKey':item['key'],'a':.7,'b':end,'name':'中文课程重点' if end is None else '声音区间'})
                ck(item['kind']+' '+('point' if end is None else 'range')+' created',st==200 and response.get('clip',{}).get('b')==end)
        st,invalid=post(port,{'action':'create','sourceKey':audio['key'],'a':.5,'b':55,'name':'overshoot'})
        ck('Out-of-duration interval rejected',st==400 and not invalid.get('ok'))
        st,invalid=post(port,{'action':'create','sourceKey':audio['key'],'a':-1,'b':None,'name':'negative'})
        ck('Negative time rejected',st==400)
        st,invalid=post(port,{'action':'create','sourceKey':audio['key'],'a':0,'b':0,'name':'bad length'})
        ck('Zero-length interval rejected',st==400)
        _,_,raw=urlopen(f'http://127.0.0.1:{port}/api/clips')
        marks=json.loads(raw)['clips'];ck('List contains 4 persisted annotations',len(marks)==4)
        old=next(x for x in marks if x['kind']=='video' and x['b'] is not None)
        st,r=post(port,{'action':'update','id':old['id'],'name':'编辑后标题','a':.9,'b':None})
        ck('Interval can become a point',st==200 and r['clip']['b'] is None and r['clip']['name']=='编辑后标题')
        st,r=post(port,{'id':old['id']},'/api/clips/export')
        ck('Point export rejected safely',st==400)
        st,r=post(port,{'action':'delete','id':old['id']})
        ck('Delete removes annotation record only',st==200)
        ck('Source video/audio unchanged',all(sha(lib/name)==h for name,h in originals.items()))
        # Existing audio export endpoint remains usable with saved range coordinates.
        audio_segment=next(x for x in marks if x['kind']=='audio' and x['b'] is not None)
        st,exported=post(port,{'key':audio_segment['sourceKey'],'start':audio_segment['a'],'end':audio_segment['b'],'jobId':'9'*32},'/api/clip-audio')
        ck('Audio interval can be exported without touching original',st==200 and exported.get('ok') and all(sha(lib/name)==h for name,h in originals.items()))
        # Exit + restart with the exact same fixture and home/cache.
        stop(proc,log);proc=log=None
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home')
        api_wait(port)
        _,_,raw=urlopen(f'http://127.0.0.1:{port}/api/clips');persisted=json.loads(raw)['clips']
        ck('Three annotations restored after restart',len(persisted)==3)
        ck('Point and interval type preserved',sum(x['b'] is None for x in persisted)==2 and sum(x['b'] is not None for x in persisted)==1)
        ck('Original source hashes preserved on restart',all(sha(lib/name)==h for name,h in originals.items()))
    finally:
        if proc:stop(proc,log)

    # Browser UI using the actual assembled HTML + real encoded temporary media;
    # mocked network prevents browser tests from making destructive API calls.
    script=(ROOT/'dist/douyin.js').read_text(encoding='utf8')
    m=re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',script)
    assert m,'HTML embed missing'
    html=json.loads(m.group(1))
    video_path=base/'browser-h264.mp4';audio_path=lib/'测试音频 2.mp3'
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=200x140:rate=10:duration=3','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',str(video_path)],check=True,timeout=30)
    video_data='data:video/mp4;base64,'+base64.b64encode(video_path.read_bytes()).decode()
    audio_data='data:audio/mpeg;base64,'+base64.b64encode(audio_path.read_bytes()).decode()
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
        page=browser.new_page(viewport={'width':1440,'height':900})
        errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
        page.evaluate('''() => {window.__annotations=[];window.fetch=async(input,options={})=>{
          const path=String(input?.url||input);
          if(path.includes('/api/clips')){
            if(options.method==='POST'){
              const body=JSON.parse(options.body);
              if(body.action==='create'){
                const created={...body,id:'a'.repeat(23)+String(window.__annotations.length),
                  b:body.b===null?null:body.b,sourceAvailable:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
                  kind:body.sourceKey==='video-ui'?'video':'audio',sourceTitle:'测试课程',sourceDuration:4};
                window.__annotations.push(created);return {ok:true,json:async()=>({ok:true,clip:created})};
              }
              if(body.action==='delete'){window.__annotations=window.__annotations.filter(x=>x.id!==body.id);return {ok:true,json:async()=>({ok:true})}}
              if(body.action==='update'){const found=window.__annotations.find(x=>x.id===body.id);Object.assign(found,body,{updatedAt:new Date().toISOString()});return {ok:true,json:async()=>({ok:true,clip:found})}}
            }
            return {ok:true,json:async()=>({ok:true,clips:window.__annotations.map(x=>({...x}))})};
          }
          return {ok:true,status:200,json:async()=>({items:window.__testMedia||[],folders:[],scanStatus:'ready'}),text:async()=>''};
        }}''')
        page.set_content(html,wait_until='load',timeout=20000)
        page.wait_for_timeout(1400)
        page.evaluate('''([v,a])=>{
          allItems=[{kind:'video',key:'video-ui',title:'模拟视频',creator:'Test',duration:3,mediaUrl:v},
                    {kind:'audio',key:'audio-ui',title:'模拟音频',creator:'Test',duration:4,mediaUrl:a}];
          window.__testMedia=allItems;currentRenderedItems=[allItems[0]];
          openFeed('video-ui');
        }''',[video_data,audio_data])
        page.wait_for_timeout(1500)
        page.wait_for_function('getCurrentFeedVideo()?.readyState>=1',timeout=4000)
        page.evaluate('''() => {getCurrentFeedVideo().pause();getCurrentFeedVideo().currentTime=.8}''')
        page.locator('#feedBookmark').evaluate('(el)=>el.click()')
        page.wait_for_timeout(250)
        page.wait_for_function('window.__annotations.length===1',timeout=5000)
        ck('Video point button creates annotation',page.evaluate('window.__annotations[0].b===null'))
        page.evaluate('getCurrentFeedVideo().currentTime=1.2')
        page.locator('#feedRangeMark').evaluate('(el)=>el.click()')
        page.evaluate('getCurrentFeedVideo().currentTime=2')
        page.locator('#feedRangeMark').evaluate('(el)=>el.click()')
        page.wait_for_function('window.__annotations.length===2')
        ck('Video start+end creates interval',page.evaluate('window.__annotations[1].b===2 && window.__annotations[1].a===1.2'))
        ck('Video marks shown on timeline',page.locator('#feedScroller .jfAnnotationRail [data-annotation-id]').count()==2)
        page.evaluate('getCurrentFeedVideo().currentTime=0')
        page.locator('#feedScroller .jfAnnotationPoint').first.evaluate('(el)=>el.click()')
        ck('Video timeline marker seeks to time',abs(page.evaluate('getCurrentFeedVideo().currentTime')-.8)<.2)
        page.evaluate('''() => {closeFeed();openAudioDock('audio-ui')}''')
        page.wait_for_function('document.querySelector("#audioDock audio")?.readyState>=1',timeout=12000)
        page.evaluate('''() => {const a=document.querySelector('#audioDock audio');a.pause();a.currentTime=.9}''')
        page.locator('#audioDock [data-annotation-action="point"]').evaluate('(el)=>el.click()')
        page.wait_for_function('window.__annotations.length===3')
        ck('Audio point annotation created',page.evaluate('window.__annotations[2].kind==="audio" && window.__annotations[2].b===null'))
        page.locator('#audioDock [data-annotation-action="range"]').evaluate('(el)=>el.click()')
        page.evaluate('document.querySelector("#audioDock audio").currentTime=2.3')
        page.locator('#audioDock [data-annotation-action="range"]').evaluate('(el)=>el.click()')
        page.wait_for_function('window.__annotations.length===4')
        ck('Audio interval annotation created',page.evaluate('window.__annotations[3].kind==="audio" && Math.abs(window.__annotations[3].b-2.3)<.05'))
        ck('Audio marks shown on progress track',page.locator('#audioDock .jfAnnotationAudioMarks [data-annotation-id]').count()==2)
        page.locator('#audioDock [data-annotation-action="shelf"]').evaluate('(el)=>el.click()')
        page.wait_for_function('document.querySelectorAll("#clipShelfList .clipShelfRow").length===2')
        ck('Shelf filters to current audio',page.locator('#clipShelfList .clipShelfRow').count()==2)
        page.locator('#clipShelfOnly').uncheck()
        ck('Shelf includes both media types',page.locator('#clipShelfList .clipShelfRow').count()==4)
        page.locator('#clipShelfSearch').fill('模拟')
        page.locator('#clipShelfSearch').fill('标记')
        ck('Shelf search filters by annotation name',page.locator('#clipShelfList .clipShelfRow').count()==2)
        page.locator('#clipShelfSearch').fill('')
        ck('Shelf is simplified without edit and add buttons',page.locator('#clipShelfList [data-clip-action="edit"]').count()==0 and page.locator('#clipShelfNew').count()==0)
        # Naming is now an inline popover operation; API update remains backwards-compatible.
        id=page.evaluate('window.__annotations[0].id')
        page.evaluate('''async id=>{const clip=window.__annotations.find(x=>x.id===id);await clipShelfPost({action:'update',id,name:'修改中文标注',a:clip.a,b:clip.b});await clipShelfFetch();clipShelfRender();}''',id)
        page.wait_for_function('window.__annotations.some(x=>x.name==="修改中文标注")')
        ck('Existing annotation metadata updates remain supported',page.locator('#clipShelfList').inner_text().find('修改中文标注')>=0)
        ck('No browser JS exceptions',not errors)
        # One screenshot purely for local QA, never packed into release archives.
        (ROOT/'dist'/'annotation-preview.png').parent.mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT/'dist'/'annotation-preview.png'))
        browser.close()
print('ANNOTATION CHECKS',sum(x[1] for x in checks),'/',len(checks))
(ROOT/'dist'/'annotations-v631-report.json').write_text(json.dumps({'passed':sum(x[1] for x in checks),'total':len(checks),'checks':checks},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
