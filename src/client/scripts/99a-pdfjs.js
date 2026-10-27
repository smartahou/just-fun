// Just Fun v6.65 · PDF.js 6.4.299: bounded 10-page scroll window.
// Offline assets, worker, CMaps and fonts are all hosted by the single-file Node service.
if(typeof Map.prototype.getOrInsertComputed!=='function')Object.defineProperty(Map.prototype,'getOrInsertComputed',{configurable:true,value:function(k,fn){if(this.has(k))return this.get(k);const v=fn(k);this.set(k,v);return v;}});
if(typeof Map.prototype.getOrInsert!=='function')Object.defineProperty(Map.prototype,'getOrInsert',{configurable:true,value:function(k,v){if(this.has(k))return this.get(k);this.set(k,v);return v;}});
const jfPdfJsState={module:null,doc:null,task:null,generation:0,windowStart:-1,pages:new Map(),queue:[],active:0,observer:null,raf:0,night:false,sharp:0,capture:false,selection:null,rendering:new Map(),lastSaved:-1};
const jfPdfMarksListUi={left:null,top:null,width:null,height:null,drag:null,resize:null};
function jfPdfJsMarksListBounds(panel){
  const host=panel.closest('.jfReader')||panel.parentElement||document.body;
  return {width:host.clientWidth||window.innerWidth,height:host.clientHeight||window.innerHeight};
}
function jfPdfJsMarksListClamp(panel,left,top,width,height){
  const bounds=jfPdfJsMarksListBounds(panel);
  const minWidth=Math.min(360,Math.max(280,bounds.width-24));
  const maxWidth=Math.max(minWidth,bounds.width-18);
  const minHeight=Math.min(240,Math.max(190,bounds.height-24));
  const maxHeight=Math.max(minHeight,bounds.height-18);
  width=Math.max(minWidth,Math.min(maxWidth,Math.round(width)));
  height=Math.max(minHeight,Math.min(maxHeight,Math.round(height)));
  left=Math.max(6,Math.min(bounds.width-width-6,Math.round(left)));
  top=Math.max(6,Math.min(bounds.height-height-6,Math.round(top)));
  return {left,top,width,height};
}
function jfPdfJsMarksListApply(panel,forceDefault=false){
  if(!panel)return;
  const bounds=jfPdfJsMarksListBounds(panel);
  let left=jfPdfMarksListUi.left,top=jfPdfMarksListUi.top,width=jfPdfMarksListUi.width,height=jfPdfMarksListUi.height;
  if(forceDefault||left===null||top===null||width===null||height===null){
    width=Math.min(540,bounds.width-36);
    height=Math.min(Math.max(300,Math.round(bounds.height*.74)),bounds.height-28);
    left=Math.max(6,bounds.width-width-18); top=18;
  }
  const next=jfPdfJsMarksListClamp(panel,left,top,width,height);
  Object.assign(jfPdfMarksListUi,next);
  panel.style.left=next.left+'px';panel.style.top=next.top+'px';panel.style.right='auto';panel.style.bottom='auto';panel.style.width=next.width+'px';panel.style.height=next.height+'px';
}
function jfPdfJsMarksListOpen(){
  const panel=document.getElementById('jfPdfMarksList');if(!panel)return;
  panel.hidden=false;
  document.getElementById('jfPdfMarksListToggle')?.setAttribute('aria-expanded','true');
  jfPdfJsMarksListApply(panel);
  jfPdfJsMarksListRender();
}
function jfPdfJsMarksListPointerMove(event){
  const panel=document.getElementById('jfPdfMarksList');if(!panel||panel.hidden)return;
  if(jfPdfMarksListUi.drag){
    const s=jfPdfMarksListUi.drag;
    const next=jfPdfJsMarksListClamp(panel,s.left+(event.clientX-s.x),s.top+(event.clientY-s.y),jfPdfMarksListUi.width,jfPdfMarksListUi.height);
    Object.assign(jfPdfMarksListUi,next);jfPdfJsMarksListApply(panel);
  }else if(jfPdfMarksListUi.resize){
    const s=jfPdfMarksListUi.resize;
    // The upper-right corner remains fixed as the lower-left grip moves.
    const host=jfPdfJsMarksListBounds(panel);
    const boundedHeight=Math.min(s.height+event.clientY-s.y,host.height-s.top-6);
    const next=jfPdfJsMarksListClamp(panel,s.right-(s.width+s.x-event.clientX),s.top,s.width+s.x-event.clientX,boundedHeight);
    // Clamp width without moving the anchor. Also clamp height inside the host.
    next.left=Math.max(6,s.right-next.width);
    Object.assign(jfPdfMarksListUi,next);jfPdfJsMarksListApply(panel);
  }
}
function jfPdfJsMarksListPointerEnd(){
  const panel=document.getElementById('jfPdfMarksList');
  if(panel)panel.classList.remove('jfDragging');
  const wasResized=!!jfPdfMarksListUi.resize;
  jfPdfMarksListUi.drag=null;jfPdfMarksListUi.resize=null;
  if(wasResized&&!panel?.hidden)jfPdfJsMarksListRefreshVisible();
}
function jfPdfJsMarksListBind(){
  const panel=document.getElementById('jfPdfMarksList'),head=panel?.querySelector('.jfPdfMarksListHead'),resize=document.getElementById('jfPdfMarksListResize');
  if(!panel||!head||!resize||panel.dataset.bindMarksList==='1')return;
  panel.dataset.bindMarksList='1';
  head.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button'))return;
    event.preventDefault();
    jfPdfMarksListUi.drag={x:event.clientX,y:event.clientY,left:jfPdfMarksListUi.left??panel.offsetLeft,top:jfPdfMarksListUi.top??panel.offsetTop};
    panel.classList.add('jfDragging');head.setPointerCapture?.(event.pointerId);
  });
  resize.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    jfPdfMarksListUi.resize={x:event.clientX,y:event.clientY,width:panel.offsetWidth,height:panel.offsetHeight,right:panel.offsetLeft+panel.offsetWidth,top:panel.offsetTop};
    resize.setPointerCapture?.(event.pointerId);
  });
  window.addEventListener('pointermove',jfPdfJsMarksListPointerMove);
  window.addEventListener('pointerup',jfPdfJsMarksListPointerEnd);
  window.addEventListener('pointercancel',jfPdfJsMarksListPointerEnd);
  window.addEventListener('resize',()=>{if(!panel.hidden){jfPdfJsMarksListApply(panel);jfPdfJsMarksListRefreshVisible();}});
}
function jfPdfJsDispose(){
  const state=jfPdfJsState;++state.generation;
  if(state.observer){state.observer.disconnect();state.observer=null;}
  if(state.raf)cancelAnimationFrame(state.raf);state.raf=0;
  jfPdfGestureReset();
  state.queue.length=0;
  for(const record of state.pages.values()){try{record.render?.cancel();}catch{}record.el.remove();}
  state.pages.clear();state.rendering.clear();state.windowStart=-1;state.lastSaved=-1;
  state.capture=false;state.selection=null;
  document.getElementById('jfPdfCapturePanel').hidden=true;
  document.getElementById('jfPdfCapture').setAttribute('aria-pressed','false');
  if(globalThis.CSS?.highlights){CSS.highlights.delete('jf-pdf-citation');for(const color of jfPdfMarkColors)CSS.highlights.delete('jf-pdf-marks-'+color);CSS.highlights.delete('jf-pdf-marks');}
  try{state.task?.destroy();}catch{}
  state.doc=null;state.task=null;
  const sheet=document.getElementById('jfPdfJsSheet');sheet.replaceChildren();sheet.hidden=true;sheet.classList.remove('jfPdfScrollStack');
  document.getElementById('jfPdfGoControl').hidden=true;
  document.getElementById('jfPdfNight').hidden=true;
  document.getElementById('jfPdfSharpen').hidden=true;
  document.getElementById('jfPdfCapture').hidden=true;
  document.getElementById('jfPdfMark').hidden=true;
  jfPdfJsMarksListClose();
  jfPdfMarkMenuClose();jfPdfMarkHits.clear();
  document.getElementById('jfPdfMarksListToggle').hidden=true;
}
async function jfPdfJsGetModule(){
  if(!jfPdfJsState.module)jfPdfJsState.module=import(new URL('/api/jf-pdf/pdf.min.mjs',document.baseURI).href).then(mod=>{
    if(typeof mod.getDocument!=='function'||!mod.GlobalWorkerOptions||!mod.TextLayer)throw Error('PDF.js 组件不完整');
    mod.GlobalWorkerOptions.workerSrc='/api/jf-pdf/pdf.worker.min.mjs';return mod;
  }).catch(err=>{jfPdfJsState.module=null;throw err;});
  return jfPdfJsState.module;
}
async function jfPdfJsOpen(bookId){
  const gen=jfPdfJsState.generation,mod=await jfPdfJsGetModule();
  if(gen!==jfPdfJsState.generation)throw Error('PDF 打开操作已经取消');
  const task=mod.getDocument({url:new URL('/api/reading/pdf?id='+encodeURIComponent(bookId),document.baseURI).href,cMapUrl:'/api/jf-pdf/cmaps/',cMapPacked:true,standardFontDataUrl:'/api/jf-pdf/standard_fonts/',wasmUrl:'/api/jf-pdf/wasm/',disableAutoFetch:true,rangeChunkSize:65536,isEvalSupported:false});
  jfPdfJsState.task=task;
  try{const doc=await task.promise;if(gen!==jfPdfJsState.generation){await task.destroy();throw Error('PDF 打开操作已经取消');}jfPdfJsState.doc=doc;return {pages:doc.numPages,engine:'Mozilla PDF.js'};}
  catch(err){try{await task.destroy();}catch{};jfPdfJsState.task=null;throw err;}
}
function jfPdfJsError(bookId,error){
  jfPdfJsDispose();jfDeskPdfInfo=null;
  document.getElementById('jfPdfPages').hidden=true;
  document.getElementById('jfReadPdf').hidden=true;
  document.getElementById('jfReadFooter').hidden=true;
  const el=document.getElementById('jfReadError');el.hidden=false;el.replaceChildren();
  const message=document.createElement('p');message.textContent='PDF.js 阅读器无法启动：'+String(error?.message||error).slice(0,240);
  const alternative=document.createElement('button');alternative.type='button';alternative.textContent='临时使用系统预览';
  alternative.addEventListener('click',()=>{el.hidden=true;jfDeskPdfNativeFallback(bookId,'用户主动选择');});
  el.append(message,alternative);document.getElementById('jfReadFormat').textContent='PDF · 阅读器启动失败';
  console.error('[JUSTFUN_PDFJS]',error);
}
function jfPdfJsWindowStart(index){const doc=jfPdfJsState.doc;let start=Math.max(0,Math.min(Math.max(0,doc.numPages-10),index-4));if(jfPdfJsIsSpread())start=Math.max(0,start-start%2);return start;}
function jfPdfJsPageWidth(){return Math.min(1800,jfDeskPdfWidth());}
function jfPdfJsIsSpread(){return jfDeskPdfZoom<.5;}
function jfPdfJsDisplayPage(index){
  const state=jfPdfJsState,doc=state.doc;if(!doc||index<0||index>=doc.numPages)return;
  jfDeskChapter=index;
  const input=document.getElementById('jfPdfGoPage');if(document.activeElement!==input)input.value=String(index+1);
  document.getElementById('jfReadPrev').disabled=index===0;
  document.getElementById('jfReadNext').disabled=index===doc.numPages-1;
  document.getElementById('jfReadProgress').textContent=(index+1)+' / '+doc.numPages;
  document.getElementById('jfReadProgressFill').style.width=((index+1)/doc.numPages*100)+'%';
  if(state.lastSaved!==index && jfDeskBook?.id){state.lastSaved=index;
    clearTimeout(jfDeskProgressTimer);
    const bookId=jfDeskBook.id;
    jfDeskProgressTimer=setTimeout(()=>jfDeskMutate({action:'progress',bookId,chapter:index,ratio:0,total:doc.numPages}).catch(e=>jfDeskMessage('PDF 进度未保存：'+e.message,true)),900);
  }
}
function jfPdfJsPagePosition(record){const box=record.el.getBoundingClientRect(),parent=jfReadCenter.getBoundingClientRect();return box.top-parent.top;}
function jfPdfJsObserve(record){
  const state=jfPdfJsState;
  if(!state.observer)state.observer=new IntersectionObserver(entries=>{
    for(const e of entries)if(e.isIntersecting){const page=Number(e.target.dataset.pdfIndex);const r=state.pages.get(page);if(r&&r.el===e.target)jfPdfJsEnqueue(r);}
  },{root:jfReadCenter,rootMargin:'850px 0px'});
  state.observer.observe(record.el);
}
function jfPdfJsBuildWindow(start,anchorIndex=null,anchorOffset=null){
  const state=jfPdfJsState,doc=state.doc;if(!doc)return;
  start=Math.max(0,Math.min(Math.max(0,doc.numPages-10),start));
  if(start===state.windowStart)return;
  const targetEnd=Math.min(doc.numPages,start+10);
  const sheet=document.getElementById('jfPdfJsSheet');sheet.hidden=false;sheet.classList.add('jfPdfScrollStack');
  sheet.style.removeProperty('height');sheet.style.removeProperty('width');
  sheet.classList.toggle('jfPdfTwoPage',jfPdfJsIsSpread());
  const oldAnchor=anchorIndex!==null?state.pages.get(anchorIndex):null;
  const before=oldAnchor?jfPdfJsPagePosition(oldAnchor):(anchorOffset??null);
  const preserve=oldAnchor&&oldAnchor.el.isConnected;
  const width=jfPdfJsPageWidth();
  // Shift the bounded window without destroying overlapping Canvas/TextLayers.
  // The previous implementation recreated all ten pages at every boundary,
  // causing costly redraws, scroll jumps and visible white placeholders.
  const next=new Map();
  for(let i=start;i<targetEnd;i++){
    let record=state.pages.get(i);
    if(!record){
      const el=document.createElement('section');el.className='jfPdfVirtualPage';el.dataset.pdfIndex=String(i);
      el.setAttribute('aria-label','第 '+(i+1)+' 页');
      el.style.width=width+'px';el.style.height=Math.round(width*1.42)+'px';
      const loader=document.createElement('span');loader.className='jfPdfLoading';loader.textContent='第 '+(i+1)+' 页';el.append(loader);
      record={index:i,el,render:null,status:'new',generation:state.generation,canvas:null};
      if(state.night)el.classList.add('jfPdfPageNight');
      jfPdfJsApplySharp(record);jfPdfJsObserve(record);
    }
    next.set(i,record);
  }
  for(const [i,record] of state.pages){if(next.has(i))continue;
    state.observer?.unobserve(record.el);try{record.render?.cancel();}catch{}record.el.remove();
  }
  state.queue=state.queue.filter(r=>next.get(r.index)===r);
  // Keep the shared DOM nodes in place. Re-appending *every* old node would
  // transiently shrink the scroller and clamp scrollTop, creating a 50-100px
  // jump even though the Canvas nodes themselves survived.
  const ordered=[...next.values()];
  for(let k=0;k<ordered.length;k++){
    const record=ordered[k];if(record.el.parentNode===sheet)continue;
    const later=ordered.slice(k+1).find(r=>r.el.parentNode===sheet);
    sheet.insertBefore(record.el,later?.el||null);
  }
  state.pages=next;state.windowStart=start;
  if(preserve && next.get(anchorIndex)===oldAnchor){
    // Keep the same visible pixels at the same viewport Y after adding/removing
    // preceding pages, including when the last page is shorter than expected.
    const after=jfPdfJsPagePosition(oldAnchor);
    jfReadCenter.scrollTop+=after-before;
  }else if(anchorIndex!==null&&next.has(anchorIndex)){
    const top=jfPdfJsPagePosition(next.get(anchorIndex));
    jfReadCenter.scrollTop+=top-(anchorOffset??18);
  }
  for(const record of next.values())if(Math.abs(record.index-(anchorIndex??start))<=2)jfPdfJsEnqueue(record);
}
function jfPdfJsApplySharp(record){
  const element=record.el;element.classList.remove('jfPdfSharpSoft');
  element.classList.toggle('jfPdfSharpStrong',jfPdfJsState.sharp===1);
}
function jfPdfJsEnqueue(record){
  const state=jfPdfJsState;if(record.status!=='new'||record.generation!==state.generation)return;
  record.status='queued';state.queue.push(record);jfPdfJsPump();
}
function jfPdfJsPump(){
  const state=jfPdfJsState;
  while(state.active<2&&state.queue.length){const record=state.queue.shift();if(!record||record.generation!==state.generation)continue;
    state.active++;
    jfPdfJsRender(record).catch(err=>{
      if(state.pages.get(record.index)!==record||record.generation!==state.generation||err?.name==='RenderingCancelledException')return;
      record.status='error';record.el.replaceChildren();const button=document.createElement('button');button.type='button';button.className='jfPdfRetry';button.textContent='第 '+(record.index+1)+' 页读取失败 · 点击重试';button.addEventListener('click',()=>{record.status='new';jfPdfJsEnqueue(record);});record.el.append(button);console.warn('[PDF 页面]',err);
    }).finally(()=>{state.active--;jfPdfJsPump();});
  }
}
async function jfPdfJsRender(record){
  const state=jfPdfJsState,doc=state.doc,gen=record.generation;
  if(!doc||gen!==state.generation)return;
  record.status='rendering';const revision=record.revision||0;const page=await doc.getPage(record.index+1);
  try{
    if(gen!==state.generation||state.pages.get(record.index)!==record||revision!==(record.revision||0))return;
    const natural=page.getViewport({scale:1}),width=jfPdfJsPageWidth();
    const viewport=page.getViewport({scale:width/natural.width});
    // One deliberately strong display-only profile; cap the bitmap budget to
    // avoid wasting work on huge scanned pages. Nothing alters the source PDF.
    const limit=Math.min(Math.max(window.devicePixelRatio||1,state.sharp?2.5:1),2.65,Math.sqrt(14000000/(viewport.width*viewport.height)));
    const scale=Math.max(.5,limit);
    const canvas=document.createElement('canvas');canvas.width=Math.round(viewport.width*scale);canvas.height=Math.round(viewport.height*scale);
    canvas.style.width=Math.round(viewport.width)+'px';canvas.style.height=Math.round(viewport.height)+'px';
    const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('Canvas 不可用');
    const render=page.render({canvasContext:ctx,viewport,transform:[scale,0,0,scale,0,0],background:'#fff'});record.render=render;
    await render.promise;
    if(gen!==state.generation||state.pages.get(record.index)!==record||revision!==(record.revision||0))return;
    // Show the freshly rendered pixels *before* extracting / laying out text.
    // The old path kept the user staring at a placeholder or stretched bitmap
    // until PDF.js's often-expensive TextLayer.render() completed.
    const before=jfPdfJsPagePosition(record),oldHeight=record.el.offsetHeight;
    record.el.style.width=Math.round(viewport.width)+'px';record.el.style.height=Math.round(viewport.height)+'px';record.el.replaceChildren(canvas);record.canvas=canvas;
    if(before<0&&record.el.offsetHeight!==oldHeight)jfReadCenter.scrollTop+=record.el.offsetHeight-oldHeight;
    const layer=document.createElement('div');layer.className='jfPdfTextLayer textLayer';layer.style.setProperty('--scale-factor',String(viewport.scale));layer.style.setProperty('--total-scale-factor',String(viewport.scale));
    const text=await page.getTextContent({includeMarkedContent:true});
    if(gen!==state.generation||state.pages.get(record.index)!==record||revision!==(record.revision||0))return;
    const mod=await jfPdfJsGetModule(),tl=new mod.TextLayer({textContentSource:text,container:layer,viewport});await tl.render();
    if(gen!==state.generation||state.pages.get(record.index)!==record||revision!==(record.revision||0))return;
    record.el.append(layer);record.status='ready';
    if(state.capture)jfPdfJsCaptureLayer(record);
    jfPdfJsRenderMarks();
  }finally{record.render=null;try{page.cleanup();}catch{}}
}
function jfPdfJsOnScroll(){
  const state=jfPdfJsState;if(!state.doc||state.windowStart<0||state.raf)return;
  state.raf=requestAnimationFrame(()=>{
    state.raf=0;if(!state.doc||!state.pages.size)return;
    const parent=jfReadCenter.getBoundingClientRect(),scanY=parent.top+Math.min(parent.height*.35,240);
    let current=state.windowStart,min=Infinity;
    for(const [index,record] of state.pages){const bounds=record.el.getBoundingClientRect();const distance=bounds.bottom<scanY?scanY-bounds.bottom:bounds.top>scanY?bounds.top-scanY:0;
      if(distance<min){min=distance;current=index;}}
    jfPdfJsDisplayPage(current);
    if(current<=state.windowStart+1&&state.windowStart>0||current>=state.windowStart+8&&state.windowStart+10<state.doc.numPages){
      const offset=jfPdfJsPagePosition(state.pages.get(current));jfPdfJsBuildWindow(jfPdfJsWindowStart(current),current,offset);
    }
  });
}
async function jfPdfJsPage(index){
  const state=jfPdfJsState,doc=state.doc;if(!doc||!jfDeskBook||!Number.isSafeInteger(index)||index<0||index>=doc.numPages)return;
  const alreadyVisible=state.pages.has(index);
  if(state.windowStart<0||!alreadyVisible||index===state.windowStart||index===state.windowStart+9)
    jfPdfJsBuildWindow(jfPdfJsWindowStart(index),index,alreadyVisible?null:18);
  const record=state.pages.get(index);if(!record)return;
  const top=jfPdfJsPagePosition(record);
  const delta=top-18;
  // Smooth within the existing ten-page stream. Far jumps are an intentional
  // discrete seek, not a multi-thousand-pixel scrolling animation.
  if(alreadyVisible&&Math.abs(delta)<jfReadCenter.clientHeight*3&&Math.abs(delta)>2)
    jfReadCenter.scrollTo({top:jfReadCenter.scrollTop+delta,behavior:'smooth'});
  else if(Math.abs(delta)>2)jfReadCenter.scrollTop+=delta;
  jfPdfJsDisplayPage(index);jfPdfJsEnqueue(record);
  document.getElementById('jfPdfPageStatus').hidden=true;document.getElementById('jfPdfPageImage').hidden=true;
  document.getElementById('jfPdfJsSheet').hidden=false;
  document.getElementById('jfPdfGoControl').hidden=false;document.getElementById('jfPdfGoTotal').textContent='/ '+doc.numPages;
  document.getElementById('jfPdfGoPage').max=String(doc.numPages);
  document.getElementById('jfPdfNight').hidden=false;
  document.getElementById('jfPdfSharpen').hidden=false;
  document.getElementById('jfPdfCapture').hidden=false;
  document.getElementById('jfPdfMark').hidden=true;
  document.getElementById('jfPdfMarksListToggle').hidden=false;
  document.getElementById('jfPdfZoomLabel').textContent=Math.round(jfDeskPdfZoom*100)+'%';
}
function jfPdfJsResize(anchor=null){
  const state=jfPdfJsState;if(!state.doc||state.windowStart<0)return;
  const current=state.pages.get(jfDeskChapter)||[...state.pages.values()][0];
  const before=current?jfPdfJsPagePosition(current):0;
  const width=jfPdfJsPageWidth();
  document.getElementById('jfPdfJsSheet').classList.toggle('jfPdfTwoPage',jfPdfJsIsSpread());
  // Keep the existing ten Canvas/TextLayer DOM nodes on screen. Update their
  // geometry in place and render sharp replacements in the bounded queue.
  // Previously clear()+buildWindow() blanked every page after every pinch.
  state.queue.length=0;
  for(const record of state.pages.values()){
    record.revision=(record.revision||0)+1;
    try{record.render?.cancel();}catch{}
    const oldW=record.el.offsetWidth||width;
    const oldH=record.el.offsetHeight||Math.round(oldW*1.42);
    const newH=Math.round(oldH*width/oldW);
    record.el.style.width=width+'px';record.el.style.height=newH+'px';
    if(record.canvas){record.canvas.style.width=width+'px';record.canvas.style.height=newH+'px';}
    const layer=record.el.querySelector('.jfPdfTextLayer');
    if(layer)layer.style.pointerEvents='none';
    record.status='new';
  }
  if(anchor)jfPdfJsRestoreZoomAnchor(anchor);
  else if(current&&current.el.isConnected)jfReadCenter.scrollTop+=jfPdfJsPagePosition(current)-before;
  // Render the two visible facing pages first. The old Map-order pass often
  // spent both rendering slots on preceding offscreen pages before reaching
  // the spread the user was actually looking at.
  const selected=anchor?.index??jfDeskChapter;
  const first=jfPdfJsIsSpread()?Math.floor(selected/2)*2:selected;
  const ordered=[...state.pages.values()].filter(record=>Math.abs(record.index-first)<=3)
    .sort((a,b)=>{
      const rank=index=>index===first?0:index===first+1&&jfPdfJsIsSpread()?1:2+Math.abs(index-first);
      return rank(a.index)-rank(b.index);
    });
  for(const record of ordered)jfPdfJsEnqueue(record);
  document.getElementById('jfPdfZoomLabel').textContent=Math.round(jfDeskPdfZoom*100)+'%';
}

