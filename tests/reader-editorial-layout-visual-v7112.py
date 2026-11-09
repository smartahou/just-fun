#!/usr/bin/env python3
"""v7.112: real EPUB with a short 【辑评】 heading followed by a long
two-column reference/annotation table. Verify no orphan heading, no unpaired
citation, exact folio persistence and all text preserved across page breaks."""
import json
import pathlib
import tempfile
import urllib.request
import zipfile
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop

CITATIONS=['《唐诗解》','《唐诗别裁》','《瀛奎律髓汇评》','《历代诗发》','《唐诗三百首》','《诗境浅说》']
COMMENTS=[
 '本篇诗中借故国衰微之景，以思念往事而感怀。' + '字里行间包含深沉的悲慨和曲折的感情。'*8,
 '论诗者尤重此篇之句法，又指出此处的思想十分深刻。'+'读后可见诗人的情怀并没有简单停留在表面。'*7,
 '这一段承接前文，行文舒缓而内在意味鲜明。'+'平仄与语意相得益彰，可见作者作意之精微。'*7,
 '此文以散见诸家之评议而互相参照，比较其异同。'+'行间所论有取舍，也有相互发明的地方。'*5,
 '诗的变化和格局，不能只从一句辞藻判断。'+'评论自有一贯思路，不可割裂上下文。'*6,
 '草木之情与羁旅之意，一经联系便令人感慨。'+'读书须把文字和篇章反复对读方能理解。'*8
]

def create_epub(filename):
    chapters=[]
    for c in range(5):
        if c==3:
            poem='<h2>没蕃故人</h2><p>张籍</p>'+''.join(
                '<p>前年戍月支，城下没全师。蕃汉断消息，死生长别离。</p>' for _ in range(5))
            rows=''.join('<tr><td>'+name+'</td><td>'+body+'</td></tr>'
                         for name,body in zip(CITATIONS,COMMENTS))
            chapters.append(poem+'<p class="editorial"><strong>【辑评】</strong></p>'+
                            '<table class="notes"><tbody>'+rows+'</tbody></table>'+
                            '<h2>草</h2><p>白居易</p><p>离离原上草，一岁一枯荣。</p>')
        elif c==4:
            chapters.append('<h1>后一章</h1><p>新章开端用于测试正确恢复阅读位置。</p>')
        else:
            chapters.append('<h1>章节%d</h1>'%c+
                 ''.join('<p>这一章节包含必须按实际字体和排版尺寸测量的长篇正文。'*4+
                         '诗与书中的内容应完整且连续，不得出现跳页。</p>'
                         for _ in range(9+c)))
    with zipfile.ZipFile(filename,'w') as z:
        z.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml','<?xml version="1.0"?>'
          '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
          '<rootfiles><rootfile full-path="OEBPS/content.opf" '
          'media-type="application/oebps-package+xml"/></rootfiles></container>')
        entries=''.join('<item id="c%d" href="text/c%d.xhtml" media-type="application/xhtml+xml"/>'%(i,i)
                        for i in range(len(chapters)))
        spine=''.join('<itemref idref="c%d"/>'%i for i in range(len(chapters)))
        z.writestr('OEBPS/content.opf','<?xml version="1.0" encoding="UTF-8"?>'
          '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
          '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
          '<dc:identifier id="id">semantic-v7112</dc:identifier>'
          '<dc:title>真实唐诗辑评分割验收</dc:title><dc:language>zh</dc:language></metadata>'
          '<manifest>'+entries+'</manifest><spine>'+spine+'</spine></package>')
        for i,body in enumerate(chapters):
            z.writestr('OEBPS/text/c%d.xhtml'%i,
              '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml">'
              '<head><title>测试</title><style>'
              'table.notes{width:100%;border-collapse:collapse}td{vertical-align:top;padding:3px}'
              'table.notes td:first-child{width:37%}'
              '</style></head><body>'+body+'</body></html>')

def state(page):
    return page.evaluate("""()=>{
      const idx=jfDeskPageIndex;
      const sheet=jfDeskPages[idx]||[];
      const meta=jfDeskStackState;
      return {
        chapter:jfDeskChapter,pageIndex:idx,firstOffset:sheet[0]?.offset,
        folio:meta?.folio,left:meta?.left,exact:jfDeskBookPages?.exact,
        leftText:document.querySelector('#jfPageView .jfSheet[data-side="left"]')?.dataset.page,
        percent:document.getElementById('jfReadProgress')?.textContent,
        pages:Math.max(0,jfDeskChapterPages.get(3)?.length||0),
        known:jfDeskBookPages.known,counts:Array.from(jfDeskChapterPageCounts.entries()),
        cache:localStorage.getItem('jf-reader-folios-v7111:'+jfDeskBook.id)
      };
    }""")

