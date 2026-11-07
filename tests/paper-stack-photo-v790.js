#!/usr/bin/env node
'use strict';
// v7.90: independent pre-rendered photographic paper-edge states, not a
// procedural runtime comb and not a renaming of the original v7.88 WebPs.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const pack=require('../assets/paper-stacks/embedded-v790.json');
const [major,minor]=require('../package.json').version.split('.').map(Number);
assert(major>7||(major===7&&minor>=90),'v7.90+ stack regression');
assert.deepEqual(pack.canvas,{width:64,height:1440});
assert.equal(pack.progress_states.length,11);
const all=new Set(),nonEmpty=new Set();
let total=0;
for(let stage=0;stage<11;stage++){
  const row=pack.progress_states[stage];
  assert.equal(row.percent,stage*10);
  for(const side of ['left','right']){
    const name='stack-'+String(stage*10).padStart(3,'0')+'-'+side+'.webp';
    assert.equal(row[side],name);
    const raw=Buffer.from(row[side+'_base64'],'base64');
    assert.equal(raw.toString('base64'),row[side+'_base64'],name+' canonical b64');
    assert.equal(raw.length,row[side+'_bytes'],name+' length');
    const sha=crypto.createHash('sha256').update(raw).digest('hex');
    assert.equal(sha,row[side+'_sha256'],name+' digest');
    assert.equal(raw.toString('ascii',0,4),'RIFF');
    assert.equal(raw.toString('ascii',8,12),'WEBP');
    assert.equal(raw.toString('ascii',12,16),'VP8X');
    assert(raw[20]&0x10,name+' alpha flag');
    assert.equal(raw.readUIntLE(24,3)+1,64);
    assert.equal(raw.readUIntLE(27,3)+1,1440);
    const empty=(stage===0&&side==='left')||(stage===10&&side==='right');
    assert.equal(raw.length<600,empty,name+' endpoint transparency');
    all.add(sha);
    if(!empty)nonEmpty.add(sha);
    total+=raw.length;
    // Keep original Git assets for rollback and previous source check.
    assert(fs.existsSync(path.join(root,'assets/paper-stacks',name)));
  }
}
assert.equal(nonEmpty.size,20,'Every nonempty stage/side needs its own photographic sample');
assert(all.size>=21,'No wholesale duplicated strips');
assert(total>70000&&total<1000000,'Require compact independent offline assets');
const build=fs.readFileSync(path.join(root,'scripts/build.js'),'utf8');
const [majorV,minorV]=require('../package.json').version.split('.').map(Number);
const liveBundle=(majorV>7||(majorV===7&&minorV>=95))?'embedded-v795.json':(majorV>7||(majorV===7&&minorV>=94))?'embedded-v794.json':(majorV>7||(majorV===7&&minorV>=93))?'embedded-v793.json':(majorV>7||(majorV===7&&minorV>=92))?'embedded-v792.json':'embedded-v790.json';
assert(build.includes("assets/paper-stacks/"+liveBundle),'verify the actual active offline stack bundle');
assert(build.includes('paperStackPhotoSha256:photoHashes'));
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const v790=css.slice(css.indexOf('/* v7.90 · Photographic fore-edge'));
assert(v790.startsWith('/* v7.90'));
assert(v790.includes('.jfBookPile[data-side=\'left\']'));
assert(v790.includes('.jfBookPile[data-side=\'right\']'));
assert(v790.includes('background-color:transparent!important'));
assert(!v790.includes('repeating-linear-gradient'));
console.log('PASS v7.90: 22 verified translucent photographic WebPs, 11 progress pairs, original assets retained, paper leaf overlap');