function jfPdfJsSelectedText(){
  const sel=getSelection(),raw=sel?.toString()||'',excerpt=raw.trim();
  const a=sel?.anchorNode?.parentElement?.closest('.jfPdfVirtualPage');
  const b=sel?.focusNode?.parentElement?.closest('.jfPdfVirtualPage');
  if(!excerpt||!a||a!==b)return null;
  const layer=a.querySelector('.jfPdfTextLayer');if(!layer)return null;
  const range=sel.getRangeAt(0),prefix=document.createRange();
  prefix.selectNodeContents(layer);prefix.setEnd(range.startContainer,range.startOffset);
  return {text:excerpt.slice(0,5000),bookId:jfDeskBook.id,chapter:Number(a.dataset.pdfIndex),anchorStart:prefix.toString().length+(raw.length-raw.trimStart().length)};
}
async function jfPdfJsQuoteSelection(){
  if(!jfPdfJsState.doc||!jfDeskBook)return;
  const ref=jfPdfJsSelectedText();
  if(!ref){jfDeskMessage('请先在同一页选中 PDF 正文再摘录',true);return;}
  jfDeskChooseQuote(ref);
}
// A click on the Header is useful without preselecting text: save the
// visible page. With a selection, store a precise text mark instead.
let jfPdfPendingSelectedMark=null;
async function jfPdfJsMarkSelection(){
  if(!jfPdfJsState.doc||!jfDeskBook)return;
  const selected=jfPdfJsSelectedText()||jfPdfPendingSelectedMark;
  jfPdfPendingSelectedMark=null;
  const mark=selected?{...selected,type:'text',length:selected.text.length}:{bookId:jfDeskBook.id,chapter:jfDeskChapter,type:'page'};
  try{
    await jfDeskMutate({action:'mark',mark});
    jfPdfJsRenderMarks();jfPdfJsMarksListRender();getSelection()?.removeAllRanges();
    jfDeskMessage(selected?'已标记原文':'已标记第 '+(mark.chapter+1)+' 页');
  }catch(e){jfDeskMessage('标记未保存：'+e.message,true);}
}
function jfPdfJsBookMarks(){
  return (Array.isArray(jfDeskWorkspace?.marks)?jfDeskWorkspace.marks:[])
    .filter(m=>m.bookId===jfDeskBook?.id&&Number.isSafeInteger(m.chapter))
    .sort((a,b)=>a.chapter-b.chapter||(a.area?.[1]||0)-(b.area?.[1]||0));
}
// Logical annotation units: page-anchored source segments remain separate,
// while an explicit shared groupId makes neighbouring regions one list item.
function jfPdfJsMarkUnits(){
  const units=[],byGroup=new Map();
  for(const mark of jfPdfJsBookMarks()){
    if(mark.groupId&&byGroup.has(mark.groupId)){byGroup.get(mark.groupId).push(mark);continue;}
    const unit=[mark];units.push(unit);if(mark.groupId)byGroup.set(mark.groupId,unit);
  }
  return units;
}
// A persisted workspace reload replaces mark objects; an already rendered
// menu can retain the old reference. Source anchors, not JS identity, define
// a mark. The server uses these same immutable book/page/area fields.
function jfPdfJsSameMark(a,b){
  return a===b||(!!a&&!!b&&a.bookId===b.bookId&&a.chapter===b.chapter&&a.type===b.type&&
    (a.type==='area'?JSON.stringify(a.area)===JSON.stringify(b.area):
     a.type==='text'?a.anchorStart===b.anchorStart&&a.text===b.text:true));
}
function jfPdfJsNeighborUnit(mark,direction){
  const units=jfPdfJsMarkUnits(),pos=units.findIndex(unit=>unit.some(m=>jfPdfJsSameMark(m,mark)));
  if(pos<0||!units[pos].every(m=>m.type==='area'))return null;
  const other=units[pos+direction];
  return other?.every(m=>m.type==='area')&&units[pos].length+other.length<=6?other:null;
}
async function jfPdfJsMergeUnit(mark,direction){
  const other=jfPdfJsNeighborUnit(mark,direction);
  if(!other)throw Error('相邻标记不可合并（只支持图片区域，每组最多 6 条）');
  await jfDeskMutate({action:'merge-marks',mark,neighbor:other[0]});
  jfPdfMarkMenuClose();jfPdfJsRenderMarks();jfPdfJsMarksListRender();
  jfDeskMessage('相邻区域已合并为一条标记');
}
function jfPdfJsMarksListClose(){
  const panel=document.getElementById('jfPdfMarksList');
  if(panel){panel.hidden=true;panel.classList.remove('jfDragging');}
  jfPdfMarksListUi.drag=null;jfPdfMarksListUi.resize=null;
  document.getElementById('jfPdfMarksListToggle')?.setAttribute('aria-expanded','false');
}
async function jfPdfJsPageMarkText(mark,element){
  const doc=jfPdfJsState.doc;
  if(!doc||!element.isConnected||jfDeskBook?.id!==mark.bookId)return;
  try{
    const pdfPage=await doc.getPage(mark.chapter+1);
    const words=await pdfPage.getTextContent();
    const text=words.items.map(item=>item.str||'').join(' ').replace(/\s+/g,' ').trim();
    if(element.isConnected&&jfDeskBook?.id===mark.bookId)
      element.textContent=text.slice(0,210)||'第 '+(mark.chapter+1)+' 页 · 暂无可提取文字';
  }catch(e){if(element.isConnected)element.textContent='页面标记 · 无法生成文字预览';}
}
const jfPdfPageMarkTextObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
  for(const entry of entries){if(!entry.isIntersecting)continue;
    jfPdfPageMarkTextObserver.unobserve(entry.target);
    if(entry.target.__jfPageMark)jfPdfJsPageMarkText(entry.target.__jfPageMark,entry.target);
  }
},{root:document.getElementById('jfPdfMarksListItems'),rootMargin:'100px'}):null;
// Content-size-aware previews: render from the original PDF vector page, not
// a 250x125 thumbnail which becomes unreadable when the panel is expanded.
const jfPdfMarkPreviews=new Map();
const jfPdfMarkPreviewObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
  for(const entry of entries){if(!entry.isIntersecting)continue;
    jfPdfMarkPreviewObserver.unobserve(entry.target);
    if(entry.target.__jfMark)jfPdfJsMarkPreview(entry.target.__jfMark,entry.target);
  }
},{root:document.getElementById('jfPdfMarksListItems'),rootMargin:'160px'}):null;
function jfPdfJsMarkPreviewTarget(image,mark){
  const parentWidth=image.parentElement?.clientWidth||image.clientWidth||540;
  const displayWidth=Math.max(160,parentWidth-2);
  // Enough real pixels for a high DPI desktop, without unbounded raster memory.
  const dpr=Math.max(1,Math.min(2.25,window.devicePixelRatio||1));
  const width=Math.min(2800,Math.ceil(displayWidth*Math.max(2,dpr*1.2)/96)*96);
  const area=mark.area||[0,0,1,1],ratio=Math.max(.01,area[3])/Math.max(.01,area[2]);
  const height=Math.max(1,Math.round(width*ratio));
  // A very narrow/tall crop is allowed but cannot allocate an enormous canvas.
  const bound=Math.min(1,3000/height,Math.sqrt(8500000/(width*height)));
  return {width:Math.max(1,Math.round(width*bound)),height:Math.max(1,Math.round(height*bound))};
}
function jfPdfJsMarksListRefreshVisible(){
  const list=document.getElementById('jfPdfMarksListItems');
  if(!list)return;
  const root=list.getBoundingClientRect();
  for(const image of list.querySelectorAll('.jfPdfMarkPreview')){
    if(!image.__jfMark)continue;
    const box=image.getBoundingClientRect();
    if(box.top>root.bottom+100||box.bottom<root.top-100)continue;
    const want=jfPdfJsMarkPreviewTarget(image,image.__jfMark);
    if((image.__jfPreviewWidth||0)<want.width*.85)jfPdfJsMarkPreview(image.__jfMark,image);
  }
}
async function jfPdfJsMarkPreview(mark,image){
  if(!mark.area||!jfPdfJsState.doc||!image.isConnected)return;
  const doc=jfPdfJsState.doc,bookId=mark.bookId;
  const target=jfPdfJsMarkPreviewTarget(image,mark);
  const cacheKey=bookId+':'+mark.chapter+':'+JSON.stringify(mark.segments||mark.area)+':'+target.width;
  const cache=jfPdfMarkPreviews.get(cacheKey);
  if(cache){
    jfPdfMarkPreviews.delete(cacheKey);jfPdfMarkPreviews.set(cacheKey,cache);
    image.src=cache;image.__jfPreviewWidth=target.width;return;
  }
  // Avoid concurrent requests for the same preview image at the same scale.
  if(image.__jfRenderingWidth===target.width)return;
  const requestId=(image.__jfRequestId||0)+1;image.__jfRequestId=requestId;
  image.__jfRenderingWidth=target.width;
  let pdfPage=null;
  try{
    pdfPage=await doc.getPage(mark.chapter+1);
    const [x,y,w,h]=mark.area,segments=Array.isArray(mark.segments)&&mark.segments.length?mark.segments:[mark.area];
    const natural=pdfPage.getViewport({scale:1});
    const scale=target.width/Math.max(1,natural.width*w);
    const viewport=pdfPage.getViewport({scale});
    const output=document.createElement('canvas');output.width=target.width;output.height=target.height;
    const ctx=output.getContext('2d',{alpha:false});if(!ctx)return;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,output.width,output.height);
    ctx.save();ctx.beginPath();
    for(const strip of segments){
      const rect=jfPdfProjection.cropRects(mark.area,[strip],viewport.width,viewport.height)[0];
      ctx.rect(rect.x,rect.y,rect.w,rect.h);
    }
    ctx.clip();
    // PDF.js can offset its full-page vector viewport inside a cropped canvas.
    // This preserves real glyph detail without rendering an enormous full page.
    await pdfPage.render({canvasContext:ctx,viewport,transform:[1,0,0,1,-x*viewport.width,-y*viewport.height]}).promise;
    ctx.restore();
    if(image.__jfRequestId!==requestId||!image.isConnected||jfDeskBook?.id!==bookId||jfPdfJsState.doc!==doc)return;
    const uri=output.toDataURL('image/jpeg',.92);
    jfPdfMarkPreviews.set(cacheKey,uri);
    // Bounded LRU cache; a resizable panel may request multiple resolutions.
    while(jfPdfMarkPreviews.size>12)jfPdfMarkPreviews.delete(jfPdfMarkPreviews.keys().next().value);
    image.src=uri;image.__jfPreviewWidth=output.width;
  }catch(err){console.warn('[标记高清预览]',err?.message||err);}finally{
    if(image.__jfRequestId===requestId)image.__jfRenderingWidth=0;
    try{pdfPage?.cleanup();}catch{}
  }
}
async function jfPdfJsOriginalMarkImage(mark){
  const doc=jfPdfJsState.doc;if(!doc||mark.type!=='area')throw Error('PDF 区域不可用');
  const page=await doc.getPage(mark.chapter+1);
  const [x,y,w,h]=mark.area,segments=mark.segments?.length?mark.segments:[mark.area];
  const natural=page.getViewport({scale:1});
  let factor=Math.min(2.1,900/Math.max(1,natural.width*w),1100/Math.max(1,natural.height*h));
  for(let attempt=0;attempt<6;attempt++){
    const viewport=page.getViewport({scale:factor});
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(viewport.width*w));canvas.height=Math.max(1,Math.ceil(viewport.height*h));
    if(canvas.width*canvas.height>3800000){factor*=.75;continue;}
    const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('截图绘制不可用');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.beginPath();for(const rect of jfPdfProjection.cropRects(mark.area,segments,viewport.width,viewport.height))ctx.rect(rect.x,rect.y,rect.w,rect.h);ctx.clip();
    await page.render({canvasContext:ctx,viewport,transform:[1,0,0,1,-x*viewport.width,-y*viewport.height]}).promise;ctx.restore();
    const image=canvas.toDataURL('image/jpeg',Math.max(.57,.89-attempt*.05));
    if(image.length<=215000)return image;
    factor*=.77;
  }
  throw Error('跨页图片太大，请缩小标记区域');
}
function jfPdfJsMarksListRender(){
  const list=document.getElementById('jfPdfMarksListItems');if(!list)return;
  list.replaceChildren();const units=jfPdfJsMarkUnits();
  if(!units.length){const empty=document.createElement('p');empty.className='jfPdfMarksEmpty';empty.textContent='还没有标记';list.append(empty);return;}
  for(const unit of units){
    const mark=unit[0],last=unit[unit.length-1],isPdf=!!jfDeskOutline?.nativePdf;
    const row=document.createElement('div');row.className='jfPdfMarkUnit';
    const button=document.createElement('button');button.type='button';button.className='jfPdfMarkItem';
    if(unit.every(m=>m.type==='area'&&Array.isArray(m.area))&&isPdf){
      const previews=document.createElement('div');previews.className='jfPdfMarkUnitPreviews';
      for(const part of unit){
        const wrap=document.createElement('div');wrap.className='jfPdfMarkUnitPart';
        const picture=document.createElement('img');picture.className='jfPdfMarkPreview';picture.alt='第 '+(part.chapter+1)+' 页标记截图';picture.loading='lazy';
        wrap.append(picture);picture.__jfMark=part;
        if(unit.length>1){const badge=document.createElement('span');badge.className='jfPdfMarkPartLabel';badge.textContent='第 '+(part.chapter+1)+' 页';wrap.append(badge);}
        previews.append(wrap);
        if(jfPdfMarkPreviewObserver)jfPdfMarkPreviewObserver.observe(picture);
        else queueMicrotask(()=>jfPdfJsMarkPreview(part,picture));
      }
      button.append(previews);
    }else{
      const content=document.createElement('span');content.className='jfPdfMarkText';
      const record=jfPdfJsState.pages.get(mark.chapter);
      const body=mark.type==='text'?mark.text:record?.el.querySelector('.jfPdfTextLayer')?.textContent||'';
      content.textContent=(body||(mark.type==='area'?'图片区域 · 正在准备预览':'正在读取该页内容…')).slice(0,180);
      button.append(content);
      if(isPdf&&mark.type==='page'&&!body){
        content.__jfPageMark=mark;
        if(jfPdfPageMarkTextObserver)jfPdfPageMarkTextObserver.observe(content);
        else queueMicrotask(()=>jfPdfJsPageMarkText(mark,content));
      }
    }
    const meta=document.createElement('span');meta.className='jfPdfMarkPage';
    const pages=mark.chapter===last.chapter?'第 '+(mark.chapter+1)+' 页':'第 '+(mark.chapter+1)+'–'+(last.chapter+1)+' 页';
    meta.textContent=(isPdf?pages:'第 '+(mark.chapter+1)+' 章')+' · '+(unit.length>1?'组合标记 · '+unit.length+' 处':({text:'原文标记',area:'图片区域',page:'页面标记'}[mark.type]||'标记'));
    button.append(meta);
    button.addEventListener('click',async()=>{
      jfPdfMarkMenuClose();jfPdfJsMarksListClose();
      if(!isPdf){await jfDeskShowChapter(mark.chapter);if(mark.text)jfDeskJumpToQuote({...mark,type:'text'});return;}
      await jfPdfJsPage(mark.chapter);
      const record=jfPdfJsState.pages.get(mark.chapter);if(!record)return;
      for(let i=0;i<80&&record.status!=='ready'&&record.status!=='error';i++)await new Promise(r=>setTimeout(r,45));
      if(mark.type==='text')await jfPdfJsJumpToQuote(mark);
      else if(mark.type==='area'&&Array.isArray(mark.area)){
        const r=record.el.getBoundingClientRect();const target=r.top+r.height*mark.area[1];
        jfReadCenter.scrollTop+=target-(jfReadCenter.getBoundingClientRect().top+Math.min(130,jfReadCenter.clientHeight*.25));
      }
    });row.append(button);
    if(isPdf){
      const actions=document.createElement('button');actions.type='button';actions.className='jfPdfMarkUnitMenu';actions.textContent='⋯';actions.title='合并、摘录或管理这一组标记';actions.setAttribute('aria-label','操作标记');
      actions.addEventListener('click',e=>{e.stopPropagation();const r=actions.getBoundingClientRect();jfPdfMarkMenuOpen(mark,r.left,r.bottom);});row.append(actions);
    }
    list.append(row);
  }
}
document.getElementById('jfPdfMark').addEventListener('pointerdown',()=>{jfPdfPendingSelectedMark=jfPdfJsSelectedText();});
jfPdfJsMarksListBind();
document.getElementById('jfPdfMarksListToggle').addEventListener('click',()=>{
  const panel=document.getElementById('jfPdfMarksList');
  if(panel.hidden)jfPdfJsMarksListOpen();
  else jfPdfJsMarksListClose();
});
document.getElementById('jfPdfMarksListClose').addEventListener('click',jfPdfJsMarksListClose);
function jfPdfJsTextRange(layer,index,length){
  const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT);let current,total=0,start=null,end=null;
  while((current=walker.nextNode())){
    const next=total+current.length;
    if(!start&&index<next)start=[current,index-total];
    if(start&&index+length<=next){end=[current,index+length-total];break;}
    total=next;
  }
  if(!start||!end)return null;
  const range=document.createRange();range.setStart(...start);range.setEnd(...end);return range;
}
const jfPdfMarkColors=['blue','mint','amber','rose','violet'];
const jfPdfMarkPalette={blue:'#7fbbea',mint:'#75d8ba',amber:'#ebc177',rose:'#e99bb5',violet:'#b5a0ed'};
const jfPdfMarkHits=new Map();
let jfPdfActiveMark=null;
let jfPdfMarkMenu=null;
function jfPdfMarkColor(mark){return jfPdfMarkColors.includes(mark.color)?mark.color:'blue';}
function jfPdfMarkMenuClose(){
  if(jfPdfMarkMenu)jfPdfMarkMenu.hidden=true;
  jfPdfActiveMark=null;
}
function jfPdfJsRenderMarks(){
  const state=jfPdfJsState;if(!state.doc)return;
  const marks=Array.isArray(jfDeskWorkspace.marks)?jfDeskWorkspace.marks:[];
  const groups=new Map(jfPdfMarkColors.map(color=>[color,[]]));
  jfPdfMarkHits.clear();
  for(const record of state.pages.values()){
    if(record.status!=='ready')continue;
    for(const old of record.el.querySelectorAll('.jfPdfSavedArea,.jfPdfPageBookmark'))old.remove();
    const layer=record.el.querySelector('.jfPdfTextLayer'),raw=layer?.textContent||'';
    const hits=[];
    for(const mark of marks){if(mark.bookId!==jfDeskBook?.id||mark.chapter!==record.index)continue;
      const color=jfPdfMarkColor(mark);
      if(mark.type==='page'){
        const badge=document.createElement('span');badge.className='jfPdfPageBookmark';badge.title='点击编辑页标记';badge.style.background=jfPdfMarkPalette[color];badge.dataset.markColor=color;record.el.append(badge);
        hits.push({mark,kind:'page',el:badge});
      }else if(mark.type==='area'&&Array.isArray(mark.area)){
        const rect=document.createElement('div');rect.className='jfPdfSavedArea';rect.dataset.markColor=color;
        rect.style.setProperty('--jf-mark',jfPdfMarkPalette[color]);
        Object.assign(rect.style,jfPdfProjection.markStyle(mark.area));
        record.el.append(rect);
        const elements=[rect];
        if(Array.isArray(mark.segments)&&mark.segments.length){
          rect.remove();elements.length=0;
          for(const segment of mark.segments){
            const strip=document.createElement('div');strip.className='jfPdfSavedArea';strip.dataset.markColor=color;
            strip.style.setProperty('--jf-mark',jfPdfMarkPalette[color]);
            Object.assign(strip.style,jfPdfProjection.markStyle(segment));
            record.el.append(strip);elements.push(strip);
          }
        }
        hits.push({mark,kind:'area',el:elements[0],els:elements});
      }else if(layer&&mark.type==='text'){
        let start=mark.anchorStart;
        if(raw.slice(start,start+mark.text.length)!==mark.text)start=raw.indexOf(mark.text);
        if(start<0)continue;
        const range=jfPdfJsTextRange(layer,start,mark.length||mark.text.length);
        if(range){groups.get(color).push(range);hits.push({mark,kind:'text',range});}
      }
    }
    jfPdfMarkHits.set(record.index,hits);
  }
  if(globalThis.CSS?.highlights){
    for(const [color,ranges] of groups){const key='jf-pdf-marks-'+color;
      if(ranges.length&&typeof Highlight==='function')CSS.highlights.set(key,new Highlight(...ranges));
      else CSS.highlights.delete(key);
    }
    CSS.highlights.delete('jf-pdf-marks');
  }
  if(jfPdfActiveMark&&!jfPdfJsBookMarks().includes(jfPdfActiveMark))jfPdfMarkMenuClose();
}
function jfPdfMarkMenuEnsure(){
  if(jfPdfMarkMenu)return jfPdfMarkMenu;
  const panel=document.createElement('div');panel.id='jfPdfMarkMenu';panel.className='jfPdfMarkMenu';panel.hidden=true;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-label','编辑标记');
  const swatches=document.createElement('div');swatches.className='jfPdfMarkSwatches';swatches.setAttribute('aria-label','标记颜色');
  for(const color of jfPdfMarkColors){
    const btn=document.createElement('button');btn.type='button';btn.dataset.color=color;btn.title='标记颜色 '+({blue:'蓝',mint:'青',amber:'金',rose:'粉',violet:'紫'}[color]);
    btn.setAttribute('aria-label',btn.title);btn.style.setProperty('--jf-mark',jfPdfMarkPalette[color]);
    btn.addEventListener('click',()=>jfPdfMarkMenuAction('color',color));swatches.append(btn);
  }
  const actions=document.createElement('div');actions.className='jfPdfMarkActions';
  for(const [id,label] of [['merge-prev','与上一条合并'],['merge-next','与下一条合并'],['unmerge','解除组合'],['excerpt','摘录到笔记'],['delete','删除标记']]){
    const btn=document.createElement('button');btn.type='button';btn.textContent=label;btn.dataset.action=id;
    btn.addEventListener('click',()=>jfPdfMarkMenuAction(id));actions.append(btn);
  }
  panel.append(swatches,actions);document.body.append(panel);jfPdfMarkMenu=panel;
  document.addEventListener('pointerdown',event=>{
    if(!jfPdfMarkMenu?.hidden&&!jfPdfMarkMenu.contains(event.target)&&!event.target.closest?.('#jfPdfJsSheet'))jfPdfMarkMenuClose();
  });
  return panel;
}
function jfPdfMarkMenuOpen(mark,x,y){
  if(jfPdfJsState.capture)return;
  jfPdfActiveMark=jfPdfJsBookMarks().find(m=>jfPdfJsSameMark(m,mark))||mark;
  mark=jfPdfActiveMark;
  const panel=jfPdfMarkMenuEnsure();panel.hidden=false;
  for(const swatch of panel.querySelectorAll('[data-color]'))swatch.setAttribute('aria-pressed',String(swatch.dataset.color===jfPdfMarkColor(mark)));
  for(const dir of [-1,1])panel.querySelector('[data-action=\"merge-'+(dir<0?'prev':'next')+'\"]')?.toggleAttribute('hidden',!jfPdfJsNeighborUnit(mark,dir));
  panel.querySelector('[data-action=unmerge]')?.toggleAttribute('hidden',!mark.groupId);
  panel.style.left=Math.max(10,Math.min(window.innerWidth-222,x-105))+'px';
  panel.style.top=Math.max(10,Math.min(window.innerHeight-112,y+12))+'px';
}
async function jfPdfMarkMenuAction(action,value){
  const mark=jfPdfActiveMark;if(!mark)return;
  if(action==='unmerge'){
    try{await jfDeskMutate({action:'unmerge-marks',mark});jfPdfMarkMenuClose();jfPdfJsRenderMarks();jfPdfJsMarksListRender();jfDeskMessage('标记已解除组合，原始区域保留');}
    catch(e){jfDeskMessage('解除组合失败：'+e.message,true);}return;
  }
  if(action==='merge-prev'||action==='merge-next'){
    try{await jfPdfJsMergeUnit(mark,action==='merge-prev'?-1:1);}
    catch(e){jfDeskMessage('合并失败：'+e.message,true);}return;
  }
  if(action==='excerpt'){
    jfPdfMarkMenuClose();
    try{
      if(mark.type==='area'){
        const unit=jfPdfJsMarkUnits().find(group=>group.includes(mark))||[mark];
        const pages=[];
        for(const part of unit)pages.push({chapter:part.chapter,image:await jfPdfJsOriginalMarkImage(part)});
        const image=pages[0].image;
        jfDeskChooseQuote({type:'image',image,text:'',bookId:mark.bookId,chapter:unit[0].chapter,anchorStart:null,
          ...(pages.length>1?{pages}:{}),area:[...unit[0].area],...(unit.length===1&&unit[0].segments?{segments:unit[0].segments}:{})});
      }else jfDeskChooseQuote({bookId:mark.bookId,chapter:mark.chapter,text:mark.type==='text'?mark.text:'第 '+(mark.chapter+1)+' 页标记',anchorStart:mark.type==='text'?mark.anchorStart:null});
    }catch(err){jfDeskMessage(err.message,true);}
    return;
  }
  try{
    await jfDeskMutate(action==='color'?{action:'recolor-mark',mark,color:value}:{action:'delete-mark',mark});
    jfPdfMarkMenuClose();jfPdfJsRenderMarks();jfPdfJsMarksListRender();
    jfDeskMessage(action==='color'?'标记颜色已更新':'标记已删除');
  }catch(err){jfDeskMessage('标记操作失败：'+err.message,true);}
}
// CSS Highlight ranges do not dispatch DOM clicks. Perform an explicit
// glyph-rectangle hit test only on click, never on scrolling or mousemove.
function jfPdfMarkHit(event){
  if(event.button!==0||jfPdfJsState.capture||!jfPdfJsState.doc||!document.getElementById('jfPdfQuoteChooser').hidden)return;
  if(getSelection()?.toString().trim())return;
  const sheet=document.getElementById('jfPdfJsSheet');
  const page=event.target.closest?.('.jfPdfVirtualPage');
  if(!page||!sheet.contains(page))return;
  const hits=jfPdfMarkHits.get(Number(page.dataset.pdfIndex))||[];
  const x=event.clientX,y=event.clientY;
  const within=(r,padding=0)=>x>=r.left-padding&&x<=r.right+padding&&y>=r.top-padding&&y<=r.bottom+padding;
  // Text first, then area, finally the small page corner bookmark.
  for(const kind of ['text','area','page'])for(const hit of hits){
    if(hit.kind!==kind)continue;
    const boxes=kind==='text'?hit.range.getClientRects():(hit.els||[hit.el]).map(el=>el.getBoundingClientRect());
    if([...boxes].some(r=>within(r,kind==='text'?2:kind==='page'?5:0))){
      event.preventDefault();event.stopPropagation();jfPdfMarkMenuOpen(hit.mark,x,y);return;
    }
  }
  jfPdfMarkMenuClose();
}
document.getElementById('jfPdfJsSheet').addEventListener('click',jfPdfMarkHit);
document.getElementById('jfPdfMark').addEventListener('click',jfPdfJsMarkSelection);
async function jfPdfJsJumpToQuote(quote){
  const state=jfPdfJsState;if(!state.doc)return;
  if(Number.isSafeInteger(quote.chapter))await jfPdfJsPage(quote.chapter);
  const record=state.pages.get(quote.chapter);if(!record)return;
  // Wait only for the actual page, never fake a selection before the text layer exists.
  for(let i=0;i<80&&record.status!=='ready'&&record.status!=='error';i++)await new Promise(r=>setTimeout(r,50));
  const layer=record.el.querySelector('.jfPdfTextLayer');if(!layer)return;
  const contents=layer.textContent||'',anchor=Number.isSafeInteger(quote.anchorStart)?quote.anchorStart:-1;
  let index=anchor>=0&&contents.slice(anchor,anchor+quote.text.length)===quote.text?anchor:contents.indexOf(quote.text);
  if(index<0)index=contents.indexOf(quote.text.slice(0,30));if(index<0)return;
  const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT),nodes=[];let n;while((n=walker.nextNode()))nodes.push(n);
  let start=null,end=null,total=0;const stop=index+Math.min(quote.text.length,120);
  for(const node of nodes){const next=total+node.length;if(!start&&index<next)start={node,offset:index-total};if(start&&stop<=next){end={node,offset:stop-total};break;}total=next;}
  if(!start||!end)return;
  const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);
  if(globalThis.CSS?.highlights&&typeof Highlight==='function')CSS.highlights.set('jf-pdf-citation',new Highlight(range));
  else{const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
  start.node.parentElement?.scrollIntoView({block:'center'});
}
// Just Fun v6.68 · two adjustable selection ends on rasterized PDF pages.
// The first and last text rows are independently trimmed; middle rows remain
// fully selected. Pixel row detection is local and does NOT require OCR.
function jfPdfJsCaptureClear(){
  const state=jfPdfJsState;state.capture=false;state.selection=null;
  document.getElementById('jfPdfCapture').setAttribute('aria-pressed','false');
  document.getElementById('jfPdfCapturePanel').hidden=true;
  for(const layer of document.querySelectorAll('.jfPdfCaptureLayer'))layer.remove();
}
function jfPdfCaptureRows(record,area){
  const page=record.el,source=record.canvas;
  const w=page.offsetWidth||1,h=page.offsetHeight||1;
  // Sample a reduced raster from the selected width only. Besides row bands,
  // estimate each detected line's horizontal text bounds so first/last strips
  // can auto-trim blank margins without OCR.
  const cw=Math.max(48,Math.min(420,Math.round(area.w*.6)));
  const ch=Math.min(1500,Math.max(1,Math.round(h*.6)));
  const sample=document.createElement('canvas');sample.width=cw;sample.height=ch;
  const ctx=sample.getContext('2d',{willReadFrequently:true});
  if(!ctx)return [];
  ctx.fillStyle='#fff';ctx.fillRect(0,0,cw,ch);
  ctx.drawImage(source,area.x/w*source.width,0,area.w/w*source.width,source.height,0,0,cw,ch);
  const pixels=ctx.getImageData(0,0,cw,ch).data;
  const brightness=new Uint8Array(cw*ch);
  const active=[];const threshold=Math.max(2,Math.ceil(cw*.012));
  for(let y=0;y<ch;y++){
    let dark=0;
    for(let x=0;x<cw;x++){
      const i=(y*cw+x)*4;
      const value=Math.round(pixels[i]*.3+pixels[i+1]*.59+pixels[i+2]*.11);
      brightness[y*cw+x]=value;
      if(x>0&&x<cw-1&&x%2===1&&value<205)dark++;
    }
    active.push(dark>=Math.max(2,threshold/2));
  }
  const bands=[];let from=-1,previous=-1;
  const gap=Math.max(2,Math.round(4*ch/h));
  const minBand=Math.max(1,Math.round(3*ch/h));
  const mapX=x=>area.x+Math.max(0,Math.min(area.w,area.w*x/cw));
  for(let y=0;y<=ch;y++){
    if(y<ch&&active[y]){if(from<0)from=y;previous=y;}
    else if(from>=0&&(y===ch||y-previous>gap)){
      if(previous-from>=minBand){
        let left=cw,right=-1;
        const bandTop=Math.max(0,from-1),bandBottom=Math.min(ch-1,previous+1);
        for(let yy=bandTop;yy<=bandBottom;yy++){
          for(let x=0;x<cw;x++){
            const here=brightness[yy*cw+x];
            if(here<205){
              const prev=x>0?brightness[yy*cw+x-1]:255;
              const next=x+1<cw?brightness[yy*cw+x+1]:255;
              if(prev<232||next<232||here<182){
                if(x<left)left=x;
                if(x>right)right=x;
              }
            }
          }
        }
        const safeLeft=right>=left?Math.max(0,left-2):0;
        const safeRight=right>=left?Math.min(cw,right+3):cw;
        // A Chinese full stop / comma may have no pixels darker than 205.
        // Look for a compact, *real* faint ink island just beyond strong glyphs.
        // This is a second local pass, NOT a blanket horizontal padding: it
        // keeps the short paragraph tight without cropping faint punctuation.
        let softRight=safeRight;
        if(right>=left){
          const lineHeight=previous-from+1;
          const searchEnd=Math.min(cw,Math.ceil(right+lineHeight*1.55));
          const inkStart=Math.min(cw,Math.max(0,right+2));
          let islandFrom=-1,islandLast=-1,points=0,darkest=255;
          const commit=()=>{
            if(islandFrom>=0 && islandLast-islandFrom>=1 && points>=6 && darkest<239)
              softRight=Math.max(softRight,Math.min(cw,islandLast+4));
            islandFrom=-1;islandLast=-1;points=0;darkest=255;
          };
          for(let x=inkStart;x<=searchEnd+2;x++){
            let count=0,min=255;
            if(x<searchEnd)for(let yy=bandTop;yy<=bandBottom;yy++){
              const v=brightness[yy*cw+x];
              if(v<244){count++;min=Math.min(min,v);}
            }
            // Two raster rows reject isolated scan noise and hairline speckles.
            if(count>=2 && min<239){
              if(islandFrom<0)islandFrom=x;
              if(islandLast>=0&&x-islandLast>3)commit();
              if(islandFrom<0)islandFrom=x;
              islandLast=x;points+=count;darkest=Math.min(darkest,min);
            }else if(islandFrom>=0 && x-islandLast>2)commit();
          }
          commit();
        }
        bands.push({
          top:Math.max(0,(from-2)*h/ch),
          bottom:Math.min(h,(previous+3)*h/ch),
          left:mapX(safeLeft),
          right:mapX(safeRight),
          softRight:mapX(softRight)
        });
      }
      from=-1;
    }
  }
  return bands;
}
function jfPdfCaptureClosestRow(rows,y){return jfPdfGeometry.closestRow(rows,y);}
// Group body lines by both whitespace *and* typographic paragraph cues.
// A new paragraph can start on the very next regular line: a short last line
// followed by a first-line indent (e.g. "好兆头。" -> "1月10日，").
// Gap-only grouping (v6.70) misses this very common Chinese book layout.
function jfPdfCaptureParagraphGroups(rows,first,last,area){return jfPdfGeometry.paragraphGroups(rows,first,last,area);}
// v6.74 · Visual breathing room must be measured against the ink, not just
// against the dragged rectangle. The initial rectangle is a selection gesture,
// not a hard crop boundary: permit a SMALL overshoot around the line strips.
// This remains bounded by the page itself, even when the user starts exactly
// on a glyph, and retains manually dragged handle positions as the anchor.
function jfPdfCaptureStripPadding(row){return jfPdfGeometry.stripPadding(row);}
function jfPdfCaptureSegments(choice){return jfPdfGeometry.segments(choice);}
function jfPdfCaptureDraw(record){
  const choice=jfPdfJsState.selection;if(!choice||choice.index!==record.index)return;
  const overlay=record.el.querySelector('.jfPdfCaptureLayer');if(!overlay)return;
  const surface=overlay.querySelector('.jfPdfCaptureSelection');
  const first=overlay.querySelector('[data-handle="start"]'),last=overlay.querySelector('[data-handle="end"]');
  const actions=overlay.querySelector('.jfPdfCaptureActions');
  surface.replaceChildren();
  const segments=jfPdfCaptureSegments(choice);
  choice.segments=segments;
  for(const item of segments){const stripe=document.createElement('div');stripe.className='jfPdfCaptureStripe';
    Object.assign(stripe.style,{left:item.x+'px',top:item.y+'px',width:item.w+'px',height:item.h+'px'});surface.append(stripe);
  }
  const a=segments[0],z=segments[segments.length-1];
  Object.assign(first.style,{left:a.x+'px',top:a.y+'px'});
  Object.assign(last.style,{left:(z.x+z.w)+'px',top:(z.y+z.h)+'px'});
  actions.hidden=false;first.hidden=false;last.hidden=false;
  actions.style.left=Math.min(choice.width-122,Math.max(4,z.x+z.w-94))+'px';
  actions.style.top=Math.min(choice.height-43,Math.max(4,z.y+z.h+13))+'px';
}
function jfPdfJsCaptureLayer(record){
  if(!record.canvas||record.el.querySelector('.jfPdfCaptureLayer'))return;
  const overlay=document.createElement('div');overlay.className='jfPdfCaptureLayer';overlay.dataset.page=record.index;
  const selection=document.createElement('div');selection.className='jfPdfCaptureSelection';
  const startHandle=document.createElement('button');startHandle.type='button';startHandle.className='jfPdfCaptureHandle';startHandle.dataset.handle='start';startHandle.title='拖动调整首行起点';startHandle.setAttribute('aria-label','调整首行起点');
  const endHandle=document.createElement('button');endHandle.type='button';endHandle.className='jfPdfCaptureHandle';endHandle.dataset.handle='end';endHandle.title='拖动调整末行终点';endHandle.setAttribute('aria-label','调整末行终点');
  const actions=document.createElement('div');actions.className='jfPdfCaptureActions';
  const accept=document.createElement('button');accept.type='button';accept.className='jfPdfCaptureAccept';accept.textContent='加入笔记';
  const mark=document.createElement('button');mark.type='button';mark.className='jfPdfCaptureMark';mark.textContent='标记';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';
  actions.hidden=true;startHandle.hidden=true;endHandle.hidden=true;
  actions.append(cancel,mark,accept);overlay.append(selection,startHandle,endHandle,actions);record.el.append(overlay);
  let mode=null,origin=null,tracking=null;
  const point=e=>{const rect=overlay.getBoundingClientRect();return {x:Math.max(0,Math.min(rect.width,e.clientX-rect.left)),y:Math.max(0,Math.min(rect.height,e.clientY-rect.top))};};
  overlay.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const handle=e.target.closest?.('.jfPdfCaptureHandle');
    mode=handle?.dataset.handle||'initial';origin=point(e);tracking=e.pointerId;
    overlay.setPointerCapture(e.pointerId);
    if(mode==='initial'){jfPdfJsState.selection=null;actions.hidden=true;startHandle.hidden=true;endHandle.hidden=true;selection.replaceChildren();const rect=document.createElement('div');rect.className='jfPdfCaptureStripe';selection.append(rect);}
    e.preventDefault();e.stopPropagation();
  });
  overlay.addEventListener('pointermove',e=>{
    if(mode===null||tracking!==e.pointerId)return;
    const pos=point(e),choice=jfPdfJsState.selection;
    if(mode==='initial'){
      const rect=selection.firstElementChild;if(!rect)return;
      Object.assign(rect.style,{left:Math.min(origin.x,pos.x)+'px',top:Math.min(origin.y,pos.y)+'px',width:Math.abs(pos.x-origin.x)+'px',height:Math.abs(pos.y-origin.y)+'px'});
    }else if(choice&&choice.index===record.index){
      const handle=choice[mode];handle.x=Math.max(choice.area.x,Math.min(choice.area.x+choice.area.w,pos.x));
      handle.row=jfPdfCaptureClosestRow(choice.rows,pos.y);
      if(mode==='start')handle.row=Math.min(handle.row,choice.end.row);
      else handle.row=Math.max(handle.row,choice.start.row);
      jfPdfCaptureDraw(record);
    }
    e.preventDefault();
  });
  function finish(e){
    if(mode===null||e.pointerId!==tracking)return;
    const pos=point(e),ended=mode;mode=null;tracking=null;
    try{overlay.releasePointerCapture(e.pointerId);}catch{}
    if(ended!=='initial'){jfPdfCaptureDraw(record);return;}
    const rect={x:Math.min(origin.x,pos.x),y:Math.min(origin.y,pos.y),w:Math.abs(pos.x-origin.x),h:Math.abs(pos.y-origin.y)};
    if(rect.w<16||rect.h<16){selection.replaceChildren();return;}
    let rows=[];try{rows=jfPdfCaptureRows(record,rect);}catch(err){console.warn('[PDF 截图行检测]',err);}
    // Illustrations, vector graphics, and extremely faint scans keep a plain
    // rectangular crop; their handles remain usable without fabricated OCR.
    const within=rows.filter(r=>r.bottom>=rect.y&&r.top<=rect.y+rect.h);
    if(within.length<2||within.length>40)rows=[{top:rect.y,bottom:rect.y+rect.h,left:rect.x,right:rect.x+rect.w}];
    const startRow=jfPdfCaptureClosestRow(rows,rect.y),endRow=Math.max(startRow,jfPdfCaptureClosestRow(rows,rect.y+rect.h));
    const startX=Number.isFinite(rows[startRow]?.left)?Math.max(rect.x,Math.min(rect.x+rect.w,rows[startRow].left)):rect.x;
    const endEdge=rows[endRow]?.softRight??rows[endRow]?.right;
    const endX=Number.isFinite(endEdge)?Math.max(rect.x,Math.min(rect.x+rect.w,endEdge)):rect.x+rect.w;
    jfPdfJsState.selection={index:record.index,area:rect,width:overlay.clientWidth,height:overlay.clientHeight,rows,start:{row:startRow,x:startX},end:{row:endRow,x:endX},segments:[]};
    jfPdfCaptureDraw(record);
  }
  overlay.addEventListener('pointerup',finish);
  overlay.addEventListener('pointercancel',e=>{if(mode!==null&&e.pointerId===tracking){mode=null;tracking=null;jfPdfJsCaptureClear();}});
  accept.addEventListener('pointerdown',e=>e.stopPropagation());mark.addEventListener('pointerdown',e=>e.stopPropagation());cancel.addEventListener('pointerdown',e=>e.stopPropagation());
  accept.addEventListener('click',e=>{e.stopPropagation();jfPdfJsSaveCapture();});
  mark.addEventListener('click',e=>{e.stopPropagation();jfPdfJsSaveCaptureMark();});
  cancel.addEventListener('click',e=>{e.stopPropagation();jfPdfJsCaptureClear();});
}
function jfPdfJsToggleCapture(){
  const state=jfPdfJsState;state.capture=!state.capture;state.selection=null;
  document.getElementById('jfPdfCapture').setAttribute('aria-pressed',String(state.capture));
  if(state.capture){for(const record of state.pages.values())if(record.status==='ready')jfPdfJsCaptureLayer(record);}
  else jfPdfJsCaptureClear();
}
function jfPdfJsAreaToJpeg(record,a,segments=null){
  const source=record.canvas;if(!source)throw Error('当前书页尚未完成渲染');
  const box=record.el.getBoundingClientRect(),rx=source.width/box.width,ry=source.height/box.height;
  const strips=Array.isArray(segments)&&segments.length?segments:[a];
  const left=Math.min(...strips.map(s=>s.x)),top=Math.min(...strips.map(s=>s.y));
  const right=Math.max(...strips.map(s=>s.x+s.w)),bottom=Math.max(...strips.map(s=>s.y+s.h));
  const x=Math.max(0,Math.floor(left*rx)),y=Math.max(0,Math.floor(top*ry));
  const sw=Math.max(1,Math.min(source.width-x,Math.round((right-left)*rx)));
  const sh=Math.max(1,Math.min(source.height-y,Math.round((bottom-top)*ry)));
  let factor=Math.min(1,860/sw,1050/sh),url='';
  for(let attempt=0;attempt<5;attempt++){
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(sw*factor));canvas.height=Math.max(1,Math.round(sh*factor));
    const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('截图 Canvas 不可用');
    // Fill outside the selected strips with the reading-paper color; the
    // exported JPEG then has the actual stair-step content, not bounding-box text.
    // Persist original page pixels regardless of the viewer's night-mode CSS.
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.beginPath();
    for(const s of strips)ctx.rect((s.x-left)*rx*factor,(s.y-top)*ry*factor,s.w*rx*factor,s.h*ry*factor);
    ctx.clip();
    ctx.drawImage(source,x,y,sw,sh,0,0,canvas.width,canvas.height);
    ctx.restore();
    url=canvas.toDataURL('image/jpeg',Math.max(.55,.78-attempt*.055));
    if(url.length<=215000)break;
    factor*=.78;
  }
  if(url.length>215000)throw Error('图片太大，请缩小截图区域');
  return url;
}
function jfPdfCaptureNormalized(choice,record){return jfPdfGeometry.normalized(choice,record.el.offsetWidth,record.el.offsetHeight);}
async function jfPdfJsSaveCapture(){
  const choice=jfPdfJsState.selection,bookId=jfDeskBook?.id;
  if(!choice||!bookId)return;
  const record=jfPdfJsState.pages.get(choice.index);
  if(!record?.canvas){jfDeskMessage('当前截图页已经离开缓存，请重新选择',true);return;}
  const overlay=record.el.querySelector('.jfPdfCaptureLayer'),button=overlay?.querySelector('.jfPdfCaptureAccept');
  if(button)button.disabled=true;
  try{
    const normalized=jfPdfCaptureNormalized(choice,record);
    const image=jfPdfJsAreaToJpeg(record,choice.area,normalized.segments);
    jfDeskChooseQuote({type:'image',image,text:'',bookId,chapter:choice.index,anchorStart:null,area:normalized.area,segments:normalized.shape});
  }catch(e){jfDeskMessage('截图未加入笔记：'+e.message,true);console.warn('[PDF 图片摘录]',e);}
  finally{if(button)button.disabled=false;}
}
async function jfPdfJsSaveCaptureMark(){
  const choice=jfPdfJsState.selection,bookId=jfDeskBook?.id;
  if(!choice||!bookId)return;
  const record=jfPdfJsState.pages.get(choice.index);
  if(!record?.canvas){jfDeskMessage('当前截图页已经离开缓存，请重新选择',true);return;}
  const overlay=record.el.querySelector('.jfPdfCaptureLayer'),button=overlay?.querySelector('.jfPdfCaptureMark');
  if(button)button.disabled=true;
  try{
    const normalized=jfPdfCaptureNormalized(choice,record);
    await jfDeskMutate({action:'mark',mark:{bookId,chapter:choice.index,type:'area',area:normalized.area,segments:normalized.shape}});
    jfPdfJsRenderMarks();jfPdfJsMarksListRender();
    jfDeskMessage('截图区域已标记');
    jfPdfJsCaptureClear();
  }catch(e){jfDeskMessage('截图区域未标记：'+e.message,true);console.warn('[PDF 区域标记]',e);}
  finally{if(button)button.disabled=false;}
}
document.getElementById('jfPdfNight').addEventListener('click',()=>{
  const state=jfPdfJsState;state.night=!state.night;document.getElementById('jfPdfNight').setAttribute('aria-pressed',String(state.night));
  for(const record of state.pages.values())record.el.classList.toggle('jfPdfPageNight',state.night);
});
document.getElementById('jfPdfSharpen').addEventListener('click',()=>{
  jfPdfJsState.sharp=jfPdfJsState.sharp?0:1;
  const button=document.getElementById('jfPdfSharpen');
  const name=jfPdfJsState.sharp?'增强':'关闭';
  button.title='PDF 锐化：'+name+'（点击切换）';button.setAttribute('aria-label','PDF 锐化：'+name);
  button.setAttribute('aria-pressed',String(jfPdfJsState.sharp!==0));
  for(const record of jfPdfJsState.pages.values())jfPdfJsApplySharp(record);
  jfPdfJsResize();
});
document.getElementById('jfPdfCapture').addEventListener('click',jfPdfJsToggleCapture);
document.getElementById('jfPdfCaptureCancel').addEventListener('click',jfPdfJsCaptureClear);
document.getElementById('jfPdfCaptureSave').addEventListener('click',jfPdfJsSaveCapture);
document.getElementById('jfPdfGoPage').addEventListener('keydown',e=>{if(e.key==='Enter'){jfDeskShowPdfPage(Number(e.currentTarget.value)-1);e.currentTarget.blur();}if(e.key==='Escape')e.currentTarget.blur();});
document.getElementById('jfPdfGoPage').addEventListener('change',e=>{const n=Number(e.currentTarget.value);if(Number.isSafeInteger(n))jfDeskShowPdfPage(n-1);});
const jfPdfJsCovers=new Map();let jfPdfJsCoverWorking=0;
const jfPdfJsCoverObserver=(typeof IntersectionObserver==='function')?new IntersectionObserver(entries=>{
  for(const entry of entries){if(!entry.isIntersecting)continue;
    jfPdfJsCoverObserver.unobserve(entry.target);
    const book=entry.target.__jfCoverBook;if(book)jfPdfJsCoverFallback(book,entry.target);
  }
},{rootMargin:'350px'}):null;
function jfPdfJsObserveCover(book,cover){
  if(!jfPdfJsCoverObserver){jfPdfJsCoverFallback(book,cover);return;}
  cover.__jfCoverBook=book;jfPdfJsCoverObserver.observe(cover);
}

