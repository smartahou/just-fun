#!/usr/bin/env python3
"""v7.110 real Chromium: embedded Chinese 400/600 fonts load before EPUB pagination."""
import base64,io,json,pathlib,runpy,tempfile,urllib.request
from PIL import Image
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop

create_epub=runpy.run_path(str(ROOT/'tests/paper-visual-smoke-v7104.py'))['create_epub']

def font_faces(page,selector):
    session=page.context.new_cdp_session(page)
    try:
        session.send('DOM.enable')
        session.send('CSS.enable')
        root=session.send('DOM.getDocument')['root']['nodeId']
        node=session.send('DOM.querySelector',{'nodeId':root,'selector':selector})['nodeId']
        if not node:return []
        return session.send('CSS.getPlatformFontsForNode',{'nodeId':node})['fonts']
    finally:
        session.detach()

def inspect(page):
    return page.evaluate("""()=>{
      const body=document.querySelector('#jfPageView .jfSheetBody');
      const probe=document.querySelector('#jfPageView .jfPageMeasure.jfSheetBody');
      const bodyCss=body?getComputedStyle(body):null;
      const probeCss=probe?getComputedStyle(probe):null;
      const first=jfDeskPages[jfDeskPageIndex]?.[0];
      return {
        registered:window.JFReaderEmbeddedBookFonts?.(),
        chosenFamily:jfDeskPrefs.family,
        font400:document.fonts.check('400 18px "JustFun Book Serif CN"','唐诗宋史'),
        font600:document.fonts.check('600 18px "JustFun Book Serif CN"','章节'),
        computedFamily:bodyCss?.fontFamily,measurementFamily:probeCss?.fontFamily,
        fontSize:bodyCss?.fontSize,probeSize:probeCss?.fontSize,
        pageCount:jfDeskPages.length,firstChapterPages:jfDeskChapterPages.get(0)?.length,
        position:first?{chapter:first.chapter,offset:first.offset}:null,
        signature:jfDeskLayoutSignature(jfDeskPagedGeometry()),
        paperEnabled:window.JFPaperTextures.isEnabled(),
        paperGroup:document.querySelector('#jfPageView .jfSheet[data-side="left"]')?.dataset.paperGroup
      };
    }""")

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-serif-v7110-') as t:
        root=pathlib.Path(t);library=root/'books';library.mkdir()
        create_epub(library/'embedded-serif-test.epub')
        process=log=None
        try:
            process,port,log=launch(ROOT/'dist/douyin.js',library,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as r:
                book=next(x for x in json.load(r)['books'] if x['name']=='embedded-serif-test.epub')
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='domcontentloaded',timeout=30000)
                page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=20000)
                page.evaluate('(id)=>jfDeskOpenReader(id,0)',book['id'])
                page.wait_for_function("()=>window.JFReaderEmbeddedBookFonts?.().ready===true",timeout=30000)
                page.wait_for_function("()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0",timeout=30000)
                # Trigger the real two-leaf pagination engine with the font
                # already loaded, not by toggling CSS on an existing page.
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>jfDeskPaged&&jfDeskPages.length>4",timeout=30000)
                page.wait_for_timeout(450)
                before=inspect(page)
                assert before['chosenFamily']=='serif',before
                assert before['registered']['ready'] and before['font400'] and before['font600'],before
                assert 'JustFun Book Serif CN' in before['computedFamily'],before
                assert before['computedFamily']==before['measurementFamily'],before
                assert before['fontSize']==before['probeSize'],before
                assert 'SourceHanSerifCN-1.000R-GBK-7.110' in before['signature'],before
                assert before['paperEnabled'] and before['paperGroup'],before
                # CDP is authoritative: actual rasterised font, not a CSS
                # font-family list whose first entry may still be unavailable.
                prose_fonts=font_faces(page,'#jfPageView .jfSheetBody p')
                # A restored spread often does not display a chapter heading.
                # Inspect a temporary styled heading under the same *actual*
                # book sheet, rather than asking DevTools for a missing node.
                page.evaluate("""()=>{
                  const sheet=document.querySelector('#jfPageView .jfSheetBody');
                  if(!sheet.querySelector(':scope > h1')){
                    const title=document.createElement('h1');
                    title.id='jfBookFontHeadingAudit';
                    title.textContent='章节标题';
                    title.style.cssText='position:absolute;left:20px;top:20px;opacity:.01;pointer-events:none';
                    sheet.appendChild(title);
                  }
                }""")
                title_fonts=font_faces(page,'#jfPageView .jfSheetBody h1')
                page.evaluate("()=>document.getElementById('jfBookFontHeadingAudit')?.remove()")
                def local(f):
                    return 'justfun' in (f.get('familyName') or '').lower() or 'justfun' in (f.get('postScriptName') or '').lower()
                assert any(local(f) for f in prose_fonts),prose_fonts
                assert any(local(f) for f in title_fonts),title_fonts

                page.evaluate("()=>jfDeskPageTurn(1)")
                page.wait_for_timeout(250)
                prior=inspect(page)
                page.evaluate("()=>jfDeskPagedLayout(true,'font-idempotence')")
                page.wait_for_timeout(450)
                after=inspect(page)
                assert prior['firstChapterPages']==after['firstChapterPages'],(prior,after)
                assert prior['position']==after['position'],(prior,after)
                assert after['registered']['ready'] and after['font400'] and after['font600'],after
                assert after['computedFamily']==after['measurementFamily'],after
                assert not errors,errors

                shot=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
                shot.thumbnail((1150,740),Image.Resampling.LANCZOS)
                out=io.BytesIO();shot.save(out,'JPEG',quality=72,optimize=True)
                data=base64.b64encode(out.getvalue()).decode('ascii')
                print('BOOK_FONT_V7110_FACTS',json.dumps({
                    'before':before,'after':after,'prosePlatformFonts':prose_fonts,'titlePlatformFonts':title_fonts
                },ensure_ascii=False),flush=True)
                print('BOOK_FONT_V7110_JPEG_BEGIN',flush=True)
                for i in range(0,len(data),3000):print('BOOK_FONT_V7110_JPEG_DATA:'+data[i:i+3000],flush=True)
                print('BOOK_FONT_V7110_JPEG_END',flush=True)
                print('PASS v7.110 Chromium: real rendered Chinese text is embedded JustFun serif; 400/600 loaded before measure; same page after reflow',flush=True)
                browser.close()
        finally:
            stop(process,log)

if __name__=='__main__': main()
