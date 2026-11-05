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
  const button={setAttribute(k,v){props[k]=v;},title:'',getAttribute:k=>props[k]};
  const select={};
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
// Legacy OFF is intentionally reset ON exactly once at this release boundary.
const previous=session({'jf-reader-aged-paper':'off'});
assert(previous.api.isEnabled(),'legacy OFF no longer makes a newly updated book plain white');
assert(previous.classes.has('jf-aged-paper'),'photographic paper class restored');
assert.equal(previous.api.count,16,'all 8 original left/right texture pairs retained');
assert.equal((previous.rules.get('jf-paper-static-rules').textContent.match(/background-image:url/g)||[]).length,16);
assert.equal(previous.button.getAttribute('aria-pressed'),'true');
// Explicit new OFF remains respected, and the setting is available in Aa.
previous.api.toggle();
assert.equal(previous.state['jf-reader-aged-paper-v768'],'off');
assert(!previous.classes.has('jf-aged-paper'));
const reopened=session(previous.state);
assert(!reopened.api.isEnabled(),'a NEW deliberate OFF stays off across reloads');
reopened.api.toggle();
assert(reopened.api.isEnabled());
assert.equal(reopened.state['jf-reader-aged-paper-v768'],'on');
const restored=session(reopened.state);
assert(restored.classes.has('jf-aged-paper'),'explicit ON persists');
const left={dataset:{}},right={dataset:{}};
restored.api.applySpread(left,right,'book-A',[{chapter:0,offset:0,key:'0'}],
  [{chapter:0,offset:180,key:'1'}],true);
assert(/^(0[1-8])$/.test(left.dataset.paperGroup),'left page texture group attached');
assert.equal(left.dataset.paperGroup,right.dataset.paperGroup,'physical pair shares a texture group');
assert.equal(left.dataset.paperSide,'left');assert.equal(right.dataset.paperSide,'right');
assert(restored.rules.get('jf-paper-static-rules').textContent.includes(
  '[data-paper-group="'+left.dataset.paperGroup+'"][data-paper-side="left"]::after'));
console.log('PASS v7.68: legacy OFF migration, new OFF/ON persistence, 16 photographic assets, left/right spread and mode sync');
