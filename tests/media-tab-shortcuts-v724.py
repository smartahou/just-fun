#!/usr/bin/env python3
"""v7.24: Alt+1..5 navigates only the workspace rail, never editors/modals.
Runs Chromium against an isolated synthetic media library, not user data.
"""
import hashlib
import pathlib
import tempfile
import urllib.parse
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop, make_fixture, urlopen

CHECKS=[]
def check(label, okay, detail=None):
    if not okay: raise AssertionError(f'{label}: {detail!r}')
    CHECKS.append(label)
    print('PASS',label,flush=True)

def run(viewport):
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-shortcuts-v724-') as td:
        base=pathlib.Path(td)
        media=base/'media'
        originals=make_fixture(media)
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',media,base/'home')
            origin=f'http://127.0.0.1:{port}'
            html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
                page=browser.new_page(viewport=viewport)
                page.set_default_timeout(15000)
                errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                def proxy(route):
                    u=urllib.parse.urlsplit(route.request.url)
                    if u.path.startswith('/api/'):
                        req=urllib.request.Request(origin+u.path+('?' + u.query if u.query else ''),data=route.request.post_data_buffer if route.request.method=='POST' else None,method=route.request.method,headers={'Content-Type':route.request.headers.get('content-type','application/json')})
                        try:
                            with urllib.request.urlopen(req,timeout=25) as resp:
                                code=resp.status;body=resp.read();mime=resp.headers.get('Content-Type','application/json')
                        except urllib.error.HTTPError as error:
                            code=error.code;body=error.read();mime=error.headers.get('Content-Type','application/json')
                        route.fulfill(status=code,body=body,headers={'Content-Type':mime})
                    else:
                        route.fulfill(status=404,body='')
                page.route('http://justfun.test/**',proxy)
                page.set_content(html,wait_until='domcontentloaded',timeout=35000)
                page.wait_for_function("allItems.some(x=>x.kind==='video')",timeout=20000)
                page.evaluate('''()=>{
                  catalogRequestInFlight=true;
                  allItems=[...Array.from({length:720},(_,i)=>({key:'test-v-'+i,kind:'video',relativeDir:'root',title:'测试视频 '+i,displayName:'测试视频 '+i,modifiedTimeMs:720-i,creator:'模拟作者',rating:i%5,cover:'data:image/svg+xml,%3Csvg%20xmlns="http://www.w3.org/2000/svg"/%3E',resolution:'1920x1080'})),
                    ...Array.from({length:160},(_,i)=>({key:'test-a-'+i,kind:'audio',relativeDir:'root',title:'测试音频 '+i,displayName:'测试音频 '+i,modifiedTimeMs:160-i,rating:i%5})),
                    ...Array.from({length:100},(_,i)=>({key:'test-i-'+i,kind:'image',relativeDir:'root',title:'测试图片 '+i,displayName:'测试图片 '+i,modifiedTimeMs:100-i,rating:i%5}))];
                  allFolders=[];libraryMode='video';activeFolder='all';mediaFolderPositions.video='all';renderCreatorTags();render();
                }''')
                def mode():
                    return page.evaluate('''()=>({tab:document.querySelector('[data-media-kind][aria-selected="true"]')?.dataset.mediaKind, mode:document.body.classList.contains('jfNotesMode')?'notes':document.body.classList.contains('jfBooksMode')?'books':libraryMode, scroll:window.scrollY, query:document.getElementById('search').value})''')
                def shortcut(i):
                    page.keyboard.press(f'Alt+{i}')
                    page.wait_for_timeout(220)
                    return mode()
                titles=page.evaluate("[...document.querySelectorAll('[data-media-kind]')].map(t=>t.title)")
                check('rail shortcut hints Alt+1..5',all(f'Alt+{i+1}' in titles[i] for i in range(5)),titles)
                page.evaluate("window.scrollTo(0,2000)")
                page.wait_for_timeout(150)
                video_y=page.evaluate('window.scrollY')
                check('video has scroll to restore',video_y>800,video_y)
                check('active Alt+1 does not reset video scroll',abs(shortcut(1)['scroll']-video_y)<10)
                a=shortcut(3)
                check('Alt+3 opens audio from video',a['tab']=='audio' and a['scroll']<=2,a)
                page.evaluate("document.getElementById('search').value='测试音频'; render()")
                b=shortcut(2)
                check('Alt+2 opens gallery',b['tab']=='image' and b['query']=='',b)
                c=shortcut(1)
                check('Alt+1 restores video tab and scroll',c['tab']=='video' and abs(c['scroll']-video_y)<10,(c,video_y))
                d=shortcut(3)
                check('Alt+3 restores audio search',d['tab']=='audio' and d['query']=='测试音频',d)
                e=shortcut(4)
                check('Alt+4 opens bookshelf',e['tab']=='books' and e['mode']=='books',e)
                f=shortcut(5)
                check('Alt+5 opens notes',f['tab']=='notes' and f['mode']=='notes',f)
                g=shortcut(1)
                check('Alt+1 returns from notes to video',g['tab']=='video',g)
                page.locator('#search').focus()
                q=shortcut(3)
                check('shortcut blocked when input focused',q['tab']=='video',q)
                page.evaluate("document.getElementById('search').blur()")
                for combo in ['Control+2','Alt+6','Alt+Shift+2']:
                    st=page.keyboard.press(combo)
                    page.wait_for_timeout(70)
                    check(combo+' does not navigate',mode()['tab']=='video',mode())
                for fields in [{'key':'2','code':'Digit2','altKey':True,'repeat':True},
                               {'key':'2','code':'Digit2','altKey':True,'isComposing':True},
                               {'key':'2','code':'Digit2','altKey':True,'ctrlKey':True}]:
                    page.evaluate('''fields=>document.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...fields}))''',fields)
                    check('synthetic modifier/IME event blocked '+str(fields),mode()['tab']=='video',mode())
                page.evaluate("document.getElementById('feedOverlay').classList.add('open')")
                blocked=shortcut(3)
                check('immersive feed overlay blocks tab shortcut',blocked['tab']=='video',blocked)
                page.evaluate("document.getElementById('feedOverlay').classList.remove('open')")
                page.evaluate("document.getElementById('jfPhotoCropDialog').hidden=false")
                blocked=shortcut(3)
                check('photo editing dialog blocks tab shortcut',blocked['tab']=='video',blocked)
                page.evaluate("document.getElementById('jfPhotoCropDialog').hidden=true")
                check('shortcut resumes after overlay closed',shortcut(3)['tab']=='audio')
                check('no browser script errors',not errors,errors)
                browser.close()
            check('fixture media files unmodified',all((media/name).is_file() and hashlib.sha256((media/name).read_bytes()).hexdigest()==digest for name,digest in originals.items()))
        finally:
            stop(proc,log)

if __name__=='__main__':
    for viewport in ({'width':1440,'height':900},{'width':390,'height':844}):
        print('VIEWPORT',viewport,flush=True)
        run(viewport)
    print('MEDIA TAB SHORTCUTS',len(CHECKS),'PASS',flush=True)
