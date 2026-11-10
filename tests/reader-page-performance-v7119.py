#!/usr/bin/env python3
"""v7.119 Chromium acceptance: preserve text during deferred turns, avoid
empty future spreads, collect cached-turn visible-frame latency. Isolated fixture.
"""
import json, pathlib, statistics, tempfile, urllib.request, zipfile
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop

def create_epub(dest, chapters=36):
    with zipfile.ZipFile(dest,'w') as z:
        z.writestr('mimetype','application/epub+zip',
                   compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml',
            '<?xml version="1.0"?><container><rootfiles><rootfile '
            'full-path="OEBPS/content.opf"/></rootfiles></container>')
        manifest=''.join('<item id="c%d" href="c%d.xhtml" '
            'media-type="application/xhtml+xml"/>'%(n,n) for n in range(chapters))
        spine=''.join('<itemref idref="c%d"/>'%n for n in range(chapters))
        z.writestr('OEBPS/content.opf',
            '<?xml version="1.0"?><package version="3.0" '
            'xmlns="http://www.idpf.org/2007/opf"><metadata>'
            '<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Paged Bench</dc:title>'
            '</metadata><manifest>'+manifest+'</manifest><spine>'+spine+'</spine></package>')
        for n in range(chapters):
            title='第%03d首'%n
            poem='，'.join([f'云林第{n:03d}章清风明月']*8)+'。'
            paragraph=('这是用于验证连续纸页和文字守恒的评析，不能跳过任何诗歌。'*5)
            body=f'<h2>{title}</h2><p>诗人</p><p>{poem}</p>' + \
                 f'<p>【评析】</p><p>{paragraph}</p><p>【辑评】</p>' + \
                 f'<p>《诗评》此篇第{n:03d}首风格清远，笔法自然。</p>'
            z.writestr('OEBPS/c%d.xhtml'%n,
                '<html xmlns="http://www.w3.org/1999/xhtml"><body>'+
                body+'</body></html>')

