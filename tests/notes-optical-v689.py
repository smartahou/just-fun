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
            page.wait_for_function("Array.from(document.querySelectorAll('.jfDeskImageQuote img')).every(i=>i.complete && i.naturalWidth>0)")
            # v6.91: per-image controls are intentionally invisible until
            # image hover. Check actual visible cyan thumb only after hover.
            frame=page.locator('.jfDeskQuoteImageFrame').bounding_box();assert frame
            page.mouse.move(frame['x']+20,frame['y']+20)
            page.wait_for_timeout(250)
            from PIL import Image as PILImage
            screenshot=page.screenshot(path='/mnt/data/jf-v689-proof.png')
            import io as _io
            screen=PILImage.open(_io.BytesIO(screenshot)).convert('RGB')
            midboxes=page.evaluate("""()=>Object.fromEntries([
              ['top',document.getElementById('jfNoteAllImageWidth')],
              ['inline',document.querySelector('.jfDeskImageControls .jfNoteImageRange')],
              ['topText',document.getElementById('jfNoteAllImagePercent')],
              ['inlineText',document.querySelector('.jfDeskImageControls .jfNoteImagePercent')]
            ].map(([k,e])=>{const r=e.getBoundingClientRect();return [k,{x:r.x,y:r.y,w:r.width,h:r.height}]}))""")
            def visual_thumb_mid(rect):
                x0=max(0,int(rect['x']));x1=min(screen.width,int(rect['x']+rect['w']))
                y0=max(0,int(rect['y'])-2);y1=min(screen.height,int(rect['y']+rect['h'])+2)
                pixels=[]
                for yy in range(y0,y1):
                    for xx in range(x0,x1):
                        r,g,b=screen.getpixel((xx,yy))
                        if r>=110 and g>165 and b>=140 and g>r*1.12 and b>r*1.08:
                            pixels.append((xx,yy))
                if len(pixels)<25:raise AssertionError(f'Thumb pixels absent: {rect} count={len(pixels)}')
                # thumb is the only bright cyan patch in the slider's bounds
                return sum(y for x,y in pixels)/len(pixels)
            top_thumb=visual_thumb_mid(midboxes['top']);inline_thumb=visual_thumb_mid(midboxes['inline'])
            top_text=midboxes['topText']['y']+midboxes['topText']['h']/2
            inner_text=midboxes['inlineText']['y']+midboxes['inlineText']['h']/2
            print('OPTICAL',{'top_thumb_y':top_thumb,'top_text_center_y':top_text,'top_delta':round(abs(top_thumb-top_text),2),'inline_thumb_y':inline_thumb,'inline_text_center_y':inner_text,'inline_delta':round(abs(inline_thumb-inner_text),2)},flush=True)
            ck('Top slider *visible thumb* aligns with percent',abs(top_thumb-top_text)<2.5)
            ck('Inline slider *visible thumb* aligns with percent',abs(inline_thumb-inner_text)<2.5)
            computed=page.evaluate("""()=>Array.from(document.querySelectorAll('#jfNoteAllImageWidth,.jfDeskImageControls .jfNoteImageRange')).map(el=>getComputedStyle(el).paddingBottom)""")
            ck('Both range inputs have no inherited bottom padding', all(v=='0px' for v in computed))

            print('STYLES',page.evaluate("""()=>Object.fromEntries(['#jfNoteAllImageWidth','.jfDeskImageControls .jfNoteImageRange','#jfNoteAllImagePercent','.jfDeskImageControls .jfNoteImagePercent','.jfDeskImageControls [data-image-align=left]'].map(selector=>{const el=document.querySelector(selector);const s=getComputedStyle(el),r=el.getBoundingClientRect(),tr=getComputedStyle(el,'::-webkit-slider-runnable-track'), th=getComputedStyle(el,'::-webkit-slider-thumb');return [selector,{rect:{x:r.x,y:r.y,w:r.width,h:r.height},padding:s.padding,margin:s.margin,border:s.border,box:s.boxSizing,lineHeight:s.lineHeight,appearance:s.appearance,trackHeight:tr.height,trackMargin:tr.margin,thumbHeight:th.height,thumbMargin:th.margin}]}))"""),flush=True)
            page.screenshot(path='/mnt/data/jf-v689-before.png')
            ck('No page errors', not errors)
            browser.close()
        ck('Source file unchanged', hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest()==src_sha)
    finally:
        if proc: stop(proc,log)
print('TOTAL', checks, flush=True)
