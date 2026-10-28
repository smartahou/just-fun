
function syncUnifiedTiles() {
  document.querySelectorAll('#grid [data-media-key]').forEach(el=>{
    const key=el.dataset.mediaKey;
    el.draggable=true;
    el.classList.toggle('unifiedSelected',mediaSelectedKeys.has(key));
    el.classList.toggle('selected',mediaSelectedKeys.has(key)&&libraryMode==='image');
    const check=el.querySelector('.mediaTileCheck');
    if(check)check.setAttribute('aria-pressed',String(mediaSelectedKeys.has(key)));
  });
  syncUnifiedControls();
}
function setUnifiedSelectMode(active) {
  hideUnifiedContext();
  mediaSelectMode=!!active;
  photoSelectMode=!!active && libraryMode==='image';
  mediaSelectedKeys.clear();unifiedLastSelectedKey=null;
  if(libraryMode==='image')syncPhotoSelectionUI();
  syncUnifiedControls();
  syncUnifiedTiles();
}
function toggleUnifiedSelection(key,shift=false) {
  if(!mediaSelectMode)setUnifiedSelectMode(true);
  const list=unifiedVisibleItems().map(x=>x.key);
  if(shift&&unifiedLastSelectedKey&&list.includes(key)&&list.includes(unifiedLastSelectedKey)) {
    const from=list.indexOf(unifiedLastSelectedKey),to=list.indexOf(key);
    for(const k of list.slice(Math.min(from,to),Math.max(from,to)+1))mediaSelectedKeys.add(k);
  } else if(mediaSelectedKeys.has(key))mediaSelectedKeys.delete(key);
  else mediaSelectedKeys.add(key);
  unifiedLastSelectedKey=key;
  syncUnifiedTiles();
}
// 影格 Studio 统一线性图标：与播放器工具栏同为 24px 视口、1.75px 描边。
function studioIcon(name) {
  const paths={
    multi:'<rect x="5" y="5" width="11" height="11" rx="2"/><path d="M9 9h10v10H9"/>',
    portrait:'<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    clips:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    link:'<path d="M10 14a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1 1M14 10a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1-1"/>',
    magnify:'<circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 5 5"/>',
    rotate:'<path d="M20 8v-5l-4 4a8 8 0 1 0 4 6"/>',
    play:'<path d="m8 5 11 7-11 7z"/>',
    minus:'<path d="M5 12h14"/>',
    image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 4 3 3-4 4 6"/>',
    audio:'<path d="M10 18V5l10-2v13"/><ellipse cx="7" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
    rename:'<path d="m4 16 12-12 4 4L8 20H4zM13 7l4 4"/>',
    favorite:'<path d="m12 2 3 6.4 7 .9-5.1 4.9 1.2 7L12 18l-6.1 3.2 1.2-7L2 9.3l7-.9z"/>',
    export:'<path d="M12 3v13m-5-5 5 5 5-5M4 18v3h16v-3"/>',
    move:'<path d="M4 5h8l2 3h6v12H4zM10 14h7m-3-3 3 3-3 3"/>',
    select:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
    delete:'<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    folder:'<path d="M3 6h7l2 2h9v11H3z"/>',
    repeat:'<path d="M3 8V5h12a5 5 0 0 1 5 5v1m-3-3 3 3 3-3M21 16v3H9a5 5 0 0 1-5-5v-1m3 3-3-3-3 3"/>',
    scissors:'<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="m8 8 12 12M8 16 20 4"/>',
    volume:'<path d="M4 9v6h4l5 4V5L8 9zM17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
    mute:'<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6m0-6-5 6"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.select)+'</svg>';
}
function studioMenuItem(action,label,icon,extraAttr) {
  return '<button type="button" role="menuitem" '+extraAttr+' class="studioMenuRow'+(action==='delete'?' danger':'')+'"><span class="studioMenuIcon">'+studioIcon(icon)+'</span><span class="studioMenuLabel">'+esc(label)+'</span></button>';
}
async function jfTranscodeDialog(item){
  try{
    const response=await fetch('/api/video-compat?key='+encodeURIComponent(item.key),{cache:'no-store'});
    const info=await response.json();
    if(!response.ok||!info.ok)throw new Error(info.error||'检测失败');
    const detail=[info.container.toUpperCase(),info.videoCodec,info.audioCodec||'无音轨',info.pixelFormat].filter(Boolean).join(' · ');
    const recommendation=info.suggest==='copy'?'仅重封装（无画质损失）':'H.264 高质量兼容编码（有损但尽量保真）';
    if(!confirm('视频兼容性检测\n'+detail+'\n建议：'+recommendation+'\n\n原文件绝不覆盖，新文件将存入 data 目录。\n注意：内嵌字幕和附加数据轨不会复制。\n是否继续？'))return;
    // Auto remux when appropriate; full encode always available for stuttering files.
    const force=info.suggest==='copy' && confirm('当前视频的编码可直接复制。\n点击“确定”：强制 H.264 重新编码（用于卡顿/解码异常）\n点击“取消”：无损重封装。');
    const result=await jfTrackedMediaPost('/api/video-transcode',{key:item.key,mode:force?'encode':'auto'},'优化视频兼容性');
    lastStamp='';await load();
    unifiedToast(result.method==='copy'?'已无损重封装为 MP4':'已生成高质量兼容 MP4');
  }catch(error){alert('处理失败：'+(error.message||error));}
}
function hideUnifiedContext() {const menu=document.querySelector('#unifiedContext');if(menu)menu.hidden=true;}
function showUnifiedContext(key,x,y) {
  const item=allItems.find(v=>v.key===key);
  if(!item)return;
  const menu=document.querySelector('#unifiedContext');
  menu.dataset.key=key;
  // 视频双击即播；图片与音频保留各自的查看/播放入口，避免顺带削减其它媒体类型的操作。
  const buttons=[
    ...(item.kind==='image'?[['open','查看图片','image']]:item.kind==='audio'?[['open','播放音频','volume']]:[]),
    ...(['.mp4','.mov','.m4v'].includes(String(item.originalExt||'').toLowerCase())?[[ 'livephoto',item.livePhoto?'恢复普通视频':'设为实况照片','image' ]]:[]),
    ...(item.kind==='video'?[['transcode','兼容性检测 / 转码','rotate']]:[]),
    ...(!item.readOnly?[['rename','重命名','rename'],['move','移动到目录','move']]:[]),
    ['delete','永久删除文件','delete']
  ];
  menu.innerHTML='<div class="contextHeading" title="'+esc(unifiedMediaName(item))+'">'+esc(unifiedMediaName(item))+'</div>'+ 
    buttons.map(([action,label,icon])=>studioMenuItem(action,label,icon,'data-context-action="'+action+'"')).join('');
  menu.hidden=false;
  const width=menu.offsetWidth||210,height=menu.offsetHeight||225;
  menu.style.left=Math.max(8,Math.min(x,window.innerWidth-width-8))+'px';
  menu.style.top=Math.max(8,Math.min(y,window.innerHeight-height-8))+'px';
  menu.querySelector('button')?.focus({preventScroll:true});
}
function hideUnifiedRename() {document.querySelector('#unifiedRenameBack').hidden=true;unifiedRenameKey=null;}

// Directory management: move existing hash-named files without rewriting their bytes.
let unifiedMoveKeys=[];
function unifiedFolderOptions() {
  const folders=[{relativeDir:'root',name:'原媒体目录'},{relativeDir:'data',name:'data'},...allFolders.filter(x=>x.relativeDir.startsWith('data/') && x.state!=='pending').map(x=>({relativeDir:x.relativeDir,name:unifiedFolderPath(x.relativeDir)}))];
  return folders.sort((a,b)=>a.relativeDir==='data'?-1:b.relativeDir==='data'?1:a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
}
function unifiedFolderPath(dir) {
  if(dir==='root')return '原媒体目录';
  const parts=String(dir).split('/');
  return parts.map((part,index)=>index===0?'data':folderDisplayName(parts.slice(0,index+1).join('/'))).join(' / ');
}
function openUnifiedMove(keys) {
  const valid=[...new Set(keys)].filter(k=>allItems.some(x=>x.key===k));
  if(!valid.length)return;
  if(valid.length>300){unifiedToast('一次最多移动 300 个文件，请分批选择');return;}
  hideUnifiedContext();unifiedMoveKeys=valid;
  // Moving is intentionally different from browsing: show every target, including
  // empty managed albums; display read-only work sources for context, but never
  // send unsupported source destinations to the file-moving API.
  const targets=[...unifiedFolderOptions(),
    ...allFolders.filter(x=>x.readOnly===true&&!unifiedFolderOptions().some(y=>y.relativeDir===x.relativeDir))
      .map(x=>({relativeDir:x.relativeDir,name:folderDisplayName(x.relativeDir)+' · 只读来源',disabled:true}))];
  const select=document.querySelector('#unifiedMoveTarget');
  select.innerHTML=targets.map(x=>'<option value="'+esc(x.relativeDir)+'"'+(x.disabled?' disabled':'')+'>'+esc(x.name)+'</option>').join('');
  if(targets.some(x=>x.relativeDir===activeFolder&&!x.disabled))select.value=activeFolder;
  else select.value='data';
  document.querySelector('#unifiedMoveSummary').textContent='移动 '+valid.length+' 个文件到指定目录。文件会移动，名称保持不变。';
  document.querySelector('#unifiedMoveBack').hidden=false;
  select.focus();
}
function closeUnifiedMove(){document.querySelector('#unifiedMoveBack').hidden=true;unifiedMoveKeys=[];}
async function unifiedCommitMove(keys,target){
  if(!keys.length)return;
  const response=await mediaPost('/api/media-move',{keys,target});
  if(activeAudioKey&&keys.includes(activeAudioKey)){/* media URL is stable; leave player mounted */}
  closeUnifiedMove();setUnifiedSelectMode(false);
  lastStamp='';await load();
  unifiedToast(response.moved+' 个文件已移动至 '+unifiedFolderPath(target));
}
let unifiedAlbumRenameDir='';
function openUnifiedAlbum(){
  unifiedAlbumRenameDir='';
  document.querySelector('#unifiedAlbumHeading').textContent='新建相簿 / 文件夹';
  document.querySelector('#unifiedAlbumHelp').textContent='媒体目录名称与当前管理模式一致。';
  document.querySelector('#unifiedAlbumParentLabel').hidden=false;
  document.querySelector('#unifiedAlbumParent').required=true;
  document.querySelector('#unifiedAlbumSubmit').textContent='新建';
  const options=unifiedFolderOptions().filter(x=>x.relativeDir!=='root');
  const select=document.querySelector('#unifiedAlbumParent');
  select.innerHTML=options.map(x=>'<option value="'+esc(x.relativeDir)+'">'+esc(x.name)+'</option>').join('');
  if(options.some(x=>x.relativeDir===activeFolder))select.value=activeFolder;
  document.querySelector('#unifiedAlbumBack').hidden=false;
  const input=document.querySelector('#unifiedAlbumName');input.value='';input.focus();
}
function openUnifiedAlbumRename(dir){
  const folder=allFolders.find(f=>f.relativeDir===dir);
  if(!folder)return;
  hideUnifiedContext();
  unifiedAlbumRenameDir=dir;
  document.querySelector('#unifiedAlbumHeading').textContent='重命名文件夹';
  document.querySelector('#unifiedAlbumHelp').textContent='修改目录名称。';
  document.querySelector('#unifiedAlbumParentLabel').hidden=true;
  document.querySelector('#unifiedAlbumParent').required=false;
  document.querySelector('#unifiedAlbumSubmit').textContent='保存';
  const input=document.querySelector('#unifiedAlbumName');input.value=folder.originalName;
  document.querySelector('#unifiedAlbumBack').hidden=false;input.focus();input.select();
}
function closeUnifiedAlbum(){document.querySelector('#unifiedAlbumBack').hidden=true;unifiedAlbumRenameDir='';}
document.querySelector('#unifiedMoveCancel').onclick=closeUnifiedMove;
document.querySelector('#unifiedMoveBack').addEventListener('click',e=>{if(e.target.id==='unifiedMoveBack')closeUnifiedMove();});
document.querySelector('#unifiedMoveForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;
  try{await unifiedCommitMove(unifiedMoveKeys,document.querySelector('#unifiedMoveTarget').value);}
  catch(error){alert('移动失败：'+(error.message||error));}
  finally{button.disabled=false;}
});
document.querySelector('#unifiedAlbumCancel').onclick=closeUnifiedAlbum;
document.querySelector('#unifiedAlbumBack').addEventListener('click',e=>{if(e.target.id==='unifiedAlbumBack')closeUnifiedAlbum();});
document.querySelector('#unifiedAlbumForm').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.currentTarget.querySelector('[type=submit]');button.disabled=true;
  try{
    const rename=unifiedAlbumRenameDir;
    const result=rename
      ? await mediaPost('/api/folder-rename',{relativeDir:rename,name:document.querySelector('#unifiedAlbumName').value.trim()})
      : await mediaPost('/api/folder-create',{parent:document.querySelector('#unifiedAlbumParent').value,name:document.querySelector('#unifiedAlbumName').value.trim()});
    closeUnifiedAlbum();lastStamp='';await load();if(!rename)rememberMediaFolder(result.relativeDir);render();
    unifiedToast((rename?'已重命名：':'已创建：')+result.originalName);
  }catch(error){alert('创建目录失败：'+(error.message||error));}
  finally{button.disabled=false;}
});
// Dragging selected files onto album tiles or breadcrumb buttons triggers one batch move.
let unifiedDragKeys=[];
document.querySelector('#grid').addEventListener('dragstart',event=>{
  if(event.target.closest('button,input,[data-media-more]')&&!event.target.closest('.pictureTile'))return;
  const tile=event.target.closest('[data-media-key]');if(!tile)return;
  const key=tile.dataset.mediaKey;
  unifiedDragKeys=mediaSelectMode&&mediaSelectedKeys.has(key)?[...mediaSelectedKeys]:[key];
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain','douyin-media:'+unifiedDragKeys.join(','));
  document.body.classList.add('unifiedDragging');
});
document.querySelector('#grid').addEventListener('dragend',()=>{
  unifiedDragKeys=[];document.body.classList.remove('unifiedDragging');
  document.querySelectorAll('.unifiedDropTarget').forEach(el=>el.classList.remove('unifiedDropTarget'));
});
for(const selector of ['#folderTiles','#assetFolders']){
  const root=document.querySelector(selector);
  root.addEventListener('dragover',event=>{
    const target=event.target.closest('[data-open-folder]');
    if(!target||!unifiedDragKeys.length||!unifiedFolderOptions().some(x=>x.relativeDir===target.dataset.openFolder))return;
    event.preventDefault();event.dataTransfer.dropEffect='move';target.classList.add('unifiedDropTarget');
  });
  root.addEventListener('dragleave',event=>{
    const target=event.target.closest('[data-open-folder]');if(target)target.classList.remove('unifiedDropTarget');
  });
  root.addEventListener('drop',async event=>{
    const target=event.target.closest('[data-open-folder]');
    if(!target||!unifiedDragKeys.length)return;
    event.preventDefault();event.stopPropagation();
    const keys=unifiedDragKeys.slice(),dest=target.dataset.openFolder;
    unifiedDragKeys=[];document.body.classList.remove('unifiedDragging');
    document.querySelectorAll('.unifiedDropTarget').forEach(el=>el.classList.remove('unifiedDropTarget'));
    if(!unifiedFolderOptions().some(x=>x.relativeDir===dest))return;
    if(keys.every(k=>(allItems.find(x=>x.key===k)?.relativeDir||'root')===dest)){unifiedToast('文件已经在当前目录');return;}
    if(!confirm('将 '+keys.length+' 个文件移动到「'+unifiedFolderPath(dest)+'」？'))return;
    try{await unifiedCommitMove(keys,dest);}catch(error){alert('移动失败：'+(error.message||error));}
  });
}

