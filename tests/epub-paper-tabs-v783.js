#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const assets=fs.readFileSync(path.join(root,'src/client/scripts/98e5-paper-tab-assets.js'),'utf8');
const tabs=fs.readFileSync(path.join(root,'src/client/scripts/98f-epub-paper-tabs.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const server=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
const manifest=require('../build.manifest.json');
const window={};
vm.runInNewContext(assets,{window});
for(const name of ['toc','notes']){
  const data=window.JFPaperTabImages?.[name];
  assert(data?.startsWith('data:image/webp;base64,'),'real image data URI: '+name);
  const bytes=Buffer.from(data.split(',')[1],'base64');
  assert(bytes.length>1200,'not a placeholder sketch: '+name);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
}
assert.notEqual(window.JFPaperTabImages.toc,window.JFPaperTabImages.notes,'supplied artwork differs');
const index=manifest.scripts.indexOf('src/client/scripts/98f-epub-paper-tabs.js');
assert(index>0);
assert.equal(manifest.scripts[index-1],'src/client/scripts/98e5-paper-tab-assets.js',
  'offline images load before EPUB paper-tab controller');
assert(tabs.includes("window.JFPaperTabImages.toc")&&tabs.includes("window.JFPaperTabImages.notes"),
  'both bookmarks use the real user pictures');
assert(css.includes('background-image:var(--jf-tab-image)!important'),
  'CSS uses the user images rather than a recreated vector icon');
const start=tabs.indexOf('function inkWordBounds(value){');
const end=tabs.indexOf('\n  function flash(anchor){',start);
assert(start>=0&&end>start,'word range helper exists');
const wordBounds=vm.runInNewContext(tabs.slice(start,end)+'\ninkWordBounds');
function picked(source){const range=wordBounds(source);return range?source.slice(...range):'';}
assert.equal(picked('长安一片月，万户捣衣声。'),'万户捣衣声','Chinese stop is not highlighted');
assert.equal(picked('秋风吹不尽，'),'秋风吹不尽','Chinese comma is not highlighted');
assert.equal(picked('汉字？！ '),'汉字','punctuation and spaces excluded');
assert.equal(picked('。！、'),'', 'punctuation-only context yields no flash');
assert(css.includes('background-color:transparent!important;')&&
 css.includes(':has(.jfSheet[data-paper-group]) .jfBookBoard'),
 'photographed alpha is not covered by old cream sheet or board');
const hintStart=server.indexOf('function jfReadingEpubImageLayoutHints(tag){');
const hintEnd=server.indexOf('\n// Extract only notes whose targets',hintStart);
assert(hintStart>=0&&hintEnd>hintStart,'sanitizer hint function boundaries');
const detect=vm.runInNewContext(server.slice(hintStart,hintEnd)+
'\njfReadingEpubImageLayoutHints',{
  jfReadingAttr:(t,key)=>t[key]||'',jfReadingXmlDecode:x=>x
});
const real={
 class:'kindle-cn-inline-image',src:'../images/00003.jpeg',alt:'075-01'
};
assert(detect(real).includes('data-jf-glyph-hint="1"'),
  'actual Tang-poetry 34x34 gaiji class crosses server-to-client sanitizer');
assert(!detect({class:'photo',src:'../images/view.jpeg',alt:'landscape'}).includes('glyph-hint'),
  'unrelated historical plates must remain full images');
console.log('PASS v7.83: real bitmap tabs, offline load, punctuation-free flash, alpha edge, Calibre gaiji propagation');