async function jfPdfJsCoverFallback(book,cover){
  if(!cover?.isConnected||jfPdfJsCovers.get(book.id)==='failed')return;
  try{
    while(jfPdfJsCoverWorking>=2)await new Promise(r=>setTimeout(r,120));
    if(!cover.isConnected)return;
    ++jfPdfJsCoverWorking;
    let url=jfPdfJsCovers.get(book.id);
    if(!url){
      const pdfjs=await jfPdfJsGetModule();
      const task=pdfjs.getDocument({url:new URL('/api/reading/pdf?id='+encodeURIComponent(book.id),document.baseURI).href,
        cMapUrl:'/api/jf-pdf/cmaps/',cMapPacked:true,standardFontDataUrl:'/api/jf-pdf/standard_fonts/',wasmUrl:'/api/jf-pdf/wasm/',isEvalSupported:false});
      try{
        const doc=await task.promise;
        const page=await doc.getPage(1),base=page.getViewport({scale:1});
        const vp=page.getViewport({scale:Math.min(440/base.width,440/base.height)});
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport:vp,background:'#fff'}).promise;
        url=canvas.toDataURL('image/png');jfPdfJsCovers.set(book.id,url);
        if(jfPdfJsCovers.size>25)jfPdfJsCovers.delete(jfPdfJsCovers.keys().next().value);
      }finally{await task.destroy();}
    }
    if(cover.isConnected&&!cover.querySelector('.jfBookCoverImage')){
      const img=document.createElement('img');img.className='jfBookCoverImage';img.alt='';img.src=url;
      cover.prepend(img);
    }
  }catch(err){jfPdfJsCovers.set(book.id,'failed');console.warn('[PDF封面] ',err.message);}
  finally{jfPdfJsCoverWorking=Math.max(0,jfPdfJsCoverWorking-1);}
}

