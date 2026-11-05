// v6.50 · Reading & Notes — private workspace, no external dependencies or HTML injection.
const jfReader=document.getElementById('jfReader');
const jfReadCenter=document.getElementById('jfReadCenter');
const jfReadText=document.getElementById('jfReadText');
// Keep the source chapter untouched: only TXT presentation is reflowed.
// This leaves EPUB layout, chapter boundaries, and on-disk source intact.
let jfReadRawText='',jfReadRawToDisplay=null,jfReadHtml='';
function jfTxtSmartReflow(raw){return jfTextPresentation.reflow(raw);}

// Screenshot-safe display mask. Full-width replacement glyphs preserve
// the space occupied by Han characters, unlike ASCII substitutions.
let jfReadVisualText='',jfReadMaskEnabled=false;
function jfReadMaskString(value){return jfTextPresentation.mask(value);}
function jfReadApplyMask(){
  if(jfReadHtml&&!jfReadMaskEnabled){
    // Restricted fragment from the server: no scripts, no remote resources.
    jfReadText.innerHTML=jfReadHtml;
    jfReadText.classList.add('jfReadHtml');
  }else{
    jfReadText.classList.remove('jfReadHtml');
    jfReadText.textContent=jfReadMaskEnabled?jfReadMaskString(jfReadVisualText):jfReadVisualText;
  }
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
// Reading session: bumped every time a book is opened. Any async work that
// resolves against an older session is discarded instead of writing back.
let jfDeskSession=0;
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
  jfReader.classList.toggle('paper',jfDeskPrefs.theme==='paper'||jfDeskPaged);
  // Font, measure and family all change line breaking, so the paper-book pages
  // must be measured again; the anchor keeps the reader where they were.
  if(jfDeskPaged){
    const view=document.getElementById('jfPageView');
    view.style.setProperty('--jf-read-font',jfDeskFont+'px');
    view.style.setProperty('--jf-read-family',jfReadFamilyMap[jfDeskPrefs.family]||jfReadFamilyMap.serif);
    if(typeof jfDeskPagedRelayoutWithBusy==='function')jfDeskPagedRelayoutWithBusy('prefs');
    else if(typeof jfDeskPagedLayout==='function')jfDeskPagedLayout(true,'prefs');
  }
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
  jfReadRawText='';jfReadRawToDisplay=null;jfReadVisualText='';jfReadMaskEnabled=false;jfReadHtml='';
  document.getElementById('jfReadExcerpt').disabled=false;
  jfPdfJsMarksListClose();document.getElementById('jfPdfMarksListToggle').hidden=true;
  const epoch=++jfDeskEpoch;
  jfDeskSession++;
  jfDeskInflight.clear();
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
// ---- v7.32 continuous EPUB reading -------------------------------------------
// Chapters are appended/prepended as <section data-chapter> inside #jfReadText so
// the reader scrolls like one long document instead of paging chapter by chapter.
// Excerpt offsets stay per-chapter: the anchor is computed inside the section that
// owns the selection, which keeps the stored format compatible with older notes.
let jfDeskFlow=[],jfDeskFlowBusy=false,jfDeskBackfillBusy=false;
// Cover/blank EPUB front matter stays in the archive and continuous scroll,
// but should not be a page of the simulated paper book.
function jfDeskPaperOmittedChapter(n){
  return !!(jfDeskPaged&&jfDeskOutline?.format==='EPUB'&&jfDeskOutline.chapters?.[n]?.paperOmit);
}
function jfDeskPaperFirstReadable(n){
  if(!jfDeskPaged||jfDeskOutline?.format!=='EPUB')return n;
  const total=jfDeskOutline.chapters.length;
  while(n<total-1&&jfDeskPaperOmittedChapter(n))n++;
  return n;
}
const JF_FLOW_PREFETCH=1400;   // px from an edge that triggers the neighbouring load
const JF_FLOW_MAX=15;          // hard cap on simultaneously mounted chapters
const JF_FLOW_AHEAD=2;

function jfDeskFlowReset(){jfDeskFlow=[];jfDeskFlowBusy=false;}
function jfDeskFlowSection(n,html){
  const sec=document.createElement('section');
  sec.className='jfEpubChapter';
  sec.dataset.chapter=String(n);
  sec.innerHTML=html||'<p></p>';
  return sec;
}
async function jfDeskFlowFetch(n){
  const data=await jfDeskApi('chapter?id='+encodeURIComponent(jfDeskBook.id)+'&chapter='+n);
  return data.html||'';
}
// One in-flight fetch per (book, chapter). Without this, two concurrent callers
// both pass the "already mounted" check before either resolves and the chapter
// is appended twice — which then paginates twice and shifts the reader.
const jfDeskInflight=new Map();
function jfDeskFlowFetchOnce(n){
  if(!jfDeskBook||!jfDeskOutline)return Promise.resolve(false);
  if(!Number.isInteger(n)||n<0||n>=jfDeskOutline.chapters.length)return Promise.resolve(false);
  const bookId=jfDeskBook.id,session=jfDeskSession;
  const key=bookId+'#'+n;
  if(jfDeskInflight.has(key))return jfDeskInflight.get(key);
  if(jfDeskFlow.some(x=>x.n===n))return Promise.resolve(false);
  const task=(async()=>{
    try{
      const html=await jfDeskFlowFetch(n);
      // The reading session may have been replaced while the fetch was in flight.
      if(jfDeskSession!==session||jfDeskBook?.id!==bookId)return false;
      if(jfDeskFlow.some(x=>x.n===n))return false;
      return html;
    }finally{jfDeskInflight.delete(key);}
  })();
  jfDeskInflight.set(key,task);
  return task;
}
async function jfDeskFlowAppend(n){
  if(jfDeskPaperOmittedChapter(n))return false;
  const html=await jfDeskFlowFetchOnce(n);
  if(html===false)return false;
  if(jfDeskFlow.some(x=>x.n===n))return false;
  const sec=jfDeskFlowSection(n,html);
  jfReadText.append(sec);
  jfDeskFlow.push({n,el:sec});
  if(jfDeskPaged)jfDeskPagedLayout(true,'append');
  return true;
}
async function jfDeskFlowPrepend(n){
  if(jfDeskPaperOmittedChapter(n))return false;
  const html=await jfDeskFlowFetchOnce(n);
  if(html===false)return false;
  if(jfDeskFlow.some(x=>x.n===n))return false;
  const sec=jfDeskFlowSection(n,html);
  const before=jfReadCenter.scrollHeight,top=jfReadCenter.scrollTop;
  jfReadText.prepend(sec);
  jfDeskFlow.unshift({n,el:sec});
  jfReadCenter.scrollTop=top+(jfReadCenter.scrollHeight-before);
  // Wait until the page list has been atomically replaced before a boundary
  // navigation uses it; the old fire-and-forget path raced the next click.
  if(jfDeskPaged)await jfDeskPagedLayout(true,'prepend');
  return true;
}
function jfDeskFlowTrim(){
  while(jfDeskFlow.length>JF_FLOW_MAX){
    const box=jfReadCenter.getBoundingClientRect();
    const first=jfDeskFlow[0],last=jfDeskFlow[jfDeskFlow.length-1];
    const farTop=first.el.getBoundingClientRect().bottom<box.top-JF_FLOW_PREFETCH*2;
    const farBottom=last.el.getBoundingClientRect().top>box.bottom+JF_FLOW_PREFETCH*2;
    if(farTop&&farBottom){const item=jfDeskFlow.shift();item.el.remove();}
    else break;
  }
}
function jfDeskFlowVisible(){
  const box=jfReadCenter.getBoundingClientRect();
  for(const item of jfDeskFlow){
    const r=item.el.getBoundingClientRect();
    if(r.bottom>box.top+1)return {item,r,box};
  }
  return null;
}
async function jfDeskShowChapterFlow(number,ratio=0){
  number=jfDeskPaperFirstReadable(number);
  const epoch=++jfDeskEpoch;
  jfDeskFlowReset();
  jfReadText.replaceChildren();
  jfReadText.hidden=false;
  jfReadText.classList.remove('jfTxtProse');
  jfDeskChapter=number;
  jfReadRawToDisplay=null;
  jfReadHtml='';
  const bookId=jfDeskBook.id;
  const first=jfDeskFlowSection(number,'<p class="jfEpubPending">正在载入…</p>');
  jfReadText.append(first);
  jfDeskFlow.push({n:number,el:first});
  try{
    const html=await jfDeskFlowFetch(number);
    if(epoch!==jfDeskEpoch||jfDeskBook?.id!==bookId)return;
    first.innerHTML=html||'<p></p>';
  }catch(e){
    if(epoch!==jfDeskEpoch)return;
    first.innerHTML='<p class="jfEpubPending">章节无法打开：'+String(e.message||e)+'</p>';
    return;
  }
  jfReadRawText=first.textContent;
  jfReadVisualText=jfReadRawText;
  jfReadText.classList.add('jfReadHtml');
  // The section was mounted with a placeholder before the fetch resolved, so any
  // cached pagination for it describes the placeholder, not the chapter.
  if(typeof jfDeskChapterPages!=='undefined')jfDeskChapterPages.delete(number);
  if(jfDeskPaged)jfDeskPagedLayout(true);
  for(const id of ['jfReadPrev','jfReadNext'])document.getElementById(id).disabled=false;
  document.getElementById('jfReadChapters').value=String(number);
  jfReadCenter.scrollTop=0;
  requestAnimationFrame(()=>{
    if(epoch!==jfDeskEpoch)return;
    const box=jfReadCenter.getBoundingClientRect(),r=first.getBoundingClientRect();
    jfReadCenter.scrollTop=Math.max(0,jfReadCenter.scrollTop+(r.top-box.top)+ratio*r.height);
    jfDeskProgressSignature='';jfDeskUpdateProgress();
  });
  // Prefetch ahead sequentially: concurrent appends would interleave and leave
  // the mounted sections out of reading order.
  (async()=>{
    for(let i=1;i<=JF_FLOW_AHEAD;i++){
      const n=number+i;
      if(n>=jfDeskOutline.chapters.length)break;
      if(jfDeskBook?.id!==bookId)break;
      await jfDeskFlowAppend(n);
    }
  })().catch(()=>{});
}
function jfDeskFlowOnScroll(){
  if(jfDeskPaged||jfReadMaskEnabled||!jfDeskFlow.length||jfDeskFlowBusy)return;
  const total=jfDeskOutline?.chapters.length||0;
  if(!total)return;
  const c=jfReadCenter;
  // Track the highest/lowest mounted chapter, not array ends: prefetch may still
  // be settling and the two must never disagree about which chapter comes next.
  let maxN=-1,minN=Infinity;
  for(const item of jfDeskFlow){if(item.n>maxN)maxN=item.n;if(item.n<minN)minN=item.n;}
  const nearBottom=c.scrollTop+c.clientHeight>c.scrollHeight-JF_FLOW_PREFETCH;
  const nearTop=c.scrollTop<JF_FLOW_PREFETCH;
  if(nearBottom&&maxN<total-1){
    jfDeskFlowBusy=true;
    jfDeskFlowAppend(maxN+1).catch(()=>{}).finally(()=>{jfDeskFlowBusy=false;});
  }else if(nearTop&&minN>0){
    jfDeskFlowBusy=true;
    jfDeskFlowPrepend(minN-1).catch(()=>{}).finally(()=>{jfDeskFlowBusy=false;});
  }
}
async function jfDeskShowChapter(number,ratio=0){
  if(jfDeskOutline?.nativePdf)return jfDeskShowPdfPage(number);
  if(!jfDeskBook||!jfDeskOutline||number<0||number>=jfDeskOutline.chapters.length)return;
  number=jfDeskPaperFirstReadable(number);
  // EPUB reads as one continuous document; TXT and the mask mode keep the paged path.
  if(jfDeskOutline.format==='EPUB'&&!jfReadMaskEnabled)return jfDeskShowChapterFlow(number,ratio);
  const epoch=++jfDeskEpoch;
  try{
    const data=await jfDeskApi('chapter?id='+encodeURIComponent(jfDeskBook.id)+'&chapter='+number);
    if(epoch!==jfDeskEpoch)return;
    jfDeskChapter=number;jfReadText.hidden=false;
    jfReadRawText=data.text;
    // EPUB ships a sanitized fragment; text remains the anchor/progress baseline.
    jfReadHtml=data.html||'';
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
  if(jfDeskPaged){
    const page=jfDeskPages[jfDeskPageIndex];
    const chapter=(page&&page[0]?page[0].chapter:jfDeskChapter);
    const frac=page&&page.length?Math.min(.99,(jfDeskPageIndex/Math.max(1,jfDeskPages.length))):0;
    const pct=Math.min(100,Math.round(((chapter+frac)/Math.max(1,jfDeskOutline.chapters.length))*100));
    document.getElementById('jfReadProgress').textContent=pct+'%';
    document.getElementById('jfReadProgressFill').style.width=pct+'%';
    return;
  }
  let chapter=jfDeskChapter,ratio=0;
  if(jfDeskFlow.length){
    const vis=jfDeskFlowVisible();
    if(vis){
      chapter=vis.item.n;
      const h=vis.r.height||1;
      ratio=Math.min(1,Math.max(0,(vis.box.top-vis.r.top)/h));
      jfDeskChapter=chapter;
    }
  }else{
    const max=Math.max(0,jfReadCenter.scrollHeight-jfReadCenter.clientHeight);
    ratio=max?Math.min(1,jfReadCenter.scrollTop/max):0;
  }
  const pct=Math.round((chapter+ratio)/jfDeskOutline.chapters.length*100);
  document.getElementById('jfReadProgress').textContent=pct+'%';
  document.getElementById('jfReadProgressFill').style.width=pct+'%';
  const sig=jfDeskBook.id+':'+jfDeskChapter+':'+Math.round(ratio*100);
  if(sig===jfDeskProgressSignature)return;
  jfDeskProgressSignature=sig;
  clearTimeout(jfDeskProgressTimer);
  const bookId=jfDeskBook.id,total=jfDeskOutline.chapters.length;
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
  // Continuous mode: the anchor is computed against the section that owns the
  // selection, so the stored offset stays chapter-local and old notes still resolve.
  const anchorEl=(sel.anchorNode&&(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement))?.closest?.('[data-chapter]')||null;
  const scope=anchorEl||jfReadText;
  const chapter=anchorEl?Number(anchorEl.dataset.chapter):jfDeskChapter;
  offset.selectNodeContents(scope);offset.setEnd(range.startContainer,range.startOffset);
  const leading=sel.toString().length-sel.toString().trimStart().length;
  jfDeskChooseQuote({text:text.slice(0,6000),bookId:jfDeskBook.id,chapter,anchorStart:offset.toString().length+leading});
}
async function jfDeskJumpToQuote(quote){
  if(!quote?.bookId)return;
  if(!await jfDeskCloseNotes())return;
  await jfDeskOpenReader(quote.bookId,quote.chapter);
  if(jfDeskBook?.id!==quote.bookId||!quote.text)return;
  if(jfDeskOutline?.nativePdf){jfPdfJsJumpToQuote(quote);return;}
  const targetChapter=Number.isSafeInteger(quote.chapter)?quote.chapter:jfDeskChapter;
  const owner=jfDeskFlow.find(x=>x.n===targetChapter)?.el||null;
  const scope=owner||jfReadText;
  const full=scope.textContent;
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
  // Restore any transient marker first, then map the text offset onto real nodes.
  // Multi-chapter sections mean the hit can span several text nodes.
  scope.querySelectorAll('mark.jfReadCitation').forEach(m=>m.replaceWith(...m.childNodes));
  const point=(root,at)=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let acc=0,node;
    while((node=walker.nextNode())){
      const len=node.nodeValue.length;
      if(acc+len>=at)return {node,offset:Math.max(0,at-acc)};
      acc+=len;
    }
    return null;
  };
  const start=point(scope,i),end=point(scope,i+Math.min(quote.text.length,80));
  if(!start||!end)return;
  const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);
  const marker=document.createElement('mark');marker.className='jfReadCitation';marker.style.cssText='background:#8ad9bd72;color:inherit;border-radius:3px';
  try{const fragment=range.extractContents();marker.appendChild(fragment);range.insertNode(marker);marker.scrollIntoView({block:'center',behavior:'smooth'});}catch{}
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
function jfDeskStepChapter(delta){
  if(jfDeskFlow.length){
    const vis=jfDeskFlowVisible();
    const current=vis?vis.item.n:jfDeskChapter;
    const target=current+delta;
    if(target<0||target>=jfDeskOutline.chapters.length)return;
    const mounted=jfDeskFlow.find(x=>x.n===target);
    if(mounted){jfDeskChapter=target;mounted.el.scrollIntoView({block:'start',behavior:'smooth'});}
    else jfDeskShowChapter(target,0);
    return;
  }
  jfDeskShowChapter(jfDeskChapter+delta);
}
document.getElementById('jfReadPrev').addEventListener('click',()=>jfDeskStepChapter(-1));
document.getElementById('jfReadNext').addEventListener('click',()=>jfDeskStepChapter(1));
document.getElementById('jfReadChapters').addEventListener('change',e=>{jfDeskFlowReset();jfDeskShowChapter(Number(e.target.value));});
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
// ---- v7.32 paged (paper book) mode -----------------------------------------
// Opt-in only. The continuous reader stays the default; this mode lays the text
// out as viewport-height columns and turns pages by scrolling one column at a
// time, so there is never vertical scrolling.
let jfDeskPaged=false,jfDeskPageIndex=0,jfDeskPagedPrevTheme='dark';

// A wide window shows a two-page spread; a narrow one shows a single page.
// The turn step is therefore the whole visible spread, not one column.
function jfDeskPagedCols(){return (jfReadCenter.clientWidth||0)>=1120?2:1;}
function jfDeskPagedMetrics(){
  const gap=parseFloat(jfReadText.style.getPropertyValue('--jf-page-gap'))||52;
  const cols=jfDeskPagedCols();
  let w=parseFloat(jfReadText.style.getPropertyValue('--jf-page-w'))||0;
  // Measure the real column instead of trusting the estimate. Padding, borders
  // or a changed font metric shift the column width, and a wrong step makes the
  // view land between two spreads (a third column leaks in at the edge).
  const probe=jfReadText.querySelector('p,div,section,h1,h2,h3,li,blockquote');
  const rect=probe&&probe.getClientRects()[0];
  if(rect&&rect.width>40)w=Math.round(rect.width);
  return {w,gap,cols,step:(w+gap)*cols};
}
function jfDeskPagedTotal(){
  const {step}=jfDeskPagedMetrics();
  if(!step)return 1;
  return Math.max(1,Math.ceil(jfReadCenter.scrollWidth/step-0.02));
}
// ---- v7.33 measured paper book --------------------------------------------
// Pages are real containers sized by the viewport; the engine places blocks by
// their rendered height. There is no CSS-column stepping, so a page can never
// end mid-line and content can never straddle the fold.
let jfDeskPages=[],jfMeasureHost=null;

function jfDeskPagedGeometry(){
  const cw=jfReadCenter.clientWidth||800,ch=jfReadCenter.clientHeight||600;
  const two=cw>=1000;
  const side=34,gap=20;
  const pageW=Math.max(260,Math.floor(two?(cw-side*2-gap)/2:Math.min(780,cw-side*2)));
  const pageH=Math.max(240,ch-28);
  const padX=Math.max(20,Math.round(pageW*(pageW>520?0.085:0.062)));
  const padY=Math.max(18,Math.round(pageH*0.055));
  return {two,pageW,pageH,padX,padY,innerW:pageW-padX*2,innerH:pageH-padY*2};
}
function jfDeskMeasureHost(geo){
  if(!jfMeasureHost){
    jfMeasureHost=document.createElement('div');
    jfMeasureHost.className='jfPageMeasure jfSheetBody';
    document.getElementById('jfPageView').appendChild(jfMeasureHost);
  }
  jfMeasureHost.style.width=geo.innerW+'px';
  // The probe must grow with its content: a fixed height makes scrollHeight
  // report that height, so every column looks "exactly full" and overflows.
  jfMeasureHost.style.height='auto';
  jfMeasureHost.style.padding='0';
  return jfMeasureHost;
}
// Every layout gets a generation number. Work that finishes after a newer
// layout started is discarded rather than publishing a stale page list.
let jfDeskPageGen=0;

// Images must be decoded before they are measured: a not-yet-decoded <img>
// reports its placeholder height, pagination is computed on a lie, and the page
// is published with a clipped picture.
async function jfDeskPrepareImages(){
  try{ if(document.fonts&&document.fonts.ready)await document.fonts.ready; }catch{}
  const imgs=Array.prototype.slice.call(jfReadText.querySelectorAll('img'));
  if(!imgs.length)return;
  await Promise.all(imgs.map(img=>{
    if(img.complete&&img.naturalWidth>0)return null;
    if(img.loading==='lazy')img.loading='eager';
    return new Promise(resolve=>{
      let settled=false;
      const done=()=>{if(!settled){settled=true;resolve();}};
      img.addEventListener('load',done,{once:true});
      img.addEventListener('error',done,{once:true});
      setTimeout(done,2500);
    });
  }));
}

// Per-chapter page cache. Chapter boundaries are page boundaries in a printed
// book, so each chapter can be paginated independently and the result reused.
// A chapter is re-paginated only when it is new or the layout signature changed.
const jfDeskChapterPages=new Map();
let jfDeskPagesSig='';

// Book-wide pagination statistics.
//
// jfDeskPages only contains the chapters that happen to be mounted, so its
// length is NOT the book's page count. Thickness and folio numbers must come
// from a book-wide model: per-chapter page counts, filled as chapters are
// paginated, plus an explicit "exact" flag that stays false until every chapter
// has been measured under the current layout signature.
const jfDeskChapterPageCounts=new Map();   // chapter number -> pages in that chapter
let jfDeskBookPages={total:0,exact:false,known:0,chapters:0};

function jfDeskRecountBookPages(){
  const totalChapters=(jfDeskOutline&&jfDeskOutline.chapters)?jfDeskOutline.chapters.length:0;
  let known=0,sum=0;
  for(let n=0;n<totalChapters;n++){
    const count=jfDeskPaperOmittedChapter(n)?0:jfDeskChapterPageCounts.get(n);
    if(typeof count==='number'){known++;sum+=count;}
  }
  const exact=totalChapters>0&&known===totalChapters;
  // When some chapters are unmeasured, extrapolate from the average of the ones
  // we know. It is labelled "estimated" everywhere, never presented as exact.
  const average=known?sum/known:0;
  const total=exact?sum:Math.round(average*totalChapters);
  jfDeskBookPages={total,exact,known,chapters:totalChapters};
  return jfDeskBookPages;
}
// Pages that precede a chapter, or null when an earlier chapter is still unknown.
function jfDeskPagesBefore(chapter){
  let sum=0;
  for(let n=0;n<chapter;n++){
    const count=jfDeskPaperOmittedChapter(n)?0:jfDeskChapterPageCounts.get(n);
    if(typeof count!=='number')return null;
    sum+=count;
  }
  return sum;
}

// Background census: paginate the chapters that are not mounted, so the book's
// page count becomes exact. It only records counts (no DOM is kept), runs one
// chapter at a time, and yields through requestIdleCallback so reading and page
// turns are never blocked.
let jfDeskCensusToken=0;
let jfDeskCensusRunning=false;
// Book-wide counting requires synchronous DOM measurement. Never start another
// chapter while the user is actively turning pages.
let jfDeskLastPageTurn=Date.now();
async function jfDeskWaitReadingIdle(token){
  while(Date.now()-jfDeskLastPageTurn<2200){
    if(token!==jfDeskCensusToken)return false;
    await new Promise(resolve=>setTimeout(resolve,160));
  }
  return token===jfDeskCensusToken;
}

async function jfDeskWaitImages(root){
  const imgs=Array.prototype.slice.call(root.querySelectorAll('img'));
  if(!imgs.length)return;
  // Force decode up front: a lazy image reports zero height, and a chapter
  // measured that way paginates into more pages than it really needs.
  await Promise.all(imgs.map(img=>{
    img.loading='eager';
    if(img.decode)img.decode().catch(()=>{});
    if(img.complete&&img.naturalWidth>0)return null;
    return new Promise(resolve=>{
      let done=false;
      const settle=()=>{if(!done){done=true;resolve();}};
      img.addEventListener('load',settle,{once:true});
      img.addEventListener('error',settle,{once:true});
      setTimeout(settle,3000);
    });
  }));
}

function jfDeskIdle(){
  return new Promise(resolve=>{
    if(window.requestIdleCallback)requestIdleCallback(()=>resolve(),{timeout:180});
    else setTimeout(resolve,16);
  });
}

async function jfDeskMeasureBook(geo){
  if(jfDeskCensusRunning)return;
  if(!jfDeskBook||!jfDeskOutline)return;
  const totalChapters=jfDeskOutline.chapters.length;
  if(!totalChapters)return;
  const token=++jfDeskCensusToken;
  const bookId=jfDeskBook.id,session=jfDeskSession;
  jfDeskCensusRunning=true;
  try{
    const host=jfDeskMeasureHost(geo);
    const budget=Math.max(120,geo.innerH);
    for(let n=0;n<totalChapters;n++){
      if(jfDeskCensusToken!==token)return;              // superseded
      if(jfDeskSession!==session||jfDeskBook?.id!==bookId)return;
      if(jfDeskPaperOmittedChapter(n)||jfDeskChapterPageCounts.has(n))continue;
      await jfDeskIdle();
      if(!await jfDeskWaitReadingIdle(token))return;
      let html=null;
      try{html=await jfDeskFlowFetch(n);}catch(error){continue;}
      if(!html)continue;
      // Measure in a real, off-screen box: images must occupy their final height
      // or the chapter paginates shorter than it will when actually mounted, and
      // the book total becomes a different number every time it is recomputed.
      const holder=document.createElement('div');
      holder.className='jfSheetBody';
      holder.style.cssText='position:absolute;left:-99999px;top:0;width:'+geo.innerW+'px;padding:0;height:auto';
      document.body.appendChild(holder);
      try{
        // Same construction path as a mounted chapter, or the census would count
        // a different DOM (sanitiser, caption merging) and report other page counts.
        const section=jfDeskFlowSection(n,html);
        holder.appendChild(section);
        await jfDeskWaitImages(holder);
        if(!await jfDeskWaitReadingIdle(token))return;
        // Identical blocks to actual reading: caption merging can change
        // the page count, so a simplified census must never lie about folios.
        if(jfDeskCensusToken!==token||jfDeskSession!==session||
           jfDeskBook?.id!==bookId||jfDeskPagesSig!==jfDeskLayoutSignature(geo))return;
        const blocks=jfDeskBlocksFor({n,el:section});
        const measured=window.JFPageEngine?window.JFPageEngine.paginate(blocks,budget,host):[];
        jfDeskChapterPageCounts.set(n,measured.length);
      }finally{
        holder.remove();
      }
      jfDeskRecountBookPages();
    }
  }finally{
    jfDeskCensusRunning=false;
    if(jfDeskCensusToken===token){
      jfDeskRecountBookPages();
      if(jfDeskPaged)jfDeskPagedLayout(true,'census');
    }else if(jfDeskPaged && jfDeskBook && !jfDeskBookPages.exact){
      // The old census was invalidated by a new font/viewport/book session.
      // It must not block a fresh census at the current page geometry.
      setTimeout(()=>{if(!jfDeskCensusRunning)jfDeskMeasureBook(jfDeskPagedGeometry());},950);
    }
  }
}

function jfDeskLayoutSignature(geo){
  return [jfDeskBook?.id||'',jfDeskPrefs.font,jfDeskPrefs.family,jfDeskPrefs.side,
          geo.pageW,geo.pageH,geo.innerW,geo.innerH].join('|');
}
// EPUBS often express a caption as a separate short <p> after the image rather
// than inside a <figure>. Detect that shape and bind the two so pagination can
// never place the caption on the next page, away from its picture.
function jfDeskIsCaption(node){
  if(!node||node.tagName!=='P')return false;
  const text=(node.textContent||'').trim();
  if(!text||text.length>90)return false;
  // Any short parenthetical that names a picture: （明信片）, （漫画明信片）, （图 3）...
  return /^[（(]/.test(text)||/[（(][^）)]{0,12}(明信片|图片|图)[^）)]{0,12}[）)]/.test(text);
}
function jfDeskBlocksFor(sec){
  const raw=Array.prototype.slice.call(sec.el.children);
  const blocks=[];
  let i=0,acc=0;
  for(let k=0;k<raw.length;k++){
    const node=raw[k];
    const next=raw[k+1];
    const carriesImage=node.querySelector&&node.querySelector('img');
    if(next&&carriesImage&&jfDeskIsCaption(next)){
      const wrap=document.createElement('figure');
      wrap.appendChild(document.importNode(node,true));
      const caption=document.createElement('figcaption');
      caption.textContent=next.textContent.trim();
      wrap.appendChild(caption);
      blocks.push({chapter:sec.n,node:wrap,key:sec.n+':'+(i++),offset:acc,mergedCaption:true});
      acc+=node.textContent.length+next.textContent.length;
      k++;
      continue;
    }
    blocks.push({chapter:sec.n,node:document.importNode(node,true),
                 key:sec.n+':'+(i++),offset:acc});
    acc+=node.textContent.length;
  }
  return blocks;
}

