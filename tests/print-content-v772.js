#!/usr/bin/env node
'use strict';
// v7.72 — Test the exact glyph and gallery classifiers, not just their presence.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
const p=js.indexOf('function jfDeskIsInlineGlyphShape(');
const q=js.indexOf('function jfDeskBlocksFor(sec){',p);
assert(p>=0&&q>p,'glyph functions precede block creation');
const glyphCode=js.slice(p,q);
const shape=vm.runInNewContext(glyphCode+'\njfDeskIsInlineGlyphShape');
assert(shape(40,44,'遗诏藏于','匣，再将其放在乾清宫'), 'CJK image glyph with surrounding prose');
assert(!shape(420,440,'遗诏藏于','匣，再将其放在乾清宫'),'historical photograph is not a glyph');
assert(!shape(60,120,'遗诏藏于','匣，再将其放在乾清宫'),'portrait aspect is not a glyph');
assert(!shape(42,38,'','正文之后'),'standalone image not treated as an inline character');
assert(!shape(42,38,'写字',''),'right-side prose required');
assert(!shape(42,38,'123456','789011'),'non-Han inline image not automatically changed');
const classes=new Set();
const para={querySelectorAll(){return [image]}};
const image={naturalWidth:42,naturalHeight:44,dataset:{},
  classList:{add(v){classes.add(v)},contains(v){return classes.has(v)}},
  closest(q){return q.includes('figure,figcaption')?null:para}
};
const rootStub={querySelectorAll(){return [image]}};
let part='';
const range={
  selectNodeContents(){},setEndBefore(){part='before'},setStartAfter(){part='after'},
  toString(){return part==='before'?'遗诏藏于':'匣，然后藏于乾清宫'}
};
const glyph=vm.runInNewContext(glyphCode+'\njfDeskMarkInlineGlyphs',{
  document:{createRange(){return range}}
});
glyph(rootStub);
assert(classes.has('jfInlineGlyph')&&image.dataset.jfInlineGlyph==='1','real markup is tagged before clone');
const g=js.indexOf('function jfDeskIsPlateGalleryPage(');
const h=js.indexOf('function jfDeskPagedRender(direction){',g);
assert(g>=0&&h>g,'gallery classifier exists');
const gallery=vm.runInNewContext(js.slice(g,h)+'\njfDeskIsPlateGalleryPage',{
  jfDeskIsCaption(n){return n.tagName==='P'&&/^[（(]/.test(n.textContent||'')}
});
const pic=(caption='')=>({tagName:'FIGURE',textContent:caption,
  classList:{contains(){return false}},
  querySelectorAll(){return [{}]},
  querySelector(q){return q==='figcaption'?{textContent:caption}:null}
});
const prose=t=>({tagName:'P',textContent:t,
  querySelectorAll(){return []},querySelector(){return null}});
const blocks=(...nodes)=>nodes.map(node=>({node}));
assert(gallery(blocks(pic('衙门公堂（明信片）'),pic('衙门公堂（明信片）'))),'two-photo gallery');
assert(!gallery(blocks(pic(),prose('长段正文不能当成画册'))),'photo with prose is not gallery');
assert(!gallery(blocks(pic())),'single photo uses existing isolated plate');
assert(!gallery(blocks(pic(),pic(),pic())),'three photos not forced into a two-photo template');
assert(!gallery(blocks(prose('普通正文'),prose('下一段'))),'prose is not gallery');
assert(js.includes('jfDeskMarkInlineGlyphs(sec.el);'),'source classified before pagination clone');
assert(js.includes("node.querySelector('img:not(.jfInlineGlyph)')"),'glyph cannot capture following caption');
assert(js.includes("if(img.classList?.contains('jfInlineGlyph')){img.dataset.jfPlate='glyph';return;}"),'no destructive pixel knockout on glyph');
assert(js.includes("jfDeskIsPlateGalleryPage(pageA)")&&js.includes("jfDeskIsPlateGalleryPage(pageB)"),'both pages get gallery state');
assert(css.includes('.jfSheetBody img.jfInlineGlyph{')&&css.includes('display:inline-block!important'),'bitmap remains in text');
assert(css.includes('vertical-align:-.11em!important'),'glyph aligns to writing baseline');
assert(css.includes('.jfSheet.jf-plate-gallery .jfSheetBody{'),'gallery controls isolated');
assert(engine.includes('if(hasImage(el))return null;'),'inline glyph paragraph is still atomic (never lose image at Range split)');
assert(js.includes('jfDeskPageForAnchor(jfDeskPages,number'),'reading-progress anchors preserved');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,'7.72.0');
console.log('PASS v7.72: inline glyph recognition, safe pagination, two-photo gallery and exclusions');
