#!/usr/bin/env python3
"""v7.122 real Chromium three-face rendering: verify DOM reuse, text content,
geometry, accessibility, responsiveness and no stale layers across resize.
Synthetic fixture; not a substitute for actual user's EPUB.
"""
import json,pathlib,runpy,tempfile,urllib.request
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop

create_epub=runpy.run_path(str(ROOT/'tests/reader-page-performance-v7119.py'))['create_epub']
def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-reader-face-v7122-') as temp:
        tmp=pathlib.Path(temp);library=tmp/'library';library.mkdir()
        create_epub(library/'face-test.epub',chapters=48)
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',library,tmp/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as reply:
                book=next(x for x in json.load(reply)['books'] if x['name']=='face-test.epub')
            with sync_playwright() as pw:
                browser=pw.chromium.launch(executable_path='/usr/bin/chromium',
                    headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850})
                page.set_default_timeout(70000)
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='domcontentloaded')
                page.wait_for_function("typeof jfDeskOpenReader==='function'")
                page.evaluate('(id)=>jfDeskOpenReader(id,0)',book['id'])
                page.wait_for_function("()=>jfDeskFlow.length>0")
                page.locator('#jfReadPaged').click()
                page.wait_for_function(
                  "()=>jfDeskPaged&&!jfDeskRestoring&&jfDeskFacePool&&jfDeskPages.length>=2")
                # Ensure the real forward prefetch has at least two prepared leaves.
                page.evaluate("jfDeskPagedPrefetch()")
                page.wait_for_function("()=>jfDeskPages.length>=4")
                # A prepared DOM face is bound to an immutable physical leaf.
                # First let asynchronous chapter append finish, otherwise the
                # test captures a face for the obsolete final-leaf revision.
                page.wait_for_function(
                  "()=>!jfDeskPrefetchTask&&!jfDeskForwardInflightAppend()",
                  timeout=40000)
                page.evaluate("jfDeskWarmFaces()")
                page.wait_for_function(
                  "()=>jfDeskFacePool?.slots.some(s=>s.index===jfDeskPageIndex+2)",
                  timeout=20000)
                result=page.evaluate("""async()=>{
                  const frame=()=>new Promise(done=>
                    requestAnimationFrame(()=>requestAnimationFrame(done)));
                  const delay=ms=>new Promise(done=>setTimeout(done,ms));
                  const assertions=[];
                  const check=(test,msg)=>{if(!test)assertions.push(msg);};
                  const visible=()=>{
                    const a=document.getElementById('jfSheetLeft'),
                      b=document.getElementById('jfSheetRight');
                    const aText=a?.textContent||'',bText=b?.textContent||'';
                    const left=document.querySelector('#jfPageView .jfSheet[data-side="left"]');
                    const right=document.querySelector('#jfPageView .jfSheet[data-side="right"]');
                    return {a,b,aText,bText,left,right};
                  };
                  const scan=(label)=>{
                    const v=visible(),slots=jfDeskFacePool?.slots||[];
                    check(!!v.a&&!!v.b,label+': missing active DOM IDs');
                    check(v.aText.trim().length>5,label+': left text empty');
                    check(slots.length===3,label+': unbounded face pool');
                    check(document.querySelectorAll('.jfSheet > .jf-face-buffer').length===6,
                      label+': leaked or missing face nodes');
                    for(const sheet of [v.left,v.right]){
                      const layers=Array.from(sheet.querySelectorAll(':scope > .jf-face-buffer'));
                      check(layers.filter(el=>el.dataset.jfFaceActive==='true').length===1,
                        label+': not exactly one active face');
                      for(const layer of layers){
                        const active=layer.dataset.jfFaceActive==='true';
                        check(layer.inert===!active,label+': inert mismatch');
                        check(layer.getAttribute('aria-hidden')===String(!active),
                          label+': accessibility hidden mismatch');
                        check(getComputedStyle(layer).opacity===(active?'1':'0'),
                          label+': face opacity mismatch');
                      }
                    }
                    return v;
                  };
                  const first=scan('initial');
                  const nextIndex=jfDeskPageIndex+2;
                  const nextSlot=jfDeskFacePool.slots.find(s=>s.index===nextIndex);
                  check(!!nextSlot,'next spread never prepared');
                  const node=nextSlot?.left.firstChild;
                  const pre=JSON.parse(JSON.stringify(jfDeskPaintDiagnostics()));
                  const slotIdentity=nextSlot?.index;
                  const capturedPages=jfDeskPages.slice(0,5);
                  const start=performance.now();
                  document.getElementById('jfReadNext').click();
                  await frame();
                  const after=scan('first prepared next');
                  const firstTurnMs=performance.now()-start;
                  // Idle neighbor warming may legitimately recycle the
                  // captured slot BEFORE the click. Judge the visible ACTIVE
                  // slot and the actual cache hit, not a stale slot reference.
                  const activeSlot=jfDeskFacePool?.slots[jfDeskFacePool.active];
                  check(after.a===activeSlot?.left,'active face DOM ID is not unique');
                  check(activeSlot?.index===nextIndex,'active face index mismatch');
                  check(!!after.a?.firstChild,'active face has no rendered content');
                  check(jfDeskPageIndex===nextIndex,'prepared turn skipped a spread');
                  check(jfDeskPaintDiagnostics().hit>pre.hit,'prepared turn was recorded as a miss');
                  // Two full page bodies stay available for next/previous.
                  const samples=[],empty=[];
                  for(let i=0;i<10;i++){
                    await delay(120);
                    const t=performance.now();
                    document.getElementById('jfReadPrev').click();
                    await frame();scan('cached prev '+i);
                    samples.push(performance.now()-t);
                    if(!visible().aText.trim())empty.push('prev'+i);
                    const u=performance.now();
                    document.getElementById('jfReadNext').click();
                    await frame();scan('cached next '+i);
                    samples.push(performance.now()-u);
                    if(!visible().aText.trim())empty.push('next'+i);
                  }
                  const p95=a=>{a.sort((x,y)=>x-y);return Math.round(
                    a[Math.ceil(a.length*.95)-1]*10)/10;};
                  return {assertions,empty,pre,after:jfDeskPaintDiagnostics(),
                    captured:{slotIndex:slotIdentity,preparedNodePresent:!!node,
                      activeSlot:jfDeskFacePool?.active,
                      slotIndices:jfDeskFacePool?.slots.map(s=>s.index),
                      samePoolSlot:jfDeskFacePool?.slots.includes(nextSlot),
                      slotPageChanged:capturedPages.some((p,i)=>jfDeskPages[i]!==p),
                      visibleIdNode:after.a===nextSlot?.left,
                      actualTextNode:after.a?.firstChild===node,
                      activeFaceIndex:jfDeskFacePool?.slots[jfDeskFacePool?.active]?.index,
                      matchingActiveSlot:jfDeskFacePool?.slots[jfDeskFacePool?.active]===nextSlot,
                      activeLeftHasId:jfDeskFacePool?.slots[jfDeskFacePool?.active]?.left.id,
                      capturedLeftId:nextSlot?.left.id,
                      idOwners:[...document.querySelectorAll('[id="jfSheetLeft"]')]
                        .map(n=>({active:n.dataset.jfFaceActive,
                          matchingNext:n===nextSlot?.left,connected:n.isConnected}))},
                    firstTurnMs:Math.round(firstTurnMs*10)/10,
                    cachedVisualP95Ms:p95(samples),samples:samples.length};
                }""")
                assert not result['assertions'],'Face cache invariants: '+str(result['assertions'][:8])+' state='+str(result['captured'])
                assert not result['empty'],'Empty leaf found: '+str(result['empty'])
                assert result['after']['hit']-result['pre']['hit']>=15,(
                    'Not enough prepared text face reuse: '+str(result))
                # Re-layout (single page / two page) must tear down stale faces.
                page.set_viewport_size({'width':850,'height':812})
                page.wait_for_function("()=>jfDeskFacePool&&jfDeskPagedGeometry().two===false&&"+
                    "jfDeskPagesSig===jfDeskFacePool.signature",timeout=40000)
                single=page.evaluate("""()=>{
                  const els=document.querySelectorAll('.jfSheet > .jf-face-buffer');
                  return {count:els.length,active:document.getElementById('jfSheetLeft')?.textContent.length,
                    rightHidden:document.querySelector('.jfSheet[data-side="right"]').hidden};
                }""")
                assert single['count']==6 and single['active']>5 and single['rightHidden'],(
                    'Single-page resize leaked or missed faces: '+str(single))
                page.set_viewport_size({'width':1386,'height':850})
                page.wait_for_function("()=>jfDeskFacePool&&jfDeskPagedGeometry().two===true&&"+
                    "jfDeskPagesSig===jfDeskFacePool.signature",timeout=40000)
                assert not errors,'Chromium page errors: '+str(errors[:5])
                print('PASS v7.122 Chromium pre-render cache: '+
                    json.dumps({'hit':result['after']['hit'],'miss':result['after']['miss'],
                    'cachedVisualP95Ms':result['cachedVisualP95Ms'],
                    'firstTurnMs':result['firstTurnMs'],
                    'samples':result['samples'],'singlePageResize':single},
                    ensure_ascii=False),flush=True)
                browser.close()
        finally:
            stop(proc,log)
if __name__=='__main__':
    main()
