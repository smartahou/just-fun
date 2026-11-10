#!/usr/bin/env node
'use strict';
// v7.120 P0 navigation: two rapid reverse taps from a restored middle chapter
// must both complete, keep printed history and never use a stale book result.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../src/client/scripts/99-reading.js'),'utf8');
assert.equal(require('../package.json').version,'7.121.0');
assert(!src.includes('function jfDeskTrimPagedWindow('),
  'destructive front-page eviction must remain disabled');
assert(src.includes("if(reason!=='prepend'&&!sameSpread)jfDeskPagedRender();"),
  'prefetch does not reparent an unchanged sheet');
assert(src.includes('return jfDeskQueueBackwardTurn();'),
  'back boundary must enter the real asynchronous backward queue');
assert(src.includes('jfDeskChapterCacheKey(bookId,session,n)'),
  'chapter HTML cache must be scoped by session');
const begin=src.indexOf('let jfDeskBackwardPending=0,');
const end=src.indexOf('function jfDeskPageTurn(delta){',begin);
assert(begin>0&&end>begin);
const queueSource=src.slice(begin,end);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const pages=[[{chapter:20,offset:0,key:'20:0',node:{textContent:'二十'}}],
               [{chapter:20,offset:20,key:'20:1',node:{textContent:'正文'}}]];
  const fetches=[],paints=[],controls={};
  const button={classList:{toggle(name,v){controls[name]=v;}},
    setAttribute(name,v){controls[name]=v;}};
  const ctx={
    Math,Date,Map,Set,Promise,
    document:{getElementById:()=>button},
    jfDeskPaged:true,jfReader:{hidden:false},
    jfDeskBook:{id:'book'},jfDeskSession:1,
    jfDeskPageIndex:0,jfDeskPages:pages,
    jfDeskFlow:[{n:20}],jfDeskPublishedSections:[20],
    jfDeskBackfillBusy:false,jfDeskLastPageTurn:0,
    jfDeskPagedGeometry:()=>({two:true}),
    jfDeskPaperOmittedChapter:()=>false,
    jfDeskPageForAnchor:(all,chapter,offset)=>{
      for(let i=0;i<all.length;i++)
        if(all[i].some(b=>b.chapter===chapter))return i;
      return 0;
    },
    jfDeskSpreadStamp:(index,step)=>ctx.jfDeskPages.slice(index,index+step)
      .flatMap(page=>(page||[]).map(b=>b.chapter+':'+b.offset)).join('|'),
    jfDeskPagedRender:direction=>paints.push({chapter:ctx.jfDeskPages[ctx.jfDeskPageIndex]?.[0]?.chapter,direction}),
    jfDeskPaintTurn:direction=>paints.push({chapter:ctx.jfDeskPages[ctx.jfDeskPageIndex]?.[0]?.chapter,direction}),
    jfDeskPrefetchPreviousHtml:()=>{},
    jfDeskMessage:()=>{},
    jfDeskFlowPrepend(n){
      return new Promise(resolve=>{
        fetches.push({n,complete(){
          ctx.jfDeskFlow.unshift({n});
          ctx.jfDeskPublishedSections.unshift(n);
          ctx.jfDeskPages.unshift(
            [{chapter:n,offset:0,key:n+':0',node:{textContent:'诗'+n}}],
            [{chapter:n,offset:20,key:n+':1',node:{textContent:'评'+n}}]);
          ctx.jfDeskPageIndex+=2;
          resolve(true);
        }});
      });
    }
  };
  const api=vm.runInNewContext(queueSource+
    '\n({turn:jfDeskQueueBackwardTurn,pending:()=>jfDeskBackwardPending,'+
    'task:()=>jfDeskBackwardTask})',ctx);
  return {api,ctx,fetches,paints,controls};
}
(async()=>{
  const r=fixture();
  assert.equal(r.api.turn(),true);
  assert.equal(r.api.turn(),true,'rapid second back tap is accepted, not silently lost');
  assert.equal(r.fetches.length,1,'only first predecessor request in flight');
  assert.equal(r.ctx.jfDeskPageIndex,0,'current printed content retained during network wait');
  assert.equal(r.controls['aria-busy'],'true');
  r.fetches[0].complete();
  await tick();
  assert.equal(r.fetches.length,2,'the second tap loads another previous chapter');
  assert.equal(r.paints[0].chapter,19);
  r.fetches[1].complete();
  await tick();await tick();
  assert.deepEqual(r.paints.map(p=>p.chapter),[19,18],
    'exactly two reverse turns, no skip, duplicate or lost click');
  assert.equal(r.ctx.jfDeskPageIndex,0);
  assert.equal(r.ctx.jfDeskPages.length,6,'all previously read pages still exist');
  assert.equal(r.controls['aria-busy'],'false');
  assert.equal(r.api.pending(),0);

  const stale=fixture();
  assert.equal(stale.api.turn(),true);
  stale.ctx.jfDeskSession=2;stale.ctx.jfDeskBook={id:'new book'};
  stale.fetches[0].complete();
  await tick();await tick();
  assert.equal(stale.paints.length,0,'stale EPUB may not turn a new book');
  console.log('PASS v7.120: queued reverse at mid-book, retained source history, same-spread paint gate, stale-book guard');
})().catch(e=>{console.error(e);process.exitCode=1;});