async function jfDeskPagedLayout(keepPage,reason){
  if(!jfDeskPaged)return;
  const gen=++jfDeskPageGen;
  // An earlier chapter is inserted *before* the mounted window. Its newly
  // inserted pages shift array indices, even though the visible page identity
  // stays the same. Preserve this page reference across async measurements.
  const beforePrepend=reason==='prepend'?jfDeskPages[jfDeskPageIndex]:null;
  const geo=jfDeskPagedGeometry();
  const view=document.getElementById('jfPageView');
  view.style.setProperty('--jf-page-w',geo.pageW+'px');
  view.style.setProperty('--jf-page-h',geo.pageH+'px');
  view.style.setProperty('--jf-pad-x',geo.padX+'px');
  view.style.setProperty('--jf-pad-y',geo.padY+'px');
  await jfDeskPrepareImages();
  if(gen!==jfDeskPageGen)return;
  const host=jfDeskMeasureHost(geo);
  const anchor=keepPage?jfDeskCurrentAnchor():null;
  const signature=jfDeskLayoutSignature(geo);
  if(signature!==jfDeskPagesSig){
    // Invalidate a census still using the previous font/viewport geometry.
    jfDeskCensusToken++;
    jfDeskChapterPages.clear();
    // Page counts only mean anything for the layout they were measured under.
    jfDeskChapterPageCounts.clear();
    jfDeskPagesSig=signature;
  }
  const budget=Math.max(120,geo.innerH);
  const pages=[];
  const mounted=new Set(jfDeskFlow.map(s=>s.n));
  // Drop cached chapters that are no longer mounted (trimmed window).
  for(const key of Array.from(jfDeskChapterPages.keys()))if(!mounted.has(key))jfDeskChapterPages.delete(key);

  for(const sec of jfDeskFlow){
    if(jfDeskPaperOmittedChapter(sec.n))continue;
    let cached=jfDeskChapterPages.get(sec.n);
    if(!cached){
      const blocks=jfDeskBlocksFor(sec);
      cached=window.JFPageEngine?window.JFPageEngine.paginate(blocks,budget,host):[];
      jfDeskChapterPages.set(sec.n,cached);
    }
    jfDeskChapterPageCounts.set(sec.n,cached.length);
    for(const page of cached)pages.push(page);
  }
  // TXT has no mounted sections: structure the plain chapter text once and cache
  // it under the current chapter number.
  if(!jfDeskFlow.length && jfDeskOutline&&jfDeskOutline.format!=='EPUB'){
    let cached=jfDeskChapterPages.get(jfDeskChapter);
    if(!cached){
      const NL=String.fromCharCode(10);
      const blocks=[];
      String(jfReadRawText||'').split(NL+NL).map(s=>s.trim()).filter(Boolean)
        .forEach((text,i)=>{
          const p=document.createElement('p');
          p.textContent=text;
          const offset=blocks.reduce((n,b)=>n+b.node.textContent.length,0);
          blocks.push({chapter:jfDeskChapter,node:p,key:'t'+jfDeskChapter+':'+i,offset});
        });
      cached=window.JFPageEngine?window.JFPageEngine.paginate(blocks,budget,host):[];
      jfDeskChapterPages.set(jfDeskChapter,cached);
      jfDeskChapterPageCounts.set(jfDeskChapter,cached.length);
    }
    for(const page of cached)pages.push(page);
  }
  if(gen!==jfDeskPageGen)return;   // a newer layout already started
  jfDeskPages=pages;                // atomic swap: page turns never see a half-built list
  jfDeskRecountBookPages();
  if(!jfDeskBookPages.exact&&!jfDeskCensusRunning){
    // Measure the rest of the book in the background, off the critical path.
    setTimeout(()=>jfDeskMeasureBook(geo),1200);
  }
  // Decide single vs spread only after pagination: with one page a spread would
  // show an empty facing page.
  const twoPages=geo.two&&jfDeskPages.length>1;
  view.classList.toggle('single',!twoPages);
  view.querySelector('.jfSheet[data-side="right"]').hidden=!twoPages;
  // Restore by block identity, not by page number: a reflow changes how many
  // pages exist, so the old index is meaningless. Fall back to the first page of
  // the same chapter when the exact block no longer starts a page.
  // Appending a chapter only adds pages at the end: every page before it keeps its
  // index and identity. Re-deriving the index from an anchor in that case moved
  // the reader, which is exactly the "next page skips one" defect. Only a real
  // reflow (font, family, margin, size) may re-locate the reader.
  const appended=reason==='append'||reason==='prepend';
  if(reason==='prepend'&&beforePrepend){
    const shifted=jfDeskPages.indexOf(beforePrepend);
    if(shifted>=0)jfDeskPageIndex=shifted;
    else if(anchor){
      let found=-1;
      for(let i=0;i<jfDeskPages.length;i++){
        const p=jfDeskPages[i];
        if(p[0]?.chapter===anchor.chapter&&(p[0].offset||0)<=anchor.offset)found=i;
      }
      if(found>=0)jfDeskPageIndex=found;
    }
  }else if(!appended){
    if(anchor){
      let found=-1;
      for(let i=0;i<jfDeskPages.length;i++){
        const p=jfDeskPages[i];
        if(!p.length)continue;
        if(p[0].chapter===anchor.chapter&&(p[0].offset||0)<=anchor.offset)found=i;
      }
      if(found<0)found=jfDeskPages.findIndex(p=>p[0]&&p[0].chapter===anchor.chapter);
      jfDeskPageIndex=found>=0?found:0;
    }else jfDeskPageIndex=0;
  }
  if(twoPages&&jfDeskPageIndex%2)jfDeskPageIndex-=1;
  jfDeskPageIndex=Math.max(0,Math.min(jfDeskPageIndex,Math.max(0,jfDeskPages.length-(twoPages?2:1))));
  // Warm the first visible spread before publishing it. Future turns never
  // await an image: each render primes the adjacent spreads in advance.
  if(window.JFPaperTextures?.isEnabled()){
    const step=twoPages?2:1;
    const spreads=[0,1,2].map(i=>({
      left:jfDeskPages[jfDeskPageIndex+i*step],
      right:twoPages?jfDeskPages[jfDeskPageIndex+i*step+1]:null
    }));
    await window.JFPaperTextures.warm(jfDeskBook?.id,spreads);
    if(gen!==jfDeskPageGen)return;
  }
  jfDeskPagedRender();
}
function jfDeskCurrentAnchor(){
  const page=jfDeskPages[jfDeskPageIndex];
  const first=page&&page[0];
  return first?{chapter:first.chapter,offset:first.offset||0}:null;
}
// v7.54 · Physical paper stacks are a visual reading-progress indicator.
// A perceptual curve emphasizes the beginning/end without pretending that
// every printed sheet has one screen pixel of physical thickness. No DOM,
// layout measurement or animation is involved in this pure calculation.
function jfDeskStackForProgress(value){
  const raw=Number(value);
  const p=Number.isFinite(raw)?Math.max(0,Math.min(1,raw)):0;
  const thickness=portion=>portion<=0?0:
    Math.round((3.2+25.8*Math.pow(portion,.78))*10)/10;
  return {read:thickness(p),unread:thickness(1-p)};
}
// Plates are scanned on a cream backing that is close to — but not equal to —
// the sheet colour. No blend mode can hide that difference: multiply keeps it,
// darken keeps whichever side is darker. The only honest fix is to key the
// backing out at the pixel level, once per image, and keep the result.
const jfDeskPlateDone=new WeakSet();
function jfDeskKnockOutPlate(img){
  if(!img||jfDeskPlateDone.has(img))return;
  if(!img.naturalWidth||!img.complete)return;
  if(img.dataset.jfPlate==='skip')return;
  jfDeskPlateDone.add(img);
  try{
    const maxW=1600;
    const scale=Math.min(1,maxW/img.naturalWidth);
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(img.naturalWidth*scale));
    c.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(img,0,0,c.width,c.height);
    const frame=ctx.getImageData(0,0,c.width,c.height);
    const px=frame.data;
    const total=px.length/4;
    let pale=0;
    for(let i=0;i<px.length;i+=4){
      if(0.299*px[i]+0.587*px[i+1]+0.114*px[i+2]>230)pale++;
    }
    // Only plates with a large pale field are keyed; photos that bleed to the
    // edge keep their own tone, and line art on white is exactly the target.
    if(pale/total<0.22){img.dataset.jfPlate='skip';return;}
    for(let i=0;i<px.length;i+=4){
      const l=0.299*px[i]+0.587*px[i+1]+0.114*px[i+2];
      if(l>=234){px[i+3]=0;}
      else if(l>212){px[i+3]=Math.round((234-l)/22*255);}
    }
    ctx.putImageData(frame,0,0);
    img.src=c.toDataURL('image/webp',0.94);
    img.dataset.jfPlate='done';
  }catch(error){
    img.dataset.jfPlate='skip';
  }
}
function jfDeskKnockOutPlates(root){
  if(!root||!root.querySelectorAll)return;
  for(const img of root.querySelectorAll('img:not([data-jf-plate])'))jfDeskKnockOutPlate(img);
}

