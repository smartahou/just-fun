'use strict';
// v7.06 regression against 1,158 v7.05 frozen geometry results.
// All cases are page-local; no network, DOM, storage or user media path.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const moduleCode=fs.readFileSync(path.join(ROOT,'src/client/scripts/98b-pdf-geometry.js'),'utf8');
const fixtureFile=path.join(__dirname,'fixtures/pdf-geometry-v705-golden.json');
const fixtureBuffer=fs.readFileSync(fixtureFile);
const expectedSha='d91f3ed0928ddaa436281d4d9dbc6758184d30b9e44bc6fc2ebad16a5cfc13b6';
assert.strictEqual(crypto.createHash('sha256').update(fixtureBuffer).digest('hex'),expectedSha,'v7.05 reference fixture modified');
const fixture=JSON.parse(fixtureBuffer.toString('utf8'));
assert.strictEqual(fixture.baselineSourceSha256,'6d68860fa41a585870aefc91dddd44c798ba36dc6a47397aba060458a29e7265');
assert.strictEqual(fixture.sampleCount,1158);
// Deliberately expose no document, window, fetch, canvas, storage or workspace.
const context=vm.createContext({});
const geometry=vm.runInContext(`${moduleCode}\njfPdfGeometry`,context,{timeout:2000});
assert(Object.isFrozen(geometry),'pure facade must be immutable');
assert.deepStrictEqual(Object.keys(geometry).sort(),['closestRow','normalized','paragraphGroups','segments','stripPadding'].sort());
let verified=0,failures=[];
for(let i=0;i<fixture.samples.length;i++){
  const {op,args,expected}=fixture.samples[i];
  const before=JSON.stringify(args);
  let actual;
  try{actual=JSON.parse(JSON.stringify(geometry[op](...args)));}
  catch(e){actual={error:String(e.message)};}
  if(JSON.stringify(actual)!==JSON.stringify(expected)){
    failures.push({case:i,op,args,expected,actual});
    if(failures.length===3)break;
  }
  assert.strictEqual(JSON.stringify(args),before,`unexpected input mutation at case ${i}`);
  verified++;
}
assert.deepStrictEqual(failures,[],'legacy PDF geometry parity');
// Explicitly verify the position-based old API still delegates the same numeric model.
const old=fs.readFileSync(path.join(ROOT,'src/client/scripts/99a-pdfjs.js'),'utf8');
for(const n of ['jfPdfCaptureClosestRow','jfPdfCaptureParagraphGroups','jfPdfCaptureStripPadding','jfPdfCaptureSegments','jfPdfCaptureNormalized']){
  assert(old.includes(`function ${n}(`),`legacy ${n} missing`);
  assert(old.includes('jfPdfGeometry.'),`geometry facade not wired: ${n}`);
}
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'build.manifest.json'),'utf8'));
assert(manifest.scripts.indexOf('src/client/scripts/98b-pdf-geometry.js')>manifest.scripts.indexOf('src/client/scripts/98a-txt-presentation.js'));
assert(manifest.scripts.indexOf('src/client/scripts/98b-pdf-geometry.js')<manifest.scripts.indexOf('src/client/scripts/99a-pdfjs.js'));
console.log('PASS PDF GEOMETRY v7.06: '+verified+'/1158 golden arithmetic cases, immutable facade, compatibility interfaces, offline script order.');
