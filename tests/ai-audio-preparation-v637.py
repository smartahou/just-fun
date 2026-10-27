#!/usr/bin/env python3
"""v6.40 regression: full-length unsegmented source audio, video sidecars, safety."""
import pathlib,tempfile,hashlib,subprocess,time,json,urllib.request,urllib.error
from isolated import ROOT,launch,stop,urlopen

checks=[]
def ck(name,condition):
    checks.append(name);print(('PASS ' if condition else 'FAIL ')+name,flush=True)
    if not condition:raise AssertionError(name)
def post(port,data):
    req=urllib.request.Request(f'http://127.0.0.1:{port}/api/ai-audio-export',data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=12) as r:return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
def get(port,route):return json.loads(urlopen(f'http://127.0.0.1:{port}{route}',timeout=6)[2])
def h(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def gen(args):subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',*args],check=True,timeout=90,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def ready(port,count):
    for _ in range(120):
        data=get(port,'/api/data')
        if len(data.get('items',[]))>=count:return data
        time.sleep(.2)
    raise TimeoutError('catalog scan')
def complete(port,jid):
    for _ in range(180):
        data=get(port,'/api/ai-audio-export?id='+jid)
        if data['status']!='running':return data
        time.sleep(.25)
    raise TimeoutError('audio export')
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v640-') as folder:
    root=pathlib.Path(folder);lib=root/'模拟课程目录';lib.mkdir();home=root/'home'
    video=lib/'江浙方言 视频.mp4';audio=lib/'参同契 录音.mp3';long=lib/'超过20分钟的完整音频.mp3';silent=lib/'无音轨.mp4';doc=lib/'重要文档.docx'
    gen(['-f','lavfi','-i','testsrc2=size=128x72:rate=8:duration=2','-f','lavfi','-i','sine=frequency=240:duration=2','-c:v','mpeg4','-c:a','aac','-shortest',str(video)])
    gen(['-f','lavfi','-i','sine=frequency=280:duration=4','-c:a','libmp3lame',str(audio)])
    gen(['-f','lavfi','-i','anullsrc=r=24000:cl=mono','-t','1202.2','-ac','1','-b:a','8k',str(long)])
    gen(['-f','lavfi','-i','color=c=blue:s=128x72:d=1','-an','-c:v','mpeg4',str(silent)])
    doc.write_bytes(b'private office data');before={str(p):h(p) for p in (video,audio,long,silent,doc)}
    process=log=None
    try:
        process,port,log=launch(ROOT/'dist/douyin.js',lib,home)
        items=ready(port,4)['items'];by={i['originalName']:i for i in items}
        ck('Original media indexed',all(p.name in by for p in (video,audio,long,silent)))
        st,result=post(port,{'key':'../../outside'});ck('Rejects path traversal',st==400)
        st,result=post(port,{'key':by[silent.name]['key']});ck('Silent video conversion request accepted',st==200)
        ck('Video with no audio rejected',complete(port,result['id'])['status']=='error')
        for p in (video,audio,long):
            st,started=post(port,{'key':by[p.name]['key']});ck('Start full-audio preparation '+p.name,st==200)
            result=complete(port,started['id']);ck('Prepared full audio '+p.name,result['status']=='done',)
            ck('Exactly one unsegmented part '+p.name,len(result['parts'])==1 and result['parts'][0]['startSeconds']==0)
            actual=pathlib.Path(result['directory'])/result['parts'][0]['file']
            ck('Prepared file exists',actual.is_file())
            if p==video:
                ck('Video MP3 beside source',actual.parent==video.parent and actual.suffix=='.mp3')
                ck('Video sidecar includes source key and is not video',by[p.name]['key'] in actual.name and actual!=video)
                before_audio=h(actual)
            else:
                ck('Audio directly references original without copying',actual==p)
            if p==long:
                ck('Long audio NOT split',len(result['parts'])==1 and result['parts'][0]['endSeconds']>1200)
            ck('Sources remain unchanged',all(h(pathlib.Path(fn))==digest for fn,digest in before.items()))
        # Sidecar name must be reusable and should not appear as a duplicated audio catalog entry.
        st,started=post(port,{'key':by[video.name]['key']});out=complete(port,started['id'])
        ck('Repeated video conversion reuses existing sidecar',out['status']=='done' and h(pathlib.Path(out['directory'])/out['parts'][0]['file'])==before_audio)
        latest=get(port,'/api/data')['items'];ck('Sidecar excluded from catalog hash renaming',not any('.justfun-audio-' in str(x.get('originalName','')) for x in latest))
        ck('No prompt or metadata placed beside source',not list(lib.glob('PROMPT.txt')) and not list(lib.glob('segments.json')))
        ck('Only deterministic output, no temp files',not list(lib.glob('.jf-audio-*')))
        from playwright.sync_api import sync_playwright
        source=urlopen(f'http://127.0.0.1:{port}/')[2].decode()
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1280,'height':860});errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(source,wait_until='domcontentloaded',timeout=20000)
            page.wait_for_timeout(400)
            ck('New one-click dialog present',page.locator('#jfAiAudioOverlay').count()==1)
            ck('Unsegmented UI copy present','不切片' in page.locator('#jfAiAudioOverlay').inner_text())
            ck('One-click UI trigger correct',page.locator('.jfAiStart').inner_text().strip()=='开始转写 · 整段上传')
            # Simulate one click through local preparation, credential check, cloud
            # submission and transcript opening. No real external requests.
            videoKey=by[video.name]['key']
            page.evaluate('''key=>{
              allItems=[{key,kind:'video',title:'方言视频',displayName:'方言视频'}];
              const feed=document.querySelector('#feedScroller');
              const card=document.createElement('div');card.className='feedItem';card.dataset.key=key;
              card.innerHTML='<div class="jfTimeline"></div>';feed.appendChild(card);
              window.__asrTestCalls=[];
              window.jfAiLearningOpen=async()=>{window.__asrTestCalls.push('editor')};
              window.fetch=async(u,opts={})=>{
                const url=String(u);let value={ok:true};
                if(url==='/api/ai-audio-export'&&opts.method==='POST'){window.__asrTestCalls.push('prepare');value.id='11112222333344445555666677778888';}
                else if(url.startsWith('/api/ai-audio-export?'))value={ok:true,status:'done',directory:'C:/mock',parts:[{file:'lecture.mp3'}],prompt:'',clipboardCopied:false,percent:100};
                else if(url==='/api/ai-transcript/key')value={ok:true,configured:true};
                else if(url==='/api/ai-transcript/start'){window.__asrTestCalls.push('submit');value.id='ccccdddd111122223333444455556666';}
                else if(url.startsWith('/api/ai-transcript/job?'))value={ok:true,status:'done',label:'ok',current:1,total:1};
                return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
              };
            }''',videoKey)
            page.wait_for_selector('.jfAiVideoLaunch',state='attached',timeout=5000)
            page.evaluate("document.querySelector('.jfAiVideoLaunch').click()")
            page.locator('.jfAiStart').click()
            page.wait_for_function("window.__asrTestCalls.includes('editor')",timeout=7000)
            ck('Single click automatically submits and opens editor',page.evaluate('window.__asrTestCalls.join(",")')=='prepare,submit,editor')
            ck('No JS errors',not errors)
            browser.close()
    finally:
        if process:stop(process,log)
print('FULL AUDIO TESTS',len(checks),'PASS')
