#!/usr/bin/env python3
"""P0 live photo filter, P1 same-root bookshelf. Strictly isolated fixture."""
import os, pathlib, tempfile, subprocess, time, json, hashlib, base64, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch,stop,urlopen

checks=[]
def ck(name,truth):
    checks.append((name,bool(truth)))
    if not truth: raise AssertionError(name)
    print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-p0p1-') as folder:
    tmp=pathlib.Path(folder);lib=tmp/'用户媒体工作目录';lib.mkdir()
    bookfiles=['佛学/唯识/成唯识论.epub','佛学/唯识/古籍 PDF.pdf','小说/西游记.TXT','书摘/随手笔记.md','顶层笔记.markdown']
    for n in bookfiles:
        p=lib/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('FAKE_BOOK_P1_INDEX',encoding='utf8')
    (lib/'影视资料.mp4').write_bytes(b'fixture video')
    (lib/'.private').mkdir();(lib/'.private'/'绝密.md').write_text('hidden')
    (lib/'node_modules').mkdir();(lib/'node_modules'/'依赖说明.md').write_text('hidden')
    out=tmp/'outside';out.mkdir();(out/'逃逸.pdf').write_text('hidden')
    try:(lib/'目录别名').symlink_to(out,target_is_directory=True)
    except Exception:pass
    originals={str(p.relative_to(lib)):hashlib.sha256(p.read_bytes()).hexdigest() for p in lib.rglob('*') if p.is_file() and not p.is_symlink()}
    # Actual MPEG4 used in browser filter regression; constructed only in the isolated temp directory.
    live=tmp/'live.mp4'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=320x240:rate=12:duration=2','-an','-c:v','libx264','-pix_fmt','yuv420p',str(live)],check=True,timeout=25)
    proc=log=None
    try:
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home')
        base=f'http://127.0.0.1:{port}'
        data=json.loads(urlopen(base+'/api/books?refresh=1')[2])
        ck('Book API scans only existing library root',data['ok'] and data['total']==5)
        ck('Unicode nested paths and all formats included',{x['name'] for x in data['books']}=={pathlib.Path(x).name for x in bookfiles})
        ck('Relative folders preserve Chinese hierarchy',any(x['relativeDir']=='佛学/唯识' for x in data['books']))
        ck('Symlinks and runtime cache excluded',all('逃逸' not in x['name'] and '绝密' not in x['name'] and '依赖' not in x['name'] for x in data['books']))
        ck('File identities stable across rescans',[x['id'] for x in data['books']]==[x['id'] for x in json.loads(urlopen(base+'/api/books?refresh=1')[2])['books']])
        ck('Existing media unchanged / books not in media list',all('epub' not in x.get('originalExt','') for x in json.loads(urlopen(base+'/api/data')[2])['items']))
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
            page=browser.new_page(viewport={'width':1440,'height':900})
            errs=[];page.on('pageerror',lambda error:errs.append(str(error)))
            def proxy(route):
                request=route.request
                u=urllib.parse.urlsplit(request.url)
                if u.path.startswith('/api/books'):
                    with urllib.request.urlopen(base+u.path+('?' + u.query if u.query else ''),timeout=20) as r: body=r.read();status=r.status
                    route.fulfill(status=status,body=body,headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
                else:
                    route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'})
            page.route('http://justfun.test/**',proxy)
            html=urlopen(base+'/')[2].decode('utf8')
            page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=20000)
            page.wait_for_timeout(350)
            page.locator('#studioRailToggle').click()
            page.locator('[data-media-kind="books"]').click()
            page.locator('.jfBookTile').first.wait_for(timeout=10000)
            ck('Book tab opens distinct browsing workspace',page.locator('#jfBooksWorkspace').is_visible() and len(page.locator('.jfBookTile').all())==5)
            print('DEBUG',page.evaluate("({body:document.body.className,display:getComputedStyle(document.getElementById('grid')).display,vis:getComputedStyle(document.getElementById('grid')).visibility,style:document.getElementById('grid').getAttribute('style')})"),flush=True)
            ck('Media cards hidden while shelf open',not page.locator('#grid').is_visible())
            page.locator('#jfBooksSearch').fill('西游')
            ck('Book search filters titles',page.locator('.jfBookTile').count()==1)
            page.locator('#jfBooksSearch').fill('')
            page.locator('#jfBooksFolders button[title="佛学/唯识"]').click()
            ck('Folder filtering preserves nested directory',page.locator('.jfBookTile').count()==2)
            page.locator('.jfBookTile').first.click()
            ck('Single-click book opens reader directly (updated UX contract)',page.locator('#jfReader').is_visible() and not page.locator('#jfBookDetail').is_visible())
            page.locator('#jfReadBack').click();page.wait_for_function('jfReader.hidden')
            page.locator('#studioRailToggle').click()
            page.locator('[data-media-kind="image"]').click()
            ck('Returning to media restores photo workspace',not page.locator('#jfBooksWorkspace').is_visible() and page.evaluate('libraryMode')=='image')
            # Emulate live photo with actual on-disk MP4 embedded as data URL, guaranteeing no server dependency.
            video_url='data:video/mp4;base64,'+base64.b64encode(live.read_bytes()).decode()
            item={'key':'aaaaaaaaaaaaaaaa','kind':'image','title':'实况测试','originalName':'实况测试.mp4','mediaUrl':video_url,'livePhoto':True}
            page.evaluate('''item=>{allItems=[item];imageViewerList=[item];showImageViewer(0);}''',item)
            motion=page.locator('#assetView .jfLivePhotoVideo')
            motion.wait_for(state='visible',timeout=9000)
            page.locator('#photoFilterToggle').click(force=True)
            page.locator('.jfFilterPanel[data-jf-mode="photo"] [data-jf-preset="bold"]').click(force=True)
            ck('Live photo video receives color grade',motion.evaluate("e=>getComputedStyle(e).filter") not in ['none',''])
            grade=motion.evaluate("e=>getComputedStyle(e).filter")
            ck('Hidden IMG shares the same grade',page.locator('#assetViewImg').evaluate("e=>getComputedStyle(e).filter")==grade)
            page.locator('.jfFilterPanel[data-jf-mode="photo"] [data-jf-preset="matrix"]').click(force=True)
            page.wait_for_timeout(600)
            ck('Live photo matrix samples VIDEO element',page.evaluate("jfMatrixRuntime.photo?.source?.tagName === 'VIDEO'"))
            ck('Matrix layer attached to live photo',page.locator('#assetView .photoImageSurface .jfFilterMatrixCanvas').count()==1)
            page.evaluate('hideImageViewer()')
            ck('Live photo matrix resets on closing',page.evaluate('jfMatrixRuntime.photo===null'))
            ck('No uncaught browser errors',not errs)
            browser.close()
        ck('Books and other original files are unchanged',all(hashlib.sha256((lib/p).read_bytes()).hexdigest()==sha for p,sha in originals.items()))
    finally:
        if proc:stop(proc,log)
print('PASS TOTAL',len(checks),flush=True)
