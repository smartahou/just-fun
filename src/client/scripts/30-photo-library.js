
// The video library shares the same folder hierarchy as photos and audio.
// 第一次打开视频默认展示原媒体目录；「全部视频」仍可手动切换。
function jfFolderHasMedia(dir,kind){
  return allItems.some(item=>item.kind===kind&&((item.relativeDir||'root')===dir || (dir!=='root'&&String(item.relativeDir||'root').startsWith(dir+'/'))));
}
function renderVideoFolders() {
  const nav=document.querySelector('#assetFolders');
  const parts=activeFolder==='root'?[]:activeFolder.split('/');
  let html='<button type="button" data-open-folder="all"'+(activeFolder==='all'?' class="on"':'')+'>全部视频</button>';
  if(activeFolder==='root')html+='<button type="button" class="on">原媒体目录</button>';
  else if(activeFolder!=='all')for(let i=0;i<parts.length;i++){
    const dir=parts.slice(0,i+1).join('/');
    if(dir==='data'||allFolders.some(f=>f.relativeDir===dir)||dir==='data/1001'||dir==='data/1002')
      html+='<button type="button" data-open-folder="'+esc(dir)+'"'+(dir===activeFolder?' class="on"':'')+'>'+esc(folderDisplayName(dir))+'</button>';
  }
  if(activeFolder!=='source'&&!activeFolder.startsWith('source/'))html+='<button type="button" id="unifiedNewAlbum" class="unifiedFolderNew">＋ 新建目录</button>';
  nav.innerHTML=html;
  const candidates=activeFolder==='all'?[{relativeDir:'root'},{relativeDir:'data'},...allFolders.filter(f=>f.parentDir==='all'||f.relativeDir==='source')]:
    activeFolder==='data'?[{relativeDir:'data/1001'},{relativeDir:'data/1002'},...allFolders.filter(f=>f.parentDir==='data')]:
    allFolders.filter(f=>f.parentDir===activeFolder);
  const show=candidates.filter(f=>jfFolderHasMedia(f.relativeDir,'video'));
  document.querySelector('#folderTiles').innerHTML=show.map(f=>unifiedFolderTileHTML(f.relativeDir)).join('');
  document.querySelector('#folderContext').textContent=
    (activeFolder==='all'?'全部视频':folderDisplayName(activeFolder))+' · '+
    allItems.filter(x=>x.kind==='video'&&(activeFolder==='all'||(x.relativeDir||'root')===activeFolder)).length+
    ' 个视频 · 可以将视频移动到素材目录';
}

function audioRatingHTML(item){
  const v=Number(item.rating||0);
  const stars=[1,2,3,4,5].map(n=>'<button class="ratingStar" type="button" aria-label="评分 '+n+'"><span class="ratingStarBase">★</span><span class="ratingStarFill" style="width:'+Math.max(0,Math.min(100,(v-n+1)*100))+'%">★</span></button>').join('');
  return '<div class="stars audioStars" data-key="'+esc(item.key)+'" data-rating="'+v+'">'+stars+'<span class="ratingValue">'+v.toFixed(1)+'</span></div>';
}
function renderAssets() {
  const query = document.querySelector('#search').value.trim().toLowerCase();
  const folderNames = [{relativeDir:'root',parentDir:'all'},
    {relativeDir:'data',parentDir:'all'},
    {relativeDir:'data/1001',parentDir:'data'},
    {relativeDir:'data/1002',parentDir:'data'},
    ...allFolders.map(x=>({relativeDir:x.relativeDir,parentDir:x.parentDir}))];
  const nav = document.querySelector('#assetFolders');
  let currentLabel = folderDisplayName(activeFolder);
  const folderButtons = [];
  folderButtons.push('<button type="button" data-open-folder="all"'+(activeFolder==='all'?' class="on"':'')+'>全部素材</button>');
  if (activeFolder !== 'all') {
    const parts = activeFolder==='root' ? [] : activeFolder.split('/');
    for(let i=0;i<parts.length;i++){
      const dir = parts.slice(0,i+1).join('/');
      if(dir==='data' || folderNames.some(x=>x.relativeDir===dir)){
        folderButtons.push('<button type="button" data-open-folder="'+esc(dir)+'"'+(dir===activeFolder?' class="on"':'')+'>'+esc(folderDisplayName(dir))+'</button>');
      }
    }
    if(activeFolder==='root') folderButtons.push('<button type="button" class="on">原媒体目录</button>');
  }
  folderButtons.push('<button type="button" id="fileSort" title="按文件名中的数字自然排序">名称 '+(fileSortAscending?'↑':'↓')+'</button>');
  if(activeFolder!=='source'&&!activeFolder.startsWith('source/'))folderButtons.push('<button type="button" id="unifiedNewAlbum" class="unifiedFolderNew" title="新建目录">＋ 新建目录</button>');
  nav.innerHTML = folderButtons.join('');
  const children = activeFolder==='all'
    ? folderNames.filter(x=>x.parentDir==='all'||x.relativeDir==='source')
    : folderNames.filter(x=>x.parentDir===activeFolder);
  const items = allItems.filter(x=>x.kind===libraryMode)
    .filter(x=>activeFolder==='all' || ((x.relativeDir||'root')===activeFolder))
    .filter(x=>!unifiedFavoriteOnly || x.favorite)
    .filter(x=>!query || ((x.originalName||'')+' '+(x.displayName||'')+' '+(x.title||'')).toLowerCase().includes(query))
    .sort((a,b)=>{
      const av = sortMode==='rating' ? Number(a.rating||0) : Number(a.modifiedTimeMs||0);
      const bv = sortMode==='rating' ? Number(b.rating||0) : Number(b.modifiedTimeMs||0);
      const diff=av-bv;
      return diff ? (sortDirection==='desc'?-diff:diff) : naturalFileOrder(a,b);
    });
  const folders = children.filter(folder => jfFolderHasMedia(folder.relativeDir,libraryMode))
    .sort((a,b)=>filenameCollator.compare(folderDisplayName(a.relativeDir),folderDisplayName(b.relativeDir)));
  document.querySelector('#folderContext').textContent =
    (activeFolder==='all'?'全部目录':currentLabel)+' · '+items.length+' 个'+(libraryMode==='image'?'图片':'音频')+
    ' · 文件名按数字自然排序（2、9、10）'+(libraryMode==='audio'?' · 双击文件播放':'');
  const parent = document.querySelector('#grid');
  parent.className = libraryMode==='image' ? 'pictureWall' : 'audioFileGrid';
  const folderHtml = folders.map(f=>unifiedFolderTileHTML(f.relativeDir)).join('');
  document.querySelector('#folderTiles').innerHTML = folderHtml;
  if (libraryMode === 'image') {
    imageViewerList = items;
    document.querySelector('#photoSummary').textContent =
      items.length + ' 张照片 · ' + folders.length + ' 个相簿';
    const imageFolders = folders.map(f => {
      const files = allItems.filter(x => x.kind === 'image' && (!unifiedFavoriteOnly || x.favorite) &&
        ((x.relativeDir||'root')===f.relativeDir || (x.relativeDir||'root').startsWith(f.relativeDir + '/')));
      const previews = files.slice(0,4);
      const art = previews.length ? previews.map(x =>
        '<img loading="lazy" alt="" src="/api/image-thumb/'+esc(x.key)+'">'
      ).join('') : '<span aria-hidden="true">▧</span>';
      return '<div class="unifiedFolderTile"><button type="button" class="photoAlbum" data-open-folder="'+esc(f.relativeDir)+'" title="打开相簿 '+esc(folderDisplayName(f.relativeDir))+'">'+
        '<div class="photoAlbumMosaic" data-count="'+previews.length+'">'+art+'</div><strong class="photoAlbumName">'+esc(folderDisplayName(f.relativeDir))+'</strong>'+
        '<span class="photoAlbumCount">'+files.length+' 张照片</span></button>'+
        (allFolders.some(folder=>folder.relativeDir===f.relativeDir&&!folder.readOnly)?'<button type="button" class="unifiedFolderMore" data-folder-more="'+esc(f.relativeDir)+'" title="相簿操作" aria-label="管理相簿 '+esc(folderDisplayName(f.relativeDir))+'">⋯</button>':'')+'</div>';
    });
    document.querySelector('#folderTiles').innerHTML = imageFolders.join('');
    renderPhotoGrid(parent,items,folders);
  } else {
    parent.innerHTML = (items.length?items.map(item=>
      '<article class="audioFileTile mediaTile'+(activeAudioKey===item.key?' isActive':'')+(mediaSelectedKeys.has(item.key)?' unifiedSelected':'')+'" data-media-key="'+esc(item.key)+'" data-favorite="'+(item.favorite?'true':'false')+'" data-audio-file-key="'+esc(item.key)+'" tabindex="0" role="button" aria-pressed="'+(activeAudioKey===item.key?'true':'false')+'" title="双击播放：'+esc(audioDisplayName(item))+'">'+
      '<button type="button" class="mediaTileCheck" data-media-select="'+esc(item.key)+'" aria-label="选择音频">✓</button>'+
      '<div class="audioFileText"><div class="audioFileName">'+esc(audioDisplayName(item))+'</div>'+
      '<div class="audioFileMeta">'+esc(item.durationText || (Number(item.duration)>0 ? audioClock(item.duration) : '--:--'))+'<span class="audioFileSize"> · '+esc(item.sizeText||'')+'</span></div>'+audioRatingHTML(item)+'</div>'+
      '<button type="button" class="unifiedMore" data-media-more="'+esc(item.key)+'" aria-label="更多文件操作">⋯</button>'+
      '<div class="audioFileActions">'+(item.readOnly?'':'<button type="button" class="audioFileRename" data-rename-audio="'+esc(item.key)+'" title="重命名（F2）" aria-label="重命名 '+esc(audioDisplayName(item))+'">✎</button>')+
      '<button type="button" class="audioFileDelete" data-delete-asset="'+esc(item.key)+'" title="删除文件" aria-label="删除 '+esc(audioDisplayName(item))+'">×</button></div>'+ '</article>'
    ).join(''):(folders.length?'':'<div class="empty">暂无音频，拖入 data 目录后会自动入库</div>'));
    // 刷新列表绝不重建播放器；当前文件被外部移除时才关闭。
    if(activeAudioKey && !allItems.some(x=>x.key===activeAudioKey && x.kind==='audio'))closeAudioDock();
  }
  syncUnifiedTiles();
  if (libraryMode === 'audio') {renderedAudioSignature=audioUIStamp(allItems,allFolders);pendingAudioRender=false;}
}

