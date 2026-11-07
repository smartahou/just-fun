#!/usr/bin/env node
'use strict';
// v7.93 · The actual offline bundle, not master WebP references, must have
// recessed shoulders, unique progress pairs, and intact empty endpoints.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const previous=require('../assets/paper-stacks/embedded-v792.json');
const current=require('../assets/paper-stacks/embedded-v793.json');
const pkg=require('../package.json');
const [major,minor]=pkg.version.split('.').map(Number);
assert(major>7||(major===7&&minor>=93),'v7.93 or later required');
assert.equal(current.version,'7.93.0');
assert.deepEqual(current.canvas,{width:64,height:1440});
assert.equal(current.progress_states.length,11);
const digests=new Set();
let changed=0,bytesTotal=0;
for(let i=0;i<11;i++){
  const row=current.progress_states[i];
  const older=previous.progress_states[i];
  assert.equal(row.percent,i*10);
  assert.equal(row.corner_profile,'recessed-rounded-shoulders-v793');
  assert.equal(row.cap_clearance_native_px,26);
  assert.equal(row.cap_fade_complete_native_px,112);
  for(const side of ['left','right']){
    const name=`stack-${String(i*10).padStart(3,'0')}-${side}.webp`;
    assert.equal(row[side],name);
    const b64=row[side+'_base64'];
    const raw=Buffer.from(b64,'base64');
    assert.equal(raw.toString('base64'),b64,name+' canonical base64');
    assert.equal(raw.length,row[side+'_bytes'],name+' byte size');
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),row[side+'_sha256'],name+' checksum');
    assert.equal(raw.toString('ascii',0,4),'RIFF');
    assert.equal(raw.toString('ascii',8,12),'WEBP');
    assert.equal(raw.toString('ascii',12,16),'VP8X');
    assert(raw[20]&0x10,name+' has an alpha channel');
    assert.equal(raw.readUIntLE(24,3)+1,64,name+' width');
    assert.equal(raw.readUIntLE(27,3)+1,1440,name+' height');
    const empty=(i===0&&side==='left')||(i===10&&side==='right');
    assert.equal(raw.length<600,empty,name+' must be empty only at first/last page');
    if(!empty){
      assert.notEqual(row[side+'_sha256'],older[side+'_sha256'],name+' not updated');
      assert(row[side+'_cap_alpha_top_avg']<1,name+' top cap is insufficiently recessed');
      assert(row[side+'_cap_alpha_center_avg']>25,name+' book block is unexpectedly transparent');
      changed++;
      digests.add(row[side+'_sha256']);
    }
    bytesTotal+=raw.length;
  }
}
assert.equal(changed,20);
assert.equal(digests.size,20,'all nonempty photographic pairs unique');
assert(bytesTotal>120000&&bytesTotal<500000,'runtime should remain compact');
const build=fs.readFileSync(path.join(root,'scripts/build.js'),'utf8');
assert(build.includes("read('assets/paper-stacks/embedded-v793.json')"),'builder must embed v7.93 data');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const latest=css.slice(css.lastIndexOf('/* v7.93 · Recessed shoulders'));
assert(latest.startsWith('/* v7.93'));
assert(latest.includes('height:calc(var(--jf-page-h) - 8px)'));
assert(!latest.includes('repeating-linear-gradient')&&!latest.includes('mask-image:')&&!latest.includes('clip-path:polygon'));
console.log('PASS v7.93: 20 unique softened photographic stacks, 2 empty endpoints, native alpha shoulders, builder wired');