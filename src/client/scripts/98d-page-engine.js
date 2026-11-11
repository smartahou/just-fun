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

  // v7.123: keep a live assembled-column probe rather than destroying and
  // deep-cloning its whole prefix for every candidate. This is per-host and
  // uses actual DOM layout, not additive height estimates (which ignore
  // collapsing margins / first-child print styles).
  var columnCache=new WeakMap();
  var activeStats=null,lastStats=null;
  function stats(){return activeStats;}

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
    // Single-block probes overwrite the assembly host, so its cached prefix
    // is no longer valid. Most fitting blocks never need this probe at all.
    columnCache.delete(host);
    if(activeStats)activeStats.singleMeasurements++;
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
    // A short bibliography item is atomic. A genuinely oversized item may
    // split at DOM Range boundaries, preserving every source character.
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
    if(activeStats)activeStats.columnMeasurements++;
    // Older deterministic composition fixtures provide only replaceChildren()
    // and scrollHeight, not the full Element mutation API. Keep the exact old
    // assembled measurement for those hosts. Real DOM uses the incremental
    // branch below.
    if(!host.childNodes||!host.appendChild||!host.removeChild){
      var frag=document.createDocumentFragment();
      for(var fallback=0;fallback<cur.length;fallback++)
        frag.appendChild(cur[fallback].node.cloneNode(true));
      host.replaceChildren(frag);
      return host.scrollHeight;
    }
    var state=columnCache.get(host);
    // A figure scaler or outside caller may have mutated the probe. Trust the
    // cache only when its actual child nodes are still connected and aligned.
    if(!state||host.childNodes.length!==state.clones.length||
       (state.clones.length&&
         (host.firstChild!==state.clones[0]||
          host.lastChild!==state.clones[state.clones.length-1]))){
      state={sources:[],clones:[]};
      host.replaceChildren();
      columnCache.set(host,state);
    }
    var common=0,limit=Math.min(cur.length,state.sources.length);
    while(common<limit&&cur[common].node===state.sources[common])common++;
    if(activeStats)activeStats.reusedColumnNodes+=common;
    while(state.clones.length>common){
      host.removeChild(state.clones.pop());
      state.sources.pop();
    }
    // Common case: one new paragraph. Only that new subtree enters the DOM,
    // rather than re-styling and re-cloning all prior paragraphs on the leaf.
    for(var i=common;i<cur.length;i++){
      var clone=cur[i].node.cloneNode(true);
      host.appendChild(clone);
      state.sources.push(cur[i].node);
      state.clones.push(clone);
      if(activeStats)activeStats.clonedColumnNodes++;
    }
    return host.scrollHeight;
  }


  // v7.112: Editorial headings and their first commentary must share a page.
  // EPUBs commonly use <p><b>【辑评】</b></p> rather than H2. The reader
  // tags that *specific* printed clone; the generic engine also respects H1-H6.
  function keepWithNext(el){
    return /^H[1-6]$/.test(el?.tagName||'') ||
      !!el?.classList?.contains('jfPrintKeepWithNext')||
      !!el?.classList?.contains('jfPrintPoetryLead');
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
    // EPUB often wraps a <table> in an indented <div>. Literal wrapper
    // newlines are source characters, but not semantic printed content.
    // Allow ONLY whitespace-only padding, never prose siblings.
    if(node!==table){
      var outer=node.textContent||'',inner=table.textContent||'';
      var at=outer.indexOf(inner);
      if(at<0||!(/^[\s\u00a0\u3000]*$/).test(
        outer.slice(0,at)+outer.slice(at+inner.length)))return null;
    }
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

  // v7.124: normal adjacent paragraphs can be tested as one *real*
  // assembled column. Keep heading, poetry, image and split decisions on
  // the existing exact per-block path; no additive height estimates.
  function batchableProse(item){
    var el=item&&item.node;
    return !!el&&el.tagName==='P'&&!keepWithNext(el)&&
      !(Number(el.dataset?.jfPoetryKeep)>1)&&!hasImage(el)&&
      !el.querySelector?.('table,pre,blockquote');
  }

  function paginate(blocks,pageH,host){
    // Always reset the measured prefix between pagination sessions and when
    // the viewport or font metrics change. No speculative height is reused.
    columnCache.delete(host);
    var previous=activeStats;
    var counters={blocks:blocks.length,singleMeasurements:0,
      columnMeasurements:0,clonedColumnNodes:0,reusedColumnNodes:0,
      batchProbes:0,batchAcceptedBlocks:0,batchOverflows:0,
      pages:0,elapsedMs:0};
    activeStats=counters;
    var clock=(typeof performance!=='undefined'&&performance.now)?
      function(){return performance.now();}:function(){return Date.now();};
    var started=clock();
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
    var batchBlocked=false;
    function flush(){
      if(cur.length){pages.push(cur);cur=[];used=0;batchBlocked=false;}
    }
    function fits(h){return used+h<=pageH-EPS;}
    function asPageItem(item){
      return {chapter:item.chapter,node:item.node,key:item.key,offset:item.offset};
    }

    while(queue.length){
      // A full-batch height read replaces up to twelve forced style/layout
      // flushes. If it crosses the page boundary, binary-search the largest
      // fitting prefix, then let the original exact splitter handle the tail.
      // Never batch an editorial keep-with-next, image or special figure.
      if(!batchBlocked&&batchableProse(queue[0])){
        var batch=[queue[0]];
        for(var b=1;b<12&&b<queue.length&&batchableProse(queue[b]);b++)
          batch.push(queue[b]);
        if(batch.length>=3){
          var fullHeight=columnHeight(cur.concat(batch),host);
          counters.batchProbes++;
          var accepted=0,acceptedHeight=used;
          if(fullHeight<=pageH){
            accepted=batch.length;
            acceptedHeight=fullHeight;
          }else{
            counters.batchOverflows++;
            // Monotone assembled prose height; check the same actual column
            // layout at each binary-search midpoint, never sum block heights.
            var low=0,high=batch.length;
            while(low+1<high){
              var mid=(low+high)>>1;
              var probed=columnHeight(cur.concat(batch.slice(0,mid)),host);
              counters.batchProbes++;
              if(probed<=pageH){low=mid;acceptedHeight=probed;}
              else high=mid;
            }
            accepted=low;
            batchBlocked=true;
          }
          if(accepted){
            for(var c=0;c<accepted;c++)cur.push(asPageItem(batch[c]));
            queue.splice(0,accepted);
            counters.batchAcceptedBlocks+=accepted;
            used=acceptedHeight;
            continue;
          }
        }
      }
      var item=queue.shift();
      var el=item.node;

      // A fitting paragraph is fully measured by the assembled column below.
      // The old eager measure() did an additional full DOM replacement and
      // forced style/layout recalculation for EVERY paragraph, even when it fit.
      // Always decide on the assembled column: summing single-block heights is
      // wrong under margin collapsing, and a wrong decision overflows the page.
      var candidate=cur.concat([{chapter:item.chapter,node:el,key:item.key}]);
      var candidateHeight=columnHeight(candidate,host);
      if(candidateHeight<=pageH){
        // Keep a heading with the first meaningful content, not merely a
        // whole large TABLE. Looking ahead at its first *complete row* prevents
        // 【辑评】 from being stranded on a near-empty left sheet.
        // Keep a poem title, optional author, and verse together when they
        // fit on a clean leaf. Do not drag entire long commentaries with them.
        var poetryKeep=Number(el.dataset?.jfPoetryKeep)||0;
        if(poetryKeep>1&&queue.length>=poetryKeep-1&&cur.length){
          var unit=[item].concat(queue.slice(0,poetryKeep-1));
          if(columnHeight(unit,host)<=pageH-EPS&&
             columnHeight(cur.concat(unit),host)>pageH-EPS){
            flush();queue.unshift(item);continue;
          }
        }
        if(keepWithNext(el)&&queue.length){
          var next=queue[0];
          var together=columnHeight(candidate.concat([next]),host);
          // If the next paragraph is longer than a whole sheet, it must
          // split normally; never push its heading plus a huge blank area.
          var fresh=columnHeight([item,next],host);
          if(fresh<=pageH-EPS&&together>pageH-EPS&&cur.length){
            // Reconsider the same heading on the next page, so even a title
            // appearing near the bottom never remains on the old page.
            flush();queue.unshift(item);continue;
          }
        }
        cur.push({chapter:item.chapter,node:el,key:item.key,offset:item.offset});
        used=candidateHeight;
        continue;
      }

      // Only overflowing blocks need an isolated height (e.g. huge figures
      // and split/widow decisions). Do not pay this cost for normal prose.
      var h=measure(el,host);
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
    counters.pages=pages.length;
    counters.elapsedMs=clock()-started;
    lastStats=counters;
    activeStats=previous;
    // Clear the last assembled leaf to avoid keeping clones of an entire
    // chapter alive after pagination. Page contents are held separately.
    columnCache.delete(host);
    host.replaceChildren();
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

  window.JFPageEngine={paginate:paginate,measure:measure,
    lineHeight:lineHeight,pageFill:pageFill,
    diagnostics:function(){return lastStats?Object.assign({},lastStats):null;}};
})();
