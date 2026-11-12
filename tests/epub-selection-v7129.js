#!/usr/bin/env node
'use strict';
// v7.129: pure source contract checks; the real Chromium test covers selection.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build.manifest.json'),'utf8'));
const modulePath='src/client/scripts/99d-epub-selection.js';
assert(manifest.scripts.includes(modulePath),'new selection module is bundled offline');
assert(manifest.scripts.indexOf(modulePath)>manifest.scripts.indexOf('src/client/scripts/99-reading.js'));
const source=fs.readFileSync(path.join(root,modulePath),'utf8');
new Function(source);
const reading=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
assert(reading.includes('window.JFEpubSelection?.pageRendered?.()'),'visible face switch refreshes marks');
assert(reading.includes('window.JFEpubSelection?.refresh?.()'),'workspace mutations refresh marks');
assert(reading.includes('window.JFEpubSelection?.quote?.()'),'old excerpt button works with paper mode');
for(const label of ['取消','标记','加入笔记'])
  assert(source.includes(label),'operation available: '+label);
assert(source.includes("jfDeskMutate(saved?{action:'delete-mark'") &&
  source.includes("{action:'mark'"),'mark and undo use existing durable API');
assert(source.includes('jfDeskChooseQuote(ref)'),'quote uses existing note chooser');
assert(source.includes('jfDeskPages[jfDeskPageIndex'),'paper anchor reads real page offset');
assert(source.includes('new Highlight(...ranges)'),'stored marks do not mutate page DOM');
assert(source.includes('range.getClientRects()'),'soft selection overlay follows actual glyph bounds');
assert(css.includes('.jfReader .jfEpubSelectionPatch') &&
  css.includes('::highlight(jf-epub-mark-amber)'),'aged paper mark appearance');
assert(!source.includes('innerHTML'),'selection module must not rewrite source HTML');
console.log('PASS v7.129 EPUB selection: page anchors, gentle ink, existing mark/quote durability, no pagination DOM rewrite');
