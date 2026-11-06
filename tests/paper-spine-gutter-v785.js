#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const version=require('../package.json').version;
const [major,minor]=version.split('.').map(Number);
assert(major>7||(major===7&&minor>=85),'gutter test applies to v7.85+');
const start=css.indexOf('/* v7.86 · A page fold');
assert(start>0,'the v7.85 two-layer effect must have been replaced');
const part=css.slice(start);
assert.match(part,/\.jfReader\.paged\.jf-aged-paper #jfPageView:not\(\.single\):has\(\.jfSheet\[data-paper-group\]\[data-paper-side\]\) \.jfSpineShade\s*\{/);
assert.match(part,/rgba\(48,32,18,0\) 0%/);
assert.match(part,/rgba\(48,32,18,0\) 100%/);
assert(!part.includes('rgba(224,205,174,.96)'), 'no paper color bridge or two-layer painted gutter');
assert(!part.includes('.jfSheetCurl{display:block'),'do not re-enable translucent films');
assert(css.includes('background-color:transparent!important'),'photographic leaf alpha preserved');
assert(css.includes(".jfReader.paged #jfPageView.single .jfSheet>.jfSheetCurl,")&&
 css.includes(".jfReader.paged #jfPageView.single .jfSpineShade{display:none!important}"),
 'single-page mode has no centre fold');
console.log('PASS inherited v7.85: photographic alpha and soft spread-only gutter retained (no fake warm bridge)');