def pct(values,p):
    if not values:return None
    a=sorted(values)
    return round(a[min(len(a)-1,int((len(a)-1)*p))],2)

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v7119-') as temp:
        tmp=pathlib.Path(temp)
        library=tmp/'library';library.mkdir()
        create_epub(library/'paged-bench.epub')
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',library,tmp/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as r:
                books=json.load(r)['books']
            book=next(b for b in books if b['name']=='paged-bench.epub')
            with sync_playwright() as pw:
                browser=pw.chromium.launch(executable_path='/usr/bin/chromium',
                    headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850})
                page.set_default_timeout(70000)
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='domcontentloaded')
                page.wait_for_function("typeof jfDeskOpenReader==='function'")
                page.evaluate('(id)=>jfDeskOpenReader(id,0)',book['id'])
                page.wait_for_function("()=>!!jfDeskOutline&&jfDeskFlow.length>0")
                page.locator('#jfReadPaged').click()
                page.wait_for_function(
                  "()=>jfDeskPaged&&jfDeskPages.length>0&&jfDeskPublishedSections.length>0")
                result=page.evaluate("""async()=>{
                  const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
                  const visible=()=>{
                    const left=document.getElementById('jfSheetLeft')?.textContent||'';
                    const right=document.getElementById('jfSheetRight')?.textContent||'';
                    return {left,right,signature:left+'|'+right};
                  };
                  const seen=new Set(),blank=[],turns=[],delayed=[];
                  const scan=()=>{
                    const snap=visible();
                    for(const m of snap.signature.matchAll(/第(\\d{3})首/g))
                      seen.add(Number(m[1]));
                    if(!snap.left.trim())blank.push('left empty at '+jfDeskPageIndex);
                    const step=(jfDeskPagedGeometry().two&&jfDeskPages.length>1)?2:1;
                    if(step===2&&!snap.right.trim()&&
                      (jfDeskNextReadableAfterMounted()>=0||jfDeskForwardInflightAppend()))
                      blank.push('future right empty at '+jfDeskPageIndex);
                    return snap;
                  };
                  scan();
                  // Test the ACTUAL footer button: it used to navigate chapters
                  // and blank the entire reader instead of turning a leaf.
                  const footerBefore=jfDeskPageIndex,footerText=visible().signature;
                  document.getElementById('jfReadNext').click();
                  if(jfReadCenter.classList.contains('jf-reading-opening'))
                    blank.push('footer wrongly entered chapter-opening state');
                  const footerDeadline=performance.now()+18000;
                  while(performance.now()<footerDeadline&&
                        jfDeskPageIndex===footerBefore&&
                        visible().signature===footerText)
                    await new Promise(r=>setTimeout(r,35));
                  await frame();scan();
                  if(jfDeskPageIndex===footerBefore&&
                     visible().signature===footerText)
                    blank.push('footer page turn never made content visible');
                  for(let i=0;i<100;i++){
                    const before=jfDeskPageIndex,old=visible().signature;
                    const started=performance.now();
                    const accepted=jfDeskPageTurn(1);
                    if(!accepted)break;
                    if(jfDeskPageIndex===before&&visible().signature===old){
                      delayed.push(i);
                      const stop=performance.now()+18000;
                      while(performance.now()<stop&&jfDeskPageIndex===before&&
                            visible().signature===old){
                        await new Promise(r=>setTimeout(r,35));
                        if(!jfDeskForwardTask&&jfDeskNextReadableAfterMounted()<0&&
                           !jfDeskForwardInflightAppend())break;
                      }
                    }
                    await frame();
                    const latest=scan();
                    turns.push({at:jfDeskPageIndex,ms:performance.now()-started,
                      text:latest.signature.length});
                    if(jfDeskPageIndex===before&&latest.signature===old&&
                       jfDeskNextReadableAfterMounted()<0&&!jfDeskForwardInflightAppend())break;
                  }
                  const frameMs=[];
                  if(jfDeskPageIndex>=2){
                    for(let i=0;i<12;i++){
                      const before=jfDeskPageIndex;
                      const t=performance.now();
                      const back=jfDeskPageTurn(-1);
                      if(!back||jfDeskPageIndex===before)break;
                      await frame();scan();
                      frameMs.push(performance.now()-t);
                      const forwardAt=performance.now();
                      jfDeskPageTurn(1);await frame();scan();
                      frameMs.push(performance.now()-forwardAt);
                    }
                  }
                  return {seen:[...seen].sort((a,b)=>a-b),blank,turns:turns.length,
                    delayed:delayed.length,frameMs,errors:[],
                    mounted:jfDeskFlow.length,lastIndex:jfDeskPageIndex,
                    chapter:jfDeskChapter,
                    folios:jfDeskVerifiedFolios.length};
                }""")
                assert result['turns']>=6,'No meaningful turns: '+str(result)
                assert not result['blank'],'Premature blank spread: '+str(result['blank'][:5])
                assert result['seen']==list(range(36)),(
                    'Skipped/repeated chapter titles during forward reading: '+str(result['seen']))
                assert result['mounted']<=16,(
                    'Live chapter window grew without safe trimming: '+str(result['mounted']))
                assert not errors,'Browser errors: '+str(errors)
                assert not result['frameMs'] or pct(result['frameMs'],.95)<180,(
                    'Cached-turn Chromium P95 exceeded 180ms regression guard: '+str(result))
                print(json.dumps({
                  'status':'PASS','turns':result['turns'],
                  'chaptersSeen':len(result['seen']),
                  'deferredTurns':result['delayed'],
                  'cachedPaintP50ms':pct(result['frameMs'],.50),
                  'cachedPaintP95ms':pct(result['frameMs'],.95),
                  'cachedPaintSamples':len(result['frameMs']),
                  'mountedChapters':result['mounted'],
                  'blankFrames':len(result['blank'])
                },ensure_ascii=False),flush=True)
                browser.close()
        finally:
            stop(proc,log)
if __name__=='__main__':
    main()
