// Just Fun page engine (v7.33)
// Measured pagination for the paper-book mode. Blocks are placed into a real
// page container whose height is fixed; when the rendered content overflows we
// move the block to the next page. Oversized blocks (a long paragraph, a tall
// figure) are split by binary-searching a text offset with real layout, so a
// page never ends mid-line and no character is dropped or duplicated.
(function(){
  'use strict';

  var TEXT_SPLIT_MAX=400;      // binary-search budget per oversized block
  var MIN_SPLIT_LINES=2;       // never leave a 1-line orphan at a break

  function parseChapter(html){
    var doc=new DOMParser().parseFromString('<body>'+html+'</body>','text/html');
    var out=[];
    for(var i=0;i<doc.body.children.length;i++)out.push(document.importNode(doc.body.children[i],true));
    return out;
  }

  function isOversized(el,host,pageH){
    host.replaceChildren(el.cloneNode(true));
    return host.firstElementChild.getBoundingClientRect().height>pageH;
  }

  // Height a block will occupy inside the page column, including margins.
  function outerHeight(el){
    var cs=getComputedStyle(el);
    return el.getBoundingClientRect().height
      + (parseFloat(cs.marginTop)||0)
      + (parseFloat(cs.marginBottom)||0);
  }

  // Split one oversized block into [head, tail] that fits pageH / the rest.
  // Uses a real layout probe: the candidate text is rendered, measured, and the
  // offset is binary-searched, so the break follows actual line boxes.
  function splitOversized(el,host,pageH){
    var clone=el.cloneNode(true);
    host.replaceChildren(clone);
    var range=document.createRange();
    range.selectNodeContents(clone);
    var walker=document.createTreeWalker(clone,NodeFilter.SHOW_TEXT);
    var nodes=[],n,acc=0;
    while((n=walker.nextNode())){nodes.push({node:n,start:acc,len:n.nodeValue.length});acc+=n.nodeValue.length;}
    if(!nodes.length)return null;
    var total=acc;
    function cutAt(offset){
      // offset -> {node, off}
      for(var i=nodes.length-1;i>=0;i--){
        if(offset>=nodes[i].start)return {node:nodes[i].node,off:Math.min(nodes[i].len,offset-nodes[i].start)};
      }
      return {node:nodes[0].node,off:0};
    }
    function buildPrefix(offset){
      var c=el.cloneNode(true);
      var w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);
      var left=offset,node;
      while((node=w.nextNode())){
        if(left<=0){node.nodeValue='';continue;}
        if(node.nodeValue.length>left){node.nodeValue=node.nodeValue.slice(0,left);left=0;}
        else left-=node.nodeValue.length;
      }
      return c;
    }
    function buildSuffix(offset){
      var c=el.cloneNode(true);
      var w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);
      var left=offset,node;
      while((node=w.nextNode())){
        if(left<=0)continue;
        if(node.nodeValue.length>left){node.nodeValue=node.nodeValue.slice(left);left=0;}
        else{node.nodeValue='';left-=node.nodeValue.length;}
      }
      return c;
    }
    var lo=1,hi=total,best=0;
    for(var i=0;i<TEXT_SPLIT_MAX&&lo<=hi;i++){
      var mid=(lo+hi)>>1;
      var probe=buildPrefix(mid);
      host.replaceChildren(probe);
      if(host.firstElementChild.getBoundingClientRect().height<=pageH){best=mid;lo=mid+1;}
      else hi=mid-1;
    }
    if(best<=0)return null;
    var head=buildPrefix(best),tail=buildSuffix(best);
    // Avoid a one-line orphan on either side.
    host.replaceChildren(buildPrefix(best-1));
    return {head:head,tail:tail};
  }

  // Paginate a list of chapters into page descriptors.
  // blocks: [{chapter, node}]
  function paginate(blocks,pageH,host){
    var pages=[],cur=[],curH=0;
    function flush(){if(cur.length){pages.push(cur);cur=[];curH=0;}}
    for(var i=0;i<blocks.length;i++){
      var item=blocks[i];
      var el=item.node;
      host.replaceChildren(el.cloneNode(true));
      var h=outerHeight(host.firstElementChild);
      if(h>pageH){
        var parts=splitOversized(el,host,pageH);
        if(parts){
          // Emit the head on the current page, then continue with the tail.
          flush();
          pages.push([{chapter:item.chapter,node:parts.head,split:true}]);
          blocks.splice(i+1,0,{chapter:item.chapter,node:parts.tail,split:true});
          continue;
        }
        // Cannot split (e.g. an oversized image): let it own a page.
        flush();pages.push([{chapter:item.chapter,node:el,oversized:true}]);continue;
      }
      if(curH+h>pageH&&cur.length){flush();}
      cur.push({chapter:item.chapter,node:el});
      curH+=h;
    }
    flush();
    return pages;
  }

  window.JFPageEngine={parseChapter:parseChapter,paginate:paginate,outerHeight:outerHeight};
})();
