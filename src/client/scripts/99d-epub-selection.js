/*
 * Just Fun v7.130 · EPUB source-mapped annotations.
 * Reader pages own source offsets; annotation is a view over those immutable
 * coordinates. No DOM mutation, source guessing, or layout work during drag.
 */
(function(){
'use strict';
const reader=document.getElementById('jfReader');
const center=document.getElementById('jfReadCenter');
if(!reader||!center)return;
const colors=['blue','mint','amber','rose','violet'];
const colorNames={amber:'茶褐',blue:'青蓝',mint:'草绿',rose:'淡红',violet:'灰紫'};
const menu=document.createElement('div');
menu.id='jfEpubSelectionMenu';
menu.className='jfEpubSelectionMenu';
menu.setAttribute('role','toolbar');
menu.setAttribute('aria-label','选中文字操作');
menu.hidden=true;
for(const [action,label] of [['copy','复制'],['mark','标记'],['note','加入笔记']]){
  const button=document.createElement('button');
  button.type='button';button.dataset.action=action;button.textContent=label;
  menu.append(button);
}
const palette=document.createElement('span');
palette.className='jfEpubColorPalette';
palette.setAttribute('role','group');
palette.setAttribute('aria-label','划线颜色');
for(const color of ['amber','blue','mint','rose','violet']){
  const button=document.createElement('button');
  button.type='button';button.dataset.color=color;
  button.title=colorNames[color]+'划线';
  button.setAttribute('aria-label',colorNames[color]+'划线');
  button.setAttribute('aria-pressed','false');
  palette.append(button);
}
menu.insertBefore(palette,menu.querySelector('[data-action=note]'));
reader.append(menu);
const key=color=>'jf-epub-mark-'+color;
const transient='jf-epub-selection';
let active=null,dragging=false,moved=false,pointerAt=null,dragEnded=0;
let dismissOnClick=false;
// Only a held text drag in the outer upper corner enters the cross-page path.
const EDGE_DWELL_MS=720;
let edgeTimer=0,edgeDirection=0,virtual=null,virtualFrame=0,lastDragPoint=null;
let dragSeed=null,edgeLocked=false,dragOriginInText=false;
let settleTimer=0,settleFrame=0,paintFrame=0,observerFrame=0;
let blockCache=null,sourceCache=new WeakMap(),resolvedLegacy=new WeakMap();
let viewGeneration=0,paintedMarks=[],lastPaintKey=null;
const metrics={selectEvents:0,dragEvents:0,settles:0,
  maps:0,redraws:0,skipped:0,paintMs:0,lastReasons:{},lastVisible:0};
const supported=()=>!!globalThis.CSS?.highlights&&typeof Highlight==='function';
const canRead=()=>!reader.hidden&&!!jfDeskBook&&!jfDeskOutline?.nativePdf;
const ready=()=>canRead()&&!jfDeskRestoring;
const current=()=>window.getSelection();
const selecting=()=>{const s=current();return !!s&&!s.isCollapsed;};
function stopEdge(){
  if(edgeTimer)clearTimeout(edgeTimer);
  edgeTimer=0;edgeDirection=0;
}
function stopVirtual(){
  stopEdge();
  if(virtualFrame)cancelAnimationFrame(virtualFrame);
  virtualFrame=0;virtual=null;lastDragPoint=null;
  dragSeed=null;edgeLocked=false;dragOriginInText=false;
}
const cancelTimer=()=>{
  if(settleTimer)clearTimeout(settleTimer);settleTimer=0;
  if(settleFrame)cancelAnimationFrame(settleFrame);settleFrame=0;
};
function sourceFor(chapter){
  const section=jfDeskFlow.find(s=>s.n===chapter)?.el;
  if(!section)return null;
  let text=sourceCache.get(section);
  if(text===undefined){text=section.textContent;sourceCache.set(section,text);}
  return text;
}
function clearTransient(){
  if(supported())CSS.highlights.delete(transient);
}
function clearPaint(){
  if(supported())for(const c of colors)CSS.highlights.delete(key(c));
  paintedMarks=[];lastPaintKey=null;
}
function invalidate(){
  blockCache=null;lastPaintKey=null;
  viewGeneration++;
}
function blocks(){
  if(blockCache)return blockCache;
  const result=[];
  if(jfDeskPaged){
    const two=jfDeskPagedGeometry().two;
    for(const [sheet,page] of [
      [document.getElementById('jfSheetLeft'),jfDeskPages[jfDeskPageIndex]||[]],
      [document.getElementById('jfSheetRight'),two?jfDeskPages[jfDeskPageIndex+1]||[]:[]]
    ]){
      if(!sheet)continue;
      for(let i=0;i<page.length;i++){
        const item=page[i],el=sheet.children[i];
        if(!el||item.comic||!Number.isSafeInteger(item.chapter))continue;
        const source=sourceFor(item.chapter);
        let offset=Number.isSafeInteger(item.sourceOffset)?item.sourceOffset:null;
        // Older page objects never carry explicit source coordinates. Use
        // their nominal offset ONLY when the original text matches exactly.
        if(offset===null&&Number.isSafeInteger(item.offset)&&
           source?.slice(item.offset,item.offset+el.textContent.length)===el.textContent)
          offset=item.offset;
        if(offset===null||source?.slice(offset,offset+el.textContent.length)!==el.textContent)
          continue;
        result.push({el,chapter:item.chapter,offset,len:el.textContent.length,
          text:el.textContent});
      }
    }
  }else{
    const sections=jfReadText.querySelectorAll('.jfEpubChapter[data-chapter]');
    if(sections.length){
      for(const el of sections)result.push({
        el,chapter:Number(el.dataset.chapter),offset:0,len:el.textContent.length,
        text:el.textContent
      });
    }else if(jfReadText.firstChild){
      result.push({el:jfReadText,chapter:jfDeskChapter,offset:0,
        len:jfReadText.textContent.length,text:jfReadText.textContent});
    }
  }
  metrics.maps++;
  blockCache=result;
  return result;
}
function owner(node){
  const el=node?.nodeType===1?node:node?.parentElement;
  if(!el)return null;
  return blocks().find(b=>b.el.contains(node))||null;
}
function indexFor(block){
  if(block.index)return block.index;
  const starts=new WeakMap(),nodes=[];
  const walker=document.createTreeWalker(block.el,NodeFilter.SHOW_TEXT);
  let node,at=0;
  while((node=walker.nextNode())){
    const len=node.nodeValue.length;
    starts.set(node,at);
    nodes.push({node,start:at,end:at+len});
    at+=len;
  }
  block.index={starts,nodes};
  return block.index;
}
function position(node,at){
  const block=owner(node);
  if(!block)return null;
  // Most caret hits and drag endpoints are text nodes: look up the cached
  // source index instead of rebuilding a DOM Range over the whole paragraph.
  if(node.nodeType===3){
    const start=indexFor(block).starts.get(node);
    if(start!==undefined){
      const offset=block.offset+start+at;
      return offset>=block.offset&&offset<=block.offset+block.len?
        {chapter:block.chapter,offset}:null;
    }
  }
  // Element boundary endpoints are uncommon; preserve their exact behavior.
  try{
    const prefix=document.createRange();
    prefix.selectNodeContents(block.el);
    prefix.setEnd(node,at);
    const offset=block.offset+prefix.toString().length;
    if(offset<block.offset||offset>block.offset+block.len)return null;
    return {chapter:block.chapter,offset};
  }catch{return null;}
}
function rangesFor(chapter,start,end){
  if(end<=start)return [];
  const source=sourceFor(chapter);
  if(typeof source!=='string')return [];
  const output=[];
  for(const block of blocks()){
    if(block.chapter!==chapter||block.offset>=end||
       block.offset+block.len<=start)continue;
    const from=Math.max(start,block.offset),to=Math.min(end,block.offset+block.len);
    const localStart=from-block.offset,localEnd=to-block.offset;
    if(block.text.slice(localStart,localEnd)!==source.slice(from,to))
      continue;
    // The visible leaf's text node index is built at most once per render.
    const {nodes}=indexFor(block);
    let lo=0,hi=nodes.length;
    while(lo<hi){
      const mid=(lo+hi)>>>1;
      if(nodes[mid].end<=localStart)lo=mid+1;else hi=mid;
    }
    const a=nodes[lo];
    let last=lo;
    while(last<nodes.length&&nodes[last].end<localEnd)last++;
    const z=nodes[last];
    if(!a||!z)continue;
    const range=document.createRange();
    try{
      range.setStart(a.node,localStart-a.start);
      range.setEnd(z.node,localEnd-z.start);
      if(range.toString()===source.slice(from,to))output.push(range);
    }catch{}
  }
  return output;
}
function virtualReference(){
  if(!virtual||!ready()||virtual.bookId!==jfDeskBook?.id||
     virtual.session!==jfDeskSession)return null;
  const source=sourceFor(virtual.chapter);
  if(typeof source!=='string')return null;
  const start=Math.min(virtual.anchor,virtual.focus);
  const end=Math.max(virtual.anchor,virtual.focus);
  if(end<=start||end-start>5000)return null;
  const span=source.slice(start,end),text=span.trim();
  if(!text)return null;
  const leading=span.length-span.trimStart().length;
  const point=virtual.lastRect||(lastDragPoint?{
    left:lastDragPoint.x,top:lastDragPoint.y,bottom:lastDragPoint.y,
    width:0,height:0}:null);
  return {ref:{bookId:virtual.bookId,chapter:virtual.chapter,
      anchorStart:start+leading,text},
    quoteText:text,rects:point?[point]:[],
    session:virtual.session};
}
function reference(){
  if(!ready())return null;
  if(virtual)return virtualReference();
  const sel=current();
  if(!sel||sel.isCollapsed||sel.rangeCount!==1)return null;
  const range=sel.getRangeAt(0);
  const a=position(range.startContainer,range.startOffset);
  const z=position(range.endContainer,range.endOffset);
  if(!a||!z||a.chapter!==z.chapter||z.offset<=a.offset)return null;
  const source=sourceFor(a.chapter);
  if(typeof source!=='string')return null;
  const span=source.slice(a.offset,z.offset);
  const text=span.trim();
  if(!text||text.length>5000)return null;
  const start=a.offset+span.length-span.trimStart().length;
  if(source.slice(start,start+text.length)!==text)return null;
  // The browser may insert page headers/spine when a Range crosses leaves.
  // Canonical chapter text is the only valid durable selection value.
  const raw=range.toString().trim();
  const clean=s=>s.replace(/[\s\u00a0\u200b]+/g,'');
  const quoteText=clean(raw)===clean(text)?raw:text;
  // Measure only two endpoint glyphs, never the entire spread.
  const first=document.createRange(),last=document.createRange();
  const len=node=>node.nodeType===3?node.nodeValue.length:node.childNodes.length;
  first.setStart(range.startContainer,range.startOffset);
  first.setEnd(range.startContainer,Math.min(len(range.startContainer),range.startOffset+1));
  last.setStart(range.endContainer,Math.max(0,range.endOffset-1));
  last.setEnd(range.endContainer,range.endOffset);
  const rects=[first.getBoundingClientRect(),last.getBoundingClientRect()]
    .filter(r=>r.width>0&&r.height>0);
  return {ref:{bookId:jfDeskBook.id,chapter:a.chapter,anchorStart:start,text},
    quoteText,rects,session:jfDeskSession};
}
function savedFor(ref){
  return (jfDeskWorkspace?.marks||[]).find(m=>
    m.type==='text'&&m.bookId===ref.bookId&&m.chapter===ref.chapter&&
    m.anchorStart===ref.anchorStart&&m.text===ref.text)||null;
}
function markOffset(mark){
  const source=sourceFor(mark.chapter);
  if(!source||!mark.text||!Number.isSafeInteger(mark.anchorStart))return null;
  if(source.slice(mark.anchorStart,mark.anchorStart+mark.text.length)===mark.text)
    return mark.anchorStart;
  if(resolvedLegacy.has(mark))return resolvedLegacy.get(mark);
  // Legacy v7.129 wrong anchors are accepted only if the entire excerpt
  // appears exactly once in the original chapter; never guess duplicates.
  const at=source.indexOf(mark.text);
  const resolved=at>=0&&source.indexOf(mark.text,at+1)<0?at:null;
  resolvedLegacy.set(mark,resolved);
  return resolved;
}
function paint(){
  paintFrame=0;
  if(!ready()||!supported()||selecting())return;
  const now=performance.now();
  const present=blocks();
  const chapters=new Set(present.map(b=>b.chapter));
  const marks=(jfDeskWorkspace?.marks||[]).filter(m=>
    m.type==='text'&&m.bookId===jfDeskBook.id&&chapters.has(m.chapter));
  const sig=viewGeneration+'|'+jfDeskBook.id+'|'+marks.map(m=>
    m.chapter+':'+m.anchorStart+':'+m.text+':'+(m.color||'blue')).join('\x1f');
  if(sig===lastPaintKey)return;
  const output=new Map(colors.map(c=>[c,[]]));
  const visible=[];
  const reasons={};
  for(const mark of marks){
    const from=markOffset(mark);
    if(from===null){
      reasons.unresolved=(reasons.unresolved||0)+1;continue;
    }
    const spans=rangesFor(mark.chapter,from,from+mark.text.length);
    if(!spans.length){
      reasons.notVisible=(reasons.notVisible||0)+1;continue;
    }
    // The server stores blue as an omitted color field.
    const color=mark.color||'blue';
    const col=colors.includes(color)?color:'blue';
    output.get(col).push(...spans);
    visible.push({mark,from,to:from+mark.text.length});
  }
  // Compute the COMPLETE next state first. Replace each registry entry
  // atomically; never clear every mark before checking the next ranges.
  for(const col of colors){
    const ranges=output.get(col);
    if(ranges.length)CSS.highlights.set(key(col),new Highlight(...ranges));
    else CSS.highlights.delete(key(col));
  }
  paintedMarks=visible;lastPaintKey=sig;
  metrics.redraws++;metrics.skipped+=Object.values(reasons).reduce((a,b)=>a+b,0);
  metrics.lastReasons=reasons;metrics.lastVisible=visible.length;
  metrics.paintMs=performance.now()-now;
}
function schedulePaint(force=false){
  if(force)lastPaintKey=null;
  if(paintFrame)cancelAnimationFrame(paintFrame);
  paintFrame=requestAnimationFrame(paint);
}
function resetSelection(removeNative){
  cancelTimer();stopVirtual();dismissOnClick=false;
  active=null;menu.hidden=true;
  reader.classList.remove('jfEpubSelecting');
  clearTransient();
  if(removeNative)current()?.removeAllRanges();
  schedulePaint();
}
function placeMenu(snap,near=null){
  const mark=snap.savedMark||savedFor(snap.ref);
  menu.querySelector('[data-action=mark]').textContent=mark?'取消标记':'标记';
  for(const button of palette.querySelectorAll('[data-color]')){
    button.setAttribute('aria-pressed',String(
      (mark?(mark.color||'blue'):'amber')===button.dataset.color));
  }
  menu.hidden=false;
  const width=menu.offsetWidth||230,height=menu.offsetHeight||44;
  const rect=near||snap.rects?.[snap.rects.length-1];
  const first=snap.rects?.[0]||rect;
  if(!rect)return;
  const header=reader.querySelector('.jfReaderHeader')?.getBoundingClientRect().bottom||0;
  const x=Math.max(8,Math.min(innerWidth-width-8,rect.left+rect.width/2-width/2));
  const above=(first?.top??rect.top)-height-12;
  const y=above>=header+6?above:Math.min(innerHeight-height-8,rect.bottom+12);
  menu.style.left=x+'px';menu.style.top=Math.max(header+5,y)+'px';
}

/* Source-addressed cross-spread drag. Normal dragging never visits this code
 * until the user dwells in an outer upper corner with a nonempty Selection. */
function drawVirtual(){
  virtualFrame=0;
  if(!virtual||!ready()||!supported())return;
  const snap=virtualReference();
  if(!snap){clearTransient();return;}
  const spans=rangesFor(snap.ref.chapter,snap.ref.anchorStart,
    snap.ref.anchorStart+snap.ref.text.length);
  if(spans.length){
    const first=virtual.focus<virtual.anchor;
    const focusRange=first?spans[0]:spans[spans.length-1];
    const rects=focusRange.getClientRects();
    virtual.lastRect=rects.length?(first?rects[0]:rects[rects.length-1]):null;
    CSS.highlights.set(transient,new Highlight(...spans));
  }else{virtual.lastRect=null;clearTransient();}
}
function scheduleVirtual(){
  if(virtualFrame)cancelAnimationFrame(virtualFrame);
  virtualFrame=requestAnimationFrame(drawVirtual);
}
function cornerDirection(x,y){
  if(!ready()||!jfDeskPaged||!jfDeskPagedGeometry().two)return 0;
  const left=document.getElementById('jfSheetLeft')?.parentElement?.getBoundingClientRect();
  const right=document.getElementById('jfSheetRight')?.parentElement?.getBoundingClientRect();
  if(!left||!right)return 0;
  const nearTop=r=>Math.min(88,r.height*.14);
  const nearBottom=r=>Math.min(88,r.height*.14);
  const nearSide=r=>Math.min(94,r.width*.22);
  // Accept the narrow outer gutter past each sheet: a real drag can end
  // slightly outside the paper without its native Selection staying alive.
  if(x>=left.left-20&&x<=left.left+nearSide(left)&&
     y>=left.top-12&&y<=left.top+nearTop(left))return -1;
  // Forward: lower OUTER corner of the right leaf, never upper-right.
  if(x<=right.right+20&&x>=right.right-nearSide(right)&&
     y>=right.bottom-nearBottom(right)&&y<=right.bottom+12)return 1;
  return 0;
}
function adjacentSource(direction,chapter,anchor){
  const step=jfDeskPagedGeometry().two?2:1;
  const index=jfDeskPageIndex+direction*step;
  // Unprepared and chapter-crossing spreads are not auto-turned: never lose
  // a real native selection to a pending fetch or an unsupported text anchor.
  if(index<0||index>=jfDeskPages.length||
     !jfDeskSpreadReady(index,step))return null;
  const source=sourceFor(chapter);
  if(typeof source!=='string')return null;
  const items=(jfDeskPages[index]||[]).concat(step===2?
    jfDeskPages[index+1]||[]:[]);
  let low=Infinity,high=-Infinity;
  for(const item of items){
    if(item.chapter!==chapter||item.comic||
       !Number.isSafeInteger(item.sourceOffset)||!item.node)continue;
    const from=item.sourceOffset,to=from+item.node.textContent.length;
    if(source.slice(from,to)!==item.node.textContent)continue;
    low=Math.min(low,from);high=Math.max(high,to);
  }
  if(!Number.isFinite(low)||!Number.isFinite(high)||high<=low)return null;
  const limit=direction<0?low:high;
  if(Math.abs(limit-anchor)>5000||limit===anchor)return null;
  // Checking this boundary proves the neighbouring spread can be selected.
  // It is NOT the selection endpoint: flipping pages must not add any text.
  return {index};
}
function captureDragSeed(){
  // Remember only genuine text endpoints. Browser caret clamping in a wide
  // paper margin must never replace our last valid source selection.
  if(!dragging||virtual||!ready())return;
  if(moved&&lastDragPoint&&
     !textPointAt(lastDragPoint.x,lastDragPoint.y))return;
  const sel=current();
  if(!sel||sel.isCollapsed||sel.rangeCount!==1)return;
  const a=position(sel.anchorNode,sel.anchorOffset);
  const b=position(sel.focusNode,sel.focusOffset);
  if(!a||!b||a.chapter!==b.chapter||a.offset===b.offset||
     Math.abs(a.offset-b.offset)>5000)return;
  dragSeed={bookId:jfDeskBook.id,session:jfDeskSession,
    chapter:a.chapter,anchor:a.offset,focus:b.offset};
}
function edgeTurn(direction){
  edgeTimer=0;
  if(!dragging||!ready()||edgeDirection!==direction||!lastDragPoint||
     cornerDirection(lastDragPoint.x,lastDragPoint.y)!==direction)return;
  // Use the most recent native range; dragging into the outer gutter can
  // collapse the live browser selection before the dwell timer fires.
  captureDragSeed();
  let original=virtual;
  if(!original){
    const seed=dragSeed;
    if(!seed||seed.bookId!==jfDeskBook?.id||
       seed.session!==jfDeskSession)return;
    original={...seed,index:jfDeskPageIndex,lastRect:null,pending:null};
  }
  if(original.pending)return;
  const target=adjacentSource(direction,original.chapter,original.anchor);
  if(!target)return;
  // A second dwell on the newly shown spread must start a fresh timer.
  edgeDirection=0;
  virtual=original;virtual.pending=target;
  // The native Range points into the leaves that the paginator will replace.
  // Only clear it AFTER storing its exact source coordinates.
  current()?.removeAllRanges();
  reader.classList.add('jfEpubSelecting');
  menu.hidden=true;active=null;cancelTimer();
  if(!jfDeskPageTurn(direction)){
    virtual.pending=null;
    scheduleVirtual();
  }
}
function enterVirtual(){
  if(virtual||!dragSeed||dragSeed.bookId!==jfDeskBook?.id||
     dragSeed.session!==jfDeskSession)return;
  virtual={...dragSeed,index:jfDeskPageIndex,lastRect:null,pending:null};
  current()?.removeAllRanges();
  reader.classList.add('jfEpubSelecting');
  menu.hidden=true;active=null;cancelTimer();
  scheduleVirtual();
}
function armEdge(direction){
  if(!direction){
    stopEdge();
    // One dwell = one turn. Leaving the corner re-enables the next one.
    edgeLocked=false;
    return;
  }
  if(edgeLocked){stopEdge();return;}
  if(direction===edgeDirection)return;
  stopEdge();
  edgeDirection=direction;
  edgeTimer=setTimeout(()=>edgeTurn(direction),EDGE_DWELL_MS);
}
function extendVirtual(point){
  if(!virtual||virtual.pending||point.chapter!==virtual.chapter||
     Math.abs(point.offset-virtual.anchor)>5000||
     point.offset===virtual.focus)return;
  virtual.focus=point.offset;
  scheduleVirtual();
}
function settle(){
  settleFrame=0;
  if(dragging||!ready())return;
  metrics.settles++;
  if(virtual&&!virtual.lastRect)drawVirtual();
  const snap=reference();
  if(!snap){
    if(active?.savedMark&&!selecting())return;
    resetSelection(false);return;
  }
  active=snap;
  reader.classList.add('jfEpubSelecting');
  if(supported()){
    const ranges=rangesFor(snap.ref.chapter,snap.ref.anchorStart,
      snap.ref.anchorStart+snap.ref.text.length);
    if(ranges.length)CSS.highlights.set(transient,new Highlight(...ranges));
  }
  placeMenu(snap);
}
function scheduleSettle(delay=0){
  if(settleTimer)clearTimeout(settleTimer);settleTimer=0;
  if(settleFrame)cancelAnimationFrame(settleFrame);settleFrame=0;
  if(dragging)return;
  if(delay>0)settleTimer=setTimeout(()=>{
    settleTimer=0;settleFrame=requestAnimationFrame(settle);
  },delay);
  else settleFrame=requestAnimationFrame(settle);
}
async function applyColor(color){
  const snap=active;
  if(!colors.includes(color)||!snap||snap.ref.bookId!==jfDeskBook?.id||
     snap.session!==jfDeskSession)return;
  const saved=snap.savedMark||savedFor(snap.ref);
  resetSelection(true);
  if(saved&&(saved.color||'blue')===color)return;
  try{
    if(saved)await jfDeskMutate({action:'recolor-mark',mark:saved,color});
    else await jfDeskMutate({action:'mark',mark:{...snap.ref,type:'text',
      length:snap.ref.text.length,color}});
    jfDeskMessage(saved?'已更换划线颜色':'已标记原文');
  }catch(error){jfDeskMessage('划线保存失败：'+error.message,true);}
}
function legacyCopy(text){
  // Do not insert the fallback control into paginated book DOM.
  const field=document.createElement('textarea');
  field.value=text;field.readOnly=true;
  field.style.cssText='position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
  document.body.append(field);field.focus();field.select();
  let ok=false;
  try{ok=!!document.execCommand('copy');}catch{}
  field.remove();return ok;
}
async function copy(){
  const snap=active;
  if(!snap||snap.ref.bookId!==jfDeskBook?.id||snap.session!==jfDeskSession)return;
  const text=snap.quoteText||snap.ref.text;
  if(!text)return;
  try{
    let copied=false;
    if(navigator.clipboard?.writeText){
      try{await navigator.clipboard.writeText(text);copied=true;}catch{}
    }
    if(!copied)copied=legacyCopy(text);
    if(!copied)throw Error('浏览器未授权剪贴板写入');
    resetSelection(true);
    jfDeskMessage('已复制选中文字');
  }catch(error){jfDeskMessage('复制失败：'+error.message,true);}
}
async function mark(){
  const snap=active;
  if(!snap||snap.ref.bookId!==jfDeskBook?.id||snap.session!==jfDeskSession)return;
  const saved=snap.savedMark||savedFor(snap.ref);
  resetSelection(true);
  try{
    await jfDeskMutate(saved?{action:'delete-mark',mark:saved}:
      {action:'mark',mark:{...snap.ref,type:'text',
        length:snap.ref.text.length,color:'amber'}});
    jfDeskMessage(saved?'已取消标记':'已标记原文');
  }catch(error){jfDeskMessage('标记保存失败：'+error.message,true);}
}
function quote(){
  const snap=active;
  if(!snap||snap.ref.bookId!==jfDeskBook?.id||snap.session!==jfDeskSession)return false;
  resetSelection(true);
  jfDeskChooseQuote({...snap.ref,text:snap.quoteText||snap.ref.text,
    sourceText:snap.ref.text});
  return true;
}
function refresh(){schedulePaint(true);}
function pageRendered(){
  cancelTimer();
  if(virtual&&virtual.session===jfDeskSession&&
     virtual.bookId===jfDeskBook?.id&&jfDeskPaged){
    if(virtual.pending&&jfDeskPageIndex===virtual.pending.index){
      // Keep the exact selection endpoint unchanged when pages flip.
      virtual.index=jfDeskPageIndex;virtual.pending=null;
      edgeLocked=true;
      stopEdge();
    }
    current()?.removeAllRanges();
    invalidate();schedulePaint();scheduleVirtual();
    // Do NOT re-arm while the pointer is still at the same corner.
    // Otherwise a stationary mouse would repeatedly flip entire spreads.
    if(!dragging)scheduleSettle();
    return;
  }
  stopVirtual();
  active=null;menu.hidden=true;dragging=false;pointerAt=null;dismissOnClick=false;
  reader.classList.remove('jfEpubDragging','jfEpubSelecting');
  current()?.removeAllRanges();
  clearTransient();invalidate();schedulePaint();
}
function restoreReady(){invalidate();schedulePaint();}
function reset(){
  cancelTimer();
  if(paintFrame)cancelAnimationFrame(paintFrame);paintFrame=0;
  if(observerFrame)cancelAnimationFrame(observerFrame);observerFrame=0;
  stopVirtual();
  active=null;dragging=false;pointerAt=null;dismissOnClick=false;blockCache=null;
  sourceCache=new WeakMap();resolvedLegacy=new WeakMap();
  reader.classList.remove('jfEpubSelecting','jfEpubDragging');
  clearTransient();clearPaint();current()?.removeAllRanges();
}
for(const button of menu.querySelectorAll('button')){
  button.addEventListener('pointerdown',event=>event.preventDefault());
  button.addEventListener('click',()=>{
    if(button.dataset.color)void applyColor(button.dataset.color);
    else if(button.dataset.action==='copy')void copy();
    else if(button.dataset.action==='mark')void mark();
    else if(button.dataset.action==='note')quote();
  });
}
document.addEventListener('pointerdown',event=>{
  if(!ready()||!center.contains(event.target)||
     event.target.closest('button,a,input,textarea,select'))return;
  // Preserve whether this pointer-down began with an open selection. The
  // following click must dismiss it before the reader's page-turn handler.
  dismissOnClick=!!active||!menu.hidden||selecting();
  stopVirtual();
  dragging=true;moved=false;pointerAt={x:event.clientX,y:event.clientY};
  lastDragPoint={x:event.clientX,y:event.clientY};
  dragOriginInText=!!textPointAt(event.clientX,event.clientY);
  reader.classList.add('jfEpubDragging');
  menu.hidden=true;active=null;clearTransient();cancelTimer();
},{capture:true,passive:true});
document.addEventListener('pointermove',event=>{
  if(!dragging||!pointerAt)return;
  metrics.dragEvents++;lastDragPoint={x:event.clientX,y:event.clientY};
  if(Math.hypot(event.clientX-pointerAt.x,event.clientY-pointerAt.y)>6)
    moved=true;
  if(!moved||!jfDeskPaged)return;
  const direction=cornerDirection(event.clientX,event.clientY);
  const onText=!direction?textPointAt(event.clientX,event.clientY):null;
  if(virtual){
    if(event.cancelable)event.preventDefault();
    // No caret clamping: blank paper, margins and book shell leave the
    // logical selection unchanged. The original anchor always survives.
    if(onText)extendVirtual(onText);
    if(current()?.rangeCount)current().removeAllRanges();
    armEdge(direction);
  }else{
    if(onText&&selecting())captureDragSeed();
    // Once the pointer enters non-text paper, switch to a source-addressed
    // selection BEFORE the browser can pull the native range to the last word.
    if(!onText&&dragOriginInText&&dragSeed){
      enterVirtual();
      if(event.cancelable)event.preventDefault();
      armEdge(direction);
    }else if(direction&&(selecting()||dragSeed))armEdge(direction);
    else armEdge(0);
  }
},{passive:false});
function endPointer(event){
  if(!dragging)return;
  dragging=false;pointerAt=null;stopEdge();
  reader.classList.remove('jfEpubDragging');
  if(moved){dragEnded=Date.now();dismissOnClick=false;}
  if(virtual)scheduleSettle(0);
  else scheduleSettle(event.pointerType==='touch'?110:25);
}
document.addEventListener('pointerup',endPointer,{passive:true});
document.addEventListener('pointercancel',endPointer,{passive:true});
document.addEventListener('selectionchange',()=>{
  if(!canRead())return;
  metrics.selectEvents++;
  if(dragging){captureDragSeed();return;}
  if(virtual)return;
  if(!selecting()&&!active&&menu.hidden)return;
  scheduleSettle(120);
  if(!selecting())schedulePaint();
});
center.addEventListener('selectstart',event=>{
  if(virtual)event.preventDefault();
},true);
document.addEventListener('keyup',event=>{
  if(event.shiftKey&&canRead())scheduleSettle(20);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&(!menu.hidden||virtual)){
    event.preventDefault();event.stopImmediatePropagation();resetSelection(true);
  }
},true);
function caretAt(x,y){
  if(document.caretPositionFromPoint){
    const p=document.caretPositionFromPoint(x,y);
    if(p)return position(p.offsetNode,p.offset);
  }
  const p=document.caretRangeFromPoint?.(x,y);
  return p?position(p.startContainer,p.startOffset):null;
}
function textPointAt(x,y){
  // Do not consult the text-node index for pointer events over the header,
  // footer, book shell or outside the printed sheets at all.
  const target=document.elementFromPoint(x,y);
  if(!target?.closest?.('#jfSheetLeft,#jfSheetRight')&&
     !jfReadText.contains(target))return null;
  // caretRangeFromPoint snaps blank page areas to the closest character.
  // Validate one neighbouring glyph rectangle before accepting that caret
  // as an extension endpoint. There is no per-mark geometry scan here.
  let node=null,offset=-1;
  const p=document.caretPositionFromPoint?.(x,y);
  if(p){node=p.offsetNode;offset=p.offset;}
  else{
    const r=document.caretRangeFromPoint?.(x,y);
    if(r){node=r.startContainer;offset=r.startOffset;}
  }
  if(!node||node.nodeType!==Node.TEXT_NODE||!owner(node))return null;
  const len=node.nodeValue.length;
  if(!len)return null;
  const range=document.createRange();
  for(const at of [Math.min(offset,len-1),Math.max(0,offset-1)]){
    try{
      range.setStart(node,at);range.setEnd(node,at+1);
      for(const rect of range.getClientRects()){
        const dx=Math.max(0,rect.left-x,x-rect.right);
        const dy=Math.max(0,rect.top-y,y-rect.bottom);
        if(dx<=13&&dy<=9)return position(node,offset);
      }
    }catch{}
  }
  return null;
}
center.addEventListener('click',event=>{
  if(!ready())return;
  if(dismissOnClick){
    dismissOnClick=false;
    if(!moved){
      resetSelection(true);
      event.preventDefault();event.stopImmediatePropagation();
      return;
    }
  }
  if(virtual||selecting()||!paintedMarks.length)return;
  // One caret hit-test, not getClientRects() on every stored mark.
  const point=caretAt(event.clientX,event.clientY);
  if(!point)return;
  const hit=paintedMarks.find(m=>m.mark.chapter===point.chapter&&
    point.offset>=m.from-1&&point.offset<=m.to+1);
  if(!hit)return;
  const ref={...hit.mark,anchorStart:hit.from};
  active={ref,savedMark:hit.mark,session:jfDeskSession};
  placeMenu(active,{left:event.clientX,top:event.clientY,
    bottom:event.clientY,width:0});
  event.preventDefault();event.stopImmediatePropagation();
},true);
// A tap outside the page closes a stale toolbar without interfering with
// actual header/footer controls. Pointer actions on the toolbar are exempt.
document.addEventListener('pointerdown',event=>{
  if(!ready()||center.contains(event.target)||menu.contains(event.target))return;
  if(active||!menu.hidden||virtual)resetSelection(true);
},true);
window.addEventListener('resize',()=>{invalidate();schedulePaint(true);});
center.addEventListener('scroll',()=>{
  if(active&&!active.savedMark)resetSelection(true);
},{passive:true});
const observer=new MutationObserver(()=>{
  if(jfDeskPaged||reader.hidden||observerFrame)return;
  observerFrame=requestAnimationFrame(()=>{
    observerFrame=0;sourceCache=new WeakMap();invalidate();schedulePaint(true);
  });
});
observer.observe(jfReadText,{subtree:true,childList:true,characterData:true});
window.JFEpubSelection={
  reference,quote,refresh,reset,pageRendered,restoreReady,
  metrics,diagnostics:()=>({...metrics,book:jfDeskBook?.id,
    chapter:jfDeskChapter,page:jfDeskPageIndex,visibleBlocks:blocks().length,
    selected:selecting(),painted:paintedMarks.length,
    crossPage:!!virtual,edgeDirection,edgeLocked,
    anchor:virtual?.anchor,focus:virtual?.focus,dragSeed:!!dragSeed}),
  suppressTurn:()=>moved&&Date.now()-dragEnded<480
};
})();