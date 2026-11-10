#!/usr/bin/env node
'use strict';
// v7.119 · Incremental append, stable source anchors, bounded chapter window,
// no speculative white right leaf, background census yielding.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
assert.equal(require('../package.json').version,'7.121.0');
assert(source.includes('if(jfDeskPaged&&!jfDeskOutline?.nativePdf)return jfDeskPageTurn(delta);'),
  'footer arrows must turn physical pages, never restart chapter loading');
const slice=(begin,end)=>{
  const i=source.indexOf(begin),j=source.indexOf(end,i+begin.length);
  assert(i>=0&&j>i,'Missing source section '+begin);
  return source.slice(i,j);
};
const paged=slice('async function jfDeskPagedLayout(keepPage,reason){',
                  'function jfDeskPageForAnchor(');
const block=n=>({chapter:n,offset:0,key:n+':0',node:{textContent:'第'+n+'章'}});
async function appendTest(){
  const oldPages=[[block(0)],[block(0)],[block(1)],[block(1)]];
  const publish=[],measure=[],scoped=[];
  const view={style:{setProperty(){}},classList:{toggle(){}},
    querySelector(){return {hidden:false};}};
  const context={
    jfDeskPaged:true,jfDeskPageGen:0,jfDeskPageIndex:2,
    jfDeskPages:oldPages.slice(),jfDeskPagesSig:'valid-layout',
    jfDeskPublishedSections:[0,1],jfDeskChapterPages:new Map(),
    jfDeskChapterPageCounts:new Map(),jfDeskVerifiedFolios:[],
    jfDeskMountedFromStart:false,jfDeskCensusRunning:true,
    jfDeskFlow:[0,1,2].map(n=>({n,el:{name:n}})),
    jfDeskBook:{id:'test'},jfDeskOutline:{format:'EPUB',chapters:[{},{},{}]},
    jfDeskFont:18,jfDeskPrefs:{family:'serif'},
    jfReadFamilyMap:{serif:'serif'},
    jfDeskLastPageTurn:0,
    jfDeskPagedGeometry:()=>({two:true,pageW:600,pageH:740,
      padX:45,padY:30,innerH:650}),
    jfDeskLayoutSignature:()=> 'valid-layout',
    jfDeskPrepareImages:async roots=>{scoped.push(roots);},
    jfDeskMeasureHost:()=>({}),
    jfDeskBlocksFor:sec=>[block(sec.n)],
    jfDeskCurrentAnchor:()=>({chapter:1,offset:0}),
    jfDeskPaperOmittedChapter:()=>false,
    jfDeskPaperFirstReadable:()=>0,
    jfDeskRecountBookPages:()=>{},
    jfDeskTrimPagedWindow:()=>{publish.push('trim');},
    jfDeskPagedRender:()=>{publish.push('render');},
    window:{JFPageEngine:{paginate(items){
      measure.push(items.map(x=>x.chapter));
      return [[items[0]],[items[items.length-1]]];
    }}},
    document:{getElementById:()=>view},
    setTimeout:()=>{},Math,Number,Array,Set,Map,Promise,Date
  };
  const layout=vm.runInNewContext(paged+'\njfDeskPagedLayout',context);
  await layout(true,'append');
  assert.deepEqual(Array.from(measure[0]),[1,2],
    'append measures only last unfinished leaf and new section');
  assert.equal(scoped.length,1);
  assert.equal(scoped[0].length,1,'only newly appended chapter images wait');
  assert.equal(scoped[0][0].name,2);
  assert.strictEqual(context.jfDeskPages[0],oldPages[0],
    'completed page object identity is preserved');
  assert.strictEqual(context.jfDeskPages[2],oldPages[2],
    'visible completed page must not be rewritten');
  assert.equal(context.jfDeskPageIndex,2,
    'appending a mixed chapter may not relocate the current spread');
  assert.deepEqual(Array.from(context.jfDeskPublishedSections),[0,1,2]);
  assert.deepEqual(publish,['render']);
  context.jfDeskPageIndex=0;
  context.jfDeskPages=oldPages.slice();
  context.jfDeskPublishedSections=[0,1];
  publish.length=0;
  await layout(true,'append');
  assert.equal(publish.length,0,'unaffected foreground spread never remounted by prefetch');
}

