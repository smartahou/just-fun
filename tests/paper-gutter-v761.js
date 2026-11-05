#!/usr/bin/env node
'use strict';
// v7.61 structural regression, no real media and no browser dependencies.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'src/client/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const marker='/* ===== v7.61 · optical curl on each physical leaf';
const pos=css.indexOf(marker);
assert(pos>=0,'canonical physical gutter style must exist');
const fold=css.slice(pos);
assert.equal((html.match(/class="jfSheetCurl" aria-hidden="true"/g)||[]).length,2,'one curl per sheet');
for(const id of ['jfSheetLeft','jfSheetRight']){
  assert(html.includes('class="jfSheetCurl" aria-hidden="true"></span><div class="jfSheetBody" id="'+id+'"'),'curl must be before the text surface');
}
assert.match(fold,/\.jfSheet::after\s*\{\s*z-index:0!important/,'paper WebP below curl');
assert.match(fold,/\.jfSheet>\.jfSheetCurl\s*\{[\s\S]*?z-index:1/,'curl above WebP');
assert.match(fold,/\.jfSheet>\.jfSheetBody\s*\{\s*z-index:2!important/,'text above curl');
assert.match(fold,/\.jfSheet::before\s*\{\s*z-index:3!important/,'folio above curl');
assert.match(fold,/\.jfSpineShade::before,[\s\S]*?\.jfSpineShade::after\s*\{\s*display:none!important/,'no painted black line / white bounce');
assert.match(fold,/#jfPageView\.single[\s\S]*?display:none!important/,'single-page curl must be hidden');
assert(!fold.includes('filter:blur('),'no full-height blur compositor');
assert(!fold.includes('.70)')&&!fold.includes('.80)'),'no dark hard tube');
assert(!fold.includes(')!important,'),'no invalid important between gradient layers');
const source=fs.readFileSync(path.join(root,'src/client/scripts/98e-paper-textures.js'),'utf8');
assert.match(source,/textures\.length!==16/,'8 paired WebP assets remain');
console.log('paper-gutter-v761: PASS (source structure; visually verify in browser)');
