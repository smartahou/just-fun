#!/usr/bin/env node
'use strict';
// v7.103 — reproduce the user's "next stuck until I go previous then next":
// a physical spread is the last one in the *mounted* chapter window, while
// the next EPUB chapter is loading asynchronously.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../src/client/scripts/99-reading.js'),'utf8');
const part=(a,b)=>{
  const start=src.indexOf(a),end=src.indexOf(b,start+a.length);
  assert(start>=0&&end>start,'missing navigation section: '+a);
  return src.slice(start,end);
};
const navigation=part('function jfDeskNextReadableAfterMounted(){','async function jfDeskPagedToggle(){');
const append=part('const jfDeskAppendTasks=new Map();','async function jfDeskFlowPrepend(');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function testReader(chapters=4,omitted=[]){
  const jobs=new Map(),paints=[];
  let reader;
  const ctx={
    Math,Date,Promise,Map,Set,console,
    jfDeskPaged:true,jfReader:{hidden:false},
    jfDeskBook:{id:'old-book'},jfDeskSession:1,
    jfDeskOutline:{chapters:Array.from({length:chapters},(_,i)=>({paperOmit:omitted.includes(i)}))},
    jfDeskFlow:[{n:0}],jfDeskPages:[[{chapter:0}],[{chapter:0}]],jfDeskPageIndex:0,
    jfDeskAppendTasks:new Map(),
    jfDeskLastPageTurn:0,jfDeskBackfillBusy:false,
    jfDeskPagedGeometry:()=>({two:true}),
    jfDeskPaperOmittedChapter:n=>omitted.includes(n),
    jfDeskPagedRender:direction=>paints.push({index:ctx.jfDeskPageIndex,direction}),
    jfDeskPagedLayout:async()=>{},
    jfDeskMessage:message=>paints.push({error:message}),
    jfDeskFlowAppend(n){
      if(jobs.has(n))return jobs.get(n).promise;
      let complete;
      const promise=new Promise(resolve=>{complete=()=>{
        if(!ctx.jfDeskFlow.some(x=>x.n===n))ctx.jfDeskFlow.push({n});
        ctx.jfDeskPages.push([{chapter:n}],[{chapter:n}]);resolve(true);};});
      ctx.jfDeskAppendTasks.set(ctx.jfDeskSession+'#'+ctx.jfDeskBook.id+'#'+n,promise);
      promise.finally(()=>ctx.jfDeskAppendTasks.delete(ctx.jfDeskSession+'#'+ctx.jfDeskBook.id+'#'+n));
      jobs.set(n,{promise,complete});
      return promise;
    },
    jfDeskFlowPrepend:async()=>false
  };
  reader=vm.runInNewContext(navigation+'\n({turn:jfDeskPageTurn,forward:()=>jfDeskForwardPending,reset:()=>{jfDeskForwardGeneration++;jfDeskForwardPending=0;jfDeskForwardTask=null;}})',ctx);
  return {ctx,jobs,paints,reader};
}
(async()=>{
  {
    const r=testReader(3);
    // The first and second right presses must survive a delayed chapter fetch.
    assert.equal(r.reader.turn(1),true);
    assert.equal(r.reader.turn(1),true);
    assert.equal(r.ctx.jfDeskPageIndex,0,'must not falsely advance before fetch');
    assert(r.jobs.has(1),'next should actively fetch the missing chapter');
    r.jobs.get(1).complete(); await tick();
    assert.equal(r.ctx.jfDeskPageIndex,2,'first pending turn is committed');
    assert(r.jobs.has(2),'next chapter was prefetched and second turn queued');
    r.jobs.get(2).complete();await tick();
    assert.equal(r.ctx.jfDeskPageIndex,4,'second pending turn is committed');
    assert.deepEqual(r.paints.map(x=>x.index),[2,4],'exactly once, no skipped spreads');
  }
  {
    // The next section was already mounted, but its async pagination has not
    // published a spread yet. This is the narrower race that produced false EOF.
    const r=testReader(2);
    r.ctx.jfDeskFlowAppend(1); // prefetch still unresolved
    r.ctx.jfDeskFlow.push({n:1}); // DOM insertion raced ahead of layout commit
    assert.equal(r.reader.turn(1),true,'in-flight mounted chapter is not final book');
    r.jobs.get(1).complete();await tick();
    assert.equal(r.ctx.jfDeskPageIndex,2,'deferred next commits after pending layout');
    assert.deepEqual(r.paints.map(x=>x.index),[2]);
  }
  {
    const r=testReader(3);
    r.reader.turn(1);
    assert(r.reader.forward()>0);
    r.reader.turn(-1); // user changed their mind while next chapter was loading
    r.jobs.get(1).complete();await tick();
    assert.equal(r.ctx.jfDeskPageIndex,0,'previous cancels deferred forward navigation');
    assert.equal(r.paints.length,0,'no surprise future turn');
  }
  {
    const r=testReader(3);
    r.reader.turn(1);
    r.ctx.jfDeskSession=2;r.ctx.jfDeskBook={id:'new-book'};
    r.reader.reset();r.jobs.get(1).complete();await tick();
    assert.equal(r.ctx.jfDeskPageIndex,0,'stale book result cannot navigate new session');
    assert.equal(r.paints.length,0);
  }
  {
    const r=testReader(1);
    assert.equal(r.reader.turn(1),false,'real last page stays put');
    assert.equal(r.jobs.size,0,'no out-of-range fetch');
  }
  {
    const r=testReader(4,[1,2]);
    r.reader.turn(1);
    assert(r.jobs.has(3),'omitted front matter is skipped in next-chapter search');
    r.jobs.get(3).complete();await tick();
    assert.equal(r.ctx.jfDeskPageIndex,2);
  }
  {
    // Two callers (preload and next) must join the same append, which resolves
    // only AFTER its replacement page list has been published.
    let fetches=0,layouts=0,commitLayout;
    const ctx={Map,Promise,jfDeskBook:{id:'A'},jfDeskSession:1,
      jfDeskPaged:true,jfDeskPages:[],jfDeskFlow:[],
      jfDeskBackfillBusy:false,jfDeskBackwardTask:null,
      jfDeskPublishedSections:[],
      jfDeskPaperOmittedChapter:()=>false,
      jfDeskFlowFetchOnce:async()=>{fetches++;return '<p>next</p>';},
      jfDeskFlowSection:n=>({n}),
      jfReadText:{append(){}},
      jfDeskPagedLayout:()=>new Promise(resolve=>{
        layouts++;commitLayout=()=>{ctx.jfDeskPages.push([{chapter:1}]);resolve();};
      })};
    const nav=vm.runInNewContext(append+'\n({append:jfDeskFlowAppend})',ctx);
    const p=nav.append(1),q=nav.append(1);
    assert.strictEqual(p,q,'same promise for in-flight chapter');
    await tick();
    assert.equal(fetches,1);assert.equal(layouts,1);
    let settled=false;p.then(()=>{settled=true;});
    await tick();assert(!settled,'append must await page-list commit');
    commitLayout();await p;
    assert(settled,'caller sees fully built chapter');
  }
  assert(src.includes('if(delta<0){jfDeskForwardPending=0;jfDeskForwardBusy(false);}'),'reverse turn must cancel pending next');
  assert(src.includes("await jfDeskPagedLayout(true,'append')"),'append layout must be awaited');
  console.log('PASS v7.103: delayed next, rapid double-next, previous cancellation, stale book guard, omitted chapters, last page and shared append');
})().catch(e=>{console.error(e);process.exitCode=1});
