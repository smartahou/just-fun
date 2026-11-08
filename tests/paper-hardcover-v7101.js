#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');
assert(Number(pkg.version.split('.')[1])>=101);
const pack=require('../assets/paper-covers/embedded-v7101.json');
assert.equal(pack.version,'7.101.0');
assert.equal(pack.render_strategy,'photo-only-alpha');
assert.deepEqual(pack.canvas,{width:960,height:600});
assert.deepEqual(pack.singleCanvas,{width:480,height:960});
assert.equal(pack.covers.length,12);
assert.equal(pack.single_covers.length,12);
const hashes=new Set();
for(const [items,w,h,suffix] of [[pack.covers,960,600,''],[pack.single_covers,480,960,'-single']]){
  for(let i=0;i<12;i++){
    const row=items[i],file='cover-'+String(i+1).padStart(2,'0')+suffix+'.webp';
    assert.equal(row.filename,file);
    const raw=Buffer.from(row.base64,'base64'),src=fs.readFileSync(path.join(root,'assets/paper-covers/v7101',file));
    assert.equal(row.bytes,raw.length);
    assert(raw.equals(src),'checked-in photo must match runtime data');
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),row.sha256);
    assert.equal(raw.toString('ascii',12,16),'VP8X');
    assert(raw[20]&0x10,'must have alpha');
    assert.equal(raw.readUIntLE(24,3)+1,w);
    assert.equal(raw.readUIntLE(27,3)+1,h);
    hashes.add(row.sha256);
  }
}
assert.equal(hashes.size,24);
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const live=css.slice(css.lastIndexOf('/* ===== v7.101 · Actual photographic hardback'));
assert(live.startsWith('/* ===== v7.101'));
assert(live.includes('background-image:var(--jf-cover-board-url)!important'));
assert(live.includes('border:0!important')&&live.includes('box-shadow:none!important')&&live.includes('filter:none!important'));
assert(live.includes('width:clamp(26px,2.45vw,36px)!important'));
assert(live.includes('mask-image:none!important'));
assert(!/height:\s*clamp\(/.test(live),'binding height must never shrink');
const manifest=require('../build.manifest.json');
assert(!manifest.scripts.includes('src/client/scripts/98e45-paper-cover-finishes.js'));
const build=fs.readFileSync(path.join(root,'scripts/build.js'),'utf8');
assert(build.includes("assets/paper-covers/embedded-v7101.json"));
assert(build.includes("assets/paper-covers/v7101/"));
const source=fs.readFileSync(path.join(root,'src/client/scripts/98e4-paper-covers.js'),'utf8');
const urls=Array.from({length:12},(_,i)=>'data:image/webp;base64,'+Buffer.from('photo'+i).toString('base64'));
const storage={};
let sets=0;
const store={getItem:k=>storage[k]??null,setItem(k,v){storage[k]=v;sets++;}};
const classes=new Set(['paged','jf-aged-paper']);
const doc={getElementById:k=>k==='jfReader'?{classList:{contains:x=>classes.has(x)}}:null};
function view(){
  const cls=new Set();
  return {dataset:{},classList:{remove:x=>cls.delete(x),toggle(x,on){on?cls.add(x):cls.delete(x)},contains:x=>cls.has(x)},
    style:{p:{},setProperty(k,v){this.p[k]=v},removeProperty(k){delete this.p[k]}}};
}
const run=()=>{
 const win={};
 vm.runInNewContext(source.replace('__JUSTFUN_PAPER_COVER_ASSETS__',JSON.stringify(urls))
   .replace('__JUSTFUN_SINGLE_COVER_ASSETS__',JSON.stringify(urls)),{window:win,document:doc,localStorage:store,Math,JSON,String,Number,Object,Array,Error});
 return win.JFPaperCovers;
};
let controller=run();
assert.equal(controller.count,12);
let selection=new Set();
for(let i=0;i<200;i++){
 const v=view(),id='physical-book-'+i;
 let idx=controller.apply(v,id,true);
 assert(idx>=1&&idx<=12);
 assert.equal(controller.apply(v,id,false),idx);
 assert(v.style.p['--jf-cover-board-url'].includes(urls[idx-1]));
 selection.add(idx);
}
assert.equal(selection.size,12);
controller=run();
const v=view(),id='physical-book-12';
assert.equal(controller.apply(v,id,true),Number(v.dataset.coverStyle));
const stable=controller.apply(v,id,true);
assert.equal(controller.apply(v,id,false),stable);
classes.delete('jf-aged-paper');
assert.equal(controller.apply(v,id,false),null);
assert(!v.classList.contains('jf-hardcover-book'));
console.log('PASS v7.101: 24 authentic photographed WebPs, 12 remembered choices, full-height narrow gutter, no CSS fake case');
