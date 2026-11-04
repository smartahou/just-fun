// v7.48 · Paired antique-paper spread renderer; exactly 8 left/right WebP pairs.
(function(){
  'use strict';
  const textures=__JUSTFUN_PAPER_SPREAD_ASSETS__;
  if(!Array.isArray(textures)||textures.length!==16)throw Error('Expected 8 paired WebP sets');
  const KEY='jf-reader-aged-paper';
  const WEAR_KEY='jf-reader-paper-wear-v752';
  const WEAR_LEVELS=new Set(['light','medium','heavy']);
  let wearLevel='medium';
  try{const saved=localStorage.getItem(WEAR_KEY);if(WEAR_LEVELS.has(saved))wearLevel=saved;}catch{}
  const CAP=12; // 6 spreads max; bounded decoded image handles
  const cache=new Map();
  let enabled=true;
  try{enabled=localStorage.getItem(KEY)!=='off';}catch{}
  function stableHash(value){
    let hash=2166136261;
    for(const byte of new TextEncoder().encode(String(value))){hash^=byte;hash=Math.imul(hash,16777619);}
    return hash>>>0;
  }
  function pageKey(items){
    const first=items&&items[0];
    if(!first)return 'none';
    // Source location survives chapter-window shifts; array index does not.
    return String(first.chapter)+':'+String(first.offset??0)+':'+String(first.key??'');
  }
  function keyFor(left,right){return pageKey(left)+'|'+pageKey(right);}
  function indexFor(bookId,left,right){
    if(!bookId||!left?.length)return -1;
    return stableHash(String(bookId)+'\0'+keyFor(left,right))%8;
  }
  function touch(id){
    const row=cache.get(id);
    if(row){cache.delete(id);cache.set(id,row);}
    return row;
  }
  function putWarm(id){
    if(id<0||id>=16||!enabled)return Promise.resolve();
    const existing=touch(id);
    if(existing)return existing.promise;
    const img=new Image();
    img.decoding='async';
    let settled=false;
    const promise=new Promise(resolve=>{
      const finish=()=>{if(settled)return;settled=true;
        // Decode once, asynchronously; failures retain warm solid-color fallback.
        if(typeof img.decode==='function')img.decode().catch(()=>{}).finally(resolve);
        else resolve();
      };
      img.onload=finish;img.onerror=()=>{if(!settled){settled=true;resolve();}};
      img.src=textures[id];
      if(img.complete)finish();
    });
    cache.set(id,{img,promise});
    while(cache.size>CAP)cache.delete(cache.keys().next().value);
    return promise;
  }
  function spreadIds(bookId,pair){
    if(!pair||!pair.left?.length)return [];
    const i=indexFor(bookId,pair.left,pair.right);
    return i<0?[]:[i*2,i*2+1];
  }
  function warm(bookId,pairs){
    if(!enabled)return Promise.resolve();
    const wanted=new Set();
    for(const pair of pairs||[]){for(const id of spreadIds(bookId,pair))wanted.add(id);}
    // Worst case 5 visible/adjacent spreads = 10 handles; CAP=12.
    return Promise.all(Array.from(wanted,putWarm));
  }
  function applySpread(leftSheet,rightSheet,bookId,left,right,two){
    const i=indexFor(bookId,left,right);
    function mark(sheet,side,show){
      if(!sheet)return;
      if(i<0||!show){delete sheet.dataset.paperGroup;delete sheet.dataset.paperSide;return;}
      sheet.dataset.paperGroup=String(i+1).padStart(2,'0');
      sheet.dataset.paperSide=side;
    }
    mark(leftSheet,'left',!!left?.length);
    // Empty facing leaf keeps the same right-hand paper; no phantom page added.
    mark(rightSheet,'right',!!two);
    return i;
  }
  function injectRules(){
    if(document.getElementById('jf-paper-static-rules'))return;
    const el=document.createElement('style');el.id='jf-paper-static-rules';
    let rules='';
    for(let i=0;i<8;i++){
      for(let n=0;n<2;n++){
        const side=n?'right':'left';
        rules+='.jfReader.paged.jf-aged-paper #jfPageView .jfSheet[data-paper-group="'
          +String(i+1).padStart(2,'0')+'"][data-paper-side="'+side+'"]::after'
          +'{background-image:radial-gradient(ellipse 90% 84% at 50% 48%,rgba(246,246,242,.94) 0%,rgba(245,245,240,.88) 45%,rgba(246,242,231,.36) 80%,rgba(246,242,231,.03) 100%),url("'+textures[i*2+n]+'")!important;}';
      }
    }
    el.textContent=rules;document.head.appendChild(el);
  }
  function syncButton(){
    const reader=document.getElementById('jfReader');
    if(reader){reader.classList.toggle('jf-aged-paper',enabled);reader.dataset.paperWear=wearLevel;}
    const button=document.getElementById('jfReadPaperAged');
    if(button){button.setAttribute('aria-pressed',String(enabled));
      button.title=enabled?'关闭旧纸做旧':'开启旧纸做旧';
      button.setAttribute('aria-label',button.title);}
    const select=document.getElementById('jfReadPaperWear');
    if(select){select.value=wearLevel;select.title='旧纸做旧程度：'+({light:'轻',medium:'中',heavy:'重'}[wearLevel]);}
  }
  function toggle(){
    enabled=!enabled;
    try{localStorage.setItem(KEY,enabled?'on':'off');}catch{}
    syncButton();
    if(enabled){
      for(const sheet of document.querySelectorAll('#jfPageView .jfSheet[data-paper-group]')){
        const group=Number(sheet.dataset.paperGroup)-1;
        putWarm(group*2+(sheet.dataset.paperSide==='right'?1:0));
      }
    }
  }
  function setWearLevel(level){
    if(!WEAR_LEVELS.has(level))return false;
    wearLevel=level;
    try{localStorage.setItem(WEAR_KEY,level);}catch{}
    syncButton();
    return true;
  }
  injectRules();syncButton();
  document.getElementById('jfReadPaperAged')?.addEventListener('click',toggle);
  document.getElementById('jfReadPaperWear')?.addEventListener('change',function(){setWearLevel(this.value);});
  window.JFPaperTextures={
    indexFor,keyFor,pageKey,warm,applySpread,syncButton,toggle,isEnabled:()=>enabled,
    getWearLevel:()=>wearLevel,setWearLevel,
    count:16,groups:8,cacheLimit:CAP,cacheSize:()=>cache.size
  };
})();