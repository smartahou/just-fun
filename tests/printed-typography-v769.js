#!/usr/bin/env node
'use strict';
// Cross-version regression for actual, currently active printed typography.
// The old v7.69-only literal marker was superseded by v7.70 and v7.78;
// do not fail purely because a historical line-height is no longer used.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const paper=fs.readFileSync(path.join(root,'src/client/scripts/98e-paper-textures.js'),'utf8');
const start=css.indexOf('/* ===== v7.70 · 纸上墨韵');
const v7105=css.indexOf('/* ===== v7.105 · quiet printed ink');
assert(start>=0,'current print-density/ink block exists');
assert(v7105>start,'subsequent minimal ink override exists');
const current=css.slice(start,v7105);
const ink=css.slice(v7105);
assert(/\.jfReader\.paged #jfPageView \.jfSheetBody\s*\{/.test(current),
  'print metrics shared by visible and measurement sheets');
assert(js.includes("jfMeasureHost.className='jfPageMeasure jfSheetBody'"),
  'measure host shares .jfSheetBody');
assert(js.includes("view.style.setProperty('--jf-read-family',jfReadFamilyMap[jfDeskPrefs.family]"),
  'user font selection mapped to page view');
assert(current.includes('font-family:var(--jf-read-family,'),
  'print mode respects selected font');
assert(js.includes("'Source Han Serif SC','Noto Serif CJK SC','Noto Serif SC'"),
  'native CJK serif stack retained');
assert(current.includes('line-height:1.69')&&current.includes('letter-spacing:0;'),
  'measured print rhythm unchanged by v7.105');
assert(current.includes('margin:0 0 .47em'), 'paragraph rhythm unchanged');
assert(current.includes('text-align:justify')&&current.includes('text-align-last:auto'),
  'Chinese printing justification retained');
assert(current.includes('color:rgba(53,37,24,.95)'),
  'historical old-paper pigment preserved for comparison');
assert(ink.includes('color:rgba(47,37,29,.98)') && ink.includes('text-shadow:none'),
  'tiny v7.105 neutral ink refinement takes precedence');
assert(current.includes('mix-blend-mode:multiply'),
  'ink can interact with actual paper fibres');
assert(current.includes(':not(:has(img,picture,svg,canvas,video,object))'),
  'illustrations excluded from block blending');
assert(current.includes('.jfSheetBody figcaption{'),
  'book captions retain their existing measured rhythm');
assert(current.includes('.jfSheetBody>.jfPrintImprint{'),
  'imprint layout overrides retained');
assert(!/filter:\s*blur\(/.test(current+ink),'no intentionally blurred glyphs');
assert(!ink.includes('background-image:url('),'photographed paper untouched');
assert(paper.includes("const KEY='jf-reader-aged-paper-v768'"),
  'aged-paper persisted state retained');
assert(paper.includes('textures.length!==16'),'all 8 paired original WebPs still used');
assert(js.includes('jfDeskDecorateImprintBlock(printed,sec.n,imprint,k)'),
  'CIP layout logic preserved');
assert(js.includes('jfDeskPageForAnchor(jfDeskPages,number'),
  'last-read paper anchor preserved');
console.log('PASS v7.105 typography: legacy rhythm verified against current v7.70, ink contrast tuned without layout/paper changes');
