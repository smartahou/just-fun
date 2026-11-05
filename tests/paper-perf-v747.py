#!/usr/bin/env python3
"""Just Fun paper-reader browser benchmark: 30 forward + 30 backward turns.
Works on v7.46 baseline and v7.48, never reads the owner's actual library.
"""
import argparse, json, pathlib, statistics, tempfile, time, urllib.request, zipfile
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop

def epub(path):
    pieces=[]
    for n in range(10):
        body='<h1>第%d章</h1>'%(n+1)
        for i in range(13):
            body+='<p>'+('旧书翻阅时，文字与纸张应自然清晰、连贯而安静。' * 16)+'</p>'
        pieces.append(body)
    with zipfile.ZipFile(path,'w') as z:
        z.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
        manifest=''.join('<item id="c%d" href="c%d.xhtml" media-type="application/xhtml+xml"/>'%(n,n) for n in range(len(pieces)))
        spine=''.join('<itemref idref="c%d"/>'%n for n in range(len(pieces)))
        z.writestr('OEBPS/content.opf','<package><metadata><dc:title xmlns:dc="x">Paper Bench</dc:title></metadata><manifest>'+manifest+'</manifest><spine>'+spine+'</spine></package>')
        for n,content in enumerate(pieces):
            z.writestr('OEBPS/c%d.xhtml'%n,'<html><body>'+content+'</body></html>')

