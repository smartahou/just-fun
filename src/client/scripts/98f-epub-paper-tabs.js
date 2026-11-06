// v7.80 · EPUB "目" paper slip. No reflow or third-party resources.
(function(){
  'use strict';
  const host=document.getElementById('jfPageView');
  if(!host)return;
  const desk=document.getElementById('jfReadCenter');
  if(!desk)return;
  const tab=document.createElement('button');
  tab.id='jfEpubTocTab';tab.type='button';tab.textContent='目录';
  tab.title='抽出目录';tab.className='jfEpubTocTab';tab.hidden=true;
  tab.setAttribute('aria-label','打开书籍目录');
  tab.setAttribute('aria-expanded','false');
  const pane=document.createElement('aside');
  pane.id='jfEpubTocPane';pane.className='jfEpubTocPane';pane.hidden=true;
  pane.setAttribute('aria-label','书籍目录');
  const title=document.createElement('div');
  title.className='jfEpubTocTitle';title.textContent='目录';
  const list=document.createElement('div');list.className='jfEpubTocList';
  pane.append(title,list);
  host.append(tab);desk.append(pane);
  let opened=false;
  function syncDesk(){
    desk.classList.toggle('jfEpubDrawerOpen',!pane.hidden||!notePane.hidden);
  }
  function close(){
    pane.hidden=true;opened=false;tab.setAttribute('aria-expanded','false');
    syncDesk();
  }
  function sync(){
    const enabled=!!(jfDeskPaged&&jfDeskOutline?.format==='EPUB'&&jfDeskOutline.toc?.length);
    tab.hidden=!enabled;
    if(!enabled)close();
    if(opened){
      for(const b of list.querySelectorAll('[data-jf-chapter]'))
        b.classList.toggle('current',Number(b.dataset.jfChapter)===jfDeskChapter);
    }
  }
  async function jump(entry){
    const bookId=jfDeskBook?.id,epoch=jfDeskSession;
    close();
    if(!bookId||!jfDeskPaged)return;
    await jfDeskShowChapter(entry.chapter,0,null);
    if(jfDeskBook?.id!==bookId||jfDeskSession!==epoch||!jfDeskPaged)return;
    if(entry.fragment){
      const section=jfDeskFlow.find(x=>x.n===entry.chapter)?.el;
      const anchor=section&&Array.from(section.querySelectorAll('[id]')).find(x=>x.id===entry.fragment);
      if(anchor){
        const range=document.createRange();
        range.selectNodeContents(section);range.setEndBefore(anchor);
        jfDeskPageIndex=jfDeskPageForAnchor(jfDeskPages,entry.chapter,range.toString().length,
          jfDeskPagedGeometry().two?2:1);
        jfDeskPagedRender();jfDeskUpdateProgress();
      }
    }
  }
  tab.addEventListener('click',()=>{
    if(opened){close();return;}
    if(!jfDeskPaged||!jfDeskOutline?.toc?.length)return;
    closeNotes();list.replaceChildren();
    for(const entry of jfDeskOutline.toc){
      if((entry.depth||0)===0&&/^目\s*录$/.test(entry.title||''))continue;
      const b=document.createElement('button');b.type='button';
      b.className='jfEpubTocEntry';b.textContent=entry.title;b.title=entry.title;
      b.dataset.jfChapter=String(entry.chapter);
      const depth=Math.max(0,Math.min(6,Number(entry.depth)||0));
      b.dataset.jfTocDepth=String(depth);
      // Pixel indentation, not unsupported CSS calc(1px * number).
      b.style.paddingLeft=(10+depth*22)+'px';
      b.style.setProperty('--jf-toc-rule-left',(4+depth*22)+'px');
      b.classList.add(depth===0?'jfEpubTocGroup':'jfEpubTocChild');
      b.classList.toggle('current',entry.chapter===jfDeskChapter);
      b.addEventListener('click',()=>jump(entry).catch(err=>console.warn('[JustFun] TOC jump',err)));
      list.append(b);
    }
    pane.hidden=false;opened=true;tab.setAttribute('aria-expanded','true');sync();syncDesk();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&opened){close();e.stopPropagation();}
  });
  document.addEventListener('pointerdown',e=>{
    if(opened&&!pane.contains(e.target)&&!tab.contains(e.target))close();
  });

  // "笺" exists only when this precise spread contains verified anchors.
  const noteTab=document.createElement('button');
  noteTab.id='jfEpubNoteTab';noteTab.type='button';
  noteTab.className='jfEpubTocTab jfEpubNoteTab';
  noteTab.textContent='笺注';noteTab.title='抽出当前页笺注';noteTab.hidden=true;
  noteTab.setAttribute('aria-label','打开当前双页笺注');
  noteTab.setAttribute('aria-expanded','false');
  const notePane=document.createElement('aside');
  notePane.id='jfEpubNotePane';notePane.className='jfEpubTocPane jfEpubNotePane';
  notePane.setAttribute('aria-label','当前双页笺注');notePane.hidden=true;
  const noteTitle=document.createElement('div');
  noteTitle.className='jfEpubTocTitle';noteTitle.textContent='笺注';
  const noteList=document.createElement('div');noteList.className='jfEpubTocList';
  notePane.append(noteTitle,noteList);host.append(noteTab);desk.append(notePane);
  let currentNotes=[],flashNodes=[],flashTimer=0;
  function stopFlash(){
    clearTimeout(flashTimer);
    for(const n of flashNodes)n.remove();
    flashNodes=[];
  }
  function closeNotes(){
    notePane.hidden=true;noteTab.setAttribute('aria-expanded','false');
    stopFlash();syncDesk();
  }
  // Highlight a source Range just before the actual anchor, never use global
  // string matching. The overlay is painted outside the reflowed book DOM.
  function flash(anchor){
    stopFlash();
    const sheet=anchor.closest('.jfSheetBody');
    if(!sheet)return;
    const walk=document.createTreeWalker(sheet,NodeFilter.SHOW_TEXT);
    let node,last=null;
    while((node=walk.nextNode())){
      if(anchor.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING)break;
      if(node.textContent?.trim())last=node;
    }
    if(!last)return;
    const range=document.createRange();
    const end=last.textContent.length;
    range.setStart(last,Math.max(0,end-6));range.setEnd(last,end);
    const parent=host.getBoundingClientRect();
    // CSS scales the book while the detached paper slip is out. Convert
    // rendered viewport coordinates back to the book's own CSS pixel space.
    const sx=host.offsetWidth?parent.width/host.offsetWidth:1;
    const sy=host.offsetHeight?parent.height/host.offsetHeight:1;
    for(const rect of range.getClientRects()){
      if(rect.width<1||rect.height<1)continue;
      const mark=document.createElement('span');
      mark.className='jfEpubNoteFlash';
      mark.style.left=((rect.left-parent.left)/sx)+'px';
      mark.style.top=((rect.top-parent.top)/sy)+'px';
      mark.style.width=(rect.width/sx)+'px';mark.style.height=(rect.height/sy)+'px';
      host.append(mark);flashNodes.push(mark);
    }
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){stopFlash();return;}
    flashTimer=setTimeout(stopFlash,1250);
  }
  noteTab.addEventListener('click',()=>{
    if(!notePane.hidden){closeNotes();return;}
    if(!currentNotes.length)return;
    close();noteList.replaceChildren();
    for(const n of currentNotes){
      const b=document.createElement('button');
      b.type='button';b.className='jfEpubNoteEntry';
      const number=document.createElement('span');
      number.className='jfEpubNoteNumber';
      number.textContent=n.number?'〔'+n.number+'〕':'·';
      const content=document.createElement('span');
      content.className='jfEpubNoteText';content.textContent=n.text;
      b.append(number,content);
      b.addEventListener('click',()=>flash(n.anchor));
      noteList.append(b);
    }
    notePane.hidden=false;noteTab.setAttribute('aria-expanded','true');syncDesk();
  });
  function renderNotes(left,right,notesByChapter){
    closeNotes();
    currentNotes=[];
    const active=!!(jfDeskPaged&&jfDeskOutline?.format==='EPUB');
    if(active){
      const all=new Map();
      for(const arr of notesByChapter.values()){
        for(const note of arr||[])if(note?.id)all.set(note.id,note);
      }
      const seen=new Set();
      for(const page of [left,right]){
        for(const anchor of page.querySelectorAll('[data-jf-note-ref]')){
          const id=anchor.dataset.jfNoteRef;
          // IDs are scoped by original spine chapter; block.chapter supplied by
          // page engine can be used when reading source contains many chapters.
          const chapter=Number(anchor.closest('[data-chapter]')?.dataset.chapter);
          let data=Number.isInteger(chapter)?notesByChapter.get(chapter)?.find(n=>n.id===id):null;
          if(!data){
            // The paginated clone has no section wrapper: use the unique
            // chapter-tagged marker in the next server projection.
            const chapterId=anchor.dataset.jfNoteChapter;
            if(chapterId)data=notesByChapter.get(Number(chapterId))?.find(n=>n.id===id);
          }
          if(!data){
            const matching=[...all.values()].filter(n=>n.id===id);
            if(matching.length===1)data=matching[0];
          }
          if(!data||seen.has(data))continue;
          seen.add(data);currentNotes.push({...data,anchor});
        }
      }
    }
    noteTab.hidden=!currentNotes.length;
  }
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!notePane.hidden){closeNotes();e.stopPropagation();}
  });
  document.addEventListener('pointerdown',e=>{
    if(!notePane.hidden&&!notePane.contains(e.target)&&!noteTab.contains(e.target))
      closeNotes();
  });
  // Arrow keys inside the loose slips scroll their lists, rather than
  // bubbling into the document-wide printed-page turn shortcut.
  function suppressPaperKeys(e){
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown',' '].includes(e.key))
      e.stopPropagation();
  }
  pane.addEventListener('keydown',suppressPaperKeys);
  notePane.addEventListener('keydown',suppressPaperKeys);
  const originalClose=close, originalSync=sync;
  function closeAll(){originalClose();closeNotes();syncDesk();}
  function syncAll(){originalSync();if(!jfDeskPaged||jfDeskOutline?.format!=='EPUB'){noteTab.hidden=true;closeNotes();}}

  window.JFEpubPaperToc={sync:syncAll,close:closeAll,renderNotes};
})();
