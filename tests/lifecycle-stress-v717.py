#!/usr/bin/env python3
"""Real Chromium lifecycle stress. Isolated media fixture; no user data."""
import hashlib,pathlib,tempfile,urllib.parse,urllib.request,urllib.error,time,json
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,make_fixture,urlopen

def run(viewport):
 with tempfile.TemporaryDirectory(prefix='jf-architecture-test-lifecycle-v717-') as td:
  base=pathlib.Path(td);media=base/'media';original=make_fixture(media)
  proc=log=None
  try:
   proc,port,log=launch(ROOT/'dist/douyin.js',media,base/'home')
   origin=f'http://127.0.0.1:{port}'
   html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
   with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--js-flags=--expose-gc'])
    context=browser.new_context(viewport=viewport)
    page=context.new_page();page.set_default_timeout(12000)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    def proxy(route):
     u=urllib.parse.urlsplit(route.request.url)
     if u.path.startswith('/api/'):
      req=urllib.request.Request(origin+u.path+('?' + u.query if u.query else ''),data=route.request.post_data_buffer if route.request.method=='POST' else None,method=route.request.method,headers={'Content-Type':route.request.headers.get('content-type','application/json')})
      try:
       with urllib.request.urlopen(req,timeout=30) as rsp:st=rsp.status;body=rsp.read();mime=rsp.headers.get('Content-Type','application/json')
      except urllib.error.HTTPError as e:st=e.code;body=e.read();mime=e.headers.get('Content-Type','application/json')
      route.fulfill(status=st,body=body,headers={'Content-Type':mime})
     else:route.fulfill(status=404,body='')
    page.route('http://justfun.test/**',proxy)
    page.set_content(html,wait_until='domcontentloaded',timeout=30000)
    page.wait_for_function('allItems.some(x=>x.kind===\'image\')',timeout=18000)
    cdp=context.new_cdp_session(page);cdp.send('HeapProfiler.enable')
    def heap():
     page.evaluate('()=>{if(window.gc)window.gc()}');cdp.send('HeapProfiler.collectGarbage');return cdp.send('Runtime.getHeapUsage')['usedSize']
    def counters():
     return page.evaluate('''()=>({mode:libraryMode,books:document.body.classList.contains('jfBooksMode'),
      photoObserver:!!photoObserver,albums:document.querySelectorAll('#folderTiles .photoAlbum').length,
      visibleAlbums:[...document.querySelectorAll('#folderTiles .photoAlbum')].filter(x=>x.getClientRects().length).length,
      tiles:document.querySelectorAll('#grid .mediaTile').length,
      activeAudio:document.querySelectorAll('#audioDock audio').length,
      readers:document.querySelectorAll('#jfReader').length,
      dataPoll:typeof catalogRequestInFlight==='boolean'})''')
    order=['image','books','notes','audio','video']
    for kind in order:page.evaluate('k=>document.querySelector(`[data-media-kind="${k}"]`).click()',kind);page.wait_for_timeout(80)
    initial=heap();measure=[]
    for lap in range(45):
     kind=order[lap%len(order)]
     page.evaluate('k=>document.querySelector(`[data-media-kind="${k}"]`).click()',kind)
     page.wait_for_timeout(60)
     if lap%9==8:
      s=counters()
      if kind=='image':assert s['visibleAlbums']>0 and s['photoObserver'] is False,s
      else:assert s['visibleAlbums']==0 and s['photoObserver'] is False,s
      assert s['readers']==1 and s['dataPoll'],s
      measure.append({'lap':lap+1,'heapBytes':heap(),'state':s})
    page.evaluate('()=>document.querySelector(`[data-media-kind="video"]`).click()')
    page.wait_for_timeout(400)
    final=heap();print('BROWSER',viewport,'baselineHeapBytes',initial,'finalHeapBytes',final,'points',json.dumps(measure,ensure_ascii=False),flush=True)
    assert final-initial<24*1024*1024, f'Unbounded DOM/heap growth: {final-initial}'
    assert not errors,errors[:4]
    browser.close()
   assert all(hashlib.sha256((media/name).read_bytes()).hexdigest()==v for name,v in original.items()), 'Media mutated'
  finally:stop(proc,log)

for vp in ({'width':1440,'height':900},{'width':390,'height':844}):run(vp)
print('LIFECYCLE STRESS V717 PASS',flush=True)
