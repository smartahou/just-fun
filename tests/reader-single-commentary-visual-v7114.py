#!/usr/bin/env python3
"""v7.114: real Chromium verifies one short cited note is laid out as two
fixed columns, with the same grid as the long multi-row note across pages.
No original EPUB content, paragraph metrics or paper textures are modified."""
import json,pathlib,re,runpy,tempfile,urllib.request,zipfile
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop

fixture=runpy.run_path(str(ROOT/'tests/reader-editorial-layout-visual-v7112.py'))
SINGLE_LABEL='《唐诗三百首》'
SINGLE_COMMENT='中二联当作三十层看。'

def one_row_book(path):
    fixture['create_epub'](path)
    with zipfile.ZipFile(path,'r') as source:
        parts=[(entry.filename,source.read(entry.filename),entry.compress_type)
               for entry in source.infolist()]
    replaced=0
    with zipfile.ZipFile(path,'w') as out:
        for name,data,compression in parts:
            if name=='OEBPS/text/c3.xhtml':
                x=data.decode('utf8')
                table='<table class="notes"><tbody><tr><td>'+SINGLE_LABEL+'</td><td>'+SINGLE_COMMENT+'</td></tr></tbody></table>'
                x,count=re.subn(r'<table class="notes"><tbody>.*?</tbody></table>',lambda m:table,x,flags=re.S)
                assert count==1,(count,name)
                data=x.encode('utf8')
                replaced+=1
            out.writestr(name,data,compress_type=compression)
    assert replaced==1

def page_metrics(page):
    return page.evaluate("""()=>{
      const geo=jfDeskPagedGeometry(),host=jfDeskMeasureHost(geo);
      const sec=jfDeskFlow.find(s=>s.n===3);
      const original=sec.el.querySelector('table.notes');
      const blocks=jfDeskBlocksFor(sec);
      const annotated=blocks.map(x=>x.node)
        .map(n=>n.tagName==='TABLE'?n:n.querySelector?.('table'))
        .filter(n=>n?.classList.contains('jfPrintSourceCommentary'));
      const fromSource=Array.from(original.rows).map(row=>
        Array.from(row.cells).map(cell=>cell.textContent));
      const rows=[];
      for(const blocksOnPage of jfDeskChapterPages.get(3)||[]){
        for(const b of blocksOnPage){
          const n=b.node.tagName==='TABLE'?b.node:
            b.node.querySelector?.('table.jfPrintSourceCommentary');
          if(!n?.classList.contains('jfPrintSourceCommentary'))continue;
          host.replaceChildren(b.node.cloneNode(true));
          const t=host.querySelector('table.jfPrintSourceCommentary');
          if(!t||!t.rows.length)continue;
          const rect=t.getBoundingClientRect();
          const c1=t.rows[0].cells[0].getBoundingClientRect();
          const c2=t.rows[0].cells[1].getBoundingClientRect();
          const labelRange=document.createRange();
          labelRange.selectNodeContents(t.rows[0].cells[0]);
          const labelRight=labelRange.getBoundingClientRect().right;
          rows.push({
            first:t.rows[0].cells[0].textContent,
            second:t.rows[0].cells[1].textContent,
            cols:Array.from(t.querySelectorAll(':scope > colgroup > col')).map(n=>n.style.width),
            leftWidth:c1.width,commentStart:c2.left-rect.left,
            wholeWidth:rect.width,layout:getComputedStyle(t).tableLayout,
            gapPx:c2.left-labelRight,share:Number(t.dataset.jfSourceShare)
          });
        }
      }
      return {
        originalRows:fromSource,
        sourceColgroups:original.querySelectorAll(':scope > colgroup').length,
        annotatedCount:annotated.length,
        singleFlag:annotated[0]?.classList.contains('jfPrintSourceSingle'),
        printedColWidths:annotated[0]?Array.from(
          annotated[0].querySelectorAll(':scope > colgroup > col')).map(n=>n.style.width):[],
        actualRows:rows,
        chapterPages:jfDeskChapterPages.get(3)?.length,
        progress:document.getElementById('jfReadProgress').textContent,
        font:window.JFReaderEmbeddedBookFonts?.(),
        paperActive:window.JFPaperTextures.isEnabled()
      };
    }""")

