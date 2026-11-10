#!/usr/bin/env node
'use strict';
// v7.105: ink-only change, deliberately no re-pagination.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const pkg=require('../package.json');
const manifest=require('../assets/paper-spreads/manifest.json');
const marker='/* ===== v7.105 · quiet printed ink / old-book typography';
const at=css.indexOf(marker);
assert(at>0,'v7.105 incremental CSS exists');
assert.equal(css.indexOf(marker,at+marker.length),-1,'only one ink override');
const nextMarker=css.indexOf('/* v7.106 ·',at);
const patch=css.slice(at,nextMarker>at?nextMarker:undefined);
assert(patch.includes('.jfReader.paged.jf-aged-paper #jfPageView .jfSheetBody{'),
  'shared old-paper type style affects both measurement and printed sheets');
assert(patch.includes('color:rgba(47,37,29,.98);'),'ink shade changed modestly');
assert(patch.includes('-webkit-text-stroke:.045px'),'hairline ink, no faux blur');
assert(patch.includes('text-shadow:none;'),'no floating text shadow');
assert(patch.includes('color:#6c5841;'),'caption contrast improved');
const banned=/\b(?:font-family|font-size|font-weight|font-variant|font-style|line-height|letter-spacing|word-spacing|text-indent|text-align|text-justify|margin|padding|width|height|top|left|right|bottom|border|background|transform|display|position|filter|opacity|mix-blend-mode|mask-image|clip-path|overflow|white-space)\s*:/;
assert(!banned.test(patch),'ink-only patch must not alter page geometry, overlays, or images');
assert(!patch.includes('!important'),'ink must not override reader preferences');
assert(!patch.includes('url('),'never replace photographic paper');
assert(js.includes("host.className='jfPageMeasure jfSheetBody'")&&
       js.includes("jfDeskMeasureHost(geo,'census')"),
  'foreground and background print probes have the same scoped CSS');
assert(js.includes("view.style.setProperty('--jf-read-family',jfReadFamilyMap[jfDeskPrefs.family]"),'font choice preserved');
assert(!patch.includes('.jfReadText{'),'continuous reader remains unchanged');
assert.equal(manifest.version,'3.0-approved','v7.104 original 16 photos remain approved');
assert.equal(manifest.assets.length,16);
const [major,minor]=pkg.version.split('.').map(Number);
assert(major>7||(major===7&&minor>=105),'v7.105 typography remains valid in later versions');
console.log('PASS v7.105: ink-only change, font and measurement preserved, 16 approved paper photographs unchanged');
