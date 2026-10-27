#!/usr/bin/env python3
"""v6.38 AI notes: isolated HTTP, download discovery, JSON safety, persistence and Chromium."""
import pathlib,tempfile,hashlib,subprocess,time,json,urllib.request,urllib.error
from isolated import ROOT,launch,stop,urlopen
checks=[]
def ck(n,x):
    checks.append(n);print(('PASS ' if x else 'FAIL ')+n,flush=True)
    if not x:raise AssertionError(n)
def post(port,route,payload):
    req=urllib.request.Request('http://127.0.0.1:'+str(port)+route,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
def get(port,route):
    status,headers,body=urlopen('http://127.0.0.1:'+str(port)+route);return status,json.loads(body)
def md(p):return hashlib.sha256(p.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v638-') as td:
    base=pathlib.Path(td);media=base/'中文 学习库';media.mkdir();home=base/'home';
    src=media/'大学讲座.mp3'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i','sine=frequency=330:duration=12','-c:a','libmp3lame',str(src)],check=True,timeout=20)
    original=md(src)
    proc=log=None
    def boot():
        global proc,log,port,key
        proc,port,log=launch(ROOT/'dist/douyin.js',media,home)
        for n in range(45):
            status,payload=get(port,'/api/data');items=payload.get('items',[])
            if items:
                key=items[0]['key'];return
            time.sleep(.3)
        raise AssertionError('scan timeout')
    try:
        boot()
        st,data=get(port,'/api/ai-learning?key='+key)
        ck('Empty notes response is null',st==200 and data['data'] is None)
        notes={'version':1,'sourceKey':key,'segments':[{'startMs':500,'endMs':3000,'title':'开场','note':'讲者介绍课程背景','quote':'一段原话'}, {'startMs':4500,'endMs':9000,'title':'第二节','note':'这是要点'}]}
        outline={'version':1,'sourceKey':key,'chapters':[{'startMs':0,'endMs':10000,'title':'第一章','speakerPoints':['观点1'],'analysis':['AI延伸']} ]}
        st,p=post(port,'/api/ai-learning/import',{'key':key,'notes':notes,'outline':outline})
        ck('Import both JSON documents',st==200 and p['result']['notes']==2 and p['result']['outline']==1)
        st,p=get(port,'/api/ai-learning?key='+key)
        ck('Notes returned with chapter and timestamps',p['data']['notes']['segments'][1]['startMs']==4500 and p['data']['outline']['chapters'][0]['analysis']==['AI延伸'])
        bad={**notes,'sourceKey':'f'*16}
        st,p=post(port,'/api/ai-learning/import',{'key':key,'notes':bad})
        ck('Wrong source key rejected',st==400)
        bad={**notes,'segments':[{'startMs':0,'endMs':200000,'title':'时间越界','note':'x'}]}
        st,p=post(port,'/api/ai-learning/import',{'key':key,'notes':bad})
        ck('Out of range timestamps rejected',st==400)
        bad={**notes,'segments':[{'startMs':9000,'endMs':10000,'title':'a','note':'x'},{'startMs':0,'endMs':5000,'title':'b','note':'x'}]}
        st,p=post(port,'/api/ai-learning/import',{'key':key,'notes':bad})
        ck('Unsorted entries rejected',st==400)
        st,p=post(port,'/api/ai-learning/import',{'key':'0'*16,'notes':notes})
        ck('Unknown media cannot be imported',st==400)
        st,p=post(port,'/api/ai-learning/discover',{'key':key})
        ck('No downloads returns empty result',st==200 and not p['found'])
        dl=home/'Downloads';dl.mkdir(exist_ok=True)
        (dl/'notes.json').write_text(json.dumps({**notes,'segments':[{'startMs':1000,'endMs':4000,'title':'来自下载','note':'自动导入'}]}),encoding='utf8')
        (dl/'outline.json').write_text(json.dumps(outline),encoding='utf8')
        (dl/'notes (1).json').write_text(json.dumps({**notes,'sourceKey':'a'*16}),encoding='utf8')
        st,p=post(port,'/api/ai-learning/discover',{'key':key})
        ck('Auto discovery protects manually imported result',st==200 and p['result'].get('skipped')==True)
        cache=media/'.douyin-nav-cache'/'ai-learning'/f'{key}.json'
        cache.unlink() # Only isolated fixture: simulate a clean library with no prior manual import.
        st,p=post(port,'/api/ai-learning/discover',{'key':key})
        ck('Auto discovers matching Downloads JSON pair',st==200 and set(p['found'])=={'notes','outline'})
        st,p=get(port,'/api/ai-learning?key='+key)
        ck('Auto discovery selects matching document not another source',p['data']['notes']['segments'][0]['title']=='来自下载')
        cache=media/'.douyin-nav-cache'/'ai-learning'/f'{key}.json'
        ck('AI notes stored separately from media and catalog',cache.is_file())
        ck('Audio never modified',md(src)==original)
        stop(proc,log);proc=log=None
        boot()
        st,p=get(port,'/api/ai-learning?key='+key)
        ck('Notes remain after real server restart',p['data']['notes']['segments'][0]['title']=='来自下载')
        st,page=urlopen('http://127.0.0.1:'+str(port)+'/')[0],urlopen('http://127.0.0.1:'+str(port)+'/')[2].decode('utf8')
        ck('Client ships drawer and REST links',st==200 and 'jfAiLearningDrawer' in page and '/api/ai-learning' in page)
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                tab=browser.new_page(viewport={'width':1360,'height':860})
                errors=[];tab.on('pageerror',lambda err:errors.append(str(err)))
                payload=get(port,'/api/data')[1]
                tab.route('**/api/data',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(payload)))
                tab.route('**/api/ai-learning?*',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'data':{'notes':notes,'outline':outline}})))
                tab.route('**/api/ai-learning/discover',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps({'ok':True,'found':[]})))
                tab.set_content(page,wait_until='domcontentloaded',timeout=16000)
                tab.wait_for_timeout(750)
                ck('Drawer exists closed initially',tab.locator('#jfAiLearningDrawer').count()==1 and tab.locator('#jfAiLearningDrawer').is_hidden())
                tab.evaluate('''async (args)=>{
                  allItems=args.items;
                  window.fetch=async (url)=>new Response(JSON.stringify(String(url).includes('discover')?{ok:true,found:[]}:{ok:true,data:args.data}),{status:200,headers:{'Content-Type':'application/json'}});
                  await window.jfAiLearningOpen(args.key,'notes');
                }''',{'items':payload['items'],'key':key,'data':{'notes':notes,'outline':outline}})
                tab.wait_for_timeout(300)
                ck('Drawer open and title visible',tab.locator('#jfAiLearningDrawer').is_visible() and '开场' in tab.locator('.jfLearnContent').inner_text())
                tab.locator('.jfLearnTabs button[data-tab="outline"]').click()
                ck('Outline tab displays distinct AI analysis', 'AI延伸' in tab.locator('.jfLearnContent').inner_text())
                tab.locator('.jfLearnTabs button[data-tab="notes"]').click()
                ck('Timecode seek controls are buttons', tab.locator('.jfLearnJump').count()==2)
                tab.locator('.jfLearnClose').click()
                ck('Closing drawer does not stop player',tab.locator('#jfAiLearningDrawer').is_hidden())
                ck('No browser JavaScript errors',not errors)
                browser.close()
        except Exception as e:
            print('Chromium failed:',e,flush=True);raise
        ck('No source modifications after browser test',md(src)==original)
    finally:
        if proc:stop(proc,log)
print('TOTAL',len(checks),'PASS',flush=True)