function jfDeskPagedRender(direction){
  const geo=jfDeskPagedGeometry();
  const twoPages=geo.two&&jfDeskPages.length>1;
  const left=document.getElementById('jfSheetLeft');
  const right=document.getElementById('jfSheetRight');
  const pageA=jfDeskPages[jfDeskPageIndex]||[];
  const pageB=twoPages?(jfDeskPages[jfDeskPageIndex+1]||[]):[];
  // One deterministic texture group per real two-page spread, not guessed parity.
  if(window.JFPaperTextures){
    const paper=window.JFPaperTextures,bookId=jfDeskBook?.id;
    paper.applySpread(left.parentElement,right.parentElement,bookId,pageA,pageB,twoPages);
    const step=twoPages?2:1;
    const spreads=[-2,-1,0,1,2].map(i=>({
      left:jfDeskPages[jfDeskPageIndex+i*step],
      right:twoPages?jfDeskPages[jfDeskPageIndex+i*step+1]:null
    }));
    paper.warm(bookId,spreads).catch(()=>{});
  }
  left.replaceChildren(...pageA.map(x=>x.node));
  right.replaceChildren(...pageB.map(x=>x.node));
  const first=pageA[0]||pageB[0];
  if(first)jfDeskChapter=first.chapter;
  // Key out the cream backing of scanned plates before the eye sees it.
  jfDeskKnockOutPlates(left);
  jfDeskKnockOutPlates(right);
  // Folio and running head: page numbers follow the book, the head follows the chapter.
  const leftSheet=left.parentElement, rightSheet=right.parentElement;

  const title=(jfDeskOutline&&jfDeskOutline.chapters&&jfDeskOutline.chapters[jfDeskChapter])
    ?jfDeskOutline.chapters[jfDeskChapter].title:'';
  left.dataset.running=title;
  right.dataset.running=pageB.length?title:'';
  const sel=document.getElementById('jfReadChapters');
  if(sel)sel.value=String(jfDeskChapter);
  // Reading progress drives how much paper is stacked on each outer edge: the
  // left edge thickens as pages are read, the right one thins out.
  // Thickness is a statement about the book, not about the mounted array.
  //   read stack   = sheets physically before this spread
  //   unread stack = sheets physically after it
  // The folio number must also be a book-wide number; jfDeskPageIndex is only an
  // index into whatever chapters happen to be mounted.
  const book=jfDeskBookPages;
  const pageA0=jfDeskPages[jfDeskPageIndex]||[];
  const chapterOfPage=pageA0[0]?pageA0[0].chapter:jfDeskChapter;
  const chapterPages=jfDeskChapterPages.get(chapterOfPage)||[];
  const inChapter=Math.max(0,chapterPages.indexOf(pageA0));
  const pagesBefore=jfDeskPagesBefore(chapterOfPage);
  // A known prefix yields an exact folio even while later chapters are not
  // counted. The book-wide total may still be estimated; do not mix the two.
  const exactNumber=pagesBefore!=null;
  // When earlier chapters have not been measured, extrapolate by chapter position
  // and mark the folio as estimated so it is never presented as an exact one.
  const estimatedNumber=Math.round((chapterOfPage/Math.max(1,book.chapters))*book.total)+inChapter+1;
  const leftPageNumber=exactNumber?(pagesBefore+inChapter+1):estimatedNumber;
  const rightPageNumber=leftPageNumber+(pageB.length?1:0);
  const totalSheets=book.total>0?book.total:0;
  const readPages=Math.max(0,leftPageNumber-1);
  const unreadPages=Math.max(0,totalSheets-rightPageNumber);

  // Use exact physical page counts as soon as the background chapter census
  // finishes. Before then use the *readable chapter* position, never the local
  // mounted-window array index or an unreliable extrapolated total.
  const exactProgress=book.exact&&exactNumber&&totalSheets>0;
  const firstReadable=jfDeskPaperFirstReadable(0);
  const readableChapters=Math.max(1,book.chapters-firstReadable);
  const chapterFraction=chapterPages.length?inChapter/chapterPages.length:0;
  let progress=Math.max(0,Math.min(1,
    (chapterOfPage-firstReadable+chapterFraction)/readableChapters));
  if(exactProgress){
    const pagesBetween=Math.max(1,totalSheets-Math.min(totalSheets,geo.two?2:1));
    progress=Math.max(0,Math.min(1,readPages/pagesBetween));
  }else if(chapterOfPage>=book.chapters-1&&
           inChapter>=Math.max(0,chapterPages.length-(pageB.length?2:1))){
    progress=1;
  }
  const stacks=jfDeskStackForProgress(progress);
  const readVisible=exactProgress?readPages>0:progress>0;
  const unreadVisible=exactProgress?unreadPages>0:progress<1;
  const readWidth=readVisible?stacks.read.toFixed(1)+'px':'0px';
  const unreadWidth=unreadVisible?stacks.unread.toFixed(1)+'px':'0px';
  jfDeskStackState={total:totalSheets,exact:book.exact,left:leftPageNumber,right:rightPageNumber,
                    read:readPages,unread:unreadPages,readPx:readWidth,unreadPx:unreadWidth,
                    progress:Math.round(progress*100),progressExact:exactProgress,
                    folio:exactNumber?'exact':'estimated'};
  // Folio numbers are book-wide values, never the index into the mounted array.
  if(leftSheet){
    leftSheet.dataset.page=String(leftPageNumber);
    leftSheet.dataset.folioExact=exactNumber?'true':'false';
  }
  if(rightSheet){
    rightSheet.dataset.page=pageB.length?String(rightPageNumber):'';
    rightSheet.dataset.folioExact=exactNumber?'true':'false';
  }
  const leftStack=left.parentElement&&left.parentElement.querySelector('.jfSheetStack');
  const rightStack=right.parentElement&&right.parentElement.querySelector('.jfSheetStack');
  if(leftStack)leftStack.style.setProperty('--jf-stack-w',readWidth);
  if(rightStack)rightStack.style.setProperty('--jf-stack-w',unreadWidth);
  const pageView=document.getElementById('jfPageView');
  pageView.style.setProperty('--jf-stack-read',readWidth);
  pageView.style.setProperty('--jf-stack-unread',unreadWidth);
  // No sheets, no stack: the element is removed from paint entirely, shadow included.
  if(leftStack){leftStack.dataset.empty=readVisible?'false':'true';leftStack.dataset.sheets=String(readPages);}
  if(rightStack){rightStack.dataset.empty=unreadVisible?'false':'true';rightStack.dataset.sheets=String(unreadPages);}
  // The physical book shell lives OUTSIDE the paper sheets. Keep its two
  // independent side/bottom edges in lockstep with the same book-wide census,
  // and remove each side completely when the sheet count reaches zero.
  for(const side of ['left','right']){
    const empty=side==='left'?!readVisible:!unreadVisible;
    for(const el of pageView.querySelectorAll('.jfBookPile[data-side="'+side+'"]')){
      el.dataset.empty=empty?'true':'false';
    }
  }
  // A light transition sells the turn without touching layout. Skipped when the
  // user asked for reduced motion or when the caller only re-renders in place.
  if(direction){
    // No forced synchronous layout or whole-sheet transform animation.
    const view=document.getElementById('jfPageView');
    view.classList.remove('jf-turning');
    clearTimeout(jfDeskTurnTimer);
  }
  jfDeskUpdateProgress();
}
let jfDeskTurnTimer=0;
// Page counts behind each stack thickness; diagnostics only.
let jfDeskStackState=null;
// Mode and size changes re-measure every page. Paint a busy layer first, give the
// browser a frame to draw it, then do the expensive work after that frame.
let jfDeskBusyTimer=0;
// Its own token: the layout increments jfDeskPageGen internally, so that counter
// can never identify "my" request.
let jfDeskBusyToken=0;
async function jfDeskPagedRelayoutWithBusy(reason){
  if(!jfDeskPaged)return;
  const busy=document.getElementById('jfPageBusy');
  if(busy)busy.hidden=false;
  const token=++jfDeskBusyToken;
  try{
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    await Promise.race([
      jfDeskPagedLayout(true,reason),
      new Promise(r=>{clearTimeout(jfDeskBusyTimer);jfDeskBusyTimer=setTimeout(r,4000);})
    ]);
  }catch(error){
    console.warn('[JustFun] 书页调整失败，保留当前页面',error);
  }finally{
    // A superseded request must not close the layer of the newest one.
    if(token===jfDeskBusyToken&&busy)busy.hidden=true;
  }
}
function jfDeskPagedTotal(){return jfDeskPages.length||1;}
// Explain abnormal whitespace: chapter end, an unsplittable image, or a split
// refused by the orphan/widow rule.
function jfDeskPagedReportFill(){
  const geo=jfDeskPagedGeometry();
  const two=jfDeskPages.length>1;
  const idx=jfDeskPageIndex;
  const pages=two?[jfDeskPages[idx],jfDeskPages[idx+1]].filter(Boolean):[jfDeskPages[idx]];
  const reasons={end:'chapter end',scaled:'scaled figure',oversized:'unsplittable block',split:'split'};
  const short=[];
  for(const page of pages){
    if(!page)continue;
    const h=page.reduce((s,b)=>{
      const el=b.node;const cs=getComputedStyle(el);
      return s+el.getBoundingClientRect().height+(parseFloat(cs.marginBottom)||0);
    },0);
    const fill=h/geo.innerH;
    if(fill<0.72){
      const flags=[...new Set(page.map(b=>reasons[b.scaled?'scaled':b.oversized?'oversized':b.split?'split':'end']).filter(Boolean))];
      short.push({fill:Math.round(fill*100),why:flags.join('/')});
    }
  }
  if(short.length)console.info('[JustFun] short page',JSON.stringify(short));
}
function jfDeskPagedPrefetch(){
  if(!jfDeskFlow.length)return;
  const totalChapters=jfDeskOutline?.chapters.length||0;
  let maxN=-1;for(const item of jfDeskFlow)if(item.n>maxN)maxN=item.n;
  if(maxN>=0&&maxN<totalChapters-1)jfDeskFlowAppend(maxN+1).catch(()=>{});
}
function jfDeskPageTurn(delta){
  if(!jfDeskPaged||jfReader.hidden)return false;
  jfDeskLastPageTurn=Date.now();
  const geo=jfDeskPagedGeometry();
  const step=(geo.two&&jfDeskPages.length>1)?2:1;
  // The index must stay aligned to the spread grid, otherwise the last spread can
  // start on an odd page and repeat the page already shown beside it.
  const aligned=Math.floor(jfDeskPageIndex/step)*step;
  if(aligned!==jfDeskPageIndex)jfDeskPageIndex=aligned;
  const lastAligned=Math.floor((jfDeskPages.length-1)/step)*step;
  const next=Math.max(0,Math.min(lastAligned,jfDeskPageIndex+delta*step));
  if(next===jfDeskPageIndex){
    if(delta>=0||jfDeskBackfillBusy||!jfDeskFlow.length)return false;
    // Restored EPUB sessions mount the current chapter and following chapters.
    // At index 0 this is *not* necessarily the start of the book. Fetch the
    // nearest preceding readable chapter instead of trapping the reader.
    let n=Math.min(...jfDeskFlow.map(x=>x.n))-1;
    while(n>=0&&jfDeskPaperOmittedChapter(n))n--;
    if(n<0)return false;
    const bookId=jfDeskBook?.id,session=jfDeskSession;
    const visible=jfDeskPages[jfDeskPageIndex];
    jfDeskBackfillBusy=true;
    jfDeskFlowPrepend(n).then(added=>{
      if(!added||!jfDeskPaged||jfDeskSession!==session||jfDeskBook?.id!==bookId)return;
      const at=jfDeskPages.indexOf(visible);
      if(at<0)return;
      const currentStep=(jfDeskPagedGeometry().two&&jfDeskPages.length>1)?2:1;
      // If the original first page became the RIGHT leaf of its spread, the
      // preceding leaf is now visible automatically. Otherwise advance to the
      // immediately preceding spread (never skip a spread on odd chapter ends).
      if(at%currentStep===0&&jfDeskPageIndex>=currentStep){
        jfDeskPageIndex-=currentStep;
        jfDeskPagedRender('prev');
      }
    }).catch(error=>jfDeskMessage('上一章节加载失败：'+(error.message||error),true))
      .finally(()=>{jfDeskBackfillBusy=false;});
    return true;
  }
  jfDeskPageIndex=next;
  jfDeskPagedRender(delta>0?'next':'prev');
  if(jfDeskPageIndex>=lastAligned-2)jfDeskPagedPrefetch();
  return true;
}
async function jfDeskPagedToggle(){
  jfDeskPaged=!jfDeskPaged;
  jfReader.classList.toggle('paged',jfDeskPaged);
  jfReader.classList.toggle('paper',jfDeskPaged||jfDeskPrefs.theme==='paper');
  const btn=document.getElementById('jfReadPaged');
  if(btn){btn.setAttribute('aria-pressed',String(jfDeskPaged));btn.classList.toggle('active',jfDeskPaged);}
  if(jfDeskPaged){
    jfDeskPagedPrevTheme=jfDeskPrefs.theme;
    await jfDeskSetPref({theme:'paper'});
  }else{
    jfReadText.style.removeProperty('--jf-page-w');
    jfReadText.style.removeProperty('--jf-page-gap');
    await jfDeskSetPref({theme:jfDeskPagedPrevTheme||'dark'});
  }
  await jfDeskShowChapter(Math.max(0,jfDeskChapter),0);
  if(jfDeskPaged)jfDeskPagedLayout(false);
  jfDeskMessage(jfDeskPaged?'纸书翻页：← → 或点击页面左右两侧':'已返回连续滚动');
}

