// EPUB old-book tabs: the paper view owns decoration; no EPUB file is mutated.
(function(){
  'use strict';
  const view=document.getElementById('jfPageView');
  if(!view)return;
  const root=document.createElement('div');
  root.className='jfEpubPaperTools';
  root.hidden=true;
  const makeButton=(text,label)=>{
    const b=document.createElement('button');
    b.type='button';b.className='jfEpubPaperTab';
    b.textContent=text;b.title=label;b.setAttribute('aria-label',label);
    b.setAttribute('aria-expanded','false');
    return b;
  };
  const tocButton=makeButton('目','打开本书目录');
  const noteButton=makeButton('笺','打开本页笺注');
  tocButton.classList.add('jfEpubTocTab');noteButton.classList.add('jfEpubNoteTab');
  const drawer=document.createElement('aside');
  drawer.className='jfEpubPaperDrawer';
  drawer.hidden=true;drawer.setAttribute('aria-label','旧书纸签内容');
  const head=document.createElement('div');head.className='jfEpubPaperDrawerHead';
  const heading=document.createElement('strong');
  const closeButton=makeButton('×','收起纸签');closeButton.className='jfEpubPaperClose';
  const body=document.createElement('div');body.className='jfEpubPaperDrawerBody';
  body.tabIndex=0;
  head.append(heading,closeButton);drawer.append(head,body);
  root.append(tocButton,noteButton,drawer);view.append(root);
  let bookId='',toc=[],notes=new Map(),spread=[],currentChapter=-1,open='',navigate=null;
  let markers=new Map(),highlightTimer=0,flashSource=null;
  const collapsed=new Set();
  function clearFlash(){
    clearTimeout(highlightTimer);highlightTimer=0;
    if(flashSource&&typeof CSS!=='undefined'&&CSS.highlights){
      CSS.highlights.delete('jfEpubNoteFlash');
    }
    flashSource=null;
  }
  function close(){
    clearFlash();open='';drawer.hidden=true;root.dataset.open='';
    tocButton.setAttribute('aria-expanded','false');
    noteButton.setAttribute('aria-expanded','false');
    tocButton.classList.remove('is-open');
    noteButton.classList.remove('is-open');
  }
  function renderToc(){
    body.replaceChildren();
    const list=document.createElement('div');list.className='jfEpubTocList';list.setAttribute('role','tree');
    const paint=()=>{
      list.replaceChildren();
      const ancestors=[];
      for(let i=0;i<toc.length;i++){
        const item=toc[i],depth=Math.max(0,Math.min(10,Number(item.depth)||0));
        while(ancestors.length>depth)ancestors.pop();
        const blocked=ancestors.some(x=>collapsed.has(x));
        if(!blocked){
          const row=document.createElement('div');row.className='jfEpubTocRow';
          row.style.setProperty('--jf-toc-depth',String(depth));
          const hasChildren=i+1<toc.length&&(Number(toc[i+1].depth)||0)>depth;
          if(hasChildren){
            const twist=document.createElement('button');
            twist.type='button';twist.className='jfEpubTocTwist';
            twist.textContent=collapsed.has(i)?'＋':'−';
            twist.title=collapsed.has(i)?'展开子目录':'折叠子目录';
            twist.setAttribute('aria-expanded',String(!collapsed.has(i)));
            twist.addEventListener('click',event=>{event.stopPropagation();
              if(collapsed.has(i))collapsed.delete(i);else collapsed.add(i);paint();});
            row.append(twist);
          }else{
            const spacer=document.createElement('span');spacer.className='jfEpubTocTwist';row.append(spacer);
          }
          const jump=document.createElement('button');jump.type='button';
          jump.className='jfEpubTocJump';
          jump.textContent=item.title;jump.title=item.title;
          jump.disabled=!item.available||item.chapter<0;
          if(item.chapter===currentChapter){jump.classList.add('is-current');jump.setAttribute('aria-current','location');}
          jump.setAttribute('role','treeitem');
          jump.setAttribute('aria-level',String(depth+1));
          jump.addEventListener('click',event=>{
            event.stopPropagation();close();
            if(item.available&&navigate)Promise.resolve(navigate(item)).catch(e=>console.warn('[JustFun] 目录跳转失败',e));
          });
          row.append(jump);list.append(row);
        }
        ancestors[depth]=i;ancestors.length=depth+1;
      }
    };
    paint();body.append(list);
  }
  function tryFlash(noteId){
    clearFlash();
    const marker=markers.get(noteId);
    if(!marker||!marker.isConnected)return;
    const container=marker.closest('p,li,blockquote,h1,h2,h3,h4,h5,h6')||marker.parentElement;
    if(!container)return;
    // Local DOM order only: inspect text nodes immediately preceding this exact
    // reference. Never search the page for a repeated phrase.
    const walk=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);
    let leaf=null,node;
    while((node=walk.nextNode())){
      if(node.compareDocumentPosition(marker)&Node.DOCUMENT_POSITION_FOLLOWING){
        if(node.textContent?.trim())leaf=node;
      }else break;
    }
    if(!leaf){marker.scrollIntoView({block:'nearest',behavior:'auto'});return;}
    const raw=leaf.textContent||'';
    let end=raw.length;
    while(end>0&&/\s/.test(raw[end-1]))end--;
    const start=Math.max(0,end-6);
    if(end<=start)return;
    const range=document.createRange();range.setStart(leaf,start);range.setEnd(leaf,end);
    if(typeof CSS!=='undefined'&&CSS.highlights&&typeof Highlight==='function'){
      CSS.highlights.set('jfEpubNoteFlash',new Highlight(range));
      flashSource=marker;
      if(!window.matchMedia('(prefers-reduced-motion:reduce)').matches)
        highlightTimer=setTimeout(clearFlash,1300);
      else clearFlash();
    }else{
      // Unsupported highlight API: scroll to the verified marker, don't select
      // text or wrap a guessed phrase and accidentally change the page flow.
      marker.scrollIntoView({block:'nearest',behavior:'auto'});
    }
  }
  function renderNotes(){
    body.replaceChildren();
    for(const note of spread){
      const entry=document.createElement('button');entry.type='button';
      entry.className='jfEpubNoteItem';entry.title='定位正文';
      if(note.excerpt){
        const label=document.createElement('strong');
        label.textContent=note.excerpt;entry.append(label);
      }
      const detail=document.createElement('span');detail.className='jfEpubNoteText';
      detail.textContent=note.text||'';entry.append(detail);
      entry.addEventListener('click',event=>{event.stopPropagation();tryFlash(note.id);});
      body.append(entry);
    }
  }
  function show(which){
    if(open===which){close();return;}
    close();open=which;
    root.dataset.open=which;heading.textContent=which==='toc'?'目录':'笺注';
    if(which==='toc')renderToc();else renderNotes();
    drawer.hidden=false;
    (which==='toc'?tocButton:noteButton).setAttribute('aria-expanded','true');
    (which==='toc'?tocButton:noteButton).classList.add('is-open');
  }
  tocButton.addEventListener('click',event=>{event.stopPropagation();show('toc');});
  noteButton.addEventListener('click',event=>{event.stopPropagation();show('notes');});
  closeButton.addEventListener('click',event=>{event.stopPropagation();close();});
  root.addEventListener('click',event=>event.stopPropagation());
  document.addEventListener('pointerdown',event=>{
    if(open&&!root.contains(event.target)){
      event.preventDefault();event.stopImmediatePropagation();close();
    }
  },true);
  document.addEventListener('keydown',event=>{
    if(open&&event.key==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();close();
    }
  },true);
  function sync(options){
    close();root.hidden=true;
    const enabled=options?.enabled&&options.bookId;
    if(!enabled){bookId='';markers.clear();spread=[];return;}
    if(bookId!==options.bookId){bookId=options.bookId;collapsed.clear();}
    toc=Array.isArray(options.toc)?options.toc:[];
    notes=new Map((options.annotations||[]).filter(n=>n?.id&&n?.text).map(n=>[n.id,n]));
    currentChapter=options.currentChapter??-1;
    navigate=options.navigate;
    markers.clear();spread=[];
    const found=new Set();
    for(const sheet of [options.left,options.right]){
      if(!sheet)continue;
      for(const el of sheet.querySelectorAll('[data-jf-note-id]')){
        const id=el.dataset.jfNoteId;
        if(!id||found.has(id)||!notes.has(id))continue;
        found.add(id);spread.push(notes.get(id));markers.set(id,el);
      }
    }
    tocButton.hidden=!toc.length;noteButton.hidden=!spread.length;
    root.hidden=!toc.length&&!spread.length;
  }
  window.JFEpubPaperTabs={sync,close,getCurrentNotes:()=>spread.map(n=>n.id),
    isOpen:()=>open,hasToc:()=>toc.length>0,hasNotes:()=>spread.length>0};
})();
