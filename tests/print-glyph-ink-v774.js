#!/usr/bin/env node
'use strict';
// v7.74 · Preserve literal EPUB offsets but suppress glyph seam spacing;
// turn the pale bitmap backing transparent without touching photographs.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const from=js.indexOf('function jfDeskHideGlyphSeamSpace(');
const to=js.indexOf('function jfDeskBlocksFor(sec){',from);
assert(from>0&&to>from,'canonical boundary + ink rules found');
const code=js.slice(from,to);
const ink=vm.runInNewContext(code+'\njfDeskGlyphInkPixels');
function pixels(n,back=236,stroke=62){
  const px=new Uint8ClampedArray(n*n*4);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const k=(y*n+x)*4,black=x>n/3&&x<n*2/3&&y>n/3&&y<n*2/3;
    px[k]=black?stroke:back;px[k+1]=black?stroke:back;
    px[k+2]=black?stroke:back;px[k+3]=255;
  }
  return px;
}
const px=pixels(48);
assert.equal(ink(px,48,48),true,'pale-back character bitmap is keyed');
assert.equal(px[3],0,'pale outer pixel is transparent');
const black=(24*48+24)*4;
assert(px[black+3]>200,'glyph central ink remains readable');
assert.equal(px[black],72,'ink pigment is warmed and made consistent');
const photo=pixels(48,65,40);
assert.equal(ink(photo,48,48),false,'dark historic photo is never altered');
assert.equal(photo[3],255,'untouched photo stays opaque');
function text(v){
  return {nodeType:3,nodeValue:v,childNodes:[],parentNode:null,
    get textContent(){return this.nodeValue},
    splitText(k){const sibling=text(this.nodeValue.slice(k));
      this.nodeValue=this.nodeValue.slice(0,k);
      const p=this.parentNode,i=p.childNodes.indexOf(this);p.childNodes.splice(i+1,0,sibling);sibling.parentNode=p;
      return sibling;}};
}
function el(tag,children=[]){
  const n={nodeType:1,tagName:tag,childNodes:[],parentNode:null,
    className:'',
    get textContent(){return this.childNodes.map(n=>n.textContent).join('')},
    insertBefore(v,ref){const i=this.childNodes.indexOf(ref);this.childNodes.splice(i,0,v);v.parentNode=this;},
    appendChild(v){if(v.parentNode){const p=v.parentNode;const i=p.childNodes.indexOf(v);p.childNodes.splice(i,1)}
      this.childNodes.push(v);v.parentNode=this;return v;}};
  children.forEach(n.appendChild.bind(n));return n;
}
const hide=vm.runInNewContext(code+'\njfDeskHideGlyphSeamSpace',{
  document:{createElement:tag=>el(tag)}
});
const pre=el('P',[text('上书藏于 \u00a0')]);
const carrier=el('P',[text(' \n'),el('IMG'),text('\n ')]);
const post=el('P',[text('\u3000 匣，再将')]);
const original=[pre.textContent,carrier.textContent,post.textContent];
hide(pre,'end');hide(carrier,'all');hide(post,'start');
assert.deepEqual([pre.textContent,carrier.textContent,post.textContent],original,
  'all original reading-offset text bytes remain');
assert(pre.childNodes.some(n=>n.className==='jfGlyphSeamSpace'),'trailing EPUB whitespace hidden');
assert(carrier.childNodes.filter(n=>n.className==='jfGlyphSeamSpace').length===2,
  'indentation around img is hidden');
assert(post.childNodes.some(n=>n.className==='jfGlyphSeamSpace'),'leading EPUB whitespace hidden');
assert(css.includes('.jfSheetBody .jfGlyphSeamSpace{')&&css.includes('display:none!important;'),
  'source whitespace invisible only in paper printer');
assert(css.includes("img.jfInlineGlyph[data-jf-plate='glyph-ink']"),
  'glyph ink avoids double blending');
assert(css.includes('p:has(img.jfInlineGlyph):not(:has(img:not(.jfInlineGlyph)'),
  'text paragraphs with only glyph images now participate in paper blending');
assert(js.includes('const keyedGlyphs=new Map();'),'scanned paper-glyph normalization available');
assert(js.includes("if(normalized){img.src=normalized;img.dataset.jfPlate='glyph-ink';}"),
  'transparency applied only to cloned printer images');
assert(js.includes("jfDeskPageForAnchor(jfDeskPages,number"),'reading anchor restore retained');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,'7.74.0');
console.log('PASS v7.74: transparent warm glyph ink, clone-only seam removal, content offsets and ink blend');
