#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const pkg=require('../package.json');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const marker='/* v7.91 · asymmetric photograph corner treatment';
assert(css.includes(marker),'v7.91 photo corner patch missing');
const s=css.slice(css.lastIndexOf(marker),css.indexOf('/* v7.92 · Silhouette-matched photographic fore-edge */'));
function rule(side){
  const re=new RegExp('\\.jfReader\\.paged\\.jf-aged-paper #jfPageView \\.jfSheet\\[data-paper-group\\]\\[data-paper-side="'+side+'"\\]::after \\{([^}]+)\\}');
  const match=s.match(re);
  assert(match,'missing actual photographed '+side+' leaf overlay');
  return match[1];
}
for(const side of ['left','right']){
  assert(s.includes('[data-paper-side="'+side+'"]::after'),'overlay not included');
  assert(s.includes('[data-paper-side="'+side+'"],'),'leaf box not included');
  assert(/border-radius:[\s\S]+?!important;/.test(rule(side)),'corner radius is not forced over legacy zero');
}
const left=rule('left');
const right=rule('right');
// Every image is left/right paired. Inner edges are literal 0 on both axes.
assert(/clamp\(18px,2\.35vw,33px\) 0 0 clamp\(18px,2\.05vw,29px\)/.test(left),'left outer X radii');
assert(/clamp\(17px,1\.95vw,29px\) 0 0 clamp\(18px,2\.15vw,31px\)/.test(left),'left outer Y radii');
assert(/0 clamp\(17px,2\.2vw,31px\) clamp\(18px,2\.35vw,34px\) 0/.test(right),'right outer X radii');
assert(/0 clamp\(18px,2\.1vw,30px\) clamp\(18px,2vw,29px\) 0/.test(right),'right outer Y radii');
assert(!/(background-image|background-color|mask-image|clip-path|box-shadow|padding|margin|transform|filter)\s*:/.test(s),'new corner patch must not add fake image layers or alter geometry');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/paper-spreads/manifest.json'),'utf8'));
assert.equal(manifest.images,16,'master images untouched');
assert.equal(manifest.pairs,8,'all pairs retained');
const [major,minor]=pkg.version.split('.').map(Number);
assert(major>7||(major===7&&minor>=91),'v7.91 or later photo-corner baseline');
console.log('PASS v7.91 external photo corners, square gutter, transparent sheet, original assets protected');
