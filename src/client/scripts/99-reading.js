// v6.50 · Reading & Notes — private workspace, no external dependencies or HTML injection.
const jfReader=document.getElementById('jfReader');
const jfReadCenter=document.getElementById('jfReadCenter');
const jfReadText=document.getElementById('jfReadText');
// Keep the source chapter untouched: only TXT presentation is reflowed.
// This leaves EPUB layout, chapter boundaries, and on-disk source intact.
let jfReadRawText='',jfReadRawToDisplay=null;
function jfTxtSmartReflow(raw){return jfTextPresentation.reflow(raw);}

// Screenshot-safe display mask. Full-width replacement glyphs preserve
// the space occupied by Han characters, unlike ASCII substitutions.
let jfReadVisualText='',jfReadMaskEnabled=false;
function jfReadMaskString(value){return jfTextPresentation.mask(value);}
function jfReadApplyMask(){
  jfReadText.textContent=jfReadMaskEnabled?jfReadMaskString(jfReadVisualText):jfReadVisualText;
  if(jfDeskBook)document.getElementById('jfReadTitle').textContent=jfReadMaskEnabled?jfReadMaskString(jfDeskBook.title):jfDeskBook.title;
  for(const option of document.getElementById('jfReadChapters').options){
    const original=option.dataset.jfOriginalChapter||option.textContent;
    if(!option.dataset.jfOriginalChapter)option.dataset.jfOriginalChapter=original;
    option.textContent=jfReadMaskEnabled?jfReadMaskString(original):original;
  }
  const button=document.getElementById('jfReadMask');
  if(button){button.setAttribute('aria-pressed',String(jfReadMaskEnabled));button.classList.toggle('active',jfReadMaskEnabled);button.title=jfReadMaskEnabled?'关闭截图乱码':'截图乱码（仅修改显示）';}
  const excerpt=document.getElementById('jfReadExcerpt');
  if(excerpt)excerpt.disabled=jfReadMaskEnabled;
}
function jfReadToggleMask(){
  jfReadMaskEnabled=!jfReadMaskEnabled;
  if(!jfDeskOutline?.nativePdf&&!jfReadText.hidden)jfReadApplyMask();
  else{const b=document.getElementById('jfReadMask');b?.setAttribute('aria-pressed',String(jfReadMaskEnabled));}
}

const jfNotesPanel=document.getElementById('jfDeskNotes');
let jfDeskBook=null,jfDeskOutline=null,jfDeskChapter=0,jfDeskEpoch=0,jfDeskFont=18;
let jfDeskWorkspace={revision:0,progress:{},notes:[]},jfDeskChain=Promise.resolve();
let jfDeskActiveNote=null,jfDeskDirty=false,jfDeskSaveTimer=null,jfDeskProgressTimer=null,jfDeskProgressSignature='';
let jfDeskSaveFailed=false,jfDeskEditorVersion=0,jfDeskSaveInFlight=null,jfDeskDraft=null,jfDeskSelectedQuote=null;
let jfDeskPrefs={font:18,theme:'dark',side:22,family:'serif'};
const jfReadFamilyMap={serif:"'Noto Serif SC','Songti SC','SimSun',serif",sans:"'Noto Sans SC','Microsoft YaHei',sans-serif",kai:"'Kaiti SC','KaiTi','STKaiti',serif",mono:"'Sarasa Mono SC','Microsoft YaHei UI',monospace"};
function jfApplyTextReadingPrefs(){
  jfDeskFont=jfDeskPrefs.font;
  jfReadText.style.fontSize=jfDeskFont+'px';
  jfReadText.style.setProperty('--jf-read-side',jfDeskPrefs.side+'px');
  jfReadText.style.fontFamily=jfReadFamilyMap[jfDeskPrefs.family]||jfReadFamilyMap.serif;
  document.getElementById('jfReadFamily').value=jfDeskPrefs.family;
  document.getElementById('jfReadSide').value=String(jfDeskPrefs.side);
  document.getElementById('jfReadSideValue').textContent=jfDeskPrefs.side+'px';
  jfReader.classList.toggle('paper',jfDeskPrefs.theme==='paper');
}

let jfDeskQuotePending=null,jfDeskQuoteTarget='new',jfDeskQuoteLast=null;
let jfNoteLiveQuotes=[];
const jfNoteHistory={noteId:null,states:[],index:-1,replaying:false};
// IME composition is a single semantic edit, not a sequence of phonetic drafts.
let jfNoteIsComposing=false;
let jfNoteImagesNight=false;
try{jfNoteImagesNight=localStorage.getItem('jf-note-image-night')==='1';}catch{}
function jfNoteSetImageNight(enabled){
  jfNoteImagesNight=!!enabled;
  const button=document.getElementById('jfNoteImagesNight');
  button?.setAttribute('aria-pressed',String(jfNoteImagesNight));
  if(button)button.textContent=jfNoteImagesNight?'图片开灯':'图片关灯';
  document.getElementById('jfDeskNotes').classList.toggle('jfNoteImagesNight',jfNoteImagesNight);
  try{localStorage.setItem('jf-note-image-night',jfNoteImagesNight?'1':'0');}catch{}
}

function jfNoteSnapshot(){
  const blocks=jfDeskEditorBlocks();
  return {title:document.getElementById('jfDeskNoteTitle').value,blocks,quotes:jfNoteLiveQuotes.map(q=>({...q})),mode:jfNoteMode};
}
function jfNoteHistoryReset(){
  jfNoteHistory.noteId=jfDeskActiveNote;jfNoteHistory.states=[];jfNoteHistory.index=-1;
  if(jfDeskActiveNote)jfNoteHistoryPush();
}
function jfNoteHistoryPush(){
  if(jfNoteIsComposing)return;
  if(jfNoteHistory.replaying||!jfDeskActiveNote)return;
  if(jfNoteHistory.noteId!==jfDeskActiveNote){jfNoteHistory.noteId=jfDeskActiveNote;jfNoteHistory.states=[];jfNoteHistory.index=-1;}
  const snap=jfNoteSnapshot();
  const last=jfNoteHistory.states[jfNoteHistory.index];
  if(last&&JSON.stringify(last.blocks)===JSON.stringify(snap.blocks)&&last.title===snap.title&&last.mode===snap.mode&&last.quotes.every((q,i)=>q.imageWidth===snap.quotes[i]?.imageWidth&&q.imageAlign===snap.quotes[i]?.imageAlign)&&last.quotes.length===snap.quotes.length)return;
  jfNoteHistory.states=jfNoteHistory.states.slice(0,jfNoteHistory.index+1);
  jfNoteHistory.states.push(snap);
  if(jfNoteHistory.states.length>70)jfNoteHistory.states.shift();
  jfNoteHistory.index=jfNoteHistory.states.length-1;
}
function jfNoteHistoryTravel(delta){
  if(jfNoteHistory.noteId!==jfDeskActiveNote)return;
  const target=jfNoteHistory.index+delta;
  if(target<0||target>=jfNoteHistory.states.length)return;
  const snap=jfNoteHistory.states[target];jfNoteHistory.index=target;
  jfNoteHistory.replaying=true;
  try{
    const note=jfDeskWorkspace.notes.find(n=>n.id===jfDeskActiveNote)||jfDeskDraft||{};
    jfDeskRenderQuotes({...note,blocks:snap.blocks,quotes:snap.quotes,format:snap.mode,content:snap.blocks.filter(b=>b.kind==='text').map(b=>b.text).join('\n')});
    document.getElementById('jfDeskNoteTitle').value=snap.title;
    const root=document.getElementById('jfDeskExcerpt');root.focus();
    const el=root.querySelector('.jfNoteTextChunk:last-child')||root;
    const range=document.createRange();range.selectNodeContents(el);range.collapse(false);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    jfDeskScheduleEditor();
  }finally{jfNoteHistory.replaying=false;}
}
function jfNoteHistoryKeydown(event){
  if(jfNoteIsComposing||event.isComposing||event.keyCode===229)return false;
  if(!(event.ctrlKey||event.metaKey)||event.altKey)return false;
  const key=event.key.toLowerCase();
  const backward=key==='z'&&!event.shiftKey;
  const forward=key==='y'||(key==='z'&&event.shiftKey);
  if(!backward&&!forward)return false;
  if(!jfDeskActiveNote)return false;
  event.preventDefault();event.stopPropagation();
  jfNoteHistoryTravel(backward?-1:1);return true;
}