function openUnifiedRename(key) {
  const item=allItems.find(x=>x.key===key);if(!item)return;
  hideUnifiedContext();
  unifiedRenameKey=key;
  const ext=String(item.originalExt||'');
  const current=unifiedMediaName(item);
  document.querySelector('#unifiedRenameInput').value=ext&&current.toLowerCase().endsWith(ext.toLowerCase())?current.slice(0,-ext.length):current;
  document.querySelector('#unifiedRenameExt').textContent=ext;
  document.querySelector('#unifiedRenameBack').hidden=false;
  document.querySelector('#unifiedRenameHeading').textContent='重命名'+({video:'视频',image:'图片',audio:'音频'}[item.kind]||'文件');
  const input=document.querySelector('#unifiedRenameInput');input.focus();input.select();
}
async function updateUnifiedFavorite(keys,favorite) {
  if(!keys.length)return;
  try {
    for(let i=0;i<keys.length;i+=500)await mediaPost('/api/media-favorite',{keys:keys.slice(i,i+500),favorite});
    const set=new Set(keys);allItems.forEach(x=>{if(set.has(x.key))x.favorite=favorite;});
    // Only the list is rebuilt; persistent audio playback stays in #audioDock.
    render();unifiedToast(favorite?'已收藏':'已取消收藏');
  }catch(error){alert('收藏失败：'+(error.message||error));}
}
function exportUnifiedMedia(key) {
  const item=allItems.find(x=>x.key===key);if(!item)return;
  const a=document.createElement('a');a.href=item.mediaUrl;
  a.download=unifiedMediaName(item);document.body.appendChild(a);a.click();a.remove();
  unifiedToast('已请求导出：'+unifiedMediaName(item));
}
async function deleteUnifiedMedia(keys) {
  const list=[...new Set(keys)].filter(key=>allItems.some(x=>x.key===key));
  if(!list.length)return;
  if(!confirm('永久删除选中的 '+list.length+' 个文件？\n包括工作目录中的原始媒体文件，直接删除且不进入回收站。'))return;
  try{
    let deleted=0,failures=0;
    for(let i=0;i<list.length;i+=300){
      const result=await mediaPost('/api/media-delete-batch',{keys:list.slice(i,i+300)});
      deleted+=result.deleted||0;failures+=(result.failed||[]).length;
    }
    if(activeAudioKey&&list.includes(activeAudioKey))closeAudioDock();
    if(libraryMode==='image'&&document.querySelector('#assetView').classList.contains('open'))hideImageViewer();
    mediaSelectedKeys.clear();setUnifiedSelectMode(false);
    lastStamp='';await load();
    unifiedToast(deleted+' 个文件已删除'+(failures?'，'+failures+' 个失败':''));
  }catch(error){lastStamp='';await load();alert('删除失败：'+(error.message||error));}
}
async function unifiedContextAction(action,key) {
  hideUnifiedContext();
  const item=allItems.find(x=>x.key===key);if(!item)return;
  if(action==='open'){
    if(item.kind==='video')openFeed(key);
    else if(item.kind==='audio')openAudioDock(key);
    else if(item.kind==='image'){
      if(libraryMode!=='image')return;
      const index=imageViewerList.findIndex(x=>x.key===key);if(index>=0)showImageViewer(index);
    }
    return;
  }
  if(action==='livephoto'){
    try{
      const response=await mediaPost('/api/media-live-photo',{key,enabled:!item.livePhoto});
      if(!response.ok)throw Error(response.error||'保存失败');
      hideImageViewer();lastStamp='';await load();
      unifiedToast(response.item?.livePhoto?'已加入图片 · 实况照片':'已恢复到视频');
    }catch(e){unifiedToast('实况照片设置失败：'+e.message);}
    return;
  }
  if(action==='transcode'){await jfTranscodeDialog(item);return;}
  if(item.readOnly && ['rename','move'].includes(action)){unifiedToast('来源目录仅允许删除媒体，不能移动或重命名');return;}
  if(action==='rename'){openUnifiedRename(key);return;}
  if(action==='move'){openUnifiedMove([key]);return;}
  if(action==='favorite'){await updateUnifiedFavorite([key],!item.favorite);return;}
  if(action==='export'){exportUnifiedMedia(key);return;}
  if(action==='select'){setUnifiedSelectMode(true);toggleUnifiedSelection(key);return;}
  if(action==='delete'){await deleteUnifiedMedia([key]);return;}
}