// PDF pinch: CSS-composited preview during the gesture, one PDF.js high-res
// re-render only after touch ends / precision touchpad goes idle. Never rebuild
// the ten-page window during continuous finger movement.
// Save an actual page-relative reading point, not just a page number.
// It must remain under the same viewport Y when the ten-page stream resizes.
let jfPdfPinchAnchor=null;
function jfPdfJsTakeZoomAnchor(clientX,clientY){
  const frame=jfReadCenter.getBoundingClientRect();
  const x=Number.isFinite(clientX)?clientX:frame.left+frame.width*.5;
  const y=Number.isFinite(clientY)?clientY:frame.top+frame.height*.42;
  let chosen=null,best=Infinity;
  for(const record of jfPdfJsState.pages.values()){
    const box=record.el.getBoundingClientRect();
    const distance=y<box.top?box.top-y:y>box.bottom?y-box.bottom:0;
    if(distance<best){chosen={record,box};best=distance;}
  }
  if(!chosen)return null;
  const {record,box}=chosen;
  const ratioY=Math.max(0,Math.min(1,(y-box.top)/Math.max(1,box.height)));
  return {index:record.index,ratioY,clientY:y,clientX:x};
}
function jfPdfJsRestoreZoomAnchor(anchor){
  if(!anchor)return;
  const record=jfPdfJsState.pages.get(anchor.index);if(!record?.el.isConnected)return;
  const box=record.el.getBoundingClientRect();
  const targetY=jfPdfProjection.zoomPosition(box,anchor.ratioY);
  const delta=targetY-anchor.clientY;
  if(Number.isFinite(delta)&&Math.abs(delta)>.1)jfReadCenter.scrollTop+=delta;
}
let jfPdfPinchTimer=null,jfPdfTouchStart=null,jfPdfTouchZoom=null;
let jfPdfPinchBaseZoom=null,jfPdfPinchFrame=0,jfPdfPinchPending=1,jfPdfPinchOrigin=null;
function jfPdfGestureReset(){
  clearTimeout(jfPdfPinchTimer);jfPdfPinchTimer=null;
  if(jfPdfPinchFrame)cancelAnimationFrame(jfPdfPinchFrame);
  jfPdfPinchFrame=0;jfPdfPinchBaseZoom=null;jfPdfPinchPending=1;jfPdfPinchOrigin=null;
  jfPdfTouchStart=null;jfPdfTouchZoom=null;jfPdfPinchAnchor=null;
  const sheet=document.getElementById('jfPdfJsSheet');
  if(sheet){sheet.style.removeProperty('transform');sheet.style.removeProperty('transform-origin');sheet.style.removeProperty('will-change');}
}
function jfPdfGestureFinish(){
  clearTimeout(jfPdfPinchTimer);jfPdfPinchTimer=null;
  if(jfPdfPinchBaseZoom===null)return;
  const base=jfPdfPinchBaseZoom,target=jfDeskPdfZoom,anchor=jfPdfPinchAnchor;
  jfPdfGestureReset();
  // A pinch/wheel change below the 44vw floor should not re-render the same
  // page bitmaps. CSS preview has already tracked the pointer throughout.
  if(!jfReader.hidden&&jfPdfJsState.doc&&Math.abs(target-base)>.001){
    if((base<.5)===(target<.5)&&jfDeskPdfWidth(base)===jfDeskPdfWidth(target)){
      document.getElementById('jfPdfZoomLabel').textContent=Math.round(target*100)+'%';
    }else jfPdfJsResize(anchor);
  }
}
function jfPdfGesturePreview(){
  jfPdfPinchFrame=0;
  if(jfPdfPinchBaseZoom===null)return;
  const sheet=document.getElementById('jfPdfJsSheet');
  if(!sheet)return;
  // Fix the origin on the first animation frame; recomputing it from an
  // already transformed bounding box made the content drift under the fingers.
  if(!jfPdfPinchOrigin){
    const anchor=jfPdfPinchAnchor;
    if(anchor){const rect=sheet.getBoundingClientRect();
      jfPdfPinchOrigin={x:anchor.clientX-rect.left,y:anchor.clientY-rect.top};
    }
  }
  sheet.style.transformOrigin=jfPdfPinchOrigin
    ?jfPdfPinchOrigin.x+'px '+jfPdfPinchOrigin.y+'px':'50% 0';
  sheet.style.willChange='transform';
  sheet.style.transform='scale('+jfPdfPinchPending.toFixed(4)+')';
}
function jfPdfGestureZoom(value,kind='wheel',clientX=null,clientY=null){
  const next=Math.max(.25,Math.min(2.8,value));
  if(jfPdfPinchBaseZoom===null){jfPdfPinchBaseZoom=jfDeskPdfZoom;jfPdfPinchAnchor=jfPdfJsTakeZoomAnchor(clientX,clientY);}
  jfDeskPdfZoom=next;
  jfPdfPinchPending=next/jfPdfPinchBaseZoom;
  if(!jfPdfPinchFrame)jfPdfPinchFrame=requestAnimationFrame(jfPdfGesturePreview);
  clearTimeout(jfPdfPinchTimer);
  // Touchscreens do not settle until the second finger is lifted.
  if(kind==='wheel')jfPdfPinchTimer=setTimeout(jfPdfGestureFinish,140);
}
jfReadCenter.addEventListener('wheel',e=>{
  if(jfReader.hidden||!jfPdfJsState.doc||!e.ctrlKey||jfPdfJsState.capture)return;
  e.preventDefault();jfPdfGestureZoom(jfDeskPdfZoom*Math.exp(-e.deltaY*.008),'wheel',e.clientX,e.clientY);
},{passive:false});
jfReadCenter.addEventListener('touchstart',e=>{
  if(!jfPdfJsState.doc||e.touches.length!==2||jfPdfJsState.capture)return;
  const [a,b]=e.touches;jfPdfTouchStart=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  jfPdfTouchZoom=jfDeskPdfZoom;
},{passive:true});
jfReadCenter.addEventListener('touchmove',e=>{
  if(!jfPdfJsState.doc||e.touches.length!==2||!jfPdfTouchStart||jfPdfJsState.capture)return;
  const [a,b]=e.touches;const distance=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  e.preventDefault();jfPdfGestureZoom(jfPdfTouchZoom*distance/jfPdfTouchStart,'touch',(a.clientX+b.clientX)/2,(a.clientY+b.clientY)/2);
},{passive:false});
jfReadCenter.addEventListener('touchend',e=>{
  if(e.touches.length<2){jfPdfTouchStart=null;jfPdfTouchZoom=null;jfPdfGestureFinish();}
},{passive:true});
jfReadCenter.addEventListener('touchcancel',()=>jfPdfGestureFinish(),{passive:true});
