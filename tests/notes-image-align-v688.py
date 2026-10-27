#!/usr/bin/env python3
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,io,base64
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
checks=0

def ck(label, cond):
    global checks
    if not cond:
        raise AssertionError(label)
    checks += 1
    print('PASS', label, flush=True)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v688-') as d:
    tmp=pathlib.Path(d); lib=tmp/'media'; lib.mkdir(); (lib/'甲.txt').write_text('书中真实文字。'*160, encoding='utf8')
    src_sha=hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest()
    img=Image.new('RGB',(900,280),'white'); ImageDraw.Draw(img).text((30,120),'JUST FUN IMAGE',fill='black'); buf=io.BytesIO(); img.save(buf,format='JPEG',quality=88)
    jpeg='data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
    proc=log=None
    try:
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home'); origin=f'http://127.0.0.1:{port}'
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1600,'height':960})
            errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
            def proxy(route):
                req=route.request; u=urllib.parse.urlsplit(req.url)
                body=req.post_data.encode() if req.method=='POST' and req.post_data else None
                r=urllib.request.Request(origin+u.path+('?' + u.query if u.query else ''), data=body, method=req.method, headers={'Content-Type':'application/json'} if body else {})
                try:
                    with urllib.request.urlopen(r, timeout=40) as res:
                        status=res.status; data=res.read(); mime=res.headers.get('Content-Type','application/json')
                except urllib.error.HTTPError as e:
                    status=e.code; data=e.read(); mime=e.headers.get('Content-Type','application/json')
                route.fulfill(status=status, body=data, headers={'Content-Type':mime})
            page.route('http://justfun.test/**', proxy)
            html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
            page.set_content(html, wait_until='domcontentloaded', timeout=25000)
            page.locator('#studioRailToggle').click(); page.locator('[data-media-kind=notes]').click()
            page.locator('#jfDeskNewNote').click(); page.locator('#jfDeskNoteTitle').fill('对齐测试')
            page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='对齐测试')")
            page.evaluate('''async(img)=>{const note=jfDeskWorkspace.notes.find(n=>n.title==='对齐测试'); const b=jfBooks[0]; const q={type:'image',image:img,text:'图片摘录',bookId:b.id,chapter:0,anchorStart:null,imageWidth:25,imageAlign:'left'}; await jfDeskMutate({action:'note',note:{...note,quotes:[q],blocks:[{kind:'text',text:'上文'},{kind:'quote',index:0},{kind:'text',text:'下文'}]}}); await jfDeskSelectNote(note.id);}''', jpeg)
            card=page.locator('.jfDeskImageQuote'); card.wait_for()
            top=page.evaluate("""()=>{const range=document.getElementById('jfNoteAllImageWidth').getBoundingClientRect(); const pct=document.getElementById('jfNoteAllImagePercent').getBoundingClientRect(); const prev=document.getElementById('jfNotePreview').getBoundingClientRect(); const md=document.getElementById('jfNoteExportMd').getBoundingClientRect(); const html=document.getElementById('jfNoteExportHtml').getBoundingClientRect(); return {a:range.y+range.height/2,b:pct.y+pct.height/2,c:prev.y+prev.height/2,d:md.y+md.height/2,e:html.y+html.height/2}; }""")
            ck('Top toolbar controls are vertically aligned', max(top.values())-min(top.values()) < 3.5)
            inner=page.evaluate("""()=>{const range=document.querySelector('.jfDeskImageControls .jfNoteImageRange').getBoundingClientRect(); const pct=document.querySelector('.jfDeskImageControls .jfNoteImagePercent').getBoundingClientRect(); const left=document.querySelector('.jfDeskImageControls [data-image-align="left"]').getBoundingClientRect(); const center=document.querySelector('.jfDeskImageControls [data-image-align="center"]').getBoundingClientRect(); const right=document.querySelector('.jfDeskImageControls [data-image-align="right"]').getBoundingClientRect(); const card=document.querySelector('.jfDeskImageQuote').getBoundingClientRect(); const controls=document.querySelector('.jfDeskImageControls').getBoundingClientRect(); return {m1:range.y+range.height/2,m2:pct.y+pct.height/2,m3:left.y+left.height/2,m4:center.y+center.height/2,m5:right.y+right.height/2, cardW:card.width, ctrlW:controls.width}; }""")
            mids=[inner['m1'],inner['m2'],inner['m3'],inner['m4'],inner['m5']]
            ck('In-card controls are vertically aligned', max(mids)-min(mids) < 3.5)
            ck('Quote card is not narrower than control section', inner['cardW'] >= inner['ctrlW'] - 1)
            page.screenshot(path='/mnt/data/jf-v688-align.png')
            ck('No page errors', not errors)
            browser.close()
        ck('Source file unchanged', hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest()==src_sha)
    finally:
        if proc: stop(proc,log)
print('TOTAL', checks, flush=True)
