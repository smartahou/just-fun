// Just Fun v7.126 · image-led EPUB page path.
// Keep author-supplied page pixels intact. This module deliberately does not
// change source XHTML, call the prose paginator, or rasterize full-size scans.
(function(){
  'use strict';
  const DECODE_CACHE=4;
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
      if(w&&h){
        const ratio=w/h;
        // Many image-heavy EPUBs contain individual comic PANELS, not page
        // scans. Never turn a panel gallery into dozens of fake full pages.
        // A regular page is portrait; a wide, high-resolution double spread
        // is the only accepted landscape exception.
        const leaf=(w>=420&&h>=620&&ratio>=.47&&ratio<=.98)||
          (w>=1050&&h>=580&&ratio>=1.3&&ratio<=2.4);
        if(!leaf)return false;
      }else if(imgs.length>1){
        // Multiple unknown-size images must be measured by the original
        // renderer until their dimensions become known.
        return false;
      }
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
  // Sample only a 160x160 preview, never encode or alter an EPUB bitmap.
  // Four independent near-white margins can be removed symmetrically in
  // image coordinates without cutting a panel or changing its aspect ratio.
  const TRIM_BORDER=160,TRIM_LIMIT=15;
  function edgeMargins(img){
    const empty={left:0,right:0,top:0,bottom:0};
    if(!img?.naturalWidth||!img.naturalHeight)return empty;
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=TRIM_BORDER;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)return empty;
    ctx.drawImage(img,0,0,TRIM_BORDER,TRIM_BORDER);
    const pixels=ctx.getImageData(0,0,TRIM_BORDER,TRIM_BORDER).data;
    function pale(x,y){
      const k=(y*TRIM_BORDER+x)*4;
      const r=pixels[k],g=pixels[k+1],b=pixels[k+2];
      return pixels[k+3]>=250&&r>=246&&g>=246&&b>=246&&
        Math.max(r,g,b)-Math.min(r,g,b)<7;
    }
    function scan(edge){
      let count=0;
      for(let pos=0;pos<TRIM_LIMIT;pos++){
        let white=0;
        for(let i=0;i<TRIM_BORDER;i++){
          const x=edge==='left'?pos:edge==='right'?TRIM_BORDER-1-pos:i;
          const y=edge==='top'?pos:edge==='bottom'?TRIM_BORDER-1-pos:i;
          if(pale(x,y))white++;
        }
        // No crop when a scanned page has any meaningful edge artwork.
        if(white/TRIM_BORDER<.99)break;
        count++;
      }
      // Reserve one sample column on each qualifying edge as a safety margin.
      return count>=3?(count-1)/TRIM_BORDER:0;
    }
    const margins={left:scan('left'),right:scan('right'),
      top:scan('top'),bottom:scan('bottom')};
    // Completely blank previews, decorative borders and giant white
    // margins are intentionally left untouched.
    if(Object.values(margins).every(v=>v>=.08))return empty;
    return margins;
  }
  function placement(m,img){
    const w=img.clientWidth,h=img.clientHeight;
    const iw=img.naturalWidth,ih=img.naturalHeight;
    if(!(w>0&&h>0&&iw>0&&ih>0))return null;
    const base=Math.min(w/iw,h/ih);
    const cropW=iw*(1-m.left-m.right);
    const cropH=ih*(1-m.top-m.bottom);
    const zoom=Math.min(1.2,Math.min(w/cropW,h/cropH)/base);
    // Uniform zoom keeps the source aspect ratio; shift centres the
    // remaining artwork when its left and right white borders differ.
    return {
      zoom,
      dx:(m.right-m.left)*iw*base*zoom/2,
      dy:(m.bottom-m.top)*ih*base*zoom/2
    };
  }
  function decorate(root,session,enabled=true){
    reset(session);
    if(!root)return;
    const imgs=Array.from(root.querySelectorAll('img[data-jf-comic-image]'));
    for(const img of imgs){
      const url=img.getAttribute('src')||'';
      const owner=img.closest?.('.jfComicPage');
      const single=owner?.querySelectorAll('img[data-jf-comic-image]').length===1;
      // Multi-image printed pages must retain their authored grouping.
      let values=null;
      if(enabled&&single&&img.complete&&img.naturalWidth){
        try{
          let margins=trimRatios.get(url);
          if(!margins){margins=edgeMargins(img);trimRatios.set(url,margins);}
          values=placement(margins,img);
        }catch{}
      }
      img.style.setProperty('--jf-comic-zoom',String(values?.zoom||1));
      img.style.setProperty('--jf-comic-shift-x',(values?.dx||0)+'px');
      img.style.setProperty('--jf-comic-shift-y',(values?.dy||0)+'px');
      if(enabled&&single&&url&&(!img.complete||!img.naturalWidth)&&
         img.dataset.jfComicTrimQueued!=='1'){
        img.dataset.jfComicTrimQueued='1';
        img.addEventListener('load',()=>{
          delete img.dataset.jfComicTrimQueued;
          if(lastSession===session&&img.isConnected)decorate(root,session,enabled);
        },{once:true});
      }
    }
  }
  window.JFComicPages={candidate,fromSection,warm,decorate,reset,
    stats:()=>({warmed:warmImages.size,trimmed:trimRatios.size})};
})();
