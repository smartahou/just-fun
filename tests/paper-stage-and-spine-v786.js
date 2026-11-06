#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const css=fs.readFileSync(path.resolve(__dirname,'../src/client/styles/41-reading.css'),'utf8');
const [major,minor]=require('../package.json').version.split('.').map(Number);
assert(major>7||(major===7&&minor>=86),'v7.86+ stage regression');
const latest=css.slice(css.indexOf('/* v7.87 · The photographed pages'));
assert(latest.startsWith('/* v7.87'));
assert.match(latest,/\.jfReader\.paged\.jf-aged-paper #jfReadCenter\s*\{[\s\S]*?background:#e1ddd1!important;/);
const fold=latest.slice(latest.indexOf('.jfSpineShade{'),latest.indexOf('/* Retain the v7.86'));
assert.equal((fold.match(/linear-gradient\(/g)||[]).length,1,'only a single weak central shadow');
assert(!fold.includes('224,205,174'),'no opaque paper bridge');
assert(!fold.includes('rgba(25,17,9,.34)'),'no formerly heavy dark stripe');
assert(css.includes('.jfReader.paged.jf-aged-paper #jfPageView:has(.jfSheet[data-paper-group]) .jfBookBoard{\n  display:none!important;\n}'),'old solid board remains retired');
assert(css.includes('.jfReader.paged #jfPageView .jfBookPile{'),'physical page piles preserved');
console.log('PASS v7.86+ no rectangular dark desk, no faux layered crease');
