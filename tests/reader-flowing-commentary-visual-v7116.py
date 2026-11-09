#!/usr/bin/env python3
"""v7.116 real Chromium: cited annotations become flowing text without grids.
A single short note, long mixed-length references, wrapping and multi-page
comments must preserve every original source character and the saved anchor."""
import json,pathlib,runpy,tempfile,urllib.request
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop

long_fixture=runpy.run_path(str(ROOT/'tests/reader-editorial-layout-visual-v7112.py'))
one_fixture=runpy.run_path(str(ROOT/'tests/reader-single-commentary-visual-v7114.py'))

def snapshot(page):
    return page.evaluate("""()=>{
      const sec=jfDeskFlow.find(s=>s.n===3),source=sec.el.querySelector('table.notes');
      const raw=Array.from(source.rows).map(row=>Array.from(row.cells).map(cell=>cell.textContent));
      const printed=jfDeskChapterPages.get(3)||[];
      const blocks=printed.flatMap((leaf,page)=>
        leaf.map(b=>({page,node:b.node,offset:b.offset,key:b.key})));
      const notes=blocks.filter(b=>b.node.classList?.contains('jfPrintCommentaryNote'));
      const heading=blocks.find(b=>b.node.textContent.trim()==='【辑评】');
      const host=jfDeskMeasureHost(jfDeskPagedGeometry());
      const position=jfDeskCurrentPosition();
      const measurements=notes.filter(b=>b.node.querySelector('.jfPrintCommentarySource')?.textContent.trim())
        .map(b=>{
          host.replaceChildren(b.node.cloneNode(true));
          const n=host.firstElementChild;
          const source=n.querySelector('.jfPrintCommentarySource');
          const text=n.querySelector('.jfPrintCommentaryText');
          const start=document.createRange(),end=document.createRange();
          start.selectNodeContents(source);end.selectNodeContents(text);
          const sr=start.getClientRects()[0],cr=end.getClientRects()[0];
          const style=getComputedStyle(n);
          return {
            page:b.page,label:source.textContent,comment:text.textContent,
            gap:sr&&cr&&Math.abs(sr.top-cr.top)<3?cr.left-sr.right:null,
            sourceX:sr?.left,commentX:cr?.left,
            padding:parseFloat(style.paddingLeft),indent:parseFloat(style.textIndent),
            nodeHeight:n.getBoundingClientRect().height,
            hasTable:!!n.querySelector('table'),
          };
        });
      return {
        raw,original:source.textContent,
        sourceTableUnchanged:source.rows.length===raw.length,
        flattened:notes.map(b=>b.node.textContent).join(''),
        noteCount:notes.length,
        bibliographyOccurrences:notes.filter(b=>
          b.node.querySelector('.jfPrintCommentarySource')?.textContent.trim()).length,
        headingPage:heading?.page,
        firstNotePage:measurements[0]?.page,
        notes:measurements,
        containsTables:notes.some(b=>!!b.node.querySelector('table')),
        pageCount:printed.length,
        folio:jfDeskStackState?.folio,
        offset:position.offset,chapter:position.chapter,
        fontReady:window.JFReaderEmbeddedBookFonts?.().ready,
        paper:window.JFPaperTextures.isEnabled()
      };
    }""")

def open_book(page,base,id):
    page.goto(base,wait_until='domcontentloaded',timeout=30000)
    page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=30000)
    page.evaluate('(id)=>jfDeskOpenReader(id,3)',id)
    page.wait_for_function("()=>jfDeskFlow.some(s=>s.n===3)",timeout=30000)
    page.locator('#jfReadPaged').click()
    page.wait_for_function("""()=>{
      return jfDeskPaged&&jfDeskChapterPages.has(3)&&
        jfDeskPages.length>0&&jfDeskStackState?.page===jfDeskPages[jfDeskPageIndex];
    }""",timeout=40000)

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-flowing-notes-v7116-') as td:
        tmp=pathlib.Path(td);books=tmp/'books';books.mkdir()
        one_fixture['one_row_book'](books/'single-flow.epub')
        long_fixture['create_epub'](books/'long-flow.epub')
        process=log=None
        try:
            process,port,log=launch(ROOT/'dist/douyin.js',books,tmp/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as resp:
                ids={x['name']:x['id'] for x in json.load(resp)['books']}
            with sync_playwright() as pw:
                browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                page.set_default_timeout(90000)
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                open_book(page,base,ids['single-flow.epub'])
                single=snapshot(page)
                assert single['raw']==[[one_fixture['SINGLE_LABEL'],one_fixture['SINGLE_COMMENT']]],single
                assert single['flattened']==single['original'],single
                assert single['bibliographyOccurrences']==1 and not single['containsTables'],single
                assert single['firstNotePage']==single['headingPage'],single
                assert single['notes'][0]['gap'] is not None and 6<=single['notes'][0]['gap']<=28,single
                assert single['notes'][0]['padding']>0 and single['notes'][0]['indent']<0,single
                assert single['fontReady'] and single['paper'],single

                open_book(page,base,ids['long-flow.epub'])
                long=snapshot(page)
                assert len(long['raw'])==len(long_fixture['CITATIONS']),long
                assert long['flattened']==long['original'],(
                    'Every character must remain in the same text order',long)
                assert long['bibliographyOccurrences']==len(long_fixture['CITATIONS']),long
                assert long['firstNotePage']==long['headingPage'],(
                    'The editorial heading must not be orphaned',long)
                assert long['pageCount']>=2,long
                assert not long['containsTables'],long
                assert len({n['page'] for n in long['notes']})>=2,long
                for citation,comment in zip(long_fixture['CITATIONS'],long_fixture['COMMENTS']):
                    assert sum(1 for n in long['notes'] if n['label']==citation)==1,(
                        'Each bibliography item occurs exactly once',citation,long)
                    assert comment in long['original']
                gaps=[n['gap'] for n in long['notes'] if n['gap'] is not None]
                assert len(gaps)>=2 and all(6<=gap<=28 for gap in gaps),long
                # The short bibliography label has a genuinely earlier inline
                # comment starting point than a much longer bibliography label.
                short=next(n for n in long['notes'] if n['label']=='《唐诗解》')
                extended=next(n for n in long['notes'] if n['label']=='《瀛奎律髓汇评》')
                assert short['commentX']+20<extended['commentX'],(short,extended)
                assert not errors,errors
                print('FLOWING_NOTES_V7116_FACTS',json.dumps({
                    'single':{
                      'gap':round(single['notes'][0]['gap'],2),
                      'originalLength':len(single['original']),
                      'printedLength':len(single['flattened'])},
                    'long':{
                      'pages':long['pageCount'],
                      'references':long['bibliographyOccurrences'],
                      'originalLength':len(long['original']),
                      'printedLength':len(long['flattened']),
                      'gaps':[round(x,2) for x in gaps],
                      'positions':{
                         'short':round(short['commentX'],2),
                         'long':round(extended['commentX'],2)}
                    }
                },ensure_ascii=False),flush=True)
                print('PASS v7.116 Chromium: short and long citations flow with natural spaces and all text conserved across pages',flush=True)
                browser.close()
        finally:
            stop(process,log)
if __name__=='__main__':main()