function jfDeskMessage(message,fail=false){
  const node=document.getElementById('jfDeskSaveState');node.textContent=message;node.style.color=fail?'#dfa99f':'#8fa3aa';
  const header=document.getElementById('jfDeskStatus');header.hidden=!fail;header.textContent=fail?message:'';
}
async function jfDeskApi(path,method='GET',body){
  const response=await fetch('/api/reading/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const result=await response.json().catch(()=>({error:'服务未返回可解析的数据'}));
  if(!response.ok||result.ok===false)throw Error(result.error||'阅读服务暂时不可用');
  return result;
}
async function jfDeskLoadWorkspace(){
  try{jfDeskWorkspace=await jfDeskApi('workspace');jfDeskSaveFailed=false;jfDeskQuoteLast=jfDeskWorkspace.lastExcerptNoteId||null;
    const pref=jfDeskWorkspace.preferences||{};
    jfDeskPrefs={font:Math.max(13,Math.min(28,Number(pref.font)||18)),theme:pref.theme==='paper'?'paper':'dark',side:Number.isSafeInteger(pref.side)?Math.min(100,Math.max(6,pref.side)):22,family:jfReadFamilyMap[pref.family]?pref.family:'serif'};
    jfApplyTextReadingPrefs();
    jfDeskMessage('已载入');jfDeskRenderNotes();if(document.body.classList.contains('jfBooksMode'))jfBooksRender();}
  catch(e){jfDeskSaveFailed=true;jfDeskMessage(e.message,true);console.warn('笔记读取失败，已禁止覆盖原数据：',e.message);}
}
function jfDeskMutate(payload){
  // One browser tab never writes overlapping revisions; other tabs get explicit 409.
  const pending=jfDeskChain.catch(()=>{}).then(async()=>{
    if(jfDeskSaveFailed)throw Error('笔记数据尚未安全载入；拒绝继续写入');
    const updated=await jfDeskApi('workspace','POST',{...payload,revision:jfDeskWorkspace.revision});
    jfDeskWorkspace=updated;return updated;
  });
  jfDeskChain=pending;
  return pending;
}
function jfDeskActiveBook(){return jfDeskBook?jfDeskBook.id:'';}
function jfDeskSetPref(change){
  jfDeskPrefs={...jfDeskPrefs,...change};
  jfApplyTextReadingPrefs();
  jfDeskMutate({action:'preferences',preferences:{...jfDeskPrefs}}).catch(e=>jfDeskMessage('阅读设置未保存：'+e.message,true));
}
// v6.57 PDF reading: keep the current page visible while rendering the next.
// Prefetch is a soft optimization, never a reason to block manual navigation.
let jfDeskPdfInfo=null,jfDeskPdfZoom=1,jfDeskPdfRenderEpoch=0;
let jfDeskPdfAbort=null,jfDeskPdfVisibleBook='',jfDeskPdfVisiblePage=-1;
const jfDeskPdfWarm=new Map();let jfDeskPdfWarmEpoch=0;
function jfDeskPdfWidth(zoom=jfDeskPdfZoom){
  const viewport=Math.max(480,jfReadCenter.clientWidth-100);
  return Math.max(zoom<.5?Math.ceil(window.innerWidth*.44):320,Math.min(1800,Math.round(Math.min(viewport,1000)*zoom)));
}
function jfDeskPdfUrl(bookId,number,width){
  return '/api/reading/pdf-page?id='+encodeURIComponent(bookId)+'&page='+(number+1)+'&width='+width;
}
function jfDeskPdfClear(){
  jfPdfJsDispose();
  ++jfDeskPdfRenderEpoch;++jfDeskPdfWarmEpoch;
  jfDeskPdfAbort?.abort();jfDeskPdfAbort=null;
  for(const item of jfDeskPdfWarm.values())if(item?.url)URL.revokeObjectURL(item.url);
  jfDeskPdfWarm.clear();
  const image=document.getElementById('jfPdfPageImage');
  if(image.dataset.objectUrl)URL.revokeObjectURL(image.dataset.objectUrl);
  delete image.dataset.objectUrl;image.removeAttribute('src');image.hidden=true;
  jfDeskPdfVisibleBook='';jfDeskPdfVisiblePage=-1;
}
async function jfDeskPdfFetch(bookId,number,width,signal){
  const response=await fetch(jfDeskPdfUrl(bookId,number,width),{cache:'no-store',signal});
  if(!response.ok)throw Error('PDF 第 '+(number+1)+' 页渲染失败（HTTP '+response.status+'）');
  const blob=await response.blob();
  if(blob.type!=='image/png'||blob.size<100)throw Error('PDF 页面内容无效');
  return URL.createObjectURL(blob);
}
function jfDeskPdfWarmAdjacent(bookId,number,width){
  // Only one neighbor is prefetched to avoid competing with active media playback.
  const next=number+1;if(!jfDeskPdfInfo||next>=jfDeskPdfInfo.pages)return;
  const key=bookId+':'+next+':'+width;if(jfDeskPdfWarm.has(key))return;
  const generation=jfDeskPdfWarmEpoch;
  const entry={url:null,promise:null};jfDeskPdfWarm.set(key,entry);
  entry.promise=jfDeskPdfFetch(bookId,next,width).then(url=>{
    if(generation!==jfDeskPdfWarmEpoch||jfDeskBook?.id!==bookId){URL.revokeObjectURL(url);return null;}
    entry.url=url;return url;
  }).catch(()=>null).finally(()=>{
    if(!entry.url&&jfDeskPdfWarm.get(key)===entry)jfDeskPdfWarm.delete(key);
  });
  // A bounded single prefetch object URL is enough for the next page.
  for(const [oldKey,item] of jfDeskPdfWarm){
    if(oldKey===key)continue;
    if(item.url)URL.revokeObjectURL(item.url);
    jfDeskPdfWarm.delete(oldKey);
  }
}
function jfDeskPdfNativeFallback(bookId,message){
  jfDeskPdfClear();
  document.getElementById('jfPdfPages').hidden=true;
  const pdf=document.getElementById('jfReadPdf');pdf.hidden=false;
  pdf.src='/api/reading/pdf?id='+encodeURIComponent(bookId);
  const format=document.getElementById('jfReadFormat');
  format.textContent='PDF · 系统兼容预览';
  // Surface only the diagnostic stage; never expose an absolute user file path.
  const stages=String(message||'').match(/JF_PDF_STAGE:(init|open|load|render|read)/g)||[];
  const stage=stages.length?stages[stages.length-1].split(':')[1]:'unknown';
  format.title='PDF 独立渲染未启用（失败阶段：'+stage+'）。仍可使用系统预览。';
  console.warn('[JUSTFUN_PDF_FALLBACK]',{stage,message:String(message||'').replace(/[A-Za-z]:\\[^\s]+/g,'[path]').slice(0,180)});
  document.getElementById('jfReadProgress').textContent='系统预览';
  document.getElementById('jfReadProgressFill').style.width='0%';
  document.getElementById('jfReadFooter').hidden=true;
  console.warn('自定义 PDF 渲染失败，已恢复原生阅读：'+message);
}
async function jfDeskShowPdfPage(number){
  if(jfDeskOutline?.nativePdf)return jfPdfJsState.doc?jfPdfJsPage(number):Promise.resolve();
  if(!jfDeskBook||!jfDeskPdfInfo||!Number.isInteger(number)||number<0||number>=jfDeskPdfInfo.pages)return;
  const token=++jfDeskPdfRenderEpoch;
  jfDeskPdfAbort?.abort();const controller=new AbortController();jfDeskPdfAbort=controller;
  const pages=document.getElementById('jfPdfPages'),image=document.getElementById('jfPdfPageImage');
  const status=document.getElementById('jfPdfPageStatus'),pdfId=jfDeskBook.id;
  const width=jfDeskPdfWidth(),key=pdfId+':'+number+':'+width;
  pages.hidden=false;
  // Preserve the previous readable frame; never blank the book while turning.
  const hasFrame=!image.hidden&&image.dataset.objectUrl&&jfDeskPdfVisibleBook===pdfId;
  status.hidden=false;status.textContent='第 '+(number+1)+' 页正在载入…';
  status.classList.toggle('jfPdfPageStatusOverlay',!!hasFrame);
  if(!hasFrame)image.hidden=true;
  let url=null;
  try{
    const warm=jfDeskPdfWarm.get(key);
    if(warm){url=warm.url||await warm.promise;jfDeskPdfWarm.delete(key);}
    if(!url)url=await jfDeskPdfFetch(pdfId,number,width,controller.signal);
    if(token!==jfDeskPdfRenderEpoch||jfDeskBook?.id!==pdfId){URL.revokeObjectURL(url);return;}
    // Decode first: a PNG object URL existing does not mean pixels are ready.
    const decoded=new Image();decoded.src=url;
    await decoded.decode();
    if(token!==jfDeskPdfRenderEpoch||jfDeskBook?.id!==pdfId){URL.revokeObjectURL(url);return;}
    const prev=image.dataset.objectUrl;
    image.src=url;image.dataset.objectUrl=url;image.style.width=width+'px';image.hidden=false;
    jfDeskPdfVisibleBook=pdfId;jfDeskPdfVisiblePage=number;
    if(prev&&prev!==url)URL.revokeObjectURL(prev);
    status.hidden=true;status.classList.remove('jfPdfPageStatusOverlay');
    jfDeskChapter=number;jfReadCenter.scrollTop=0;
    const chooser=document.getElementById('jfReadChapters');chooser.value=String(number);
    document.getElementById('jfReadPrev').disabled=number===0;
    document.getElementById('jfReadNext').disabled=number===jfDeskPdfInfo.pages-1;
    const percent=Math.round((number+1)/jfDeskPdfInfo.pages*100);
    document.getElementById('jfReadProgress').textContent=(number+1)+' / '+jfDeskPdfInfo.pages;
    document.getElementById('jfReadProgressFill').style.width=percent+'%';
    document.getElementById('jfPdfZoomLabel').textContent=Math.round(jfDeskPdfZoom*100)+'%';
    jfDeskMutate({action:'progress',bookId:pdfId,chapter:number,ratio:0,total:jfDeskPdfInfo.pages}).catch(e=>jfDeskMessage('PDF 阅读进度未保存：'+e.message,true));
    jfDeskPdfWarmAdjacent(pdfId,number,width);
  }catch(error){
    if(url)URL.revokeObjectURL(url);
    if(token!==jfDeskPdfRenderEpoch||error.name==='AbortError')return;
    // Even if a previous page is visible, never strand the reader on an
    // unrenderable page. Native preview is a read-only last resort.
    jfDeskPdfNativeFallback(pdfId,error.message);
  }
}
function jfDeskPdfScale(next){
  const wasSpread=jfDeskPdfZoom<.5,wasWidth=jfDeskPdfWidth();
  jfDeskPdfZoom=Math.max(.25,Math.min(2.8,next));
  if(!(jfDeskBook&&jfDeskOutline?.nativePdf&&jfDeskPdfInfo))return;
  // In the two-page range, 44vw may already be the width floor. Zooming
  // 45% -> 35% then changes neither the bitmaps nor the layout: don't
  // force ten unnecessary expensive PDF page re-renders.
  if(wasSpread===(jfDeskPdfZoom<.5)&&wasWidth===jfDeskPdfWidth()){
    document.getElementById('jfPdfZoomLabel').textContent=Math.round(jfDeskPdfZoom*100)+'%';
    return;
  }
  jfPdfJsResize();
}
document.getElementById('jfPdfZoomOut').addEventListener('click',()=>jfDeskPdfScale(jfDeskPdfZoom-.15));
document.getElementById('jfPdfZoomIn').addEventListener('click',()=>jfDeskPdfScale(jfDeskPdfZoom+.15));
document.getElementById('jfPdfFit').addEventListener('click',()=>jfDeskPdfScale(1));
async function jfDeskOpenReader(bookId,chapter){
  jfDeskPdfClear();jfDeskPdfInfo=null;jfDeskPdfZoom=1;
  jfReadRawText='';jfReadRawToDisplay=null;jfReadVisualText='';jfReadMaskEnabled=false;
  document.getElementById('jfReadExcerpt').disabled=false;
  jfPdfJsMarksListClose();document.getElementById('jfPdfMarksListToggle').hidden=true;
  const epoch=++jfDeskEpoch;
  jfBooksHideDetail();
  jfReader.hidden=false;
  jfReadText.textContent='正在打开这本书…';
  jfReadText.hidden=false;document.getElementById('jfReadPdf').hidden=true;document.getElementById('jfPdfPages').hidden=true;document.getElementById('jfReadError').hidden=true;
  document.getElementById('jfReadTitle').textContent='正在载入';
  jfDeskOutline=null;jfDeskBook=null;
  try{
    const outline=await jfDeskApi('outline?id='+encodeURIComponent(bookId));
    if(epoch!==jfDeskEpoch)return;
    jfDeskOutline=outline;jfDeskBook=outline.book;
    document.getElementById('jfReadMask').hidden=outline.format==='PDF';
    document.getElementById('jfReadTitle').textContent=outline.book.title;
    document.getElementById('jfReadFormat').textContent=outline.format+' / JUST FUN';
    const select=document.getElementById('jfReadChapters');select.replaceChildren();
    for(let i=0;i<outline.chapters.length;i++){const option=document.createElement('option');option.value=String(i);option.textContent=outline.chapters[i].title;select.append(option);}
    jfReader.classList.toggle('jfPdfMode',!!outline.nativePdf);
    if(outline.nativePdf){
      jfReadText.hidden=true;
      const saved=jfDeskWorkspace.progress[bookId];
      try{
        // Use version-matched PDF.js in the SAME browser on Windows, Linux and macOS.
        // Never treat OS Poppler/PowerShell rasterization as the primary reader.
        const pdfInfo=await jfPdfJsOpen(bookId);
        if(epoch!==jfDeskEpoch)return;
        jfDeskPdfInfo=pdfInfo;
        jfDeskOutline.chapters=Array.from({length:Math.min(pdfInfo.pages,10000)},(_,i)=>({title:'第 '+(i+1)+' 页'}));
        const select=document.getElementById('jfReadChapters');select.replaceChildren(); // PDF uses numeric jump, not a 342-item dropdown.
        document.getElementById('jfReadFormat').textContent='PDF / JUST FUN';
        document.getElementById('jfReadFooter').hidden=false;
        document.getElementById('jfPdfPages').hidden=false;
        await jfDeskShowPdfPage(Number.isInteger(chapter)?chapter:Math.min(pdfInfo.pages-1,saved?.chapter||0));
      }catch(pdfError){
        if(epoch!==jfDeskEpoch)return;
        jfPdfJsError(bookId,pdfError);
      }
      // Keep PDF.js scroll position restored by jfPdfJsPage; do not force scroll back to zero.
    }else{
      document.getElementById('jfReadFooter').hidden=false;
      const saved=jfDeskWorkspace.progress[bookId];
      const start=Number.isInteger(chapter)?chapter:(saved?.chapter??0);
      const ratio=Number.isInteger(chapter)?0:(saved?.ratio||0);
      await jfDeskShowChapter(Math.max(0,Math.min(outline.chapters.length-1,start)),ratio);
    }
    document.getElementById('jfReadBack').focus();
  }catch(e){if(epoch!==jfDeskEpoch)return;jfReadText.hidden=true;document.getElementById('jfReadError').hidden=false;
    document.getElementById('jfReadError').textContent='打开失败：'+e.message;}
}
async function jfDeskShowChapter(number,ratio=0){
  if(jfDeskOutline?.nativePdf)return jfDeskShowPdfPage(number);
  if(!jfDeskBook||!jfDeskOutline||number<0||number>=jfDeskOutline.chapters.length)return;
  const epoch=++jfDeskEpoch;
  try{
    const data=await jfDeskApi('chapter?id='+encodeURIComponent(jfDeskBook.id)+'&chapter='+number);
    if(epoch!==jfDeskEpoch)return;
    jfDeskChapter=number;jfReadText.hidden=false;
    jfReadRawText=data.text;
    if(jfDeskOutline.format==='TXT'){
      const flowing=jfTxtSmartReflow(data.text);
      jfReadVisualText=flowing.text;jfReadRawToDisplay=flowing.rawToDisplay;
    }else{jfReadVisualText=data.text;jfReadRawToDisplay=null;}
    jfReadApplyMask();
    jfReadText.classList.toggle('jfTxtProse',jfDeskOutline.format==='TXT');
    document.getElementById('jfPdfMarksListToggle').hidden=false;
    if(!document.getElementById('jfPdfMarksList').hidden)jfPdfJsMarksListRender();
    const chapterSelect=document.getElementById('jfReadChapters');chapterSelect.value=String(number);
    document.getElementById('jfReadPrev').disabled=number===0;
    document.getElementById('jfReadNext').disabled=number===jfDeskOutline.chapters.length-1;
    jfReadCenter.scrollTop=0;
    requestAnimationFrame(()=>{if(epoch!==jfDeskEpoch)return;
      jfReadCenter.scrollTop=Math.max(0,jfReadCenter.scrollHeight-jfReadCenter.clientHeight)*ratio;
      jfDeskProgressSignature='';jfDeskUpdateProgress();});
  }catch(e){if(epoch!==jfDeskEpoch)return;jfReadText.textContent='章节无法打开：'+e.message;}
}
function jfDeskUpdateProgress(){
  if(!jfDeskBook||!jfDeskOutline||jfDeskOutline.nativePdf||jfReader.hidden)return;
  const max=Math.max(0,jfReadCenter.scrollHeight-jfReadCenter.clientHeight);
  const ratio=max?Math.min(1,jfReadCenter.scrollTop/max):0;
  const pct=Math.round((jfDeskChapter+ratio)/jfDeskOutline.chapters.length*100);
  document.getElementById('jfReadProgress').textContent=pct+'%';
  document.getElementById('jfReadProgressFill').style.width=pct+'%';
  const sig=jfDeskBook.id+':'+jfDeskChapter+':'+Math.round(ratio*100);
  if(sig===jfDeskProgressSignature)return;
  jfDeskProgressSignature=sig;
  clearTimeout(jfDeskProgressTimer);
  const bookId=jfDeskBook.id,chapter=jfDeskChapter,total=jfDeskOutline.chapters.length;
  jfDeskProgressTimer=setTimeout(()=>{jfDeskMutate({action:'progress',bookId,chapter,ratio,total}).catch(e=>{jfDeskMessage(e.message,true);});},900);
}
async function jfDeskCloseReader(){
  if(jfReader.hidden)return await jfDeskCloseNotes();
  // Never leave the reader if a note is not durably saved.
  if(!await jfDeskCloseNotes())return false;
  clearTimeout(jfDeskProgressTimer);
  const book=jfDeskBook;
  if(book&&!jfDeskOutline?.nativePdf){
    const max=Math.max(0,jfReadCenter.scrollHeight-jfReadCenter.clientHeight);
    const ratio=max?Math.min(1,jfReadCenter.scrollTop/max):0;
    try{await jfDeskMutate({action:'progress',bookId:book.id,chapter:jfDeskChapter,ratio,total:jfDeskOutline.chapters.length});}
    catch(e){jfDeskMessage('阅读位置未保存：'+e.message,true);return false;}
  }
  jfReadMaskEnabled=false;jfReadVisualText='';document.getElementById('jfReadExcerpt').disabled=false;jfDeskPdfClear();++jfDeskEpoch;jfReader.hidden=true;jfReader.classList.remove('jfPdfMode');jfDeskBook=null;jfDeskOutline=null;jfDeskPdfInfo=null;
  document.getElementById('jfPdfPages').hidden=true;
  document.getElementById('jfReadPdf').removeAttribute('src');
  if(document.body.classList.contains('jfNotesMode'))jfDeskOpenNotes();
  jfBooksRender();return true;
}
function jfDeskOpenNotes(){
  jfNotesPanel.hidden=false;
  jfDeskRenderNotes();
  requestAnimationFrame(jfNoteSplitInit);
}
async function jfDeskCloseNotes(){
  clearTimeout(jfDeskSaveTimer);
  if(!await jfDeskSaveEditor())return false;
  if(!document.body.classList.contains('jfNotesMode'))jfNotesPanel.hidden=true;return true;
}
// Keep the standalone notes list and PDF excerpt destination chooser in sync.
// Old empty "新笔记" placeholders stay on disk, but are not selectable notes.
function jfDeskVisibleNotes(){
  return (jfDeskWorkspace.notes||[])
    .filter(n=>!(n.title==='新笔记'&&!n.content?.trim()&&!n.excerpt&&!n.quotes?.length))
    .sort((a,b)=>b.updatedAt-a.updatedAt);
}
function jfDeskRenderNotes(){
  const list=document.getElementById('jfDeskNoteList');list.replaceChildren();
  const q=document.getElementById('jfDeskSearchNotes').value.trim().toLocaleLowerCase();
  const notes=jfDeskVisibleNotes()
    .filter(n=>!q||(n.title+' '+n.content+' '+(n.excerpt||'')+' '+(n.quotes||[]).map(q=>q.text).join(' ')).toLocaleLowerCase().includes(q));
  for(const n of notes){
    const el=document.createElement('button');el.type='button';el.className='jfDeskNoteItem'+(n.id===jfDeskActiveNote?' active':'');
    const title=document.createElement('strong');title.textContent=n.title||'无标题';
    const meta=document.createElement('small');const imageCount=(n.quotes||[]).filter(q=>q.type==='image').length;const pageCount=(n.quotes||[]).filter(q=>q.type==='image').reduce((sum,q)=>sum+(q.pages?.length||1),0);meta.textContent=n.content.slice(0,65)||(imageCount?('图片摘录 · '+imageCount+' 组'+(pageCount>imageCount?' / '+pageCount+' 页':'')):'尚无内容');
    el.append(title,meta);el.addEventListener('click',()=>jfDeskSelectNote(n.id));list.append(el);
  }
  document.getElementById('jfDeskNotesEmpty').hidden=notes.length>0||!!jfDeskActiveNote;
  document.getElementById('jfDeskEditor').hidden=!jfDeskActiveNote;
}
async function jfDeskSelectNote(id){
  clearTimeout(jfDeskSaveTimer);
  if(!await jfDeskSaveEditor())return;
  jfDeskDraft=null;jfDeskActiveNote=id;
  const note=jfDeskWorkspace.notes.find(n=>n.id===id);
  if(!note){jfDeskActiveNote=null;jfDeskRenderNotes();return;}
  document.getElementById('jfDeskNoteTitle').value=note.title;
  document.getElementById('jfDeskNoteBody').value=note.content;
  jfDeskRenderQuotes(note);
  jfNoteSelectMode(note.format||'md');jfNoteHistoryReset();
  document.getElementById('jfDeskJump').hidden=true;
  jfDeskDirty=false;jfDeskMessage('已保存');jfDeskRenderNotes();
}
// Legacy excerpts are displayed as quote blocks; ordinary notes are not tied to any book.
function jfDeskQuotesFor(note){
  if(Array.isArray(note.quotes) && note.quotes.length)return note.quotes;
  return note.excerpt&&note.bookId?[{text:note.excerpt,bookId:note.bookId,chapter:note.chapter||0,anchorStart:note.anchorStart??null}]:[];
}
// A note is one continuous writing stream. Each extract is a stable embedded
// object, followed by an editable prose block. Old notes migrate in memory.
function jfDeskNoteBlocks(note){
  const quotes=jfDeskQuotesFor(note),known=note.blocks;
  if(Array.isArray(known)&&known.length)return known.map(b=>({...b}));
  const result=[{kind:'text',text:String(note.content||'')}];
  quotes.forEach((_,index)=>{result.push({kind:'quote',index},{kind:'text',text:''});});
  return result;
}
function jfDeskNewTextChunk(raw=''){
  const node=document.createElement('div');node.className='jfNoteTextChunk';
  if(jfNoteMode==='rich')node.innerHTML=jfNoteMarkdownHtml(raw||'');
  else node.textContent=raw||'';
  if(!node.hasChildNodes())node.append(document.createElement('br'));
  return node;
}
function jfDeskChunkValue(node){
  if(jfNotePreviewOn && node.dataset.raw!==undefined)return node.dataset.raw;
  if(jfNoteMode==='rich')return jfNoteRichMarkdown(node);
  // A sole BR is the browser's caret placeholder, not user-created prose.
  if(node.childNodes.length===1&&node.firstChild?.tagName==='BR')return '';
  const clone=node.cloneNode(true);
  // A single contenteditable surface can create nested divs for Enter; preserve line breaks.
  for(const br of clone.querySelectorAll('br'))br.replaceWith('\n');
  for(const block of [...clone.querySelectorAll('div,p')].reverse())block.append('\n');
  // Trailing line breaks belong to prose. Stripping them made the blank line
  // immediately before a quote disappear after autosave/reopen.
  return clone.textContent||'';
}
function jfDeskEditorBlocks(){
  const root=document.getElementById('jfDeskExcerpt'),blocks=[],prose=[];
  const emit=()=>{blocks.push({kind:'text',text:prose.join('\n')});prose.length=0;};
  for(const node of root.childNodes){
    if(node.nodeType===Node.ELEMENT_NODE && node.dataset?.quoteIndex!==undefined){
      if(prose.length)emit();
      blocks.push({kind:'quote',index:Number(node.dataset.quoteIndex)});
    }else if(node.nodeType===Node.ELEMENT_NODE && node.classList.contains('jfNoteTextChunk')){
      prose.push(jfDeskChunkValue(node));
    }else if(node.nodeType===Node.TEXT_NODE && node.textContent?.trim())prose.push(node.textContent);
    else if(node.nodeType===Node.ELEMENT_NODE && node.tagName==='BR')prose.push('');
    else if(node.nodeType===Node.ELEMENT_NODE)prose.push(jfDeskChunkValue(node));
  }
  if(prose.length)emit();
  if(!blocks.length)blocks.push({kind:'text',text:''});
  document.getElementById('jfDeskNoteBody').value=blocks.filter(b=>b.kind==='text').map(b=>b.text).join('\n');
  return blocks;
}
function jfDeskSizeNoteFields(){} // Browser lays out the single editable document naturally.
function jfDeskClearDeleteFocus(keep=null){
  for(const card of document.querySelectorAll('#jfDeskExcerpt .jfDeskQuoteDeleteArmed')){
    if(card===keep)continue;card.classList.remove('jfDeskQuoteDeleteArmed');delete card.dataset.deleteArmed;
  }
}
function jfDeskCaretAtChunkStart(chunk){
  const sel=window.getSelection();if(!sel?.rangeCount||!sel.isCollapsed)return false;
  const r=sel.getRangeAt(0);if(!chunk.contains(r.startContainer)&&r.startContainer!==chunk)return false;
  const scan=r.cloneRange();scan.selectNodeContents(chunk);scan.setEnd(r.startContainer,r.startOffset);
  return !scan.toString().length;
}
function jfDeskCaretAtChunkEnd(chunk){
  const sel=window.getSelection();if(!sel?.rangeCount||!sel.isCollapsed)return false;
  const r=sel.getRangeAt(0);if(!chunk.contains(r.startContainer)&&r.startContainer!==chunk)return false;
  const scan=r.cloneRange();scan.selectNodeContents(chunk);scan.setStart(r.startContainer,r.startOffset);
  return !scan.toString().length;
}
function jfDeskRootCaretNeighbors(root){
  const sel=window.getSelection();if(!sel?.rangeCount||!sel.isCollapsed)return null;
  const r=sel.getRangeAt(0);if(r.startContainer!==root)return null;
  return {before:root.childNodes[r.startOffset-1]||null,after:root.childNodes[r.startOffset]||null};
}
function jfDeskMoveCaretToChunkEnd(root,chunk){
  if(!chunk)return;
  root.focus();
  const range=document.createRange();range.selectNodeContents(chunk);range.collapse(false);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
}
function jfDeskEraseTrailingBlankLine(root,chunk){
  if(jfNoteMode!=='md'||!chunk?.classList?.contains('jfNoteTextChunk'))return false;
  // Plain Markdown prose has direct text nodes. Chromium sometimes skips a
  // terminal newline and backspaces the previous ideograph instead.
  const last=chunk.lastChild;
  if(last?.nodeType!==Node.TEXT_NODE||!last.nodeValue.endsWith('\n'))return false;
  last.nodeValue=last.nodeValue.slice(0,-1);
  if(!last.nodeValue){last.remove();if(!chunk.hasChildNodes())chunk.append(document.createElement('br'));}
  jfDeskMoveCaretToChunkEnd(root,chunk);
  jfDeskScheduleEditor();jfNoteHistoryPush();
  return true;
}
function jfDeskArmQuoteDelete(card){
  jfDeskClearDeleteFocus(card);card.dataset.deleteArmed='1';card.classList.add('jfDeskQuoteDeleteArmed');
  card.focus({preventScroll:true});
}
function jfDeskDeleteQuoteBlock(card){
  if(!card?.parentElement)return;
  const root=card.parentElement,prev=card.previousElementSibling,next=card.nextElementSibling;
  card.remove();jfDeskClearDeleteFocus();
  if(prev?.classList.contains('jfNoteTextChunk')&&next?.classList.contains('jfNoteTextChunk')&&!jfDeskChunkValue(next))next.remove();
  let target=next?.isConnected?next:(prev?.isConnected?prev:null);
  if(!target||target.dataset?.quoteIndex!==undefined){target=jfDeskNewTextChunk('');root.append(target);}
  root.focus();
  const range=document.createRange();range.selectNodeContents(target);range.collapse(false);
  const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
  jfDeskScheduleEditor();jfNoteHistoryPush();
}
function jfNoteUpdateImageCard(card){
  const q=jfNoteLiveQuotes[Number(card.dataset.quoteIndex)]||{};
  const width=Number.isInteger(q.imageWidth)?Math.max(20,Math.min(100,q.imageWidth)):100;
  const align=['left','center','right'].includes(q.imageAlign)?q.imageAlign:'left';
  // The image is sized against the *note editor*, never against its own card.
  // The card has a minimum width to fit its controls; that minimum must not
  // silently become a 60% lower limit on the image itself.
  const parent=card.parentElement;
  const available=parent?.clientWidth||card.clientWidth||620;
  const style=getComputedStyle(card);
  const inset=(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0);
  const imagePx=Math.max(1,Math.round(Math.max(1,available-inset)*width/100));
  card.style.setProperty('--jf-quote-width',width+'%');
  card.style.setProperty('--jf-image-render-width',imagePx+'px');
  card.style.setProperty('--jf-quote-card-width','min(100%, max('+width+'%, 360px))');
  card.dataset.imageAlign=align;
  const slider=card.querySelector('.jfNoteImageRange');if(slider)slider.value=String(width);
  const number=card.querySelector('.jfNoteImagePercent');if(number)number.textContent=width+'%';
  for(const btn of card.querySelectorAll('[data-image-align]'))btn.setAttribute('aria-pressed',String(btn.dataset.imageAlign===align));
}
function jfNoteSetImage(card,change,commit=true){
  const q=jfNoteLiveQuotes[Number(card.dataset.quoteIndex)];if(!q||q.type!=='image')return;
  Object.assign(q,change);jfNoteUpdateImageCard(card);
  jfDeskScheduleEditor();if(commit)jfNoteHistoryPush();
}
function jfNoteImageControls(card){
  const controls=document.createElement('div');controls.className='jfDeskImageControls';controls.contentEditable='false';
  const range=document.createElement('input');range.type='range';range.min='20';range.max='100';range.step='5';range.className='jfNoteImageRange';range.setAttribute('aria-label','调整本张图片宽度');
  const pct=document.createElement('span');pct.className='jfNoteImagePercent';
  controls.append(range,pct);
  // The image toolbar overlays the image; its box is intentionally fixed in
  // pixel dimensions and never participates in the card's flow layout.
  // During pointer dragging, pin the box within the image frame using
  // measured viewport coordinates. Never switch to fixed positioning: a
  // filtered ancestor changes what fixed means in Chromium.
  let dragLock=null;
  const frame=card.querySelector('.jfDeskQuoteImageFrame')||card;
  // Anchor the toolbar in the image's absolute-positioned coordinate system.
  // The notes panel uses backdrop-filter, which is a containing block for
  // position:fixed descendants. Converting to fixed using viewport coords
  // caused an immediate jump by the panel's top offset on pointerdown.
  const pinToolbar=()=>{
    if(!dragLock)return;
    const frameBox=frame.getBoundingClientRect();
    controls.style.left=(dragLock.screenLeft-frameBox.left)+'px';
    controls.style.top=(dragLock.screenTop-frameBox.top)+'px';
  };
  const paintAt=x=>{
    const {left,width}=dragLock.rangeBox;
    const ratio=Math.max(0,Math.min(1,(x-left-9)/Math.max(1,width-18)));
    const value=Math.max(20,Math.min(100,Math.round((20+ratio*80)/5)*5));
    if(Number(range.value)!==value){
      range.value=String(value);
      range.dispatchEvent(new Event('input',{bubbles:true}));
      dragLock.changed=true;
    }
    // Image alignment and scaling may move its frame. Recalculate local
    // offsets after updating the image so the toolbar stays put on screen.
    pinToolbar();
  };
  const onMove=event=>{if(dragLock)paintAt(event.clientX);};
  const finish=()=>{
    if(!dragLock)return;
    const changed=dragLock.changed;
    dragLock=null;
    controls.classList.remove('jfImageControlsDragging');
    for(const key of ['position','left','top','width','height','zIndex','margin','boxSizing'])controls.style[key]='';
    window.removeEventListener('pointermove',onMove);
    window.removeEventListener('pointerup',onRelease);
    window.removeEventListener('pointercancel',onRelease);
    window.removeEventListener('blur',onRelease);
    if(changed)range.dispatchEvent(new Event('change',{bubbles:true}));
  };
  const onRelease=()=>finish();
  range.addEventListener('pointerdown',event=>{
    if(event.button!==0||dragLock)return;
    // Do not activate Chromium's native range capture: repositioning a native
    // range mid-drag can send pointercancel and produce the exact flicker this
    // overlay is meant to prevent. Pointer X alone drives the value instead.
    event.preventDefault();event.stopPropagation();
    const rect=controls.getBoundingClientRect();
    const rangeRect=range.getBoundingClientRect();
    dragLock={
      rangeBox:{left:rangeRect.left,width:rangeRect.width},
      screenLeft:rect.left,screenTop:rect.top,changed:false
    };
    controls.classList.add('jfImageControlsDragging');
    Object.assign(controls.style,{
      position:'absolute',
      width:rect.width+'px',height:rect.height+'px',
      zIndex:'9999',margin:'0',boxSizing:'border-box'
    });
    pinToolbar();
    window.addEventListener('pointermove',onMove);
    window.addEventListener('pointerup',onRelease);
    window.addEventListener('pointercancel',onRelease);
    window.addEventListener('blur',onRelease);
    paintAt(event.clientX);
  });
  range.addEventListener('input',()=>jfNoteSetImage(card,{imageWidth:Number(range.value)},false));
  range.addEventListener('change',()=>jfNoteHistoryPush());
  for(const [align,label] of [['left','左'],['center','中'],['right','右']]){
    const btn=document.createElement('button');btn.type='button';btn.dataset.imageAlign=align;btn.textContent=label;btn.title=label+'对齐';
    btn.setAttribute('aria-label','图片'+label+'对齐');btn.addEventListener('click',()=>jfNoteSetImage(card,{imageAlign:align}));controls.append(btn);
  }
  (card.querySelector('.jfDeskQuoteImageFrame')||card).append(controls);
  jfNoteUpdateImageCard(card);
}
function jfNoteSetAllImagesWidth(width,commit=true){
  let changed=false;
  for(const card of document.querySelectorAll('#jfDeskExcerpt .jfDeskImageQuote')){
    const q=jfNoteLiveQuotes[Number(card.dataset.quoteIndex)];if(!q||q.type!=='image')continue;
    q.imageWidth=width;jfNoteUpdateImageCard(card);changed=true;
  }
  const bulk=document.getElementById('jfNoteAllImageWidth'),pct=document.getElementById('jfNoteAllImagePercent');
  if(bulk)bulk.value=String(width);
  if(pct)pct.textContent=String(width)+'%';
  if(changed){jfDeskScheduleEditor();if(commit)jfNoteHistoryPush();}
}
// v7.02 · Give all pages in one quote the same native-pixel scale.
// Older saved excerpts contain JPEGs but no PDF geometry; intrinsic widths
// are sufficient to avoid inflating a short screenshot to the full card width.
function jfNoteNormalizeGroupPages(frame){
  const sections=[...frame.querySelectorAll('.jfDeskQuotePage')];
  if(sections.length<2)return;
  const images=sections.map(section=>section.querySelector('img.jfDeskQuoteImage'));
  if(!images.every(image=>image?.complete&&image.naturalWidth>0))return;
  const reference=Math.max(...images.map(image=>image.naturalWidth));
  if(!(reference>0))return;
  for(let i=0;i<sections.length;i++){
    const ratio=Math.max(0.01,Math.min(1,images[i].naturalWidth/reference));
    sections[i].style.setProperty('--jf-group-page-width',(ratio*100).toFixed(4)+'%');
  }
}
function jfDeskRenderQuotes(note){
  const holder=document.getElementById('jfDeskExcerpt');holder.replaceChildren();
  const quotes=jfDeskQuotesFor(note),blocks=jfDeskNoteBlocks(note);
  jfNoteLiveQuotes=quotes.map(q=>({...q}));
  jfNoteMode=note.format==='rich'?'rich':'md';jfNotePreviewOn=false;
  holder.hidden=false;holder.contentEditable='true';
  const ordered=blocks[0]?.kind==='text'?blocks:[{kind:'text',text:''},...blocks];
  for(const block of ordered){
    if(block.kind==='text'){holder.append(jfDeskNewTextChunk(block.text||''));continue;}
    const index=block.index,q=quotes[index];if(!q)continue;
    const card=document.createElement('div');card.className='jfDeskQuote jfDeskFlowQuote';
    card.dataset.quoteIndex=String(index);card.contentEditable='false';card.tabIndex=0;
    card.setAttribute('role','group');card.setAttribute('aria-label','摘录块，按两次退格键删除');
    if(q.type==='image'&&/^data:image\/jpeg;base64,/.test(q.image||'')){
      card.classList.add('jfDeskImageQuote');
      const frame=document.createElement('div');frame.className='jfDeskQuoteImageFrame';
      const pages=Array.isArray(q.pages)&&q.pages.length>1?q.pages:[{chapter:q.chapter,image:q.image}];
      if(pages.length>1)frame.classList.add('jfDeskQuoteImageGroup');
      for(const part of pages){
        const section=document.createElement('div');section.className='jfDeskQuotePage';
        if(pages.length>1){const label=document.createElement('span');label.className='jfDeskQuotePageLabel';label.textContent='第 '+(part.chapter+1)+' 页';section.append(label);}
        const img=document.createElement('img');img.className='jfDeskQuoteImage';img.alt='第 '+(part.chapter+1)+' 页截图';img.loading=pages.length>1?'eager':'lazy';
        if(pages.length>1)img.addEventListener('load',()=>jfNoteNormalizeGroupPages(frame));
        img.addEventListener('click',()=>jfDeskJumpToQuote({...q,chapter:part.chapter}));section.append(img);frame.append(section);img.src=part.image;
      }
      card.append(frame);
      // data: images can decode synchronously when cached.
      if(pages.length>1)requestAnimationFrame(()=>{if(frame.isConnected)jfNoteNormalizeGroupPages(frame);});
      jfNoteImageControls(card);
      if(q.text){const caption=document.createElement('span');caption.className='jfDeskQuoteCaption';caption.textContent=q.text;card.append(caption);}
    }else{const content=document.createElement('span');content.className='jfDeskQuoteBody';content.textContent=q.text;card.append(content);}
    const source=document.createElement('div');source.className='jfDeskQuoteSource';
    const book=jfBooks.find(b=>b.id===q.bookId);
    const sourceText=document.createElement('span');sourceText.className='jfDeskQuoteMeta';sourceText.textContent=(book?.name||'已归档书籍')+' · '+(book?.kind==='txt'||book?.kind==='epub'?'章节 ':'第 ')+(q.chapter+1)+(book?.kind==='txt'||book?.kind==='epub'?'':' 页');
    const jump=document.createElement('button');jump.type='button';jump.className='jfDeskQuoteJump';jump.textContent='打开原书';jump.title='回到摘录位置';
    jump.addEventListener('click',()=>jfDeskJumpToQuote(q));source.append(sourceText,jump);card.append(source);holder.append(card);
  }
  if(!holder.lastElementChild)holder.append(jfDeskNewTextChunk(''));
  document.getElementById('jfDeskNoteBody').value=ordered.filter(b=>b.kind==='text').map(b=>b.text).join('\n');
  jfNoteRefreshViews();
}
// Image references are self-contained note blocks; no top-level note/book binding.
function jfDeskQuoteDismiss(){
  document.getElementById('jfPdfQuoteChooser').hidden=true;
  if(jfPdfJsState.capture)jfPdfJsCaptureClear();
  jfDeskQuotePending=null;
}
function jfDeskQuoteSelect(value){
  jfDeskQuoteTarget=value;
  const input=document.getElementById('jfPdfQuoteNewTitle');input.hidden=value!=='new';
  for(const b of document.querySelectorAll('#jfPdfQuoteOptions button'))b.setAttribute('aria-pressed',String(b.dataset.noteId===value));
  if(value==='new')input.focus();
}
function jfDeskChooseQuote(quote){
  if(jfDeskSaveFailed){jfDeskMessage('阅读数据校验失败，拒绝保存摘录',true);return;}
  jfDeskQuotePending=quote;
  const list=document.getElementById('jfPdfQuoteOptions');list.replaceChildren();
  const notes=jfDeskVisibleNotes();
  const options=[{id:'new',title:'＋ 新建笔记'},...notes.map(n=>({id:n.id,title:n.title||'无标题'}))];
  for(const n of options){const b=document.createElement('button');b.type='button';b.dataset.noteId=n.id;b.textContent=n.title;b.addEventListener('click',()=>jfDeskQuoteSelect(n.id));list.append(b);}
  document.getElementById('jfPdfQuoteChooser').hidden=false;
  document.getElementById('jfPdfQuoteNewTitle').value='';
  const defaultId=notes.some(n=>n.id===jfDeskQuoteLast)?jfDeskQuoteLast:(notes[0]?.id||'new');
  jfDeskQuoteSelect(defaultId);
}
async function jfDeskQuoteCommit(){
  const quote=jfDeskQuotePending;if(!quote)return;
  const btn=document.getElementById('jfPdfQuoteCommit');btn.disabled=true;
  try{
    if(!await jfDeskSaveEditor())throw Error('当前笔记尚未成功保存');
    const note=jfDeskQuoteTarget==='new'?{
      id:jfDeskFreshId(),title:document.getElementById('jfPdfQuoteNewTitle').value.trim()||'阅读摘录',
      content:'',excerpt:'',bookId:'',chapter:0,anchorStart:null,quotes:[]
    }:jfDeskWorkspace.notes.find(n=>n.id===jfDeskQuoteTarget);
    if(!note)throw Error('目标笔记已不存在，请重新选择');
    const quotes=[...jfDeskQuotesFor(note),quote];
    const blocks=[...jfDeskNoteBlocks(note),{kind:'quote',index:quotes.length-1},{kind:'text',text:''}];
    if(quotes.length>40)throw Error('目标笔记摘录已达上限');
    let mark=null;
    if(quote.type==='image'&&Array.isArray(quote.area)&&!quote.pages?.length)mark={bookId:quote.bookId,chapter:quote.chapter,type:'area',area:quote.area,...(quote.segments?{segments:quote.segments}:{})};
    else if(quote.text&&Number.isSafeInteger(quote.anchorStart))mark={type:'text',text:quote.text.slice(0,5000),bookId:quote.bookId,chapter:quote.chapter,anchorStart:quote.anchorStart,length:Math.min(quote.text.length,5000)};
    // Persist the new note, destination, and source highlight in one encrypted transaction.
    await jfDeskMutate({action:'note',note:{...note,quotes,blocks},...(mark?{alsoMark:mark}:{})});
    jfDeskQuoteLast=note.id;jfDeskQuoteDismiss();
    jfDeskActiveNote=note.id;jfDeskDraft=null;jfDeskDirty=false;
    document.getElementById('jfDeskNoteTitle').value=note.title;
    document.getElementById('jfDeskNoteBody').value=note.content;
    jfDeskRenderQuotes({...note,quotes,blocks});
    jfNoteSelectMode(note.format||'md');jfNoteHistoryReset();
    jfDeskRenderNotes();if(jfPdfJsState?.doc)jfPdfJsRenderMarks();
    jfDeskMessage('摘录已保存到「'+(note.title||'无标题')+'」');
    if(quote.type==='image')jfPdfJsCaptureClear();
    getSelection()?.removeAllRanges();
  }catch(e){jfDeskMessage('摘录未保存：'+e.message,true);}
  finally{btn.disabled=false;}
}
document.getElementById('jfPdfQuoteCancel').addEventListener('click',jfDeskQuoteDismiss);
document.getElementById('jfPdfQuoteCommit').addEventListener('click',jfDeskQuoteCommit);
async function jfDeskAttachPdfImage(image,caption,bookId,chapter){
  if(jfDeskSaveFailed)throw Error('笔记尚未安全载入');
  if(!/^[a-f0-9]{16}$/.test(bookId))throw Error('截图来源已失效');
  if(!await jfDeskSaveEditor())throw Error('当前笔记未保存，已保留原内容');
  let note=jfDeskWorkspace.notes.find(n=>n.id===jfDeskActiveNote)||jfDeskDraft;
  if(!note)note={id:jfDeskFreshId(),title:'',content:'',excerpt:'',bookId:'',chapter:0,anchorStart:null,quotes:[]};
  const ref={type:'image',image,text:caption.slice(0,120),bookId,chapter,anchorStart:null};
  const quotes=[...jfDeskQuotesFor(note),ref];
  const blocks=[...jfDeskNoteBlocks(note),{kind:'quote',index:quotes.length-1},{kind:'text',text:''}];
  if(quotes.length>40)throw Error('此笔记摘录已达上限，请新建笔记');
  const item={...note,quotes,blocks,bookId:'',excerpt:'',anchorStart:null};
  try{
    await jfDeskMutate({action:'note',note:item});
  }catch(e){
    // Retain the image in the in-memory draft on save failures instead of
    // disappearing behind a closed capture dialog.
    jfDeskDraft=item;jfDeskActiveNote=item.id;jfDeskDirty=true;
    jfDeskMessage('截图未保存：'+e.message,true);jfDeskOpenNotes();jfDeskRenderQuotes(item);throw e;
  }
  jfDeskDraft=null;jfDeskActiveNote=item.id;jfDeskDirty=false;
  document.getElementById('jfDeskNoteTitle').value=item.title;
  document.getElementById('jfDeskNoteBody').value=item.content;
  jfDeskOpenNotes();jfDeskRenderQuotes(item);jfNoteSelectMode(item.format||'md');jfNoteHistoryReset();jfDeskRenderNotes();jfDeskMessage('截图已加入笔记');
}
function jfDeskFreshId(){const b=new Uint8Array(12);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');}
async function jfDeskCreateNote(quote='',bookId='',chapter=0,anchorStart=null){
  if(jfDeskSaveFailed){jfDeskMessage('阅读数据校验失败，已拒绝写入',true);return;}
  clearTimeout(jfDeskSaveTimer);
  if(!await jfDeskSaveEditor())return;
  jfDeskDraft={id:jfDeskFreshId(),title:'',content:'',excerpt:'',bookId:'',chapter:0,anchorStart:null,quotes:[]};
  jfDeskActiveNote=jfDeskDraft.id;
  if(quote?.trim() && bookId){jfDeskDraft.quotes=[{text:quote.trim().slice(0,6000),bookId,chapter,anchorStart}];}
  document.getElementById('jfDeskNoteTitle').value='';document.getElementById('jfDeskNoteBody').value='';
  jfDeskRenderQuotes(jfDeskDraft);
  jfNoteSelectMode('md');jfNoteHistoryReset();
  document.getElementById('jfDeskJump').hidden=true;
  jfDeskDirty=!!jfDeskDraft.quotes.length;
  jfDeskOpenNotes();jfDeskRenderNotes();document.getElementById('jfDeskExcerpt').focus();
  // Draft remains only in memory until a meaningful title, body, or explicit excerpt exists.
  if(jfDeskDirty)jfDeskScheduleEditor();
}
async function jfDeskSaveEditor(){
  clearTimeout(jfDeskSaveTimer);
  // A second close/navigation must wait for the active request, even if dirty was
  // temporarily cleared while the request was in flight.
  if(jfDeskSaveInFlight){
    if(!await jfDeskSaveInFlight)return false;
    return jfDeskDirty?jfDeskSaveEditor():true;
  }
  if(!jfDeskActiveNote||!jfDeskDirty)return true;
  const original=jfDeskWorkspace.notes.find(x=>x.id===jfDeskActiveNote)||jfDeskDraft;
  if(!original)return false;
  const rawBlocks=jfDeskEditorBlocks(),rawQuotes=jfNoteLiveQuotes,quotes=[],blocks=[];
  for(const block of rawBlocks){
    if(block.kind==='text'){blocks.push(block);continue;}
    const quote=rawQuotes[block.index];if(quote){blocks.push({kind:'quote',index:quotes.length});quotes.push(quote);}
  }
  // Keep live quote identifiers synchronized with compacted saved order.
  const cards=[...document.querySelectorAll('#jfDeskExcerpt .jfDeskFlowQuote')];
  cards.forEach((card,i)=>{card.dataset.quoteIndex=String(i);});
  jfNoteLiveQuotes=quotes;
  const content=blocks.filter(b=>b.kind==='text'&&b.text).map(b=>b.text).join('\n');
  const note={...original,title:document.getElementById('jfDeskNoteTitle').value,content,format:jfNoteMode,quotes,blocks,...(!quotes.length?{excerpt:'',bookId:'',anchorStart:null}:{})};
  if(jfDeskDraft && !note.title.trim() && !note.content.trim() && !jfDeskQuotesFor(note).length){jfDeskDraft=null;jfDeskActiveNote=null;jfDeskDirty=false;jfDeskRenderNotes();return true;}
  if(note.content.length>100000){jfDeskMessage('正文不能超过 10 万字',true);return false;}
  const savingVersion=jfDeskEditorVersion;
  jfDeskDirty=false;jfDeskMessage('正在保存…');
  const task=(async()=>{
    try{
      await jfDeskMutate({action:'note',note});
      if(jfDeskDraft?.id===note.id)jfDeskDraft=null;
      if(savingVersion===jfDeskEditorVersion)jfDeskMessage('已保存');
      jfDeskRenderNotes();return true;
    }catch(e){jfDeskDirty=true;jfDeskMessage('未保存：'+e.message,true);return false;}
  })();
  jfDeskSaveInFlight=task;
  try{return await task;}
  finally{if(jfDeskSaveInFlight===task)jfDeskSaveInFlight=null;}
}
function jfDeskScheduleEditor(){jfDeskEditorVersion++;jfDeskDirty=true;jfDeskMessage('待保存…');clearTimeout(jfDeskSaveTimer);jfDeskSaveTimer=setTimeout(jfDeskSaveEditor,800);}
async function jfDeskExcerpt(){
  if(!jfDeskBook){jfDeskMessage('请先打开一本书',true);return;}
  if(jfDeskOutline?.nativePdf)return jfPdfJsQuoteSelection();
  const sel=getSelection(),text=sel?.toString().trim()||'';
  if(!text||!jfReadText.contains(sel.anchorNode)||!jfReadText.contains(sel.focusNode)){
    jfDeskMessage('请先选中正文，再点击摘录',true);return;
  }
  const range=sel.getRangeAt(0),offset=document.createRange();
  offset.selectNodeContents(jfReadText);offset.setEnd(range.startContainer,range.startOffset);
  const leading=sel.toString().length-sel.toString().trimStart().length;
  jfDeskChooseQuote({text:text.slice(0,6000),bookId:jfDeskBook.id,chapter:jfDeskChapter,anchorStart:offset.toString().length+leading});
}
async function jfDeskJumpToQuote(quote){
  if(!quote?.bookId)return;
  if(!await jfDeskCloseNotes())return;
  await jfDeskOpenReader(quote.bookId,quote.chapter);
  if(jfDeskBook?.id!==quote.bookId||!quote.text)return;
  if(jfDeskOutline?.nativePdf){jfPdfJsJumpToQuote(quote);return;}
  const full=jfReadText.textContent;
  let i=Number.isSafeInteger(quote.anchorStart)&&quote.anchorStart>=0&&full.slice(quote.anchorStart,quote.anchorStart+quote.text.length)===quote.text?quote.anchorStart:-1;
  // Legacy quotes used source-text offsets. Map those through the visual TXT
  // reflow rather than losing the link when a soft source newline disappears.
  if(i<0&&jfReadRawToDisplay&&Number.isSafeInteger(quote.anchorStart)&&quote.anchorStart>=0&&
     jfReadRawText.slice(quote.anchorStart,quote.anchorStart+quote.text.length)===quote.text){
    i=jfReadRawToDisplay[quote.anchorStart];
  }
  if(i<0)i=full.indexOf(quote.text);
  if(i<0&&jfDeskOutline?.format==='TXT')i=full.indexOf(jfTxtSmartReflow(quote.text).text);
  if(i<0)i=full.indexOf(quote.text.slice(0,30));
  if(i<0)return;
  // Remove the previous transient marker before mapping absolute text offsets.
  jfReadText.textContent=full;
  const node=jfReadText.firstChild;if(!node||node.nodeType!==Node.TEXT_NODE)return;
  const range=document.createRange();range.setStart(node,i);range.setEnd(node,Math.min(i+Math.min(quote.text.length,80),node.textContent.length));
  const marker=document.createElement('mark');marker.className='jfReadCitation';marker.style.cssText='background:#8ad9bd72;color:inherit;border-radius:3px';
  try{range.surroundContents(marker);marker.scrollIntoView({block:'center',behavior:'smooth'});}catch{}
}
document.getElementById('jfDeskNotesOpen').addEventListener('click',jfDeskOpenNotes);
document.getElementById('jfDeskNotesClose').addEventListener('click',jfDeskCloseNotes);
document.getElementById('jfDeskNewNote').addEventListener('click',()=>jfDeskCreateNote());
document.getElementById('jfDeskSearchNotes').addEventListener('input',jfDeskRenderNotes);
document.getElementById('jfDeskNoteTitle').addEventListener('input',()=>{if(jfNoteIsComposing)return;jfDeskScheduleEditor();jfNoteHistoryPush();});
document.getElementById('jfDeskNoteTitle').addEventListener('keydown',jfNoteHistoryKeydown);
const jfUnifiedNote=document.getElementById('jfDeskExcerpt');
jfUnifiedNote.addEventListener('input',()=>{if(jfNoteIsComposing)return;jfDeskClearDeleteFocus();jfDeskScheduleEditor();jfNoteHistoryPush();});
for(const input of [jfUnifiedNote,document.getElementById('jfDeskNoteTitle')]){
  input.addEventListener('compositionstart',()=>{jfNoteIsComposing=true;});
  input.addEventListener('compositionend',()=>{
    jfNoteIsComposing=false;
    // Wait until the browser has committed the final characters to the DOM.
    requestAnimationFrame(()=>{if(!jfNoteIsComposing){jfDeskScheduleEditor();jfNoteHistoryPush();}});
  });
}
document.getElementById('jfNoteImagesNight').addEventListener('click',()=>jfNoteSetImageNight(!jfNoteImagesNight));
jfNoteSetImageNight(jfNoteImagesNight);
jfUnifiedNote.addEventListener('paste',e=>{
  if(!jfUnifiedNote.isContentEditable)return;
  e.preventDefault();document.execCommand('insertText',false,e.clipboardData?.getData('text/plain')||'');
});
jfUnifiedNote.addEventListener('focusout',e=>{
  if(!jfUnifiedNote.contains(e.relatedTarget)&&jfDeskDirty)jfDeskSaveEditor();
});
jfUnifiedNote.addEventListener('click',e=>{
  const card=e.target.closest('.jfDeskFlowQuote');
  if(!card)jfDeskClearDeleteFocus();
  else if(!e.target.closest('button,img'))card.focus();
});
jfUnifiedNote.addEventListener('keydown',e=>{
  if(jfNoteHistoryKeydown(e))return;
  if(e.target!==jfUnifiedNote && e.target.closest('button,input,select'))return;
  if(e.key==='Escape'){jfDeskClearDeleteFocus();return;}
  if(e.key!=='Backspace'&&e.key!=='Delete'||e.ctrlKey||e.metaKey||e.altKey)return;
  const selection=window.getSelection();
  if(selection&&!selection.isCollapsed)return; // Browser selection is checked by beforeinput below.
  const anchor=selection?.anchorNode;
  const chunk=(anchor?.nodeType===Node.ELEMENT_NODE?anchor:anchor?.parentElement)?.closest?.('.jfNoteTextChunk');
  const neighbors=jfDeskRootCaretNeighbors(jfUnifiedNote);
  let card=e.target.closest('.jfDeskFlowQuote');
  if(!card&&e.key==='Backspace'){
    // The caret can sit *before* a noneditable quote as a root child offset.
    // Native Chromium Backspace at that position deletes the quote outright.
    // Route it into the preceding prose (including its blank lines) instead.
    if(neighbors?.after?.classList?.contains('jfDeskFlowQuote')){
      e.preventDefault();e.stopPropagation();
      const prev=neighbors.before;
      if(prev?.classList?.contains('jfNoteTextChunk')){
        if(!jfDeskChunkValue(prev)){
          // A separate empty prose block before a quote is removable as text;
          // never let native Backspace cross the noneditable quote boundary.
          const before=prev.previousElementSibling;
          prev.remove();
          jfDeskMoveCaretToChunkEnd(jfUnifiedNote,before?.classList?.contains('jfNoteTextChunk')?before:jfUnifiedNote);
          jfDeskScheduleEditor();
        }else{
          jfDeskMoveCaretToChunkEnd(jfUnifiedNote,prev);
          if(!jfDeskEraseTrailingBlankLine(jfUnifiedNote,prev))document.execCommand('delete');
        }
      }
      return;
    }
    if(neighbors?.before?.classList?.contains('jfDeskFlowQuote'))card=neighbors.before;
    if(!card&&chunk&&jfDeskCaretAtChunkEnd(chunk)&&jfDeskEraseTrailingBlankLine(jfUnifiedNote,chunk)){
      e.preventDefault();e.stopPropagation();return;
    }
    if(!card&&chunk&&jfDeskCaretAtChunkStart(chunk)){
      const prev=chunk.previousElementSibling;
      if(prev?.classList.contains('jfDeskFlowQuote'))card=prev;
      else if(!jfDeskChunkValue(chunk)&&prev?.classList.contains('jfNoteTextChunk')){
        e.preventDefault();chunk.remove();jfDeskScheduleEditor();jfDeskMoveCaretToChunkEnd(jfUnifiedNote,prev);return;
      }
    }
  }
  if(!card&&e.key==='Delete'){
    if(neighbors?.after?.classList?.contains('jfDeskFlowQuote'))card=neighbors.after;
    else if(chunk&&jfDeskCaretAtChunkEnd(chunk)&&chunk.nextElementSibling?.classList?.contains('jfDeskFlowQuote'))card=chunk.nextElementSibling;
  }
  if(!card)return;
  e.preventDefault();e.stopPropagation();
  if(card.dataset.deleteArmed==='1')jfDeskDeleteQuoteBlock(card);else jfDeskArmQuoteDelete(card);
});
// Guard the browser's native deletion path as well: contenteditable=false
// alone does not stop a selected card from being removed by input events.
jfUnifiedNote.addEventListener('beforeinput',e=>{
  if(!e.inputType?.startsWith('delete'))return;
  const sel=window.getSelection();if(!sel?.rangeCount)return;
  const range=sel.getRangeAt(0);
  if(sel.isCollapsed){
    const around=jfDeskRootCaretNeighbors(jfUnifiedNote);
    const card=e.inputType.includes('Backward')?around?.before:around?.after;
    if(card?.classList?.contains('jfDeskFlowQuote')){
      e.preventDefault();jfDeskArmQuoteDelete(card);
    }
    return;
  }
  const cards=[...jfUnifiedNote.querySelectorAll('.jfDeskFlowQuote')];
  const card=cards.find(el=>{try{return range.intersectsNode(el);}catch{return false;}});
  if(card){e.preventDefault();jfDeskArmQuoteDelete(card);}
});
document.getElementById('jfDeskJump').addEventListener('click',()=>{}); // Reference navigation lives on each excerpt.
document.getElementById('jfDeskDeleteNote').addEventListener('click',async()=>{
  if(!jfDeskActiveNote||!window.confirm('删除这条笔记？源书籍不会受到影响。'))return;
  // A failed delete must never discard edits that have not been saved first.
  if(!await jfDeskSaveEditor())return;
  const id=jfDeskActiveNote;
  try{await jfDeskMutate({action:'delete-note',id});jfDeskActiveNote=null;jfDeskRenderNotes();jfDeskMessage('已删除');}
  catch(e){jfDeskMessage(e.message,true);}
});
document.getElementById('jfReadBack').addEventListener('click',jfDeskCloseReader);
document.getElementById('jfReadPrev').addEventListener('click',()=>jfDeskShowChapter(jfDeskChapter-1));
document.getElementById('jfReadNext').addEventListener('click',()=>jfDeskShowChapter(jfDeskChapter+1));
document.getElementById('jfReadChapters').addEventListener('change',e=>jfDeskShowChapter(Number(e.target.value)));
document.getElementById('jfReadSmaller').addEventListener('click',()=>jfDeskSetPref({font:Math.max(13,jfDeskFont-2)}));
document.getElementById('jfReadLarger').addEventListener('click',()=>jfDeskSetPref({font:Math.min(28,jfDeskFont+2)}));
document.getElementById('jfReadTypographyToggle').addEventListener('click',()=>{
  const panel=document.getElementById('jfReadTypographyPanel');panel.hidden=!panel.hidden;
  document.getElementById('jfReadTypographyToggle').setAttribute('aria-expanded',String(!panel.hidden));
});
document.addEventListener('pointerdown',event=>{
  const panel=document.getElementById('jfReadTypographyPanel');
  if(!panel.hidden&&!panel.contains(event.target)&&!document.getElementById('jfReadTypographyToggle').contains(event.target)){
    panel.hidden=true;document.getElementById('jfReadTypographyToggle').setAttribute('aria-expanded','false');
  }
});
document.getElementById('jfReadFamily').addEventListener('change',e=>jfDeskSetPref({family:e.target.value}));
document.getElementById('jfReadSide').addEventListener('input',e=>{jfReadText.style.setProperty('--jf-read-side',e.target.value+'px');document.getElementById('jfReadSideValue').textContent=e.target.value+'px';});
document.getElementById('jfReadSide').addEventListener('change',e=>jfDeskSetPref({side:Number(e.target.value)}));
document.getElementById('jfReadTheme').addEventListener('click',()=>jfDeskSetPref({theme:jfDeskPrefs.theme==='paper'?'dark':'paper'}));
document.getElementById('jfReadNotes').addEventListener('click',jfDeskOpenNotes);
document.getElementById('jfReadMask').addEventListener('click',jfReadToggleMask);
document.getElementById('jfReadExcerpt').addEventListener('click',jfDeskExcerpt);
jfReadCenter.addEventListener('scroll',()=>{if(jfReader.hidden)return;if(jfDeskOutline?.nativePdf)jfPdfJsOnScroll();else jfDeskUpdateProgress();},{passive:true});
document.addEventListener('keydown',event=>{
  if(!jfReader.hidden && jfNotesPanel.hidden && !event.altKey && !event.ctrlKey && !event.metaKey &&
    !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName) &&
    !document.activeElement?.isContentEditable){
    const key=event.key;
    if(jfDeskOutline?.nativePdf && jfDeskPdfInfo && (key==='ArrowRight'||key==='ArrowLeft')){
      jfDeskShowPdfPage(jfDeskChapter+(key==='ArrowRight'||key==='PageDown'?1:-1));
      event.preventDefault();event.stopImmediatePropagation();return;
    }
    if(['PageDown','PageUp',' ','ArrowDown','ArrowUp'].includes(key)){
      const delta=(key==='PageUp'||key==='ArrowUp'?-1:1)*(key==='ArrowDown'||key==='ArrowUp'?120:Math.round(jfReadCenter.clientHeight*.84));
      jfReadCenter.scrollBy({top:delta,behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
      event.preventDefault();event.stopImmediatePropagation();return;
    }
    if(key==='Home'||key==='End'){
      jfReadCenter.scrollTo({top:key==='Home'?0:jfReadCenter.scrollHeight,behavior:'instant'});
      event.preventDefault();event.stopImmediatePropagation();return;
    }
  }
  if(event.key==='Escape'){
    if(jfPdfMarkMenu&&!jfPdfMarkMenu.hidden){jfPdfMarkMenuClose();event.stopImmediatePropagation();event.preventDefault();return;}
    if(!document.getElementById('jfPdfMarksList').hidden){jfPdfJsMarksListClose();event.stopImmediatePropagation();event.preventDefault();return;}
    if(!document.getElementById('jfPdfQuoteChooser').hidden){jfDeskQuoteDismiss();event.stopImmediatePropagation();event.preventDefault();return;}
    if(!document.getElementById('jfPdfCapturePanel').hidden||jfPdfJsState.capture){jfPdfJsCaptureClear();event.stopImmediatePropagation();event.preventDefault();return;}
    if(!jfNotesPanel.hidden){if(document.body.classList.contains('jfNotesMode')){document.querySelector('[data-media-kind=books]').click();}else jfDeskCloseNotes();event.stopImmediatePropagation();event.preventDefault();}
    else if(!jfReader.hidden){jfDeskCloseReader();event.stopImmediatePropagation();event.preventDefault();}
  }
},true);

// v6.85 · Adjustable divider between the notes index and the writing canvas.
const jfNoteDivider=document.getElementById('jfDeskNotesDivider');
let jfNoteDividerDrag=null,jfNoteListWidth=null;
function jfNoteSplitLimits(){
  const panel=document.getElementById('jfDeskNotes');
  const css=getComputedStyle(panel),padding=parseFloat(css.paddingLeft)||0;
  const right=parseFloat(css.paddingRight)||0;
  const inner=Math.max(320,panel.clientWidth-padding-right);
  return {inner,padding,min:Math.min(155,inner*.3),max:inner*.45};
}
function jfNoteSplitApply(value){
  const panel=document.getElementById('jfDeskNotes');
  const bounds=jfNoteSplitLimits();
  const target=Math.max(bounds.min,Math.min(bounds.max,value));
  jfNoteListWidth=target;
  panel.style.setProperty('--jf-note-list-width',target+'px');
  requestAnimationFrame(()=>{
    const list=document.getElementById('jfDeskNoteList').getBoundingClientRect();
    const editor=document.getElementById('jfDeskEditor').getBoundingClientRect();
    const p=panel.getBoundingClientRect();
    const x=editor.left>list.right? (editor.left+list.right)/2:list.right+7;
    jfNoteDivider.style.left=(x-p.left)+'px';
  });
}
function jfNoteSplitInit(){
  if(!document.body.classList.contains('jfNotesMode'))return;
  const min=jfNoteSplitLimits();
  jfNoteSplitApply(jfNoteListWidth ?? Math.min(252,min.inner*.24));
}
jfNoteDivider.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  e.preventDefault();e.stopPropagation();
  jfNoteDividerDrag={x:e.clientX,width:jfNoteListWidth||252};
  jfNoteDivider.classList.add('jfDragging');jfNoteDivider.setPointerCapture(e.pointerId);
});
jfNoteDivider.addEventListener('pointermove',e=>{
  if(!jfNoteDividerDrag)return;
  jfNoteSplitApply(jfNoteDividerDrag.width+e.clientX-jfNoteDividerDrag.x);
});
function jfNoteSplitEnd(){jfNoteDividerDrag=null;jfNoteDivider.classList.remove('jfDragging');}
jfNoteDivider.addEventListener('pointerup',jfNoteSplitEnd);
jfNoteDivider.addEventListener('pointercancel',jfNoteSplitEnd);
jfNoteDivider.addEventListener('keydown',e=>{
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
    e.preventDefault();jfNoteSplitApply((jfNoteListWidth||252)+(e.key==='ArrowRight'?14:-14));
  }
});
window.addEventListener('resize',jfNoteSplitInit);
requestAnimationFrame(jfNoteSplitInit);
