#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
const reader=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const tabs=fs.readFileSync(path.join(root,'src/client/scripts/98f-epub-paper-tabs.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const build=require('../build.manifest.json');
assert(build.scripts.indexOf('src/client/scripts/98f-epub-paper-tabs.js')===
  build.scripts.indexOf('src/client/scripts/99-reading.js')-1);
assert(reader.includes('return data.paperHtml||data.html') &&
  reader.includes('renderNotes?.(left,right,jfDeskPaperNotes)'));
assert(css.includes('#jfEpubNoteTab[hidden]')&&css.includes('.jfEpubNoteFlash'));

function decode(s){return String(s).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function attr(tag,key){
  const re=new RegExp('(?:^|\\s)'+key+'\\s*=\\s*["\\x27]([^"\\x27]+)["\\x27]','i');
  return re.exec(tag)?.[1]||'';
}
function toText(html){return decode(String(html).replace(/<[^>]+>/g,'')).trim();}
const zipMock=(files)=>({
  entries:new Map(Object.keys(files).map(k=>[k,{}])),
  read(k){if(!Object.hasOwn(files,k))throw Error('missing '+k);return files[k];}
});
const context={
 require,Map,Set,decodeURIComponent,jfReadingAttr:attr,jfReadingHtmlToText:toText,
 jfReadingXmlDecode:decode,jfReadingTextDecode:String,jfReaderError:(code,message)=>new Error(message),
 jfReaderZipIndex:()=>context.zip,
 jfReadingEpubEntryName:(dir,href)=>{
   if(!href||/^([a-z]+:|\/|\/\/)/i.test(href))return '';
   const rel=decodeURIComponent(decode(href));
   const name=path.posix.normalize(path.posix.join(dir,rel));
   return name.startsWith('../')?'':name;
 }
};
const epubCode=server.slice(server.indexOf('function jfReadingEpub(buf){'),
  server.indexOf('\nconst JF_EPUB_ASSET_EXT'));
assert(epubCode.includes('function jfReadingEpub(buf)'),'EPUB parser extract');
function opf(items,refs){
 return '<package><manifest>'+items.join('')+'</manifest><spine>'+refs.map(id=>'<itemref idref="'+id+'"/>').join('')+'</spine></package>';
}
const container='<container><rootfile full-path="OEBPS/package.opf"/></container>';
const navFiles={
 'META-INF/container.xml':container,
 'OEBPS/package.opf':opf([
   '<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>',
   '<item id="one" href="chapter1.xhtml" media-type="application/xhtml+xml"/>',
   '<item id="two" href="chapter2.xhtml" media-type="application/xhtml+xml"/>'
 ],['nav','one','two']),
 'OEBPS/nav.xhtml':'<html><body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml#start">第一章</a><ol><li><a href="chapter2.xhtml#part">第二节</a></li></ol></li></ol></nav></body></html>',
 'OEBPS/chapter1.xhtml':'<html><body><p id="start">正文开始</p></body></html>',
 'OEBPS/chapter2.xhtml':'<html><body><p id="part">继续阅读</p></body></html>'
};
context.zip=zipMock(navFiles);
let result=vm.runInNewContext(epubCode+';jfReadingEpub(null);',context);
assert.equal(result.chapters.length,3,'keep durable spine indices');
assert.equal(result.chapters[0].paperOmit,'navigation','remove only manifest NAV from printed folios');
assert.equal(result.tocEntries.length,2);
assert.equal(result.tocEntries[0].chapter,1);
assert.equal(result.tocEntries[0].fragment,'start');
assert.equal(result.tocEntries[1].depth,1);
assert.equal(result.tocEntries[1].chapter,2);

const ncxFiles={
 'META-INF/container.xml':container,
 'OEBPS/package.opf':opf([
   '<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
   '<item id="a" href="intro.xhtml" media-type="application/xhtml+xml"/>',
   '<item id="b" href="body.xhtml" media-type="application/xhtml+xml"/>'
 ],['a','b']),
 'OEBPS/toc.ncx':'<ncx><navMap><navPoint><navLabel><text>前言</text></navLabel><content src="intro.xhtml"/><navPoint><navLabel><text>正文</text></navLabel><content src="body.xhtml#begin"/></navPoint></navPoint></navMap></ncx>',
 'OEBPS/intro.xhtml':'<html><body><p>前言可读</p></body></html>',
 'OEBPS/body.xhtml':'<html><body><p id="begin">正文</p></body></html>'
};
context.zip=zipMock(ncxFiles);
result=vm.runInNewContext(epubCode+';jfReadingEpub(null);',context);
assert.equal(result.tocEntries.length,2);
assert.equal(result.tocEntries[1].chapter,1);
assert.equal(result.tocEntries[1].depth,1);
assert.equal(result.chapters[0].paperOmit,undefined,'readable foreword retained');
context.zip=zipMock({
 'META-INF/container.xml':container,
 'OEBPS/package.opf':opf(['<item id="a" href="content.xhtml"/>'],['a']),
 'OEBPS/content.xhtml':'<html><body><h1>目录</h1><p>这里的目录是小说正文。</p></body></html>'
});
result=vm.runInNewContext(epubCode+';jfReadingEpub(null);',context);
assert.equal(result.chapters[0].paperOmit,undefined,'literal 目录 never deleted');
assert.equal(result.tocEntries.length,0,'no synthetic TOC');

const start=server.indexOf('function jfReadingEpubPaperNotes(');
const end=server.indexOf('\nfunction jfReadingEpubChapterHtml(',start);
assert(start>0&&end>start,'note extractor present');
const noteCode=server.slice(start,end);
const noteFiles={
 'OEBPS/chap.xhtml':'<html><body><p>翠微<a epub:type="noteref" href="notes.xhtml#n17">[17]</a>，[2024]年。</p><p>【评析】要保留</p></body></html>',
 'OEBPS/notes.xhtml':'<html><body><aside id="n17" epub:type="footnote"><p>翠微：青翠的山色。</p></aside></body></html>'
};
context.zip=zipMock(noteFiles);
const note=vm.runInNewContext(noteCode+
 ';jfReadingEpubPaperNotes(zip.read("OEBPS/chap.xhtml"),{file:"OEBPS/chap.xhtml"},{zip});',
 {...context,zip:context.zip});
assert.equal(note.notes.length,1,'linked footnote recognized');
assert.match(note.paper,/data-jf-note-ref=/);
assert(!note.paper.includes('[17]'),'linked marker omitted');
assert(note.paper.includes('[2024]'),'unrelated bracketed year preserved');
assert(note.paper.includes('【评析】'),'criticism retained');
assert(note.notes[0].text.includes('青翠的山色'));
const noRef='<html><body><p>第[17]页。</p></body></html>';
const untouched=vm.runInNewContext(noteCode+';jfReadingEpubPaperNotes(raw,{file:"OEBPS/chap.xhtml"},{zip});',
 {...context,raw:noRef,zip:context.zip});
assert.equal(untouched.notes.length,0);
assert.equal(untouched.paper,noRef);
const local='<html><body><p>却顾<a role="doc-noteref" href="#local">[18]</a>，回看。</p><section><ol><li id="local" role="doc-footnote">[18]却顾：回头观看。</li></ol></section><p>【辑评】保留</p></body></html>';
const localNote=vm.runInNewContext(noteCode+';jfReadingEpubPaperNotes(raw,{file:"OEBPS/chap.xhtml"},{zip});',
  {...context,raw:local,zip:context.zip});
assert.equal(localNote.notes.length,1,'nested semantic footnote resolved');
assert(!localNote.paper.includes('role="doc-footnote"'),'matched local note removed from paged copy');
assert(!localNote.paper.includes('[18]'),'visible linked label removed');
assert(localNote.paper.includes('【辑评】'),'separate commentary preserved');
const duplicated='<html><body><p>翠微<a epub:type="noteref" href="notes.xhtml#n17">[17]</a>。复言<a epub:type="noteref" href="notes.xhtml#n17">[17]</a>。</p></body></html>';
const dedup=vm.runInNewContext(noteCode+';jfReadingEpubPaperNotes(raw,{file:"OEBPS/chap.xhtml"},{zip});',
  {...context,raw:duplicated,zip:context.zip});
assert.equal(dedup.notes.length,1,'repeated references dedup by target anchor');
assert.equal((dedup.paper.match(/data-jf-note-ref=/g)||[]).length,2,'both physical anchors preserved');
console.log('PASS v7.80: NAV nested, NCX nested, no TOC, persistent spine, typed cross-file footnote, unlinked numerals retained');