document.getElementById('jfReadTheme').addEventListener('click',()=>jfDeskSetPref({theme:jfDeskPrefs.theme==='paper'?'dark':'paper'}));
document.getElementById('jfReadPaged').addEventListener('click',jfDeskPagedToggle);
document.getElementById('jfReadImmersive').addEventListener('click',jfDeskImmersiveToggle);
// ---- v7.32 immersive reading ------------------------------------------------
// Hides the header/footer chrome; scrolling down keeps it hidden, scrolling up
// (or hovering the top strip) brings it back, matching the PDF reader habit.
let jfDeskImmersive=false,jfDeskImmersiveLast=0;
async function jfDeskImmersiveToggle(){
  jfDeskImmersive=!jfDeskImmersive;
  const btn=document.getElementById('jfReadImmersive');
  if(btn){btn.setAttribute('aria-pressed',String(jfDeskImmersive));btn.classList.toggle('active',jfDeskImmersive);}
  jfReader.classList.toggle('immersive-hidden',jfDeskImmersive);
  jfDeskImmersiveLast=jfReadCenter.scrollTop;
  jfDeskMessage(jfDeskImmersive?'沉浸阅读：向下滚动隐藏页眉页脚，向上滚动恢复':'已退出沉浸阅读');
  // The text box changes height, so pages must be re-measured behind the busy layer.
  await jfDeskPagedRelayoutWithBusy('immersive');
}
function jfDeskImmersiveOnScroll(){
  if(!jfDeskImmersive||jfReader.hidden)return;
  const top=jfReadCenter.scrollTop;
  if(top>jfDeskImmersiveLast+6)jfReader.classList.add('immersive-hidden');
  else if(top<jfDeskImmersiveLast-6)jfReader.classList.remove('immersive-hidden');
  jfDeskImmersiveLast=top;
}