// Capture-level delegation: prevent the video feed, photo viewer or audio playback from opening
// when the user is selecting files. Ignore browser-native editing inputs and controls.
document.querySelector('#grid').addEventListener('click',event=>{
  if(Date.now()<unifiedSuppressClickUntil){event.preventDefault();event.stopImmediatePropagation();return;}
  const more=event.target.closest('[data-media-more]');
  if(more) {
    event.preventDefault();event.stopImmediatePropagation();
    const r=more.getBoundingClientRect();showUnifiedContext(more.dataset.mediaMore,r.left,r.bottom+6);return;
  }
  if(!mediaSelectMode&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey)return;
  const tile=event.target.closest('[data-media-key]');if(!tile)return;
  event.preventDefault();event.stopImmediatePropagation();
  toggleUnifiedSelection(tile.dataset.mediaKey,event.shiftKey);
},true);
document.querySelector('#grid').addEventListener('dblclick',event=>{
  if(!mediaSelectMode)return;
  const tile=event.target.closest('[data-media-key]');if(tile){event.preventDefault();event.stopImmediatePropagation();}
},true);
document.querySelector('#grid').addEventListener('pointerdown',event=>{
  if(!mediaSelectMode)return;
  if(event.target.closest('[data-media-key]')){event.stopImmediatePropagation();}
},true);
document.querySelector('#grid').addEventListener('contextmenu',event=>{
  const tile=event.target.closest('[data-media-key]');if(!tile)return;
  event.preventDefault();showUnifiedContext(tile.dataset.mediaKey,event.clientX,event.clientY);
});
let unifiedLongPress=null;
document.querySelector('#grid').addEventListener('pointerdown',event=>{
  if(event.pointerType==='mouse'||mediaSelectMode)return;
  const tile=event.target.closest('[data-media-key]');if(!tile||event.target.closest('button,input,[data-media-more]'))return;
  const x=event.clientX,y=event.clientY;
  unifiedLongPress={x,y,timer:setTimeout(()=>{
    unifiedLongPress=null;unifiedSuppressClickUntil=Date.now()+550;showUnifiedContext(tile.dataset.mediaKey,x,y);
  },650)};
});
document.querySelector('#grid').addEventListener('pointermove',event=>{
  if(unifiedLongPress&&(Math.abs(event.clientX-unifiedLongPress.x)>12||Math.abs(event.clientY-unifiedLongPress.y)>12)){
    clearTimeout(unifiedLongPress.timer);unifiedLongPress=null;
  }
});
for(const name of ['pointerup','pointercancel','pointerleave'])
  document.querySelector('#grid').addEventListener(name,()=>{
    if(unifiedLongPress){clearTimeout(unifiedLongPress.timer);unifiedLongPress=null;}
  });
document.querySelector('#unifiedContext').addEventListener('click',event=>{
  const folderAction=event.target.closest('[data-folder-context-action]');
  if(folderAction){
    const dir=document.querySelector('#unifiedContext').dataset.folderDir;hideUnifiedContext();
    if(folderAction.dataset.folderContextAction==='rename')openUnifiedAlbumRename(dir);
    else {rememberMediaFolder(dir);setUnifiedSelectMode(false);render();}
    return;
  }
  const action=event.target.closest('[data-context-action]');if(action)unifiedContextAction(action.dataset.contextAction,document.querySelector('#unifiedContext').dataset.key);
});
document.querySelector('#unifiedSelectTop').onclick=()=>setUnifiedSelectMode(!mediaSelectMode);
document.querySelector('#unifiedFavoriteFilter').onclick=()=>{unifiedFavoriteOnly=!unifiedFavoriteOnly;setUnifiedSelectMode(false);render();};
document.querySelector('#unifiedFinish').onclick=()=>setUnifiedSelectMode(false);
document.querySelector('#unifiedSelectAll').onclick=()=>{
  unifiedVisibleItems().forEach(item=>mediaSelectedKeys.add(item.key));syncUnifiedTiles();
};
document.querySelector('#unifiedFavorite').onclick=()=>{
  const items=[...mediaSelectedKeys].map(k=>allItems.find(x=>x.key===k)).filter(Boolean);
  updateUnifiedFavorite(items.map(x=>x.key),!items.every(x=>x.favorite));
};
document.querySelector('#unifiedExport').onclick=()=>{
  if(mediaSelectedKeys.size===1)exportUnifiedMedia([...mediaSelectedKeys][0]);
};
document.querySelector('#unifiedDelete').onclick=()=>deleteUnifiedMedia([...mediaSelectedKeys]);
document.querySelector('#unifiedMove').onclick=()=>openUnifiedMove([...mediaSelectedKeys]);
document.querySelector('#unifiedRenameCancel').onclick=hideUnifiedRename;
document.querySelector('#unifiedRenameBack').addEventListener('click',event=>{
  if(event.target.id==='unifiedRenameBack')hideUnifiedRename();
});
document.querySelector('#unifiedRenameForm').addEventListener('submit',async event=>{
  event.preventDefault();const key=unifiedRenameKey;if(!key)return;
  const input=document.querySelector('#unifiedRenameInput');
  const button=event.target.querySelector('[type=submit]');
  const base=input.value.trim();if(!base){input.focus();return;}
  const ext=document.querySelector('#unifiedRenameExt').textContent;
  let full=base;
  if(ext&&!full.toLowerCase().endsWith(ext.toLowerCase()))full+=ext;
  button.disabled=true;
  try{
    const out=await mediaPost('/api/media-rename',{key,name:full});
    const item=allItems.find(x=>x.key===key);if(item)item.displayName=out.displayName;
    const current=activeAudioKey===key?document.querySelector('#audioDock .audioTitle'):null;
    if(current){current.textContent=full;current.title=full;}
    hideUnifiedRename();render();unifiedToast('已重命名');
  }catch(error){alert('重命名失败：'+(error.message||error));input.focus();}
  finally{button.disabled=false;}
});
document.addEventListener('pointerdown',event=>{
  if(!event.target.closest('#unifiedContext,[data-media-more]'))hideUnifiedContext();
});
document.addEventListener('keydown',event=>{
  const tag=event.target?.tagName;
  const editable=event.target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(tag);
  if(event.key==='Escape'){
    if(!document.querySelector('#unifiedMoveBack').hidden){closeUnifiedMove();event.preventDefault();return;}
    if(!document.querySelector('#unifiedAlbumBack').hidden){closeUnifiedAlbum();event.preventDefault();return;}
    if(!document.querySelector('#unifiedRenameBack').hidden){hideUnifiedRename();event.preventDefault();return;}
    if(!document.querySelector('#unifiedContext').hidden){hideUnifiedContext();event.preventDefault();return;}
    if(mediaSelectMode){setUnifiedSelectMode(false);event.preventDefault();return;}
  }
  if(editable||event.altKey)return;
  if(event.metaKey && !(mediaSelectMode&&event.key.toLowerCase()==='a'))return;
  if(event.key==='F2'){
    const folder=document.activeElement?.closest?.('#folderTiles [data-open-folder]');
    if(folder&&allFolders.some(f=>f.relativeDir===folder.dataset.openFolder)){event.preventDefault();openUnifiedAlbumRename(folder.dataset.openFolder);return;}
    const focused=document.activeElement?.closest?.('[data-media-key]');
    const key=focused?.dataset.mediaKey||(mediaSelectedKeys.size===1?[...mediaSelectedKeys][0]:null);
    if(key){event.preventDefault();event.stopImmediatePropagation();openUnifiedRename(key);}return;
  }
  if(mediaSelectMode && (event.key==='Enter'||event.key===' ') &&
     document.activeElement?.closest?.('#grid [data-media-key]')) {
    event.preventDefault();event.stopImmediatePropagation();
    toggleUnifiedSelection(document.activeElement.closest('[data-media-key]').dataset.mediaKey,event.shiftKey);return;
  }
  if(mediaSelectMode&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){
    event.preventDefault();unifiedVisibleItems().forEach(x=>mediaSelectedKeys.add(x.key));syncUnifiedTiles();return;
  }
  if(mediaSelectMode&&(event.key==='Delete'||event.key==='Backspace')&&mediaSelectedKeys.size){
    event.preventDefault();deleteUnifiedMedia([...mediaSelectedKeys]);
  }
},true);

