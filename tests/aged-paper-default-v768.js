#!/usr/bin/env node
'use strict';
// v7.68 regression: legacy paper OFF must not invisibly hide photographed pages.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/client/scripts/98e-paper-textures.js'),'utf8');
const reader=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
assert(source.includes("const KEY='jf-reader-aged-paper-v768'"),'new preference namespace');
assert(!source.includes("const KEY='jf-reader-aged-paper';"),'stale off key is no longer active');
assert(source.includes('    injectRules();\n    const i=indexFor(bookId,left,right);'),'texture rules re-ensured for every spread');
assert.equal((reader.match(/window\.JFPaperTextures\?\.syncButton\(\)/g)||[]).length,3,
  'new book, mode toggle and rollback resync the physical-paper skin');
assert(reader.includes("const savedMode=jfDeskWorkspace.progress[bookId]?.mode;"),'per-book paged mode retained');
function session(initial){
  const state={...initial},classes=new Set(),rules=new Map(),props={};
  const storage={getItem:k=>Object.hasOwn(state,k)?state[k]:null,setItem:(k,v)=>{state[k]=String(v);}};
  const readerEl={classList:{toggle(k,on){if(on)classes.add(k);else classes.delete(k);}},dataset:{}};
  const button={setAttribute(k,v){props[k]=v;},title:'',getAttribute:k=>props[k],addEventListener(){}};
  const select={addEventListener(){}};
  const doc={
    getElementById(id){return id==='jfReader'?readerEl:
      id==='jfReadPaperAged'?button:id==='jfReadPaperWear'?select:rules.get(id)||null;},
    createElement(tag){return {tag,id:'',textContent:''};},
    head:{appendChild(el){rules.set(el.id,el);}},
    querySelectorAll(){return [];}
  };
  const window={};
  const code=source.replace('__JUSTFUN_PAPER_SPREAD_ASSETS__',
    'Array.from({length:16},(_,i)=>"data:image/webp;base64,test"+i)');
  const context={document:doc,window,localStorage:storage,navigator:{deviceMemory:8},
    TextEncoder,Image:class{},Map,Set,Promise,Math,Number,String};
  vm.runInNewContext(code,context,{timeout:1500});
  return {api:window.JFPaperTextures,classes,state,rules,readerEl,button,select};
}
// v7.108: paper ON/OFF and wear controls were removed from Aa. An explicit
// previous OFF must no longer survive when users cannot access that toggle.
const previous=session({'jf-reader-aged-paper':'off','jf-reader-aged-paper-v768':'off'});
assert(previous.api.isEnabled(),'both legacy OFF keys must restore approved photographic leaves');
assert(previous.classes.has('jf-aged-paper'),'real old-paper imagery remains enabled');
assert.equal(previous.state['jf-reader-aged-paper-v768'],'on','retired preference migrates ON');
assert.equal(previous.api.count,16,'all 8 original left/right texture pairs retained');
assert.equal((previous.rules.get('jf-paper-static-rules').textContent.match(/background-image:url/g)||[]).length,16);
assert.equal(previous.button.getAttribute('aria-pressed'),'true','legacy button API still syncs harmlessly');
const html=fs.readFileSync(path.join(root,'src/client/index.html'),'utf8');
assert(!html.includes('id="jfReadPaperAged"'),'retired ON/OFF button removed from visible toolbar');
assert(!html.includes('id="jfReadPaperWear"'),'ineffective light/medium/heavy menu removed');
assert(!html.includes('jfReadPaperSettings'),'paper row fully removed');
const reopened=session({...previous.state,'jf-reader-aged-paper-v768':'off'});
assert(reopened.api.isEnabled(),'saved OFF cannot strand a user without the now-retired switch');
assert.equal(reopened.state['jf-reader-aged-paper-v768'],'on');
const restored=session(reopened.state);
assert(restored.classes.has('jf-aged-paper'),'reopened book retains fixed photo paper');
const left={dataset:{}},right={dataset:{}};
restored.api.applySpread(left,right,'book-A',[{chapter:0,offset:0,key:'0'}],
  [{chapter:0,offset:180,key:'1'}],true);
assert(/^(0[1-8])$/.test(left.dataset.paperGroup),'left page texture group attached');
assert.equal(left.dataset.paperGroup,right.dataset.paperGroup,'physical pair shares a texture group');
assert.equal(left.dataset.paperSide,'left');assert.equal(right.dataset.paperSide,'right');
assert(restored.rules.get('jf-paper-static-rules').textContent.includes(
  '[data-paper-group="'+left.dataset.paperGroup+'"][data-paper-side="left"]::after'));
console.log('PASS v7.108: retired paper UI, legacy OFF migration to approved ON, 16 photographed leaves, matched spread and mode sync');
