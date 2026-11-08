#!/usr/bin/env node
'use strict';
// The v7.99 board is a genuinely hollow ring behind the original paper images.
// Regression: never return to a complete-book raster under the current sheets.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const pkg=require('../package.json');
const pack=require('../assets/paper-covers/embedded-v799.json');
const old=require('../assets/paper-covers/embedded-v798.json');
assert.equal(pkg.version,'7.99.0');
assert.equal(pack.version,'7.99.0');
assert.equal(pack.type,'transparent-hollow-hardcover-rim');
assert.deepEqual(pack.canvas,{width:960,height:600});
assert.equal(pack.covers.length,6);
const hashes=new Set();
let size=0;
for(let i=0;i<6;i++){
  const row=pack.covers[i],prior=old.covers[i];
  const name='cover-'+String(i+1).padStart(2,'0')+'.webp';
  assert.equal(row.filename,name);
  const raw=Buffer.from(row.base64,'base64');
  assert.equal(raw.toString('base64'),row.base64,'canonical image bytes');
  assert.equal(raw.length,row.bytes);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),row.sha256);
  assert.notEqual(row.sha256,prior.sha256,'rebuild from actual hollow frame source');
  assert.equal(raw.toString('ascii',0,4),'RIFF');
  assert.equal(raw.toString('ascii',8,12),'WEBP');
  assert.equal(raw.toString('ascii',12,16),'VP8X');
  assert((raw[20]&0x10)!==0,'transparent WebP frame');
  assert.equal(raw.readUIntLE(24,3)+1,960);
  assert.equal(raw.readUIntLE(27,3)+1,600);
  hashes.add(row.sha256);
  size+=row.bytes;
}
assert.equal(hashes.size,6);
assert(size<500000,'offline asset size budget');
const build=fs.readFileSync(path.join(root,'scripts/build.js'),'utf8');
assert(build.includes("read('assets/paper-covers/embedded-v799.json')"));
assert(build.includes("raw.toString('ascii',12,16)!=='VP8X'"));
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const live=css.slice(css.lastIndexOf('/* v7.99 · Real hollow hardcover'));
assert(live.startsWith('/* v7.99'));
assert(live.includes('border-image-source:var(--jf-cover-board-url)!important'));
assert(live.includes('border-image-slice:32 32 32 32!important'));
assert(live.includes('border-image-width:8px 9px 8px 9px!important'));
assert(live.includes('background-size:55px 100%,55px 100%!important'));
assert(live.includes('background-position:left center,right center!important'));
assert(live.includes('.jf-hardcover-book.single .jfBookBoard'));
assert(!/\.jfSheet::after|\.jfSheetBody|\.jfSpineShade\s*(?:\{|::)|radial-gradient\(|blur\(/.test(live),
  'no changes to original paper, centre crease or text flow');
const controller=fs.readFileSync(path.join(root,'src/client/scripts/98e4-paper-covers.js'),'utf8');
assert(controller.includes("jf-reader-hardcover-board-v798"),'old book-to-skin mapping retained');
assert(controller.includes('localStorage.setItem(STORE_KEY'));
const reader=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
assert(reader.includes('window.JFPaperCovers?.apply(pageView,jfDeskBook?.id,twoPages)'));
assert(!reader.includes('window.JFPaperStacks?.apply('));
console.log('PASS v7.99: 6 unique alpha book-frame WebPs; static nine-slice frame; original paper/spine preserved');
