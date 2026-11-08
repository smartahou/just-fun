#!/usr/bin/env node
'use strict';
// The hardcover is a static backdrop. The prized original paper WebPs are not changed.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const pkg=require('../package.json');
assert(Number(pkg.version.split('.')[1])>=98,'historical hardcover v7.98 retained');
const spec=require('../assets/paper-covers/embedded-v798.json');
assert.equal(spec.version,'7.98.0');
assert.deepEqual(spec.canvas,{width:960,height:640});
assert.equal(spec.covers.length,6);
const images=[],hashes=new Set();
for(let i=0;i<6;i++){
  const c=spec.covers[i],name=`cover-${String(i+1).padStart(2,'0')}.webp`;
  assert.equal(c.filename,name);
  const bytes=Buffer.from(c.base64,'base64');
  assert.equal(bytes.toString('base64'),c.base64);
  assert.equal(bytes.length,c.bytes);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha,c.sha256);
  hashes.add(sha);
  images.push('data:image/webp;base64,'+c.base64);
}
assert.equal(hashes.size,6,'Six unique boards');
const build=fs.readFileSync(path.join(root,'scripts/build.js'),'utf8');
assert(build.includes("read('assets/paper-covers/embedded-v799.json')"));
assert(build.includes("'src/client/scripts/98e4-paper-covers.js'"));
const manifest=require('../build.manifest.json');
assert(manifest.scripts.indexOf('src/client/scripts/98e4-paper-covers.js')>
       manifest.scripts.indexOf('src/client/scripts/98e3-paper-stacks.js'));
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const latest=css.slice(css.lastIndexOf('/* ===== v7.98 · hardcover shell'));
assert(latest.includes('.jfBookPile{')&&latest.includes('display:none!important'));
assert(latest.includes('background-image:var(--jf-cover-board-url)!important'));
assert(latest.includes('background-position:right center!important'));
assert(!/blur\(|linear-gradient\(|radial-gradient\(/.test(latest),'No plastic fog / fake gradients');
const render=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
assert(render.includes('window.JFPaperCovers?.apply(pageView,jfDeskBook?.id,twoPages)'));
assert(!render.includes('window.JFPaperStacks?.apply('),'Old dynamic stacks must not render');
const originalPaper=fs.readFileSync(path.join(root,'src/client/scripts/98e-paper-textures.js'),'utf8');
assert(originalPaper.includes('Expected 8 paired WebP sets'),'Original eight groups preserved');
const s=fs.readFileSync(path.join(root,'src/client/scripts/98e4-paper-covers.js'),'utf8');
const fake=images.map((_,i)=>'data:image/webp;base64,'+Buffer.from(`cover-${i}`).toString('base64'));
let stored={},setCount=0;
const localStorage={
  getItem(key){return stored[key]??null;},
  setItem(key,value){stored[key]=value;setCount++;}
};
const cls=new Set(['paged','jf-aged-paper']);
const viewCls=new Set();
const view={classList:{toggle(name,yes){if(yes)viewCls.add(name);else viewCls.delete(name);},remove(name){viewCls.delete(name)}},
  style:{values:{},setProperty(k,v){this.values[k]=v;},removeProperty(k){delete this.values[k];}},dataset:{}};
const doc={getElementById(id){return id==='jfReader'?{classList:{contains:name=>cls.has(name)}}:null}};
const win={};
const make=()=>vm.runInNewContext(s.replace('__JUSTFUN_PAPER_COVER_ASSETS__',JSON.stringify(fake))
  .replace('__JUSTFUN_SINGLE_COVER_ASSETS__',JSON.stringify(fake)),{
  window:win,document:doc,localStorage,Math,JSON,Number,String,Object,Array,Error
});
make();
assert.equal(win.JFPaperCovers.count,6);
const a=win.JFPaperCovers.apply(view,'book-A',true);
assert(a>=1&&a<=6);
assert(viewCls.has('jf-hardcover-book'));
assert(!viewCls.has('jf-image-stacks'));
assert.equal(view.dataset.coverStyle,String(a));
assert.equal(win.JFPaperCovers.apply(view,'book-A',true),a);
assert.equal(setCount,1,'One choice, not a new random cover per turn');
make();
assert.equal(win.JFPaperCovers.apply(view,'book-A',false),a,'Persist across reload');
assert.equal(view.dataset.coverMode,'single');
cls.delete('jf-aged-paper');
assert.equal(win.JFPaperCovers.apply(view,'book-A',true),null);
assert(!viewCls.has('jf-hardcover-book'),'Only aged-paper mode gets the board');
console.log('PASS v7.98: six unique offline bookboards, stable per book, paper preserved, legacy stacks hidden');