function photoTileHTML(item,index) {
  const label = unifiedMediaName(item);
  return '<button type="button" class="pictureTile mediaTile'+(photoSelectedKeys.has(item.key)?' selected unifiedSelected':'')+'" data-media-key="'+esc(item.key)+'" data-favorite="'+(item.favorite?'true':'false')+'" data-picture-index="'+index+'" title="'+esc(label)+'" aria-label="'+esc(label)+'">'+
    '<img loading="lazy" decoding="async" alt="'+esc(label)+'" src="/api/image-thumb/'+esc(item.key)+'">'+
    '<span class="photoCheck" aria-hidden="true">✓</span>'+(item.livePhoto?'<span class="jfLivePhotoMark" title="实况照片">LIVE</span>':'')+'<span class="photoTileName">'+esc(label)+'</span><span class="unifiedMore" role="button" tabindex="0" data-media-more="'+esc(item.key)+'" aria-label="更多操作">⋯</span></button>';
}
function renderPhotoGrid(parent,items,folders) {
  if (photoObserver) {photoObserver.disconnect();photoObserver=null;}
  parent.className = 'pictureWall'+(photoSelectMode?' photoSelecting':'')+(photoOriginalRatio?' photoOriginalRatio':'');
  parent.style.setProperty('--photo-cell',photoTileSize+'px');
  const count = Math.min(items.length,120);
  parent.innerHTML = items.length
    ? items.slice(0,count).map((item,i)=>photoTileHTML(item,i)).join('')
    : (folders.length?'':'<div class="empty">暂无图片，拖入 data 目录后自动加入图库</div>');
  let shown=count;
  if (shown<items.length) {
    const marker = document.createElement('div');
    marker.className='photoGridMore';marker.textContent='继续加载照片…';
    parent.appendChild(marker);
    photoObserver = new IntersectionObserver(entries=>{
      if (!entries.some(e=>e.isIntersecting) || shown>=items.length) return;
      const next=Math.min(items.length,shown+120);
      marker.insertAdjacentHTML('beforebegin',items.slice(shown,next).map((item,i)=>photoTileHTML(item,shown+i)).join(''));
      shown=next;
      if (shown>=items.length) {photoObserver.disconnect();photoObserver=null;marker.remove();}
    },{rootMargin:'450px'});
    photoObserver.observe(marker);
  }
  syncPhotoSelectionUI();
}
function syncPhotoSelectionUI() {
  const bar=document.querySelector('#photoSelectionBar');
  bar.hidden=!photoSelectMode;
  document.querySelector('#photoSelect').setAttribute('aria-pressed',String(photoSelectMode));
  document.querySelector('#photoSelect').textContent=photoSelectMode?'完成':'选择';
  syncUnifiedControls();
  document.querySelector('#photoSelectedCount').textContent='已选择 '+photoSelectedKeys.size+' 张';
  document.querySelector('#photoDeleteSelected').disabled=!photoSelectedKeys.size;
  const grid=document.querySelector('#grid');
  grid.classList.toggle('photoSelecting',photoSelectMode);
  grid.querySelectorAll('[data-picture-index]').forEach(el=>{
    const item=imageViewerList[Number(el.dataset.pictureIndex)];
    el.classList.toggle('selected',!!item&&photoSelectedKeys.has(item.key));
    el.classList.toggle('unifiedSelected',!!item&&photoSelectedKeys.has(item.key));
    el.setAttribute('aria-pressed',String(!!item&&photoSelectedKeys.has(item.key)));
  });
}
function setPhotoSelectionMode(active) {
  mediaSelectMode=!!active;photoSelectMode=!!active;photoSelectedKeys.clear();syncPhotoSelectionUI();syncUnifiedControls();
}
let photoRailRenderedList=null;
function photoCurrentItem() {return imageViewerList[imageViewerIndex]||null;}
function photoThumb(item) {return '/api/image-thumb/'+encodeURIComponent(item.key);}
function showImageViewer(index) {
  if (!imageViewerList.length) return;
  const nextImageIndex=(index+imageViewerList.length)%imageViewerList.length;
  if(imageViewerIndex!==nextImageIndex || !document.querySelector("#assetView").classList.contains("open")) jfResetPhotoFilter();
  imageViewerIndex=nextImageIndex;
  const item=photoCurrentItem();
  const viewer=document.querySelector('#assetView');
  const img=document.querySelector('#assetViewImg');
  const surface=document.querySelector('.photoImageSurface');
  const title=unifiedMediaName(item);
  document.querySelector('#assetViewName').textContent=title;
  document.querySelector('#assetViewName').title=title;
  document.querySelector('#photoDetailCount').textContent=(imageViewerIndex+1)+' / '+imageViewerList.length;
  jfPhotoGestureReset();
  photoViewerZoomed=false;photoViewerScale=1;photoViewerPanX=0;photoViewerPanY=0;applyPhotoTransform();
  document.querySelector('#photoMorePanel').hidden=true;document.querySelector('#photoMoreToggle').setAttribute('aria-expanded','false');
  surface.classList.add('isLoading');
  // onload/onerror 不依赖全量预解码；相邻缩略图先加载，原图按需请求。
  img.onload=()=>surface.classList.remove('isLoading');
  img.onerror=()=>{surface.classList.remove('isLoading');};
  let motion=surface.querySelector('.jfLivePhotoVideo');
  if(motion){motion.pause();motion.removeAttribute('src');motion.load();motion.remove();}
  surface.querySelector('.jfLivePhotoSound')?.remove();
  img.hidden=!!item.livePhoto;
  if(item.livePhoto){
    img.removeAttribute('src');
    // 和普通图片使用同一显示容器、原始宽高比例和缩放变换。
    // 用户从图片列表点击进入时直接尝试有声播放；浏览器若禁止有声自动播放，
    // 保持画面流畅，并只在需要时出现一枚轻量启声按钮。
    motion=document.createElement('video');
    motion.className='jfLivePhotoVideo';
    motion.autoplay=true;motion.loop=true;motion.muted=false;motion.defaultMuted=false;
    motion.volume=1;motion.playsInline=true;motion.controls=false;motion.preload='auto';
    motion.setAttribute('aria-label','实况照片动态画面');
    motion.src=item.mediaUrl;
    motion.addEventListener('loadeddata',()=>surface.classList.remove('isLoading'));
    motion.addEventListener('error',()=>surface.classList.remove('isLoading'));
    surface.insertBefore(motion,img);
    applyPhotoTransform();
    jfApplyFilter('photo'); // Bind CSS / Matrix to the visible motion element, not the hidden JPG.
    const playWithSound=()=>{
      motion.muted=false;
      return motion.play();
    };
    Promise.resolve(playWithSound()).catch(error=>{
      if(!motion.isConnected || motion!==surface.querySelector('.jfLivePhotoVideo'))return;
      if(error?.name!=='NotAllowedError')return;
      // 浏览器的有声自动播放策略只能由真实用户手势解除；不伪装播放成功。
      motion.muted=true;
      motion.play().catch(()=>{});
      const enable=document.createElement('button');
      enable.type='button';enable.className='jfLivePhotoSound';
      enable.setAttribute('aria-label','开启实况照片声音');
      enable.textContent='♫  开启声音';
      enable.addEventListener('pointerdown',e=>e.stopPropagation());
      enable.addEventListener('click',e=>{
        e.stopPropagation();
        playWithSound().then(()=>enable.remove()).catch(()=>{enable.textContent='轻触重试开启声音';});
      });
      surface.append(enable);
    });
  }else img.src=item.mediaUrl;
  // 不截断缩略目录。图片数量很大时，由浏览器 lazy-loading 按需加载封面；
  // 切换图片只更新选中状态和滚动位置，不重复创建整个缩略条。
  const photoRail=document.getElementById('photoFilmstrip');
  if(photoRailRenderedList!==imageViewerList){
    photoRail.innerHTML=imageViewerList.map((x,i)=>
      '<button type="button" data-film-index="'+i+'" title="'+esc(x.originalName||x.title)+'" aria-label="跳转至第 '+(i+1)+' 张"><img loading="lazy" src="'+photoThumb(x)+'" alt=""></button>'
    ).join('');
    photoRailRenderedList=imageViewerList;
  }
  photoRail.querySelector('.isCurrent')?.classList.remove('isCurrent');
  photoRail.querySelector('[data-film-index="'+imageViewerIndex+'"]')?.classList.add('isCurrent');
  viewer.classList.add('open');viewer.setAttribute('aria-hidden','false');
  document.body.classList.add('photoDetailOpen');
  document.querySelector('#photoFilmstrip .isCurrent')?.scrollIntoView({inline:'nearest',block:'center'});
}
function hideImageViewer() {
  jfResetPhotoFilter();
  document.querySelector('#assetView').classList.remove('open');
  document.querySelector('#assetView').setAttribute('aria-hidden','true');
  document.body.classList.remove('photoDetailOpen');
  const motion=document.querySelector('#assetView .jfLivePhotoVideo');
  if(motion){motion.pause();motion.removeAttribute('src');motion.load();motion.remove();}
  document.querySelector('#assetView .jfLivePhotoSound')?.remove();
  const img=document.querySelector('#assetViewImg');img.hidden=false;img.removeAttribute('src');
  jfPhotoGestureReset();
  photoViewerScale=1;photoViewerPanX=0;photoViewerPanY=0;applyPhotoTransform();
}
function togglePhotoZoom() {
 const surface=document.querySelector('.photoImageSurface');
 const r=surface.getBoundingClientRect();
 setPhotoScale(photoViewerScale>1?1:2,r.left+r.width/2,r.top+r.height/2);
}
async function removePhotos(keys) {
  const unique=[...new Set(keys)].filter(key=>allItems.some(x=>x.key===key&&x.kind==='image'));
  if (!unique.length) return;
  if (!confirm('确定永久删除这 '+unique.length+' 张图片吗？此操作无法撤销。')) return;
  try {
    let failures=0;
    // 服务端每批最多处理 500 张；较大的组图分批提交，用户只需确认一次。
    for(let start=0;start<unique.length;start+=500){
      const result=await mediaPost('/api/delete-images',{keys:unique.slice(start,start+500)});
      failures+=(result.failed||[]).length;
    }
    photoSelectedKeys.clear();
    hideImageViewer();
    setPhotoSelectionMode(false);
    await load();
    if(failures) alert('有 '+failures+' 张图片删除失败，请检查文件占用情况。');
  } catch(error){await load();alert('删除图片失败：'+error.message);}
}
// 仅改写 data.json 的显示名称；磁盘文件 hash、原始文件名、媒体 key 均不变。
function beginAudioRename(tile) {
  if (!tile || tile.classList.contains('isRenaming')) return;
  const item = allItems.find(x => x.key === tile.dataset.audioFileKey && x.kind === 'audio');
  if (!item) return;
  const nameElement = tile.querySelector('.audioFileName');
  if (!nameElement) return;
  const current = audioDisplayName(item);
  const ext = String(item.originalExt || '').toLowerCase();
  const base = ext && current.toLowerCase().endsWith(ext) ? current.slice(0,-ext.length) : current;
  const form = document.createElement('div');
  form.className = 'audioRenameEditor';
  const row = document.createElement('div');
  row.className = 'audioRenameRow';
  const input = document.createElement('input');
  input.className = 'audioRenameInput';
  input.type = 'text';
  input.maxLength = 160;
  input.value = base;
  input.setAttribute('aria-label','新的音频名称（不含扩展名）');
  const suffix = document.createElement('span');
  suffix.className = 'audioRenameExt';
  suffix.textContent = ext;
  const save = document.createElement('button');
  save.type = 'button'; save.className = 'audioRenameConfirm'; save.textContent = '保存';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'audioRenameCancel'; cancel.textContent = '取消';
  const hint = document.createElement('div');
  hint.className = 'audioRenameHint'; hint.textContent = '回车保存 · Esc 取消';
  row.append(input,suffix,save,cancel);
  form.append(row,hint);
  tile.classList.add('isRenaming');
  nameElement.replaceWith(form);
  let busy = false, done = false;
  const rollback = () => {
    if (done || busy) return;
    done = true;
    if (form.isConnected) form.replaceWith(nameElement);
    tile.classList.remove('isRenaming');
  };
  const commit = async () => {
    if (busy || done) return;
    const baseName = input.value.trim();
    if (!baseName) {input.focus();input.setCustomValidity('名称不能为空');input.reportValidity();return;}
    input.setCustomValidity('');
    const fullName = baseName + ext;
    if (fullName === current) {rollback();return;}
    busy = true; input.disabled = true; save.disabled = true; cancel.disabled = true;
    save.textContent = '保存中…';
    try {
      const result = await mediaPost('/api/rename-audio',{key:item.key,name:fullName});
      item.displayName = result.displayName;
      done = true;
      // 底部播放实例保持原样，仅更新文字，绝不重新加载 audio。
      if (activeAudioKey === item.key) {
        const title = document.querySelector('#audioDock .audioTitle');
        if (title) {title.textContent = result.displayName; title.title = result.displayName;}
      }
      renderAssets();
    } catch (error) {
      busy = false; input.disabled = false; save.disabled = false; cancel.disabled = false;
      save.textContent = '保存'; alert('重命名失败：'+(error.message||'未知错误'));
      input.focus();
    }
  };
  form.addEventListener('click',event=>event.stopPropagation());
  form.addEventListener('dblclick',event=>event.stopPropagation());
  form.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();rollback();}
    else if(event.key==='Enter'){event.preventDefault();commit();}
  });
  save.addEventListener('click',commit);
  cancel.addEventListener('click',rollback);
  input.addEventListener('input',()=>input.setCustomValidity(''));
  input.focus(); input.select();
}
async function deleteAsset(key) {
  if (!confirm('确定永久删除这个素材文件吗？')) return;
  try {
    const r = await fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
    const result = await r.json();
    if (!r.ok || !result.ok) throw new Error(result.error||'删除失败');
    if(key===activeAudioKey)closeAudioDock();
    await load();
  } catch(error) {alert('删除失败：'+error.message);}
}