// The logo is the home shortcut. Delegate to the existing video tab handler
// so that search, filters, directory restoration and audio mode stay in sync.
const jfHomeBrand=document.querySelector('.studioBrandLogoOnly');
if(jfHomeBrand){
  jfHomeBrand.setAttribute('role','button');
  jfHomeBrand.tabIndex=0;
  jfHomeBrand.title='返回视频首页';
  jfHomeBrand.setAttribute('aria-label','返回视频首页');
  const goHome=()=>{
    if(document.querySelector('#feedOverlay.open'))closeFeed();
    document.querySelector('[data-media-kind="video"]')?.click();
  };
  jfHomeBrand.addEventListener('click',goHome);
  jfHomeBrand.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();goHome();}
  });
}
document.querySelectorAll('[data-media-kind]').forEach(button=>{
  button.addEventListener('click',async()=>{
    if(button.dataset.mediaKind==='books'||button.dataset.mediaKind==='notes'){
      if(!jfReader.hidden && !await jfDeskCloseReader())return;
      if(document.body.classList.contains('jfNotesMode') && button.dataset.mediaKind==='books' && !await jfDeskCloseNotes())return;
      if(!document.body.classList.contains('jfBooksMode'))jfSaveMediaTabSession();
      jfOpenBooks(button.dataset.mediaKind);
      ++jfMediaTabRestoreToken; // do not restore a hidden media tab after an async exit
      window.scrollTo(0,0);
      return;}
    const leavingBooks=document.body.classList.contains('jfBooksMode');
    if(leavingBooks && !await jfCloseBooks())return;
    const switching=leavingBooks || button.dataset.mediaKind!==libraryMode;
    if(!leavingBooks && switching)jfSaveMediaTabSession();
    changeMediaCategory(button.dataset.mediaKind);
    if(switching)jfLoadMediaTabSession(libraryMode);
    syncAudioDockMode();
    hideUnifiedContext();
    render();
    if(switching)jfRestoreMediaTabScroll(libraryMode);
    document.querySelector('#status').textContent=allItems.filter(x=>x.kind===libraryMode).length+' 个'+
      ({video:'视频',image:'图片',audio:'音频'}[libraryMode]||'媒体')+' · 媒体管理';
  });
});
// v7.24 · Explicit media-tab shortcuts only. Alt+1…5 avoids Chrome's Ctrl+1…9
// tab navigation and leaves unmodified video/reader keys untouched.
// Delegate to the same click handlers as the visible rail: restores each
// media tab's directory, search/filter, selection and scroll session.
const jfMediaKeyboardKinds = ['video','image','audio','books','notes'];
for(let i=0;i<jfMediaKeyboardKinds.length;i++){
  const tab=document.querySelector('[data-media-kind="'+jfMediaKeyboardKinds[i]+'"]');
  if(tab){
    tab.title=(tab.title?tab.title+' · ':'')+'Alt+'+(i+1);
    tab.setAttribute('aria-keyshortcuts','Alt+'+(i+1));
  }
}
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented || event.repeat || event.isComposing || event.keyCode===229 ||
     !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
     event.getModifierState?.('AltGraph'))return;
  const index=/^Digit[1-5]$/.test(event.code)?Number(event.code.slice(5))-1:-1;
  if(index<0)return;
  const target=event.target;
  if(target?.closest?.('input,textarea,select,[contenteditable],[role="textbox"]'))return;
  if(document.fullscreenElement || document.webkitFullscreenElement ||
     !jfReader.hidden ||
     document.querySelector('#feedOverlay.open, #assetView.open, #jfPhotoCropDialog:not([hidden]), .shotStudioBack:not([hidden]), .portraitDialogBack:not([hidden]), #clipShelfBack:not([hidden]), .unifiedRenameBack:not([hidden]), .unifiedMoveBack:not([hidden]), .unifiedAlbumBack:not([hidden])'))return;
  const tab=document.querySelector('[data-media-kind="'+jfMediaKeyboardKinds[index]+'"]');
  if(!tab || tab.disabled)return;
  event.preventDefault();
  // Repeating the active shortcut must not reset the current page or search.
  if(tab.getAttribute('aria-selected')==='true')return;
  // A tab's click handler owns unsaved-note checks and page transitions.
  tab.click();
});

function showUnifiedFolderContext(dir,x,y){
  const folder=allFolders.find(f=>f.relativeDir===dir);
  if(!folder || folder.readOnly)return;
  const menu=document.querySelector('#unifiedContext');
  menu.dataset.folderDir=dir;delete menu.dataset.key;
  menu.innerHTML='<div class="contextHeading">'+esc(folder.originalName)+'</div>'+ 
    studioMenuItem('open','打开文件夹','folder','data-folder-context-action="open"')+
    (folder.readOnly?'':studioMenuItem('rename','重命名文件夹','rename','data-folder-context-action="rename"'));
  menu.hidden=false;
  const width=menu.offsetWidth||210,height=menu.offsetHeight||120;
  menu.style.left=Math.max(8,Math.min(x,window.innerWidth-width-8))+'px';
  menu.style.top=Math.max(8,Math.min(y,window.innerHeight-height-8))+'px';
  menu.querySelector('button')?.focus({preventScroll:true});
}
document.querySelector('#folderTiles').addEventListener('contextmenu',event=>{
  const folder=event.target.closest('[data-open-folder]')||event.target.closest('[data-folder-more]');
  if(!folder)return;
  const dir=folder.dataset.openFolder||folder.dataset.folderMore;
  if(!allFolders.some(f=>f.relativeDir===dir))return;
  event.preventDefault();showUnifiedFolderContext(dir,event.clientX,event.clientY);
});
// Touch devices: long-press a folder to open the same management menu as ⋯ / right click.
let unifiedFolderLongPress=null;
const folderTileRoot=document.querySelector('#folderTiles');
folderTileRoot.addEventListener('pointerdown',event=>{
  if(event.pointerType==='mouse'||event.target.closest('[data-folder-more]'))return;
  const tile=event.target.closest('[data-open-folder]');if(!tile)return;
  const dir=tile.dataset.openFolder;
  if(!allFolders.some(f=>f.relativeDir===dir))return;
  const x=event.clientX,y=event.clientY;
  unifiedFolderLongPress={x,y,timer:setTimeout(()=>{
    unifiedFolderLongPress=null;unifiedSuppressClickUntil=Date.now()+650;
    showUnifiedFolderContext(dir,x,y);
  },630)};
});
folderTileRoot.addEventListener('pointermove',event=>{
  if(unifiedFolderLongPress&&(Math.abs(event.clientX-unifiedFolderLongPress.x)>12||Math.abs(event.clientY-unifiedFolderLongPress.y)>12)){
    clearTimeout(unifiedFolderLongPress.timer);unifiedFolderLongPress=null;
  }
});
for(const eventName of ['pointerup','pointercancel','pointerleave'])
  folderTileRoot.addEventListener(eventName,()=>{
    if(unifiedFolderLongPress){clearTimeout(unifiedFolderLongPress.timer);unifiedFolderLongPress=null;}
  });
