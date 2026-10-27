'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../src/server/47-pdf-engine.js'),'utf8');
const ctx={Buffer,console,process,Map,Promise,Error,Set};vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'47-pdf-engine.js'});
const doc='C:\\书房\\目录\\一本书 (增订版).pdf';
for(const p of [0,1,342]){
 const script=ctx.jfPdfWindowsScript(doc,p,960);
 assert(script.includes('GetFileFromPathAsync'),'WinRT must open a real file');
 assert(script.includes('Windows.Data.Pdf.PdfDocument'),'actual PDF rendering source');
 assert(script.includes('JF_PDF_STAGE:load'),'diagnostics reveal failure stage');
 assert(script.includes('JF_PDF_STAGE:render') || p===0,'actual page render');
 assert(!script.includes('New-Object Windows.Storage.Streams.DataReader('),'fragile WinRT DataReader pipeline removed');
 assert(script.includes('AsStreamForRead') || p===0,'native stream bridge used');
 assert(!script.includes(doc),'path must be encoded, not interpolated raw');
 assert(script.includes(Buffer.from(doc).toString('base64')),'UTF8 roundtrip must survive Chinese paths');
 console.log('PASS generated Windows PDF rendering script '+p);
}
console.log('TOTAL 3/3 (STATIC, Windows execution not verified)');
