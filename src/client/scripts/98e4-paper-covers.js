// v7.98 · One static hardcover board behind the ORIGINAL paired old-paper WebPs.
// A per-book choice is stored once and never changes during page turns.
(function(){
  'use strict';
  const covers=__JUSTFUN_PAPER_COVER_ASSETS__;
  const singleCovers=__JUSTFUN_SINGLE_COVER_ASSETS__;
  if(!Array.isArray(covers)||covers.length!==6||!Array.isArray(singleCovers)||singleCovers.length!==6||
     singleCovers.some(src=>typeof src!=='string'||!src.startsWith('data:image/webp;base64,'))||
     covers.some(src=>typeof src!=='string'||!src.startsWith('data:image/webp;base64,')))
    throw Error('[JustFun] Expected six offline hardcover-board photos');
  const STORE_KEY='jf-reader-hardcover-board-v798';
  let cached=null;
  function saved(){
    if(cached)return cached;
    let parsed={};
    try{
      const raw=localStorage.getItem(STORE_KEY);
      if(raw){const data=JSON.parse(raw);if(data&&typeof data==='object'&&!Array.isArray(data))parsed=data;}
    }catch{}
    cached=parsed;
    return cached;
  }
  function fallback(bookId){
    let h=2166136261;
    for(const char of String(bookId)){h^=char.charCodeAt(0);h=Math.imul(h,16777619);}
    return (h>>>0)%covers.length;
  }
  function styleFor(bookId){
    if(!bookId)return -1;
    const id=String(bookId),map=saved();
    if(Number.isInteger(map[id])&&map[id]>=0&&map[id]<covers.length)return map[id];
    const selected=typeof Math.random==='function'?
      Math.min(covers.length-1,Math.floor(Math.random()*covers.length)):fallback(id);
    map[id]=selected;
    try{localStorage.setItem(STORE_KEY,JSON.stringify(map));}catch{}
    return selected;
  }
  function apply(view,bookId,twoPages){
    if(!view)return null;
    const reader=document.getElementById('jfReader');
    const enabled=!!(bookId&&reader?.classList.contains('paged')&&
      reader?.classList.contains('jf-aged-paper'));
    view.classList.remove('jf-image-stacks');
    view.classList.toggle('jf-hardcover-book',enabled);
    if(!enabled){
      view.style.removeProperty('--jf-cover-board-url');
      delete view.dataset.coverStyle;
      return null;
    }
    const index=styleFor(bookId);
    view.style.setProperty('--jf-cover-board-url','url("'+(twoPages?covers[index]:singleCovers[index])+'")');
    view.dataset.coverStyle=String(index+1);
    view.dataset.coverMode=twoPages?'spread':'single';
    return index+1;
  }
  window.JFPaperCovers={apply,styleFor,count:covers.length};
})();
