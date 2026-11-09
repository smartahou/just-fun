// Just Fun page engine (v7.34)
// Measured pagination for the paper-book mode.
//
// Invariants:
//  * a page is filled with as much content as physically fits, including a
//    prefix of the next paragraph when at least MIN_LINES fit;
//  * splits are done with a real DOM Range and cloneContents(), so inline
//    markup, links and styles survive on both halves;
//  * orphan/widow limits are enforced by the algorithm, not by CSS;
//  * figures are atomic: caption stays with its image, and an oversized figure
//    is scaled down rather than cropped or split.
(function(){
  'use strict';

  var MIN_LINES=2;        // never leave fewer than two lines on either side
  var MAX_PROBE=48;       // binary-search budget per split
  var EPS=0.5;

  function textNodes(root){
    var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),out=[],n,acc=0;
    while((n=w.nextNode())){out.push({node:n,start:acc,len:n.nodeValue.length});acc+=n.nodeValue.length;}
    return {list:out,total:acc};
  }
  // Map a character offset to a DOM point, never splitting a surrogate pair.
  function pointAt(root,offset){
    var walk=textNodes(root);
    if(!walk.list.length)return null;
    for(var i=walk.list.length-1;i>=0;i--){
      var item=walk.list[i];
      if(offset>=item.start){
        var off=Math.min(item.len,offset-item.start);
        var value=item.node.nodeValue;
        if(off>0&&off<value.length){
          var code=value.charCodeAt(off-1);
          if(code>=0xD800&&code<=0xDBFF)off-=1; // high surrogate: step back
        }
        return {node:item.node,off:off};
      }
    }
    return {node:walk.list[0].node,off:0};
  }
  // Clone the [from,to) slice of a block, preserving its element wrapper and any
  // inline markup inside it. This is what makes the split "structural".
  function sliceBlock(el,from,to){
    var start=pointAt(el,from),end=pointAt(el,to);
    if(!start||!end)return null;
    var range=document.createRange();
    range.setStart(start.node,start.off);
    range.setEnd(end.node,end.off);
    var wrapper=el.cloneNode(false);
    wrapper.appendChild(range.cloneContents());
    return wrapper;
  }
  function measure(el,host){
    host.replaceChildren(el.cloneNode(true));
    var first=host.firstElementChild;
    if(!first)return 0;
    var cs=getComputedStyle(first);
    return first.getBoundingClientRect().height
      +(parseFloat(cs.marginTop)||0)+(parseFloat(cs.marginBottom)||0);
  }
  function lineHeight(host){
    var lh=parseFloat(getComputedStyle(host).lineHeight);
    if(!lh||!isFinite(lh))lh=parseFloat(getComputedStyle(host).fontSize)*1.8;
    return lh||24;
  }
  // Any block that carries an image is atomic. EPUB allows <p><img></p>,
  // <div><img></div> and bare <img>, not just <figure>; splitting such a block by
  // text offset would silently drop the image.
  function hasImage(el){
    // Inline character bitmaps are splittable text, while all ordinary photos
    // and mixed figure paragraphs remain atomic.
    if(el.tagName==='IMG')return !el.classList?.contains('jfInlineGlyph');
    if(!el.querySelector)return false;
    if(el.querySelector('picture,svg,object'))return true;
    var images=el.querySelectorAll('img');
    for(var i=0;i<images.length;i++)
      if(!images[i].classList.contains('jfInlineGlyph'))return true;
    return false;
  }
  function isFigure(el){
    return el.tagName==='FIGURE'||!!el.querySelector('figcaption')||hasImage(el);
  }
  // Scale a figure that cannot fit a whole page; never crop, never distort.
  function fitFigure(el,pageH,host){
    var probe=el.cloneNode(true);
    host.replaceChildren(probe);
    if(host.firstElementChild.getBoundingClientRect().height<=pageH)return el;
    var img=probe.querySelector('img');
    if(!img)return null;
    var caption=probe.querySelector('figcaption');
    var reserved=caption?caption.getBoundingClientRect().height+12:12;
    var room=Math.max(60,pageH-reserved);
    probe.querySelectorAll('img').forEach(function(node){
      node.style.maxHeight=room+'px';
      node.style.width='auto';
      node.style.height='auto';
      node.style.objectFit='contain';
    });
    probe.style.maxHeight=pageH+'px';
    host.replaceChildren(probe);
    return host.firstElementChild.getBoundingClientRect().height<=pageH+EPS?probe:null;
  }
  // Try to keep [0,offset) on the current page and push the rest forward.
  function trySplit(el,avail,host,lh,pageH){
    if(window.JF_DEBUG_SPLIT)console.info('[split] avail',Math.round(avail),'lh',Math.round(lh),'need',Math.round(lh*MIN_LINES),'tag',el.tagName,'len',el.textContent.length);
    // Never split a block that owns an image: the clone would lose it.
    if(hasImage(el))return null;
    // A note and its source must stay together when it fits one fresh leaf.
    // A genuinely oversized annotation may split with original DOM Range
    // offsets, while its continuation carries no duplicated source text.
    if(el.classList?.contains('jfPrintCommentaryNote')&&
       measure(el,host)<=pageH+EPS)return null;
    if(avail<lh*MIN_LINES)return null;
    var walk=textNodes(el);
    if(!walk.total)return null;
    var lo=1,hi=walk.total,best=0;
    for(var i=0;i<MAX_PROBE&&lo<=hi;i++){
      var mid=(lo+hi)>>1;
      var head=sliceBlock(el,0,mid);
      if(!head){hi=mid-1;continue;}
      if(measure(head,host)<=avail+EPS){best=mid;lo=mid+1;}else hi=mid-1;
    }
    // Never trust a split that does not reconstruct the source exactly: a lost
    // or duplicated character is worse than pushing the whole block to the next
    // page. Step back a character at a time before giving up.
    var sourceLength=el.textContent.length;
    var sourceImages=el.querySelectorAll?el.querySelectorAll('img').length:0;
    for(var attempt=0;attempt<4&&best>0;attempt++,best--){
      var headEl=sliceBlock(el,0,best);
      var tailEl=sliceBlock(el,best,walk.total);
      if(!headEl||!tailEl)continue;
      if(headEl.textContent.length+tailEl.textContent.length!==sourceLength)continue;
      // The DOM Range must preserve every inline glyph exactly once, even
      // when it spans a replaced image element at a text-node boundary.
      var imageCount=headEl.querySelectorAll('img').length+tailEl.querySelectorAll('img').length;
      if(imageCount!==sourceImages)continue;
      var headLines=measure(headEl,host)/lh;
      var tailLines=measure(tailEl,host)/lh;
      if(window.JF_DEBUG_SPLIT)console.info('[split] best',best,'headLines',headLines.toFixed(1),'tailLines',tailLines.toFixed(1));
      if(headLines<MIN_LINES||tailLines<MIN_LINES)return null;
      return {head:headEl,tail:tailEl,used:measure(headEl,host)};
    }
    return null;
  }

  // Greedy fill with bounded look-ahead: a heading is never left alone at the
  // bottom of a page, and a paragraph that does not fit is split instead of
  // being pushed wholesale to the next page.
  // Real height of the page as it would paint: margins collapse between
  // siblings, so summing single-block heights over-estimates and causes the last
  // line to be clipped. Measure the assembled column near the boundary only.
  function columnHeight(cur,host){
    var frag=document.createDocumentFragment();
    for(var i=0;i<cur.length;i++)frag.appendChild(cur[i].node.cloneNode(true));
    host.replaceChildren(frag);
    return host.scrollHeight;
  }


  // v7.112: Editorial headings and their first commentary must share a page.
  // EPUBs commonly use <p><b>【辑评】</b></p> rather than H2. The reader
  // tags that *specific* printed clone; the generic engine also respects H1-H6.
  function keepWithNext(el){
    return /^H[1-6]$/.test(el?.tagName||'') ||
      !!el?.classList?.contains('jfPrintKeepWithNext');
  }
  // v7.116 · A bibliographic note is *one flowing piece of prose*, not a
  // two-column table. Turn each verified source/commentary row in a PRINTED
  // clone into an inline source label + annotation paragraph. No whitespace is
  // inserted into textContent: source character offsets remain reconstructible.
  function commentaryTable(node){
    var table=node?.tagName==='TABLE'?node:
      node?.querySelector?.('table.jfPrintSourceCommentary');
    return table?.classList?.contains('jfPrintSourceCommentary')?table:null;
  }
  function commentaryNoteFragments(item){
    var node=item.node,table=commentaryTable(node);
    if(!table||!table.rows?.length||table.rows.length>30)return null;
    // Other EPUB content, captions, and wrappers must remain untouched.
    if(node!==table&&node.textContent!==table.textContent)return null;
    if(table.querySelector('caption,thead,th,figure,img:not(.jfInlineGlyph),picture,svg'))return null;
    var rows=Array.from(table.rows);
    if(rows.some(function(row){
      return row.cells.length!==2||Array.from(row.cells).some(function(cell){
        return cell.colSpan!==1||cell.rowSpan!==1;
      });
    }))return null;
    var original=node.textContent||'',offset=0,notes=[];
    // Pretty-printed XHTML commonly has indentation/newlines between <tr>
    // and <td>. Keep those *characters* in the printed clone for exact source
    // offsets, but don't paint them as phantom spaces between citation parts.
    function whitespaceOnly(str){return /^[\s\u00a0\u3000]*$/.test(str);}
    function invisibleSourceWhitespace(str){
      var gap=document.createElement('span');
      gap.className='jfPrintCommentarySourceWhitespace';
      gap.textContent=str;
      return gap;
    }
    for(var k=0;k<rows.length;k++){
      var row=rows[k],source=row.cells[0],body=row.cells[1],value=row.textContent;
      if(!source.textContent?.trim()||!body.textContent?.trim())return null;
      var rowAt=original.indexOf(value,offset);
      if(rowAt<0||!whitespaceOnly(original.slice(offset,rowAt)))return null;
      var left=source.textContent,right=body.textContent;
      var leftAt=value.indexOf(left),rightAt=value.indexOf(right,leftAt+left.length);
      if(leftAt<0||rightAt<0)return null;
      var pre=original.slice(offset,rowAt)+value.slice(0,leftAt);
      var between=value.slice(leftAt+left.length,rightAt);
      var post=value.slice(rightAt+right.length);
      if(!whitespaceOnly(pre)||!whitespaceOnly(between)||!whitespaceOnly(post))return null;
      var para=document.createElement('div');
      para.className='jfPrintCommentaryNote';
      var label=document.createElement('span');
      label.className='jfPrintCommentarySource';
      for(var child of Array.from(source.childNodes))label.appendChild(child.cloneNode(true));
      var comment=document.createElement('span');
      comment.className='jfPrintCommentaryText';
      for(var part of Array.from(body.childNodes))comment.appendChild(part.cloneNode(true));
      // All original whitespace is retained in textContent (and offset math)
      // but hidden from paint. Only CSS supplies the visible editorial gap.
      para.append(invisibleSourceWhitespace(pre),label,
        invisibleSourceWhitespace(between),comment,
        invisibleSourceWhitespace(post));
      var stop=rowAt+value.length;
      if(para.textContent!==original.slice(offset,stop))return null;
      notes.push({
        chapter:item.chapter,node:para,
        key:(item.key||'commentary')+'#note'+k,
        offset:(item.offset||0)+offset,sourceRow:true
      });
      offset=stop;
    }
    var trailing=original.slice(offset);
    if(!whitespaceOnly(trailing))return null;
    if(trailing)notes[notes.length-1].node.appendChild(invisibleSourceWhitespace(trailing));
    return notes.map(function(n){return n.node.textContent;}).join('')===original?notes:null;
  }

  function paginate(blocks,pageH,host){
    var lh=lineHeight(host);
    var pages=[],cur=[],used=0;
    var queue=[];
    // Expand annotated tables into sequential prose notes BEFORE page fitting.
    // Both one-row and multirow editorial tables follow the same path; other
    // EPUB tables retain the original pagination behavior.
    for(var sourceItem of blocks){
      var notes=commentaryNoteFragments(sourceItem);
      if(notes)queue.push.apply(queue,notes);
      else queue.push(sourceItem);
    }
    function flush(){if(cur.length){pages.push(cur);cur=[];used=0;}}
    function fits(h){return used+h<=pageH-EPS;}

    while(queue.length){
      var item=queue.shift();
      var el=item.node;
      var h=measure(el,host);

      // Always decide on the assembled column: summing single-block heights is
      // wrong under margin collapsing, and a wrong decision overflows the page.
      var candidate=cur.concat([{chapter:item.chapter,node:el,key:item.key}]);
      var candidateHeight=columnHeight(candidate,host);
      if(candidateHeight<=pageH){
        // Keep a heading with the first meaningful content, not merely a
        // whole large TABLE. Looking ahead at its first *complete row* prevents
        // 【辑评】 from being stranded on a near-empty left sheet.
        if(keepWithNext(el)&&queue.length){
          var next=queue[0];
          var together=columnHeight(candidate.concat([next]),host);
          if(together>pageH-EPS&&cur.length){
            // Reconsider the same heading on the next page, so even a title
            // appearing near the bottom never remains on the old page.
            flush();queue.unshift(item);continue;
          }
        }
        cur.push({chapter:item.chapter,node:el,key:item.key,offset:item.offset});
        used=candidateHeight;
        continue;
      }

      if(hasImage(el)&&h>pageH){
        var scaled=fitFigure(el,pageH,host);
        if(scaled){
          flush();
          pages.push([{chapter:item.chapter,node:scaled,key:item.key,offset:item.offset,scaled:true}]);
          continue;
        }
        flush();
        pages.push([{chapter:item.chapter,node:el,key:item.key,offset:item.offset,oversized:true}]);
        continue;
      }

      if(window.JF_DEBUG_SPLIT)console.info('[page] used',Math.round(used),'pageH',Math.round(pageH),'blockH',Math.round(h),'curLen',cur.length);
      // v7.78: The first probe measures a paragraph in isolation. Its margins
      // and first-child indentation can differ by up to a line when assembled
      // after the current column. Previously, a small composed overflow caused
      // the ENTIRE next paragraph to move, leaving an avoidable page-end hole.
      // Back off a fraction of a line, at most twice, and re-verify the REAL
      // assembled column. Never relax the two-line widow/orphan invariant.
      var split=null;
      var available=Math.max(0,pageH-used);
      for(var retry=0;retry<3&&available>=lh*MIN_LINES;retry++){
        var proposal=trySplit(el,available,host,lh,pageH);
        if(!proposal)break;
        var projected=columnHeight(cur.concat([{
          chapter:item.chapter,node:proposal.head,key:item.key,offset:item.offset
        }]),host);
        if(projected<=pageH-EPS){split=proposal;break;}
        // Composition-only overflow: the next try must be genuinely shorter.
        available-=Math.max(lh*.55,projected-pageH+EPS+lh*.12);
      }
      if(split){
        // Preserve original block offsets and exact text/image conservation.
        var headOffset=item.offset||0;
        var tailOffset=headOffset+split.head.textContent.length;
        cur.push({chapter:item.chapter,node:split.head,key:(item.key||'')+'#1',offset:headOffset,split:true});
        // Only a carried-over paragraph should start flush-left on the new
        // page. A genuinely new paragraph at the top keeps its 2em indent.
        if(split.tail.tagName==='P')split.tail.classList.add('jfPrintContinuation');
        if(split.tail.classList?.contains('jfPrintCommentaryNote'))
          split.tail.classList.add('jfPrintCommentaryContinuation');
        flush();
        queue.unshift({chapter:item.chapter,node:split.tail,key:(item.key||'')+'#2',offset:tailOffset,split:true});
        continue;
      }

      if(cur.length){flush();queue.unshift(item);continue;}

      // Nothing fits on an empty page: it must be an unsplittable block.
      pages.push([{chapter:item.chapter,node:el,key:item.key,offset:item.offset,oversized:true}]);
    }
    flush();
    return pages;
  }

  // Data URL of the last resort: report why a page is short.
  function pageFill(page,pageH){
    var sum=0;
    for(var i=0;i<page.length;i++){
      var node=page[i].node;
      sum+=node.getBoundingClientRect?node.getBoundingClientRect().height:0;
    }
    return sum/pageH;
  }

  window.JFPageEngine={paginate:paginate,measure:measure,lineHeight:lineHeight,pageFill:pageFill};
})();
