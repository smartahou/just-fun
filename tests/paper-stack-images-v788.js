#!/usr/bin/env node
'use strict';
// v7.88 · exact user-provided 11-pair stack pack and real DOM rendering rules.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const meta=require('../assets/paper-stacks/manifest.json');
const build=require('../build.manifest.json');
const [major,minor]=require('../package.json').version.split('.').map(Number);
assert(major>7||(major===7&&minor>=90),'v7.90+ stack regression');
assert.deepEqual(meta.canvas,{width:64,height:1440});
assert.equal(meta.progress_states.length,11);
assert.equal(build.stackAssets.files.length,22);
assert.equal(build.stackAssets.manifest,'assets/paper-stacks/manifest.json');
let total=0;
for(let i=0;i<11;i++){
  const state=meta.progress_states[i];
  assert.equal(state.percent,10*i);
  for(const [j,side] of ['left','right'].entries()){
    const file='stack-'+String(i*10).padStart(3,'0')+'-'+side+'.webp';
    assert.equal(state[side],file);
    assert.equal(build.stackAssets.files[i*2+j],'assets/paper-stacks/'+file);
    const b=fs.readFileSync(path.join(root,'assets/paper-stacks',file));
    assert.equal(b.length,state[side+'_bytes'],file+' byte count');
    assert.equal(crypto.createHash('sha256').update(b).digest('hex'),state[side+'_sha256'],file+' SHA');
    assert.equal(b.toString('ascii',0,4),'RIFF');
    assert.equal(b.toString('ascii',8,12),'WEBP');
    assert.equal(b.toString('ascii',12,16),'VP8L');
    const bits=b.readUInt32LE(21);
    assert.equal((bits&0x3fff)+1,64);
    assert.equal(((bits>>>14)&0x3fff)+1,1440);
    total+=b.length;
  }
  if(i>0){
    assert(state.left_visible_px>=meta.progress_states[i-1].left_visible_px,'left monotonic');
    assert(state.right_visible_px<=meta.progress_states[i-1].right_visible_px,'right monotonic');
  }
}
assert.equal(meta.progress_states[0].left_visible_px,0);
assert.equal(meta.progress_states[10].right_visible_px,0);
assert(total>1000000,'all 22 originals are present, not placeholder images');
const source=fs.readFileSync(path.join(root,'src/client/scripts/98e3-paper-stacks.js'),'utf8');
const fake=Array.from({length:22},(_,i)=>'data:image/webp;base64,'+Buffer.from(String(i)).toString('base64'));
const prepared=source.replace('__JUSTFUN_PAPER_STACK_ASSETS__',JSON.stringify(fake));
assert(!prepared.includes('__JUSTFUN_PAPER_STACK_ASSETS__'),'build injects the URLs');
const style={values:{},setProperty(n,v){this.values[n]=v}};
function sheet(){return {style:{values:{},setProperty(n,v){this.values[n]=v}},dataset:{empty:'false'}};}
const left=sheet(),right=sheet();
const classes=new Set();
const view={
  style,
  classList:{toggle(n,on){if(on)classes.add(n);else classes.delete(n)}},
  querySelector(s){if(s.includes('left'))return left;if(s.includes('right'))return right;return null;}
};
let aged=true,decodeCount=0;
const win={};
const doc={getElementById:id=>id==='jfReader'?{classList:{contains:x=>x==='jf-aged-paper'&&aged}}:null};
class FakeImage{set src(v){decodeCount++;}}
vm.runInNewContext(prepared,{window:win,document:doc,Image:FakeImage,Math,Number,Array,Set,String,Error});
const stacks=win.JFPaperStacks;
assert.equal(stacks.assetCount,22);
assert.deepEqual([-1,0,.04,.05,.499,.5,.95,1,2].map(stacks.stageFor),
  [0,0,0,1,5,5,10,10,10]);
for(const [progress,stage] of [[0,0],[.1,1],[.5,5],[.9,9],[1,10]]){
  assert.equal(stacks.apply(view,progress,700,true),stage*10);
  assert.equal(left.dataset.stackStage,String(stage*10));
  assert.equal(right.dataset.stackStage,String(stage*10));
  assert.equal(left.style.values['--jf-stack-art'],'url("'+fake[2*stage]+'")');
  assert.equal(right.style.values['--jf-stack-art'],'url("'+fake[2*stage+1]+'")');
  assert.equal(left.dataset.empty,stage===0?'true':'false');
  assert.equal(right.dataset.empty,stage===10?'true':'false');
  assert.equal(style.values['--jf-stack-art-width'],(700*64/1440).toFixed(3)+'px');
}
assert(classes.has('jf-image-stacks'),'image mode active');
aged=false;assert.equal(stacks.apply(view,.5,700,true),null);
assert(!classes.has('jf-image-stacks'),'old photo stacking disabled when aged-paper disabled');
aged=true;assert.equal(stacks.apply(view,.5,700,false),null);
assert(!classes.has('jf-image-stacks'),'single-leaf mode gets no two-sided stacks');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const section=css.slice(css.indexOf('/* v7.88 · User-authored 11-pair'));
assert(section.startsWith('/* v7.88'),'image-specific CSS exists');
assert(section.includes('background:var(--jf-stack-art) center center / 100% 100% no-repeat!important'));
assert(section.includes('clip-path:none!important')&&section.includes('box-shadow:none!important'),
  'CSS fake strata and edge masks removed');
assert(section.includes('z-index:1!important'),'photo stack remains behind current sheet');
assert(!/transform:scale|padding-left:|padding-right:/.test(section),'no reading box movement');
const spine=css.slice(css.indexOf('/* v7.87 · The photographed pages'),css.indexOf('/* v7.88 · User-authored'));
assert(spine.includes('rgba(30,20,11,.215) 50%'),'spine depression restored without an ink line');
assert(!spine.includes('rgba(224,205,174,.96)'),'no fake solid paper bridge');
console.log('PASS v7.88: original 22 WebPs + SHA, monotonic 11 stages, paired images, no distortion, correct old-paper gate, soft crease');
