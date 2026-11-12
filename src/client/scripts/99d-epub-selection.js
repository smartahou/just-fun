/*
 * Just Fun v7.129 · Selected passages live on the paper, not in a floating
 * blue browser rectangle.  This file operates only on visible reader clones:
 * never insert decoration into EPUB source, pagination blocks or cached faces.
 * Both notes and marks use the existing encrypted workspace transactions.
 */
(function(){
'use strict';
const reader=document.getElementById('jfReader');
const center=document.getElementById('jfReadCenter');
if(!reader||!center)return;
const overlay=document.createElement('div');
overlay.id='jfEpubSelectionOverlay';
overlay.setAttribute('aria-hidden','true');
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
reader.append(overlay,menu);
let active=null,raf=0,refreshFrame=0,refreshBusy=false;
const markKeys=['blue','mint','amber','rose','violet'];
const markKey=color=>'jf-epub-mark-'+color;
const eligible=()=>!reader.hidden&&!!jfDeskBook&&!jfDeskOutline?.nativePdf&&!jfDeskRestoring;
function rootFor(node){
  const el=node?.nodeType===1?node:node?.parentElement;
  if(!el)return null;
  if(jfDeskPaged){
    const body=el.closest?.('.jfSheetBody');
    if(!body||(body.id!=='jfSheetLeft'&&body.id!=='jfSheetRight'))return null;
    let block=el;
    if(block===body)return null;
    while(block.parentElement&&block.parentElement!==body)block=block.parentElement;
    if(block.parentElement!==body)return null;
    const index=Array.prototype.indexOf.call(body.children,block);
    const page=jfDeskPages[jfDeskPageIndex+(body.id==='jfSheetRight'?1:0)]||[];
    const item=page[index];
    if(!item||item.comic||!Number.isSafeInteger(item.offset))return null;
    return {chapter:item.chapter,scope:block,base:item.offset};
  }
  if(!jfReadText.contains(node))return null;
  const section=el.closest?.('[data-chapter]');
  const chapter=section?Number(section.dataset.chapter):jfDeskChapter;
  if(!Number.isSafeInteger(chapter))return null;
  return {chapter,scope:section||jfReadText,base:0};
}
function position(node,offset){
  const part=rootFor(node);
  if(!part)return null;
  try{
    const prefix=document.createRange();
    prefix.selectNodeContents(part.scope);prefix.setEnd(node,offset);
    return {chapter:part.chapter,at:part.base+prefix.toString().length};
  }catch{return null;}
}
function reference(){
  if(!eligible())return null;
  const selection=window.getSelection();
  if(!selection||selection.isCollapsed||selection.rangeCount!==1)return null;
  const range=selection.getRangeAt(0);
  const start=position(range.startContainer,range.startOffset);
  const end=position(range.endContainer,range.endOffset);
  if(!start||!end||start.chapter!==end.chapter||end.at<=start.at)return null;
  const raw=range.toString(),trimmed=raw.trim();
  if(!trimmed||trimmed.length>5000)return null;
  const leading=raw.length-raw.trimStart().length;
  let anchorStart=start.at+leading;
  const source=jfDeskPaged?
    jfDeskFlow.find(s=>s.n===start.chapter)?.el?.textContent:
    (jfDeskFlow.find(s=>s.n===start.chapter)?.el||jfReadText).textContent;
  if(typeof source==='string'){
    // Reflow and block splitting may add a visual line break. Resolve it only
    // when the quote occurs uniquely near the selected source offset.
    if(source.slice(anchorStart,anchorStart+trimmed.length)!==trimmed){
      const lo=Math.max(0,anchorStart-256),hi=Math.min(source.length,anchorStart+256+trimmed.length);
      const region=source.slice(lo,hi);
      const first=region.indexOf(trimmed);
      if(first<0||region.indexOf(trimmed,first+1)>=0)return null;
      anchorStart=lo+first;
    }
  }
  const rects=Array.from(range.getClientRects()).filter(r=>r.width>1&&r.height>1);
  if(!rects.length)return null;
  return {range:range.cloneRange(),rects,
    ref:{bookId:jfDeskBook.id,chapter:start.chapter,anchorStart,text:trimmed},
    session:jfDeskSession};
}
function clearSelection(removeNative=false){
  active=null;menu.hidden=true;overlay.replaceChildren();
  if(removeNative)window.getSelection()?.removeAllRanges();
}
function patches(rects){
  const lines=[];
  // Joining adjacent fragments on each line avoids a jagged stripe per span.
  for(const rect of rects.slice(0,100)){
    const x=Math.max(0,rect.left),y=Math.max(0,rect.top);
    const width=Math.min(innerWidth-x,rect.width),height=Math.min(innerHeight-y,rect.height);
    if(width<=1||height<=1)continue;
    const same=lines.find(p=>Math.abs(p.y-y)<3&&Math.abs(p.h-height)<4&&x<=p.x+p.w+5);
    if(same){const right=Math.max(same.x+same.w,x+width);same.x=Math.min(same.x,x);same.w=right-same.x;}
    else lines.push({x,y,w:width,h:height});
  }
  overlay.replaceChildren(...lines.map(p=>{
    const part=document.createElement('span');part.className='jfEpubSelectionPatch';
    part.style.left=p.x+'px';part.style.top=p.y+'px';
    part.style.width=p.w+'px';part.style.height=p.h+'px';
    return part;
  }));
}
function show(){
  raf=0;
  const snap=reference();
  if(!snap){clearSelection();return;}
  active=snap;
  patches(snap.rects);
  const box=snap.rects[snap.rects.length-1];
  menu.hidden=false;
  const same=(jfDeskWorkspace?.marks||[]).find(m=>
    m.type==='text'&&m.bookId===snap.ref.bookId&&
    m.chapter===snap.ref.chapter&&m.anchorStart===snap.ref.anchorStart&&
    m.text===snap.ref.text);
  const markButton=menu.querySelector('[data-action=mark]');
  markButton.textContent=same?'取消标记':'标记';
  const width=menu.offsetWidth||240,height=menu.offsetHeight||46;
  const x=Math.min(innerWidth-width-10,Math.max(10,box.left+box.width/2-width/2));
  const below=box.bottom+11;
  const y=below+height+12<innerHeight?below:Math.max(8,snap.rects[0].top-height-12);
  menu.style.left=Math.max(8,x)+'px';menu.style.top=y+'px';
}
function schedule(){
  if(raf)cancelAnimationFrame(raf);
  raf=requestAnimationFrame(show);
}
function findTextRange(el,start,end){
  if(start<0||end<=start)return null;
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  let node,seen=0,a=null,b=null;
  while((node=walker.nextNode())){
    const len=node.nodeValue.length;
    if(!a&&start<seen+len)a={node,off:Math.max(0,start-seen)};
    if(a&&end<=seen+len){b={node,off:Math.max(0,end-seen)};break;}
    seen+=len;
  }
  if(!a||!b)return null;
  const r=document.createRange();
  try{r.setStart(a.node,a.off);r.setEnd(b.node,b.off);return r;}
  catch{return null;}
}
function scopes(){
  if(jfDeskPaged){
    const left=document.getElementById('jfSheetLeft');
    const right=document.getElementById('jfSheetRight');
    const output=[];
    for(const [body,page] of [
      [left,jfDeskPages[jfDeskPageIndex]||[]],
      [right,(jfDeskPagedGeometry().two?jfDeskPages[jfDeskPageIndex+1]:[])||[]]
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
  return sections.length?sections.map(el=>({el,chapter:Number(el.dataset.chapter),offset:0})):
    [{el:jfReadText,chapter:jfDeskChapter,offset:0}];
}
function refresh(){
  if(refreshBusy)return;
  refreshBusy=true;
  try{
    if(!globalThis.CSS?.highlights)return;
    for(const color of markKeys)CSS.highlights.delete(markKey(color));
    if(!eligible())return;
    const blocks=scopes(),marks=(jfDeskWorkspace?.marks||[]).filter(m=>
      m.type==='text'&&m.bookId===jfDeskBook.id&&
      Number.isSafeInteger(m.anchorStart)&&m.text);
    if(!blocks.length||!marks.length)return;
    const groups=new Map(markKeys.map(c=>[c,[]]));
    const visibleChapters=new Set(blocks.map(b=>b.chapter));
    for(const mark of marks){
      if(!visibleChapters.has(mark.chapter))continue;
      const from=mark.anchorStart,to=from+(mark.length||mark.text.length);
      for(const block of blocks){
        if(block.chapter!==mark.chapter)continue;
        const length=block.el.textContent.length,lo=Math.max(from,block.offset),
          hi=Math.min(to,block.offset+length);
        if(lo>=hi)continue;
        const range=findTextRange(block.el,lo-block.offset,hi-block.offset);
        if(range)groups.get(markKeys.includes(mark.color)?mark.color:'amber').push(range);
      }
    }
    for(const [color,ranges] of groups)
      if(ranges.length)CSS.highlights.set(markKey(color),new Highlight(...ranges));
  }finally{refreshBusy=false;}
}
async function mark(){
  const snap=active;if(!snap||snap.ref.bookId!==jfDeskBook?.id||snap.session!==jfDeskSession)return;
  clearSelection(true);
  const ref=snap.ref;
  const saved=(jfDeskWorkspace?.marks||[]).find(m=>
    m.type==='text'&&m.bookId===ref.bookId&&m.chapter===ref.chapter&&
    m.anchorStart===ref.anchorStart&&m.text===ref.text);
  try{
    await jfDeskMutate(saved?{action:'delete-mark',mark:saved}:
      {action:'mark',mark:{...ref,type:'text',length:ref.text.length,color:'amber'}});
    refresh();jfDeskMessage(saved?'已取消标记':'已标记原文');
  }catch(error){jfDeskMessage('标记保存失败：'+error.message,true);}
}
function quote(){
  const snap=active;if(!snap||snap.ref.bookId!==jfDeskBook?.id||snap.session!==jfDeskSession)return false;
  const ref=snap.ref;
  clearSelection(true);jfDeskChooseQuote(ref);return true;
}
function reset(){
  if(raf)cancelAnimationFrame(raf);raf=0;
  clearSelection(true);
  if(globalThis.CSS?.highlights)for(const color of markKeys)CSS.highlights.delete(markKey(color));
}
function pageRendered(){clearSelection(true);refresh();}
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
  if(!reader.hidden&&center.contains(e.target)&&!jfDeskOutline?.nativePdf)schedule();
},{passive:true});
document.addEventListener('touchend',e=>{
  if(!reader.hidden&&center.contains(e.target)&&!jfDeskOutline?.nativePdf)
    setTimeout(schedule,90);
},{passive:true});
document.addEventListener('keyup',e=>{
  if(e.shiftKey&&!reader.hidden&&!jfDeskOutline?.nativePdf)schedule();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!menu.hidden){
    e.preventDefault();e.stopImmediatePropagation();clearSelection(true);
  }
},true);
window.addEventListener('resize',()=>{if(active)schedule();});
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