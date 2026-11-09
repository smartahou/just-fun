#!/usr/bin/env python3
"""v7.111: Chromium EPUB checks physical page prefixes, count cache and
stable chapter-text-anchor progress across census and reopening."""
import json,pathlib,runpy,tempfile,urllib.request
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop
fixture=runpy.run_path(str(ROOT/'tests/reading-progress-visual-v7107.py'))['fixture']

def data(page):
    return page.evaluate("""()=>{
      const left=document.querySelector('#jfPageView .jfSheet[data-side="left"]');
      const right=document.querySelector('#jfPageView .jfSheet[data-side="right"]');
      const current=jfDeskCurrentPosition();
      const stack=jfDeskStackState;
      return {
        book:jfDeskBook?.id, chapter:current.chapter, offset:current.offset,
        pageIndex:jfDeskPageIndex,known:jfDeskBookPages.known,
        exact:jfDeskBookPages.exact,folio:stack?.folio,
        currentFolio:stack?.left,nextFolio:stack?.right,
        leftText:left?.dataset.page,rightText:right?.dataset.page,
        leftExact:left?.dataset.folioExact,rightExact:right?.dataset.folioExact,
        leftCss:left?getComputedStyle(left,'::before').content:null,
        percent:document.getElementById('jfReadProgress').textContent,
        stackPercent:stack?.progress,
        progress:Math.round(100*jfDeskStableReadingProgress(current.chapter,current.offset)),
        paperGroup:left?.dataset.paperGroup,
        cache:localStorage.getItem('jf-reader-folios-v7111:'+jfDeskBook.id),
        signature:jfDeskPagesSig,
        font:window.JFReaderEmbeddedBookFonts?.()
      };
    }""")

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-exact-v7111-') as td:
        root=pathlib.Path(td);books=root/'books';books.mkdir()
        fixture(books/'exact-folios-test.epub')
        process=log=None
        try:
            process,port,log=launch(ROOT/'dist/douyin.js',books,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as response:
                book=next(x for x in json.load(response)['books'] if x['name']=='exact-folios-test.epub')
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                page.set_default_timeout(90000)
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='domcontentloaded',timeout=30000)
                page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=20000)
                page.evaluate('(id)=>jfDeskOpenReader(id,0)',book['id'])
                page.wait_for_function("()=>jfDeskOutline?.chapters?.length===4",timeout=30000)
                page.wait_for_function("()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0",timeout=30000)
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>jfDeskPaged&&jfDeskPages.length>3",timeout=30000)

                # Navigate to chapter 2; its earlier chapters may still be
                # unknown. Force just one missing prefix to inspect the honest
                # pending state instead of relying on an asynchronous race.
                page.evaluate("()=>jfDeskShowChapter(2,0,0)")
                page.wait_for_function("()=>jfDeskPaged&&jfDeskChapter===2&&jfDeskPages.length>1",timeout=30000)
                page.evaluate("""()=>{
                  jfDeskChapterPageCounts.delete(1);
                  jfDeskRecountBookPages();
                  jfDeskPagedRender();
                }""")
                pending=data(page)
                assert pending['chapter']==2,pending
                assert pending['folio']=='pending' and pending['leftText']=='',pending
                assert pending['leftExact']=='false' and pending['leftCss']=='none',pending
                assert pending['percent']==str(pending['stackPercent'])+'%',pending
                assert pending['percent']==str(pending['progress'])+'%',pending
                assert pending['paperGroup'],pending

                # Actual chapter census, not fabricated page numbers. The
                # calculation may have been in-flight when we cleared a count.
                page.wait_for_function("()=>!jfDeskCensusRunning",timeout=90000)
                page.evaluate("()=>jfDeskMeasureBook(jfDeskPagedGeometry())")
                page.wait_for_function("()=>jfDeskBookPages.exact&&jfDeskStackState?.folio==='exact'",timeout=90000)
                exact=data(page)
                assert exact['leftExact']=='true' and exact['currentFolio']>0,exact
                assert exact['leftText']==str(exact['currentFolio']),exact
                assert exact['rightText']==str(exact['nextFolio']),exact
                assert exact['percent']==pending['percent'],(pending,exact)
                assert exact['stackPercent']==pending['stackPercent'],(pending,exact)
                assert exact['cache'],exact
                saved=json.loads(exact['cache'])
                assert saved['layout']==exact['signature'],saved
                assert saved['version']=='v7.114.0',saved
                assert len(saved['counts'])>=3,saved

                # Reopening must retain both the selected book mode and cache.
                # Save the precise chapter anchor through the normal endpoint.
                page.evaluate("""async()=>{
                  const here=jfDeskCurrentPosition();
                  await jfDeskMutate({action:'progress',bookId:jfDeskBook.id,
                    chapter:here.chapter,ratio:here.ratio,offset:here.offset,
                    anchorY:here.anchorY,scroll:here.scroll,
                    mode:'paged',total:jfDeskOutline.chapters.length});
                }""")
                page.evaluate("(id)=>jfDeskOpenReader(id)",book['id'])
                page.wait_for_function("""()=>{
                  return jfDeskPaged&&jfDeskStackState?.folio==='exact'&&
                    jfDeskChapter===2&&jfDeskPages.length>1;
                }""",timeout=90000)
                reopened=data(page)
                assert reopened['folio']=='exact' and reopened['signature']==exact['signature'],(exact,reopened)
                assert reopened['leftText']==exact['leftText'],(exact,reopened)
                assert reopened['percent']==exact['percent'],(exact,reopened)
                assert reopened['font']['ready'] and reopened['paperGroup'],reopened
                # Resized viewport creates a new layout signature and MUST NOT
                # reuse the old counts just because the book ID is the same.
                page.set_viewport_size({'width':1140,'height':760})
                page.evaluate("()=>jfDeskPagedLayout(true,'viewport-test')")
                page.wait_for_function("()=>jfDeskPagesSig!=="+json.dumps(exact['signature']),timeout=30000)
                resized=data(page)
                assert resized['signature']!=exact['signature'],(exact,resized)
                assert resized['percent']==str(resized['stackPercent'])+'%',resized
                assert not errors,errors
                print('EXACT_FOLIOS_V7111_FACTS',json.dumps({
                    'pending':{k:v for k,v in pending.items() if k!='cache'},
                    'exact':{k:v for k,v in exact.items() if k!='cache'},
                    'reopened':{k:v for k,v in reopened.items() if k!='cache'},
                    'resized':{k:v for k,v in resized.items() if k!='cache'},
                    'cached_chapters':len(saved['counts'])
                },ensure_ascii=False),flush=True)
                print('PASS v7.111 real EPUB: pending digits hidden, exact prefix counted, stable progress, same reopened folio, font and geometry isolation',flush=True)
                browser.close()
        finally:
            stop(process,log)

if __name__=='__main__':main()
