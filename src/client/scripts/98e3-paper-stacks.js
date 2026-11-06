// v7.88 · original 11-state matched WebP outer paper stacks (22 exact user assets).
// No runtime drawing or generated noise; build.js injects the verified binary data URLs.
(function(){
  'use strict';
  const images=__JUSTFUN_PAPER_STACK_ASSETS__;
  if(!Array.isArray(images)||images.length!==22||images.some(src=>typeof src!=='string'||!src.startsWith('data:image/webp;base64,')))
    throw Error('[JustFun] Expected 11 matched pairs of offline WebP book-stack assets');
  const nativeWidth=64,nativeHeight=1440,states=11;
  function stageFor(progress){
    const p=Number(progress);
    if(!Number.isFinite(p))return 0;
    return Math.max(0,Math.min(states-1,Math.round(Math.max(0,Math.min(1,p))*(states-1))));
  }
  const resident=new Set();
  function warm(stage){
    // Browser decoding is asynchronous and does not block page rendering.
    for(const i of [Math.max(0,stage-1),stage,Math.min(states-1,stage+1)]){
      if(resident.has(i))continue;
      resident.add(i);
      for(const src of [images[i*2],images[i*2+1]]){
        const image=new Image();
        image.decoding='async';
        image.src=src;
      }
    }
  }
  function apply(view,progress,pageHeight,twoPages){
    if(!view)return null;
    const reader=document.getElementById('jfReader');
    const enabled=!!(twoPages&&reader?.classList.contains('jf-aged-paper'));
    view.classList.toggle('jf-image-stacks',enabled);
    if(!enabled)return null;
    const stage=stageFor(progress),height=Number(pageHeight);
    if(!Number.isFinite(height)||height<=0)return null;
    // 64x1440 native pixel ratio: equal scaling on X/Y, never stretch/crop.
    view.style.setProperty('--jf-stack-art-width',(height*nativeWidth/nativeHeight).toFixed(3)+'px');
    const left=view.querySelector('.jfBookPile[data-side="left"]');
    const right=view.querySelector('.jfBookPile[data-side="right"]');
    for(const [side,el,index] of [['left',left,0],['right',right,1]]){
      if(!el)continue;
      el.style.setProperty('--jf-stack-art', 'url("'+images[stage*2+index]+'")');
      el.dataset.stackStage=String(stage*10);
      el.dataset.empty=(side==='left'?stage===0:stage===states-1)?'true':'false';
    }
    warm(stage);
    return stage*10;
  }
  window.JFPaperStacks={apply,stageFor,count:states,assetCount:images.length};
})();
