#!/usr/bin/env python3
"""v7.107: actual EPUB progress + annotated poetry table browser verification."""
import base64
import io
import json
import pathlib
import tempfile
import urllib.request
import zipfile

from PIL import Image
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop

def fixture(destination):
    citations=[
        ('《唐诗纪事》','这首诗的句法别有意味，写景与叙事之间颇见用心。'),
        ('《唐诗品汇》','举诗人古今得失，论述章法与用典，尤多值得玩味之处。'),
        ('《诗境浅说》','全诗笔意含蓄，语气凝练，前后相照而意境深远。')
    ]
    rows=''.join(
        '<tr><td style="vertical-align:middle"><p>%s</p></td>'
        '<td style="vertical-align:middle"><p>%s</p></td></tr>'%(source,text)
        for source,text in citations)
    table='<div class="annotation-wrapper"><table class="source-pairs"><tbody>'+rows+'</tbody></table></div>'
    prose=''.join('<p>古人评诗，常以书名标识来源，评语应在同一行顶部对应。'
                  '文字内容和阅读位置在分页前后保持原状。</p>' for _ in range(20))
    normal=('<table class="ordinary"><tbody>'
      '<tr><td style="vertical-align:middle">序号</td><td style="vertical-align:middle">项目内容</td></tr>'
      '<tr><td style="vertical-align:middle">1</td><td style="vertical-align:middle">普通表格，不应用诗评样式</td></tr>'
      '</tbody></table>')
    chapters=[
       '<h1>笺评与书目</h1><p>本章展示诗评出处与对应内容。</p>'+table+prose,
       '<h1>普通数据表格</h1>'+normal+prose,
       '<h1>第三章</h1>'+prose,
       '<h1>第四章</h1>'+prose
    ]
    manifest=''.join('<item id="c%d" href="c%d.xhtml" media-type="application/xhtml+xml"/>'%(i,i) for i in range(4))
    spine=''.join('<itemref idref="c%d"/>'%i for i in range(4))
    opf='<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">progress-v7107</dc:identifier><dc:title>Just Fun progress and sources</dc:title><dc:language>zh</dc:language></metadata><manifest>%s</manifest><spine>%s</spine></package>'%(manifest,spine)
    with zipfile.ZipFile(destination,'w') as z:
        z.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr('OEBPS/content.opf',opf)
        for i,chapter in enumerate(chapters):
            z.writestr('OEBPS/c%d.xhtml'%i,'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第%d章</title></head><body>%s</body></html>'%(i+1,chapter))

