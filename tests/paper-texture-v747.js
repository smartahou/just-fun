#!/usr/bin/env node
'use strict';
// v7.47: pure offline texture mapping and bounded warm-cache regression.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(project,'src/client/scripts/98e-paper-textures.js'),'utf8');
const sample=Array.from({length:12},(_,i)=>'data:image/webp;base64,TEST'+i);
const seen=[],stored=new Map();
const button={dataset:{},attributes:{},addEventListener(type,callback){this.callback=callback},setAttribute(k,v){this.attributes[k]=v}};
const reader={classList:{values:new Set(),toggle(k,on){if(on)this.values.add(k);else this.values.delete(k)}}};
const document={
  head:{appendChild(el){seen.push(el)}},
  createElement(){return {id:'',textContent:''}},
  getElementById(id){return id==='jfReader'?reader:id==='jfReadPaperAged'?button:seen.find(x=>x.id===id)||null},
  querySelectorAll(){return []}
};
class ImageFake{
  constructor(){this.complete=false;}
  set src(url){this.url=url;this.complete=true;if(this.onload)this.onload();}
  decode(){return Promise.resolve();}
}
const window={};
const localStorage={getItem(k){return stored.get(k)??null},setItem(k,v){stored.set(k,v)}};
const sandbox={window,document,Image:ImageFake,TextEncoder,localStorage,Math,Map,Set,Promise,Error,Number,String};
vm.runInNewContext(source.replace('__JUSTFUN_PAPER_ASSETS__',JSON.stringify(sample)),sandbox);
const paper=window.JFPaperTextures;
assert.equal(paper.count,12);
assert.equal(seen.length,1,'exactly one CSS bank');
assert.equal((seen[0].textContent.match(/data:image\/webp/g)||[]).length,12);
assert(reader.classList.values.has('jf-aged-paper'));
const a=[{chapter:3,offset:4096,key:'3:12#1'}],b=[{chapter:3,offset:4096,key:'3:12#2'}];
const first=paper.indexFor('book-123',a);
assert(first>=0&&first<12);
for(let n=0;n<200;n++)assert.equal(paper.indexFor('book-123',a),first);
assert.notEqual(paper.keyFor(a),paper.keyFor(b),'distinct fragments have unique keys');
const pages=Array.from({length:100},(_,i)=>[{chapter:1,offset:i*300,key:'1:'+i}]);
const selected=pages.map(p=>paper.indexFor('book-123',p));
assert(selected.every(x=>x>=0&&x<12));
assert(new Set(selected).size>3,'spread uses several paper samples');
const sheet={dataset:{}};
paper.apply(sheet,'book-123',a);
assert.equal(sheet.dataset.paperIndex,String(first));
paper.apply(sheet,'book-123',[]);
assert.equal(sheet.dataset.paperIndex,undefined);
(async()=>{
  await paper.warm('book-123',pages.slice(0,6));
  paper.toggle();
  assert(!paper.isEnabled());assert.equal(stored.get('jf-reader-aged-paper'),'off');
  assert(!reader.classList.values.has('jf-aged-paper'));
  paper.toggle();
  assert(paper.isEnabled());
  assert(reader.classList.values.has('jf-aged-paper'));
  console.log('PASS paper mapping 12/12, deterministic, varied, bounded prewarm, CSS once, toggle persistent');
})().catch(e=>{console.error(e);process.exit(1)});
