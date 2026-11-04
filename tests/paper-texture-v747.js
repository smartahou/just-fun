#!/usr/bin/env node
'use strict';
// v7.48: original left/right WebP sets stay paired per physical spread.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/client/scripts/98e-paper-textures.js'),'utf8');
const sample=Array.from({length:16},(_,i)=>'data:image/webp;base64,TEST'+i);
const styles=[],stored=new Map();
const button={attrs:{},addEventListener(type,fn){this.click=fn},setAttribute(k,v){this.attrs[k]=v}};
const reader={classList:{values:new Set(),toggle(c,on){if(on)this.values.add(c);else this.values.delete(c)}}};
const document={
  head:{appendChild(el){styles.push(el)}},
  createElement(){return {id:'',textContent:''}},
  getElementById(id){return id==='jfReader'?reader:id==='jfReadPaperAged'?button:styles.find(x=>x.id===id)||null},
  querySelectorAll(){return []}
};
class FakeImage{
 constructor(){this.complete=false;}
 set src(v){this.url=v;this.complete=true;this.onload?.();}
 decode(){return Promise.resolve();}
}
const window={};
const localStorage={getItem(k){return stored.get(k)??null},setItem(k,v){stored.set(k,v)}};
const context={window,document,Image:FakeImage,TextEncoder,localStorage,Math,Map,Set,Promise,Error,Number,String};
vm.runInNewContext(source.replace('__JUSTFUN_PAPER_SPREAD_ASSETS__',JSON.stringify(sample)),context);
const paper=window.JFPaperTextures;
assert.equal(paper.count,16);
assert.equal(paper.groups,8);
assert.equal(styles.length,1);
assert.equal((styles[0].textContent.match(/data:image\/webp/g)||[]).length,16);
const page=(i)=>[{chapter:Math.floor(i/15),offset:i*250,key:'block-'+i}];
const index=paper.indexFor('book-A',page(7),page(8));
assert(index>=0&&index<8);
for(let i=0;i<200;i++)assert.equal(paper.indexFor('book-A',page(7),page(8)),index);
assert.notEqual(paper.keyFor(page(7),page(8)),paper.keyFor(page(8),page(9)));
assert(new Set(Array.from({length:96},(_,i)=>paper.indexFor('book-A',page(i*2),page(i*2+1)))).size===8);
const l={dataset:{}},r={dataset:{}};
paper.applySpread(l,r,'book-A',page(7),page(8),true);
assert.equal(l.dataset.paperGroup,r.dataset.paperGroup);
assert.equal(l.dataset.paperSide,'left');
assert.equal(r.dataset.paperSide,'right');
paper.applySpread(l,r,'book-A',page(7),[],false);
assert.equal(r.dataset.paperGroup,undefined);
// A physical right sheet remains on the final spread even if it carries no text.
// The texture must match the left group without creating another pagination page.
paper.applySpread(l,r,'book-A',page(7),[],true);
assert.equal(r.dataset.paperGroup,l.dataset.paperGroup);
assert.equal(r.dataset.paperSide,'right');
assert(styles[0].textContent.includes('radial-gradient('),'old-paper center correction missing');
assert.equal((styles[0].textContent.match(/data:image\/svg\+xml/g)||[]).length,16,
  'Each paired paper asset must have one static deterministic edge-patina overlay');
assert(styles[0].textContent.includes('rgba(246,246,242,.94)'),
  'Stronger pale-book center correction must be present');
assert.equal((styles[0].textContent.match(/data:image\/webp/g)||[]).length,16,
  'All original 16 WebP leaves must remain in the paired CSS rules');
paper.applySpread(l,r,'book-A',[],[],true);
assert.equal(l.dataset.paperGroup,undefined);
(async()=>{
 const spreads=Array.from({length:8},(_,i)=>({left:page(i*2),right:page(i*2+1)}));
 await paper.warm('book-A',spreads);
 assert(paper.cacheSize()<=12,'bounded decoded image refs');
 button.click();
 assert.equal(paper.isEnabled(),false);
 assert.equal(stored.get('jf-reader-aged-paper'),'off');
 button.click();
 assert.equal(paper.isEnabled(),true);
 assert(reader.classList.values.has('jf-aged-paper'));
 console.log('PASS 16 original pair slots, 8 group mapping, source identity, 0/1/2-page states, LRU cap, toggle');
})().catch(e=>{console.error(e);process.exitCode=1});
