// v7.80 · EPUB "目" paper slip. No reflow or third-party resources.
(function(){
  'use strict';
  const host=document.getElementById('jfPageView');
  if(!host)return;
  const tab=document.createElement('button');
  tab.id='jfEpubTocTab';tab.type='button';tab.textContent='目';
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
  host.append(tab,pane);
  let opened=false,session=0;
  function close(){
    pane.hidden=true;opened=false;tab.setAttribute('aria-expanded','false');
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
    list.replaceChildren();
    for(const entry of jfDeskOutline.toc){
      const b=document.createElement('button');b.type='button';
      b.className='jfEpubTocEntry';b.textContent=entry.title;b.title=entry.title;
      b.dataset.jfChapter=String(entry.chapter);
      b.style.setProperty('--toc-depth',String(entry.depth||0));
      b.classList.toggle('current',entry.chapter===jfDeskChapter);
      b.addEventListener('click',()=>jump(entry).catch(err=>console.warn('[JustFun] TOC jump',err)));
      list.append(b);
    }
    pane.hidden=false;opened=true;tab.setAttribute('aria-expanded','true');sync();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&opened){close();e.stopPropagation();}
  });
  document.addEventListener('pointerdown',e=>{
    if(opened&&!pane.contains(e.target)&&!tab.contains(e.target))close();
  });
  window.JFEpubPaperToc={sync,close};
})();