folderTileRoot.addEventListener('click',event=>{
  if(Date.now()<unifiedSuppressClickUntil){event.preventDefault();event.stopImmediatePropagation();return;}
  const more=event.target.closest('[data-folder-more]');
  if(more){const r=more.getBoundingClientRect();showUnifiedFolderContext(more.dataset.folderMore,r.left,r.bottom+6);return;}
  const folder=event.target.closest('[data-open-folder]');
  if(folder){rememberMediaFolder(folder.dataset.openFolder);setUnifiedSelectMode(false);render();}
});
document.querySelector('#assetFolders').addEventListener('click',event=>{
  const folder=event.target.closest('[data-open-folder]');
  if(folder){rememberMediaFolder(folder.dataset.openFolder);setUnifiedSelectMode(false);render();return;}
  if(event.target.id==='unifiedNewAlbum'){openUnifiedAlbum();return;}
  if(event.target.id==='fileSort'){fileSortAscending=!fileSortAscending;render();}
});
document.querySelector('#photoSelect').onclick=()=>setPhotoSelectionMode(!photoSelectMode);
document.querySelector('#photoCancelSelect').onclick=()=>setPhotoSelectionMode(false);
document.querySelector('#photoSelectAll').onclick=()=>{
  imageViewerList.forEach(x=>photoSelectedKeys.add(x.key));syncPhotoSelectionUI();
};
document.querySelector('#photoDeleteSelected').onclick=()=>removePhotos([...photoSelectedKeys]);
document.querySelector('#photoRatio').onclick=()=>{
  photoOriginalRatio=!photoOriginalRatio;
  document.querySelector('#photoRatio .studioRatioLabel').textContent=photoOriginalRatio?'原比例':'方格';
  document.querySelector('#grid').classList.toggle('photoOriginalRatio',photoOriginalRatio);
};
try {const remembered=Number(localStorage.getItem('douyin-photo-cell-size'));if(remembered>=90&&remembered<=250)photoTileSize=remembered;}catch{}
document.querySelector('#photoCellSize').value=String(photoTileSize);
document.querySelector('#photoCellSize').oninput=e=>{
  photoTileSize=Number(e.target.value);
  document.querySelector('#grid').style.setProperty('--photo-cell',photoTileSize+'px');
  try{localStorage.setItem('douyin-photo-cell-size',String(photoTileSize));}catch{}
};
document.querySelector('#assetClose').onclick=hideImageViewer;
document.querySelector('#assetPrev').onclick=()=>showImageViewer(imageViewerIndex-1);
document.querySelector('#assetNext').onclick=()=>showImageViewer(imageViewerIndex+1);
const jfPhotoZoomSpeedInput=document.getElementById('photoZoomSpeedRange');
jfPhotoZoomSpeedInput.value=String(jfPhotoZoomSpeed);
document.getElementById('photoZoomSpeedValue').textContent=jfPhotoZoomSpeed.toFixed(1)+'×';
jfPhotoZoomSpeedInput.addEventListener('input',e=>jfPhotoSetZoomSpeed(e.target.value));
document.querySelector('#photoZoomButton').onclick=togglePhotoZoom;
document.querySelector('#photoRailToggle').onclick=()=>{
  const viewer=document.getElementById('assetView');
  viewer.classList.toggle('photoRailHidden');
  const visible=!viewer.classList.contains('photoRailHidden');
  document.getElementById('photoRailToggle').setAttribute('aria-pressed',String(visible));
  document.getElementById('photoRailToggle').setAttribute('aria-label',visible?'收起图片列表':'展开图片列表');
};
document.querySelector('#photoMoreToggle').onclick=()=>{
 jfCloseFilter('photo');
 const panel=document.getElementById('photoMorePanel');panel.hidden=!panel.hidden;
 const crop=document.getElementById('photoCropOpen');crop.disabled=!photoCurrentItem();crop.title='自由裁剪 / 水平调整，并另存为新图片';
 document.getElementById('photoMoreToggle').setAttribute('aria-expanded',String(!panel.hidden));
};
document.querySelector('#photoFilmstrip').addEventListener('click',e=>{
  const tile=e.target.closest('[data-film-index]');
  if(tile)showImageViewer(Number(tile.dataset.filmIndex));
});
document.getElementById('photoCropOpen').onclick=jfCropOpen;
for(const id of ['jfPhotoCropCancelTop','jfPhotoCropCancel'])document.getElementById(id).onclick=jfCropClose;
document.getElementById('jfPhotoCropReset').onclick=jfCropReset;
document.getElementById('jfPhotoCropSave').onclick=jfCropSave;
document.getElementById('jfPhotoCropLevel').oninput=e=>jfCropSetAngle(Number(e.target.value)/10);
document.getElementById('jfPhotoCropLevelReset').onclick=()=>jfCropSetAngle(0);
const jfCropBox=document.getElementById('jfPhotoCropBox');
const jfCropBoardEl=jfCropBoard();
function jfCropBegin(e,kind,capture){
  if(jfCropDrag||(e.pointerType==='mouse'&&e.button!==0))return;
  jfCropFreezeCamera();
  jfCropDrag={x:e.clientX,y:e.clientY,rect:{...jfCropRect},view:{...jfCropView},kind,pointer:e.pointerId};
  capture.setPointerCapture(e.pointerId);e.preventDefault();
}
function jfCropEnd(e){
  if(!jfCropDrag||jfCropDrag.pointer!==e.pointerId)return;
  const changed=Object.keys(jfCropRect).some(k=>Math.abs(jfCropRect[k]-jfCropDrag.rect[k])>1e-7);
  jfCropDrag=null;
  if(changed&&e.type==='pointerup')requestAnimationFrame(()=>jfCropFit(true));
}
jfCropBox.addEventListener('pointerdown',e=>{
  const handle=e.target.closest('[data-jf-crop-handle]');
  // Drag the frame normally. Alt/Shift-drag inside it pans the image instead.
  jfCropBegin(e,handle?.dataset.jfCropHandle||(e.altKey||e.shiftKey?'image':'move'),jfCropBox);
});
jfCropBox.addEventListener('pointermove',e=>{if(jfCropDrag?.pointer===e.pointerId)jfCropMove(e);});
for(const name of ['pointerup','pointercancel','lostpointercapture'])jfCropBox.addEventListener(name,jfCropEnd);
// Drag exposed portions of the picture outside the crop frame to reframe it.
jfCropBoardEl.addEventListener('pointerdown',e=>{
  if(e.target.closest('.jfPhotoCropBox'))return;
  jfCropBegin(e,'image',jfCropBoardEl);
});
jfCropBoardEl.addEventListener('pointermove',e=>{if(e.target.closest('.jfPhotoCropBox'))return;if(jfCropDrag?.kind==='image'&&jfCropDrag.pointer===e.pointerId)jfCropMove(e);});
for(const name of ['pointerup','pointercancel','lostpointercapture'])jfCropBoardEl.addEventListener(name,jfCropEnd);
document.querySelector('#photoDeleteOne').onclick=()=>{
  const item=photoCurrentItem();if(item)removePhotos([item.key]);
};
const detailStage=document.querySelector('#photoDetailStage');
const photoSurface=detailStage.querySelector('.photoImageSurface');
photoSurface.addEventListener('wheel',e=>{
  e.preventDefault();
  const factor=jfPhotoWheelFactor(e.deltaY,e.deltaMode);
  if(Math.abs(factor-1)>1e-7)setPhotoScale(photoViewerScale*factor,e.clientX,e.clientY);
},{passive:false});
photoSurface.addEventListener('dblclick',e=>{e.preventDefault();togglePhotoZoom();});
// 普通照片和实况照片完全共用鼠标拖放与双指捏合逻辑。
// 浏览器触屏用 Pointer Events；捕获与取消手势均不改变媒体原始宽高比。
const jfPhotoPointers=new Map();
let jfPhotoPinch=null;
function jfPhotoGestureReset(){
  photoViewerTouchStart=null;
  jfPhotoPinch=null;
  jfPhotoPointers.clear();
}
function jfPhotoGesturePair(){
  const points=[...jfPhotoPointers.values()];
  if(points.length<2)return null;
  const [a,b]=points;
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y))};
}
photoSurface.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  jfPhotoPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(jfPhotoPointers.size>=2){
    const p=jfPhotoGesturePair();
    const r=photoSurface.getBoundingClientRect();
    jfPhotoPinch={...p,scale:photoViewerScale,px:photoViewerPanX,py:photoViewerPanY,
      centerX:r.left+r.width/2,centerY:r.top+r.height/2};
    photoViewerTouchStart=null;
    for(const id of jfPhotoPointers.keys()){
      try{photoSurface.setPointerCapture(id);}catch(_){}
    }
    e.preventDefault();return;
  }
  photoViewerTouchStart={x:e.clientX,y:e.clientY,px:photoViewerPanX,py:photoViewerPanY,drag:photoViewerScale>1};
  if(photoViewerScale>1){
    try{photoSurface.setPointerCapture(e.pointerId);}catch(_){}
    e.preventDefault();
  }
});
photoSurface.addEventListener('pointermove',e=>{
  if(!jfPhotoPointers.has(e.pointerId))return;
  jfPhotoPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(jfPhotoPinch&&jfPhotoPointers.size>=2){
    const p=jfPhotoGesturePair();
    const nextScale=Math.min(8,Math.max(1,jfPhotoPinch.scale*Math.pow(p.distance/jfPhotoPinch.distance,.95*jfPhotoZoomSpeed/1.6)));
    const factor=nextScale/jfPhotoPinch.scale;
    photoViewerScale=nextScale;
    if(nextScale===1){photoViewerPanX=0;photoViewerPanY=0;}
    else{
      // 两指中点移动可平移；缩放以起始两指中点为锚点。
      photoViewerPanX=p.x-jfPhotoPinch.centerX-(jfPhotoPinch.x-jfPhotoPinch.centerX-jfPhotoPinch.px)*factor;
      photoViewerPanY=p.y-jfPhotoPinch.centerY-(jfPhotoPinch.y-jfPhotoPinch.centerY-jfPhotoPinch.py)*factor;
    }
    applyPhotoTransform();e.preventDefault();return;
  }
  const start=photoViewerTouchStart;
  if(!start||!start.drag)return;
  photoViewerPanX=start.px+e.clientX-start.x;photoViewerPanY=start.py+e.clientY-start.y;
  applyPhotoTransform();e.preventDefault();
});
function jfPhotoPointerEnd(e,cancelled){
  if(!jfPhotoPointers.has(e.pointerId))return;
  const wasPinching=!!jfPhotoPinch;
  jfPhotoPointers.delete(e.pointerId);
  try{if(photoSurface.hasPointerCapture(e.pointerId))photoSurface.releasePointerCapture(e.pointerId);}catch(_){}
  if(wasPinching){
    jfPhotoPinch=null;photoViewerTouchStart=null;
    if(jfPhotoPointers.size===1){
      const p=[...jfPhotoPointers.values()][0];
      photoViewerTouchStart={x:p.x,y:p.y,px:photoViewerPanX,py:photoViewerPanY,drag:photoViewerScale>1};
    }
    if(jfPhotoPointers.size>=2){
      const p=jfPhotoGesturePair();const r=photoSurface.getBoundingClientRect();
      jfPhotoPinch={...p,scale:photoViewerScale,px:photoViewerPanX,py:photoViewerPanY,
        centerX:r.left+r.width/2,centerY:r.top+r.height/2};
    }
    return;
  }
  const start=photoViewerTouchStart;
  photoViewerTouchStart=null;
  if(cancelled||!start||start.drag||jfPhotoPointers.size)return;
  const dx=e.clientX-start.x,dy=e.clientY-start.y;
  if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.4)showImageViewer(imageViewerIndex+(dx<0?1:-1));
}
photoSurface.addEventListener('pointerup',e=>jfPhotoPointerEnd(e,false));
photoSurface.addEventListener('pointercancel',e=>jfPhotoPointerEnd(e,true));
document.addEventListener('keydown',e=>{
  if(!document.querySelector('#assetView').classList.contains('open')) return;
  if(!jfCropUI().hidden){if(e.key==='Escape'){jfCropClose();e.preventDefault();e.stopImmediatePropagation();}return;}
  if(e.key==='Escape'){
    const activeFilter=document.querySelector('.jfFilterPanel[data-jf-mode="photo"]');
    if(activeFilter&&!activeFilter.hidden)jfCloseFilter('photo');
    else hideImageViewer();
    e.preventDefault();e.stopImmediatePropagation();}
  if(e.key==='ArrowLeft'){showImageViewer(imageViewerIndex-1);e.preventDefault();e.stopImmediatePropagation();}
  if(e.key==='ArrowRight'){showImageViewer(imageViewerIndex+1);e.preventDefault();e.stopImmediatePropagation();}
  if(e.key.toLowerCase()==='i'&&!e.repeat){document.getElementById('photoRailToggle').click();e.preventDefault();e.stopImmediatePropagation();}
  if(e.key==='0'){setPhotoScale(1);e.preventDefault();e.stopImmediatePropagation();}
},true);

