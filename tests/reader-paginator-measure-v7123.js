#!/usr/bin/env node
'use strict';
// v7.123 deterministic DOM-probe unit test: 60 short blocks, six physical
// leaves. Count exact assembled-height probes and make sure no normal fitting
// paragraph triggers a second isolated height/layout pass.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const text=fs.readFileSync(path.join(__dirname,'../src/client/scripts/98d-page-engine.js'),'utf8');
assert(Number(require('../package.json').version.split('.')[1])>=126,'batched-pagination baseline preserved');
class Node {
  constructor(textContent,tagName='P'){
    this.textContent=textContent;this.tagName=tagName;
    this.classList={contains:()=>false};
  }
  cloneNode(){return new Node(this.textContent,this.tagName);}
  getBoundingClientRect(){return {height:10};}
}
class Host {
  constructor(){this.childNodes=[];}
  get firstChild(){return this.childNodes[0]||null;}
  get lastChild(){return this.childNodes[this.childNodes.length-1]||null;}
  get firstElementChild(){return this.firstChild;}
  get scrollHeight(){return this.childNodes.length*10;}
  replaceChildren(...nodes){this.childNodes=nodes.slice();}
  appendChild(node){this.childNodes.push(node);return node;}
  removeChild(node){
    const index=this.childNodes.indexOf(node);assert(index>=0);
    this.childNodes.splice(index,1);
  }
}
const ctx={
  window:{},WeakMap,Number,Math,performance:{now:()=>0},
  getComputedStyle:()=>({lineHeight:'10px',fontSize:'10px',marginTop:'0',marginBottom:'0'})
};
vm.runInNewContext(text,ctx);
assert.equal(typeof ctx.window.JFPageEngine.paginate,'function');
const blocks=Array.from({length:60},(_,i)=>({
  chapter:0,key:String(i),offset:i*2,node:new Node('字'+i)
}));
const pages=ctx.window.JFPageEngine.paginate(blocks,100,new Host());
const metrics=ctx.window.JFPageEngine.diagnostics();
assert.equal(pages.length,6,'ten blocks fit on each 100px leaf');
assert.equal(pages.flat().map(x=>x.node.textContent).join(''),
  blocks.map(x=>x.node.textContent).join(''),'source text conserved');
assert.equal(metrics.blocks,60);
assert(metrics.singleMeasurements<=7,
  'fit blocks must not each trigger an isolated DOM measurement');
assert(metrics.reusedColumnNodes>150,
  'assembled probe must reuse existing page prefix nodes');
assert(metrics.clonedColumnNodes<120,
  'batch probes must remain near-linear rather than quadratic');
assert(metrics.columnMeasurements<=40,'batching should reduce 60 individual height reads');
assert.equal(metrics.batchAcceptedBlocks,60,'all normal paragraphs should batch');
assert(metrics.batchProbes>0&&metrics.batchOverflows>0,'page boundaries should be measured, not guessed');
assert.equal(metrics.pages,6);
// A title near a leaf end must still travel with the next paragraph.
const mixed=Array.from({length:40},(_,i)=>({
  chapter:Math.floor(i/9),key:'mixed-'+i,offset:i,
  node:new Node('条目'+i,i%9===8?'H3':'P')
}));
const mixedLeaves=ctx.window.JFPageEngine.paginate(mixed,100,new Host());
assert.equal(mixedLeaves.flat().map(x=>x.node.textContent).join(''),
  mixed.map(x=>x.node.textContent).join(''),'mixed source characters conserved');
assert(mixedLeaves.slice(0,-1).every(p=>p.at(-1).node.tagName!=='H3'),
  'heading must not be stranded at the bottom of a leaf');
console.log('PASS v7.124 batched measured pagination: '+JSON.stringify(metrics));
