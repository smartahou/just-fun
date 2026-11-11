#!/usr/bin/env python3
"""v7.123: Chrome checks physical page/text equivalence against the frozen
v7.122 paginator, plus isolated measurement cost. No private user book needed.
"""
import json,pathlib,runpy,tempfile,urllib.request
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop

make_book=runpy.run_path(str(ROOT/'tests/reader-page-performance-v7119.py'))['create_epub']

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-paginator-v7123-') as work:
        tmp=pathlib.Path(work);lib=tmp/'library';lib.mkdir()
        make_book(lib/'pagination-bench.epub',chapters=40)
        legacy=(ROOT/'tests/fixtures/page-engine-v7122-baseline.js').read_text(encoding='utf-8')
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home')
            origin='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(origin+'/api/books?refresh=1',timeout=30) as f:
                book=next(x for x in json.load(f)['books'] if x['name']=='pagination-bench.epub')
            with sync_playwright() as pw:
                browser=pw.chromium.launch(executable_path='/usr/bin/chromium',
                    headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850})
                page.set_default_timeout(100000)
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(origin,wait_until='domcontentloaded')
                page.wait_for_function("typeof jfDeskOpenReader==='function'")
                page.evaluate('(id)=>jfDeskOpenReader(id,0)',book['id'])
                page.wait_for_function("()=>jfDeskFlow.length>0")
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>jfDeskPaged&&jfDeskPages.length>1")
                report=page.evaluate("""async legacySource=>{
                  const optimized=window.JFPageEngine;
                  // The frozen v7.122 script runs only inside the current
                  // isolated Chromium fixture, never in the user's library.
                  new Function(legacySource)();
                  const baseline=window.JFPageEngine;
                  window.JFPageEngine=optimized;
                  await jfDeskEnsureBookFonts();
                  await document.fonts.ready;
                  clearTimeout(jfDeskCensusStartTimer);jfDeskCensusToken++;
                  const host=document.createElement('div');
                  host.className='jfPageMeasure jfSheetBody';
                  host.style.cssText='position:absolute;left:-99999px;top:0;'+
                    'height:auto;padding:0';
                  document.getElementById('jfPageView').appendChild(host);
                  const blocks=[];
                  let offset=0;
                  const verse='云山苍苍，江水泱泱。春风又绿江南岸，明月何时照我还。';
                  for(let i=0;i<220;i++){
                    const title=i%14===0;
                    const node=document.createElement(title?'h3':'p');
                    if(title){
                      node.className='jfPrintKeepWithNext';
                      node.textContent='新编诗词第'+i+'篇';
                    }else{
                      const marker=document.createElement('strong');
                      marker.textContent='古诗评注';
                      node.appendChild(marker);
                      node.append(document.createTextNode(verse.repeat(1+i%3)));
                    }
                    blocks.push({chapter:Math.floor(i/14),node,key:'bench:'+i,offset});
                    offset+=node.textContent.length;
                  }
                  const original=blocks.map(x=>x.node.textContent).join('');
                  const widths=[460,540];
                  const reports=[];
                  try{
                    for(const w of widths){
                      host.style.width=w+'px';
                      const h=620;
                      const run=(engine)=>{
                        host.replaceChildren();
                        const start=performance.now();
                        const pages=engine.paginate(blocks,h,host);
                        const elapsed=performance.now()-start;
                        const text=pages.flatMap(page=>page.map(x=>x.node.textContent)).join('');
                        const identity=pages.map(page=>page.map(x=>
                          [x.key,x.offset,x.node.textContent.length].join(':')).join('|'));
                        return {pages:pages.length,text,identity,
                          elapsed:Math.round(elapsed*10)/10,
                          diagnostics:engine.diagnostics?.()||null};
                      };
                      // Warm both variants once; alternate order to reduce
                      // systematic first-run CSS/font/image bias.
                      const warmLegacy=run(baseline),warmNew=run(optimized);
                      const measuredLegacy=run(baseline),measuredNew=run(optimized);
                      const ref=warmLegacy;
                      const same=(r)=>r.pages===ref.pages&&
                        r.text===original&&JSON.stringify(r.identity)===
                          JSON.stringify(ref.identity);
                      if(![warmNew,measuredLegacy,measuredNew].every(same))
                        throw Error('Pagination differs from v7.122 baseline at '+w+
                          'px: '+JSON.stringify({
                            counts:[warmLegacy.pages,warmNew.pages,
                              measuredLegacy.pages,measuredNew.pages],
                            chars:[original.length,warmLegacy.text.length,
                              measuredNew.text.length]}));
                      const stats=measuredNew.diagnostics;
                      if(!stats||stats.reusedColumnNodes<=blocks.length||
                         stats.singleMeasurements>=blocks.length*0.5||
                         stats.clonedColumnNodes>=blocks.length*7)
                        throw Error('Measured-prefix reuse absent: '+
                          JSON.stringify(stats));
                      reports.push({width:w,pages:ref.pages,
                        oldMs:measuredLegacy.elapsedMs??measuredLegacy.elapsed,
                        newMs:measuredNew.elapsed,
                        speedup:Math.round(measuredLegacy.elapsed/
                          Math.max(1,measuredNew.elapsed)*100)/100,
                        ...stats});
                    }
                    return {reports,sourceCharacters:original.length,
                      activeBookId:jfDeskBook?.id,visualIndex:jfDeskPageIndex};
                  }finally{
                    window.JFPageEngine=optimized;
                    host.remove();
                  }
                }""",legacy)
                assert not errors,'Chrome JavaScript errors: '+str(errors[:5])
                assert len(report['reports'])==2,report
                assert report['sourceCharacters']>10000,report
                print('PASS v7.123 Chromium measured paginator parity & reuse: '+
                      json.dumps(report,ensure_ascii=False),flush=True)
                browser.close()
        finally:
            stop(proc,log)
if __name__=='__main__':
    main()
