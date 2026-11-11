#!/usr/bin/env node
'use strict';
// v7.111: exact folios, cache isolation, and progress independent of census.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const pkg=require('../package.json');
const [major,minor]=pkg.version.split('.').map(Number);
assert(major>7||(major===7&&minor>=111),'exact folio contract must survive later releases');
const counts=new Map(),db=new Map();
const store={getItem(k){return db.has(k)?db.get(k):null},
  setItem(k,v){db.set(k,v)}};
const context={
  jfDeskOutline:{chapters:Array.from({length:8})},
  jfDeskBook:{id:'user-book-1'},jfDeskPagesSig:'book-1|font-400|1360x840',
  jfDeskChapterPageCounts:counts,jfDeskBookPages:null,
  jfDeskPaperOmittedChapter:n=>n===0,
  jfDeskPaperFirstReadable:()=>1,
  jfDeskFlow:[{n:4,el:{textContent:'x'.repeat(900)}},
              {n:5,el:{textContent:'x'.repeat(1600)}}],
  localStorage:store,Number,Math,JSON,Array,String
};
const start=js.indexOf('function jfDeskRecountBookPages(){');
const end=js.indexOf('// Background census:',start);
assert(start>=0&&end>start);
const model=vm.runInNewContext(js.slice(start,end)+
  '\n({recount:jfDeskRecountBookPages,before:jfDeskPagesBefore,progress:jfDeskStableReadingProgress,save:jfDeskSaveFolioCounts,load:jfDeskLoadFolioCounts,cacheKey:jfDeskFolioCacheKey,rev:jfDeskFolioCacheRevision})',context);
assert.equal(model.before(4),null,'unknown prefix never becomes an exact folio');
assert.equal(model.recount().exact,false);
const mid=model.progress(4,450);
assert(Math.abs(mid-3.5/7)<1e-9,'progress uses readable chapter and text anchor');
for(const [n,size] of [[1,7],[2,11],[3,5],[4,8]])counts.set(n,size);
assert.equal(model.before(4),23,'only actual chapter page counts contribute');
assert.equal(model.before(5),31,'folio positions derive from prior physical pages');
model.recount();
assert.equal(model.progress(4,450),mid,'partial census cannot change percent');
const saved=db.get(model.cacheKey());
assert(saved,'verified page counts persisted');
const savedData=JSON.parse(saved);
assert.equal(savedData.version,'v7.123.0');
assert.equal(savedData.layout,'book-1|font-400|1360x840');
assert.equal(savedData.chapters,8);
counts.clear();
assert.equal(model.before(4),null,'fresh session first has unknown folios');
assert.equal(model.load(),4,'four measured chapters restored; omitted chapter zero is derived');
assert.equal(model.before(4),23,'same book and layout gives identical folios on reopen');
assert.equal(model.progress(4,450),mid,'reopening does not change percent');
assert(model.progress(4,200)<mid,'backwards text offset decreases percent');
assert(model.progress(5,300)>mid,'forward chapter increases percent');
context.jfDeskPagesSig='book-1|font-400|1024x768';
counts.clear();
assert.equal(model.load(),0,'viewport geometry invalidates cached counts');
assert.equal(model.before(4),null,'changed geometry must not show stale folio');
context.jfDeskPagesSig='book-1|font-600|1360x840';
assert.equal(model.load(),0,'font change invalidates counts');
context.jfDeskPagesSig='book-1|font-400|1360x840';
context.jfDeskBook={id:'different-book'};
assert.equal(model.load(),0,'different book cannot share page counts');
context.jfDeskBook={id:'user-book-1'};
let malicious=JSON.parse(saved);
malicious.counts.push([-2,99],[999,900],[2,-99],[3,2.5]);
db.set(model.cacheKey(),JSON.stringify(malicious));
counts.clear();
assert.equal(model.load(),4,'corrupted cache entries are ignored');
const folioStart=js.indexOf('function jfDeskPagedRender(direction){');
const folio=js.slice(folioStart,js.indexOf('let jfDeskTurnTimer=0;',folioStart));
assert(folio.includes('const leftPageNumber=jfDeskExactPhysicalFolio(pageA0,jfDeskPageIndex);'),
  'physical folios must be resolved from exact starts, not per-chapter estimates');
assert(js.includes('function jfDeskExactPhysicalFolio(page,mountedIndex)'),
  'a mounted leaf without a certified global start cannot claim exact digits');
assert(folio.includes("leftSheet.dataset.page=exactNumber?String(leftPageNumber):''"),
  'unmeasured leaf must have no printed digits');
assert(folio.includes("rightSheet.dataset.page=rightPageNumber!=null?String(rightPageNumber):''"));
assert(folio.includes("const progress=jfDeskStableReadingProgress(chapterOfPage,pageA0[0]?.offset)"),
  'one text-anchor percent drives footer and paper stack');
assert(!folio.includes('estimatedNumber')&&!folio.includes('jfDeskStabilizeBookProgress'),
  'old guessed folios and percentage max-mask removed');
assert(css.includes(".jfSheet[data-folio-exact='false']::before{content:none!important}"),
  'unmeasured page numbers are never visible');
assert(css.includes("font-family:'JustFun Book Serif CN','Source Han Serif SC'"),
  'physical folios use embedded user-supplied book serif');
assert(js.includes('jfDeskLoadFolioCounts();'),'layout reads matched cached counts');
assert(js.includes('jfDeskFolioCacheRevision,jfDeskBookFontVersion'),
  'layout signature includes revision and font identity');
console.log('PASS v7.111: exact folios, no false digits, reopen cache, viewport/font/book isolation, anchor-based progress');
