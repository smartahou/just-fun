// Just Fun v7.126 · image-led EPUB page path.
// Keep author-supplied page pixels intact. This module deliberately does not
// change source XHTML, call the prose paginator, or rasterize full-size scans.
(function(){
  'use strict';
  const TRIM_SAMPLE=128,TRIM_MAX=5,DECODE_CACHE=4;
  const warmImages=new Map(),trimRatios=new Map();
  let lastSession='';
  function reset(session){
    if(session!==lastSession){lastSession=session;warmImages.clear();trimRatios.clear();}
  }
  function imagesOf(node){
    const nested=Array.from(node?.querySelectorAll?.('img')||[]);
    return node?.tagName==='IMG'?[node,...nested]:nested;
  }
  function compactText(node){
    return (node?.textContent||'').replace(/[\s\u00a0\u3000]+/g,'').trim();
  }
  function candidate(sec){
    if(!sec?.el)return false;
    const imgs=imagesOf(sec.el);
    if(!imgs.length||imgs.length>200||
       sec.el.querySelector('table,pre,code,svg,video,canvas,iframe'))return false;
    const text=compactText(sec.el);
    if(text.length>Math.min(320,Math.max(64,imgs.length*30)))return false;
    for(const img of imgs){
      if(img.classList.contains('jfInlineGlyph')||img.dataset.jfInlineGlyph||
         /^data:/i.test(img.getAttribute('src')||''))return false;
      const w=img.naturalWidth||Number(img.dataset.jfSourceWidth)||0;
      const h=img.naturalHeight||Number(img.dataset.jfSourceHeight)||0;
      // A known small picture is an icon, not an entire manga leaf.
      if(w&&h&&(w<240||h<240))return false;
    }
    // A single root node with many small embedded assets might be a fixed
    // layout collage, not independent scans. Keep the original paginator.
    return !Array.from(sec.el.children).some(el=>imagesOf(el).length>2);
  }
  // Return null when there is any structural ambiguity. For ordinary EPUBs
  // the original pagination and its text/annotation anchors stay unchanged.
  function fromSection(sec){
    if(!candidate(sec))return null;
    const children=Array.from(sec.el.children);
    let imageGroups=0,offset=0,pending=[],groups=[],index=0;
    for(const child of children){
      const pictures=imagesOf(child);
      if(!pictures.length){
        pending.push(child);
        continue;
      }
      if(pictures.length>2)return null;
      const source=[...pending,child];
      pending=[];
      const wrap=document.createElement('div');
      wrap.className='jfComicPage';
      for(const node of source)wrap.appendChild(node.cloneNode(true));
      const textCount=source.reduce((sum,node)=>sum+(node.textContent||'').length,0);
      groups.push({chapter:sec.n,node:wrap,key:sec.n+':comic:'+index,
        // Image-only pages need distinct anchors even with zero text bytes.
        // These are page identities for scanned chapters, not quote offsets.
        offset:offset+index,comic:true,comicIndex:index});
      offset+=textCount;
      imageGroups++;
      index++;
    }
    if(!imageGroups)return null;
    if(pending.length){
      // Keep a short trailing title/caption with the last artwork rather than
      // dropping original source characters; long trailing prose is not manga.
      if(pending.some(x=>compactText(x).length>64))return null;
      for(const node of pending)groups[groups.length-1].node.appendChild(node.cloneNode(true));
    }
    // A two-image fixed layout is one indivisible physical leaf.
    for(const group of groups){
      group.comicTotal=groups.length;
      for(const img of imagesOf(group.node)){
        img.loading='eager';
        img.decoding='async';
        img.dataset.jfComicImage='1';
        // CSS handles native aspect-ratio fitting, never bitmap resampling.
      }
    }
    return groups;
  }
  function pageImages(pages){
    const urls=[];
    for(const page of pages||[]){
      for(const part of page||[]){
        if(!part?.comic)continue;
        for(const img of imagesOf(part.node)){
          const url=img.getAttribute('src')||'';
          if(url.startsWith('/api/reading/epub-asset?')&&!urls.includes(url))urls.push(url);
        }
      }
    }
    return urls;
  }
  function warm(pages,session){
    reset(session);
    if(typeof Image==='undefined')return;
    const urls=pageImages(pages).slice(0,DECODE_CACHE);
    for(const url of urls){
      if(warmImages.has(url)){
        const img=warmImages.get(url);
        warmImages.delete(url);warmImages.set(url,img);
        continue;
      }
      const img=new Image();
      img.decoding='async';
      img.src=url;
      warmImages.set(url,img);
      if(typeof img.decode==='function')img.decode().catch(()=>{});
      while(warmImages.size>DECODE_CACHE)
        warmImages.delete(warmImages.keys().next().value);
    }
  }
  // Tiny idle-only border probe. A strip is trimmed only when almost every
  // sampled pixel is genuinely paper-white; never cut dark manga artwork.
  function edgeZoom(img){
    if(!img?.naturalWidth||!img.naturalHeight)return 1;
    const canvas=document.createElement('canvas');
    canvas.width=TRIM_SAMPLE;canvas.height=TRIM_SAMPLE;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)return 1;
    ctx.drawImage(img,0,0,TRIM_SAMPLE,TRIM_SAMPLE);
    const d=ctx.getImageData(0,0,TRIM_SAMPLE,TRIM_SAMPLE).data;
    const pale=(x,y)=>{
      const i=(y*TRIM_SAMPLE+x)*4;
      const r=d[i],g=d[i+1],b=d[i+2];
      return d[i+3]>=248&&r>=246&&g>=246&&b>=246&&
        Math.max(r,g,b)-Math.min(r,g,b)<8;
    };
    function extent(side){
      let out=0;
      for(let p=0;p<TRIM_MAX;p++){
        let clear=0;
        for(let k=0;k<TRIM_SAMPLE;k++){
          const x=side==='left'?p:side==='right'?TRIM_SAMPLE-1-p:k;
          const y=side==='top'?p:side==='bottom'?TRIM_SAMPLE-1-p:k;
          if(pale(x,y))clear++;
        }
        if(clear/TRIM_SAMPLE<.985)break;
        out++;
      }
      return out;
    }
    const sides=['left','right','top','bottom'].map(extent);
    const min=Math.min(...sides);
    // Symmetric only: no guessed framing, and at most ~3% total zoom.
    return min>=2?Math.min(1.035,1+min/TRIM_SAMPLE):1;
  }
  function decorate(root,session,enabled=true){
    reset(session);
    if(!root)return;
    const imgs=Array.from(root.querySelectorAll('img[data-jf-comic-image]'));
    for(const img of imgs){
      const url=img.getAttribute('src')||'';
      img.style.setProperty('--jf-comic-zoom',
        enabled?String(trimRatios.get(url)||1):'1');
      if(!enabled||!url||trimRatios.has(url)||img.dataset.jfComicTrimQueued)return;
      img.dataset.jfComicTrimQueued='1';
      const stamp=lastSession;
      const task=()=>{
        if(stamp!==lastSession||!img.isConnected)return;
        if(!img.complete||!img.naturalWidth){
          img.addEventListener('load',()=>{delete img.dataset.jfComicTrimQueued;decorate(root,session,enabled);},{once:true});
          return;
        }
        try{
          const zoom=edgeZoom(img);
          trimRatios.set(url,zoom);
          // Already-mounted faces receive the same stable crop strength.
          for(const current of document.querySelectorAll('.jfComicPage img[data-jf-comic-image]')){
            if(current.getAttribute('src')===url)
              current.style.setProperty('--jf-comic-zoom',String(zoom));
          }
        }catch{trimRatios.set(url,1);}
      };
      if(typeof requestIdleCallback==='function')requestIdleCallback(task);
      else setTimeout(task,120);
    }
  }
  window.JFComicPages={candidate,fromSection,warm,decorate,reset,
    stats:()=>({warmed:warmImages.size,trimmed:trimRatios.size})};
})();