const grid =
  document.querySelector(
    '#grid'
  );
const audioControlsRoot = document.querySelector('#audioDock');

// 双击文件列表打开底部常驻播放器；键盘回车也能播放。
grid.addEventListener('dblclick',event=>{
  if(libraryMode==='video' && videoViewMode==='text'){
    const tile=event.target.closest('#grid .videoTextTile[data-key]');
    if(tile && !event.target.closest('button,a,input,textarea,[contenteditable],.stars') && !mediaSelectMode){
      event.preventDefault();event.stopImmediatePropagation();
      openFeed(tile.dataset.key);return;
    }
  }
  if(libraryMode!=='audio'||event.target.closest('[data-delete-asset], [data-rename-audio], .audioRenameEditor'))return;
  const tile=event.target.closest('[data-audio-file-key]');
  if(tile&&!tile.classList.contains('isRenaming'))openAudioDock(tile.dataset.audioFileKey);
});
grid.addEventListener('click',event=>{
  const button=event.target.closest('[data-rename-audio]');
  if (!button || libraryMode!=='audio') return;
  event.stopPropagation();
  beginAudioRename(button.closest('[data-audio-file-key]'));
});
grid.addEventListener('keydown',event=>{
  if(libraryMode!=='audio'||!['Enter',' ','F2'].includes(event.key))return;
  const tile=event.target.closest('[data-audio-file-key]');
  if(!tile||event.target.closest('button,input,.audioRenameEditor')||tile.classList.contains('isRenaming'))return;
  event.preventDefault();
  if(event.key==='F2')beginAudioRename(tile);
  else openAudioDock(tile.dataset.audioFileKey);
});
document.querySelector('#audioDock').addEventListener('click',event=>{
  if(bgmMiniSuppressClick){bgmMiniSuppressClick=false;event.preventDefault();return;}
  const dock=document.querySelector('#audioDock');
  if(event.target.closest('.audioDockClose')){closeAudioDock();return;}
  if(event.target.closest('.audioDockMinimize')){setAudioDockMinimized(true,true);return;}
  if(event.target.closest('.bgmMiniOpen')){setAudioDockMinimized(false,true);return;}
  if(event.target.closest('.bgmMiniPlay')){
    const audio=dock.querySelector('.audioTrack audio');
    if(!audio)return;
    if(audio.paused)playAudioSafely(audio);else audio.pause();
    return;
  }
});

