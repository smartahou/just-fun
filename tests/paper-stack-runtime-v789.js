#!/usr/bin/env node
'use strict';
// v7.89 · archived paper photos are the chromatic source for pre-rendered
// 11-stage thin paper layers. Verify the exact runtime bundle, never mistake
// a generated display collage for the actual file used by the reader.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const bundle=require('../assets/paper-stacks/embedded-v789.json');
const states=bundle.data;
assert.equal(bundle.format,'WebP RGBA 64x1440');
assert.equal(states.length,11);
const hashes=[];
for(let i=0;i<11;i++){
  const state=states[i];
  assert.equal(state.percent,i*10,'progress stage order');
  for(const side of ['left','right']){
    const source=state[side];
    assert.equal(typeof source,'string');
    const bytes=Buffer.from(source,'base64');
    assert.equal(bytes.toString('base64'),source,'base64 exact round-trip');
    assert.equal(bytes.toString('ascii',0,4),'RIFF');
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
    assert.equal(bytes.toString('ascii',12,16),'VP8X');
    assert(bytes[20]&0x10,'alpha channel must be present');
    assert.equal(bytes.readUIntLE(24,3)+1,64,'native width');
    assert.equal(bytes.readUIntLE(27,3)+1,1440,'native height');
    const sha=crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(state[side+'_sha256'],sha,'source image sha');
    hashes.push(sha);
  }
}
assert.equal(hashes.length,22);
assert.equal(hashes[0],hashes[21],'0% left and 100% right both transparent');
assert.notEqual(hashes[1],hashes[20],'opposite book endpoints are distinct');
assert(new Set(hashes).size>=20,'independent progress states');
const build=fs.readFileSync(path.join(root,'scripts/build.js'),'utf8');
assert(build.includes("assets/paper-stacks/embedded-v789.json"),'builder uses real new bundle');
assert(build.includes('paperStackRebuiltAssetsSha256'),'build exposes independent runtime hash manifest');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
assert(css.includes('/* v7.89 · A stack must tuck UNDER'),'edge joint is part of the design');
assert(css.includes('height:calc(var(--jf-page-h) - 4px)'),'top and bottom edges recessed');
console.log('PASS v7.89 11 paired source-derived stacks, dimensions, alpha, hashes, and builder wiring');
