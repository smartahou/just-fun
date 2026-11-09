#!/usr/bin/env python3
"""v7.113 real Chromium: compare typography of bibliography columns across leaves."""
import json,pathlib,runpy,tempfile,urllib.request
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop
fixture=runpy.run_path(str(ROOT/'tests/reader-editorial-layout-visual-v7112.py'))
def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-column-grid-v7113-') as td:
        root=pathlib.Path(td);lib=root/'books';lib.mkdir()
        fixture['create_epub'](lib/'source-grid.epub')
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',lib,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as response:
                book=next(b for b in json.load(response)['books'] if b['name']=='source-grid.epub')
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                page.set_default_timeout(90000)
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='domcontentloaded',timeout=30000)
                page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=30000)
                page.evaluate('(id)=>jfDeskOpenReader(id,3)',book['id'])
                page.wait_for_function("()=>jfDeskFlow.some(s=>s.n===3)",timeout=30000)
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>jfDeskPaged&&jfDeskChapterPages.has(3)",timeout=40000)
                d=page.evaluate("""()=>{
                  const geo=jfDeskPagedGeometry(),host=jfDeskMeasureHost(geo);
                  const records=[];
                  jfDeskChapterPages.get(3).forEach((blocks,i)=>{
                    for(const block of blocks){
                      if(!block.sourceRow)continue;
                      host.replaceChildren(block.node.cloneNode(true));
                      const table=host.querySelector('table.jfPrintSourceRowPart');
                      if(!table||table.rows.length!==1||table.rows[0].cells.length!==2)
                        throw Error('bibliographic row lost cells');
                      const a=table.rows[0].cells[0],b=table.rows[0].cells[1];
                      const rect=table.getBoundingClientRect();
                      records.push({
                        page:i,source:a.textContent,comment:b.textContent,
                        width:rect.width,firstWidth:a.getBoundingClientRect().width,
                        secondX:b.getBoundingClientRect().left-rect.left,
                        height:rect.height,maxHeight:geo.innerH,
                        layout:getComputedStyle(table).tableLayout,
                        cols:Array.from(table.querySelectorAll(':scope > colgroup > col'))
                          .map(c=>c.style.width)
                      });
                    }
                  });
                  return records;
                }""")
                assert len(d)==len(fixture['CITATIONS']),(len(d),d)
                assert len({x['page'] for x in d})>=2,d
                for source,comment in zip(fixture['CITATIONS'],fixture['COMMENTS']):
                    matches=[x for x in d if source in x['source']]
                    assert len(matches)==1 and comment in matches[0]['comment'],(source,matches)
                assert all(x['layout']=='fixed' and len(x['cols'])==2 for x in d),d
                assert all(abs(x['firstWidth']-d[0]['firstWidth'])<=1.5 for x in d),d
                assert all(abs(x['secondX']-d[0]['secondX'])<=1.5 for x in d),d
                assert all(abs(x['width']-d[0]['width'])<=1.5 for x in d),d
                assert all(x['height']<=x['maxHeight']+1 for x in d),d
                assert not errors,errors
                print('COLUMN_GRID_V7113_FACTS',json.dumps({
                    'pages':[x['page'] for x in d],
                    'column_widths':[round(x['firstWidth'],2) for x in d],
                    'comment_x_positions':[round(x['secondX'],2) for x in d]
                },ensure_ascii=False),flush=True)
                print('PASS v7.113 real EPUB: 6 source/comment pairs, identical two-column grid across paper leaves',flush=True)
                browser.close()
        finally:stop(proc,log)
if __name__=='__main__':main()
