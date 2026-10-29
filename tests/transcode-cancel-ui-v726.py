#!/usr/bin/env python3
"""Chromium UI: actual cancellation button & status with simulated pending FFmpeg API."""
from isolated import ROOT,launch,stop,sha,media_entries,make_fixture
from playwright.sync_api import sync_playwright
import tempfile,pathlib,urllib.request,urllib.error,json,time,urllib.parse
N=0
def check(label,condition,detail=''):
 global N
 if not condition:raise AssertionError(label+': '+str(detail))
 N+=1;print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-transcode-browser-v726-') as td:
 base=pathlib.Path(td);lib=base/'media';original=make_fixture(lib);process=logger=None
 try:
  process,port,logger=launch(ROOT/'dist/douyin.js',lib,base/'home')
  key=None
  for _ in range(150):
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/data') as res:data=json.load(res)
   key=next((i['key'] for i in media_entries(data) if i.get('originalName')=='测试视频 1.mp4'),None)
   if key:break
   time.sleep(.2)
  check('Source indexed',bool(key))
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1280,'height':800});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   html=urllib.request.urlopen(f'http://127.0.0.1:{port}/').read().decode().replace('<head>','<head><base href="http://justfun.test/">',1)
   def handler(route):
    u=urllib.parse.urlsplit(route.request.url)
    headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Accept,Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}
    if route.request.method=='OPTIONS':route.fulfill(status=204,headers=headers,body='');return
    src=f'http://127.0.0.1:{port}'+u.path+('?' + u.query if u.query else '')
    try:
     req=urllib.request.Request(src,data=route.request.post_data_buffer if route.request.method=='POST' else None,
       method=route.request.method,headers={'Content-Type':'application/json'})
     with urllib.request.urlopen(req,timeout=5) as response:status=response.status;body=response.read();ctype=response.headers.get('Content-Type','application/json')
    except urllib.error.HTTPError as ex:status=ex.code;body=ex.read();ctype='application/json'
    route.fulfill(status=status,body=body,headers={**headers,'Content-Type':ctype})
   page.route('http://justfun.test/**',handler)
   page.set_content(html,wait_until='domcontentloaded',timeout=30000)
   page.wait_for_function("typeof jfTrackedMediaPost==='function'",timeout=15000)
   check('HUD initially hidden',page.locator('#jfMediaJobHUD .jfJobCancel').count()==0)
   page.evaluate('''key=>{
     window.__cancelCalls=0;window.__state={done:false,error:''};
     const real=window.fetch.bind(window);
     window.fetch=(url,opts)=>{
       if(url==='/api/video-transcode')return new Promise(resolve=>{window.__finishTranscode=resolve;});
       if(url==='/api/media-progress/cancel'){
         window.__cancelCalls++;
         window.__finishTranscode(new Response(JSON.stringify({ok:false,error:'用户已取消转码'}),{status:400,headers:{'Content-Type':'application/json'}}));
         return Promise.resolve(new Response(JSON.stringify({ok:true,status:'cancelling'}),{status:200,headers:{'Content-Type':'application/json'}}));
       }
       if(typeof url==='string'&&url.startsWith('/api/media-progress?id='))return Promise.resolve(new Response(JSON.stringify({ok:true,status:'running',percent:30}),{status:200,headers:{'Content-Type':'application/json'}}));
       return real(url,opts);
     };
     jfTrackedMediaPost('/api/video-transcode',{key,mode:'encode'},'优化视频兼容性')
       .catch(e=>{window.__state.error=String(e.message||e);})
       .finally(()=>window.__state.done=true);
   }''',key)
   button=page.locator('#jfMediaJobHUD .jfJobCancel')
   button.wait_for(state='visible',timeout=4000)
   check('Cancel visible and enabled for transcode',button.is_visible() and button.is_enabled())
   button.click(timeout=3000)
   page.wait_for_function('window.__state.done',timeout=5000)
   result=page.evaluate('({state:window.__state,calls:window.__cancelCalls})')
   check('One cancellation API request issued',result['calls']==1,result)
   check('Cancelled request reports user cancellation','用户已取消转码' in result['state']['error'],result)
   check('Cancel button removed after request settled',button.is_hidden())
   check('Synthetic user files untouched',all(sha(lib/n)==digest for n,digest in original.items()))
   check('No browser script errors',not errors,errors)
   browser.close()
 finally:stop(process,logger)
print('TOTAL',N,'PASS',flush=True)
