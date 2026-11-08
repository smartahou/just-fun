#!/usr/bin/env node
'use strict';
// v7.106 regression: explicit EPUB illustration captions are bound to their
// single source picture before pagination. Ordinary prose, figures with their
// own captions, and inline glyphs must stay unaltered.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const head=js.indexOf('function jfDeskIsCaption(node){');
const tail=js.indexOf('function jfDeskIsImprintChapter(',head);
assert(head>=0&&tail>head,'caption classifier and standalone plate helpers exist');
const code=js.slice(head,tail);
const simple=(s,hasImage=false,opts={})=>({
  tagName:opts.tag||'P',textContent:s,
  querySelector:(selector)=>(opts.nestedCaption&&selector.includes('figcaption'))||(hasImage&&selector.startsWith('img,'))?{}:null,
  querySelectorAll:()=>hasImage?[{}]:[],
  closest:()=>opts.insideTable?{}:null
});
const finder=vm.runInNewContext(code+'\n({caption:jfDeskIsCaption,plate:jfDeskIsStandalonePlate})',{});
for(const description of [
  '街头剃头匠（画片）','列强瓜分中国（漫画明信片）',
  '列强瓜分中国（漫画）', // not a caption label by itself
]){ if(description.includes('（漫画）'))continue; assert(finder.caption(simple(description)),description); }
for(const description of ['（明信片）','（图 3）','油画《清军》 （插图）','图2：街头剃头匠']){
  assert(finder.caption(simple(description)),description);
}
for(const description of [
  '这是历史上的一段普通文字。',
  '（当年法规另有规定）',
  '英国此时已经受到国际压力（见前文）。',
  '图书资料介绍','街头剃头匠'
])assert(!finder.caption(simple(description)),'must not classify ordinary prose: '+description);
assert(!finder.caption(simple('街头剃头匠（画片）',true)),'text carrying an image is never a caption');
assert(finder.plate(simple('',true)), 'one-image-only p can bind a caption');
assert(!finder.plate(simple('这幅图反映了历史',true)),'prose with inline image never grouped');
assert(!finder.plate(simple('',true,{nestedCaption:true})),'already captioned figure is not nested');
assert(!finder.plate(simple('',true,{insideTable:true})),'table image stays inside table');
assert(!finder.plate(simple('',false)),'text-only paragraph is not a plate');
const at=js.indexOf('function jfDeskBlocksFor(sec){');
const next=js.indexOf('async function jfDeskPagedLayout(',at);
assert(at>0&&next>at);
const source=js.slice(at,next);
assert(source.includes('jfDeskIsStandalonePlate(node)&&jfDeskIsCaption(next)'),'structural binding only');
assert(source.includes("wrap.className='jfPrintPlateWithCaption'"));
assert(source.includes('acc+=node.textContent.length+next.textContent.length'),
 'reader offset advances by both original source blocks');
assert(source.includes('document.importNode(node,true)'), 'source image paragraph not modified');
assert(source.includes("const caption=document.createElement('figcaption')"), 'caption is a measured node');
assert(css.includes('figure.jfPrintPlateWithCaption > figcaption'),'new explicit caption CSS');
assert(css.includes('figure.jfPrintPlateWithCaption > :is(p,div)'),'image alignment is scoped to exact plate');
assert(!css.slice(css.indexOf('/* v7.106 ·')).includes('font-size:'),'no new metrics');
console.log('PASS v7.106 explicit picture captions, safe classifier, cloned atomic figure, original offset, no global text changes');
