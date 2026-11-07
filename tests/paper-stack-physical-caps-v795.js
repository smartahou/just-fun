#!/usr/bin/env node
'use strict';
// The active browser bundle must contain 11 distinct pairs of OFFLINE photos.
// The caps are solid paper with crisp geometric alpha, never a white fade.
const assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const active=require('../assets/paper-stacks/embedded-v795.json');
const last=require('../assets/paper-stacks/embedded-v794.json');
assert.equal(active.version,'7.95.0');
assert.deepEqual(active.canvas,{width:64,height:1440});
assert.equal(active.progress_states.length,11);
const unique=new Set();
let nonempty=0,total=0;
for(let i=0;i<11;i++){
 const row=active.progress_states[i],older=last.progress_states[i];
 assert.equal(row.percent,i*10);
 assert.equal(row.corner_profile,'solid-round-cap-v795');
 assert.equal(row.cap_start_px,12);
 assert.equal(row.cap_full_px,92);
 assert.equal(row.cap_blur_px,0,'no diffuse white fog');
 assert.equal(row.cap_cutoff_alpha,0);
 for(const side of ['left','right']){
  const name='stack-'+String(i*10).padStart(3,'0')+'-'+side+'.webp';
  assert.equal(row[side],name);
  const raw=Buffer.from(row[side+'_base64'],'base64');
  assert.equal(raw.toString('base64'),row[side+'_base64']);
  assert.equal(raw.length,row[side+'_bytes']);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),row[side+'_sha256']);
  assert.equal(raw.toString('ascii',0,4),'RIFF');
  assert.equal(raw.toString('ascii',8,12),'WEBP');
  assert.equal(raw.toString('ascii',12,16),'VP8X');
  assert((raw[20]&0x10)!==0,'real transparent alpha: '+name);
  assert.equal(raw.readUIntLE(24,3)+1,64);
  assert.equal(raw.readUIntLE(27,3)+1,1440);
  const empty=(i===0&&side==='left')||(i===10&&side==='right');
  assert.equal(raw.length<600,empty,'empty only at book endpoints: '+name);
  if(!empty){
   nonempty++;
   assert.notEqual(row[side+'_sha256'],older[side+'_sha256']);
   unique.add(row[side+'_sha256']);
  }
  total+=raw.length;
 }
}
assert.equal(nonempty,20);
assert.equal(unique.size,20);
assert(total>120000&&total<600000,'compact standalone book photos');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const latest=css.slice(css.lastIndexOf('/* v7.95 · Optical paper-edge alignment'));
assert(latest.startsWith('/* v7.95'));
assert(latest.includes('height:calc(var(--jf-page-h) - 6px)'));
assert(latest.includes('filter:none!important')&&latest.includes('mask:none!important'));
assert(!/linear-gradient|radial-gradient|blur\(|drop-shadow\(|pointer-events:auto/.test(latest));
const controller=fs.readFileSync(path.join(root,'src/client/scripts/98e3-paper-stacks.js'),'utf8');
assert(controller.includes('const renderedHeight=Math.max(1,height-2*capInsetPx)'));
assert(!/document\.createElement\(['"]canvas['"]\)|toBlob\(/.test(controller),'no asynchronous canvas per page');
const build=fs.readFileSync(path.join(root,'scripts/build.js'),'utf8');
assert(build.includes("read('assets/paper-stacks/embedded-v796.json')"));
assert(Number(require('../package.json').version.split('.')[1])>=95);
console.log('PASS v7.95 real solid caps, 20 unique photo stacks, 2 empty ends, exact aspect, no blur or async Canvas');
