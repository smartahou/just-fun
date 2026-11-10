#!/usr/bin/env node
'use strict';
// v7.110: two source-verified embedded fonts and strict pre-pagination loading.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fontDir='assets/fonts/book-serif';
const meta=JSON.parse(read(fontDir+'/manifest.json'));
const buildManifest=JSON.parse(read('build.manifest.json'));
const source=read('src/client/scripts/99-reading.js');
const build=read('scripts/build.js');
const pkg=require('../package.json');
const [major,minor]=pkg.version.split('.').map(Number);
assert(major>7||(major===7&&minor>=110),'v7.110 embedded-font contract must survive later versions');
assert.equal(buildManifest.fontAssets.manifest,fontDir+'/manifest.json');
assert.equal(meta.source_tag,'1.000R');
assert(meta.originals_match_user_upload);
assert.equal(meta.family,'JustFun Book Serif CN');
assert.equal(meta.files.length,2);
assert.deepEqual(meta.files.map(x=>x.weight),[400,600]);
assert.equal(meta.files[0].original_sha256,'1ddaf8183212f81e5b9a5b8c87a24aab8b7d2ff8f05eb3f6eaab341a7a285e58');
assert.equal(meta.files[1].original_sha256,'c058c0bd712ff3d9e9176a22650de8d0dcdb15396235cb6e3e373e6dc455d7bc');
const license=read(fontDir+'/OFL-1.1.txt');
assert(license.includes('SIL OPEN FONT LICENSE')&&license.includes('Version 1.1'));
for(const x of meta.files){
  const raw=fs.readFileSync(path.join(root,fontDir,x.filename));
  assert.equal(raw.toString('ascii',0,4),'wOF2');
  assert.equal(raw.byteLength,x.bytes);
  assert.equal(hash(raw),x.sha256,'font build reproducible and integrity-checked');
  assert(x.glyphs>=20000,'historical CJK coverage should be broader than basic simplified Chinese');
}
assert(build.includes('function bundleBookFonts()'),'fonts explicitly embedded at build time');
assert(build.includes("bookFontBundle.css+manifest.styles.map(read).join('')"));
assert(build.includes('src:url("data:font/woff2;base64,'));
assert(build.includes('embeddedBookFonts:bookFontBundle.fonts'));
assert(!build.includes('https://fonts.googleapis.com'),'no remote font dependency');
assert(source.includes("serif:\"'JustFun Book Serif CN','Source Han Serif SC'"),'system fallback retained');
assert(source.includes("const jfDeskBookFontVersion='SourceHanSerifCN-1.000R-GBK-7.110'"));
assert(source.includes("jfDeskBookFontVersion,jfDeskPrefs.font"),'font version participates in chapter layout signature');
assert(source.includes("const view=document.getElementById('jfPageView');\n  view.style.setProperty('--jf-read-font'")&&
       source.includes("view.style.setProperty('--jf-read-family'"),
  'paper layout sets the real text font and size before measuring');
assert(source.includes("await jfDeskEnsureBookFonts();\n    }\n    window.JFEpubPaperToc?.close()"),
  'switching from continuous to paged mode awaits the embedded serif');
assert(source.includes('await jfDeskEnsureBookFonts();\n  try{ if(document.fonts'),'measurement awaits explicit face readiness');
assert(source.includes("if(!outline.nativePdf){\n      await jfDeskEnsureBookFonts();"),'first opening awaits fonts');
assert(source.includes('await jfDeskEnsureBookFonts();\n    if(token!==jfDeskCensusToken'),
  'continuous physical census awaits the same font before counting');
assert(source.includes("document.fonts.load('400 18px \"JustFun Book Serif CN\"'"));
assert(source.includes("document.fonts.load('600 18px \"JustFun Book Serif CN\"'"));

const first=source.indexOf("const jfDeskBookFontVersion='"),last=source.indexOf('// v7.108 ·',first);
assert(first>=0&&last>first);
const fontCalls=[];
const ctx={jfDeskPrefs:{family:'serif'},window:{},
  document:{fonts:{
    load:async(font,phrase)=>{fontCalls.push({font,phrase});return [{status:'loaded'}];},
    check:()=>true
  }},console,Promise};
const api=vm.runInNewContext(source.slice(first,last)+'\n({ensure:jfDeskEnsureBookFonts,status:window.JFReaderEmbeddedBookFonts})',ctx);
(async()=>{
  assert(await api.ensure());
  assert(await api.ensure());
  assert.equal(fontCalls.length,2,'only first request loads 400 and 600');
  assert(api.status().ready);
  ctx.jfDeskPrefs.family='kai';
  assert(await api.ensure());
  assert.equal(fontCalls.length,2,'other font choices do not reload book serif');
  ctx.jfDeskPrefs.family='serif';
  assert(await api.ensure());
  assert.equal(fontCalls.length,2,'already loaded fonts reused');
  console.log('PASS v7.110: exact user 1.000 OTF hashes, two WOFF2 subsets, OFL, offline build, font-before-layout and census');
})().catch(e=>{console.error(e);process.exitCode=1});
