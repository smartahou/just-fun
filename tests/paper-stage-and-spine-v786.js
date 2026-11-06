#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
assert.equal(require('../package.json').version,'7.86.0');
const start=css.indexOf('/* v7.86 · A page fold');
assert(start>0);
const current=css.slice(start);
const spine=current.slice(0,current.indexOf('/* The rectangular black stage'));
const stage=current.slice(current.indexOf('/* The rectangular black stage'));
assert.match(spine,/width:clamp\(64px,6vw,90px\)!important/);
assert.match(spine,/rgba\(37,25,15,\.103\) 50%/);
assert.match(spine,/rgba\(48,32,18,0\) 0%/);
assert.match(spine,/rgba\(48,32,18,0\) 100%/);
assert.equal((spine.match(/linear-gradient\(/g)||[]).length,1,
 'single diffuse shadow, never a stacked centre bridge');
assert(!spine.includes('224,205,174'),'remove v7.85 artificial warm-paper fill');
assert(!spine.includes('rgba(25,17,9,.34)'),'remove former dark stripe');
assert.match(stage,/\.jfReader\.paged\.jf-aged-paper #jfReadCenter\s*\{[\s\S]*?background:#e1ddd1!important;/);
assert(!stage.includes('#jfPageView.single'), 'do not add an artificial fold in single-page mode');
assert(css.includes('.jfReader.paged.jf-aged-paper #jfPageView:has(.jfSheet[data-paper-group]) .jfBookBoard{\n  display:none!important;\n}'),
 'duplicate solid backing remains retired');
assert(css.includes('background-color:transparent!important'),'alpha paper surface remains transparent');
assert(css.includes('.jfReader.paged #jfPageView .jfBookPile{'),'progress piles preserved');
assert(css.includes('.jfReader.paged #jfPageView.single .jfSheet>.jfSheetCurl,'),
 'single leaf behaviour preserved');
console.log('PASS v7.86: remove rectangular black reading stage, soften centre gutter; keep irregular paper alpha and side piles');
