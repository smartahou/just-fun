#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const current=require('../assets/paper-stacks/embedded-v794.json');
const previous=require('../assets/paper-stacks/embedded-v793.json');
const pkg=require('../package.json');
assert(Number(pkg.version.split('.')[1])>=94,'v7.94+ baseline retained');
assert.equal(current.version,'7.94.0');
assert.deepEqual(current.canvas,{width:64,height:1440});
assert.equal(current.progress_states.length,11);
let rebuilt=0;
const unique=new Set();
for(let i=0;i<11;i++){
  const row=current.progress_states[i],older=previous.progress_states[i];
  assert.equal(row.percent,i*10);
  assert.equal(row.corner_profile,'solid-opaque-curved-contour-v794');
  assert.equal(row.shoulder_start_px,10);
  assert.equal(row.shoulder_full_px,98);
  assert.equal(row.cap_fade_complete_native_px,undefined);
  for(const side of ['left','right']){
    const name='stack-'+String(i*10).padStart(3,'0')+'-'+side+'.webp';
    assert.equal(row[side],name);
    const b64=row[side+'_base64'],raw=Buffer.from(b64,'base64');
    assert.equal(raw.toString('base64'),b64);
    assert.equal(raw.length,row[side+'_bytes']);
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),row[side+'_sha256']);
    assert.equal(raw.toString('ascii',0,4),'RIFF');
    assert.equal(raw.toString('ascii',8,12),'WEBP');
    assert.equal(raw.toString('ascii',12,16),'VP8X');
    assert(raw[20]&0x10,name+' preserves WebP alpha');
    assert.equal(raw.readUIntLE(24,3)+1,64);
    assert.equal(raw.readUIntLE(27,3)+1,1440);
    const empty=(i===0&&side==='left')||(i===10&&side==='right');
    assert.equal(raw.length<600,empty,'transparent book endpoints');
    if(!empty){
      assert.notEqual(row[side+'_sha256'],older[side+'_sha256']);
      unique.add(row[side+'_sha256']);
      rebuilt++;
    }
  }
}
assert.equal(rebuilt,20);assert.equal(unique.size,20);
const build=fs.readFileSync(path.join(__dirname,'../scripts/build.js'),'utf8');
assert(build.includes("read('assets/paper-stacks/embedded-v797.json')"),'v7.95 is now the active runtime bundle; v7.94 remains the solid-alpha baseline');
const css=fs.readFileSync(path.join(__dirname,'../src/client/styles/41-reading.css'),'utf8');
const last=css.slice(css.lastIndexOf('/* v7.94 · Solid photographic paper edge'),css.indexOf('/* ===== v7.100 · straight-backed hardcover'));
assert(last.startsWith('/* v7.94'));
assert(last.includes('opacity:1!important'));
assert(last.includes('mask:none!important'));
assert(last.includes('mix-blend-mode:normal!important'));
assert(!/linear-gradient|blur\(|drop-shadow\(/.test(last),'no fog/shadow effects');
console.log('PASS v7.94 20 opaque-contour paper edges, 2 fully transparent endpoints, build wired to new data');
