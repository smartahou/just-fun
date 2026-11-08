#!/usr/bin/env python3
"""v7.105 real-browser A/B visual proof: baseline vs restrained new ink.

Load the offline Just Fun build with a disposable EPUB. Capture identical
spreads, first with temporary v7.104 ink values, then with v7.105 values.
Assert font metrics/page index/probe parity before rendering a small contact.
"""
import base64
import io
import json
import pathlib
import runpy
import tempfile
import urllib.request

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop

make_epub=runpy.run_path(str(ROOT/'tests/paper-visual-smoke-v7104.py'))['create_epub']

BASELINE_CSS="""
.jfReader.paged.jf-aged-paper #jfPageView .jfSheetBody {
  color:rgba(53,37,24,.95);
  -webkit-text-stroke:.085px rgba(50,34,20,.12);
  text-shadow:none;
}
.jfReader.paged.jf-aged-paper #jfPageView .jfSheetBody > :is(h1,h2,h3,h4,h5,h6) {
  color:inherit;
}
.jfReader.paged.jf-aged-paper #jfPageView .jfSheetBody figcaption {
  color:#79644a;
}
"""

def emit(name,img):
    out=io.BytesIO()
    img.save(out,format="JPEG",quality=75,optimize=True)
    data=base64.b64encode(out.getvalue()).decode("ascii")
    print(name+"_BEGIN",flush=True)
    for i in range(0,len(data),3000):
        print(name+"_DATA:"+data[i:i+3000],flush=True)
    print(name+"_END",flush=True)

def inspect(page):
    return page.evaluate("""()=>{
      const printed=document.getElementById('jfSheetLeft');
      const probe=document.querySelector('#jfPageView .jfPageMeasure.jfSheetBody');
      const pageStyle=getComputedStyle(printed),probeStyle=getComputedStyle(probe);
      const metricKeys=['fontFamily','fontSize','fontWeight','lineHeight',
                        'letterSpacing','wordSpacing','textIndent','textAlign'];
      const metrics=obj=>Object.fromEntries(metricKeys.map(k=>[k,obj[k]]));
      return {
        pageIndex:jfDeskPageIndex,numberOfPages:jfDeskPages.length,
        pairLeft:printed.parentElement.dataset.paperGroup,
        pairRight:document.getElementById('jfSheetRight').parentElement.dataset.paperGroup,
        pageMetrics:metrics(pageStyle),probeMetrics:metrics(probeStyle),
        pageInk:pageStyle.color,probeInk:probeStyle.color,
        cssStroke:pageStyle.webkitTextStrokeWidth
      };
    }""")

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-ink-v7105-') as td:
        root=pathlib.Path(td)
        library=root/'books';library.mkdir()
        make_epub(library/'ink-check.epub')
        process=log=None
        try:
            process,port,log=launch(ROOT/'dist/douyin.js',library,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as res:
                book=next(b for b in json.load(res)['books'] if b['name']=='ink-check.epub')
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='domcontentloaded',timeout=30000)
                page.wait_for_function("typeof jfDeskOpenReader === 'function'",timeout=20000)
                page.evaluate('(id)=>jfDeskOpenReader(id,0)',book['id'])
                page.wait_for_function("()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0",timeout=30000)
                page.wait_for_timeout(750)
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>jfDeskPaged&&jfDeskPages.length>4",timeout=30000)
                page.wait_for_timeout(750)
                if not page.evaluate("()=>window.JFPaperTextures?.isEnabled()"):
                    page.evaluate("()=>document.getElementById('jfReadPaperAged').click()")
                page.evaluate("()=>{jfDeskPageIndex=2;jfDeskPagedRender();}")
                page.wait_for_timeout(250)
                # Temporary CSS is test-only. It is removed after baseline screenshot.
                page.add_style_tag(content=BASELINE_CSS)
                page.wait_for_timeout(120)
                before=inspect(page)
                shot_before=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
                page.evaluate("""()=>{const s=[...document.querySelectorAll('style')].find(n=>n.textContent.includes('rgba(53,37,24,.95)'));if(s)s.remove();}""")
                page.wait_for_timeout(120)
                after=inspect(page)
                shot_after=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
                assert before['pageMetrics']==after['pageMetrics'],(before,after)
                assert before['probeMetrics']==after['probeMetrics'],(before,after)
                assert before['pageIndex']==after['pageIndex']==2
                assert before['numberOfPages']==after['numberOfPages']>4
                assert before['pairLeft']==before['pairRight']==after['pairLeft']==after['pairRight']
                assert before['pageInk']!=after['pageInk'],(before,after)
                assert before['pageMetrics']==before['probeMetrics'],(before,after)
                assert after['pageMetrics']==after['probeMetrics'],(before,after)
                assert not errors,errors
                print('INK_AB_FACTS',json.dumps({'before':before,'after':after},ensure_ascii=False),flush=True)
                # Body-size crop from the same spread, enlarged side-by-side.
                # Screenshot only for CI review, never saved to the repository.
                crop=(85,105,670,635)
                left=shot_before.crop(crop)
                right=shot_after.crop(crop)
                sheet=Image.new('RGB',(left.width*2,left.height+42),(229,226,219))
                sheet.paste(left,(0,42));sheet.paste(right,(left.width,42))
                draw=ImageDraw.Draw(sheet)
                draw.text((14,14),'v7.104 baseline - slightly lighter amber ink',fill=(49,39,27))
                draw.text((left.width+14,14),'v7.105 candidate - slightly firmer neutral ink',fill=(49,39,27))
                emit('INK_AB_JPEG',sheet)
                print('PASS real Chromium A/B: exact same font, metrics, page and original photographic paper',flush=True)
                browser.close()
        finally:
            stop(process,log)
if __name__=='__main__':
    main()
