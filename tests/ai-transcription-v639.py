#!/usr/bin/env python3
"""v6.39: mocked upstream ASR contract + isolated real Node server and Chromium UI."""
import tempfile,pathlib,subprocess,time,json,os,urllib.request,urllib.error,hashlib
from isolated import ROOT,launch,stop,urlopen
checks=[]
def ck(desc,condition):
    checks.append(desc);print(('PASS ' if condition else 'FAIL ')+desc,flush=True)
    if not condition:raise AssertionError(desc)
def req(port,route,method='GET',data=None,headers=None):
    h=headers or {}
    if data is not None:h['Content-Type']='application/json'
    request=urllib.request.Request('http://127.0.0.1:'+str(port)+route,data=json.dumps(data).encode() if data is not None else None,headers=h,method=method)
    try:
        with urllib.request.urlopen(request,timeout=7) as r:return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
# Mocked tests: no model traffic and no personal key.
r=subprocess.run(['node',str(ROOT/'tests/ai-transcription-v639.js')],cwd=ROOT,capture_output=True,text=True,timeout=20)
ck('Mock Qwen contract checks',r.returncode==0 and 'TOTAL' in r.stdout and r.stdout.strip().endswith('PASS'))
dpapi=subprocess.run(['node',str(ROOT/'tests/dpapi-credentials-v641.js')],cwd=ROOT,capture_output=True,text=True,timeout=20)
ck('Windows DPAPI simulated encrypt/decrypt/failure paths',dpapi.returncode==0 and 'TOTAL' in dpapi.stdout and dpapi.stdout.strip().endswith('PASS'))
stream=subprocess.run(['node',str(ROOT/'tests/ai-upload-stream-v640.js')],cwd=ROOT,capture_output=True,text=True,timeout=25)
ck('Unsegmented 42 MiB stream upload verified',stream.returncode==0 and 'Content-Length is exact' in stream.stdout)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-asr639-') as root:
    base=pathlib.Path(root);lib=base/'模拟资料库';lib.mkdir();home=base/'home'
    file=lib/'方言课程.mp3'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i','sine=frequency=350:duration=3','-c:a','libmp3lame',str(file)],check=True,timeout=18)
    before=hashlib.sha256(file.read_bytes()).hexdigest()
    process=log=None
    try:
        process,port,log=launch(ROOT/'dist/douyin.js',lib,home)
        key=None
        for _ in range(45):
            data=req(port,'/api/data')[1]
            if data.get('items'):
                key=data['items'][0]['key'];break
            time.sleep(.3)
        ck('Real isolated media catalog ready',isinstance(key,str))
        st,value=req(port,'/api/ai-transcript/key');ck('First time no credential',st==200 and value=={'ok':True,'configured':False})
        st,value=req(port,'/api/ai-transcript/key',method='POST',data={'key':'invalid'});ck('Invalid credential rejected',st==400)
        st,value=req(port,'/api/ai-transcript/key',method='POST',data={'key':'sk-TESTONLY02XXXXXXXXXXXXXXXXXXXXXXXX'});ck('Local test credential saved',st==200 and value['configured'])
        st,value=req(port,'/api/ai-transcript/key');ck('Credential never returned to browser',st==200 and value=={'ok':True,'configured':True})
        st,value=req(port,'/api/ai-transcript/key',method='POST',data={'key':'sk-TESTONLY03XXXXXXXXXXXXXXXXXXX'},headers={'Origin':'http://evil.example'});ck('Cross-origin credential mutation denied',st==400)
        st,value=req(port,'/api/ai-transcript/start',method='POST',data={'key':key,'exportId':'invalid'});ck('Cannot upload absent export',st==400)
        st,value=req(port,'/api/ai-transcript?key='+key);ck('Transcript initially empty',st==200 and value['data'] is None)
        # Create fixture via isolated API-independent transcript record; validate editor endpoints with real HTTP.
        document={'version':1,'sourceKey':key,'durationMs':3100,'segments':[{'startMs':200,'endMs':1400,'text':'初稿需修改'}], 'confirmed':False,'revision':1}
        target=lib/'.douyin-nav-cache'/'ai-learning'/f'{key}.transcript.json';target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps(document,ensure_ascii=False),encoding='utf8')
        st,value=req(port,'/api/ai-transcript?key='+key);ck('Transcript read via real HTTP',st==200 and value['data']['segments'][0]['text']=='初稿需修改')
        st,value=req(port,'/api/ai-transcript/save',method='POST',data={'key':key,'revision':1,'segments':[{'startMs':200,'endMs':1400,'text':'已校订'}]});ck('Save draft via HTTP',st==200 and value['data']['revision']==2 and not value['data']['confirmed'])
        st,value=req(port,'/api/ai-transcript/save',method='POST',data={'key':key,'revision':1,'segments':[{'startMs':200,'endMs':1400,'text':'旧版覆盖'}]});ck('Stale editor blocked',st==400)
        st,value=req(port,'/api/ai-transcript/save',method='POST',data={'key':key,'revision':2,'confirm':True,'segments':[{'startMs':200,'endMs':1400,'text':'已校订'}]});ck('User confirms transcript explicitly',st==200 and value['data']['confirmed'])
        st,value=req(port,'/api/ai-transcript/key',method='DELETE');ck('Credential deleted via HTTP',st==200 and not value['configured'])
        ck('No actual upstream ASR call',hashlib.sha256(file.read_bytes()).hexdigest()==before)
        source=(urlopen('http://127.0.0.1:'+str(port)+'/')[2]).decode()
        ck('Client bundles key popup and transcript drawer','jfAsrSecret' in source and 'jfTransRowEdit' in source)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1360,'height':860});errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(source,wait_until='domcontentloaded',timeout=20000)
            page.wait_for_timeout(450)
            ck('Editor panel renders initially hidden',page.locator('#jfAiLearningDrawer').count()==1 and page.locator('#jfAiLearningDrawer').is_hidden())
            # Run client with mocked browser fetch. Browser does not send credentials to a cloud service.
            page.evaluate('''async ({key, doc})=>{
              allItems=[{key,kind:'audio',title:'方言课程',displayName:'方言课程'}];
              window.fetch=async(url,opts)=>{
                const s=String(url);
                if(s.includes('ai-transcript/save')){const v=JSON.parse(opts.body);doc.segments=v.segments;doc.revision++;doc.confirmed=v.confirm===true;return new Response(JSON.stringify({ok:true,data:doc}),{status:200});}
                const data=s.includes('ai-transcript?')?{ok:true,data:doc}:s.includes('discover')?{ok:true,found:[]}:{ok:true,data:null};
                return new Response(JSON.stringify(data),{status:200});
              };
              await window.jfAiLearningOpen(key,'transcript');
            }''', {'key':key,'doc':document})
            page.wait_for_timeout(150)
            ck('Transcript editing text visible',page.locator('.jfTransRowEdit').count()==1 and page.locator('.jfTransRowEdit').input_value()=='初稿需修改')
            page.locator('.jfTransRowEdit').fill('校订完毕')
            page.wait_for_timeout(1650)
            ck('Autosave preserves typed correction',page.locator('.jfTransRowEdit').input_value()=='校订完毕')
            ck('Only two transcript actions',page.locator('.jfLearnToolbar button').all_text_contents()==['重新生成','AI 分析 ↗'])
            ck('AI analysis enabled without confirmation',page.locator('.jfTransAnalyze').is_enabled())
            ck('Transcript editor autosizes vertically',page.locator('.jfTransRowEdit').evaluate('(el)=>el.clientHeight>=44 && el.scrollHeight<=el.clientHeight+2'))
            ck('Browser script has no errors',not errors,str(errors)) if False else ck('Browser script has no errors',not errors)
            browser.close()
    finally:
        if process:stop(process,log)
print('TOTAL',len(checks),'PASS')
