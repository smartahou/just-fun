#!/usr/bin/env python3
"""v7.121 P0: real Chromium, middle-of-book reverse, complete forward and
exact reverse replay. Isolated EPUB fixture; no user library access.
"""
import json,pathlib,runpy,tempfile,urllib.request
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop

create_epub=runpy.run_path(str(ROOT/'tests/reader-page-performance-v7119.py'))['create_epub']

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v7121-burst-') as temp:
        tmp=pathlib.Path(temp);library=tmp/'library';library.mkdir()
        create_epub(library/'reverse-stress.epub',chapters=110)
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',library,tmp/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as r:
                book=next(x for x in json.load(r)['books']
                    if x['name']=='reverse-stress.epub')
            with sync_playwright() as pw:
                browser=pw.chromium.launch(executable_path='/usr/bin/chromium',
                    headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850})
                page.set_default_timeout(200000)
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='domcontentloaded')
                page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=30000)
                page.evaluate('(id)=>jfDeskOpenReader(id,65)',book['id'])
                page.wait_for_function("()=>jfDeskFlow.some(s=>s.n===65)",timeout=30000)
                page.locator('#jfReadPaged').click()
                page.wait_for_function(
                    "()=>jfDeskPaged&&jfDeskPages.length>0&&!jfDeskRestoring&&"+
                    "jfDeskPublishedSections.includes(65)",timeout=50000)
                result=page.evaluate("""async()=>{
                  const frame=()=>new Promise(resolve=>
                    requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
                  const errors=[],visited=new Set(),delays={back:[],forward:[]};
                  const snapshot=()=>{
                    const first=jfDeskPages[jfDeskPageIndex]?.[0];
                    const left=document.getElementById('jfSheetLeft')?.textContent||'';
                    const right=document.getElementById('jfSheetRight')?.textContent||'';
                    const step=(jfDeskPagedGeometry().two&&jfDeskPages.length>1)?2:1;
                    const min=jfDeskFlow.length?Math.min(...jfDeskFlow.map(s=>s.n)):-1;
                    const max=jfDeskFlow.length?Math.max(...jfDeskFlow.map(s=>s.n)):-1;
                    return {chapter:first?.chapter??null,offset:first?.offset??null,
                      anchor:first?first.chapter+':'+(first.offset||0):null,
                      signature:left+'|'+right,left,right,step,min,max,
                      index:jfDeskPageIndex,rendered:jfDeskPages.length};
                  };
                  const inspect=(snap,stepName)=>{
                    if(!snap.left.trim())errors.push(stepName+': empty left');
                    if(jfReadCenter.classList.contains('jf-reading-opening'))
                      errors.push(stepName+': chapter-opening overlay');
                    for(const m of snap.signature.matchAll(/第(\\d{3})首/g))
                      visited.add(Number(m[1]));
                    if(snap.step===2&&!snap.right.trim()&&
                       (jfDeskNextReadableAfterMounted()>=0||jfDeskForwardInflightAppend()))
                      errors.push(stepName+': speculative blank right leaf');
                  };
                  const go=async(dir,label)=>{
                    const before=snapshot(),started=performance.now();
                    if(dir<0&&before.index===0&&before.min===0)return null;
                    if(dir>0&&jfDeskNextReadableAfterMounted()<0&&!jfDeskForwardInflightAppend()&&
                       before.index>=Math.floor((jfDeskPages.length-1)/before.step)*before.step)
                      return null;
                    document.getElementById(dir>0?'jfReadNext':'jfReadPrev').click();
                    const deadline=performance.now()+14000;
                    let after=snapshot();
                    while(after.anchor===before.anchor&&after.signature===before.signature&&
                          performance.now()<deadline){
                      await pause(30);after=snapshot();
                    }
                    await frame();after=snapshot();
                    if(after.anchor===before.anchor&&after.signature===before.signature)
                      throw Error(label+': turn did not advance after 14s; '+
                        JSON.stringify({before,after,pendingBack:jfDeskBackwardPending,
                          pendingNext:jfDeskForwardPending,backTask:!!jfDeskBackwardTask,
                          nextTask:!!jfDeskForwardTask}).slice(0,900));
                    inspect(after,label);
                    delays[dir>0?'forward':'back'].push(performance.now()-started);
                    return after;
                  };
                  inspect(snapshot(),'start');
                  const openedAt=snapshot().anchor;
                  let backfills=0;
                  for(let i=0;i<120;i++){
                    const snap=await go(-1,'mid-to-start '+i);
                    if(!snap)break;
                    backfills++;
                  }
                  const first=snapshot();
                  if(first.min!==0||first.index!==0)
                    errors.push('did not reach the true first leaf: '+JSON.stringify(first).slice(0,250));
                  // All already-read pages must remain in memory so a backward
                  // turn cannot silently fail due to eviction.
                  const path=[snapshot()];
                  for(let i=0;i<260;i++){
                    const next=await go(1,'start-to-end '+i);
                    if(!next)break;
                    path.push(next);
                  }
                  const atEnd=snapshot();
                  if(atEnd.max<109)errors.push('never loaded final chapter '+atEnd.max);
                  // v7.121: 24 immediate button clicks are intentionally
                  // delivered before the browser has a chance to paint.
                  // Only the final spread should be attached to the DOM.
                  const maxBurst=Math.min(24,Math.floor(atEnd.index/atEnd.step));
                  const imageBefore=snapshot();
                  let paintMutations=0;
                  const leftBody=document.getElementById('jfSheetLeft');
                  const monitor=new MutationObserver(records=>{
                    paintMutations+=records.filter(x=>x.type==='childList'&&
                      x.target===leftBody).length;
                  });
                  monitor.observe(leftBody,{childList:true});
                  for(let i=0;i<maxBurst;i++)
                    document.getElementById('jfReadPrev').click();
                  await frame();
                  const afterBurstBack=snapshot();
                  if(afterBurstBack.index!==imageBefore.index-maxBurst*atEnd.step)
                    errors.push('rapid back burst missed a turn: '+JSON.stringify({
                      before:imageBefore.index,after:afterBurstBack.index,expected:
                      imageBefore.index-maxBurst*atEnd.step}));
                  inspect(afterBurstBack,'rapid backward burst');
                  for(let i=0;i<maxBurst;i++)
                    document.getElementById('jfReadNext').click();
                  await frame();monitor.disconnect();
                  const afterBurstForward=snapshot();
                  if(afterBurstForward.anchor!==imageBefore.anchor)
                    errors.push('rapid forward burst did not restore the exact anchor');
                  if(paintMutations>6)
                    errors.push('rendered intermediate spreads within same frame: '+
                      paintMutations+' DOM commits');
                  inspect(afterBurstForward,'rapid forward burst');
                  let reversed=0;
                  for(let i=path.length-2;i>=0;i--){
                    const next=await go(-1,'reverse replay '+i);
                    if(!next){errors.push('reverse stopped at '+i);break;}
                    // Exactly reconstruct the earlier *physical leaf*, not a
                    // merely decreasing percentage or chapter number.
                    if(next.anchor!==path[i].anchor)
                      errors.push('reverse anchor mismatch '+i+' expected '+
                        path[i].anchor+' got '+next.anchor);
                    reversed++;
                  }
                  const final=snapshot();
                  if(final.anchor!==first.anchor)
                    errors.push('roundtrip anchor mismatch: '+final.anchor+' != '+first.anchor);
                  if(jfDeskPages.length<path.length*2-4)
                    errors.push('previously visited physical leaves were evicted');
                  const sorted=[...visited].sort((a,b)=>a-b);
                  if(sorted.length!==110||sorted.some((n,i)=>n!==i))
                    errors.push('not all 52 poem titles encountered: '+sorted.join(','));
                  const p95=array=>{
                    if(!array.length)return null;
                    const a=[...array].sort((a,b)=>a-b);
                    return Math.round(a[Math.ceil(a.length*.95)-1]*10)/10;
                  };
                  return {openedAt,backfills,spreads:path.length,
                    reversed,loadedChapters:jfDeskFlow.length,
                    seenTitles:sorted.length,rapidBurst:maxBurst,
                    paintMutations,backP95ms:p95(delays.back),
                    forwardP95ms:p95(delays.forward),
                    errors};
                }""")
                assert not errors,'Uncaught browser exceptions: '+str(errors)
                assert not result['errors'],'Real backward navigation failure: '+json.dumps(
                    result['errors'][:8],ensure_ascii=False)
                assert result['backfills']>=45,'Long cold backward run not exercised'
                assert result['rapidBurst']>=20,'24-click bursts were not exercised'
                assert result['spreads']>=25,'Not enough forward pages covered'
                assert result['reversed']==result['spreads']-1,'Reverse playback stopped early'
                print('PASS v7.121 Chromium backward & return: '+
                    json.dumps(result,ensure_ascii=False),flush=True)
                browser.close()
        finally: stop(proc,log)

if __name__=='__main__':
    main()
