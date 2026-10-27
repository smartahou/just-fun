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

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v690-') as d:
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
            page.evaluate('''async(img)=>{const note=jfDeskWorkspace.notes.find(n=>n.title==='对齐测试'); const b=jfBooks[0]; const q={type:'image',image:img,text:'图片摘录',bookId:b.id,chapter:0,anchorStart:null,imageWidth:100,imageAlign:'left'}; await jfDeskMutate({action:'note',note:{...note,quotes:[q],blocks:[{kind:'text',text:'上文'},{kind:'quote',index:0},{kind:'text',text:'下文'}]}}); await jfDeskSelectNote(note.id);}''', jpeg)
            card=page.locator('.jfDeskImageQuote'); card.wait_for()
            top=page.evaluate("""()=>{const range=document.getElementById('jfNoteAllImageWidth').getBoundingClientRect(); const pct=document.getElementById('jfNoteAllImagePercent').getBoundingClientRect(); const prev=document.getElementById('jfNotePreview').getBoundingClientRect(); const md=document.getElementById('jfNoteExportMd').getBoundingClientRect(); const html=document.getElementById('jfNoteExportHtml').getBoundingClientRect(); return {a:range.y+range.height/2,b:pct.y+pct.height/2,c:prev.y+prev.height/2,d:md.y+md.height/2,e:html.y+html.height/2}; }""")
            ck('Top toolbar controls are vertically aligned', max(top.values())-min(top.values()) < 3.5)
            inner=page.evaluate("""()=>{const range=document.querySelector('.jfDeskImageControls .jfNoteImageRange').getBoundingClientRect(); const pct=document.querySelector('.jfDeskImageControls .jfNoteImagePercent').getBoundingClientRect(); const left=document.querySelector('.jfDeskImageControls [data-image-align="left"]').getBoundingClientRect(); const center=document.querySelector('.jfDeskImageControls [data-image-align="center"]').getBoundingClientRect(); const right=document.querySelector('.jfDeskImageControls [data-image-align="right"]').getBoundingClientRect(); const card=document.querySelector('.jfDeskImageQuote').getBoundingClientRect(); const controls=document.querySelector('.jfDeskImageControls').getBoundingClientRect(); return {m1:range.y+range.height/2,m2:pct.y+pct.height/2,m3:left.y+left.height/2,m4:center.y+center.height/2,m5:right.y+right.height/2, cardW:card.width, ctrlW:controls.width}; }""")
            mids=[inner['m1'],inner['m2'],inner['m3'],inner['m4'],inner['m5']]
            ck('In-card controls are vertically aligned', max(mids)-min(mids) < 3.5)
            ck('Quote card is not narrower than control section', inner['cardW'] >= inner['ctrlW'] - 1)
            def shape():
                return page.evaluate("""()=>{const card=document.querySelector('.jfDeskImageQuote');const image=card.querySelector('.jfDeskQuoteImageFrame');const controls=card.querySelector('.jfDeskImageControls');const slider=card.querySelector('.jfNoteImageRange');const b=slider.getBoundingClientRect();return {v:Number(slider.value),imageW:image.getBoundingClientRect().width,cardW:card.getBoundingClientRect().width,toolbarX:controls.getBoundingClientRect().x,toolbarY:controls.getBoundingClientRect().y,sliderX:b.x,sliderY:b.y,sliderW:b.width,sliderH:b.height,floating:controls.classList.contains('jfImageControlsDragging')};}""")
            # Widths must change at every step even below the minimum card width.
            sizes=[]
            for w in (100,80,65,60,50,40,30,20):
                page.evaluate('(w)=>{const el=document.querySelector(".jfNoteImageRange");el.value=String(w);el.dispatchEvent(new Event("input",{bubbles:true}));}',w)
                sizes.append(shape())
            ck('Image pixels shrink continuously even below 60%',all(a['imageW']>b['imageW']+10 for a,b in zip(sizes,sizes[1:])))
            ck('Card minimum only affects the card, not image itself',abs(sizes[-1]['cardW']-sizes[-3]['cardW'])<2 and sizes[-1]['imageW']<sizes[-3]['imageW']*.75)
            page.evaluate('''()=>{const e=document.querySelector('.jfNoteImageRange');e.value='20';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}''')
            # Actual physical pointer hold-and-drag, including intermediate
            # screenshots and DOM metrics, not event-based range simulation.
            start=shape(); x=start['sliderX']+start['sliderW']*.02; y=start['sliderY']+start['sliderH']/2
            page.mouse.move(x,y);page.mouse.down();page.wait_for_timeout(80)
            initial=shape(); traces=[initial]
            for frac in (.15,.32,.5,.66,.82,.98):
                page.mouse.move(start['sliderX']+start['sliderW']*frac,y,steps=5)
                page.wait_for_timeout(55)
                traces.append(shape())
            ck('Drag actively changes selected width',traces[-1]['v']>traces[0]['v']+40)
            ck('Drag values rise monotonically with mouse x',all(a['v']<=b['v'] for a,b in zip(traces,traces[1:])))
            ck('Range screen coordinates stay fixed during dragging',max(abs(t['sliderY']-initial['sliderY']) for t in traces)<1 and max(abs(t['sliderX']-initial['sliderX']) for t in traces)<1)
            ck('Changing image size does not move the floating controls',max(abs(t['toolbarY']-initial['toolbarY']) for t in traces)<1)
            ck('Drag reacts continuously in image pixels',all(a['imageW']<=b['imageW']+2 for a,b in zip(traces,traces[1:])))
            page.screenshot(path='/mnt/data/jf-v690-dragging.png')
            page.mouse.up();page.wait_for_timeout(150)
            final=shape()
            ck('Controls return to normal flow on release',not final['floating'])
            ck('Result persists in note after save',page.evaluate('''()=>Number(jfNoteLiveQuotes[0].imageWidth)===Number(document.querySelector('.jfNoteImageRange').value)'''))
            # Reverse drag while the card shrinks; range must stay under the mouse
            # and the image must decrease monotonically through 60 percent.
            current=shape(); xx=current['sliderX']+current['sliderW']*.98; yy=current['sliderY']+current['sliderH']/2
            page.mouse.move(xx,yy);page.mouse.down();page.wait_for_timeout(70)
            falling=[shape()]
            for frac in (.82,.64,.47,.28,.05):
                page.mouse.move(current['sliderX']+current['sliderW']*frac,yy,steps=5)
                page.wait_for_timeout(50)
                falling.append(shape())
            ck('Reverse pointer drag is monotonic across 60% threshold',all(a['v']>=b['v'] for a,b in zip(falling,falling[1:])) and falling[-1]['v']<=30)
            ck('Reverse pointer position remains fixed',max(abs(t['sliderY']-falling[0]['sliderY']) for t in falling)<1)
            page.mouse.up();page.wait_for_timeout(150)
            ck('Reverse drag released its positioning lock',not shape()['floating'])
            # Persist through actual server transaction and read it back.
            page.evaluate('''async()=>{await jfDeskSaveEditor(); await jfDeskSelectNote(jfDeskActiveNote)}''')
            ck('Image size remains after save and reopen',page.evaluate('''()=>jfNoteLiveQuotes[0].imageWidth===Number(document.querySelector('.jfNoteImageRange').value)'''))
            page.screenshot(path='/mnt/data/jf-v690-result.png')
            ck('No page errors', not errors)
            browser.close()
        ck('Source file unchanged', hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest()==src_sha)
    finally:
        if proc: stop(proc,log)
print('TOTAL', checks, flush=True)