function retainedHistoryTest(){
  assert(!source.includes('function jfDeskTrimPagedWindow('),
    'v7.119 destructive page-window trim must remain disabled until reversible');
  assert(source.includes("if(reason!=='prepend'&&!sameSpread)jfDeskPagedRender();"),
    'async prefetch must not unmount unchanged visible text');
}
function spreadTest(){
  const context={
    jfDeskPages:[[block(0)],[block(0)],[block(1)]],
    jfDeskNextReadableAfterMounted:()=>2,
    jfDeskForwardInflightAppend:()=>null
  };
  const ready=vm.runInNewContext(slice('function jfDeskSpreadReady(index,step){',
    '// v7.103: a forward turn')+'\njfDeskSpreadReady',context);
  assert.equal(ready(2,2),false,'withhold incomplete future spread');
  assert.equal(ready(0,2),true,'fully mounted spread remains available');
  context.jfDeskNextReadableAfterMounted=()=>-1;
  assert.equal(ready(2,2),true,'a genuinely final odd leaf may be displayed');
}
async function censusTest(){
  const sourceSection=slice('async function jfDeskMeasureBook(geo){',
                            'function jfDeskLayoutSignature(geo){');
  const calls=[];
  let yields=0;
  const context={
    window:{JFPageEngine:{paginate(items){
      calls.push(items.map(x=>x.key));return items.length?[items]:[];
    }}},
    document:{createElement:()=>({style:{},appendChild(){},remove(){}}),
      getElementById:()=>({appendChild(){}})},
    jfDeskCensusRunning:false,jfDeskVerifiedFolios:[],jfDeskCensusToken:0,
    jfDeskChapterPageCounts:new Map(),jfDeskBookPages:{exact:false},
    jfDeskBook:{id:'census-test'},jfDeskSession:1,
    jfDeskOutline:{format:'EPUB',chapters:[{}]},jfDeskPagesSig:'layout-A',
    jfDeskPages:[],jfDeskPaged:true,
    jfDeskEnsureBookFonts:async()=>{},
    jfDeskMeasureHost:()=>({replaceChildren(){}}),
    jfDeskIdle:async()=>{yields++;},
    jfDeskWaitReadingIdle:async()=>true,
    jfDeskPaperOmittedChapter:()=>false,
    jfDeskFlowFetch:async()=>'<p>chapter</p>',
    jfDeskFlowSection:()=>({}),jfDeskWaitImages:async()=>{},
    jfDeskBlocksFor:()=>Array.from({length:14},(_,i)=>({
      chapter:0,offset:i*20,key:'0:'+i,node:{textContent:'poem'}
    })),
    jfDeskLayoutSignature:()=> 'layout-A',
    jfDeskRecountBookPages:()=>{},
    jfDeskSavePhysicalFolios:()=>{},
    jfDeskPagedRender:()=>{},jfDeskUpdateProgress:()=>{},
    setTimeout:()=>{},console,Map,Array,Promise,Math,Number
  };
  const census=vm.runInNewContext(sourceSection+'\njfDeskMeasureBook',context);
  await census({innerW:500,innerH:600});
  assert.equal(calls.length,3,'long chapter is paginated in short idle batches');
  assert.deepEqual(calls.map(x=>x.length),[6,12,14],
    'only unfinished leaf carries forward to each six-block batch');
  assert(yields>=4,'yield before chapter and between every measurement batch');
  assert.equal(context.jfDeskVerifiedFolios.length,1,
    'background groups may not fabricate extra physical pages');
}
(async()=>{
  await appendTest();retainedHistoryTest();spreadTest();await censusTest();
  console.log('PASS v7.119: incremental append, stable parity, no blank spreads, sliced idle census');
})().catch(e=>{console.error(e);process.exitCode=1;});
