#!/usr/bin/env node
'use strict';
// v7.92: rounded real-alpha outer paper stacks, 11 paired progress states.
// Both runtime and build use the NEW verified bundle. Older sources remain
// available for rollback; no CSS fake comb or destructive image editing.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const old=require('../assets/paper-stacks/embedded-v790.json');
const next=require('../assets/paper-stacks/embedded-v792.json');
const pkg=require('../package.json');
const [major,minor]=pkg.version.split('.').map(Number);
assert(major>7||(major===7&&minor>=92),'v7.92 baseline retained');
assert.deepEqual(next.canvas,{width:64,height:1440});
assert.equal(next.progress_states.length,11);
const unique=new Set();
let changed=0, total=0;
for(let i=0;i<11;i++){
  const state=next.progress_states[i], before=old.progress_states[i];
  assert.equal(state.percent,i*10);
  assert.equal(state.corner_profile,'round-natural-alpha-v792');
  for(const side of ['left','right']){
    const name='stack-'+String(i*10).padStart(3,'0')+'-'+side+'.webp';
    assert.equal(state[side],name);
    const b64=state[side+'_base64'];
    assert.equal(typeof b64,'string',name);
    const bytes=Buffer.from(b64,'base64');
    assert.equal(bytes.toString('base64'),b64);
    assert.equal(bytes.length,state[side+'_bytes']);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),state[side+'_sha256']);
    assert.equal(bytes.toString('ascii',0,4),'RIFF');
    assert.equal(bytes.toString('ascii',8,12),'WEBP');
    assert.equal(bytes.toString('ascii',12,16),'VP8X');
    assert(bytes[20]&0x10,'requires real WebP alpha: '+name);
    assert.equal(bytes.readUIntLE(24,3)+1,64);
    assert.equal(bytes.readUIntLE(27,3)+1,1440);
    const empty=(i===0&&side==='left')||(i===10&&side==='right');
    assert.equal(bytes.length<600,empty,'endpoints must be empty only at 0/100: '+name);
    if(!empty){
      assert.notEqual(state[side+'_sha256'],before[side+'_sha256'],'cap silhouette was not rebuilt: '+name);
      changed++;
      unique.add(state[side+'_sha256']);
    }
    total+=bytes.length;
  }
}
assert.equal(changed,20);
assert.equal(unique.size,20);
assert(total>90000&&total<800000,'offline photographic assets within intended budget');
const build=fs.readFileSync(require('node:path').join(__dirname,'../scripts/build.js'),'utf8');
assert(build.includes("read('assets/paper-stacks/embedded-v797.json')"),'v7.95 must be active; v7.92 is retained as rollback reference');
const css=fs.readFileSync(require('node:path').join(__dirname,'../src/client/styles/41-reading.css'),'utf8');
const p=css.slice(css.lastIndexOf('/* v7.92 · Silhouette-matched photographic fore-edge */'));
assert(p.startsWith('/* v7.92'));
assert(p.includes("data-side='left'")&&p.includes("data-side='right'"));
assert(p.includes('--jf-page-w')&&p.includes('height:calc(var(--jf-page-h) - 4px)'));
assert(!p.includes('repeating-linear-gradient')&&!p.includes('clip-path:polygon'),'no new fake striation or rectangular mask');
console.log('PASS v7.92: 20 rebuilt curved-alpha sides, 2 empty ends, new offline runtime bundle wired, no fake CSS pile');