document.getElementById('jfReadNotes').addEventListener('click',jfDeskOpenNotes);
document.getElementById('jfReadMask').addEventListener('click',jfReadToggleMask);
document.getElementById('jfReadExcerpt').addEventListener('click',jfDeskExcerpt);
let jfDeskFlowScrollAt=0;
jfReadCenter.addEventListener('scroll',()=>{if(jfReader.hidden)return;
  jfDeskImmersiveOnScroll();
  if(jfDeskOutline?.nativePdf){jfPdfJsOnScroll();return;}
  if(jfDeskPaged){jfDeskUpdateProgress();return;}
  jfDeskUpdateProgress();
  const now=Date.now();
  if(now-jfDeskFlowScrollAt>150){jfDeskFlowScrollAt=now;jfDeskFlowOnScroll();}},{passive:true});
// In paged mode a click on the left/right half turns the page, unless the user
// was selecting text or hit an interactive element.
jfReadCenter.addEventListener('click',event=>{
  if(!jfDeskPaged||jfReader.hidden||jfDeskOutline?.nativePdf)return;
  if((window.getSelection()?.toString()||'').trim())return;
  if(event.target.closest('a,button,input,select,textarea,label'))return;
  const rect=jfReadCenter.getBoundingClientRect();
  jfDeskPageTurn(event.clientX<rect.left+rect.width/2?-1:1);
});
window.addEventListener('resize',()=>{if(jfDeskPaged&&!jfReader.hidden)jfDeskPagedRelayoutWithBusy('resize');});
document.addEventListener('keydown',event=>{
  if(!jfReader.hidden && jfNotesPanel.hidden && !event.altKey && !event.ctrlKey && !event.metaKey &&
    !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName) &&
    !document.activeElement?.isContentEditable){
    const key=event.key;
    if(jfDeskPaged && (key==='ArrowRight'||key==='ArrowLeft'||key==='PageDown'||key==='PageUp')){
      jfDeskPageTurn(key==='ArrowLeft'||key==='PageUp'?-1:1);
      event.preventDefault();event.stopImmediatePropagation();return;
    }
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
