/*
 * v7.129.2 · Underlined source-accurate annotations on EPUB paper.
 *
 * Temporary and saved marks share CSS Custom Highlight underlines; native
 * selected text has no background. Never change page-engine or source DOM.
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
let active=null,raf=0,refreshFrame=0;
let painted=[]; // {mark,range}: same exact ranges as the visible highlights.
const eligible=()=>!reader.hidden&&!!jfDeskBook&&!jfDeskOutline?.nativePdf&&!jfDeskRestoring;
const selection=()=>window.getSelection();
const hasSelection=()=>!!selection()&&!selection().isCollapsed&&!!selection().toString().trim();
const sourceFor=chapter=>{
  const section=jfDeskFlow.find(s=>s.n===chapter)?.el;
  return section?.textContent??(!jfDeskPaged&&chapter===jfDeskChapter?jfReadText.textContent:null);
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
  const source=sourceFor(block.chapter),text=block.el.textContent;
  if(typeof source!=='string'||!text)return null;
  if(source.slice(block.offset,block.offset+text.length)===text)return block.offset;
  if(text.length<6)return null;
  const lo=Math.max(0,block.offset-320),hi=Math.min(source.length,
    block.offset+text.length+320);
  const region=source.slice(lo,hi),first=region.indexOf(text);
  if(first<0||region.indexOf(text,first+1)>=0)return null;
  return lo+first;
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
// Verify a selected string against the chapter's immutable source before
// persisting. An ambiguous or altered quote is not a safe mark.
function anchored(text,chapter,estimate){
  const source=sourceFor(chapter);
  if(typeof source!=='string')return null;
  if(source.slice(estimate,estimate+text.length)===text)return estimate;
  const start=Math.max(0,estimate-512);
  const region=source.slice(start,Math.min(source.length,
    estimate+text.length+512));
  const first=region.indexOf(text);
  if(first<0||region.indexOf(text,first+1)>=0)return null;
  return start+first;
}
function reference(){
  if(!eligible())return null;
  const sel=selection();
  if(!sel||sel.isCollapsed||sel.rangeCount!==1)return null;
  const range=sel.getRangeAt(0);
  const start=point(range.startContainer,range.startOffset);
  const end=point(range.endContainer,range.endOffset);
  if(!start||!end||start.chapter!==end.chapter)return null;
  const raw=range.toString();
  const text=raw.trim();
  if(!text||text.length>5000)return null;
  const lead=raw.length-raw.trimStart().length;
  const tail=raw.length-raw.trimEnd().length;
  if(end.at-tail<start.at+lead)return null;
  const anchorStart=anchored(text,start.chapter,start.at+lead);
  if(anchorStart===null)return null;
  const rects=Array.from(range.getClientRects()).filter(r=>r.width>1&&r.height>1);
  if(!rects.length)return null;
  return {range:range.cloneRange(),rects,
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
  if(!eligible()){active=null;menu.hidden=true;removeHighlights();return;}
  const snap=reference();
  if(!snap){
    active=null;menu.hidden=true;
    if(!hasSelection())refresh();else removeHighlights();
    return;
  }
  active=snap;
  // Show one precise temporary underline, not a filled browser selection.
  // Keep the real browser Selection for keyboard and iPad drag handles.
  removeHighlights();
  if(globalThis.CSS?.highlights&&typeof Highlight!=='undefined')
    CSS.highlights.set(transientKey,new Highlight(snap.range.cloneRange()));
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
function schedule(){
  if(raf)cancelAnimationFrame(raf);
  raf=requestAnimationFrame(show);
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
  const blocks=visibleBlocks();
  const byChapter=new Map();
  for(const block of blocks){
    const offset=blockOffset(block);
    if(offset===null)continue;
    if(!byChapter.has(block.chapter))byChapter.set(block.chapter,[]);
    byChapter.get(block.chapter).push({...block,offset});
  }
  if(!byChapter.size)return;
  const groups=new Map(markKeys.map(color=>[color,[]]));
  const marks=(jfDeskWorkspace?.marks||[]).filter(m=>
    m.type==='text'&&m.bookId===jfDeskBook.id&&
    Number.isSafeInteger(m.anchorStart)&&m.text&&byChapter.has(m.chapter));
  for(const mark of marks){
    const from=markAnchor(mark);
    if(from===null)continue;
    const source=sourceFor(mark.chapter);
    const end=from+mark.text.length;
    for(const block of byChapter.get(mark.chapter)){
      const len=block.el.textContent.length;
      const a=Math.max(from,block.offset),b=Math.min(end,block.offset+len);
      if(b<=a)continue;
      const text=block.el.textContent.slice(a-block.offset,b-block.offset);
      // Do not paint a wrong sentence even if source offsets drift.
      if(text!==source.slice(a,b))continue;
      const range=findRange(block.el,a-block.offset,b-block.offset);
      if(!range||range.toString()!==text)continue;
      const color=markKeys.includes(mark.color)?mark.color:'amber';
      groups.get(color).push(range);
      painted.push({mark,range});
    }
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
  jfDeskChooseQuote(ref);
  return true;
}
function reset(){
  if(raf)cancelAnimationFrame(raf);raf=0;
  active=null;menu.hidden=true;
  removeHighlights();
  selection()?.removeAllRanges();
}
function pageRendered(){active=null;menu.hidden=true;selection()?.removeAllRanges();refresh();}
for(const button of menu.querySelectorAll('button')){
  button.addEventListener('pointerdown',e=>e.preventDefault());
  button.addEventListener('click',()=>{
    if(button.dataset.action==='cancel')clearSelection(true);
    else if(button.dataset.action==='mark')void mark();
    else quote();
  });
}
document.addEventListener('selectionchange',()=>{
  if(reader.hidden||jfDeskOutline?.nativePdf)return;
  schedule();
});
document.addEventListener('pointerup',e=>{
  if(!reader.hidden&&center.contains(e.target)&&!jfDeskOutline?.nativePdf)
    schedule();
},{passive:true});
document.addEventListener('touchend',e=>{
  if(!reader.hidden&&center.contains(e.target)&&!jfDeskOutline?.nativePdf)
    setTimeout(schedule,110);
},{passive:true});
document.addEventListener('keyup',e=>{
  if(e.shiftKey&&!reader.hidden&&!jfDeskOutline?.nativePdf)schedule();
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
    const r=hit.range.cloneRange(),sel=selection();
    sel?.removeAllRanges();sel?.addRange(r);
    const snap=reference();
    if(snap){snap.savedMark=hit.mark;active=snap;show();}
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
window.JFEpubSelection={quote,refresh,reset,pageRendered,reference};
})();