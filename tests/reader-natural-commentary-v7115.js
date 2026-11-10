#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
const reader=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
for(const line of ["function commentaryNoteFragments(item)","var notes=commentaryNoteFragments(sourceItem)","para.className='jfPrintCommentaryNote'","label.className='jfPrintCommentarySource'","comment.className='jfPrintCommentaryText'","if(para.textContent!==original.slice(offset,stop))return null","offset:(item.offset||0)+offset"]){
  assert(engine.includes(line),'source and text conservation: '+line);
}
assert(!engine.includes('commentarySetTracks('),'old fixed-column layout has been retired');
assert(reader.includes("const jfDeskFolioCacheRevision='v7.120.0'"));
console.log('PASS old v7.113/v7.115 core citation invariants under v7.116 flowing prose');
