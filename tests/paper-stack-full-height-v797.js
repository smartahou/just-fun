#!/usr/bin/env node
'use strict';
// v7.97: a book's pages are nearly the same height as its side block.
// Only the individual physical corners recede; never shrink the full strip.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const pack=require('../assets/paper-stacks/embedded-v797.json');
const older=require('../assets/paper-stacks/embedded-v796.json');
assert.equal(require('../package.json').version,'7.97.0');
assert.equal(pack.version,'7.97.0');
assert.deepEqual(pack.canvas,{width:64,height:1440});
assert.equal(pack.progress_states.length,11);
const unique=new Set();
let bytesTotal=0;
for(let i=0;i<11;i++){
  const row=pack.progress_states[i];
  assert.equal(row.percent,i*10);
  assert.equal(row.corner_profile,'full-height-shallow-corners-v797');
  assert.equal(row.full_height_geometry,true);
  assert.equal(row.corner_recess_max_native_px,36);
  for(const side of ['left','right']){
    const name=`stack-${String(i*10).padStart(3,'0')}-${side}.webp`;
    assert.equal(row[side],name);
    const encoded=row[side+'_base64'],raw=Buffer.from(encoded,'base64');
    assert.equal(raw.toString('base64'),encoded,name+' canonical base64');
    assert.equal(raw.length,row[side+'_bytes']);
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),row[side+'_sha256']);
    assert.equal(raw.toString('ascii',0,4),'RIFF');
    assert.equal(raw.toString('ascii',8,12),'WEBP');
    assert.equal(raw.toString('ascii',12,16),'VP8X');
    assert(raw[20]&0x10,'real alpha: '+name);
    assert.equal(raw.readUIntLE(24,3)+1,64);
    assert.equal(raw.readUIntLE(27,3)+1,1440);
    const empty=(i===0&&side==='left')||(i===10&&side==='right');
    assert.equal(raw.length<600,empty,'empty ends only');
    if(!empty){
      unique.add(row[side+'_sha256']);
      assert.notEqual(row[side+'_sha256'],older.progress_states[i][side+'_sha256']);
      assert.equal(row[side+'_opaque_first'],0,'tiny top-corner allowance');
      assert(row[side+'_opaque_near']>0,'no v7.96 59px top blank');
      assert(row[side+'_opaque_middle']>=row[side+'_opaque_near'],'shortened corner');
      assert.equal(row[side+'_opaque_last'],0,'tiny bottom-corner allowance');
    }
    bytesTotal+=raw.length;
  }
}
assert.equal(unique.size,20,'20 independent photos');
assert(bytesTotal>60000&&bytesTotal<250000,'compact offline bundle');
const js=fs.readFileSync(path.join(root,'src/client/scripts/98e3-paper-stacks.js'),'utf8');
assert(js.includes('(height*nativeWidth/nativeHeight).toFixed(3)'),'book-block aspect follows full sheet');
assert(!js.includes('capInsetPx'),'no shrinking in controller');
assert(!/toBlob\(|getImageData\(|createObjectURL\(/.test(js),'no runtime canvas');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const live=css.slice(css.lastIndexOf('/* v7.97 · Full-height physical page block'));
assert(live.startsWith('/* v7.97'));
assert(live.includes('height:var(--jf-page-h)!important;'));
assert(live.includes('top:calc(50% - var(--jf-page-h)/2)!important;'));
assert(live.includes("right:calc(50% + var(--jf-page-w) - 11px)!important;"));
assert(live.includes("left:calc(50% + var(--jf-page-w) - 11px)!important;"));
assert(!/blur\(|drop-shadow\(|linear-gradient\(|radial-gradient\(|mask-image/.test(live),'no fog');
const build=fs.readFileSync(path.join(root,'scripts/build.js'),'utf8');
assert(build.includes("read('assets/paper-stacks/embedded-v797.json')"));
console.log('PASS v7.97: near-full-height physical book block, 20 shallow-corner WebPs, no fake shrinking');
