#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const css=fs.readFileSync(path.resolve(__dirname,'../src/client/styles/41-reading.css'),'utf8');
const [major,minor]=require('../package.json').version.split('.').map(Number);
assert(major>7||(major===7&&minor>=85),'v7.85+ spine regression');
const latest=css.slice(css.indexOf('/* v7.87 · The photographed pages'));
assert(latest.startsWith('/* v7.87'),'must fix the actual alpha leak, not recolour it');
assert(!latest.includes('rgba(224,205,174,.96)'),'former warm filler gone');
assert(!latest.includes('rgba(25,17,9,.34)'),'former dark centre stripe gone');
assert(css.includes('background-color:transparent!important'),'photographic Alpha preserved');
assert(css.includes('.jfReader.paged #jfPageView.single .jfSpineShade{display:none!important}'),
  'single page has no central fold');
console.log('PASS v7.85+ binding invariant: no fake gutter paint, single page untouched');