def facts(page):
    return page.evaluate("""()=>{
      const stack=jfDeskStackState;
      const paragraph=document.querySelector('#jfPageView .jfSheetBody table.jfPrintSourceCommentary');
      const visibleCommentary=Array.from(document.querySelectorAll('#jfPageView table.jfPrintSourceCommentary'));
      const td=paragraph?.querySelector('td');
      const sourceTable=document.querySelector('#jfReadText table.source-pairs');
      const plainTable=document.querySelector('#jfReadText table.ordinary');
      return {
        chapter:jfDeskChapter,pageIndex:jfDeskPageIndex,mountedPages:jfDeskPages.length,
        percent:document.getElementById('jfReadProgress').textContent,
        bookPercent:stack?.progress,
        stackBookId:stack?.bookId,stackSession:stack?.session,
        totalPages:stack?.total,exact:stack?.exact,folio:stack?.folio,
        leftPage:stack?.left,rightPage:stack?.right,
        commentaryVisible:visibleCommentary.length,
        commentaryCellAlignment:td?getComputedStyle(td).verticalAlign:null,
        sourceUnmodified:!!sourceTable&&!sourceTable.classList.contains('jfPrintSourceCommentary'),
        ordinaryUnmodified:!!plainTable&&!plainTable.classList.contains('jfPrintSourceCommentary'),
        paperLeft:document.querySelector('#jfPageView .jfSheet[data-side="left"]')?.dataset.paperGroup,
        paperRight:document.querySelector('#jfPageView .jfSheet[data-side="right"]')?.dataset.paperGroup
      };
    }""")

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-progress-v7107-') as td:
        root=pathlib.Path(td)
        library=root/'books';library.mkdir()
        fixture(library/'progress-check.epub')
        process=log=None
        try:
            process,port,log=launch(ROOT/'dist/douyin.js',library,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as res:
                book=next(b for b in json.load(res)['books'] if b['name']=='progress-check.epub')
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='domcontentloaded',timeout=30000)
                page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=20000)
                page.evaluate('(id)=>jfDeskOpenReader(id,0)',book['id'])
                page.wait_for_function("()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0",timeout=30000)
                page.wait_for_timeout(500)
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>jfDeskPaged&&jfDeskPages.length>3",timeout=30000)
                page.wait_for_timeout(600)
                target=page.evaluate("""()=>jfDeskPages.findIndex(p=>p.some(block=>
                  block.node?.querySelector?.('table.jfPrintSourceCommentary')||
                  block.node?.classList?.contains('jfPrintSourceCommentary')))""")
                assert target>=0,'source/commentary table not classified in actual EPUB'
                page.evaluate('(idx)=>{jfDeskPageIndex=Math.floor(idx/2)*2;jfDeskPagedRender();}',target)
                page.wait_for_timeout(240)
                first=facts(page)
                assert first['commentaryVisible']>0,first
                assert first['commentaryCellAlignment']=='top',first
                assert first['sourceUnmodified'] and first['ordinaryUnmodified'],first
                assert first['percent']==str(first['bookPercent'])+'%',first
                assert first['paperLeft']==first['paperRight'],first

                # Rerendering and adding mounted-window entries cannot change
                # footer percentage without a new physical reading position.
                basePercent=first['percent']
                page.evaluate("()=>jfDeskPagedRender()")
                rerender=facts(page)
                assert rerender['percent']==basePercent,rerender

                # Non-zero progress is essential: an equality check at 0%
                # alone would miss a broken footer on real mid-book pages.
                middle=page.evaluate("()=>Math.min(4,Math.max(0,jfDeskPages.length-2))")
                page.evaluate('(i)=>{jfDeskPageIndex=Math.floor(i/2)*2;jfDeskPagedRender();}',middle)
                page.wait_for_timeout(100)
                mid=facts(page)
                assert 0<mid['bookPercent']<=100,mid
                assert mid['percent']==str(mid['bookPercent'])+'%',mid
                assert mid['bookPercent']>=first['bookPercent'],mid
                page.evaluate('(idx)=>{jfDeskPageIndex=Math.floor(idx/2)*2;jfDeskPagedRender();}',target)
                page.wait_for_timeout(100)
                reverse=facts(page)
                assert reverse['bookPercent']<=mid['bookPercent'],reverse
                assert reverse['percent']==str(reverse['bookPercent'])+'%',reverse

                normal=page.evaluate("""()=>jfDeskPages.findIndex(p=>p.some(block=>
                  block.node?.querySelector?.('table.ordinary')||
                  block.node?.classList?.contains('ordinary')))""")
                if normal>=0:
                    page.evaluate('(idx)=>{jfDeskPageIndex=Math.floor(idx/2)*2;jfDeskPagedRender();}',normal)
                    page.wait_for_timeout(120)
                    nochange=page.evaluate("""()=>{
                       const cell=document.querySelector('#jfPageView table.ordinary td');
                       return {classPresent:!!document.querySelector('#jfPageView table.ordinary.jfPrintSourceCommentary'),
                               verticalAlign:cell?getComputedStyle(cell).verticalAlign:null};
                    }""")
                    assert not nochange['classPresent'],nochange
                    assert nochange['verticalAlign']=='middle',nochange
                page.evaluate('(idx)=>{jfDeskPageIndex=Math.floor(idx/2)*2;jfDeskPagedRender();}',target)
                page.wait_for_timeout(120)

                preview=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
                preview.thumbnail((1150,740),Image.Resampling.LANCZOS)
                out=io.BytesIO()
                preview.save(out,format='JPEG',quality=72,optimize=True)
                photo=base64.b64encode(out.getvalue()).decode('ascii')
                print('PROGRESS_VISUAL_FACTS',json.dumps({
                    'first':first,'rerender':rerender,'middle':mid,'backwards':reverse,
                    'plainTable':nochange if normal>=0 else 'not mounted'
                },ensure_ascii=False),flush=True)
                print('PROGRESS_VISUAL_BEGIN',flush=True)
                for i in range(0,len(photo),3000): print('PROGRESS_VISUAL_DATA:'+photo[i:i+3000],flush=True)
                print('PROGRESS_VISUAL_END',flush=True)
                assert not errors,errors
                print('PASS v7.107 real EPUB: footer/piles percent equal; source titles and commentary top-aligned; normal table unmodified',flush=True)
                browser.close()
        finally:
            stop(process,log)
if __name__=='__main__':
    main()
