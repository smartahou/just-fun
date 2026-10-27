#!/usr/bin/env python3
"""720-item synthetic catalog browser stress with scrolling, selection, feed and filtering. No real user data."""
import pathlib,tempfile,json,hashlib,urllib.parse,urllib.request,urllib.error
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,make_fixture,urlopen
N=720
TINY='data:image/svg+xml,%3Csvg%20xmlns="http://www.w3.org/2000/svg"%20width="10"%20height="10"%3E%3Crect%20width="10"%20height="10"%20fill="%23343a50"/%3E%3C/svg%3E'

def run(width,height):
 with tempfile.TemporaryDirectory(prefix='jf-architecture-test-video-home-v718-') as folder:
  base=pathlib.Path(folder);media=base/'media';original=make_fixture(media);proc=log=None
  try:
   proc,port,log=launch(ROOT/'dist/douyin.js',media,base/'home')
   origin=f'http://127.0.0.1:{port}'
   html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
   with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':width,'height':height});page=ctx.new_page();page.set_default_timeout(12000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def proxy(route):
     u=urllib.parse.urlsplit(route.request.url)
     if u.path.startswith('/api/'):
      req=urllib.request.Request(origin+u.path+('?' + u.query if u.query else ''),data=route.request.post_data_buffer if route.request.method=='POST' else None,method=route.request.method,headers={'Content-Type':route.request.headers.get('content-type','application/json')})
      try:
       with urllib.request.urlopen(req,timeout=20) as res:status=res.status;body=res.read();mime=res.headers.get('Content-Type','application/json')
      except urllib.error.HTTPError as e:status=e.code;body=e.read();mime=e.headers.get('Content-Type','application/json')
      route.fulfill(status=status,body=body,headers={'Content-Type':mime})
     else:route.fulfill(status=404,body=b'')
    page.route('http://justfun.test/**',proxy)
    page.set_content(html,wait_until='domcontentloaded',timeout=40000)
    page.wait_for_function("allItems.some(x=>x.kind==='video')",timeout=16000)
    initial=page.evaluate('''({n,cover})=>{
      catalogRequestInFlight=true;
      allItems=Array.from({length:n},(_,i)=>({key:'synthetic-'+i,kind:'video',relativeDir:'root',title:'测试视频 '+i,displayName:'视频 '+i,modifiedTimeMs:n-i,creator:'TEST',cover,
        mediaUrl:'/api/media/fake',rating:i%5,durationText:'0:03',resolution:i%3===0?'1920x1080':'1080x1920'}));
      allFolders=[];libraryMode='video';activeFolder='all';selectedCreator='';unifiedFavoriteOnly=false;videoViewMode='cover';
      const start=performance.now();render();return {renderMs:performance.now()-start,dom:document.querySelectorAll('#grid .jfCoverTile').length,total:currentRenderedItems.length};
    }''',{'n':N,'cover':TINY})
    assert initial['total']==N and initial['dom']<110,initial
    def snap():return page.evaluate('''()=>({count:document.querySelectorAll('#grid .jfCoverTile').length,scrollHeight:document.documentElement.scrollHeight,
      viewport:[...document.querySelectorAll('#grid .mediaTile')].filter(e=>{let r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight}).length,
      first:!!document.querySelector('#grid [data-media-key="'+currentRenderedItems[0].key+'"]'),
      last:!!document.querySelector('#grid [data-media-key="'+currentRenderedItems[currentRenderedItems.length-1].key+'"]')})''')
    top=snap()
    page.evaluate('()=>window.scrollTo(0,document.documentElement.scrollHeight/2)');page.wait_for_timeout(180);mid=snap()
    page.evaluate('()=>window.scrollTo(0,document.documentElement.scrollHeight)');page.wait_for_timeout(220);bottom=snap()
    page.evaluate('()=>window.scrollTo(0,0)');page.wait_for_timeout(180);back=snap()
    assert top['first'] and top['viewport']>0 and back['first'] and back['viewport']>0
    assert bottom['last'] and bottom['viewport']>0 and mid['viewport']>0
    assert max(q['count'] for q in (top,mid,bottom,back))<110
    assert max(q['scrollHeight'] for q in (top,mid,bottom,back))-min(q['scrollHeight'] for q in (top,mid,bottom,back))<2
    interactions=page.evaluate('''()=>{
      setUnifiedSelectMode(true);for(const i of unifiedVisibleItems())mediaSelectedKeys.add(i.key);syncUnifiedTiles();
      const selected=mediaSelectedKeys.size,onscreen=document.querySelectorAll('#grid .unifiedSelected').length;
      setUnifiedSelectMode(false);videoViewMode='text';render();
      const textCards=document.querySelectorAll('#grid .videoTextTile').length,textFull=currentRenderedItems.length;
      videoViewMode='cover';render();
      const search=document.querySelector('#search');search.value='视频 71';render();
      const filtered=currentRenderedItems.length,filteredDom=document.querySelectorAll('#grid .jfCoverTile').length,filteredVirtual=!!jfCoverVirtualState;
      search.value='';render();return {selected,onscreen,textCards,textFull,filtered,filteredDom,filteredVirtual,restored:currentRenderedItems.length};
    }''')
    assert interactions['selected']==N and interactions['onscreen']>0 and interactions['textCards']<110 and interactions['textFull']==N,interactions
    assert interactions['filtered']==11 and interactions['filteredDom']==11 and not interactions['filteredVirtual'] and interactions['restored']==N,interactions
    playback=page.evaluate('''()=>{
      const tile=document.querySelector('#grid .jfCoverTile .coverWrap[data-feed-key]');const key=tile.dataset.feedKey;
      tile.click();return {opened:document.querySelector('#feedOverlay').classList.contains('open'),
        sections:document.querySelectorAll('#feedScroller .feedItem').length,current:currentFeedKey,key};
    }''')
    assert playback['opened'] and playback['sections']==N and playback['current']==playback['key'],playback
    page.evaluate('()=>closeFeed()');page.set_viewport_size({'width':width+80,'height':height});page.wait_for_timeout(180)
    resized=page.evaluate('''()=>({count:document.querySelectorAll('#grid .jfCoverTile').length,
      visible:[...document.querySelectorAll('#grid .jfCoverTile')].filter(e=>{let b=e.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight}).length,
      total:currentRenderedItems.length})''')
    assert resized['count']<110 and resized['visible']>0 and resized['total']==N,resized
    assert not errors,errors[:3]
    result={'viewport':str(width)+'x'+str(height),'initial':initial,'top':top,'middle':mid,'bottom':bottom,'back':back,'interactions':interactions,'feed':playback,'resize':resized}
    print('PASS',json.dumps(result,ensure_ascii=False),flush=True)
    browser.close()
   assert all(hashlib.sha256((media/name).read_bytes()).hexdigest()==digest for name,digest in original.items()),'Synthetic user media changed'
   return result
  finally:stop(proc,log)

if __name__=='__main__':
 results=[run(1440,900),run(390,844)]
 (ROOT/'dist/video-home-stress-v718.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
 print('720 VIDEO HOME STRESS PASS',flush=True)
