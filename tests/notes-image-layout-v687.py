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

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v687-') as d:
    tmp=pathlib.Path(d); lib=tmp/'media'; lib.mkdir(); (lib/'甲.txt').write_text('书中真实文字。'*160, encoding='utf8')
    source_sha=hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest()
    img=Image.new('RGB',(900,280),'white'); draw=ImageDraw.Draw(img); draw.text((30,120),'JUST FUN IMAGE',fill='black')
    buf=io.BytesIO(); img.save(buf,format='JPEG',quality=88)
    jpeg='data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
    proc=log=None
    try:
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home'); origin=f'http://127.0.0.1:{port}'
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1600,'height':960}, accept_downloads=True)
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
            page.locator('#jfDeskNewNote').click(); page.locator('#jfDeskNoteTitle').fill('布局修复测试')
            page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='布局修复测试')", timeout=15000)
            page.evaluate('''async(img)=>{
              const note=jfDeskWorkspace.notes.find(n=>n.title==='布局修复测试');
              const b=jfBooks[0];
              const q={type:'image',image:img,text:'图片摘录',bookId:b.id,chapter:0,anchorStart:null,imageWidth:35,imageAlign:'left'};
              await jfDeskMutate({action:'note',note:{...note,quotes:[q],blocks:[{kind:'text',text:'上文'},{kind:'quote',index:0},{kind:'text',text:'下文'}]}});
              await jfDeskSelectNote(note.id);
            }''', jpeg)
            card=page.locator('.jfDeskImageQuote'); card.wait_for()
            # top slider align and visibility
            top=page.evaluate("""()=>{const bar=document.querySelector('.jfNoteCommandBar').getBoundingClientRect(); const range=document.getElementById('jfNoteAllImageWidth').getBoundingClientRect(); const pct=document.getElementById('jfNoteAllImagePercent').getBoundingClientRect(); const prev=document.getElementById('jfNotePreview').getBoundingClientRect(); return {barTop:bar.top, rangeTop:range.top, rangeBottom:range.bottom, barBottom:bar.bottom, rangeMid:range.y+range.height/2, pctMid:pct.y+pct.height/2, prevMid:prev.y+prev.height/2};}""")
            ck('Top bulk slider is not clipped above command bar', top['rangeTop'] >= top['barTop'] - 0.5 and top['rangeBottom'] <= top['barBottom'] + 0.5)
            ck('Top bulk slider and right controls are vertically aligned', abs(top['rangeMid']-top['pctMid'])<3 and abs(top['pctMid']-top['prevMid'])<3)
            # in-card controls alignment and shrunken card width
            in_card=page.evaluate("""()=>{const editor=document.getElementById('jfDeskEditor').getBoundingClientRect(); const card=document.querySelector('.jfDeskImageQuote').getBoundingClientRect(); const range=document.querySelector('.jfDeskImageControls .jfNoteImageRange').getBoundingClientRect(); const pct=document.querySelector('.jfDeskImageControls .jfNoteImagePercent').getBoundingClientRect(); const left=document.querySelector('.jfDeskImageControls [data-image-align="left"]').getBoundingClientRect(); const center=document.querySelector('.jfDeskImageControls [data-image-align="center"]').getBoundingClientRect(); const right=document.querySelector('.jfDeskImageControls [data-image-align="right"]').getBoundingClientRect(); return {editorW:editor.width, cardW:card.width, rangeMid:range.y+range.height/2, pctMid:pct.y+pct.height/2, leftMid:left.y+left.height/2, centerMid:center.y+center.height/2, rightMid:right.y+right.height/2};}""")
            ck('Image quote card shrinks when image gets smaller', in_card['cardW'] < in_card['editorW'] * 0.75 and in_card['cardW'] >= 360)
            ck('In-card image controls stay vertically aligned', abs(in_card['rangeMid']-in_card['pctMid'])<3 and abs(in_card['leftMid']-in_card['centerMid'])<3 and abs(in_card['centerMid']-in_card['rightMid'])<3)
            # top slider drag updates all images
            handle=page.locator('#jfNoteAllImageWidth')
            page.evaluate("el=>el.value='50'", handle.element_handle()); handle.dispatch_event('input'); handle.dispatch_event('change')
            ck('Top slider updates image width percent', page.locator('.jfDeskImageControls .jfNoteImagePercent').inner_text()=='50%')
            # spacing from divider to editor content
            gap=page.evaluate("""()=>{const divider=document.getElementById('jfDeskNotesDivider').getBoundingClientRect(); const title=document.getElementById('jfDeskNoteTitle').getBoundingClientRect(); return {gap:title.left-divider.right};}""")
            ck('Editor content keeps breathing room from divider', gap['gap'] >= 16)
            page.screenshot(path='/mnt/data/jf-v687-note-ui.png')
            ck('No page errors', not errors)
            browser.close()
        ck('Original book file remains unchanged', hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest()==source_sha)
    finally:
        if proc: stop(proc,log)
print('TOTAL', checks, flush=True)
