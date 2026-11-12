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
assert(source.includes('range.getClientRects()'),'native selection toolbar follows actual glyph bounds');
assert(!source.includes("overlay.replaceChildren")&&
  !source.includes("className='jfEpubSelectionPatch'"),
  'never blend duplicate selection patches over native text');
assert(source.includes("source.slice(mark.anchorStart,mark.anchorStart+text.length)===text") &&
  source.includes("if(text!==source.slice(a,b))continue"),
  'saved highlight segments verify the exact source text');
assert(source.includes("const offset=blockOffset(block)") &&
  source.includes("const anchorStart=anchored("),
  'printed page anchor is verified before saving and reading');
assert(source.includes("event.preventDefault();event.stopImmediatePropagation();"),
  'tapping saved ink shows actions rather than turning the page');
const inkStart=css.indexOf('.jfReader ::highlight(jf-epub-selection)');
const inkEnd=css.indexOf('@media(max-width:620px)',inkStart);
const inkRules=css.slice(inkStart,inkEnd);
// Exclude the toolbar's intentionally opaque background from this check.
assert(inkStart>=0&&inkEnd>inkStart &&
  css.includes('::highlight(jf-epub-mark-amber)') &&
  css.includes('#jfPageView .jfSheetBody *::selection') &&
  css.includes('background-color:transparent!important') &&
  inkRules.includes('text-decoration-line:underline') &&
  !/background\\s*:\\s*rgba/.test(inkRules),
  'EPUB transient and saved marks must be underlines, never filled blocks');
assert(source.includes("CSS.highlights.set(transientKey,new Highlight(snap.range.cloneRange()))"),
  'selected glyphs get one fine temporary underline');
assert(source.includes('CSS.highlights.delete(transientKey)'),
  'temporary underline disappears on cancel, save, or page turn');
assert(!source.includes('innerHTML'),'selection module must not rewrite source HTML');
console.log('PASS v7.129.2 EPUB selection: temporary and saved underlines, exact text anchors, no filled blocks');
