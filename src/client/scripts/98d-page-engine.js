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
  function trySplit(el,avail,host,lh){
    if(window.JF_DEBUG_SPLIT)console.info('[split] avail',Math.round(avail),'lh',Math.round(lh),'need',Math.round(lh*MIN_LINES),'tag',el.tagName,'len',el.textContent.length);
    // Never split a block that owns an image: the clone would lose it.
    if(hasImage(el))return null;
    // v7.113: a bibliography+commentary pair is an indivisible table row when
    // it fits a fresh leaf. DOM Range splitting across <td> boundaries would
    // otherwise create a second fragment without its bibliography source.
    if((el.classList?.contains('jfPrintSourceRowPart')||
        el.querySelector?.('table.jfPrintSourceRowPart'))&&
       measure(el,host)<=parseFloat(host.dataset.jfPageBudget||'0')+EPS)return null;
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
  // A large source/commentary TABLE is semantically a sequence of source +
  // annotation ROWS, not one indivisible book plate. A row's two cells stay
  // paired. Each fragment is still a valid TABLE under the same markup, width,
  // columns and typography; unrelated EPUB/data tables are never touched.
  function commentaryRowFragments(item,host){
    var node=item.node;
    var table=node?.tagName==='TABLE'?node:
      node?.querySelector?.('table.jfPrintSourceCommentary');
    if(!table?.classList?.contains('jfPrintSourceCommentary')||
       table.classList.contains('jfPrintSourceRowPart'))return null;
    var rows=Array.from(table.rows||[]);
    if(rows.length<2||rows.length>30)return null;
    if(node!==table && (node.textContent||'').trim()!==(table.textContent||'').trim())return null;
    // v7.113: the v7.112 row-per-TABLE split accidentally gave each fragment
    // its *own* automatic column sizing. A short bibliography item could occupy
    // 30px while a longer item used 220px, turning the facing leaf into a jagged
    // run of labels and comments. Measure the ORIGINAL full table ONCE with
    // the same CSS as the printed pages; pin that ratio on every cloned row.
    // Only the printed clones change, never the source EPUB's table.
    var original=host?.ownerDocument?node.cloneNode(true):null;
    var share=38;
    if(original){
      host.replaceChildren(original);
      var full=original.tagName==='TABLE'?original:
        original.querySelector('table.jfPrintSourceCommentary');
      var cells=full?.rows?.[0]?.cells;
      if(cells?.length===2){
        var span=full.getBoundingClientRect().width;
        var measured=cells[0].getBoundingClientRect().width;
        if(span>1&&measured>1&&isFinite(measured/span))
          share=Math.max(30,Math.min(44,Math.round(measured/span*100)));
      }
    }
    var text=node.textContent||'',searchFrom=0,output=[];
    for(var k=0;k<rows.length;k++){
      var rowText=rows[k].textContent||'';
      if(!rowText.trim())return null;
      var at=text.indexOf(rowText,searchFrom);
      // Never manufacture an offset when the EPUB contains mixed text outside
      // a row; the source reading anchor must remain reconstructible.
      if(at<0)return null;
      searchFrom=at+rowText.length;
      var fragment=node.cloneNode(true);
      var part=fragment.tagName==='TABLE'?fragment:
        fragment.querySelector('table.jfPrintSourceCommentary');
      if(!part)return null;
      var all=Array.from(part.rows||[]);
      all.forEach(function(r,index){if(index!==k)r.remove();});
      part.classList.add('jfPrintSourceRowPart');
      // A cloned one-row table MUST keep the full table's two column tracks.
      // A colgroup takes precedence over copied EPUB <td width=...> hints,
      // and inline !important sizing makes hidden measurement and paint equal.
      part.querySelectorAll(':scope > colgroup').forEach(function(g){g.remove();});
      var group=document.createElement('colgroup');
      [share,100-share].forEach(function(pct){
        var col=document.createElement('col');
        col.style.width=pct+'%';
        group.appendChild(col);
      });
      part.insertBefore(group,part.firstChild);
      part.style.setProperty('table-layout','fixed','important');
      part.style.setProperty('width','100%','important');
      part.style.setProperty('max-width','100%','important');
      part.style.setProperty('margin','0','important');
      output.push({
        chapter:item.chapter,node:fragment,
        key:(item.key||'source')+'#row'+k,
        offset:(item.offset||0)+at,sourceRow:true
      });
    }
    return output;
  }

  function paginate(blocks,pageH,host){
    host.dataset.jfPageBudget=String(pageH);
    var lh=lineHeight(host);
    var pages=[],cur=[],used=0;
    var queue=blocks.slice();
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
          var parts=commentaryRowFragments(next,host);
          var lead=parts?.[0]||next;
          var together=columnHeight(candidate.concat([lead]),host);
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

      // Only source/commentary tables are decomposed, and only if they do not
      // fit beside preceding content. Other tables retain original behavior.
      var rows=commentaryRowFragments(item,host);
      if(rows){
        queue.unshift.apply(queue,rows);
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
        var proposal=trySplit(el,available,host,lh);
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