// 音频事件委托：播放、精准跳转、A/B 定点、循环及区间截取。
async function clipAudioTrack(track,audio) {
  const key=track.dataset.audioKey, state=audioABState(key);
  if (!audioValidAB(state,audio.duration)||audioClipJobs.has(key)) return;
  audioClipJobs.add(key); syncAudioTrack(audio);
  const msg=track.querySelector('.audioMessage');
  msg.textContent='正在截取 '+audioClock(state.a)+' – '+audioClock(state.b)+' …';
  try {
    const task=jfStartMediaProgress('截取音频');
    let response;
    try {response=await fetch('/api/clip-audio',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({key,start:state.a,end:state.b,jobId:task.id})});}
    finally {task.done(Boolean(response && response.ok));}
    const result=await response.json();
    if(!response.ok||!result.ok) throw new Error(result.error||'截取失败');
    msg.textContent='已保存到「音频 → 提取的音轨」；原文件保持不变';
    // 载入新素材清单，但不打断仍在播放的 audio DOM。
    await load();
  } catch(error) {msg.textContent='截取失败：'+(error?.message||'未知错误');}
  finally {
    audioClipJobs.delete(key);
    if(track.isConnected)syncAudioTrack(audio);
    // 暂停状态下延迟展示新文件，让“保存成功”提示可见；播放中则等待暂停再刷新。
    if(pendingAudioRender) setTimeout(()=>{
      if(libraryMode==='audio' && pendingAudioRender && audioClipJobs.size===0 &&
        ![...document.querySelectorAll('#audioDock .audioTrack audio')].some(x=>!x.paused)) {
        renderCreatorTags();render();
      }
    },1400);
  }
}
audioControlsRoot.addEventListener('click',event=>{
  const button=event.target.closest('[data-audio-action]'); if(!button)return;
  const track=audioTrackFrom(button),audio=track&&track.querySelector('audio'); if(!audio)return;
  const action=button.dataset.audioAction, state=audioABState(track.dataset.audioKey);
  if(action==='tools'){
    const open=track.classList.toggle('audioToolsExpanded');
    button.setAttribute('aria-pressed',String(open));
    button.title=open?'收起音频工具':'更多音频工具';
    return;
  }
  if (action==='play') {
    if (!audio.paused) {audio.pause();return;}
    document.querySelectorAll('#audioDock .audioTrack audio').forEach(other=>{
      if(other!==audio && !other.paused) other.pause();
    });
    playAudioSafely(audio);return;
  }
  if (action==='speed') {
    const box=track.querySelector('.audioSpeedBox');
    const wasOpen=box.classList.contains('open');
    document.querySelectorAll('.audioSpeedBox.open').forEach(x=>{
      x.classList.remove('open');x.querySelector('.audioSpeed').setAttribute('aria-expanded','false');
    });
    document.querySelectorAll('.audioVolumeBox.open').forEach(x=>x.classList.remove('open'));
    box.classList.toggle('open',!wasOpen);
    button.setAttribute('aria-expanded',String(!wasOpen));
    return;
  }
  if (action==='volume') {
    document.querySelectorAll('.audioSpeedBox.open').forEach(x=>{
      x.classList.remove('open');x.querySelector('.audioSpeed').setAttribute('aria-expanded','false');
    });
    const box=track.querySelector('.audioVolumeBox');
    const wasOpen=box.classList.contains('open');
    document.querySelectorAll('.audioVolumeBox.open').forEach(x=>x.classList.remove('open'));
    box.classList.toggle('open',!wasOpen);return;
  }
  if (action==='loop') {
    audioLoopEnabled=!audioLoopEnabled;
    try{localStorage.setItem(AUDIO_LOOP_STORAGE_KEY,audioLoopEnabled?'on':'off');}catch{}
    resetAllAudioStates();return;
  }
  if (action==='set-a'||action==='set-b') {
    const at=Math.max(0,Number.isFinite(audio.currentTime)?audio.currentTime:0);
    if(action==='set-a')state.a=at; else state.b=at;
    if(!audioValidAB(state,audio.duration))state.enabled=false;
    track.querySelector('.audioMessage').textContent='';syncAudioTrack(audio);return;
  }
  if (action==='ab') {
    if(!audioValidAB(state,audio.duration))return;
    state.enabled=!state.enabled;
    syncAudioTrack(audio);
    if(state.enabled && (audio.currentTime<state.a||audio.currentTime>=state.b)) audio.currentTime=state.a;
    return;
  }
  if(action==='clip'){clipAudioTrack(track,audio);return;}
});
// 原生 audio 的倍速播放，整站统一倍速且跨重启保存。不改变文件或音轨。
audioControlsRoot.addEventListener('click',event=>{
  const choice=event.target.closest('[data-audio-speed]');
  if(!choice)return;
  const rate=Number(choice.dataset.audioSpeed);
  if(!AUDIO_SPEED_OPTIONS.includes(rate))return;
  audioPlaybackRate=rate;
  try {localStorage.setItem(AUDIO_SPEED_STORAGE_KEY,String(rate));} catch {}
  resetAllAudioStates();
  const box=choice.closest('.audioSpeedBox');
  box.classList.remove('open');
  box.querySelector('.audioSpeed').setAttribute('aria-expanded','false');
});
// 点击弹窗以外关闭竖向音量条、倍速菜单（不打断播放）。
document.addEventListener('pointerdown',event=>{
  if(!event.target.closest('.audioVolumeBox')) document.querySelectorAll('.audioVolumeBox.open').forEach(x=>x.classList.remove('open'));
  if(!event.target.closest('.audioSpeedBox')) document.querySelectorAll('.audioSpeedBox.open').forEach(x=>{
    x.classList.remove('open');x.querySelector('.audioSpeed').setAttribute('aria-expanded','false');
  });
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  document.querySelectorAll('.audioSpeedBox.open').forEach(x=>{
    x.classList.remove('open');x.querySelector('.audioSpeed').setAttribute('aria-expanded','false');
  });
});
audioControlsRoot.addEventListener('input',event=>{
  const input=event.target;
  const track=audioTrackFrom(input),audio=track&&track.querySelector('audio');if(!audio)return;
  if(input.classList.contains('audioSeek')) {
    if(Number.isFinite(audio.duration)&&audio.duration>0) {
      audio.currentTime=Math.min(audio.duration,Math.max(0,Number(input.value)));
      input.style.setProperty('--audio-progress',(audio.currentTime/audio.duration*100)+'%');
      track.querySelector('.audioTimeCurrent').textContent=audioClock(audio.currentTime);
    }
  }
  if(input.classList.contains('audioVolume')) {
    audio.volume=Number(input.value)/100;audio.muted=false;
    try{localStorage.setItem(BGM_VOLUME_KEY,String(audio.volume));}catch{}
    syncAudioTrack(audio);
  }
});
audioControlsRoot.addEventListener('pointerdown',event=>{if(event.target.classList.contains('audioSeek'))event.target.dataset.dragging='1';});
for(const name of ['pointerup','pointercancel','change']) {
  audioControlsRoot.addEventListener(name,event=>{
    if(event.target.classList.contains('audioSeek')){
      delete event.target.dataset.dragging;
      const audio=audioTrackFrom(event.target)?.querySelector('audio');
      if(audio)syncAudioTrack(audio);
    }
  });
}
// 对短片段 A/B 使用 40ms 精度监视；timeupdate 为备用，页面后台播放仍允许循环。
setInterval(()=>{
  document.querySelectorAll('#audioDock .audioTrack audio').forEach(audio=>{
    if(audio.paused||!Number.isFinite(audio.duration))return;
    const state=audioABState(audioTrackFrom(audio).dataset.audioKey);
    if(state.enabled && audioValidAB(state,audio.duration) && audio.currentTime>=state.b-0.018){
      audio.currentTime=state.a;
    }
  });
},40);

// 浏览器原生 range 键盘步进 0.01s，这里提高为更易用的 0.05s；Shift+方向键 1s。
audioControlsRoot.addEventListener('keydown',event=>{
  if(!event.target.classList.contains('audioSeek')||!['ArrowLeft','ArrowRight'].includes(event.key))return;
  const audio=audioTrackFrom(event.target)?.querySelector('audio');
  if(!audio||!Number.isFinite(audio.duration))return;
  event.preventDefault();
  const step=event.shiftKey?1:0.05;
  audio.currentTime=Math.max(0,Math.min(audio.duration,audio.currentTime+(event.key==='ArrowRight'?step:-step)));
  syncAudioTrack(audio);
});
// media events do not bubble: capture required.
for(const eventName of ['loadedmetadata','durationchange','timeupdate','play','pause','ended','volumechange','error','waiting']) {
  audioControlsRoot.addEventListener(eventName,event=>{
    const audio=event.target;
    if(!(audio instanceof HTMLAudioElement)||!audio.closest('.audioTrack'))return;
    const track=audioTrackFrom(audio),state=audioABState(track.dataset.audioKey);
    if(eventName==='play') {
      document.querySelectorAll('#audioDock .audioTrack audio').forEach(other=>{
        if(other!==audio&&!other.paused)other.pause();
      });
    }
    if(eventName==='timeupdate' && state.enabled && audioValidAB(state,audio.duration) &&
      audio.currentTime>=state.b-0.025) {
      audio.currentTime=state.a;
    }
    if(eventName==='ended' && state.enabled && audioValidAB(state,audio.duration)) {
      audio.currentTime=state.a;playAudioSafely(audio);
    }
    if(eventName==='error') {
      track.querySelector('.audioMessage').textContent='无法加载此音频：请确认文件完整，且浏览器支持对应编码';
    }
    syncAudioTrack(audio);
    if ((eventName==='pause'||eventName==='ended') && pendingAudioRender) {
      setTimeout(()=>{
        if(libraryMode==='audio' && pendingAudioRender && audioClipJobs.size===0 &&
          ![...document.querySelectorAll('#audioDock .audioTrack audio')].some(x=>!x.paused)) {
          renderCreatorTags();render();
        }
      },200);
    }
  },true);
}

