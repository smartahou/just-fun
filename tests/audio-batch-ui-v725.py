#!/usr/bin/env python3
"""Real Chromium desktop/mobile batch-extraction UX with simulated API and media."""
import tempfile,pathlib,hashlib,urllib.request,urllib.error,urllib.parse
from playwright.sync_api import sync_playwright
from isolated import ROOT,make_fixture,launch,stop

checks=0
def check(label,condition):
 global checks
 assert condition,label
 checks+=1
 print('PASS',label,flush=True)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-audio-batch-') as td:
 base=pathlib.Path(td);media=base/'media';original=make_fixture(media)
 proc,port,log=launch(ROOT/'dist/douyin.js',media,base/'home')
 try:
  origin=f'http://127.0.0.1:{port}'
  html=urllib.request.urlopen(origin+'/').read().decode().replace(
    '<head>','<head><base href="http://justfun.test/">',1)
  with sync_playwright() as play:
   browser=play.chromium.launch(executable_path='/usr/bin/chromium',
     headless=True,args=['--no-sandbox'])
   for width,height in [(1280,800),(390,844)]:
    page=browser.new_page(viewport={'width':width,'height':height})
    errors=[];dialogs=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:(dialogs.append(d.message),d.accept()))
    def proxy(route):
     u=urllib.parse.urlsplit(route.request.url)
     if not u.path.startswith('/api/'):
      route.fulfill(status=404,body=b'');return
     req=urllib.request.Request(origin+u.path+('?' + u.query if u.query else ''),
       data=route.request.post_data_buffer if route.request.method=='POST' else None,
       method=route.request.method,headers={'Content-Type':'application/json'})
     try:
      with urllib.request.urlopen(req,timeout=20) as res:
       status=res.status;data=res.read();ctype=res.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:
      status=e.code;data=e.read();ctype='application/json'
     route.fulfill(status=status,body=data,headers={'Content-Type':ctype})
    page.route('http://justfun.test/**',proxy)
    page.set_content(html,wait_until='domcontentloaded',timeout=30000)
    page.wait_for_function("typeof jfBatchExtractAudio==='function'",timeout=12000)
    initial=page.evaluate('''()=>{
      allItems=Array.from({length:3},(_,i)=>({key:'batch-'+i,kind:'video',
        relativeDir:'root',title:'测试视频 '+i,displayName:'视频 '+i,creator:'TEST',
        cover:'data:image/svg+xml,%3Csvg%20xmlns="http://www.w3.org/2000/svg"/%3E',
        modifiedTimeMs:20-i,durationText:'0:01',resolution:'320x240'}));
      allFolders=[];libraryMode='video';activeFolder='all';videoViewMode='cover';
      selectedCreator='';unifiedFavoriteOnly=false;render();setUnifiedSelectMode(true);
      allItems.forEach(x=>mediaSelectedKeys.add(x.key));syncUnifiedTiles();
      window.__batchPosts=[];const originalFetch=window.fetch.bind(window);
      window.fetch=async(url,options)=>{
        if(url==='/api/extract-audio'&&options?.method==='POST'){
          const key=JSON.parse(options.body).key;window.__batchPosts.push(key);
          if(key==='batch-1')return new Response(JSON.stringify({ok:false,error:'模拟无音轨'}),
            {status:400,headers:{'Content-Type':'application/json'}});
          return new Response(JSON.stringify({ok:true,key:'out-'+key,
            method:key==='batch-0'?'copy':'flac'}),
            {status:200,headers:{'Content-Type':'application/json'}});
        }
        return originalFetch(url,options);
      };
      window.load=async()=>{};
      const button=document.querySelector('#unifiedExtractAudio');
      return {shown:!button.hidden,enabled:!button.disabled,count:mediaSelectedKeys.size};
    }''')
    check('Button shown/enabled '+str(width),initial=={'shown':True,'enabled':True,'count':3})
    page.locator('#unifiedExtractAudio').click()
    page.wait_for_function("!jfBatchAudioRunning && window.__batchPosts.length===3",timeout=20000)
    done=page.evaluate("""()=>({
      posts:window.__batchPosts,remaining:[...mediaSelectedKeys],
      enabled:!document.querySelector('#unifiedExtractAudio').disabled
    })""")
    check('Sequential processing '+str(width),done['posts']==['batch-0','batch-1','batch-2'])
    check('Failure remains selected '+str(width),done['remaining']==['batch-1'] and done['enabled'])
    check('Visible partial-failure feedback '+str(width),any('失败 1' in d for d in dialogs))
    page.evaluate("()=>{libraryMode='audio';syncUnifiedControls()}")
    check('Video-only control '+str(width),page.locator('#unifiedExtractAudio').is_hidden())
    check('No script errors '+str(width),not errors)
    page.close()
   browser.close()
  check('All synthetic source data unchanged',all(
    hashlib.sha256((media/name).read_bytes()).hexdigest()==sha
    for name,sha in original.items()))
 finally:stop(proc,log)
print('TOTAL',checks,'PASS',flush=True)
