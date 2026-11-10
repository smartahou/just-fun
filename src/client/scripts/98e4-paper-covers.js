// v7.101 · Twelve real photo-cropped bookcases; choose once per book.
(function(){
  'use strict';
  const covers=__JUSTFUN_PAPER_COVER_ASSETS__;
  const singleCovers=__JUSTFUN_SINGLE_COVER_ASSETS__;
  if(!Array.isArray(covers)||![6,12].includes(covers.length)||
     !Array.isArray(singleCovers)||singleCovers.length!==covers.length||
     covers.some(x=>typeof x!=='string'||!x.startsWith('data:image/webp;base64,'))||
     singleCovers.some(x=>typeof x!=='string'||!x.startsWith('data:image/webp;base64,')))
    throw Error('[JustFun] Invalid offline photographic cover set');
  // Legacy mapping kept for migration from v7.98/v7.100 on existing books.
  const STORE_KEY='jf-reader-hardcover-board-v7101';
  const LEGACY_KEY='jf-reader-hardcover-board-v798';
  let cached=null;
  function hash(s){
    let h=2166136261;
    for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
    return h>>>0;
  }
  function saved(){
    if(cached)return cached;
    let parsed={};
    try{
      const current=localStorage.getItem(STORE_KEY);
      if(current){const obj=JSON.parse(current);if(obj&&typeof obj==='object'&&!Array.isArray(obj))parsed=obj;}
      else{
        const legacy=localStorage.getItem(LEGACY_KEY);
        if(legacy){
          const obj=JSON.parse(legacy);
          if(obj&&typeof obj==='object'&&!Array.isArray(obj)){
            for(const [id,index] of Object.entries(obj)){
              if(Number.isInteger(index)&&index>=0&&index<6)
                parsed[id]=index+(covers.length===12?6*(hash('new-physical-case:'+id)%2):0);
            }
            if(covers.length===12)try{localStorage.setItem(STORE_KEY,JSON.stringify(parsed));}catch{}
          }
        }
      }
    }catch{}
    cached=parsed;
    return parsed;
  }
  function styleFor(bookId){
    if(!bookId)return -1;
    const id=String(bookId),map=saved();
    if(Number.isInteger(map[id])&&map[id]>=0&&map[id]<covers.length)return map[id];
    const selected=typeof Math.random==='function'?
      Math.min(covers.length-1,Math.floor(Math.random()*covers.length)):
      hash(id)%covers.length;
    map[id]=selected;
    try{localStorage.setItem(STORE_KEY,JSON.stringify(map));}catch{}
    return selected;
  }
  const lastPaint=new WeakMap();
  function apply(view,bookId,twoPages){
    if(!view)return null;
    const activeReader=document.getElementById('jfReader');
    const active=!!(bookId&&activeReader?.classList.contains('paged')&&
      activeReader?.classList.contains('jf-aged-paper'));
    const key=String(bookId||'')+'|'+(twoPages?'2':'1')+'|'+(active?'on':'off');
    const previous=lastPaint.get(view);
    // v7.122: avoid assigning a MULTI-HUNDRED-KB inline WebP URL to a CSS
    // custom property on every physical turn. This was invalidating the entire
    // book shell even when the photographic cover never changed.
    if(previous?.key===key)return previous.result;
    const reader=document.getElementById('jfReader');
    const enabled=!!(bookId&&reader?.classList.contains('paged')&&reader?.classList.contains('jf-aged-paper'));
    view.classList.remove('jf-image-stacks');
    view.classList.toggle('jf-hardcover-book',enabled);
    // The old v7.100 CSS color filters must not wash out real materials.
    view.style.removeProperty('--jf-cover-shell-filter');
    view.style.removeProperty('--jf-cover-shell-underlay');
    delete view.dataset.coverFinish;
    if(!enabled){
      lastPaint.set(view,{key,result:null});
      view.style.removeProperty('--jf-cover-board-url');
      view.style.removeProperty('--jf-cover-board-color');
      delete view.dataset.coverStyle;
      delete view.dataset.coverVariant;
      delete view.dataset.coverMode;
      return null;
    }
    const i=styleFor(bookId);
    view.style.setProperty('--jf-cover-board-url','url("'+(twoPages?covers[i]:singleCovers[i])+'")');
    view.dataset.coverStyle=String(i+1);
    view.dataset.coverVariant=String(i+1);
    view.dataset.coverMode=twoPages?'spread':'single';
    lastPaint.set(view,{key,result:i+1});
    return i+1;
  }
  window.JFPaperCovers={apply,styleFor,count:covers.length,variantCount:covers.length};
})();
