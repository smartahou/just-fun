// v7.100 · Additional subdued hardcover finishes; photographic frames remain untouched.
// The original six alpha WebP covers and per-book choice remain the source of truth.
(function(){
  'use strict';
  const original=window.JFPaperCovers;
  if(!original||typeof original.apply!=='function'||typeof original.styleFor!=='function'||original.count!==6)
    throw Error('[JustFun] Missing original six-cover renderer');
  // Each actual photographed board gains one quiet alternative patina; 12
  // stable book-case appearances without re-encoding or duplicating WebPs.
  const finishes=[
    [{name:'walnut',filter:'none',corner:'#62442f'},
     {name:'smoked-walnut',filter:'sepia(.20) saturate(.76) brightness(.86)',corner:'#51402f'}],
    [{name:'olive-cloth',filter:'none',corner:'#42391f'},
     {name:'moss-cloth',filter:'sepia(.18) hue-rotate(34deg) saturate(.66) brightness(.89)',corner:'#343b29'}],
    [{name:'tawny-leather',filter:'none',corner:'#71462e'},
     {name:'umber-leather',filter:'sepia(.30) saturate(.78) brightness(.84)',corner:'#503527'}],
    [{name:'oxblood',filter:'none',corner:'#603039'},
     {name:'ink-blue',filter:'hue-rotate(174deg) saturate(.58) brightness(.91)',corner:'#323e4b'}],
    [{name:'linen',filter:'none',corner:'#645748'},
     {name:'worn-sage',filter:'sepia(.14) hue-rotate(35deg) saturate(.61) brightness(.89)',corner:'#454d40'}],
    [{name:'charcoal',filter:'none',corner:'#322925'},
     {name:'midnight',filter:'hue-rotate(165deg) saturate(.64) brightness(.91)',corner:'#272b38'}]
  ];
  function tintFor(bookId){
    // Stable across devices and page turns; salt separates it from the
    // legacy six-cover randomized/remembered per-book index.
    let h=2166136261;
    for(const ch of 'cover-finish-v7100:'+String(bookId)){
      h^=ch.charCodeAt(0);
      h=Math.imul(h,16777619);
    }
    h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;
    return (h>>>0)%2;
  }
  function clear(view){
    if(!view)return;
    view.style.removeProperty('--jf-cover-shell-filter');
    view.style.removeProperty('--jf-cover-shell-underlay');
    delete view.dataset.coverVariant;
    delete view.dataset.coverFinish;
  }
  const baseApply=original.apply;
  function apply(view,bookId,twoPages){
    const base=baseApply(view,bookId,twoPages);
    if(!view||!base){clear(view);return base;}
    const variant=tintFor(bookId);
    const finish=finishes[base-1][variant];
    view.dataset.coverVariant=String((base-1)*2+variant+1);
    view.dataset.coverFinish=finish.name;
    view.style.setProperty('--jf-cover-shell-filter',finish.filter);
    view.style.setProperty('--jf-cover-shell-underlay',finish.corner);
    return base;
  }
  window.JFPaperCovers=Object.assign({},original,{
    apply,variantCount:12,finishFor:tintFor
  });
})();
