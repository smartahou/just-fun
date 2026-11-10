#!/usr/bin/env node
'use strict';
// v7.121: prepend must be O(new prefix + one seam leaf), not O(all mounted
// chapters). A same-frame burst must produce one printed DOM commit.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/client/scripts/99-reading.js'),'utf8');
assert.equal(require('../package.json').version,'7.122.0');
function part(a,b){
  const i=source.indexOf(a),j=source.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'missing '+a);return source.slice(i,j);
}
const b=n=>({chapter:n,offset:0,key:n+':0',node:{textContent:'诗'+n}});
async function prependTest(){
  const original=[[b(20)],[b(20)],[b(21)],[b(21)]],seen=[],paints=[];
  const view={style:{setProperty(){}},classList:{toggle(){}},
    querySelector:()=>({hidden:false})};
  const ctx={
    jfDeskPaged:true,jfDeskPageGen:0,jfDeskPageIndex:0,
    jfDeskPages:original.slice(),jfDeskPagesSig:'layout',
    jfDeskPublishedSections:[20,21],jfDeskChapterPages:new Map(),
    jfDeskChapterPageCounts:new Map(),jfDeskVerifiedFolios:[],
    jfDeskMountedFromStart:false,jfDeskCensusRunning:true,
    jfDeskFlow:[18,19,20,21].map(n=>({n,el:{name:n}})),
    jfDeskBook:{id:'book'},jfDeskOutline:{format:'EPUB',chapters:Array.from({length:22},()=>({}))},
    jfDeskFont:18,jfDeskPrefs:{family:'serif'},jfReadFamilyMap:{serif:'serif'},
    jfDeskLastPageTurn:0,
    jfDeskPagedGeometry:()=>({two:true,pageW:600,pageH:740,padX:50,padY:30,innerH:650}),
    jfDeskLayoutSignature:()=> 'layout',
    jfDeskPrepareImages:async roots=>{
      assert.equal(roots.length,2,'only two newly prepended chapter images checked');
      assert.deepEqual(roots.map(r=>r.name),[18,19]);
    },
    jfDeskMeasureHost:()=>({}),
    jfDeskBlocksFor:sec=>{
      assert(sec.n<20,'existing published chapters may not be re-cloned');
      return [b(sec.n)];
    },
    jfDeskCurrentAnchor:()=>({chapter:20,offset:0}),
    jfDeskPaperOmittedChapter:()=>false,
    jfDeskPaperFirstReadable:()=>0,jfDeskRecountBookPages:()=>{},
    jfDeskPageForAnchor:(pages,chapter)=>{
      for(let i=0;i<pages.length;i++)if(pages[i].some(x=>x.chapter===chapter))return i;
      return 0;
    },
    jfDeskPagedRender:()=>paints.push('paint'),
    window:{JFPageEngine:{paginate(items){
      seen.push(items.map(x=>x.chapter));
      return items.map(x=>[x]);
    }}},
    document:{getElementById:()=>view},
    setTimeout:()=>{},clearTimeout:()=>{},Math,Number,Array,Set,Map,Promise,Date
  };
  const run=vm.runInNewContext(part('async function jfDeskPagedLayout(keepPage,reason){',
    'function jfDeskPageForAnchor(')+'\njfDeskPagedLayout',ctx);
  await run(true,'prepend');
  assert.deepEqual(Array.from(seen[0]),[18,19,20],
    'recompute new chapter prefix and ONE previous first leaf only');
  assert.strictEqual(ctx.jfDeskPages[3],original[1],
    'all following physical leaves retain their original object references');
  assert.strictEqual(ctx.jfDeskPages[4],original[2]);
  assert.equal(ctx.jfDeskPages.length,6);
  assert.deepEqual(paints,[],'prepending must not flash an intermediate spread');
  assert.equal(ctx.jfDeskPageIndex,2,
    'original source anchor remains available after prepending');
}
function burstTest(){
  const callbacks=[],paints=[];
  const ctx={
    requestAnimationFrame:fn=>{callbacks.push(fn);return callbacks.length;},
    jfDeskPagedRender:direction=>paints.push(direction),
    jfDeskPaged:true,jfReader:{hidden:false},jfDeskSession:2,
    jfDeskBook:{id:'same-book'}
  };
  const painter=vm.runInNewContext(part('let jfDeskPaintFrame=0,',
    'function jfDeskQueueForwardTurn(){')+'\njfDeskPaintTurn',ctx);
  for(let i=0;i<75;i++)painter(i%2?'prev':'next');
  assert.equal(callbacks.length,1,'75 turns inside a frame must schedule ONE paint');
  assert.equal(paints.length,0,'no intermediate DOM replacement before frame');
  callbacks.shift()();
  assert.deepEqual(paints,['next'],'last requested direction committed once');
  painter('prev');
  assert.equal(callbacks.length,1);
  ctx.jfDeskSession=3;
  callbacks.shift()();
  assert.deepEqual(paints,['next'],'stale frame cannot paint a new book/session');
}
(async()=>{await prependTest();burstTest();
  console.log('PASS v7.121: incremental reverse seam, immutable history, one paint per frame, stale-frame guard');
})().catch(e=>{console.error(e);process.exitCode=1;});
