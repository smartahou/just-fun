#!/usr/bin/env python3
"""v7.22: Media tabs independently retain browsing/filter/selection/scroll session state.
Synthetic catalog and isolated real HTTP fixture; never uses personal media.
"""
import hashlib
import pathlib
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop, make_fixture, urlopen

CHECKS=[]
def check(label, passed, detail=None):
    if not passed: raise AssertionError(f'{label}: {detail!r}')
    CHECKS.append(label)
    print('PASS', label, flush=True)

def run(viewport):
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-tab-v722-') as td:
        base=pathlib.Path(td); media=base/'media'; original=make_fixture(media)
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',media,base/'home')
            origin=f'http://127.0.0.1:{port}'
            html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
                page=browser.new_page(viewport=viewport)
                page.set_default_timeout(14000)
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                def proxy(route):
                    url=urllib.parse.urlsplit(route.request.url)
                    if url.path.startswith('/api/'):
                        req=urllib.request.Request(origin+url.path+('?' + url.query if url.query else ''), data=route.request.post_data_buffer if route.request.method=='POST' else None, method=route.request.method, headers={'Content-Type':route.request.headers.get('content-type','application/json')})
                        try:
                            with urllib.request.urlopen(req,timeout=25) as resp:
                                code=resp.status;body=resp.read();mime=resp.headers.get('Content-Type','application/json')
                        except urllib.error.HTTPError as error:
                            code=error.code;body=error.read();mime=error.headers.get('Content-Type','application/json')
                        route.fulfill(status=code,body=body,headers={'Content-Type':mime})
                    else:route.fulfill(status=404,body='')
                page.route('http://justfun.test/**',proxy)
                page.set_content(html,wait_until='domcontentloaded',timeout=35000)
                page.wait_for_function("allItems.some(x=>x.kind==='video')",timeout=20000)
                page.evaluate('''()=>{
                  catalogRequestInFlight=true;
                  allItems=[...Array.from({length:720},(_,i)=>({key:'test-v-'+i,kind:'video',relativeDir:'root',title:'测试视频 '+i,displayName:'测试视频 '+i,modifiedTimeMs:720-i,creator:'模拟作者',rating:i%5,cover:'data:image/svg+xml,%3Csvg%20xmlns="http://www.w3.org/2000/svg"/%3E',resolution:'1920x1080'})),
                    ...Array.from({length:160},(_,i)=>({key:'test-a-'+i,kind:'audio',relativeDir:'root',title:'测试音频 '+i,displayName:'测试音频 '+i,modifiedTimeMs:160-i,rating:i%5})),
                    ...Array.from({length:100},(_,i)=>({key:'test-i-'+i,kind:'image',relativeDir:'root',title:'测试图片 '+i,displayName:'测试图片 '+i,modifiedTimeMs:100-i,rating:i%5}))];
                  allFolders=[];libraryMode='video';activeFolder='all';mediaFolderPositions.video='all';
                  document.querySelector('#search').value='';
                  renderCreatorTags();render();
                }''')
                def switch(kind):
                    page.evaluate('''kind=>document.querySelector('[data-media-kind="'+kind+'"]').click()''',kind)
                    page.wait_for_timeout(220)
                def scroll(y):
                    page.evaluate('(y)=>window.scrollTo(0,y)',y)
                    page.wait_for_timeout(180)
                    return page.evaluate('window.scrollY')
                def state():
                    return page.evaluate('''()=>({mode:libraryMode,search:document.querySelector('#search').value,
                      y:window.scrollY,max:document.documentElement.scrollHeight-innerHeight,folder:activeFolder,
                      sort:sortMode,dir:sortDirection,fav:unifiedFavoriteOnly,
                      creator:selectedCreator,creatorOpen:creatorOpen,selecting:mediaSelectMode,selected:[...mediaSelectedKeys],
                      virtual:!!jfCoverVirtualState,cardCount:document.querySelectorAll('#grid [data-media-key]').length,
                      total:currentRenderedItems.length})''')
                page.evaluate('''()=>{
                  document.querySelector('#search').value='测试视频';render();
                  selectSortMode('mtime');selectedCreator='模拟作者';creatorOpen=true;
                  document.querySelector('#creatorPanel').classList.remove('collapsed');render();
                  setUnifiedSelectMode(true);mediaSelectedKeys.add('test-v-42');syncUnifiedTiles();
                }''')
                videoY=scroll(2200)
                check('video deep scroll reachable',videoY>800,videoY)
                check('video virtual list bounded',state()['cardCount']<110,state())
                switch('audio');a0=state()
                check('audio starts at top',a0['y']<=2,a0)
                check('audio starts with independent empty search',a0['search']=='' and a0['folder']=='all' and not a0['selecting'],a0)
                check('audio sort independent',a0['sort']=='rating' and a0['dir']=='desc',a0)
                page.evaluate('''()=>{document.querySelector('#search').value='测试音频';render();selectSortMode('mtime');}''')
                audioY=scroll(720)
                check('audio scroll reachable',audioY>250,audioY)
                switch('image');i0=state()
                check('gallery starts independently at top',i0['y']<=2,i0)
                check('gallery search and sort independent',i0['search']=='' and i0['sort']=='rating',i0)
                page.evaluate('''()=>{unifiedFavoriteOnly=true;render();}''')
                switch('audio');a1=state()
                check('audio scroll restored',abs(a1['y']-audioY)<8,(a1,audioY))
                check('audio query and sort restored',a1['search']=='测试音频' and a1['sort']=='mtime' and not a1['fav'],a1)
                switch('video');v1=state()
                check('video scroll restored',abs(v1['y']-videoY)<8,(v1,videoY))
                check('video folder preserved',v1['folder']=='all',v1)
                check('video query/creator restored',v1['search']=='测试视频' and v1['creator']=='模拟作者' and v1['creatorOpen'],v1)
                check('video sort independent',v1['sort']=='mtime',v1)
                check('video selection restored',v1['selecting'] and v1['selected']==['test-v-42'],v1)
                check('video virtual window painted after restoration',v1['virtual'] and 0<v1['cardCount']<110,v1)
                switch('image');i1=state()
                check('gallery filter restored',i1['fav'] and i1['y']<=2,i1)
                # Drive the page backward and forward quickly: no stale requestAnimationFrame restore.
                page.evaluate('''()=>{
                  document.querySelector('[data-media-kind="video"]').click();
                  document.querySelector('[data-media-kind="audio"]').click();
                }''')
                page.wait_for_timeout(220)
                a2=state()
                check('rapid switch finishes on audio',a2['mode']=='audio' and a2['search']=='测试音频',a2)
                check('rapid switch scroll not overwritten by stale video callback',abs(a2['y']-audioY)<8,(a2,audioY))
                check('browser errors absent',not errors,errors)
                browser.close()
            check('isolated original media unchanged',all((media/name).is_file() and hashlib.sha256((media/name).read_bytes()).hexdigest()==digest for name,digest in original.items()))
        finally:stop(proc,log)

if __name__=='__main__':
    for viewport in ({'width':1440,'height':900},{'width':390,'height':844}):
        print('VIEWPORT',viewport,flush=True)
        run(viewport)
    print('MEDIA TAB MEMORY',len(CHECKS),'PASS',flush=True)
