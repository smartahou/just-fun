#!/usr/bin/env node
'use strict';
// v7.117: XHTML boundaries may share a physical leaf. Preserve chapter
// ownership, verify pagination called ONCE for the mounted window and prohibit
// legacy independent-chapter census from publishing incorrect exact folios.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const start=source.indexOf('async function jfDeskPagedLayout(keepPage,reason){');
const end=source.indexOf('function jfDeskPageForAnchor(',start);
assert(start>=0&&end>start);
const pkg=require('../package.json');
assert.equal(pkg.version,'7.122.0');
const calls=[];
let rendered=0;
const leaf=[
  {chapter:2,node:{textContent:'早秋'},key:'2:0',offset:0},
  {chapter:3,node:{textContent:'蝉'},key:'3:0',offset:0}
];
const view={
  style:{setProperty(){}},classList:{toggle(){}},
  querySelector(){return {hidden:false};}
};
const ctx={
  window:{JFPageEngine:{paginate(blocks){calls.push(blocks);return [leaf];}}},
  document:{getElementById:()=>view},
  jfDeskPaged:true,jfDeskPageGen:0,jfDeskPages:[],
  jfDeskVerifiedFolios:[],jfDeskMountedFromStart:false,
  jfDeskFont:18,jfDeskPrefs:{family:'serif'},jfReadFamilyMap:{serif:'serif'},
  jfDeskPagesSig:'same',jfDeskChapter:2,jfDeskPageIndex:0,
  jfDeskFlow:[{n:2,el:{}},{n:3,el:{}}],
  jfDeskChapterPages:new Map(),jfDeskChapterPageCounts:new Map(),
  jfDeskCensusToken:0,jfDeskCensusRunning:false,
  jfDeskPaperOmittedChapter:()=>false,
  jfDeskPaperFirstReadable:()=>0,
  jfDeskPagedGeometry:()=>({pageW:500,pageH:700,padX:20,padY:20,innerH:600,two:false}),
  jfDeskPrepareImages:async()=>{},
  jfDeskPublishedSections:[],
  jfDeskMeasureHost:()=>({}),
  jfDeskLayoutSignature:()=> 'same',
  jfDeskBlocksFor:sec=>[{chapter:sec.n,node:{},key:sec.n+':0',offset:0}],
  jfDeskRecountBookPages:()=>{},
  jfDeskTrimPagedWindow:()=>{},
  jfDeskMeasureBook:async()=>{},
  jfDeskCurrentAnchor:()=>null,
  jfDeskPagedRender:()=>{rendered++;},
  jfDeskBook:{id:1},jfDeskOutline:{chapters:[{},{},{},{}]},
  Math,Map,Set,Array,Promise,console
};
const run=vm.runInNewContext(source.slice(start,end)+'\n jfDeskPagedLayout',ctx);
(async()=>{
  await run(true,'append');
  assert.equal(calls.length,1,'two EPUB chapters must enter one physical pagination pass');
  assert.deepEqual(Array.from(calls[0],b=>b.chapter),[2,3],
    'source order and original chapter ids preserved');
  assert.equal(ctx.jfDeskPages.length,1,'one mixed leaf rather than two half-blank leaves');
  assert.equal(ctx.jfDeskChapterPages.get(2).length,1,'leaf belongs to its first chapter');
  assert.equal(ctx.jfDeskChapterPages.has(3),false,'shared leaf counted once, not twice');
  assert.equal(ctx.jfDeskChapterPageCounts.size,0,
    'mid-book window cannot claim exact whole-book chapter page counts');
  assert.equal(rendered,1);
  assert(source.includes('carry.concat(blocks.slice(at,at+6))'),
    'physical census is now continuous and carries the final leaf');
  assert(source.includes('page.some(block=>block.chapter===n)'),
    'append must recognize the chapter inside a mixed leaf');
  assert(source.includes('right.dataset.running=pageB.length?runningTitle(pageB)'),
    'each leaf must use its own chapter running head');
  console.log('PASS v7.117: continuous mounted chapters, mixed leaf count, anchor metadata and safe folio policy');
})().catch(e=>{console.error(e);process.exitCode=1;});
