#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const reader=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
const helper=fs.readFileSync(path.join(root,'src/server/46g-epub-folios.js'),'utf8');
const i=reader.indexOf('function jfReadingXmlDecode('),j=reader.indexOf('const JF_EPUB_ASSET_EXT',i);
const k=reader.indexOf('function jfReadingEpubEntryName('),l=reader.indexOf('// EPUB chapters are re-emitted',k);
assert(i>=0&&j>i&&k>=0&&l>k);
const ctx={require,Buffer,jfReaderZlib:require('node:zlib'),
  jfReadingTextDecode:value=>Buffer.isBuffer(value)?value.toString('utf8'):String(value),
  jfReaderError:(status,message)=>Object.assign(new Error(message),{status})};
vm.createContext(ctx);vm.runInContext(reader.slice(i,j)+'\n'+reader.slice(k,l)+'\n'+helper,ctx,{timeout:10000});
function zip(files){
  let at=0;const data=[],dirs=[];
  for(const [name,text] of Object.entries(files)){
    const file=Buffer.from(name),body=Buffer.from(text);
    const a=Buffer.alloc(30);a.writeUInt32LE(0x04034b50,0);
    a.writeUInt32LE(body.length,18);a.writeUInt32LE(body.length,22);a.writeUInt16LE(file.length,26);
    const local=Buffer.concat([a,file,body]);data.push(local);
    const b=Buffer.alloc(46);b.writeUInt32LE(0x02014b50,0);
    b.writeUInt32LE(body.length,20);b.writeUInt32LE(body.length,24);
    b.writeUInt16LE(file.length,28);b.writeUInt32LE(at,42);
    dirs.push(Buffer.concat([b,file]));at+=local.length;
  }
  const directory=Buffer.concat(dirs),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(dirs.length,8);
  end.writeUInt16LE(dirs.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(at,16);
  return Buffer.concat([...data,directory,end]);
}
const nav='<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>';
const one='<item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>';
const two='<item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>';
const notes='<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>';
function make(manifest,spine,files){
  return ctx.jfReadingEpub(zip({'META-INF/container.xml':
    '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf':'<package><manifest>'+manifest+'</manifest><spine>'+spine+'</spine></package>',...files}));
}
const chapter='<html><body><h1 id="one">正文</h1><p>却顾<a epub:type="noteref" href="notes.xhtml#fn17">[17]</a>翠微。</p><p>[2018]和【评析】保留。</p></body></html>';
const e=make(nav+one+two+notes,
 '<itemref idref="nav"/><itemref idref="one"/><itemref idref="two"/>',{
 'OPS/nav.xhtml':'<html><body><nav epub:type="toc"><ol><li><a href="one.xhtml#one">第一章</a><ol><li><a href="two.xhtml">第二节</a></li></ol></li></ol></nav></body></html>',
 'OPS/one.xhtml':chapter,
 'OPS/two.xhtml':'<html><body><p>正文第二章</p></body></html>',
 'OPS/notes.xhtml':'<html><body><aside epub:type="footnote" id="fn17"><p>字句释义。</p></aside></body></html>'
});
assert.equal(e.chapters[0].paperOmit,'toc-nav');
assert.deepEqual(Array.from(e.toc,x=>x.depth),[0,1]);
assert.deepEqual(Array.from(e.toc,x=>x.chapter),[1,2]);
assert.equal(e.annotations.length,1);
let paper=ctx.jfEpubPaperXhtml(e,'OPS/one.xhtml',chapter);
assert(paper.includes('data-jf-note-id')&&!paper.includes('[17]'));
assert(paper.includes('[2018]')&&paper.includes('【评析】'));
const no=make(one,'<itemref idref="one"/>',{
 'OPS/one.xhtml':'<html><body><p>目录不是导航；[17]也没有注释目标。</p></body></html>'});
assert.equal(no.toc.length,0);assert.equal(no.annotations.length,0);
const legacy='<html><body><p>却顾[17]，翠微[18]。</p><p>年份[2018]。</p>'+
 '<h3>【注释】</h3><p>［17］ 回头看。</p><p>［18］ 青翠山色。</p></body></html>';
const old=make(one,'<itemref idref="one"/>',{'OPS/one.xhtml':legacy});
assert.equal(old.annotations.length,2);
paper=ctx.jfEpubPaperXhtml(old,'OPS/one.xhtml',legacy);
assert.equal((paper.match(/data-jf-note-id/g)||[]).length,2);
assert(!paper.includes('回头看')&&!paper.includes('青翠山色')&&paper.includes('[2018]'));
const ncx='<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>';
const epub2=make(ncx+one+two,'<itemref idref="one"/><itemref idref="two"/>',{
 'OPS/toc.ncx':'<ncx><navMap><navPoint><navLabel><text>第一章</text></navLabel><content src="one.xhtml"/>'+
 '<navPoint><navLabel><text>第二节</text></navLabel><content src="two.xhtml"/></navPoint></navPoint></navMap></ncx>',
 'OPS/one.xhtml':'<html><body><p>正文一</p></body></html>',
 'OPS/two.xhtml':'<html><body><p>正文二</p></body></html>'
});
assert.deepEqual(Array.from(epub2.toc,x=>x.title),['第一章','第二节']);
assert.deepEqual(Array.from(epub2.toc,x=>x.depth),[0,1]);
console.log('PASS actual EPUB ZIP parser: EPUB3+EPUB2 TOC, footnotes, verified numbered notes and conservative fallback');
