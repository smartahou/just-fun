#!/usr/bin/env node
'use strict';
// v7.115: source columns follow the measured title width, plus one em;
// all rows in a table share the same tracks even across separate paper leaves.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
const reader=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
assert.equal(require('../package.json').version,'7.115.0');
for(const snippet of [
  "function commentarySourceShare(node,host)",
  "function commentarySetTracks(table,share)",
  "for(var row of Array.from(table.rows))",
  "ctx.measureText(txt).width",
  "var gutter=Math.max(13,fontSize*1.08)",
  "Math.ceil((max+gutter)*100/width)",
  "Math.min(44,Math.max(16,",
  "table.dataset.jfSourceShare=String(share)",
  "commentarySetTracks(sourceTable,sourceShare)",
  "var share=Number(table.dataset?.jfSourceShare)",
  "commentarySetTracks(part,share)",
  "part.classList.add('jfPrintSourceRowPart')"
])assert(engine.includes(snippet),'Missing adaptive citation-column invariant: '+snippet);
assert(!reader.includes("for(const width of ['30%','70%'])"),
  'Single-row citations must not reserve 30% regardless of title length');
assert(reader.includes("table.classList.add('jfPrintSourceSingle')"),
  'Single cited-note recognition remains in the printed clone');
assert(reader.includes("const jfDeskFolioCacheRevision='v7.115.0'"),
  'Changing pagination geometry must invalidate old page-count caches');
assert(css.includes('table.jfPrintSourceCommentary'),
  'Commentary CSS styling remains scoped to original book pages');
assert(engine.includes("if(!sourceTable||sourceTable.classList.contains('jfPrintSourceRowPart'))continue"),
  'Only source/commentary book tables get this gutter');
assert(engine.includes('host.replaceChildren(probe)'),
  'Column widths measured from the full table under physical-book CSS');
console.log('PASS v7.115: source-width proportional gutter, one-em breathing space and shared facing-page tracks');
