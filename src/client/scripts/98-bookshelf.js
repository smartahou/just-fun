// Bookshelf P1: physically within the original library root. No independent config/storage.
const jfBooksRoot=document.getElementById('jfBooksWorkspace');
let jfBooks=[],jfBookDetailSelected=null,jfBooksFolder='all',jfBooksLimit=120,jfBooksPoll=null,jfBooksEpoch=0,jfBooksSignature='';
// Keep at most one books scan request alive; a slow removable drive must not
// cause 20-second polls to overlap and invalidate every response.
let jfBooksLoading=false,jfBooksRefreshQueued=false;
function jfBooksFormat(bytes){
  if(bytes<1024)return bytes+' B';
  if(bytes<1048576)return (bytes/1024).toFixed(1)+' KB';
  return (bytes/1048576).toFixed(1)+' MB';
}
function jfBooksFolderLabel(dir){return dir==='root'?'根目录':dir.split('/').slice(-1)[0];}
function jfBooksFiltered(){
  const q=document.getElementById('jfBooksSearch').value.trim().toLocaleLowerCase();
  return jfBooks.filter(b=>(jfBooksFolder==='all'||b.relativeDir===jfBooksFolder||
    (jfBooksFolder!=='root'&&b.relativeDir.startsWith(jfBooksFolder+'/'))) &&
    (!q||(b.title+' '+b.name+' '+b.ext+' '+b.relativeDir).toLocaleLowerCase().includes(q)));
}
function jfBooksReadingState(book){
  const p=jfDeskWorkspace?.progress?.[book.id];
  if(!p||!Number.isSafeInteger(p.chapter)||p.chapter<0)return null;
  const fraction=Number.isSafeInteger(p.total)&&p.total>0?
    Math.max(0,Math.min(100,Math.round((p.chapter+Math.max(0,Math.min(1,Number(p.ratio)||0)))/p.total*100))):null;
  return {fraction,label:fraction===null?'继续 · 第 '+(p.chapter+1)+' 节':fraction+'% · 继续阅读'};
}
function jfBooksRender(){
  const visible=jfBooksFiltered();
  const folders=document.getElementById('jfBooksFolders');folders.replaceChildren();
  const folderNames=['all',...new Set(jfBooks.map(b=>b.relativeDir))];
  folderNames.sort((a,b)=>a==='all'?-1:b==='all'?1:a==='root'?-1:b==='root'?1:a.localeCompare(b,'zh-CN',{numeric:true}));
  if(!folderNames.includes(jfBooksFolder))jfBooksFolder='all';
  folders.hidden=folderNames.length<=2;
  for(const dir of folderNames){
    const b=document.createElement('button');b.type='button';b.className='jfBooksFolder'+(jfBooksFolder===dir?' selected':'');
    b.textContent=dir==='all'?'全部书籍':jfBooksFolderLabel(dir);
    b.title=dir==='all'?'全部目录':dir;
    b.setAttribute('aria-pressed',String(jfBooksFolder===dir));
    b.addEventListener('click',()=>{jfBooksFolder=dir;jfBooksLimit=120;jfBooksRender();});
    folders.append(b);
  }
  const grid=document.getElementById('jfBooksGrid');grid.replaceChildren();
  const frag=document.createDocumentFragment();
  for(const book of visible.slice(0,jfBooksLimit)){
    const btn=document.createElement('button');btn.type='button';btn.className='jfBookTile';btn.title=book.name;
    const cover=document.createElement('span');cover.className='jfBookCover';
    const hue=Number.parseInt(book.id.slice(0,4),16)%360;
    cover.style.setProperty('--jf-book-hue',String(hue));
    const line=document.createElement('span');line.className='jfBookCoverLine';
    const monogram=document.createElement('span');monogram.className='jfBookCoverText';monogram.textContent=book.title;
    const tag=document.createElement('span');tag.className='jfBookCoverFormat';tag.textContent=book.ext;
    cover.append(line,monogram,tag);
    if(book.ext==='PDF'){
      // PDF.js paints the first *real page* on the client, on every OS.
      // Only visible cards are rendered; OS-specific PDF tools are not required.
      jfPdfJsObserveCover(book,cover);
    }else if(book.coverName){
      const preview=document.createElement('img');preview.className='jfBookCoverImage';preview.loading='lazy';
      preview.alt='';preview.decoding='async';preview.referrerPolicy='same-origin';
      preview.src='/api/books/cover?id='+encodeURIComponent(book.id);
      preview.onerror=()=>preview.remove();cover.prepend(preview);
    }
    const reading=jfBooksReadingState(book);
    if(reading){const state=document.createElement('span');state.className='jfBookReadingLabel';state.textContent=reading.label;cover.append(state);
      if(reading.fraction!==null){const rail=document.createElement('span');rail.className='jfBookReadingTrack';const fill=document.createElement('span');fill.style.width=reading.fraction+'%';rail.append(fill);cover.append(rail);}}
    const title=document.createElement('span');title.className='jfBookTileTitle';title.textContent=book.title;
    btn.append(cover,title);
    btn.addEventListener('click',()=>jfDeskOpenReader(book.id));
    const tileWrap=document.createElement('div');tileWrap.className='jfBookTileWrap';tileWrap.append(btn);
    const remove=document.createElement('button');remove.type='button';remove.className='jfBookTileRemove';
    remove.title='删除书籍';remove.setAttribute('aria-label','删除书籍：'+book.title);remove.textContent='×';
    remove.addEventListener('click',async event=>{event.preventDefault();event.stopPropagation();await jfBooksConfirmDelete(book,remove);});
    tileWrap.append(remove);frag.append(tileWrap);
  }
  grid.append(frag);
  document.getElementById('jfBooksMore').hidden=visible.length<=jfBooksLimit;
  document.getElementById('jfBooksCount').textContent=visible.length>jfBooksLimit?'已展示 '+jfBooksLimit+' / '+visible.length+' 本':'';
  const empty=document.getElementById('jfBooksEmpty');empty.hidden=visible.length>0;
  empty.querySelector('strong').textContent=jfBooks.length?'没有匹配的书籍':'这里还没有书';
  empty.querySelector('span').textContent=jfBooks.length?'尝试更换搜索词或目录':'把 PDF、EPUB、TXT 或 Markdown 放进当前媒体目录即可。';
}
function jfBooksShowDetail(book){
  jfBookDetailSelected=book;
  const panel=document.getElementById('jfBookDetail');
  document.getElementById('jfBookDetailName').textContent=book.title;
  document.getElementById('jfBookDetailInfo').textContent=book.ext+' · '+jfBooksFormat(book.size)+' · '+new Date(book.modified).toLocaleDateString('zh-CN');
  document.getElementById('jfBookDetailDir').textContent='目录：'+(book.relativeDir==='root'?'根目录':book.relativeDir);
  const progress=jfBooksReadingState(book);document.getElementById('jfBookDetailRead').firstChild.textContent=progress?'继续阅读 ':'开始阅读 ';
  const art=document.getElementById('jfBookDetailArt');
  art.style.setProperty('--jf-book-hue',String(Number.parseInt(book.id.slice(0,4),16)%360));art.textContent=book.title;
  panel.hidden=false;document.getElementById('jfBookDetailClose').focus();
}
function jfBooksHideDetail(){document.getElementById('jfBookDetail').hidden=true;}
async function jfBooksLoad(force=false){
  if(jfBooksLoading){
    if(force)jfBooksRefreshQueued=true;
    return;
  }
  jfBooksLoading=true;
  const epoch=++jfBooksEpoch;
  const status=document.getElementById('jfBooksSummary');
  if(force||!jfBooks.length)status.textContent='扫描当前工作目录…';
  try{
    const response=await fetch('/api/books'+(force?'?refresh=1':''),{cache:'no-store'});
    if(!response.ok)throw Error('扫描接口返回 '+response.status);
    const result=await response.json();if(!result.ok)throw Error(result.error||'未知错误');
    if(epoch!==jfBooksEpoch||!document.body.classList.contains('jfBooksMode'))return;
    // Polling must not tear down all covers every 20s when nothing changed.
    const signature=JSON.stringify(result.books.map(b=>[b.id,b.modified,b.size,b.coverName]));
    const changed=signature!==jfBooksSignature;
    jfBooks=result.books;jfBooksSignature=signature;
    status.textContent=result.total+' 本书'+(result.truncated?' · 扫描达到安全上限':'')+(result.skipped?' · 部分目录不可读取':'');
    if(changed)jfBooksRender();
  }catch(error){if(epoch===jfBooksEpoch && document.body.classList.contains('jfBooksMode'))status.textContent='扫描失败：'+error.message;}
  finally{
    jfBooksLoading=false;
    const refresh=jfBooksRefreshQueued;
    jfBooksRefreshQueued=false;
    if(refresh && document.body.classList.contains('jfBooksMode'))void jfBooksLoad(true);
  }
}
function jfOpenBooks(mode='books'){
  if(document.body.classList.contains('jfBooksMode')){jfBooksSetMode(mode);return;}
  // End the photo workspace before entering Books/Notes. A stale visible
  // toolbar can activate :has(#photoToolbar:not([hidden])) gallery layout rules
  // and leak album tiles into the bookshelf even when the grid is hidden.
  document.getElementById('photoToolbar').hidden=true;
  if(photoObserver){photoObserver.disconnect();photoObserver=null;}
  jfBooksRoot.hidden=false;document.body.classList.add('jfBooksMode');
  jfBooksSetMode(mode);
  document.querySelector('#studioModeTitle').textContent=mode==='notes'?'笔记':'书房';
  document.querySelectorAll('[data-media-kind]').forEach(el=>{const on=el.dataset.mediaKind===mode;el.classList.toggle('on',on);el.setAttribute('aria-selected',String(on));});
  jfBooksFolder='all';jfBooksLimit=120;document.getElementById('jfBooksSearch').value='';
  jfBooksLoad(true);
  jfDeskLoadWorkspace();
  jfBooksPoll=setInterval(()=>{if(!document.hidden && document.body.classList.contains('jfBooksMode'))jfBooksLoad();},20000);
}
async function jfCloseBooks(){
  if(!document.body.classList.contains('jfBooksMode'))return true;
  // Failed note save must not let tab navigation hide unsaved text.
  if(!await jfDeskCloseReader())return false;
  jfBooksHideDetail();clearInterval(jfBooksPoll);jfBooksPoll=null;++jfBooksEpoch;
  jfBooksRefreshQueued=false;
  document.body.classList.remove('jfBooksMode','jfNotesMode');jfBooksRoot.hidden=true;
  return true;
}
function jfBooksSetMode(mode){
  const notes=mode==='notes';document.body.classList.toggle('jfNotesMode',notes);
  document.querySelector('#studioModeTitle').textContent=notes?'笔记':'书房';
  document.querySelectorAll('[data-media-kind]').forEach(el=>{const on=el.dataset.mediaKind===mode;el.classList.toggle('on',on);el.setAttribute('aria-selected',String(on));});
  const q=document.getElementById('jfBooksSearch');q.placeholder=notes?'搜索笔记':'搜索书名、格式、目录';q.value='';
  document.getElementById('jfDeskSearchNotes').value='';
  if(notes){jfDeskOpenNotes();jfDeskRenderNotes();}
  else if(!jfReader.hidden){jfDeskOpenNotes();}
  else if(!jfNotesPanel.hidden){jfDeskCloseNotes();}
  if(!notes && jfBooks.length)jfBooksRender();
}
document.getElementById('jfBooksSearch').addEventListener('input',()=>{
  if(document.body.classList.contains('jfNotesMode')){
    document.getElementById('jfDeskSearchNotes').value=document.getElementById('jfBooksSearch').value;
    jfDeskRenderNotes();
  }else{jfBooksLimit=120;jfBooksRender();}
});
document.getElementById('jfBooksRefresh').addEventListener('click',()=>jfBooksLoad(true));
document.getElementById('jfBooksMore').addEventListener('click',()=>{jfBooksLimit+=120;jfBooksRender();});
document.getElementById('jfBookDetailClose').addEventListener('click',jfBooksHideDetail);
document.getElementById('jfBookDetail').addEventListener('click',e=>{if(e.target===e.currentTarget)jfBooksHideDetail();});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && !document.getElementById('jfBookDetail').hidden){jfBooksHideDetail();e.preventDefault();e.stopImmediatePropagation();}
},true);

document.getElementById('jfBookDetailRead').addEventListener('click',()=>{if(jfBookDetailSelected){jfBooksHideDetail();jfDeskOpenReader(jfBookDetailSelected.id);}});

async function jfBooksConfirmDelete(book,button){
  if(!book||!window.confirm('永久删除书籍「'+book.title+'」？\n原始文件将被删除，此操作不可撤销。关联笔记和摘录会保留。'))return;
  button.disabled=true;
  try{
    const response=await fetch('/api/books/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:book.id})});
    const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'删除失败');
    jfBooksHideDetail();await jfBooksLoad(true);
  }catch(error){alert('删除书籍失败：'+error.message);}finally{button.disabled=false;}
}
document.getElementById('jfBookDetailDelete').addEventListener('click',async e=>{
  await jfBooksConfirmDelete(jfBookDetailSelected,e.currentTarget);
});
