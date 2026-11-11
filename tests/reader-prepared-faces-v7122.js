#!/usr/bin/env node
'use strict';
// v7.122 · presentation cache must never mutate the source physical-page
// blocks, and must never grow past three two-sided visible DOM slots.
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../src/client/scripts/99-reading.js'),'utf8');
assert.equal(require('../package.json').version,'7.123.0');
const a=src.indexOf('// v7.122 · Three bounded'),b=src.indexOf('function jfDeskPagedRender(direction){',a);
assert(a>0&&b>a,'missing face-pool implementation');
const faceCode=src.slice(a,b);
const elements=[];
class Element{
  constructor(id='',parent=null){
    this.id=id;this.parentElement=parent;this.isConnected=true;
    this.dataset={};this.inert=false;this.children=[];
    this.calls=0;this.attributes=new Map();
    this.classes=new Set(['jfSheetBody']);
    this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),
      contains:x=>this.classes.has(x)};
    elements.push(this);
  }
  cloneNode(){
    const e=new Element(this.id,this.parentElement);
    for(const cls of this.classes)e.classes.add(cls);
    return e;
  }
  replaceChildren(...children){this.calls++;this.children=children;}
  removeAttribute(k){if(k==='id')this.id='';this.attributes.delete(k);}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  remove(){this.isConnected=false;this.id='';}
}
const sheet={
  insertBefore(el){el.isConnected=true;el.parentElement=this;}
};
const left=new Element('jfSheetLeft',sheet),right=new Element('jfSheetRight',sheet);
const node=t=>({textContent:t,cloneNode(){return node(t);}});
const page=n=>[{chapter:n,offset:0,key:n+':0',node:node('chapter '+n)}];
const pages=Array.from({length:8},(_,n)=>page(n));
const ctx={
  Map,Set,Array,Math,Date,Promise,
  window:{},document:{getElementById:id=>elements.find(e=>e.id===id&&e.isConnected)||null},
  jfDeskPages:pages,jfDeskPageIndex:0,jfDeskPaged:true,
  jfDeskSession:1,jfDeskBook:{id:'book-A'},jfDeskPagesSig:'font18-geo',
  jfDeskOutline:{chapters:Array.from({length:8},(_,n)=>({title:'poem '+n}))},
  jfDeskPagedGeometry:()=>({two:true}),jfReader:{hidden:false},
  clearTimeout:()=>{},setTimeout:()=>1,
  performance:{now:()=>0}
};
const helpers=vm.runInNewContext(faceCode+
 '\n({show:jfDeskShowFace,prepare:jfDeskPrepareFace,'+
 'matches:jfDeskFaceMatches,drop:jfDeskDropFaces,'+
 'pool:()=>jfDeskFacePool,metrics:jfDeskFaceMetrics})',ctx);
const first=helpers.show(0,true);
assert(first&&first.left.id==='jfSheetLeft');
assert.equal(first.left.textContent,undefined); // text comes from cloned child nodes
assert.equal(helpers.pool().slots.length,3);
assert.equal(elements.filter(x=>x.isConnected&&x.classes.has('jf-face-buffer')).length,6);
const srcNode=pages[0][0].node;
assert.notStrictEqual(first.left.children[0],srcNode,'never move source block');
const stage=helpers.pool().slots.find(s=>s.index===-1);
helpers.prepare(stage,2,true);
const before=stage.left.calls;
const selected=helpers.show(2,true);
assert.strictEqual(selected,stage);
assert.equal(stage.left.calls,before,'cache-hit turn does not replace text DOM');
assert.equal(stage.left.id,'jfSheetLeft');
assert.equal(first.left.id,'');
assert.equal(first.left.inert,true,'standby text must be inaccessible');
assert.equal(stage.left.inert,false,'active text must be interactive');
assert.equal(stage.left.attributes.get('aria-hidden'),'false');
assert.equal(first.left.attributes.get('aria-hidden'),'true');
assert.strictEqual(helpers.show(0,true),first,'backwards hit reuses original layer');
assert.equal(helpers.metrics.hit,2);
assert.equal(elements.filter(x=>x.isConnected&&x.classes.has('jf-face-buffer')).length,6);
ctx.jfDeskSession=2;ctx.jfDeskBook={id:'book-B'};
helpers.show(4,true);
assert.equal(helpers.pool().session,2,'new session cannot reuse another book');
assert.equal(elements.filter(x=>x.isConnected&&x.classes.has('jf-face-buffer')).length,6);
helpers.drop();
assert.equal(elements.filter(x=>x.isConnected&&x.classes.has('jf-face-buffer')).length,0);
assert.equal(elements.filter(x=>x.isConnected&&x.id==='jfSheetLeft').length,1);
assert(src.includes('if(!face){\n    left.replaceChildren('),
 'fallback to original renderer preserved');
const css=fs.readFileSync(path.join(__dirname,'../src/client/styles/41-reading.css'),'utf8');
assert(css.includes('.jf-face-buffer[data-jf-face-active="true"]'));
assert(css.includes('contain:layout paint'));
const covers=fs.readFileSync(path.join(__dirname,'../src/client/scripts/98e4-paper-covers.js'),'utf8');
assert(covers.includes('if(previous?.key===key)return previous.result;'));
console.log('PASS v7.122: three bounded faces, immutable source, cached-hit no remount, session reset, accessibility');
