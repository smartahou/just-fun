#!/usr/bin/env node
'use strict';
// v7.78.1 · old-paper front-surface film regression.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const html=fs.readFileSync(path.join(root,'src/client/index.html'),'utf8');
const x=css.indexOf('/* v7.78.1: original photographed WebP');
const y=css.indexOf('/* Light = well-preserved leaf',x);
assert(x>=0&&y>x,'v7.78.1 stack retirement must exist');
const section=css.slice(x,y);
assert.match(section,/\.jfReader\.paged\.jf-aged-paper #jfPageView \.jfSheet>\.jfSheetStack\s*\{\s*display:none!important/,'aged photographed leaf must not have a fake front-edge strip');
assert(!section.includes('display:block!important'),'aged child stack must not be reactivated');
assert(css.includes('.jfSheet>.jfSheetStack{display:none!important}'),'v7.43 child-stack retirement preserved');
assert(html.includes('class="jfBookPile" data-side="left"')&&html.includes('class="jfBookPile" data-side="right"'),'external progress piles still exist');
assert(css.includes('.jfReader.paged #jfPageView .jfBookPile{'),'progress pile styling untouched');
assert(css.includes('.jfReader.paged.jf-aged-paper #jfPageView .jfSheet[data-paper-group][data-paper-side]::after{'),'approved paper WebP layer untouched');
assert(css.includes('.jfReader.paged #jfPageView .jfSheet>.jfSheetCurl{'),'inner fold curvature untouched');
assert(css.includes('.jfReader.paged #jfPageView .jfSheet>.jfSheetBody{z-index:2!important}'),'visible body remains above texture');
console.log('paper-surface-no-film-v7781: PASS (source-level CSS/DOM invariants; visual QA required)');
