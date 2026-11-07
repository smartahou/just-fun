#!/usr/bin/env node
'use strict';
// v7.96 checks the actual embedded offline folio-edge WebPs, not unused legacy strips.
const assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const root=path.join(__dirname,'..');
const current=require('../assets/paper-stacks/embedded-v796.json');
const prior=require('../assets/paper-stacks/embedded-v795.json');
assert.equal(require('../package.json').version,'7.96.0');
assert.equal(current.version,'7.96.0');
assert.deepEqual(current.canvas,{width:64,height:1440});
assert.equal(current.progress_states.length,11);
const seen=new Set();
let nonempty=0,total=0;
for(let i=0;i<11;i++){
  const r=current.progress_states[i],old=prior.progress_states[i];
  assert.equal(r.percent,i*10);
  assert.equal(r.corner_profile,'scan-derived-fine-lamina-v796');
  assert.equal(r.layer_pitch_native_px,3.15);
  for(const side of ['left','right']){
    const name='stack-'+String(i*10).padStart(3,'0')+'-'+side+'.webp';
    assert.equal(r[side],name);
    const b64=r[side+'_base64'],bytes=Buffer.from(b64,'base64');
    assert.equal(bytes.toString('base64'),b64);
    assert.equal(bytes.length,r[side+'_bytes']);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),r[side+'_sha256']);
    assert.equal(bytes.toString('ascii',0,4),'RIFF');
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
    assert.equal(bytes.toString('ascii',12,16),'VP8X');
    assert((bytes[20]&0x10)!==0,name+' must have real alpha');
    assert.equal(bytes.readUIntLE(24,3)+1,64);
    assert.equal(bytes.readUIntLE(27,3)+1,1440);
    const empty=(i===0&&side==='left')||(i===10&&side==='right');
    assert.equal(bytes.length<600,empty,'transparent book start/end');
    if(!empty){
      assert.notEqual(r[side+'_sha256'],old[side+'_sha256'],'wood-textured material must be replaced');
      nonempty++;
      seen.add(r[side+'_sha256']);
    }
    total+=bytes.length;
  }
}
assert.equal(nonempty,20);
assert.equal(seen.size,20);
assert(total>60000&&total<220000,'offline paper edge budget');
const build=fs.readFileSync(path.join(root,'scripts/build.js'),'utf8');
assert(build.includes("read('assets/paper-stacks/embedded-v796.json')"));
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const section=css.slice(css.lastIndexOf('/* v7.96 · Thin folio edges'));
assert(section.startsWith('/* v7.96'));
assert(section.includes("data-side='left'")&&section.includes("data-side='right'"));
assert(!/blur\(|drop-shadow\(|gradient\(|mask-image|clip-path:polygon/.test(section),'no faux paper fog');
const js=fs.readFileSync(path.join(root,'src/client/scripts/98e3-paper-stacks.js'),'utf8');
assert(js.includes('--jf-stack-art-width'));
assert(!/toBlob\(|createObjectURL\(|getImageData\(/.test(js),'no runtime canvas or asynchronous resampling');
console.log('PASS v7.96: 20 fine-lamina WebPs, 2 empty ends, exact alpha/size/sha, correct offline wiring');
