#!/usr/bin/env node
'use strict';
// v7.130 · Structural contracts; Chromium exercises real DOM and persistence.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const manifest=JSON.parse(read('build.manifest.json'));
const moduleFile='src/client/scripts/99d-epub-selection.js';
assert(manifest.scripts.includes(moduleFile),'bundled offline');
assert(manifest.scripts.indexOf(moduleFile)>manifest.scripts.indexOf('src/client/scripts/99-reading.js'));
const source=read(moduleFile),reader=read('src/client/scripts/99-reading.js');
const engine=read('src/client/scripts/98d-page-engine.js');
const css=read('src/client/styles/41-reading.css');
for(const js of [source,reader,engine])new Function(js);
assert(reader.includes('sourceStarts.set(child,sourceCursor)'),'source DOM whitespace mapped');
assert(reader.includes('sourceOffset:sourceStarts.get(node)'),'source offsets carried into blocks');
assert(engine.includes('sourceOffset:item.sourceOffset'),'original source offsets survive pagination');
assert(engine.includes('item.sourceOffset+split.head.textContent.length'),
  'split paragraph tail retains exact original coordinate');
assert(source.includes('item.sourceOffset')&&source.includes('function rangesFor('),
  'annotation range uses declared source coordinates instead of text guessing');
assert(!source.includes('source.indexOf(text)')&&!source.includes('source.indexOf(block.el.textContent)'),
  'printed page mapping never guesses by searching repeated text');
assert(source.includes('source.indexOf(mark.text)')&&source.includes('resolvedLegacy'),
  'prior wrong anchors recover only with unique verified text');
assert(source.includes('const span=source.slice(a.offset,z.offset)'),
  'selection from exact endpoint offsets supports paragraphs and both leaves');
assert(source.includes('schedulePaint')&&source.includes('lastPaintKey'),
  'mark changes draw once, stable state skips redraw');
assert(source.includes('CSS.highlights.set(key(col),new Highlight(...ranges))'),
  'durable markup replaces registry entry atomically');
assert(source.includes('document.caretRangeFromPoint')&&
  !source.includes('hit.range.getClientRects'),
  'existing marks use a single caret hit-test, not all-range geometry');
assert(reader.includes("if(payload.action==='mark'||payload.action==='delete-mark'")&&
  reader.includes("window.JFEpubSelection?.restoreReady?.()"),
  'progress never redraws marks; reopening always paints after restore');
assert(source.includes('lastReasons')&&source.includes('diagnostics'),
  'render failures expose diagnostics rather than being invisible');
for(const t of ['取消标记','标记','加入笔记'])assert(source.includes(t),t+' action present');
assert(!source.includes("['cancel','取消']"),'tap-away replaces cancel button');
assert(source.includes('dismissOnClick')&&source.includes('event.stopImmediatePropagation()'),
  'one outside click dismisses selection before pagination click');
assert(source.includes("const color=mark.color||'blue'")&&
  source.includes("const col=colors.includes(color)?color:'blue'"),
  'default blue marks are rendered in the actual blue registry');
assert(source.includes("['copy','复制']")&&source.includes('navigator.clipboard?.writeText')&&
  source.includes("document.execCommand('copy')"),'copy has clipboard and fallback');
assert(reader.includes("jfPdfMarksListToggle').hidden=!!outline.nativePdf")&&
  reader.includes('jfPdfJsMarksListRender()'),
  'non-PDF books expose and refresh the shared mark index');
const pdf=read('src/client/scripts/99a-pdfjs.js');
assert(pdf.includes('await jfDeskShowChapter(mark.chapter,0,')&&
  !pdf.includes("jfDeskJumpToQuote({...mark,type:'text'})"),
  'non-PDF mark index navigates via source offset, never via DOM mutation');
assert(source.includes('jfEpubColorPalette')&&source.includes("action:'recolor-mark'")&&
  reader.includes("payload.action==='recolor-mark'"),
  'five reusable colors recolor without losing saved mark identity');
assert(source.includes('function indexFor(block)')&&source.includes('const {nodes}=indexFor(block)'),
  'text nodes and exact ranges are indexed once per rendered block');
assert(css.includes('[aria-pressed=true]')&&css.includes('[data-color=amber]'),
  'low saturation palette indicates current ink color');
assert(source.includes('jfDeskChooseQuote({...snap.ref,')&&
  source.includes('sourceText:snap.ref.text'),'note retains original mark source');
assert(css.includes('::highlight(jf-epub-selection)')&&
  css.includes('text-decoration-line:underline')&&
  css.includes('background-color:transparent!important'),'single legible thin line');
assert(!source.includes('innerHTML'),'source annotation layer never rewrites book DOM');
console.log('PASS v7.130 EPUB map: deterministic offsets, atomic ink, no progress redraw, lazy caret hit-testing');
