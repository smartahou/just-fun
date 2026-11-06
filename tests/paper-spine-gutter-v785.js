#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const version=require('../package.json').version;
assert.equal(version,'7.85.0');
const idx=css.indexOf('/* v7.85 · restore physical gutter');
assert(idx>=0,'gutter correction exists');
const fix=css.slice(idx);
assert.match(fix,/\.jfReader\.paged\.jf-aged-paper #jfPageView:not\(\.single\):has\(\.jfSheet\[data-paper-group\]\[data-paper-side\]\) \.jfSpineShade\s*\{/);
assert.match(fix,/width:clamp\(40px,4\.6vw,64px\)!important/,'shadow has a gradual lateral falloff');
assert.match(fix,/rgba\(224,205,174,\.96\) 48%/,'warm paper bridge masks transparent center seam');
assert.match(fix,/rgba\(224,205,174,1\) 52%/);
assert.match(fix,/rgba\(25,17,9,\.34\) 50%/,'center crevice is softly shaded, not black');
assert.match(fix,/rgba\(30,22,13,0\) 0%/,'shadow is fully transparent at outer edge');
assert.match(fix,/rgba\(30,22,13,0\) 100%/);
assert(!fix.includes('background-color:#'),'do not restore a whole-sheet solid-paper backdrop');
assert(!fix.includes('.jfSheetCurl{display:block'),'do not reinstate broad fake curl film');
assert(css.includes('background-color:transparent!important'),'real photographic leaf stays alpha-backed');
assert(css.includes("display:none!important;\n}\n.jfReader.paged.jf-aged-paper #jfPageView .jfSheet[data-paper-group][data-paper-side]::after"),
  'duplicate board retirement remains intact');
assert(css.includes('.jfReader.paged #jfPageView.single .jfSheet>.jfSheetCurl,') &&
       css.includes('.jfReader.paged #jfPageView.single .jfSpineShade{display:none!important}'),
  'single page has no central fold');
console.log('PASS v7.85: photographed center gap receives paper bridge + soft crease, outer membrane stays removed, single page untouched');