// v6.22: prepare a muted preview after 800 ms. Keep its actual cover on
// screen until a decoded frame has been presented; never flash a black video.
let jfHoverTimer=null,jfHoverItem=null,jfHoverVideo=null,jfHoverToken=0;
function jfStopHoverPreview(){
  clearTimeout(jfHoverTimer);jfHoverTimer=null;jfHoverToken++;
  if(jfHoverItem)jfHoverItem.classList.remove('previewLoading');
  if(jfHoverVideo){
    try{jfHoverVideo.pause();jfHoverVideo.removeAttribute('src');jfHoverVideo.load();}catch{}
    jfHoverVideo.remove();
  }
  jfHoverItem=null;jfHoverVideo=null;
}
grid.addEventListener('pointerover',event=>{
  if(event.pointerType==='touch' || libraryMode!=='video' || videoViewMode!=='cover' || document.querySelector('.feedOverlay.open'))return;
  const cover=event.target.closest('#grid .jfCoverTile .coverWrap[data-feed-key]');
  if(!cover || cover===jfHoverItem)return;
  jfStopHoverPreview();
  const key=cover.dataset.feedKey,item=allItems.find(x=>x.key===key);
  if(!item || !item.mediaUrl)return;
  const token=jfHoverToken;jfHoverItem=cover;
  jfHoverTimer=setTimeout(()=>{
    if(token!==jfHoverToken || !cover.isConnected || !cover.matches(':hover') || libraryMode!=='video' || document.querySelector('.feedOverlay.open'))return;
    const video=document.createElement('video');
    video.className='jfHoverPreview';video.muted=true;video.defaultMuted=true;
    video.setAttribute('muted','');video.playsInline=true;video.setAttribute('playsinline','');
    video.preload='auto';video.controls=false;video.loop=true;video.disablePictureInPicture=true;
    jfHoverVideo=video;cover.classList.add('previewLoading');
    let revealed=false;
    const valid=()=>token===jfHoverToken && jfHoverVideo===video && cover.isConnected && cover.matches(':hover') && libraryMode==='video' && !document.querySelector('.feedOverlay.open');
    const reveal=()=>{
      if(!valid() || revealed || video.readyState<2 || video.seeking || video.paused)return;
      revealed=true;
      cover.classList.remove('previewLoading');
      video.classList.add('jfPreviewVisible');
    };
    const startPlayback=async()=>{
      if(!valid())return;
      try{
        await video.play();
        if(!valid())return;
        // A rendered frame, not loadedmetadata/playing, is the reveal barrier.
        if('requestVideoFrameCallback' in video){
          video.requestVideoFrameCallback(()=>reveal());
        }else{
          // Older browsers: allow paint after loadeddata + playback start.
          requestAnimationFrame(()=>requestAnimationFrame(reveal));
        }
      }catch{if(valid())jfStopHoverPreview();}
    };
    video.addEventListener('loadedmetadata',()=>{
      if(!valid())return;
      const end=Number.isFinite(video.duration)?Math.max(0,video.duration-.25):0;
      const at=Math.max(0,Math.min(Number(item.coverTime)||0,end));
      if(at>0.1){
        video.addEventListener('seeked',startPlayback,{once:true});
        try{video.currentTime=at;}catch{startPlayback();}
      }else startPlayback();
    },{once:true});
    video.addEventListener('error',()=>{if(valid())jfStopHoverPreview();},{once:true});
    cover.insertBefore(video,cover.querySelector('.badges'));
    video.src=item.mediaUrl;
    video.load();
  },800);
});
grid.addEventListener('pointerout',event=>{
  const cover=event.target.closest('#grid .jfCoverTile .coverWrap');
  if(cover && cover===jfHoverItem && !cover.contains(event.relatedTarget))jfStopHoverPreview();
});
new MutationObserver(()=>{if(jfHoverItem && !jfHoverItem.isConnected)jfStopHoverPreview();}).observe(grid,{childList:true});
window.addEventListener('blur',jfStopHoverPreview);
document.addEventListener('visibilitychange',()=>{if(document.hidden)jfStopHoverPreview();});
grid.addEventListener('click',e=>{if(e.target.closest('[data-feed-key]'))jfStopHoverPreview();},true);
grid.addEventListener(
  'click',
  event => {
    if (libraryMode !== 'video') {
      const folder = event.target.closest('[data-open-folder]');
      if (folder) {rememberMediaFolder(folder.dataset.openFolder);setUnifiedSelectMode(false);render();return;}
      const image = event.target.closest('[data-picture-index]');
      if(image){
        const index=Number(image.dataset.pictureIndex);
        if(libraryMode==='image'&&photoSelectMode){
          const item=imageViewerList[index];
          if(item){toggleUnifiedSelection(item.key);syncPhotoSelectionUI();}
        }else{showImageViewer(index);}
        return;
      }
      const del = event.target.closest('[data-delete-asset]');
      if(del){deleteAsset(del.dataset.deleteAsset);return;}
      return;
    }
    const creatorLinkEdit = event.target.closest('.creatorLinkCardEdit');
    if (creatorLinkEdit) {
      event.preventDefault();
      event.stopPropagation();
      editCreatorLink(creatorLinkEdit.dataset.creator || '');
      return;
    }

    const creatorEdit =
      event.target.closest(
        '.creatorEditBtn'
      );

    if (creatorEdit) {
      event.preventDefault();
      event.stopPropagation();

      const card =
        creatorEdit.closest(
          '.card'
        );

      const creator =
        card &&
        card.querySelector(
          '.creatorText'
        );

      if (creator) {
        beginTextEdit(
          creator,
          'creator'
        );
      }

      return;
    }

    const cover =
      event.target.closest(
        '.coverWrap[data-feed-key]'
      );

    if (!cover) {
      return;
    }
    // v6.18: the cover also contains interactive metadata, which must not open playback.
    if (event.target.closest('.jfCoverInfo .stars, .jfCoverInfo .iconActions, .jfCoverInfo .creatorRow, .jfCoverInfo .titleText, button, a, input, [contenteditable]')) return;

    openFeed(
      cover.dataset.feedKey
    );
  }
);

grid.addEventListener(
  'dblclick',
  event => {
    const creator =
      event.target.closest(
        '.creatorText'
      );

    if (creator) {
      beginTextEdit(
        creator,
        'creator'
      );
      return;
    }

    const title =
      event.target.closest(
        '.titleText'
      );

      if (title) openUnifiedRename(title.dataset.key);
  }
);

grid.addEventListener(
  'pointerdown',
  event => {
    const stars =
      event.target.closest(
        '.stars'
      );

    if (stars) {
      startRating(
        event,
        stars
      );
      return;
    }

    const magnifyBtn =
      event.target.closest(
        '.magnifyBtn'
      );

    if (magnifyBtn) {
      event.preventDefault();
      event.stopPropagation();

      const key =
        magnifyBtn.dataset.key;

      openFeed(
        key
      );

      setTimeout(
        () => {
          const video =
            getCurrentFeedVideo();

          if (!video) {
            return;
          }

          const enabled =
            setFocusZoomEnabled(
              video,
              true
            );

          const feedButton =
            document.querySelector(
              '#feedMagnify'
            );

          if (feedButton) {
            feedButton.classList.toggle(
              'active',
              enabled
            );

            feedButton.title =
              enabled
                ? '关闭宽屏聚焦'
                : '宽屏聚焦';
          }
        },
        60
      );

      return;
    }

    const rotateBtn =
      event.target.closest(
        '.rotateBtn'
      );

    if (rotateBtn) {
      event.preventDefault();
      event.stopPropagation();

      rotateItem(
        rotateBtn.dataset.key
      );

      return;
    }

    const multiBtn =
      event.target.closest(
        '.multiBtn'
      );

    if (multiBtn) {
      event.preventDefault();
      event.stopPropagation();

      openMulti(
        multiBtn.dataset.key
      );

      return;
    }

    const deleteBtn =
      event.target.closest(
        '.deleteBtn'
      );

    if (deleteBtn) {
      event.preventDefault();
      armDelete(
        deleteBtn
      );
    }
  }
);