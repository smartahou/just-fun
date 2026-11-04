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
  function isFigure(el){
    return el.tagName==='FIGURE'||!!el.querySelector('figcaption');
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
    for(var attempt=0;attempt<4&&best>0;attempt++,best--){
      var headEl=sliceBlock(el,0,best);
      var tailEl=sliceBlock(el,best,walk.total);
      if(!headEl||!tailEl)continue;
      if(headEl.textContent.length+tailEl.textContent.length!==sourceLength)continue;
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

  function paginate(blocks,pageH,host){
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
        // A heading must not be the last thing on a page.
        if(/^H[1-6]$/.test(el.tagName)&&queue.length&&cur.length){
          var withNext=columnHeight(candidate.concat([queue[0]]),host);
          if(withNext>pageH){
            // Move the heading to the fresh page — it must not be dropped.
            flush();
            cur.push({chapter:item.chapter,node:el,key:item.key});
            used=measure(el,host);
            continue;
          }
        }
        cur.push({chapter:item.chapter,node:el,key:item.key});
        used=candidateHeight;
        continue;
      }

      if(isFigure(el)&&h>pageH){
        var scaled=fitFigure(el,pageH,host);
        if(scaled){
          flush();
          pages.push([{chapter:item.chapter,node:scaled,key:item.key,scaled:true}]);
          continue;
        }
        flush();
        pages.push([{chapter:item.chapter,node:el,key:item.key,oversized:true}]);
        continue;
      }

      if(window.JF_DEBUG_SPLIT)console.info('[page] used',Math.round(used),'pageH',Math.round(pageH),'blockH',Math.round(h),'curLen',cur.length);
      var split=trySplit(el,pageH-used,host,lh);
      if(split){
        // Trust the assembled column, not the isolated fragment: margins collapse
        // differently once the fragment sits next to its neighbours.
        cur.push({chapter:item.chapter,node:split.head,key:(item.key||'')+'#1',split:true});
        if(columnHeight(cur,host)<=pageH){
          flush();
          queue.unshift({chapter:item.chapter,node:split.tail,key:(item.key||'')+'#2',split:true});
          continue;
        }
        cur.pop();
      }

      if(cur.length){flush();queue.unshift(item);continue;}

      // Nothing fits on an empty page: it must be an unsplittable block.
      pages.push([{chapter:item.chapter,node:el,key:item.key,oversized:true}]);
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