def main():
    with tempfile.TemporaryDirectory(prefix='jf-semantic-epub-v7112-') as td:
        root=pathlib.Path(td);books=root/'books';books.mkdir()
        create_epub(books/'semantic-v7112.epub')
        process=logs=None
        try:
            process,port,logs=launch(ROOT/'dist/douyin.js',books,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as response:
                book=next(b for b in json.load(response)['books'] if b['name']=='semantic-v7112.epub')
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/bin/chromium',
                                          headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850})
                page.set_default_timeout(90000)
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='domcontentloaded',timeout=30000)
                page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=30000)
                page.evaluate('(id)=>jfDeskOpenReader(id,3)',book['id'])
                page.wait_for_function("()=>jfDeskOutline?.chapters?.length===5",timeout=30000)
                page.wait_for_function("()=>jfDeskFlow.some(s=>s.n===3)",timeout=30000)
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>jfDeskPaged&&jfDeskChapterPages.has(3)",timeout=40000)
                inspect=page.evaluate("""()=>{
                  const original=jfDeskFlow.find(s=>s.n===3).el;
                  const blocks=jfDeskBlocksFor({n:3,el:original});
                  const paged=jfDeskChapterPages.get(3);
                  return {
                    headingMarked:blocks.some(x=>x.node.classList?.contains('jfPrintKeepWithNext')),
                    originalTableClass:blocks.some(x=>x.node.querySelector?.('table.jfPrintSourceCommentary')||
                      x.node.classList?.contains('jfPrintSourceCommentary')),
                    pages:paged.map(pg=>pg.map(b=>({
                      tag:b.node.tagName,text:b.node.textContent,
                      keep:b.node.classList?.contains('jfPrintKeepWithNext')||false,
                      sourceRow:b.sourceRow||false,
                      offset:b.offset
                    })))
                  };
                }""")
                assert inspect['headingMarked'],inspect
                assert inspect['originalTableClass'],inspect
                assert len(inspect['pages'])>=2,'fixture should require multiple printed pages'
                headings=[i for i,blocks in enumerate(inspect['pages'])
                          if any('【辑评】' in b['text'] for b in blocks)]
                assert len(headings)==1,headings
                heading_page=inspect['pages'][headings[0]]
                assert any('《唐诗解》' in b['text'] for b in heading_page),(
                  'Orphaned heading must share the page with first full comment',heading_page)
                count=0
                for label,comment in zip(CITATIONS,COMMENTS):
                    matched=[i for i,pg in enumerate(inspect['pages'])
                             for b in pg if label in b['text']]
                    assert len(matched)==1,(label,matched)
                    rowtext=''.join(b['text'] for b in inspect['pages'][matched[0]] if label in b['text'])
                    assert comment in rowtext,(label,matched[0],rowtext[-120:])
                    count+=1
                assert count==6
                assert all(any(not b['keep'] for b in pg)
                           for pg in inspect['pages'] if any(b['keep'] for b in pg)),(
                    'No printed sheet may contain only a semantic heading',inspect['pages'])
                first=state(page)
                # The counts for chapters 0..2 are needed to give the active
                # chapter a printed number. Wait for the genuine asynchronous
                # census, not a hard-coded timeout or estimated number.
                page.wait_for_function("""()=>{
                  return jfDeskPagesBefore(3)!==null &&
                    jfDeskStackState?.folio==='exact';
                }""",timeout=90000)
                exact=state(page)
                assert exact['folio']=='exact' and exact['left']>0,exact
                assert exact['leftText']==str(exact['left']),exact
                assert exact['percent']==first['percent'],(first,exact)
                assert exact['firstOffset']==first['firstOffset'],(first,exact)
                assert exact['pageIndex']==first['pageIndex'],(first,exact)

                # Reopen using normal saved book progress after folio cache
                # has been persisted; the same text anchor and folio must return.
                page.evaluate("""async()=>{
                  const x=jfDeskCurrentPosition();
                  await jfDeskMutate({action:'progress',bookId:jfDeskBook.id,
                    chapter:x.chapter,ratio:x.ratio,offset:x.offset,
                    anchorY:x.anchorY,scroll:x.scroll,
                    mode:'paged',total:jfDeskOutline.chapters.length});
                }""")
                page.evaluate('(id)=>jfDeskOpenReader(id)',book['id'])
                page.wait_for_function("""()=>{
                  return jfDeskPaged&&jfDeskChapter===3 &&
                    jfDeskStackState?.folio==='exact'&&jfDeskPages.length>0;
                }""",timeout=90000)
                opened=state(page)
                assert opened['left']==exact['left'],(exact,opened)
                assert opened['firstOffset']==exact['firstOffset'],(exact,opened)
                assert opened['percent']==exact['percent'],(exact,opened)
                assert not errors,errors
                print('SEMANTIC_FOLIOS_V7112_FACTS',json.dumps({
                    'chapterPrintedPages':len(inspect['pages']),
                    'semanticHeadingOnPage':headings[0],
                    'commentaryRowsVerified':count,
                    'initial':{k:v for k,v in first.items() if k!='cache'},
                    'exact':{k:v for k,v in exact.items() if k!='cache'},
                    'reopened':{k:v for k,v in opened.items() if k!='cache'},
                },ensure_ascii=False),flush=True)
                print('PASS v7.112: editorial title keeps first comment, intact row citations, exact page prefix and reopened anchor',flush=True)
                browser.close()
        finally:
            stop(process,logs)

if __name__=='__main__':main()
