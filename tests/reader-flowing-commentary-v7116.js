#!/usr/bin/env node
'use strict';
// v7.116 editorial flow: a source citation and its annotation are one
// semantic prose fragment, with no table columns or inserted source text.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const page=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
const read=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const pkg=require('../package.json');
assert.equal(pkg.version,'7.122.0');
for(const code of [
  'function commentaryNoteFragments(item)',
  "var para=document.createElement('div')",
  "para.className='jfPrintCommentaryNote'",
  "label.className='jfPrintCommentarySource'",
  "comment.className='jfPrintCommentaryText'",
  "label.appendChild(child.cloneNode(true))",
  "comment.appendChild(part.cloneNode(true))",
  'if(para.textContent!==original.slice(offset,stop))return null',
  "return notes.map(function(n){return n.node.textContent;}).join('')===original?notes:null",
  'offset:(item.offset||0)+offset',
  "var notes=commentaryNoteFragments(sourceItem)",
  "if(notes)queue.push.apply(queue,notes)",
  "if(el.classList?.contains('jfPrintCommentaryNote')",
  "split.tail.classList.add('jfPrintCommentaryContinuation')"
])assert(page.includes(code),'Missing flowing citation or text-conservation rule: '+code);
assert(!page.includes('commentarySetTracks('),'old per-row table grid must not be active');
assert(!page.includes('commentarySourceShare('),'old column-percent calculation must be removed');
assert(css.includes('> .jfPrintCommentaryNote')&&
       css.includes('.jfPrintCommentarySource')&&
       css.includes('.jfPrintCommentaryText'),'render and measurement use semantic flow styles');
assert(css.includes('margin:0 .8em 0 0!important'),'one typographic gap, not fixed column');
assert(css.includes('text-indent:-1.25em!important'),'hanging continuation indent');
assert(read.includes("const jfDeskFolioCacheRevision='v7.122.0'"),
  'page-count caches are invalidated');
assert(read.includes("table.classList.add('jfPrintSourceCommentary')"),
  'only verified citations are transformed');
console.log('PASS v7.116: natural source+comment flow, exact text and offset preservation, safe non-table fallback');