async function mediaPost(url, body) {
  const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error||'操作失败');
  return result;
}

// 截图即逐帧辅助：打开即显示当前位置，左右方向键切到真实的前/后帧。
// 不在浏览器里预先生成数百张图片，只有用户点击保存时 FFmpeg 才输出一张原图。
async function performVideoAction(action) {
  const item = getCurrentFeedItem();
  const video = getCurrentFeedVideo();
  if (!item || item.kind !== 'video') return;
  if (action === 'shot') return openShotStudio(item, video);
  if (action !== 'audio') return;
  const button = document.querySelector('#feedAudio');
  if (button.disabled) return;
  button.disabled = true;
  const label = button.querySelector('.feedToolLabel');
  const previous = label ? label.textContent : '';
  button.classList.add('loading');
  button.setAttribute('aria-busy','true');
  if (label) label.textContent = '处理中';
  try {
    const result=await jfTrackedMediaPost('/api/extract-audio', {key:item.key}, '提取音轨');
    await load();
    alert(result.method==='copy'?'音轨已原样提取到「音频 → 提取的音轨」（无重新编码）。':
      '音轨已以 FLAC 无损保存到「音频 → 提取的音轨」（源编码不适合直接封装）。');
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
    button.removeAttribute('aria-busy');
    if (label) label.textContent = previous;
  }
}

