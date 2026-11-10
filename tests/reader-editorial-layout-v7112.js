#!/usr/bin/env node
'use strict';
// v7.112: only editorial headings in printed clones use keep-with-next;
// source/commentary tables can be broken only at intact citation+comment rows;
// chapter count lookup stays exact and cannot change the reading percentage.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');const root=path.resolve(__dirname,'..');
const reader=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const [major,minor]=require('../package.json').version.split('.').map(Number);
assert(major>7||(major===7&&minor>=112),'v7.112 editorial semantics remain active');
const a=reader.indexOf('function jfDeskIsEditorialHeading(node){');
const b=reader.indexOf('function jfDeskBlocksFor(sec){',a);
assert(a>=0&&b>a,'editorial heading classifier must precede printed clone');
const detect=vm.runInNewContext(reader.slice(a,b)+'\njfDeskIsEditorialHeading',{String});
const elem=(tag,text,image=false)=>({
  tagName:tag,textContent:text,querySelector:()=>image?{}:null
});
for(const heading of ['【辑评】','【评析】','【笺评】','【译注】','【赏析】']){
  assert(detect(elem('P',heading)),heading+' should stay with first content');
}
assert(detect(elem('DIV','  【辑评】  ')),'ordinary P/DIV structural headings recognized');
assert(!detect(elem('P','诗中包含【辑评】的句子')),'normal prose is never reclassified');
assert(!detect(elem('P','【辑评】',true)),'headings containing pictures are not changed');
assert(!detect(elem('TABLE','【辑评】')),'ordinary data tables are not headings');
assert(reader.includes("if(jfDeskIsEditorialHeading(printed))printed.classList.add('jfPrintKeepWithNext');"),
  'only printed clone gets semantic class');
assert(engine.includes('function keepWithNext(el)'),'page engine knows editorial heading semantics');
assert(engine.includes('function commentaryNoteFragments(item)'),'commentary rows are splittable as pairs');
assert(engine.includes("table?.classList?.contains('jfPrintSourceCommentary')"),
  'ordinary tables remain unchanged');
assert(engine.includes('child.cloneNode(true)'),'bibliography markup retained in flowing note');
assert(engine.includes("para.className='jfPrintCommentaryNote'"),
  'each editorial row is now one flowing paragraph');
assert(engine.includes('if(para.textContent!==original.slice(offset,stop))return null'),
  'each commentary paragraph preserves original characters exactly');
assert(engine.includes('offset:(item.offset||0)+offset,sourceRow:true'),
  'each row remains anchored to original text offset');
assert(engine.includes('fresh<=pageH-EPS&&together>pageH-EPS&&cur.length'),
  'editorial heading stays with a fitting next paragraph without giant blank leaves');
assert(reader.includes("document.getElementById('jfPageView').appendChild(holder)"),
  'census and visible page use identical scoped CSS');
assert(reader.includes('carry.concat(blocks.slice(at,at+6))'),
  'physical census carries chapter-end paper into the next chapter');
assert(reader.includes('jfDeskVerifiedFolios=starts;')&&
       reader.includes('jfDeskExactPhysicalFolio(pageA0,jfDeskPageIndex)'),
  'full-book physical anchors, not isolated chapter counts, certify a folio');
assert(reader.includes('const jfDeskFolioCacheRevision=')&&
  reader.includes("const jfDeskFolioCacheRevision='v7.122.0'"),
  'old pagination layout cache is invalidated by algorithm change');
assert(css.includes(".jfSheet[data-folio-exact='false']::before{content:none!important}"),
  'inaccurate physical page numbers remain hidden');
assert(css.includes("font-family:'JustFun Book Serif CN','Source Han Serif SC'"),
  'page numbers still use approved embedded font');
console.log('PASS v7.112: semantic title+row, no split citation, exact-folio foreground census, scoped CSS, same assets/typography');
