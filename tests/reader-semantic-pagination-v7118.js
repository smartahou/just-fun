#!/usr/bin/env node
'use strict';
// v7.118: poetry units, strict cited glosses, physical continuation and no
// reconstructed/estimated folios. This test has no browser/network dependency.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const reader=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
const pkg=require('../package.json');
assert.equal(pkg.version,'7.119.0');
function segment(source,a,b){
  const i=source.indexOf(a),j=source.indexOf(b,i+a.length);
  assert(i>=0&&j>i,'Missing source boundary '+a);
  return source.slice(i,j);
}
const tag=vm.runInNewContext(segment(reader,'function jfDeskTagPoetryLeads(blocks){','function jfDeskBlocksFor(sec){')+
  '\njfDeskTagPoetryLeads',{String,Array,Number});
const node=(tagName,text,classes='')=>({
  tagName,textContent:text,className:classes,dataset:{},
  querySelector:()=>null,
  classList:{added:new Set(),add(v){this.added.add(v);}}
});
const blocks=[
  {node:node('H2','蝉')},
  {node:node('P','李商隐')},
  {node:node('P','本以高难饱，徒劳恨费声。五更疏欲断，一树碧无情。')},
  {node:node('P','【评析】')},
  {node:node('P','《唐诗镜》语虽浅近。')}
];
tag(blocks);
assert.equal(blocks[0].node.dataset.jfPoetryKeep,'3',
  'poem title, author and complete verse must be measured together');
assert(blocks[0].node.classList.added.has('jfPrintPoetryLead'));
assert(!blocks[3].node.classList.added.has('jfPrintPoetryLead'),
  'commentary heading must never be classified as a poetry title');
const classify=vm.runInNewContext(segment(reader,
  'function jfDeskIsSourceCommentaryTable(node){','// v7.67 ·')+
  '\njfDeskIsSourceCommentaryTable',{String,Array,Number,Math});
const table=(...pairs)=>({
  tagName:'TABLE',querySelector:()=>null,
  rows:pairs.map(([a,b])=>({cells:[a,b].map(textContent=>({
    textContent,colSpan:1,rowSpan:1
  }))}))
});
assert(classify(table(['《唐诗镜》','语虽浅近，致各自成。'],
                      ['《养一斋诗话》','短评'])),
  'short annotated rows must not force a legitimate table fallback');
assert(!classify(table(['《唐诗镜》','短评'],['项目','数据说明文字'])),
  'mixed purpose data tables remain original tables');
assert(!classify(table(['名称','内容说明'],['编号','说明文字'])),
  'ordinary tables remain untouched');
assert(engine.includes("var poetryKeep=Number(el.dataset?.jfPoetryKeep)||0"),
  'page engine must look ahead at the entire poetry unit');
assert(engine.includes('columnHeight(unit,host)<=pageH-EPS'),
  'only groups fitting a fresh physical leaf may stay atomic');
assert(engine.includes('fresh<=pageH-EPS'),
  'oversized commentary must not force blank pages');
assert(reader.includes('jfDeskTagPoetryLeads(blocks);'),
  'printed clone construction must tag units, including the physical census');

const censusSource=segment(reader,'async function jfDeskMeasureBook(geo){',
                            'function jfDeskLayoutSignature(geo){');
const pageCalls=[];
const context={
  window:{JFPageEngine:{paginate(items){pageCalls.push(items.map(x=>x.chapter));
    return items.length?[items]:[];}}},
  document:{createElement:()=>({style:{},appendChild(){},remove(){}}),
    getElementById:()=>({appendChild(){}})},
  jfDeskCensusRunning:false,jfDeskVerifiedFolios:[],jfDeskCensusToken:0,
  jfDeskChapterPageCounts:new Map(),jfDeskBookPages:{exact:false},
  jfDeskBook:{id:'poetry-fixture'},jfDeskSession:1,
  jfDeskOutline:{format:'EPUB',chapters:[{},{}]},
  jfDeskPagesSig:'layout-A',jfDeskPages:[],jfDeskPaged:true,
  jfDeskEnsureBookFonts:async()=>{},jfDeskMeasureHost:()=>({replaceChildren(){}}),
  jfDeskIdle:async()=>{},jfDeskWaitReadingIdle:async()=>true,
  jfDeskPaperOmittedChapter:()=>false,
  jfDeskFlowFetch:async()=>'<p>source</p>',
  jfDeskFlowSection:()=>({}),jfDeskWaitImages:async()=>{},
  jfDeskBlocksFor:({n})=>[{chapter:n,offset:0,key:n+':0',
    node:{textContent:'source'}}],
  jfDeskLayoutSignature:()=> 'layout-A',
  jfDeskRecountBookPages:()=>{},
  jfDeskSavePhysicalFolios:()=>{},
  jfDeskPagedRender:()=>{},jfDeskUpdateProgress:()=>{},
  setTimeout:()=>{},console,Map,Array,Promise,Math,Number,
};
const census=vm.runInNewContext(censusSource+'\njfDeskMeasureBook',context);
(async()=>{
  await census({innerW:500,innerH:600});
  assert.deepEqual(pageCalls.map(x=>Array.from(x)),[[0],[0,1]],
    'the last physical leaf must be carried into the next EPUB section');
  assert.equal(context.jfDeskVerifiedFolios.length,1,
    'two short chapters fit one real physical page');
  assert.equal(context.jfDeskChapterPageCounts.get(0),1);
  assert.equal(context.jfDeskChapterPageCounts.get(1),0,
    'the mixed leaf must only be counted once');
  assert(reader.includes('jfDeskLoadPhysicalFolios();'));
  assert(reader.includes('jfDeskExactPhysicalFolio(pageA0,jfDeskPageIndex)'));
  console.log('PASS v7.118: poetry grouping, citation classification, carried folio census');
})().catch(e=>{console.error(e);process.exitCode=1;});