def open_book(page,base,book_id):
    page.goto(base,wait_until='domcontentloaded',timeout=30000)
    page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=30000)
    page.evaluate('(id)=>jfDeskOpenReader(id,3)',book_id)
    page.wait_for_function("()=>jfDeskFlow.some(s=>s.n===3)",timeout=30000)
    page.locator('#jfReadPaged').click()
    page.wait_for_function("""()=>jfDeskPaged&&jfDeskChapterPages.has(3)&&
       jfDeskPages.length>0&&jfDeskStackState?.page===jfDeskPages[jfDeskPageIndex]""",timeout=40000)

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-single-note-v7114-') as td:
        root=pathlib.Path(td);books=root/'books';books.mkdir()
        one_row_book(books/'single-note.epub')
        fixture['create_epub'](books/'multi-note.epub')
        process=logs=None
        try:
            process,port,logs=launch(ROOT/'dist/douyin.js',books,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as r:
                catalog={b['name']:b['id'] for b in json.load(r)['books']}
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                page.set_default_timeout(90000)
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                open_book(page,base,catalog['single-note.epub'])
                single=page_metrics(page)
                assert single['originalRows']==[[SINGLE_LABEL,SINGLE_COMMENT]],single
                assert single['sourceColgroups']==0,'source EPUB DOM must stay unchanged'
                assert single['annotatedCount']==1 and single['singleFlag'],single
                assert single['printedColWidths']==[],(
                  'Column sizing must occur once under real page geometry, not when cloning',single)
                assert len(single['actualRows'])==1,single
                one=single['actualRows'][0]
                assert one['first']==SINGLE_LABEL and one['second']==SINGLE_COMMENT,one
                assert one['layout']=='fixed' and len(one['cols'])==2,one
                assert .16<=one['leftWidth']/one['wholeWidth']<.30,one
                assert 6<=one['gapPx']<=40,('The source needs one natural glyph of air',one)
                assert single['paperActive'] and single['font']['ready'],single

                open_book(page,base,catalog['multi-note.epub'])
                multi=page_metrics(page)
                assert len(multi['originalRows'])==6,multi
                assert len(multi['actualRows'])==6,multi
                assert not multi['singleFlag'],multi
                assert all(r['layout']=='fixed' for r in multi['actualRows']),multi
                # Unlike v7.114, a *short* single citation must reserve less
                # space than a multi-row table with longer bibliography titles.
                assert one['leftWidth']+5<multi['actualRows'][0]['leftWidth'],(single,multi)
                assert one['commentStart']+5<multi['actualRows'][0]['commentStart'],(single,multi)
                assert len({round(row['leftWidth'],1) for row in multi['actualRows']})==1,multi
                assert len({round(row['commentStart'],1) for row in multi['actualRows']})==1,multi
                assert not errors,errors
                print('SINGLE_NOTE_V7114_METRICS',json.dumps({
                    'single':{'source':one['first'],'comment':one['second'],
                      'colWidths':one['cols'],'firstColumnPx':round(one['leftWidth'],2),
                      'commentStartPx':round(one['commentStart'],2),'pages':single['chapterPages']},
                    'multi':{'rowCount':len(multi['actualRows']),
                      'firstColumnPx':round(multi['actualRows'][0]['leftWidth'],2),
                      'commentStartPx':round(multi['actualRows'][0]['commentStart'],2)}
                },ensure_ascii=False),flush=True)
                print('PASS v7.115 Chrome EPUB: short notes use a compact measured gutter, and multirow annotations share stable columns',flush=True)
                browser.close()
        finally:
            stop(process,logs)
if __name__=='__main__':
    # The old table-column acceptance is obsolete. Keep the EPUB fixtures
    # importable, and use the v7.116 real-browser semantic flow acceptance.
    runpy.run_path(str(ROOT/'tests/reader-flowing-commentary-visual-v7116.py'),run_name='__main__')
