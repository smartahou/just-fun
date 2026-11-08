#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
assert(Number(require('../package.json').version.split('.')[1])>=100,'v7.100+ rollback tests');
const manifest=require('../build.manifest.json');
const base=manifest.scripts.indexOf('src/client/scripts/98e4-paper-covers.js');
assert(base>=0);
assert(fs.existsSync(path.join(root,'src/client/scripts/98e45-paper-cover-finishes.js')),'historical v7.100 filter module preserved');
assert(!manifest.scripts.includes('src/client/scripts/98e45-paper-cover-finishes.js'),'v7.101 must use actual photos without the old CSS color filters');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const marker='/* ===== v7.100 · straight-backed hardcover';
assert(css.includes(marker));
const latest=css.slice(css.lastIndexOf(marker),css.indexOf('/* ===== v7.101 · Actual photographic hardback'));
assert(latest.includes('width:calc(var(--jf-page-w) * 2 + 34px)!important'));
assert(latest.includes('height:calc(var(--jf-page-h) + 24px)!important'));
assert(latest.includes('width:calc(var(--jf-page-w) + 34px)!important'));
assert(latest.includes('border-radius:6px 6px 7px 7px!important'));
assert(latest.includes('width:clamp(38px,3.5vw,52px)!important'));
assert(latest.includes('rgba(23,14,8,.345) 51%'));
assert(latest.includes('mask-image:linear-gradient(to bottom'));
assert(latest.includes('background-color:transparent!important'));
assert(latest.includes('background-image:\n    var(--jf-cover-board-url)'));
assert(!latest.includes('jfSheet::after'),'never touch approved page photo');
assert(!latest.includes('.jfSheetBody'),'never change pagination geometry');
const original=require('../assets/paper-covers/embedded-v799.json');
assert.equal(original.covers.length,6,'original photographic materials remain');
const src=fs.readFileSync(path.join(root,'src/client/scripts/98e45-paper-cover-finishes.js'),'utf8');
new vm.Script(src);
const old={
  count:6,
  styleFor(bookId){return Number(String(bookId).split('-')[1]||0)%6},
  apply(view,bookId,twoPages){
    if(!bookId)return null;
    view.dataset.coverMode=twoPages?'spread':'single';
    return this.styleFor(bookId)+1;
  }
};
let result={};
const win={JFPaperCovers:old};
vm.runInNewContext(src,{window:win,Math,Number,String,Object,Array,Error});
assert.equal(win.JFPaperCovers.count,6,'legacy original index exposed');
assert.equal(win.JFPaperCovers.variantCount,12);
const variants=new Set();
for(let i=0;i<120;i++){
  const view={
    dataset:{},
    style:{props:{},setProperty(k,v){this.props[k]=v;},removeProperty(k){delete this.props[k];}}
  };
  const id='book-'+i;
  const a=win.JFPaperCovers.apply(view,id,true);
  const selected=view.dataset.coverVariant;
  assert.equal(a,old.styleFor(id)+1);
  assert(Number(selected)>=1&&Number(selected)<=12);
  assert(view.style.props['--jf-cover-shell-underlay']);
  assert(view.style.props['--jf-cover-shell-filter']);
  win.JFPaperCovers.apply(view,id,false);
  assert.equal(view.dataset.coverVariant,selected,'same case on mobile');
  variants.add(selected);
  if(i===0){win.JFPaperCovers.apply(view,null,false);assert(!view.dataset.coverVariant);assert(!view.style.props['--jf-cover-shell-filter']);}
}
assert.equal(variants.size,12,'all twelve material/finish combinations reachable');
console.log('PASS v7.100: physical cover corners, restrained 38-52px binding, 12 stable photo finishes, original paper untouched');
