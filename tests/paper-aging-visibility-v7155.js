#!/usr/bin/env node
'use strict';
// v7.155 regression: v7.154's paper-aging layers must actually PAINT in the
// default jf-aged-paper mode. The photographed stock is an opaque WebP on
// .jfSheet::after (z-index 0, isolation:isolate on the sheet); the ghost was
// also z-index 0 and therefore painted UNDER the photo — bleed-through was
// invisible on every real spread, which read to the owner as "no change".
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const aging=fs.readFileSync(path.join(root,'src/client/styles/42-paper-aging.css'),'utf8');
const reading=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');

// 1. The photographed stock really is z-index 0 inside an isolated sheet.
assert(reading.includes('.jfReader.paged #jfPageView .jfSheet{\n  isolation:isolate;'),
  'sheet still creates the isolation group the stacking depends on');
assert(/\.jfReader\.paged #jfPageView \.jfSheet::after\{\s*z-index:0!important;/.test(reading),
  'photographed stock ::after still sits at z-index 0');

// 2. The ghost must sit ABOVE the photo (z 0) and BELOW the text body (z 2).
const ghostBlock=aging.match(/\.jfGhost\{[\s\S]*?\}/);
assert(ghostBlock,'ghost style block present');
const ghostZ=Number(ghostBlock[0].match(/inset:0;z-index:(\d+)/)?.[1]);
assert(ghostZ===1,'ghost z-index must be 1 — between photo 0 and body text 2, got '+ghostZ);
const bodyZ=reading.match(/\.jfReader\.paged #jfPageView \.jfSheet>\.jfSheetBody\{z-index:(\d+)!important\}/);
assert(bodyZ&&Number(bodyZ[1])>ghostZ,'real text still paints above the ghost');
assert(reading.includes('position:relative;z-index:1'),'sheet body stacking rules retained');
// 3. The dead v7.154 selector (attribute renamed in v7.48) must not come back.
assert(!aging.includes('data-paper-index'),'no rule may target the retired data-paper-index attribute');
// 4. The whisper stays a whisper: readable, but never competing with ink.
const ghostOpacity=Number('0.'+(ghostBlock[0].match(/opacity:\.(\d+)/)?.[1]||'0'));
assert(ghostOpacity>0.05&&ghostOpacity<=0.12,'ghost opacity tuned for perception, got '+ghostOpacity);
// 5. Print grain stays a top layer with multiply over the glyphs.
const grain=aging.match(/\.jfPageView \.jfSheetBody::after\{[\s\S]*?\}/);
assert(grain,'print grain layer present');
assert(/z-index:2/.test(grain[0]),'grain paints above the text');
assert(/mix-blend-mode:multiply/.test(grain[0]),'grain multiplies into the stock');
const grainOpacity=Number('0.'+(grain[0].match(/opacity:\.(\d+)/)?.[1]||'0'));
assert(grainOpacity>=0.1,'grain strong enough to read on the photo, got '+grainOpacity);
// 6. Style chain keeps the aging sheet after the reading sheet.
const manifest=fs.readFileSync(path.join(root,'build.manifest.json'),'utf8');
const iReading=manifest.indexOf('src/client/styles/41-reading.css');
const iAging=manifest.indexOf('src/client/styles/42-paper-aging.css');
assert(iReading>=0&&iAging>iReading,'42-paper-aging.css loads after 41-reading.css');
console.log('PASS v7.155: ghost paints above photographed stock, grain reads through ink, dead selector gone');
