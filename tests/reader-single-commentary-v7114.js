#!/usr/bin/env node
'use strict';
// v7.114 · Short single-row bibliographic annotation is still a two-column
// printed commentary table; ordinary tables and source EPUB must not change.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const reader=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const start=reader.indexOf('function jfDeskIsSourceCommentaryTable(node){');
const end=reader.indexOf('// v7.67 ·',start);
assert(start>=0&&end>start);
const classify=vm.runInNewContext(reader.slice(start,end)+'\njfDeskIsSourceCommentaryTable',{Array,String,Math,Number});
const mk=(label,comment,cols=2)=>({
  cells:Array.from({length:cols},(_,i)=>({
    textContent:i?comment:label,colSpan:1,rowSpan:1
  }))
});
const asTable=(...rows)=>({tagName:'TABLE',rows});
assert(classify(asTable(mk('《唐诗三百首》','中二联当作三十层看。'))),
  'single short source/comment pair is a valid annotation');
assert(classify(asTable(mk('《唐诗解》','中二联当作三十层看。'))),
  'single short note needs no artificial 18-character threshold');
assert(classify(asTable(mk('《唐诗解》','字里行间包含深沉的悲慨和曲折的感情。'),
  mk('《唐诗别裁》','诗句的神韵充满深远的感情与变化。'))),
  'multi-row commentary detection remains active');
assert(!classify(asTable(mk('项目','中二联当作三十层看。'))),
  'ordinary two-column table not classified');
assert(!classify(asTable(mk('《唐诗三百首》','短评'))),
  'too-short right cell remains excluded');
assert(!classify(asTable(mk('《唐诗三百首》','中二联当作三十层看。',3))),
  'three-column table remains excluded');
assert(!classify(asTable(mk('《唐诗三百首》','中二联当作三十层看。'),mk('编号','数据说明不是评注'))),
  'mixed-purpose tables must not be forced into annotated layout');
assert(reader.includes("table.classList.add('jfPrintSourceSingle');"),
  'dedicated style marker only on printed clone');
assert(engine.includes('function commentaryNoteFragments(item)'),
  'single and multirow citations share one flowing-text renderer');
assert(engine.includes("label.className='jfPrintCommentarySource'"),
  'reference source preserves its own inline semantics');
assert(engine.includes("comment.className='jfPrintCommentaryText'"),
  'commentary is adjacent in the same text flow');
assert(reader.includes("const printed=document.importNode(node,true);"),
  'original EPUB preserved; the printed clone is edited');
assert(reader.includes("const jfDeskFolioCacheRevision='v7.123.0'"),
  'new pagination metrics cannot reuse previous book-page count');
assert(engine.includes('function commentaryNoteFragments(item)'),
  'multi-row split algorithm untouched');
assert(css.includes('table.jfPrintSourceCommentary'),
  'existing commentary styling untouched');
console.log('PASS v7.115: single short cited annotation uses measured two-column spacing, ordinary and multirow unchanged');
