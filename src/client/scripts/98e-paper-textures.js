// v7.47 · Just Fun deterministic paper-library renderer.
// The offline build replaces the sentinel with the EXACT supplied 12 WebP
// data URLs. This module never generates noise or reconstructs paper per turn.
(function(){
  'use strict';
  const sources=__JUSTFUN_PAPER_ASSETS__;
  if(!Array.isArray(sources)||sources.length!==12)throw Error('Missing 12 verified paper WebPs');
  const weights=[16,14,13,10,9,8,8,7,6,4,3,2];
  const cache=new Map(),LIMIT=6;
  const KEY='jf-reader-aged-paper';
  let enabled=true;
  try{enabled=localStorage.getItem(KEY)!=='off';}catch{}
  function stableHash(value){
    const bytes=new TextEncoder().encode(String(value));
    let h=2166136261;
    for(const byte of bytes){h^=byte;h=Math.imul(h,16777619);}
    return h>>>0;
  }
  function keyFor(items){
    const item=items&&items[0];
    if(!item)return null;
    // Never use the index into a shifting mounted chapter window.
    return String(item.chapter)+':'+String(item.offset??0)+':'+String(item.key??'');
  }
  function indexFor(bookId,items){
    const key=keyFor(items);
    if(!bookId||key===null)return -1;
    const book=stableHash(bookId);
    // A book uses a coherent base set. Rare, gently oxidized leaves appear
    // deterministically, rather than changing on each navigation.
    const h=stableHash(bookId+'\0'+key);
    const total=weights.reduce((a,b)=>a+b,0);
    const pick=h%total;
    let n=0,i=0;
    for(;i<weights.length;i++){n+=weights[i];if(pick<n)break;}
    i=Math.min(i,11);
    // Shift only among the first four gentle papers, keeping one book's
    // general warmth consistent without suppressing occasional aged leaves.
    if(i<4)i=(i+(book%4))%4;
    return i;
  }
  function putWarm(index){
    if(index<0||!enabled)return Promise.resolve();
    if(cache.has(index)){
      const value=cache.get(index);
      cache.delete(index);cache.set(index,value);
      return value.promise;
    }
    const img=new Image();
    img.decoding='async';img.loading='eager';
    let resolve;
    const promise=new Promise(r=>resolve=r);
    const entry={img,promise};
    cache.set(index,entry);
    img.onload=()=>{
      if(typeof img.decode==='function')img.decode().catch(()=>{}).finally(resolve);
      else resolve();
    };
    img.onerror=resolve; // leave printable fallback color intact
    img.src=sources[index];
    if(img.complete){
      if(typeof img.decode==='function')img.decode().catch(()=>{}).finally(resolve);
      else resolve();
    }
    // At most six decoded texture references retained across turns.
    while(cache.size>LIMIT){cache.delete(cache.keys().next().value);}
    return promise;
  }
  function warm(bookId,pages){
    const indices=new Set();
    for(const page of pages||[]){
      const i=indexFor(bookId,page);
      if(i>=0)indices.add(i);
    }
    return Promise.all(Array.from(indices,putWarm));
  }
  function injectRules(){
    if(document.getElementById('jf-paper-static-rules'))return;
    const el=document.createElement('style');
    el.id='jf-paper-static-rules';
    el.textContent=sources.map((url,i)=>
      '.jfReader.paged.jf-aged-paper #jfPageView .jfSheet[data-paper-index="'+i+'"]::after'
      +'{background-image:url("'+url+'")!important;}'
    ).join('\n');
    document.head.appendChild(el);
  }
  function apply(sheet,bookId,items){
    if(!sheet)return;
    const i=indexFor(bookId,items);
    if(i<0)delete sheet.dataset.paperIndex;
    else sheet.dataset.paperIndex=String(i);
  }
  function syncButton(){
    const reader=document.getElementById('jfReader');
    if(reader)reader.classList.toggle('jf-aged-paper',enabled);
    const button=document.getElementById('jfReadPaperAged');
    if(button){
      button.setAttribute('aria-pressed',String(enabled));
      button.title=enabled?'关闭旧纸做旧':'开启旧纸做旧';
      button.setAttribute('aria-label',button.title);
    }
  }
  function toggle(){
    enabled=!enabled;
    try{localStorage.setItem(KEY,enabled?'on':'off');}catch{}
    syncButton();
    if(enabled){
      const sheets=document.querySelectorAll('#jfPageView .jfSheet[data-paper-index]');
      for(const sheet of sheets)putWarm(Number(sheet.dataset.paperIndex));
    }
  }
  injectRules();
  syncButton();
  document.getElementById('jfReadPaperAged')?.addEventListener('click',toggle);
  window.JFPaperTextures={
    indexFor,keyFor,warm,apply,syncButton,toggle,isEnabled:()=>enabled,
    // Expose indices for deterministic regression checks, not binary source.
    count:sources.length,weights:weights.slice()
  };
})();
