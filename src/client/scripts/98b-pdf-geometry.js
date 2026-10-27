// v7.06 · PDF selection geometry: UI-independent, page-local coordinate model.
// Inputs are CSS pixels (except normalized persisted areas in [0,1]).
// Retain v7.05 arithmetic exactly: even legacy clipping and edge semantics.
const jfPdfGeometry=(()=>{
function jfPdfCaptureClosestRow(rows,y){
  if(!rows.length)return 0;
  let best=0,distance=Infinity;
  for(let i=0;i<rows.length;i++){
    const r=rows[i],d=y<r.top?r.top-y:y>r.bottom?y-r.bottom:0;
    if(d<distance){best=i;distance=d;}
  }
  return best;
}
function jfPdfCaptureParagraphGroups(rows,first,last,area){
  const order=[];
  for(let i=first;i<=last;i++)if(rows[i])order.push(i);
  if(!order.length)return [];
  if(order.length===1)return [{start:order[0],end:order[0]}];
  const heights=order.map(i=>Math.max(1,rows[i].bottom-rows[i].top));
  const gaps=[];
  for(let k=1;k<order.length;k++)gaps.push(Math.max(0,rows[order[k]].top-rows[order[k-1]].bottom));
  const median=list=>{const sorted=[...list].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]||0;};
  const height=median(heights)||18,normalGap=median(gaps);
  const left=area.x,right=area.x+area.w;
  // Use the text's usual left margin, not the dragged rectangle's left edge;
  // paragraph indents are relative to other text lines.
  const textLeft=median(order.map(i=>rows[i].left).filter(v=>Number.isFinite(v)));
  const bodyWidth=Math.max(1,right-Math.min(right,textLeft||left));
  const groups=[];let groupStart=order[0];
  for(let k=1;k<order.length;k++){
    const prev=rows[order[k-1]],next=rows[order[k]];
    const gap=Math.max(0,next.top-prev.bottom);
    const prevWidth=Math.max(0,Math.min(right,prev.right??right)-Math.max(left,prev.left??left));
    const indent=(next.left??left)-(textLeft||left);
    // Actual paragraph spacing must noticeably exceed ordinary line spacing.
    const spaced=gap>Math.max(height*.72,normalGap*1.50+height*.12);
    // Short tail + a genuinely indented first line, even at the exact same
    // baseline spacing. Require a meaningful indent in character-height units
    // to avoid treating punctuation and antialiasing variation as paragraphing.
    const shortTail=prevWidth<bodyWidth*.62 && (prev.right??right)<right-height*.9;
    const firstLineIndent=indent>Math.max(height*.66,bodyWidth*.038);
    const paragraphStart=shortTail&&firstLineIndent;
    if(spaced||paragraphStart){groups.push({start:groupStart,end:order[k-1]});groupStart=order[k];}
  }
  groups.push({start:groupStart,end:order[order.length-1]});
  return groups;
}
function jfPdfCaptureStripPadding(row){
  const lineHeight=Math.max(1,(row.bottom||0)-(row.top||0));
  return {
    x:Math.max(8,Math.min(13,Math.round(lineHeight*.25))),
    y:Math.max(5,Math.min(9,Math.round(lineHeight*.16)))
  };
}
function jfPdfCaptureSegments(choice){
  const a=choice.area,rows=choice.rows,start=choice.start,end=choice.end;
  if(!rows.length)return [a];
  const first=Math.min(start.row,end.row),last=Math.max(start.row,end.row);
  if(last-first>39)throw Error('一次最多精修 40 行，请缩小选区');
  const left=a.x,right=a.x+a.w;
  const groups=jfPdfCaptureParagraphGroups(rows,first,last,a);
  const paragraphEdge=new Map();
  for(const group of groups){
    paragraphEdge.set(group.start,{first:true,last:group.start===group.end});
    if(group.end!==group.start)paragraphEdge.set(group.end,{first:false,last:true});
  }
  const strips=[];
  for(let i=first;i<=last;i++){
    const row=rows[i];if(!row)continue;
    const edge=paragraphEdge.get(i)||{first:false,last:false};
    const rowLeft=Number.isFinite(row.left)?Math.max(left,Math.min(right-2,row.left)):left;
    const detectedRight=Number.isFinite(row.softRight)?row.softRight:row.right;
    const rowRight=Number.isFinite(detectedRight)?Math.max(rowLeft+2,Math.min(right,detectedRight)):right;
    let l=left,r=right;
    const atSelectionStart=i===first,atSelectionEnd=i===last;
    const trimLeft=edge.first||atSelectionStart;
    const trimRight=edge.last||atSelectionEnd;
    if(trimLeft&&trimRight){
      const leftTarget=atSelectionStart?Math.max(rowLeft,Math.min(right-2,start.x)):rowLeft;
      l=leftTarget;
      const rightTarget=atSelectionEnd?Math.min(rowRight,Math.max(l+2,end.x)):rowRight;
      r=Math.max(l+2,rightTarget);
    }else if(trimLeft){
      l=atSelectionStart?Math.max(rowLeft,Math.min(right-2,start.x)):rowLeft;
      r=rowRight;
    }else if(trimRight){
      l=rowLeft;
      r=atSelectionEnd?Math.min(rowRight,Math.max(left+2,end.x)):rowRight;
      if(r-l<2)l=Math.max(left,r-2);
    }
    const pad=jfPdfCaptureStripPadding(row);
    // Apply to ALL four sides, including full-width middle rows. Clamping to
    // [left,right] (v6.73) silently nullified padding when a dragged edge
    // coincided with the text; clamp to the PDF page instead. These expanded
    // strips are shared by the blue preview, persisted mark and JPEG export.
    l=Math.max(0,l-pad.x);
    r=Math.min(choice.width,r+pad.x);
    const top=Math.max(0,row.top-pad.y),bottom=Math.min(choice.height,row.bottom+pad.y);
    if(r-l>=2&&bottom-top>=2)strips.push({x:l,y:top,w:r-l,h:bottom-top});
  }
  return strips.length?strips:[a];
}
function jfPdfCaptureNormalized(choice,w,h){
  const segments=choice.segments?.length?choice.segments:[choice.area];
  const left=Math.min(...segments.map(s=>s.x)),top=Math.min(...segments.map(s=>s.y));
  const right=Math.max(...segments.map(s=>s.x+s.w)),bottom=Math.max(...segments.map(s=>s.y+s.h));
  const normalized=s=>[s.x/w,s.y/h,s.w/w,s.h/h].map(v=>Math.max(0,Math.min(1,v)));
  return {segments,area:normalized({x:left,y:top,w:right-left,h:bottom-top}),shape:segments.map(normalized)};
}
  return Object.freeze({
    closestRow:jfPdfCaptureClosestRow,
    paragraphGroups:jfPdfCaptureParagraphGroups,
    stripPadding:jfPdfCaptureStripPadding,
    segments:jfPdfCaptureSegments,
    normalized:jfPdfCaptureNormalized
  });
})();
