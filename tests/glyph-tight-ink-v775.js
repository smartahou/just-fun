#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const first=js.indexOf('function jfDeskGlyphTightBounds('),last=js.indexOf('const jfDeskGlyphInkCache=new Map();',first);
assert(first>=0&&last>first,'normalized bitmap crop helpers exist');
const glyph=vm.runInNewContext(js.slice(first,last)+'\n({bounds:jfDeskGlyphTightBounds,em:jfDeskGlyphEmWidth})');
function bitmap(w,h,box){
 const p=new Uint8ClampedArray(w*h*4);
 for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++)p[(y*w+x)*4+3]=255;
 return p;
}
const bounds=glyph.bounds(bitmap(100,100,{x:34,y:27,w:30,h:42}),100,100);
assert(bounds&&bounds.width<40&&bounds.height<52,'blank raster margins cropped');
assert(bounds.x>20&&bounds.y>15,'crop follows actual ink without cutting central strokes');
const width=glyph.em(bounds);
assert(width>=.64&&width<=1.10,'aspect-aware inline em width');
assert(glyph.bounds(new Uint8ClampedArray(100*100*4),100,100)===null,'blank image cannot fabricate glyph');
const b=js.indexOf('function jfDeskIsBookBlank('),e=js.indexOf('function jfDeskBlocksFor(sec){',b);
assert(b>=0&&e>b,'blank-block classifier exists before page block creation');
const blank=vm.runInNewContext(js.slice(b,e)+'\njfDeskIsBookBlank');
const p=(text)=>({tagName:'P',textContent:text,querySelector:()=>null});
assert(blank(p('  \n\u00a0')),'whitespace-only EPUB paragraph recognised');
assert(!blank(p('正文内容')),'normal paragraph never removed');
assert(!blank({tagName:'H1',textContent:'',querySelector:()=>null}),'empty chapter title is not blank prose');
assert(!blank({tagName:'P',textContent:'',querySelector:()=>({tagName:'IMG'})}),'image-only paragraph never hidden');
assert(js.includes("printed.classList.add('jfPrintQuietBreak')"),'normal blank-break clone tagging');
assert(js.includes("if(consecutiveBlanks>1)printed.classList.add('jfPrintRedundantBlank')"),'redundant consecutive break tagging');
assert(js.includes("img.style.setProperty('--jf-glyph-width',normalized.widthEm.toFixed(3)+'em')"),'cropped width installed on measured/rendered clone');
assert(js.includes("img.src=normalized.src;img.dataset.jfPlate='glyph-ink'"),'only in printed clones; original EPUB unchanged');
assert(js.includes("for(let m=k;m<=bridged.end;m++)acc+=raw[m].textContent.length"),'offset continuity retained');
assert(css.includes("width:var(--jf-glyph-width,.96em)!important"),'tight bitmap layout is honoured');
assert(css.includes('color:rgba(53,37,24,.93)'), 'warm printed pigment gains opacity while retaining some paper translucency');
assert(css.includes('.jfSheetBody>p.jfPrintRedundantBlank{'),'extra blank spacers collapsed');
assert(css.includes('display:none!important;'),'hidden blanks do not change text offsets');
assert(Number(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version.split('.')[1])>=75,'tight glyph regression remains compatible with current reader');
console.log('PASS v7.75: glyph alpha bounding crop, em-width sizing, paper ink and empty-paragraph guard');