async function openShotStudio(item, sourceVideo) {
  if (document.querySelector('.shotStudioBack')) return;
  if (!sourceVideo) {alert('当前视频未加载');return;}
  const originalTime = Number(sourceVideo.currentTime)||0;
  const shouldResume = !sourceVideo.paused;
  const playingVideos = [...document.querySelectorAll('#feedScroller video.feedVideo')];
  const forbidAutoResume = event => {
    if (event.target?.matches?.('video.feedVideo')) {try {event.target.pause();} catch {}}
  };
  document.addEventListener('play',forbidAutoResume,true);
  playingVideos.forEach(video=>{try{video.pause();}catch{}});

  const layer=document.createElement('div');
  layer.className='shotStudioBack';
  layer.setAttribute('role','dialog');
  layer.setAttribute('aria-modal','true');
  layer.setAttribute('aria-label','逐帧截图');
  layer.innerHTML=
    '<section class="shotStudio">'+
      '<header class="shotTop">'+
        '<div class="shotHeading"><strong>逐帧</strong><small></small></div>'+
        '<div class="shotActions">'+
          '<button type="button" class="shotSave" disabled>保存截图</button>'+
          '<button type="button" class="shotCover" disabled>设为封面</button>'+
          '<button type="button" class="shotClose" aria-label="关闭">×</button>'+
        '</div>'+
      '</header>'+
      '<div class="shotStage"><canvas class="shotSnapshot" aria-hidden="true"></canvas><video class="shotVideo" muted playsinline preload="metadata"></video><div class="shotThumbProgress" hidden></div></div>'+
      '<footer class="shotFoot">'+
        '<div class="shotInfo"><span class="shotIndex">读取帧信息…</span><span class="shotTime">← → 快速切帧</span><span class="shotFeedback" role="status" aria-live="polite"></span></div>'+ 
        '<div class="shotScrubber"><button type="button" class="shotPrev" disabled title="上一帧（←）" aria-label="上一帧">‹</button><input class="shotSeek" type="range" min="0" max="0" step="1" value="0" disabled aria-label="定位到指定帧"><button type="button" class="shotNext" disabled title="下一帧（→）" aria-label="下一帧">›</button></div>'+ 
      '</footer>'+
    '</section>';
  // Portrait clips leave side gutters on a landscape monitor. Put frame controls
  // in that unused gutter rather than covering the subject's lower body.
  if(sourceVideo.videoWidth>0 && sourceVideo.videoHeight>0 && sourceVideo.videoHeight>sourceVideo.videoWidth){
    const modal=layer.querySelector('.shotStudio');
    modal.classList.add('shotPortrait');
    const availableWidth=Math.min(1520,window.innerWidth-36);
    const availableHeight=Math.min(window.innerHeight*.96,1040);
    const mediaWidth=availableHeight*sourceVideo.videoWidth/sourceVideo.videoHeight;
    modal.style.setProperty('--shot-side-width',Math.max(120,Math.min(360,(availableWidth-mediaWidth)/2-36))+'px');
  }
  const preview=layer.querySelector('.shotVideo');
  const snapshot=layer.querySelector('.shotSnapshot');
  const progress=layer.querySelector('.shotThumbProgress');
  const title=layer.querySelector('.shotHeading small');
  const status=layer.querySelector('.shotIndex');
  const timeLabel=layer.querySelector('.shotTime');
  const feedback=layer.querySelector('.shotFeedback');
  const save=layer.querySelector('.shotSave');
  const cover=layer.querySelector('.shotCover');
  const prev=layer.querySelector('.shotPrev');
  const next=layer.querySelector('.shotNext');
  const seek=layer.querySelector('.shotSeek');
  title.textContent=item.title||item.originalName||'视频';
  document.body.appendChild(layer);
  document.body.classList.add('shotStudioOpen');

  // 当前播放器的画面先顶上；之后只绘制 320 像素预览，避免大画布占内存。
  try {
    if (sourceVideo.readyState >= 2 && sourceVideo.videoWidth && sourceVideo.videoHeight) {
      const ratio=Math.min(1,480/Math.max(sourceVideo.videoWidth,sourceVideo.videoHeight));
      snapshot.width=Math.max(1,Math.round(sourceVideo.videoWidth*ratio));
      snapshot.height=Math.max(1,Math.round(sourceVideo.videoHeight*ratio));
      snapshot.getContext('2d').drawImage(sourceVideo,0,0,snapshot.width,snapshot.height);
    } else snapshot.hidden=true;
  } catch {snapshot.hidden=true;}

  let frames=[];
  let frameCount=0;
  let compactFrameTimes=false;
  let index=0;
  let closed=false;
  let busy=false;
  let canPreview=false;
  let duration=Number(item.duration)||Number(sourceVideo.duration)||0;
  let previewId='';
  let previewReady=0;
  let previewDone=false;
  let previewError='';
  let pollTimer=0;
  let refineTimer=0;
  let renderToken=0;
  let refiningToken=-1;
  let highResIndex=-1;
  let pendingVideoFrame=0;
  const thumbImages=new Map();
  const thumbLoading=new Set();
  const maxThumbCache=40;
  const frameTime=()=>Math.max(0,compactFrameTimes ? Math.min(Math.max(0,duration-.001),index/estimatedFps) : Number(frames[index])||0);
  const preciseTime=()=>Math.min(Math.max(0,duration-0.001),frameTime()+0.0005);
  let estimatedFrameTimes=false;
  let estimatedFps=30;
  const showStatus=message=>{feedback.textContent=message;};
  const fmtShotTime=t=>{
    const ms=Math.max(0,Math.round((Number(t)||0)*1000));
    return Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');
  };
  const update=()=>{
    status.textContent=frameCount?'第 '+(index+1)+' / '+frameCount+' 帧':'读取帧信息…';
    timeLabel.textContent=frameCount?(estimatedFrameTimes?'≈ ':'')+fmtShotTime(frameTime())+' · ← → 快速切帧':'← → 切换 · Esc 关闭';
    prev.disabled=busy||!frameCount||index===0;
    next.disabled=busy||!frameCount||index>=frameCount-1;
    seek.disabled=busy||!frameCount;
    seek.max=String(Math.max(0,frameCount-1));
    seek.value=String(index);
    seek.style.setProperty('--shot-position',frameCount>1 ? (index/(frameCount-1)*100).toFixed(2)+'%' : '0%');
    // 截图、封面直接读取源视频，不依赖缩略图或 HTMLVideo 是否成功解码。
    save.disabled=busy||!frameCount;
    cover.disabled=busy||!frameCount;
  };
  const renderThumb=indexToDraw=>{
    const img=thumbImages.get(indexToDraw);
    if (!img?.complete||!img.naturalWidth) return false;
    // 更新低清画布；原视频始终在下层。只切小图不会触发播放器的每帧 seek。
    snapshot.width=img.naturalWidth;
    snapshot.height=img.naturalHeight;
    snapshot.getContext('2d').drawImage(img,0,0);
    snapshot.hidden=false;
    return true;
  };
  const previewImageAvailable=i=>i>=0&&i<frameCount&&previewId&&(
    i<Math.max(0,previewReady-1)||previewDone
  );
  const requestThumb=i=>{
    if (closed||!previewImageAvailable(i)||thumbImages.has(i)||thumbLoading.has(i)) return;
    thumbLoading.add(i);
    const img=new Image();
    img.onload=()=>{
      thumbLoading.delete(i);
      if(closed)return;
      thumbImages.set(i,img);
      // LRU: 保留当前帧附近一小段，不让整段视频占据大量内存。
      if(thumbImages.size>maxThumbCache){
        const oldest=thumbImages.keys().next().value;
        thumbImages.delete(oldest);
      }
      if(i===index && highResIndex!==index) {
        renderThumb(i);
        progress.hidden=true;
      }
    };
    img.onerror=()=>{thumbLoading.delete(i);};
    img.src='/api/frame-preview/image/'+previewId+'/'+i;
  };
  const prefetch=()=>{
    if(!frameCount||!previewId)return;
    requestThumb(index);
    for(let offset=1;offset<=5;offset++) {
      requestThumb(index+offset);
      requestThumb(index-offset);
    }
  };
  const updateProgress=()=>{
    if(closed||!frameCount){progress.hidden=true;return;}
    if(!previewDone&&!previewError&&previewReady<frameCount) {
      progress.textContent='正在准备快速预览 '+Math.min(previewReady,frameCount)+' / '+frameCount;
      progress.hidden=false;
    } else progress.hidden=true;
  };
  // One visual surface only: the preview video is always underneath the canvas.
  // A seeked event means that the timeline moved, NOT that its decoded frame was
  // presented. Never unhide that video or resurrect the opening screenshot.
  const paintDecodedFrame=(token,metadata)=>{
    if(closed||token!==renderToken||refiningToken!==token||!frameCount)return;
    const target=frameTime();
    const frameTolerance=Math.max(.045,Math.min(.16,2/Math.max(1,estimatedFps)));
    if(Math.abs(preview.currentTime-target)>frameTolerance)return;
    if(metadata && Number.isFinite(metadata.mediaTime) &&
        Math.abs(metadata.mediaTime-target)>frameTolerance)return;
    if(preview.readyState<2||!preview.videoWidth||!preview.videoHeight)return;
    try {
      // This is a display preview; FFmpeg still extracts saves at original quality.
      const scale=Math.min(1,1920/Math.max(preview.videoWidth,preview.videoHeight));
      snapshot.width=Math.max(1,Math.round(preview.videoWidth*scale));
      snapshot.height=Math.max(1,Math.round(preview.videoHeight*scale));
      snapshot.getContext('2d').drawImage(preview,0,0,snapshot.width,snapshot.height);
      highResIndex=index;
      snapshot.hidden=false;
      progress.hidden=true;
    }catch(_) { /* Keep last stable thumbnail if the decoder cannot draw. */ }
  };
  const confirmDecodedFrame=token=>{
    if(closed||token!==renderToken||refiningToken!==token)return;
    if(typeof preview.requestVideoFrameCallback==='function'){
      pendingVideoFrame=preview.requestVideoFrameCallback((_,metadata)=>{
        pendingVideoFrame=0;
        paintDecodedFrame(token,metadata);
      });
    }
    // Chromium may not schedule requestVideoFrameCallback on a PAUSED decoder.
    // seeked has decoded the requested sample; copy it after paint without
    // switching DOM layers. The token prevents an older seek from overwriting it.
    requestAnimationFrame(()=>requestAnimationFrame(()=>paintDecodedFrame(token)));
  };
  const refine=token=>{
    if(closed||!frameCount||!canPreview||token!==renderToken)return;
    refiningToken=token;
    try{
      const t=Math.max(0,Math.min(frameTime()+0.0005,Math.max(0,preview.duration-0.001)));
      if(Math.abs(preview.currentTime-t)<0.0004&&preview.readyState>=2){
        confirmDecodedFrame(token);
        return;
      }
      preview.currentTime=t;
    }catch(error){showStatus('高清画面定位失败：'+error.message);}
  };
  const scheduleRefine=()=>{
    clearTimeout(refineTimer);
    const token=renderToken;
    refineTimer=setTimeout(()=>refine(token),240);
  };
  const showFrame=()=>{
    if(!frameCount||closed)return;
    renderToken++;
    refiningToken=-1;
    highResIndex=-1;
    if(pendingVideoFrame && typeof preview.cancelVideoFrameCallback==='function'){
      preview.cancelVideoFrameCallback(pendingVideoFrame);
      pendingVideoFrame=0;
    }
    // Hold the most recent painted frame while the new frame is decoding.
    // The canvas never disappears, so the underlying first frame cannot flash.
    snapshot.hidden=false;
    if(renderThumb(index))progress.hidden=true;
    else updateProgress();
    prefetch();
    scheduleRefine();
    update();
  };
  const move=delta=>{
    if(!frameCount||busy||closed)return;
    const nextIndex=Math.max(0,Math.min(frameCount-1,index+delta));
    if(nextIndex===index)return;
    index=nextIndex;
    showStatus('');
    showFrame();
  };
  const close=()=>{
    if(closed||busy)return;
    closed=true;
    clearTimeout(pollTimer);
    clearTimeout(refineTimer);
    if(pendingVideoFrame && typeof preview.cancelVideoFrameCallback==='function')preview.cancelVideoFrameCallback(pendingVideoFrame);
    thumbImages.clear();
    window.removeEventListener('keydown',onKeyDown,true);
    document.removeEventListener('play',forbidAutoResume,true);
    preview.pause();preview.removeAttribute('src');preview.load();
    layer.remove();document.body.classList.remove('shotStudioOpen');
    if(shouldResume&&sourceVideo.isConnected)sourceVideo.play().catch(()=>{});
  };
  const onKeyDown=event=>{
    if(closed||!['Escape','ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.key==='Escape')close();
    else move(event.key==='ArrowLeft'?-1:1);
  };
  window.addEventListener('keydown',onKeyDown,true);
  layer.querySelector('.shotClose').addEventListener('click',close);
  layer.addEventListener('click',event=>{if(event.target===layer)close();});
  prev.addEventListener('click',()=>move(-1));
  next.addEventListener('click',()=>move(1));
  seek.addEventListener('input',()=>{
    if(busy||closed||!frameCount)return;
    const target=Math.max(0,Math.min(frameCount-1,Math.round(Number(seek.value)||0)));
    if(target!==index){index=target;showStatus('');showFrame();}
  });
  preview.addEventListener('play',()=>preview.pause());
  preview.addEventListener('loadedmetadata',()=>{
    if(closed)return;
    duration=Number(preview.duration)||duration;
    canPreview=true;
    scheduleRefine();
  });
  preview.addEventListener('seeked',()=>{
    if(closed||refiningToken!==renderToken||!frameCount)return;
    confirmDecodedFrame(refiningToken);
  });
  preview.addEventListener('error',()=>{
    if(!closed)showStatus('高清解码不可用，仍可通过缩略图选帧并保存原图');
  });
  const pollPreview=async()=>{
    if(closed||!previewId||previewDone||previewError)return;
    try{
      const result=await fetch('/api/frame-preview/status?key='+encodeURIComponent(item.key),{cache:'no-store'}).then(r=>r.json());
      if(closed||!result.ok||result.id!==previewId)return;
      const previousReady=previewReady;
      previewReady=result.ready;
      previewDone=result.done;
      previewError=result.error||'';
      if(estimatedFrameTimes&&!compactFrameTimes&&previewDone&&previewReady>0&&previewReady!==frameCount){
        const previousIndex=index;
        frames=Array.from({length:previewReady},(_,i)=>i/estimatedFps);
        frameCount=frames.length;
        index=Math.min(previousIndex,frameCount-1);
        showFrame();
      }
      if(previewReady!==previousReady||previewDone){
        prefetch();
        if(!snapshot.hidden&&!thumbImages.has(index))requestThumb(index);
      }
      updateProgress();
      if(previewError)showStatus('低清预览生成失败，已回退到原视频定位：'+previewError.slice(0,80));
    }catch{}
    finally{if(!closed&&!previewDone&&!previewError)pollTimer=setTimeout(pollPreview,180);}
  };
  const apply=async action=>{
    if(!frameCount||busy||closed)return;
    busy=true;update();
    showStatus(action==='save'?'正在生成原始分辨率截图…':'正在生成封面…');
    const chosen=index;
    try{
      const result=await mediaPost(action==='save'?'/api/screenshot':'/api/set-cover',{
        key:item.key,time:preciseTime(),precise:true,
        // Large virtual timelines use time-based accurate seek instead of
        // decoding hundreds of thousands of preceding frames.
        ...(estimatedFrameTimes&&!compactFrameTimes?{frameIndex:chosen}:{}),
      });
      if(action==='save')showStatus('✓ 第 '+(chosen+1)+' 帧已保存（原始分辨率），可以继续选图');
      else {
        showStatus('✓ 第 '+(chosen+1)+' 帧已设为封面（原始分辨率）');
        item.coverTime=result.time;item.cover=result.cover+'?v='+Date.now();
      }
      await load();
    }catch(error){showStatus('操作失败：'+error.message);}
    finally{busy=false;update();}
  };
  save.addEventListener('click',()=>apply('save'));
  cover.addEventListener('click',()=>apply('cover'));
  preview.src=item.videoUrl||item.mediaUrl;
  preview.load();
  try {
    const response=await mediaPost('/api/frame-times',{key:item.key,duration});
    if(closed)return;
    frames=Array.isArray(response.times)?response.times:[];
    compactFrameTimes=!!response.compact;
    frameCount=compactFrameTimes?Number(response.count)||0:frames.length;
    estimatedFrameTimes=!!response.estimated;
    estimatedFps=Number(response.fps)||30;
    if(!frameCount)throw new Error('视频没有可用画面');
    if(estimatedFrameTimes)showStatus(response.warning||'使用估算时间，保存仍按原视频帧序号提取。');
    duration=response.duration||duration;
    let left=0,right=frameCount;
    while(left<right){const mid=(left+right)>>1;if((compactFrameTimes?mid/estimatedFps:frames[mid])<originalTime)left=mid+1;else right=mid;}
    index=Math.max(0,Math.min(frameCount-1,left));
    if(index&&(left===frameCount||Math.abs((compactFrameTimes?(index-1)/estimatedFps:frames[index-1])-originalTime)<Math.abs((compactFrameTimes?index/estimatedFps:frames[index])-originalTime)))index--;
    showFrame();
    // 后台一次解码视频生成 320px 缩略图；逐帧切换不再反复启动 FFmpeg。
    mediaPost('/api/frame-preview/start',{key:item.key}).then(result=>{
      if(closed)return;
      previewId=result.id;
      previewReady=result.ready;
      previewDone=result.done;
      previewError=result.error||'';
      prefetch();updateProgress();
      if(!previewDone&&!previewError)pollPreview();
    }).catch(error=>{if(!closed)showStatus('低清缓存不可用，已回退至原视频预览：'+error.message);});
  }catch(error){
    if(!closed){status.textContent='无法读取帧';showStatus(error.message);update();}
  }
}

/* 影格 Studio v6.1: 纯本地媒体列表。不采集任何观看或收听历史。 */
try { localStorage.removeItem('yingge-studio-recent-v1'); } catch (_) {}
function renderStudioEntrance() {
  const room=document.getElementById('studioEntrance');
  if(!room)return;
  room.innerHTML='';
  room.hidden=true;
  document.body.classList.remove('studioAtEntrance');
}
let studioChromeIdleTimer=0;
function wakeStudioFeedChrome(){
  const overlay=document.querySelector('#feedOverlay');
  if(!overlay?.classList.contains('open'))return;
  clearTimeout(studioChromeIdleTimer);
  overlay.classList.remove('chromeIdle');
  studioChromeIdleTimer=setTimeout(()=>{
    if(overlay.classList.contains('open')&&!overlay.classList.contains('toolsOpen')&&!overlay.classList.contains('infoVisible')&&!overlay.classList.contains('railOpen'))overlay.classList.add('chromeIdle');
  },3000);
}
document.getElementById('feedOverlay').addEventListener('pointermove',wakeStudioFeedChrome,{passive:true});
function resetStudioFeedPanels(){
  const overlay=document.querySelector('#feedOverlay');if(!overlay)return;
  clearTimeout(studioChromeIdleTimer);
  overlay.classList.remove('chromeIdle');
  overlay.classList.remove('toolsOpen','railOpen','infoVisible');
  document.getElementById('studioRatingDock')?.replaceChildren();
  document.getElementById('studioRatingDock').hidden=true;
  [['feedToolsToggle','aria-expanded'],['feedRailToggle','aria-pressed'],['feedRatingToggle','aria-pressed']].forEach(([id,attr])=>document.querySelector('#'+id)?.setAttribute(attr,'false'));
}
function centerStudioFilmstrip() {
  const root=document.getElementById('feedFilmstrip');
  const current=root?.querySelector('.feedFilmTile.current');
  if(!current || !root?.classList) return;
  root.scrollTop=Math.max(0,current.offsetTop-root.offsetTop-(root.clientHeight-current.offsetHeight)/2);
}
function renderFeedFilmstrip(){
  const root=document.getElementById('feedFilmstrip');if(!root)return;
  const overlay=document.getElementById('feedOverlay');
  // No thumbnail DOM or cover requests until the owner actually opens the rail.
  if(!overlay?.classList.contains('railOpen'))return;
  const sections=feedSections();
  const signature=sections.map(section=>section.dataset.key).join('|');
  sections.forEach(section=>section.classList.toggle('studioCurrent',section.dataset.key===currentFeedKey));
  if(root._studioSequence!==signature){
    // Full sequence, built only when its contents change (not every scroll event).
    const byKey=new Map(allItems.map(item=>[item.key,item]));
    root.innerHTML=sections.map(section=>{
      const item=byKey.get(section.dataset.key);
      if(!item)return '';
      const name=esc(unifiedMediaName(item));
      return '<button type="button" class="feedFilmTile" data-feed-jump="'+esc(item.key)+'" title="'+name+'" aria-label="切换到 '+name+'">'+(item.cover?'<img loading="lazy" decoding="async" alt="" src="'+esc(item.cover)+'">':studioIcon('play'))+'</button>';
    }).join('');
    root._studioSequence=signature;
  }
  const previous=root.querySelector('.feedFilmTile.current');
  if(previous?.dataset.feedJump===currentFeedKey)return;
  previous?.classList.remove('current');
  const current=Array.from(root.querySelectorAll('.feedFilmTile')).find(node=>node.dataset.feedJump===currentFeedKey);
  current?.classList.add('current');
  requestAnimationFrame(centerStudioFilmstrip);
}
function renderStudioRatingDock(){
  const dock=document.getElementById('studioRatingDock');
  const overlay=document.getElementById('feedOverlay');
  if(!dock || !overlay)return;
  if(!overlay.classList.contains('infoVisible') || !overlay.classList.contains('open')){
    dock.hidden=true; dock.replaceChildren(); return;
  }
  const item=allItems.find(i=>i.key===currentFeedKey);
  if(!item || item.kind!=='video'){
    dock.hidden=true;dock.replaceChildren();return;
  }
  dock.innerHTML=feedRatingMarkup(item);
  dock.hidden=false;
}
const studioRatingDock=document.getElementById('studioRatingDock');
studioRatingDock.addEventListener('pointerdown',event=>{
  const stars=event.target.closest('.feedRating');
  if(!stars)return;
  event.stopPropagation();startRating(event,stars);
});
studioRatingDock.addEventListener('pointermove',moveRating);
studioRatingDock.addEventListener('pointerup',endRating);
studioRatingDock.addEventListener('pointercancel',endRating);
function setStudioFeedPanel(kind,force){
  const overlay=document.querySelector('#feedOverlay');if(!overlay?.classList.contains('open'))return;
  const map={tools:['toolsOpen','feedToolsToggle','aria-expanded'],rail:['railOpen','feedRailToggle','aria-pressed'],info:['infoVisible','feedRatingToggle','aria-pressed']};
  const cfg=map[kind];if(!cfg)return;
  const on=typeof force==='boolean'?force:!overlay.classList.contains(cfg[0]);
  overlay.classList.toggle(cfg[0],on);
  if(on){
    jfCloseFilter('video');
    for(const [other,config] of Object.entries(map)){
      if(other===kind)continue;
      overlay.classList.remove(config[0]);
      document.getElementById(config[1]).setAttribute(config[2],'false');
    }
    if(kind!=='rail'){
      const root=document.getElementById('feedFilmstrip');
      root.replaceChildren();root._studioSequence='';
    }
  }
  renderStudioRatingDock();
  document.getElementById(cfg[1]).setAttribute(cfg[2],String(on));
  if(on&&kind==='tools'){overlay.classList.remove('railOpen');document.querySelector('#feedRailToggle').setAttribute('aria-pressed','false');const rail=document.getElementById('feedFilmstrip');rail.replaceChildren();rail._studioSequence='';}
  if(!on&&kind==='rail'){const root=document.getElementById('feedFilmstrip');root.replaceChildren();root._studioSequence='';}
  if(on&&kind==='rail'){renderFeedFilmstrip();requestAnimationFrame(centerStudioFilmstrip);}
  wakeStudioFeedChrome();
}
// v6.46 — 自由裁剪独立于日常看图手势。坐标归一化映射到解码后的原图，
// 不修改原文件；静态图片以外（包括实况照片）不允许误裁。
let jfCropSource=null;
let jfCropRect={x:.1,y:.1,w:.8,h:.8};
let jfCropDrag=null;
let jfCropAngle=0;
// v6.47: viewport-only camera. Crop coordinates remain normalized in source pixels,
// so fitting/animating the preview never changes what gets exported.
let jfCropView={x:0,y:0,scale:1};
let jfCropResizeObserver=null;
function jfCropBoard(){return document.querySelector('.jfPhotoCropBoard');}
function jfCropViewport(){return document.querySelector('.jfPhotoCropViewport');}
function jfCropSetCamera(animate=false){
  const board=jfCropBoard();if(!board)return;
  board.style.transition=animate?'transform 380ms cubic-bezier(.18,.72,.2,1)':'none';
  board.style.transform=`translate3d(${jfCropView.x}px,${jfCropView.y}px,0) scale(${jfCropView.scale})`;
}
function jfCropFreezeCamera(){
  // Capture actual on-screen state when a second gesture interrupts an animation.
  const board=jfCropBoard();if(!board)return;
  const t=getComputedStyle(board).transform;
  if(t&&t!=='none'){
    const m=new DOMMatrixReadOnly(t);
    if(Number.isFinite(m.a)&&m.a>0){jfCropView={x:m.m41,y:m.m42,scale:m.a};}
  }
  jfCropSetCamera(false);
}
function jfCropFit(animate=true){
  if(jfCropUI().hidden||jfCropDrag)return;
  const viewport=jfCropViewport(),board=jfCropBoard(),img=document.getElementById('jfPhotoCropImage');
  if(!img.naturalWidth||!board.offsetWidth||!board.offsetHeight||!viewport.clientWidth)return;
  const vr=viewport.getBoundingClientRect(),br=board.getBoundingClientRect();
  const baseX=br.left-jfCropView.x-vr.left,baseY=br.top-jfCropView.y-vr.top;
  // Leave a comfortable frame around the selected area, even for very narrow crops.
  const padX=Math.min(72,Math.max(20,viewport.clientWidth*.055));
  const padY=Math.min(60,Math.max(20,viewport.clientHeight*.065));
  const targetW=Math.max(60,viewport.clientWidth-2*padX);
  const targetH=Math.max(60,viewport.clientHeight-2*padY);
  const scale=Math.max(.2,Math.min(20,targetW/(board.offsetWidth*jfCropRect.w),targetH/(board.offsetHeight*jfCropRect.h)));
  jfCropView={
    scale,
    x:viewport.clientWidth/2-baseX-board.offsetWidth*(jfCropRect.x+jfCropRect.w/2)*scale,
    y:viewport.clientHeight/2-baseY-board.offsetHeight*(jfCropRect.y+jfCropRect.h/2)*scale
  };
  jfCropSetCamera(animate);
}
function jfCropUI(){return document.getElementById('jfPhotoCropDialog');}
function jfCropClamp(n,a,b){return Math.min(b,Math.max(a,n));}
function jfCropSetAngle(next){
  jfCropAngle=jfCropClamp(Math.round((Number(next)||0)*10)/10,-12,12);
  const slider=document.getElementById('jfPhotoCropLevel');
  const output=document.getElementById('jfPhotoCropLevelValue');
  const value=Math.round(jfCropAngle*10);
  if(slider && Number(slider.value)!==value)slider.value=String(value);
  if(output)output.textContent=(jfCropAngle>0?'+':'')+jfCropAngle.toFixed(1)+'°';
  const board=jfCropBoard();
  if(board)board.style.setProperty('--jf-crop-angle',jfCropAngle.toFixed(1)+'deg');
}
async function jfCropSnapshotLivePhoto(item){
  const live=document.querySelector('#assetView .jfLivePhotoVideo');
  if(!live||!live.isConnected)throw new Error('请先打开当前实况照片');
  if(live.readyState<2){
    await new Promise((resolve,reject)=>{
      const done=()=>{cleanup();resolve();};
      const fail=()=>{cleanup();reject(new Error('实况照片尚未加载完成'));};
      const cleanup=()=>{live.removeEventListener('loadeddata',done);live.removeEventListener('error',fail);};
      live.addEventListener('loadeddata',done,{once:true});
      live.addEventListener('error',fail,{once:true});
    });
  }
  const vw=live.videoWidth||live.clientWidth, vh=live.videoHeight||live.clientHeight;
  if(!(vw>1&&vh>1))throw new Error('当前实况画面还不可用');
  const canvas=document.createElement('canvas');canvas.width=vw;canvas.height=vh;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器不支持实况取帧');
  ctx.drawImage(live,0,0,vw,vh);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw new Error('当前实况画面取帧失败');
  return {objectUrl:URL.createObjectURL(blob),width:vw,height:vh};
}
function jfCropPaint(){
  const box=document.getElementById('jfPhotoCropBox');
  if(!box)return;
  box.style.left=(jfCropRect.x*100)+'%';box.style.top=(jfCropRect.y*100)+'%';
  box.style.width=(jfCropRect.w*100)+'%';box.style.height=(jfCropRect.h*100)+'%';
  const img=document.getElementById('jfPhotoCropImage');
  document.getElementById('jfPhotoCropSize').textContent=img.naturalWidth&&img.naturalHeight?
    Math.round(jfCropRect.w*img.naturalWidth)+' × '+Math.round(jfCropRect.h*img.naturalHeight)+' 像素 · 自由比例':'自由比例';
}
function jfCropSetAspect(){
  const img=document.getElementById('jfPhotoCropImage');
  const board=img.closest('.jfPhotoCropBoard');
  if(img.naturalWidth&&img.naturalHeight){
    board.style.aspectRatio=img.naturalWidth+'/'+img.naturalHeight;
    board.style.setProperty('--jf-crop-ratio',String(img.naturalWidth/img.naturalHeight));
  }
  jfCropPaint();
  // Initial fit remains still until the user modifies the crop rectangle.
}
async function jfCropOpen(){
  const item=photoCurrentItem();
  if(!item||item.kind!=='image')return;
  const modal=jfCropUI(), img=document.getElementById('jfPhotoCropImage');
  const label=document.getElementById('jfPhotoCropSize');
  jfCropClose();
  jfCropSource={key:item.key,mediaUrl:item.mediaUrl,livePhoto:!!item.livePhoto,title:unifiedMediaName(item)};jfCropRect={x:.1,y:.1,w:.8,h:.8};
  jfCropView={x:0,y:0,scale:1};jfCropSetCamera(false);jfCropSetAngle(0);
  document.getElementById('photoMorePanel').hidden=true;
  document.getElementById('photoMoreToggle').setAttribute('aria-expanded','false');
  jfCloseFilter('photo');
  img.crossOrigin='anonymous';
  img.onload=jfCropSetAspect;
  img.onerror=()=>{label.textContent=jfCropSource?.livePhoto?'当前实况画面取帧失败':'原图加载失败';};
  modal.hidden=false;
  label.textContent=item.livePhoto?'正在读取当前实况画面…':'正在载入原图…';
  try{
    if(item.livePhoto){
      const shot=await jfCropSnapshotLivePhoto(item);
      jfCropSource.objectUrl=shot.objectUrl;
      img.src=shot.objectUrl;
    }else img.src=item.mediaUrl;
  }catch(error){
    label.textContent='无法进入裁剪：'+String(error.message||error);
    return;
  }
  if(typeof ResizeObserver!=='undefined'){
    jfCropResizeObserver?.disconnect();
    jfCropResizeObserver=new ResizeObserver(()=>{if(!modal.hidden&&!jfCropDrag&&img.naturalWidth&&jfCropView.scale!==1)jfCropFit(false);});
    jfCropResizeObserver.observe(jfCropViewport());
  }
  if(img.complete&&img.naturalWidth)jfCropSetAspect();
  document.getElementById('jfPhotoCropCancelTop').focus();
}
function jfCropClose(){
  jfCropDrag=null;
  if(jfCropSource?.objectUrl)URL.revokeObjectURL(jfCropSource.objectUrl);
  jfCropSource=null;
  jfCropResizeObserver?.disconnect();jfCropResizeObserver=null;
  jfCropView={x:0,y:0,scale:1};jfCropSetCamera(false);jfCropSetAngle(0);
  const modal=jfCropUI();modal.hidden=true;
  const img=document.getElementById('jfPhotoCropImage');img.onload=null;img.onerror=null;img.removeAttribute('src');
}
function jfCropReset(){jfCropFreezeCamera();jfCropRect={x:.1,y:.1,w:.8,h:.8};jfCropPaint();jfCropSetAngle(0);jfCropFit(true);}
function jfCropMove(e){
  if(!jfCropDrag)return;
  const board=document.querySelector('.jfPhotoCropBoard');const r=board.getBoundingClientRect();
  if(!r.width||!r.height)return;
  const dx=(e.clientX-jfCropDrag.x)/r.width,dy=(e.clientY-jfCropDrag.y)/r.height;
  const a=jfCropDrag.rect, kind=jfCropDrag.kind,minX=Math.min(.15,24/r.width),minY=Math.min(.15,24/r.height);
  if(kind==='image'){
    // Move the actual image under a stationary on-screen crop frame.
    // Only apply the delta allowed by image bounds, preventing blank areas.
    const x=jfCropClamp(a.x-dx,0,1-a.w),y=jfCropClamp(a.y-dy,0,1-a.h);
    jfCropRect={...a,x,y};
    jfCropView.x=jfCropDrag.view.x+(a.x-x)*r.width;
    jfCropView.y=jfCropDrag.view.y+(a.y-y)*r.height;
    jfCropSetCamera(false);
  }else if(kind==='move'){
    jfCropRect={...a,x:jfCropClamp(a.x+dx,0,1-a.w),y:jfCropClamp(a.y+dy,0,1-a.h)};
  }else{
    let l=a.x,t=a.y,right=a.x+a.w,bottom=a.y+a.h;
    if(kind.includes('w'))l=jfCropClamp(a.x+dx,0,right-minX);
    if(kind.includes('e'))right=jfCropClamp(a.x+a.w+dx,l+minX,1);
    if(kind.includes('n'))t=jfCropClamp(a.y+dy,0,bottom-minY);
    if(kind.includes('s'))bottom=jfCropClamp(a.y+a.h+dy,t+minY,1);
    jfCropRect={x:l,y:t,w:right-l,h:bottom-t};
  }
  jfCropPaint();e.preventDefault();
}
async function jfCropSave(){
  if(!jfCropSource)return;
  const source={...jfCropSource};
  const img=document.getElementById('jfPhotoCropImage');
  if(!img.complete||!img.naturalWidth||!img.naturalHeight){alert(source.livePhoto?'请等待实况画面载入完成':'请等待原图加载完成');return;}
  const iw=img.naturalWidth,ih=img.naturalHeight;
  const left=Math.round(jfCropRect.x*iw),top=Math.round(jfCropRect.y*ih);
  const right=Math.round((jfCropRect.x+jfCropRect.w)*iw),bottom=Math.round((jfCropRect.y+jfCropRect.h)*ih);
  const width=Math.min(iw-left,right-left),height=Math.min(ih-top,bottom-top);
  if(width<2||height<2||width*height>60_000_000){alert('裁剪区域像素尺寸超出支持范围');return;}
  const render=document.createElement('canvas');render.width=iw;render.height=ih;
  const renderCtx=render.getContext('2d');if(!renderCtx){alert('当前浏览器不支持裁剪画布');return;}
  try{
    if(Math.abs(jfCropAngle)>0.001){
      renderCtx.translate(iw/2,ih/2);
      renderCtx.rotate(jfCropAngle*Math.PI/180);
      renderCtx.drawImage(img,-iw/2,-ih/2,iw,ih);
    }else renderCtx.drawImage(img,0,0,iw,ih);
  }catch(error){alert('无法解码原始图片：'+error.message);return;}
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx){alert('当前浏览器不支持裁剪画布');return;}
  ctx.drawImage(render,left,top,width,height,0,0,width,height);
  // 此处 source.mediaUrl 常为 /api/media/<key>，扩展名不一定可见；旋转或实况取帧统一保存 PNG。
  const preferred=(photoCurrentItem()?.originalExt||'').toLowerCase();
  const actualMime=(source.livePhoto||Math.abs(jfCropAngle)>0.001||!(preferred==='.jpg'||preferred==='.jpeg'))?'image/png':'image/jpeg';
  const button=document.getElementById('jfPhotoCropSave');button.disabled=true;button.textContent='保存中…';
  try{
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,actualMime,actualMime==='image/jpeg'?.96:undefined));
    if(!blob)throw new Error('生成裁剪图片失败');
    const response=await fetch('/api/photo-crop',{method:'POST',headers:{'Content-Type':actualMime,'X-JustFun-Media-Key':source.key},body:blob});
    const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'裁剪保存失败');
    jfCropClose();
    lastStamp='';await load();
    if(typeof unifiedToast==='function')unifiedToast(source.livePhoto?'已按当前实况画面另存新图片':'已另存新图片，原图保留');
    else alert(source.livePhoto?'已按当前实况画面另存新图片':'已另存新图片，原图保留');
  }catch(error){alert('裁剪失败：'+error.message);}
  finally{button.disabled=false;button.textContent='保存新图片';}
}