def pct(xs,p):
    if not xs:return None
    values=sorted(xs)
    return round(values[min(len(values)-1,max(0,int((len(values)-1)*p)))],2)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--build',default=str(ROOT/'dist'/'douyin.js'))
    ap.add_argument('--output')
    ap.add_argument('--expected-static',action='store_true')
    args=ap.parse_args()
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-paper-v747-') as t:
        tmp=pathlib.Path(t);lib=tmp/'library';lib.mkdir()
        epub(lib/'paper-bench.epub')
        proc=log=None
        try:
            proc,port,log=launch(pathlib.Path(args.build).resolve(),lib,tmp/'home')
            base='http://127.0.0.1:'+str(port)
            for attempt in range(80):
                try:
                    with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=5) as response:
                        books=json.load(response)['books']
                    break
                except Exception:time.sleep(.3)
            book=next(x for x in books if x['name']=='paper-bench.epub')
            with sync_playwright() as p:
                br=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--enable-precise-memory-info'])
                pg=br.new_page(viewport={'width':1440,'height':900})
                errors=[];pg.on('pageerror',lambda err:errors.append(str(err)))
                pg.goto(base,wait_until='domcontentloaded')
                pg.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=20000)
                pg.evaluate('(id)=>jfDeskOpenReader(id,0)',book['id'])
                pg.wait_for_function("()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0",timeout=30000)
                pg.locator('#jfReadPaged').click()
                pg.wait_for_function("()=>jfDeskPages.length>2",timeout=50000)
                pg.wait_for_timeout(600)
                if args.expected_static:
                    geometry=pg.evaluate("""()=>{
                      const page=document.querySelector('.jfSheet[data-side="left"]').getBoundingClientRect();
                      const spine=document.querySelector('.jfSpineShade').getBoundingClientRect();
                      return {top:Math.abs(page.top-spine.top),bottom:Math.abs(page.bottom-spine.bottom)};
                    }""")
                    assert geometry['top']<1.5 and geometry['bottom']<1.5, 'Spine exceeds book page: '+str(geometry)
                    # The old-paper control is purely visual: it must not repaginate.
                    before=pg.evaluate("()=>jfDeskPageIndex")
                    pg.locator('#jfReadPaperAged').click()
                    assert not pg.evaluate("()=>window.JFPaperTextures.isEnabled()")
                    assert pg.evaluate("()=>getComputedStyle(document.querySelector('.jfSheet'),'::after').backgroundImage")=='none'
                    pg.locator('#jfReadPaperAged').click()
                    assert pg.evaluate("()=>window.JFPaperTextures.isEnabled()")
                    assert before==pg.evaluate("()=>jfDeskPageIndex")
                    # Real header UI: light / medium / heavy must change only
                    # decorative paint, never the page index or its geometry.
                    wear=pg.locator('#jfReadPaperWear')
                    assert wear.is_visible(), 'Wear selector missing in paper mode'
                    wear.select_option('heavy')
                    assert pg.evaluate("()=>window.JFPaperTextures.getWearLevel()")=='heavy'
                    assert pg.evaluate("()=>document.getElementById('jfReader').dataset.paperWear")=='heavy'
                    strong=pg.evaluate("()=>getComputedStyle(document.querySelector('.jfSheetStack')).opacity")
                    wear.select_option('light')
                    assert pg.evaluate("()=>window.JFPaperTextures.getWearLevel()")=='light'
                    weak=pg.evaluate("()=>getComputedStyle(document.querySelector('.jfSheetStack')).opacity")
                    assert float(strong)>float(weak), 'Wear levels do not affect edge appearance'
                    assert before==pg.evaluate("()=>jfDeskPageIndex"), 'Wear level repaginated content'
                    assert pg.evaluate("()=>getComputedStyle(document.querySelector('.jfBookPile')).backgroundImage.indexOf('repeating-linear-gradient')<0"),'Mechanical comb stripes returned'
                    wear.select_option('medium')
                    assert pg.evaluate("()=>localStorage.getItem('jf-reader-paper-wear-v752')")=='medium'
                    # Verify the exact visual-depth mapping at representative
                    # reading positions, without mutating the user's actual progress.
                    depths=pg.evaluate("""()=>{
                      return [0,.25,.5,.75,1].map(p=>jfDeskStackForProgress(p));
                    }""")
                    assert depths[0]['read']==0 and depths[0]['unread']>=27, depths
                    assert depths[4]['unread']==0 and depths[4]['read']>=27, depths
                    assert depths[1]['read']<depths[1]['unread'],depths
                    assert abs(depths[2]['read']-depths[2]['unread'])<.1,depths
                    assert depths[3]['read']>depths[3]['unread'],depths
                    assert all(depths[i]['read']<depths[i+1]['read'] for i in range(4)),depths
                    assert all(depths[i]['unread']>depths[i+1]['unread'] for i in range(4)),depths
                    cssDepth=pg.evaluate("""()=>{
                      const e=document.querySelector('.jfBookPile[data-side="right"]');
                      return {max:getComputedStyle(e).maxWidth,background:getComputedStyle(e).backgroundImage};
                    }""")
                    assert float(cssDepth['max'].replace('px',''))>=29,cssDepth
                    assert 'repeating-linear-gradient' not in cssDepth['background'],cssDepth
                has_static=pg.evaluate("()=>!!window.JFPaperTextures")
                if args.expected_static:
                    assert has_static,'Missing new paper material module'
                    assert pg.evaluate("()=>window.JFPaperTextures.count") == 16
                data=pg.evaluate("""async()=>{
                  const longTasks=[];
                  try{new PerformanceObserver(list=>{
                    for(const e of list.getEntries())longTasks.push({start:e.startTime,duration:e.duration});
                  }).observe({entryTypes:['longtask']});}catch{}
                  const bookId=jfDeskBook.id;
                  const sample=()=> {
                    const a=jfDeskPages[jfDeskPageIndex]||[];
                    const item=a[0], left=document.querySelector('.jfSheet[data-side="left"]');
                    return {key:item?item.chapter+':'+(item.offset||0)+':'+(item.key||''):'',
                      texture:left?.dataset.paperGroup||left?.dataset.paperIndex||'',
                      paired:!!left?.dataset.paperGroup,
                      other:document.querySelector('.jfSheet[data-side="right"]')?.dataset.paperGroup||'',
                      index:jfDeskPageIndex,
                      stackProgress:jfDeskStackState?.progress??null,
                      stackLeft:jfDeskStackState?.readPx??null,
                      stackRight:jfDeskStackState?.unreadPx??null};
                  };
                  const start=sample(), original=start.key;
                  const times=[],frameTimes=[],forward=[],backward=[];
                  const run=async(dir,output)=>{
                    let limit=0;
                    while(output.length<30&&limit<240){
                      limit++;
                      const before=jfDeskPageIndex,t0=performance.now();
                      const ok=jfDeskPageTurn(dir),t1=performance.now();
                      if(ok){
                        await new Promise(resolve=>requestAnimationFrame(resolve));
                        times.push(t1-t0);frameTimes.push(performance.now()-t0);
                        output.push(sample());
                      }else await new Promise(resolve=>setTimeout(resolve,90));
                    }
                  };
                  await run(1,forward);
                  await run(-1,backward);
                  await new Promise(resolve=>setTimeout(resolve,100));
                  return {start,original,after:sample(),forward,backward,
                    js:times,visible:frameTimes,longTasks,
                    heap:performance.memory?.usedJSHeapSize||null,
                    dom:document.querySelectorAll('*').length,
                    staticMaterial:!!window.JFPaperTextures,
                    styleRules:(document.getElementById('jf-paper-static-rules')?.textContent.match(/data:image\\/webp/g)||[]).length};
                }""")
                assert len(data['forward'])==30, 'Not enough forward pages: '+str(len(data['forward']))
                assert len(data['backward'])==30, 'Not enough backward pages: '+str(len(data['backward']))
                assert data['after']['key']==data['start']['key'], '30 back-turns failed to restore the original source'
                if args.expected_static:
                    keys={}
                    for row in [data['start']]+data['forward']+data['backward']:
                        if row['key'] in keys:
                            assert keys[row['key']]==row['texture'], 'Same page changed paper texture'
                        keys[row['key']]=row['texture']
                    assert data['styleRules']==16, 'Offline CSS bank did not contain all sixteen WebPs'
                    assert data['start']['stackProgress'] is not None,'No book-wide stack progress'
                    assert data['forward'][-1]['stackProgress']>data['start']['stackProgress'],(
                        '30 forward turns did not thicken read stack',data['start'],data['forward'][-1])
                    assert data['backward'][-1]['stackProgress']<=data['forward'][-1]['stackProgress'],(
                        'Back turns did not reduce read-stack progress',data['backward'][-1])
                    assert all((x['texture']==x['other']) for x in data['forward']+data['backward'] if x['paired']), 'Wrong left/right pair'
                assert not errors,'Browser exceptions: '+str(errors[:2])
                summary={
                    'build':str(args.build),'staticTextures':data['staticMaterial'],
                    'turnsForward':len(data['forward']),'turnsBackward':len(data['backward']),
                    'jsP50ms':pct(data['js'],.5),'jsP95ms':pct(data['js'],.95),
                    'frameP50ms':pct(data['visible'],.5),'frameP95ms':pct(data['visible'],.95),
                    'longTasks50ms':sum(x['duration']>=50 for x in data['longTasks']),
                    'maxLongTaskMs':round(max((x['duration'] for x in data['longTasks']),default=0),2),
                    'heapBytes':data['heap'],'domNodes':data['dom'],
                    'textureRules':data['styleRules'],'samePageStable':True,
                    'errors':errors}
                if args.expected_static:pg.screenshot(path=str(ROOT/'dist'/'paper-v748-browser.png'),full_page=True)
                if args.output:pathlib.Path(args.output).write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
                print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)
                br.close()
        finally:
            if proc:stop(proc,log)
if __name__=='__main__':main()
