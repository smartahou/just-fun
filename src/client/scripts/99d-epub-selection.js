/*
 * v7.129.4 · Fast native drag and exact two-leaf source selection.
 *
 * Selection endpoints are resolved to ORIGINAL chapter text positions, not
 * the browser's paragraph-separated Range.toString(). CSS Highlight ranges
 * are generated per printed block; no layout or source nodes are rewritten.
 */
(function(){
'use strict';
const reader=document.getElementById('jfReader');
const center=document.getElementById('jfReadCenter');
if(!reader||!center)return;
const menu=document.createElement('div');
menu.id='jfEpubSelectionMenu';
menu.className='jfEpubSelectionMenu';
menu.setAttribute('role','toolbar');
menu.setAttribute('aria-label','选中文字操作');
menu.hidden=true;
for(const [action,label] of [['cancel','取消'],['mark','标记'],['note','加入笔记']]){
  const button=document.createElement('button');
  button.type='button';button.dataset.action=action;button.textContent=label;
  menu.append(button);
}
reader.append(menu);
const markKeys=['blue','mint','amber','rose','violet'];
const markKey=color=>'jf-epub-mark-'+color;
const transientKey='jf-epub-selection';
let active=null,raf=0,refreshFrame=0,settleTimer=0,dragging=false;
let pointerStart=null,lastDragEnd=0,dragWasReal=false;
let sourceCache=new WeakMap(),offsetCache=new WeakMap();
const metrics={settles:0,selectionEvents:0,dragEvents:0,pointLookups:0};
const transientClear=()=>{
  if(globalThis.CSS?.highlights)CSS.highlights.delete(transientKey);
};
let painted=[]; // {mark,range}: same exact ranges as the visible highlights.
const eligible=()=>!reader.hidden&&!!jfDeskBook&&!jfDeskOutline?.nativePdf&&!jfDeskRestoring;
const selection=()=>window.getSelection();
const hasSelection=()=>!!selection()&&!selection().isCollapsed&&!!selection().toString().trim();
const sourceFor=chapter=>{
  const section=jfDeskFlow.find(s=>s.n===chapter)?.el;
  if(!section)return !jfDeskPaged&&chapter===jfDeskChapter?jfReadText.textContent:null;
  const cached=sourceCache.get(section);
  if(cached!==undefined)return cached;
  const text=section.textContent;
  sourceCache.set(section,text);
  return text;
};
function owner(node){
  const el=node?.nodeType===1?node:node?.parentElement;
  if(!el)return null;
  if(jfDeskPaged){
    const body=el.closest?.('.jfSheetBody');
    if(!body||(body.id!=='jfSheetLeft'&&body.id!=='jfSheetRight'))return null;
    let block=el;
    if(block===body)return null;
    while(block.parentElement&&block.parentElement!==body)block=block.parentElement;
    const slot=Array.prototype.indexOf.call(body.children,block);
    const page=jfDeskPages[jfDeskPageIndex+(body.id==='jfSheetRight'?1:0)]||[];
    const item=page[slot];
    if(!item||item.comic||!Number.isSafeInteger(item.offset))return null;
    return {el:block,chapter:item.chapter,offset:item.offset};
  }
  if(!jfReadText.contains(node))return null;
  const section=el.closest?.('[data-chapter]');
  const chapter=section?Number(section.dataset.chapter):jfDeskChapter;
  return Number.isSafeInteger(chapter)?
    {el:section||jfReadText,chapter,offset:0}:null;
}
// Exact source offset of a visible pagination block. The page-engine's
// nominal item.offset may precede text transformed by editorial wrappers.
// Verify it, then only accept a UNIQUE nearby match. Never guess.
function blockOffset(block){
  const cached=offsetCache.get(block.el);
  if(cached&&cached.chapter===block.chapter&&cached.hint===block.offset)
    return cached.value;
  metrics.pointLookups++;
  const source=sourceFor(block.chapter),text=block.el.textContent;
  const finish=value=>{
    offsetCache.set(block.el,{chapter:block.chapter,hint:block.offset,value});
    return value;
  };
  if(typeof source!=='string'||!text)return finish(null);
  if(source.slice(block.offset,block.offset+text.length)===text)
    return finish(block.offset);
  if(text.length<6)return finish(null);
  const lo=Math.max(0,block.offset-320),hi=Math.min(source.length,
    block.offset+text.length+320);
  const region=source.slice(lo,hi),first=region.indexOf(text);
  if(first>=0&&region.indexOf(text,first+1)<0)return finish(lo+first);
  // A far-off match must be UNIQUE chapter-wide. Never guess a repeated
  // sentence's source location when the paginator has split a paragraph.
  const found=source.indexOf(text);
  return finish(found>=0&&source.indexOf(text,found+1)<0?found:null);
}
function point(node,offset){
  const block=owner(node);if(!block)return null;
  const base=blockOffset(block);if(base===null)return null;
  try{
    const prefix=document.createRange();
    prefix.selectNodeContents(block.el);
    prefix.setEnd(node,offset);
    return {chapter:block.chapter,at:base+prefix.toString().length};
  }catch{return null;}
}
function reference(){
  if(!eligible())return null;
  const sel=selection();
  if(!sel||sel.isCollapsed||sel.rangeCount!==1)return null;
  const range=sel.getRangeAt(0);
  const start=point(range.startContainer,range.startOffset);
  const end=point(range.endContainer,range.endOffset);
  if(!start||!end||start.chapter!==end.chapter||end.at<=start.at)return null;
  const source=sourceFor(start.chapter);
  if(typeof source!=='string')return null;
  // Browser selection includes visual paragraph separators. The EPUB source
  // chapter has no such separators between <p> elements. Only source span
  // offsets are stable for durable marks and for rebuilding the same glyphs.
  const selectedSource=source.slice(start.at,end.at);
  const text=selectedSource.trim();
  if(!text||text.length>5000)return null;
  const anchorStart=start.at+selectedSource.length-selectedSource.trimStart().length;
  const anchorEnd=anchorStart+text.length;
  if(source.slice(anchorStart,anchorEnd)!==text)return null;
  const raw=range.toString().trim();
  // A DOM Range across the left/right paper leaves also traverses *reader
  // chrome* (per-page headings, invisible stack spans, the spine). Its
  // Range.toString() is NOT the book text. The independently verified start
  // and end source offsets are authoritative; never reject on raw mismatch.
  const normal=s=>s.replace(/[\s\u00a0\u200b]+/g,'');
  const quoteText=normal(raw)===normal(text)?raw:text;
  // Only the endpoints are needed for toolbar positioning; asking for
  // every ClientRect on the enclosing two-page Range causes forced reflow
  // across the entire spread and becomes visibly slow while selecting.
  const firstRange=document.createRange(),lastRange=document.createRange();
  firstRange.setStart(range.startContainer,range.startOffset);
  firstRange.setEnd(range.startContainer,Math.min(
    range.startContainer.nodeType===3?range.startContainer.nodeValue.length:
      range.startContainer.childNodes.length,range.startOffset+1));
  lastRange.setStart(range.endContainer,Math.max(0,range.endOffset-1));
  lastRange.setEnd(range.endContainer,range.endOffset);
  const rects=[firstRange.getBoundingClientRect(),lastRange.getBoundingClientRect()]
    .filter(r=>r.width>0&&r.height>0);
  if(!rects.length)return null;
  return {range:range.cloneRange(),rects,
    quoteText, // Keep authored breaks if safe; discard unrelated page chrome.
    ref:{bookId:jfDeskBook.id,chapter:start.chapter,anchorStart,text},
    session:jfDeskSession};
}
function removeHighlights(){
  painted=[];
  if(globalThis.CSS?.highlights){
    CSS.highlights.delete(transientKey);
    for(const color of markKeys)CSS.highlights.delete(markKey(color));
  }
}
function findSaved(ref){
  const matches=(jfDeskWorkspace?.marks||[]).filter(m=>
    m.type==='text'&&m.bookId===ref.bookId&&m.chapter===ref.chapter&&
    m.text===ref.text);
  const anchoredMark=matches.find(m=>m.anchorStart===ref.anchorStart);
  if(anchoredMark)return anchoredMark;
  // v7.129 may have saved the right quote at the wrong offset. Only offer
  // removal when this text occurs exactly ONCE in its original chapter.
  const source=sourceFor(ref.chapter);
  if(typeof source!=='string'||!ref.text||source.indexOf(ref.text)<0||
      source.indexOf(ref.text)!==source.lastIndexOf(ref.text))return null;
  return matches.length===1?matches[0]:null;
}
function clearSelection(removeNative=false){
  active=null;menu.hidden=true;
  if(removeNative)selection()?.removeAllRanges();
  refresh();
}
function show(){
  raf=0;
  if(dragging)return;
  metrics.settles++;
  if(!eligible()){active=null;menu.hidden=true;removeHighlights();return;}
  const snap=reference();
  if(!snap){
    // A tap on a saved underline opens its menu without a text selection.
    if(active?.savedMark&&!hasSelection())return;
    active=null;menu.hidden=true;
    if(!hasSelection())refresh();else removeHighlights();
    return;
  }
  active=snap;
  // Highlight only the real glyph spans, never the synthetic DOM between
  // adjacent <p> blocks or between two visible paper leaves.
  removeHighlights();
  if(globalThis.CSS?.highlights&&typeof Highlight!=='undefined'){
    const blocks=visibleBlocks();
    const ranges=rangesFor(snap.ref.chapter,snap.ref.anchorStart,
      snap.ref.anchorStart+snap.ref.text.length,blocks);
    if(ranges.length)
      CSS.highlights.set(transientKey,new Highlight(...ranges));
  }
  const same=findSaved(snap.ref);
  const btn=menu.querySelector('[data-action=mark]');
  btn.textContent=same?'取消标记':'标记';
  const first=snap.rects[0],last=snap.rects[snap.rects.length-1];
  menu.hidden=false;
  const width=menu.offsetWidth||230,height=menu.offsetHeight||44;
  const x=Math.max(8,Math.min(innerWidth-width-8,
    last.left+last.width/2-width/2));
  // Prefer above the selected passage: never bury its last line underneath
  // an opaque toolbar or block the next line's reading.
  const headerBottom=reader.querySelector('.jfReaderHeader')?.getBoundingClientRect().bottom||0;
  const above=first.top-height-12;
  const below=last.bottom+12;
  const y=above>=headerBottom+6?above:Math.min(innerHeight-height-8,below);
  menu.style.left=x+'px';
  menu.style.top=Math.max(headerBottom+5,y)+'px';
}
function schedule(delay=0){
  if(settleTimer){clearTimeout(settleTimer);settleTimer=0;}
  if(raf){cancelAnimationFrame(raf);raf=0;}
  if(dragging)return;
  if(delay>0){
    settleTimer=setTimeout(()=>{settleTimer=0;raf=requestAnimationFrame(show);},delay);
  }else raf=requestAnimationFrame(show);
}
function findRange(element,start,end){
  if(start<0||end<=start)return null;
  const w=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
  let node,at=0,head=null,tail=null;
  while((node=w.nextNode())){
    const count=node.nodeValue.length;
    if(!head&&start<at+count)head={node,off:start-at};
    if(head&&end<=at+count){tail={node,off:end-at};break;}
    at+=count;
  }
  if(!head||!tail)return null;
  const r=document.createRange();
  try{r.setStart(head.node,head.off);r.setEnd(tail.node,tail.off);return r;}
  catch{return null;}
}
function visibleBlocks(){
  if(jfDeskPaged){
    const output=[];
    for(const [body,page] of [
      [document.getElementById('jfSheetLeft'),jfDeskPages[jfDeskPageIndex]||[]],
      [document.getElementById('jfSheetRight'),
        (jfDeskPagedGeometry().two?jfDeskPages[jfDeskPageIndex+1]:[])||[]]
    ]){
      if(!body)continue;
      for(let i=0;i<page.length;i++){
        const item=page[i],el=body.children[i];
        if(!el||item.comic||!Number.isSafeInteger(item.offset))continue;
        output.push({el,chapter:item.chapter,offset:item.offset});
      }
    }
    return output;
  }
  const sections=[...jfReadText.querySelectorAll('.jfEpubChapter[data-chapter]')];
  return sections.length?
    sections.map(el=>({el,chapter:Number(el.dataset.chapter),offset:0})):
    [{el:jfReadText,chapter:jfDeskChapter,offset:0}];
}
// The highlight renderer consumes the same source coordinates as the note
// anchor. Each visible block gets its own exact range; no underline through
// paragraph margins, the spine, footer, or inactive prepared faces.
function rangesFor(chapter,from,to,blocks){
  const source=sourceFor(chapter);
  if(typeof source!=='string'||to<=from)return [];
  const ranges=[];
  for(const block of blocks){
    if(block.chapter!==chapter)continue;
    const offset=block.offsetVerified??blockOffset(block);
    if(offset===null)continue;
    const len=block.el.textContent.length;
    const a=Math.max(from,offset),b=Math.min(to,offset+len);
    if(a>=b)continue;
    const expected=source.slice(a,b);
    if(block.el.textContent.slice(a-offset,b-offset)!==expected)continue;
    const r=findRange(block.el,a-offset,b-offset);
    if(r?.toString()===expected)ranges.push(r);
  }
  return ranges;
}
function markAnchor(mark){
  const source=sourceFor(mark.chapter),text=mark.text;
  if(typeof source!=='string'||!text)return null;
  if(source.slice(mark.anchorStart,mark.anchorStart+text.length)===text)
    return mark.anchorStart;
  // Upgrade the *display* of old incorrect anchors non-destructively.
  const lo=Math.max(0,mark.anchorStart-512);
  const region=source.slice(lo,Math.min(source.length,
    mark.anchorStart+text.length+512));
  const first=region.indexOf(text);
  if(first<0||region.indexOf(text,first+1)>=0)return null;
  return lo+first;
}
function refresh(){
  removeHighlights();
  if(!eligible()||hasSelection()||!globalThis.CSS?.highlights)return;
  const blocks=visibleBlocks().map(block=>({
    ...block,offsetVerified:blockOffset(block)
  }));
  const groups=new Map(markKeys.map(color=>[color,[]]));
  const visibleChapters=new Set(blocks.map(b=>b.chapter));
  const marks=(jfDeskWorkspace?.marks||[]).filter(m=>
    m.type==='text'&&m.bookId===jfDeskBook.id&&
    Number.isSafeInteger(m.anchorStart)&&m.text&&visibleChapters.has(m.chapter));
  for(const mark of marks){
    const from=markAnchor(mark);
    if(from===null)continue;
    const ranges=rangesFor(mark.chapter,from,from+mark.text.length,blocks);
    const color=markKeys.includes(mark.color)?mark.color:'amber';
    groups.get(color).push(...ranges);
    for(const range of ranges)painted.push({mark,range});
  }
  for(const [color,ranges] of groups)
    if(ranges.length)CSS.highlights.set(markKey(color),new Highlight(...ranges));
}
async function mark(){
  const snap=active;
  if(!snap||snap.ref.bookId!==jfDeskBook?.id||snap.session!==jfDeskSession)return;
  const ref=snap.ref,saved=snap.savedMark||findSaved(ref);
  clearSelection(true);
  try{
    await jfDeskMutate(saved?{action:'delete-mark',mark:saved}:
      {action:'mark',mark:{...ref,type:'text',length:ref.text.length,color:'amber'}});
    refresh();
    jfDeskMessage(saved?'已取消标记':'已标记原文');
  }catch(error){jfDeskMessage('标记保存失败：'+error.message,true);refresh();}
}
function quote(){
  const snap=active;
  if(!snap||snap.ref.bookId!==jfDeskBook?.id||snap.session!==jfDeskSession)return false;
  const ref=snap.ref;
  clearSelection(true);
  // The displayed quote can preserve paragraph breaks while the associated
  // durable mark uses original chapter characters (no synthetic line breaks).
  jfDeskChooseQuote({...ref,text:snap.quoteText||ref.text,sourceText:ref.text});
  return true;
}
function reset(){
  if(raf)cancelAnimationFrame(raf);raf=0;
  if(settleTimer)clearTimeout(settleTimer);settleTimer=0;
  dragging=false;pointerStart=null;reader.classList.remove('jfEpubDragging');
  sourceCache=new WeakMap();offsetCache=new WeakMap();
  active=null;menu.hidden=true;
  removeHighlights();
  selection()?.removeAllRanges();
}
function pageRendered(){
  if(raf)cancelAnimationFrame(raf);raf=0;
  if(settleTimer)clearTimeout(settleTimer);settleTimer=0;
  active=null;menu.hidden=true;dragging=false;pointerStart=null;
  reader.classList.remove('jfEpubDragging');
  selection()?.removeAllRanges();refresh();
}
for(const button of menu.querySelectorAll('button')){
  button.addEventListener('pointerdown',e=>e.preventDefault());
  button.addEventListener('click',()=>{
    if(button.dataset.action==='cancel')clearSelection(true);
    else if(button.dataset.action==='mark')void mark();
    else quote();
  });
}
// Keep each mouse/touch movement native: selectionchange must not scan
// chapters, measure a Range, or rebuild CSS highlights on every frame.
document.addEventListener('pointerdown',e=>{
  if(!eligible()||!center.contains(e.target)||e.target.closest('button,a,input,textarea'))return;
  dragging=true;pointerStart={x:e.clientX,y:e.clientY};
  dragWasReal=false;reader.classList.add('jfEpubDragging');
  menu.hidden=true;active=null;transientClear();
  if(settleTimer)clearTimeout(settleTimer);settleTimer=0;
  if(raf)cancelAnimationFrame(raf);raf=0;
},{passive:true,capture:true});
document.addEventListener('pointermove',e=>{
  if(!dragging||!pointerStart)return;
  metrics.dragEvents++;
  if(Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>6)
    dragWasReal=true;
},{passive:true});
const finishPointer=e=>{
  if(!dragging)return;
  dragging=false;pointerStart=null;reader.classList.remove('jfEpubDragging');
  if(dragWasReal)lastDragEnd=Date.now();
  // Touch selection handles may settle one event after pointerup.
  schedule(e.pointerType==='touch'?110:25);
};
document.addEventListener('pointerup',finishPointer,{passive:true});
document.addEventListener('pointercancel',finishPointer,{passive:true});
document.addEventListener('selectionchange',()=>{
  if(reader.hidden||jfDeskOutline?.nativePdf)return;
  metrics.selectionEvents++;
  if(dragging)return;
  if(!hasSelection()&&!active&&menu.hidden)return;
  // Browser selection handles and Shift+Arrow may not emit pointerup.
  // Coalesce them; the usual mouse release settles almost immediately.
  schedule(Date.now()-lastDragEnd<80?45:130);
});
document.addEventListener('keyup',e=>{
  if(e.shiftKey&&!reader.hidden&&!jfDeskOutline?.nativePdf)schedule(35);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!menu.hidden){
    e.preventDefault();e.stopImmediatePropagation();clearSelection(true);
  }
},true);
center.addEventListener('click',event=>{
  if(!eligible()||hasSelection()||!painted.length)return;
  // A tap on saved ink opens its actual source selection. This capture
  // listener prevents the existing half-page click-to-turn from eating it.
  for(const hit of painted){
    const touched=Array.from(hit.range.getClientRects()).some(r=>
      event.clientX>=r.left-2&&event.clientX<=r.right+2&&
      event.clientY>=r.top-2&&event.clientY<=r.bottom+2);
    if(!touched)continue;
    // A multi-paragraph mark has several CSS ranges. Do not reselect just
    // one fragment and silently turn "取消标记" into a new short mark.
    const ref={...hit.mark,anchorStart:markAnchor(hit.mark)};
    active={ref,savedMark:hit.mark,session:jfDeskSession};
    menu.querySelector('[data-action=mark]').textContent='取消标记';
    menu.hidden=false;
    const headerBottom=reader.querySelector('.jfReaderHeader')?.getBoundingClientRect().bottom||0;
    const width=menu.offsetWidth||230,height=menu.offsetHeight||44;
    menu.style.left=Math.max(8,Math.min(innerWidth-width-8,event.clientX-width/2))+'px';
    menu.style.top=Math.max(headerBottom+5,Math.min(innerHeight-height-8,event.clientY-height-13))+'px';
    event.preventDefault();event.stopImmediatePropagation();
    break;
  }
},true);
window.addEventListener('resize',()=>{if(active)schedule();else refresh();});
center.addEventListener('scroll',()=>{
  if(active)clearSelection(true);
},{passive:true});
const sourceObserver=new MutationObserver(()=>{
  if(jfDeskPaged||refreshFrame||reader.hidden)return;
  refreshFrame=requestAnimationFrame(()=>{refreshFrame=0;refresh();});
});
sourceObserver.observe(jfReadText,{childList:true,subtree:true});
window.JFEpubSelection={
  quote,refresh,reset,pageRendered,reference,metrics,
  suppressTurn:()=>dragWasReal&&Date.now()-lastDragEnd<460
};
})();