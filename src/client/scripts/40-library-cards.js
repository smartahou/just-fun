
function jumpStudioFeed(key){
  const section=feedSections().find(x=>x.dataset.key===key);if(!section)return;
  section.scrollIntoView({block:'start',behavior:'instant'});
  resetFeedVideoSession(key);
  currentFeedKey=key;hydrateFeedWindow(feedSectionIndex(section));pauseInactiveFeedVideos(section);
  updateFeedABUi();resetFeedDeleteButton();renderFeedFilmstrip();renderStudioRatingDock();
}
document.getElementById('feedToolsToggle').addEventListener('click',()=>setStudioFeedPanel('tools'));
document.getElementById('feedRailToggle').addEventListener('click',()=>setStudioFeedPanel('rail'));
document.getElementById('feedRatingToggle').addEventListener('click',()=>setStudioFeedPanel('info'));
document.getElementById('feedFilmstrip').addEventListener('click',event=>{const b=event.target.closest('[data-feed-jump]');if(b)jumpStudioFeed(b.dataset.feedJump);});
document.getElementById('feedScroller').addEventListener('pointerdown',event=>{
  if(event.target.closest('button,input,.feedRating,video'))return;
  const overlay=document.querySelector('#feedOverlay');
  if(overlay.classList.contains('toolsOpen'))setStudioFeedPanel('tools',false);
},true);
document.addEventListener('keydown',event=>{
  const overlay=document.querySelector('#feedOverlay');if(!overlay.classList.contains('open'))return;
  if(event.target.closest('input,textarea,select,[contenteditable]'))return;
  if(event.key.toLowerCase()==='t'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();setStudioFeedPanel('tools');}
  if(event.key.toLowerCase()==='r'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();setStudioFeedPanel('info');}
  if(event.key.toLowerCase()==='l'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();setStudioFeedPanel('rail');}
  if(event.key==='Escape'&&overlay.classList.contains('toolsOpen')){setStudioFeedPanel('tools',false);event.preventDefault();event.stopImmediatePropagation();}
},true);

// Only a visual preference is stored locally. No played-file keys, timestamps or history.
let studioHideVideoNames = true;
try { studioHideVideoNames = localStorage.getItem('yingge-hide-video-names') !== 'false'; } catch {}
const studioNameToggle = document.getElementById('studioNameToggle');
function syncStudioNamePreference() {
  document.body.classList.toggle('studioHideVideoNames',studioHideVideoNames && libraryMode==='video');
  studioNameToggle.hidden=libraryMode!=='video';
  studioNameToggle.setAttribute('aria-pressed',String(studioHideVideoNames));
  studioNameToggle.title=studioHideVideoNames?'显示文件名':'隐藏文件名';
}
studioNameToggle.addEventListener('click',()=>{
  studioHideVideoNames=!studioHideVideoNames;
  try { localStorage.setItem('yingge-hide-video-names',String(studioHideVideoNames)); } catch {}
  syncStudioNamePreference();
});
/* v7.18: bounded viewport window for large video catalogs.
 * The full filtered/sorted list remains in currentRenderedItems for feed playback,
 * shift-select, creator operations and annotations. Only tile DOM is virtualized.
 * Row dimensions are computed before inserting markup so the scroll range is
 * stable while crossing a 700+ video catalog. No third-party runtime dependency. */
const JF_VIDEO_WINDOW_THRESHOLD = 140;
let jfCoverVirtualState = null;
let jfCoverVirtualFrame = 0;
function jfVideoCoverRatio(item){
  const dims=String(item.resolution||'').match(/(\d+)\s*[×xX]\s*(\d+)/);
  let w=dims?Number(dims[1]):0,h=dims?Number(dims[2]):0;
  const turn=((Number(item.rotation||0)%360)+360)%360;
  if(turn===90||turn===270)[w,h]=[h,w];
  return w>0&&h>0?Math.max(.52,Math.min(2.35,w/h)):.5625;
}
function jfReleaseVideoWindow(){
  jfCoverVirtualState=null;
  if(jfCoverVirtualFrame){cancelAnimationFrame(jfCoverVirtualFrame);jfCoverVirtualFrame=0;}
}
function jfMountVideoWindow(items){
  const grid=document.querySelector('#grid');
  if(!grid || libraryMode!=='video')return;
  const narrow=window.innerWidth<700;
  const text=videoViewMode==='text';
  const style=getComputedStyle(grid);
  const paddingTop=parseFloat(style.paddingTop)||0;
  const available=Math.max(180,grid.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0));
  const gap=narrow?8:11;
  const rows=[];
  let offset=0;
  function pushRow(entries,full){
    if(!entries.length)return;
    const weight=entries.reduce((sum,e)=>sum+e.ratio,0);
    const space=Math.max(120,available-(entries.length-1)*gap);
    const wanted=full?space/weight:Math.min(narrow?250:285,space/weight);
    const height=Math.min(390,Math.max(90,wanted));
    const total=height+2+gap; // tile border and CSS row margin
    rows.push({entries:entries.map(e=>({item:e.item,width:(e.ratio*height).toFixed(2)})),height:height+2,top:offset,end:offset+total});
    offset+=total;
  }
  if(text){
    const columns=Math.max(1,Math.floor((available+(narrow?8:9))/((narrow?172:255)+(narrow?8:9))));
    const h=narrow?143:149;
    for(let i=0;i<items.length;i+=columns){
      const entries=items.slice(i,i+columns).map(item=>({item}));
      const total=h+(narrow?8:9);
      rows.push({entries,height:h,columns,top:offset,end:offset+total});offset+=total;
    }
  }else{
    let pending=[],sum=0;
    for(const item of items){
      const ratio=jfVideoCoverRatio(item);
      const projected=(available-pending.length*gap)/(sum+ratio);
      const cramped=pending.some(e=>e.ratio*projected<(narrow?136:150))||ratio*projected<(narrow?136:150);
      if(pending.length&&cramped){pushRow(pending,true);pending=[];sum=0;}
      pending.push({item,ratio});sum+=ratio;
      if(sum*(narrow?250:285)+(pending.length-1)*gap>=available){pushRow(pending,true);pending=[];sum=0;}
    }
    pushRow(pending,false);
  }
  jfReleaseVideoWindow();
  grid.classList.add('jfVirtualGrid');
  // Repaint once after calculating all row extents; never allocate every card DOM.
  grid.replaceChildren();
  jfCoverVirtualState={grid,rows,total:offset,paddingTop,text,first:-1,last:-1};
  jfPaintVideoWindow(true);
}
function jfPaintVideoWindow(force=false){
  const state=jfCoverVirtualState;
  if(!state||state.grid!==document.querySelector('#grid')||libraryMode!=='video'||document.body.classList.contains('jfBooksMode'))return;
  const rect=state.grid.getBoundingClientRect();
  const viewport=Math.max(400,window.innerHeight);
  const at=Math.max(0,-rect.top-state.paddingTop);
  const start=Math.max(0,at-viewport*1.5);
  const end=at+viewport*2.5;
  const rows=state.rows;
  let first=0;
  while(first<rows.length-1 && rows[first].end<start)first++;
  let last=first;
  while(last<rows.length-1&&rows[last].top<end)last++;
  if(!force&&state.first===first&&state.last===last)return;
  state.first=first;state.last=last;
  const top=rows[first]?.top||0;
  const bottom=rows.length?Math.max(0,state.total-rows[last].end):0;
  let html='<div class="jfVirtualSpacer" aria-hidden="true" style="height:'+top.toFixed(2)+'px"></div>';
  for(let i=first;i<=last;i++){
    const r=rows[i];
    if(!r)continue;
    if(state.text){
      html+='<div class="jfVirtualTextRow" style="--jf-cols:'+r.columns+';height:'+r.height+'px">'+r.entries.map(e=>card(e.item)).join('')+'</div>';
    }else{
      html+='<div class="jfPosterRow" style="height:'+r.height.toFixed(2)+'px">'+r.entries.map(e=>{
        return card(e.item).replace('style="--jf-video-ratio:', 'style="--jf-slot-w:'+e.width+'px;--jf-video-ratio:');
      }).join('')+'</div>';
    }
  }
  html+='<div class="jfVirtualSpacer" aria-hidden="true" style="height:'+bottom.toFixed(2)+'px"></div>';
  state.grid.innerHTML=html;
  syncUnifiedTiles();
}
function jfScheduleVideoWindow(){
  if(!jfCoverVirtualState||jfCoverVirtualFrame)return;
  jfCoverVirtualFrame=requestAnimationFrame(()=>{jfCoverVirtualFrame=0;jfPaintVideoWindow();});
}
window.addEventListener('scroll',jfScheduleVideoWindow,{passive:true});

/* v6.19: sorted, justified poster rows instead of column-flow masonry. */
let jfPosterRelayoutFrame=0;
function layoutJustifiedPosters(){
  const grid=document.getElementById('grid');
  if(jfCoverVirtualState){
    if(libraryMode==='video'&&!document.body.classList.contains('jfBooksMode'))jfMountVideoWindow(currentRenderedItems);
    return;
  }
  if(!grid || !grid.classList.contains('grid') || grid.classList.contains('videoTextGrid') || libraryMode!=='video')return;
  const cards=Array.from(grid.querySelectorAll('.jfCoverTile'));
  if(!cards.length)return;
  const style=getComputedStyle(grid);
  const available=Math.max(240,grid.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0));
  const narrow=window.innerWidth<700;
  const gap=narrow?8:11;
  const target=narrow?250:285;
  const minimumReadableWidth=narrow?136:150;
  const rows=[];
  let pending=[];
  let sum=0;
  for(let i=0;i<cards.length;i++){
    const card=cards[i];
    const raw=Number(card.style.getPropertyValue('--jf-video-ratio'));
    const ratio=Number.isFinite(raw)&&raw>0?Math.max(.52,Math.min(2.35,raw)):.5625;
    // Never add one more wide item if that would force the whole row
    // below the smallest usable poster height and overflow the viewport.
    const projected=(available-pending.length*gap)/(sum+ratio);
    const cramped=(pending.some(function(item){return item.ratio*projected<minimumReadableWidth;}) || ratio*projected<minimumReadableWidth);
    if(pending.length && cramped){rows.push({items:pending,full:true});pending=[];sum=0;}
    pending.push({card:card,ratio:ratio});sum+=ratio;
    if((sum*target+(pending.length-1)*gap)>=available){rows.push({items:pending,full:true});pending=[];sum=0;}
  }
  if(pending.length)rows.push({items:pending,full:false});
  const fragment=document.createDocumentFragment();
  rows.forEach(function(rowData){
    const row=document.createElement('div');row.className='jfPosterRow';
    const items=rowData.items;
    const weight=items.reduce((total,item)=>total+item.ratio,0);
    const space=Math.max(120,available-(items.length-1)*gap);
    // Stretch completed rows; do not blow up a sparse final row.
    const desired=rowData.full?space/weight:Math.min(target,space/weight);
    const height=Math.min(390,Math.max(90,desired));
    items.forEach(function(item){
      item.card.style.setProperty('--jf-slot-w',(item.ratio*height).toFixed(2)+'px');
      row.appendChild(item.card);
    });
    fragment.appendChild(row);
  });
  grid.replaceChildren(fragment);
}
window.addEventListener('resize',function(){
  if(jfPosterRelayoutFrame)cancelAnimationFrame(jfPosterRelayoutFrame);
  jfPosterRelayoutFrame=requestAnimationFrame(function(){jfPosterRelayoutFrame=0;layoutJustifiedPosters();});
},{passive:true});
function render() {
  if(document.body.classList.contains('jfBooksMode'))return; // books are a separate workspace, not a media kind.
  syncStudioNamePreference();
  document.querySelector('#studioModeTitle').textContent = ({video:'视频工作台',image:'图片图库',audio:'音频工作台'})[libraryMode] || '媒体工作台';
  document.body.dataset.studioMode = libraryMode;
  syncUnifiedControls();
  document.querySelectorAll('[data-media-kind]').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.mediaKind === libraryMode);
    btn.setAttribute('aria-selected', String(btn.dataset.mediaKind === libraryMode));
  });
  const isVideo = libraryMode === 'video';
  document.querySelector('#photoToolbar').hidden = libraryMode !== 'image';
  document.querySelector('#creatorToggle').style.display = isVideo ? '' : 'none';
  document.querySelector('#creatorPanel').style.display = isVideo ? '' : 'none';
  document.querySelector('#sortRatingBtn').style.display = libraryMode === 'image' ? 'none' : '';
  document.querySelector('#sortMtimeBtn').style.display = libraryMode === 'image' ? 'none' : '';
  const videoToggle=document.getElementById('videoViewToggle');
  videoToggle.hidden=!isVideo;
  videoToggle.setAttribute('aria-pressed',String(videoViewMode==='text'));
  videoToggle.title=videoViewMode==='text'?'切换为封面视图':'切换为纯文字视图';
  videoToggle.innerHTML=videoViewMode==='text'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m5 16 5-5 4 4 3-3 4 4"/><circle cx="16" cy="9" r="1"/></svg>';
  document.querySelector('#assetFolders').style.display = 'flex';
  document.querySelector('#folderTiles').style.display = 'flex';
  document.querySelector('#folderContext').style.display = 'block';
  if (!isVideo) {jfReleaseVideoWindow();renderStudioEntrance();renderAssets();return;}
  renderVideoFolders();
  document.querySelector('#grid').className = 'grid' + (videoViewMode==='text' ? ' videoTextGrid' : '');
  const q =
    document
      .querySelector('#search')
      .value
      .trim()
      .toLowerCase();

  let items =
    allItems.filter(
      item => {
        if (item.kind !== 'video') return false;
        if(activeFolder!=='all'&&(item.relativeDir||'root')!==activeFolder)return false;
        if (unifiedFavoriteOnly && !item.favorite) return false;
        const text =
          [
            item.creator,
            item.title,
            item.displayName
          ]
            .join(' ')
            .toLowerCase();

        return (
          (!q || text.includes(q)) &&
          (
            !selectedCreator ||
            item.creator ===
              selectedCreator
          )
        );
      }
    );

  items.sort(
    (a,b) => {
      const aValue =
        sortMode === 'mtime'
          ? Number(a.modifiedTimeMs || 0)
          : Number(a.rating || 0);

      const bValue =
        sortMode === 'mtime'
          ? Number(b.modifiedTimeMs || 0)
          : Number(b.rating || 0);

      const diff =
        aValue - bValue;

      if (diff !== 0) {
        return sortDirection === 'desc'
          ? -diff
          : diff;
      }

      // 同值时保持稳定、可预测的中文名称顺序。
      return (
        (a.creator || '') +
        (a.title || '')
      ).localeCompare(
        (b.creator || '') +
        (b.title || ''),
        'zh-CN'
      );
    }
  );

  currentRenderedItems =
    items;

  const grid=document.querySelector('#grid');
  if(items.length>JF_VIDEO_WINDOW_THRESHOLD){
    // Entrance/folder controls are laid out before viewport geometry is read.
    renderStudioEntrance();
    jfMountVideoWindow(items);
  }else{
    jfReleaseVideoWindow();
    grid.classList.remove('jfVirtualGrid');
    grid.innerHTML=items.length?items.map(card).join(''):'<div class="empty">没有匹配的媒体</div>';
    if(videoViewMode!=='text')layoutJustifiedPosters();
    syncUnifiedTiles();
    renderStudioEntrance();
  }
}

let catalogRequestInFlight = false;
let jfBootIndexReady=false;
async function load() {
  if (catalogRequestInFlight) return;
  catalogRequestInFlight = true;
  try {
    const r = await fetch('/api/data', {
      cache: 'no-store',
      headers: lastStamp ? {'If-None-Match': '"' + lastStamp + '"'} : {}
    });
    // 服务器媒体库未变：不下载和解析整份 JSON，也不重绘列表。
    if (r.status === 304) return;
    if (!r.ok) throw new Error('媒体索引请求失败');
    const data = await r.json();
    if (data.scanStatus === 'ready' || (data.items || []).length > 0) jfBootIndexReady = true;

    allItems = data.items || [];
    allFolders = data.folders || [];
    // 外部移动或删除了旧目录时，回退到可用入口，避免刷新后空白。
    ensureMediaFolderExists();

    document.querySelector('#status').textContent =
      data.scanStatus === 'ready'
        ? '共 ' +
          allItems.filter(x=>x.kind===libraryMode).length +
          ' 个'+({video:'视频',image:'图片',audio:'音频'}[libraryMode]||'媒体')+' · 自动监控新增媒体'
        : (
            data.scanMessage ||
            '扫描中…'
          );

    const stamp =
      data.updatedAt || '';

    if (
      stamp !==
      lastStamp
    ) {
      lastStamp =
        stamp;

      const editing =
        Boolean(
          document.querySelector(
            '.inlineInput, .audioRenameInput'
          )
        );

      const draggingCover =
        document.activeElement &&
        document.activeElement.classList &&
        document.activeElement.classList.contains(
          'coverRange'
        );

      if (
        !editing &&
        !draggingCover
      ) {
        const feedOpen =
          document
            .querySelector(
              '#feedOverlay'
            )
            .classList.contains(
              'open'
            );

        if (feedOpen) {
          pendingGridRender = true;
        } else {
          // 索引时间戳更新不等于音频列表变化：避免重建正在加载/播放的 audio DOM。
          const audioUnchanged=libraryMode==='audio' &&
            document.querySelector('#grid').classList.contains('audioFileGrid') &&
            renderedAudioSignature===audioUIStamp(allItems,allFolders);
          if (!audioUnchanged) {
            // 索引导入新素材时别打断正在播放的音频；暂停后再刷新卡片。
            const audioBusy=libraryMode==='audio' &&
              (audioClipJobs.size>0 || [...document.querySelectorAll('#audioDock .audioTrack audio')].some(x=>!x.paused));
            // Audio stays mounted in fixed dock: cards can safely refresh while it is playing.
            void audioBusy;
            renderCreatorTags();
            render();
          }
          pendingGridRender = false;
        }
      }
    }
  } catch (error) {
    // Initial loading remains visible briefly, but never traps the user indefinitely.
    if(!jfBootIndexReady && document.querySelector('#status')) document.querySelector('#status').textContent='媒体索引尚未就绪，正在重试…';
  } finally {
    catalogRequestInFlight = false;
    if(jfBootIndexReady && typeof jfReleaseBootSplash==='function') jfReleaseBootSplash();
  }
}

function beginTextEdit(
  element,
  field
) {
  const key =
    element.dataset.key;

  const item =
    allItems.find(
      x => x.key === key
    );

  if (!item) return;

  const input =
    document.createElement(
      'input'
    );

  input.className =
    'inlineInput';

  input.value =
    String(
      item[field] || ''
    );

  element.replaceWith(
    input
  );

  input.focus();
  input.select();

  let finished = false;

  async function finish(save) {
    if (finished) return;

    finished = true;

    const value =
      input.value.trim();

    if (save) {
      try {
        const r =
          await fetch(
            '/api/update-text',
            {
              method:'POST',
              headers:{
                'Content-Type':
                  'application/json'
              },
              body:
                JSON.stringify({
                  key,
                  field,
                  value
                })
            }
          );

        const data =
          await r.json();

        if (
          !r.ok ||
          !data.ok
        ) {
          throw new Error(
            data.error ||
            '保存失败'
          );
        }

        item[field] =
          value;
      } catch (error) {
        alert(
          error.message ||
          '保存失败'
        );
      }
    }

    renderCreatorTags();
    render();
  }

  input.addEventListener(
    'keydown',
    event => {
      if (
        event.key ===
        'Enter'
      ) {
        event.preventDefault();
        finish(true);
      } else if (
        event.key ===
        'Escape'
      ) {
        event.preventDefault();
        finish(false);
      }
    }
  );

  input.addEventListener(
    'blur',
    () =>
      finish(true)
  );
}

const ratingGesture = {
  active: false,
  container: null,
  key: '',
  preview: 0
};

function ratingFromPointer(
  container,
  clientX
) {
  const stars =
    [...container.querySelectorAll(
      '.ratingStar'
    )];

  if (!stars.length) {
    return 0;
  }

  const firstRect =
    stars[0]
      .getBoundingClientRect();

  // 拖到第一颗星左边即视为“清除评分”。
  // Pointer Capture 开启后，即使鼠标已经拖出评分区域，
  // 仍然能持续收到 pointermove。
  if (
    clientX <=
    firstRect.left
  ) {
    return 0;
  }

  for (
    let i = 0;
    i < stars.length;
    i++
  ) {
    const rect =
      stars[i]
        .getBoundingClientRect();

    if (
      clientX <=
      rect.right
    ) {
      return (
        i +
        (
          clientX <
          rect.left +
          rect.width / 2
            ? 0.5
            : 1
        )
      );
    }
  }

  return 5;
}

function paintRating(
  container,
  rating
) {
  rating =
    Math.max(
      0,
      Math.min(
        5,
        Math.round(
          Number(rating || 0) * 2
        ) / 2
      )
    );

  const stars =
    [...container.querySelectorAll(
      '.ratingStar'
    )];

  stars.forEach(
    (star,index) => {
      const fill =
        Math.max(
          0,
          Math.min(
            100,
            (rating - index) * 100
          )
        );

      star
        .querySelector(
          '.ratingStarFill'
        )
        .style.width =
          fill + '%';

      star.classList.toggle(
        'hot',
        rating > index &&
        rating <= index + 1
      );
    }
  );

  const value =
    container.querySelector(
      '.ratingValue'
    );

  if (value) {
    value.textContent =
      rating.toFixed(1);
  }
}

function startRating(
  event,
  container
) {
  if (
    event.button !== undefined &&
    event.button !== 0
  ) {
    return;
  }

  event.preventDefault();

  ratingGesture.active = true;
  ratingGesture.container = container;
  ratingGesture.key = container.dataset.key;
  ratingGesture.preview =
    ratingFromPointer(
      container,
      event.clientX
    );

  container.classList.add(
    'ratingActive'
  );

  try {
    container.setPointerCapture(
      event.pointerId
    );
  } catch {}

  paintRating(
    container,
    ratingGesture.preview
  );
}

function moveRating(event) {
  if (
    !ratingGesture.active ||
    !ratingGesture.container
  ) {
    return;
  }

  const rating =
    ratingFromPointer(
      ratingGesture.container,
      event.clientX
    );

  if (
    rating ===
    ratingGesture.preview
  ) {
    return;
  }

  ratingGesture.preview =
    rating;

  paintRating(
    ratingGesture.container,
    rating
  );
}

async function endRating() {
  if (
    !ratingGesture.active ||
    !ratingGesture.container
  ) {
    return;
  }

  const container =
    ratingGesture.container;

  const key =
    ratingGesture.key;

  const rating =
    ratingGesture.preview;

  ratingGesture.active =
    false;

  ratingGesture.container =
    null;

  container.classList.remove(
    'ratingActive'
  );

  try {
    const response =
      await fetch(
        '/api/update-rating',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              key,
              rating
            })
        }
      );

    if (response.ok) {
      const item =
        allItems.find(
          value =>
            value.key === key
        );

      if (item) {
        item.rating =
          rating;
      }

      document
        .querySelectorAll(
          '.stars'
        )
        .forEach(
          stars => {
            if (
              stars.dataset.key !==
                key
            ) {
              return;
            }

            stars.dataset.rating =
              String(rating);

            paintRating(
              stars,
              rating
            );
          }
        );
    }
  } catch {}
}

const coverStates = new Map();

function queueCover(input) {
  const key =
    input.dataset.key;

  const time =
    Number(
      input.value
    );

  let state =
    coverStates.get(
      key
    );

  if (!state) {
    state = {
      inFlight: false,
      pending: null,
      input: null,
      timer: null
    };

    coverStates.set(
      key,
      state
    );
  }

  state.pending =
    time;

  state.input =
    input;

  clearTimeout(
    state.timer
  );

  state.timer =
    setTimeout(
      () =>
        flushCover(
          key
        ),
      state.inFlight
        ? 80
        : 130
    );
}

async function flushCover(key) {
  const state =
    coverStates.get(
      key
    );

  if (
    !state ||
    state.inFlight ||
    state.pending === null
  ) {
    return;
  }

  const time =
    state.pending;

  const input =
    state.input;

  state.pending =
    null;

  state.inFlight =
    true;

  const seek =
    input &&
    input.closest(
      '.coverSeek'
    );

  if (seek) {
    seek.classList.add(
      'loading'
    );
  }

  try {
    const r =
      await fetch(
        '/api/set-cover',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              key,
              time
            })
        }
      );

    const data =
      await r.json();

    if (
      r.ok &&
      data.ok
    ) {
      const card =
        input &&
        input.closest(
          '.card'
        );

      const image =
        card &&
        card.querySelector(
          '.cover'
        );

      if (image) {
        image.src =
          data.cover +
          '?v=' +
          Date.now();
      }
    }
  } finally {
    state.inFlight =
      false;

    if (seek) {
      seek.classList.remove(
        'loading'
      );
    }

    if (
      state.pending !==
      null
    ) {
      setTimeout(
        () =>
          flushCover(
            key
          ),
        70
      );
    }
  }
}

const deleteTimers =
  new Map();

function armDelete(button) {
  const key =
    button.dataset.key;

  if (
    button.classList.contains(
      'armed'
    )
  ) {
    deleteMovie(
      key,
      button
    );
    return;
  }

  button.classList.add(
    'armed'
  );

  button.title =
    '再次点击确认删除当前媒体';
  button.setAttribute('aria-label',button.title);
  const label = button.querySelector('.feedToolLabel');
  if (label) label.textContent = '确认删除';

  clearTimeout(
    deleteTimers.get(
      key
    )
  );

  deleteTimers.set(
    key,
    setTimeout(
      () => {
        button.classList.remove(
          'armed'
        );

        button.title =
          '删除媒体';

        deleteTimers.delete(
          key
        );
      },
      3000
    )
  );
}

async function deleteMovie(
  key,
  button
) {
  button.disabled = true;

  try {
    const r =
      await fetch(
        '/api/delete',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              key
            })
        }
      );

    const data =
      await r.json();

    if (
      !r.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        '删除失败'
      );
    }

    const card =
      button.closest(
        '.card'
      );

    if (card) {
      card.classList.add(
        'deleting'
      );

      setTimeout(
        () => {
          allItems =
            allItems.filter(
              item =>
                item.key !==
                key
            );

          renderCreatorTags();
          render();
        },
        320
      );
    }
  } catch (error) {
    button.disabled = false;
    button.classList.remove(
      'armed'
    );

    alert(
      error.message ||
      '删除失败'
    );
  }
}


let feedDeleteTimer =
  null;

function resetFeedDeleteButton() {
  clearTimeout(
    feedDeleteTimer
  );

  feedDeleteTimer =
    null;

  const button =
    document.querySelector(
      '#feedDelete'
    );

  if (!button) {
    return;
  }

  button.classList.remove(
    'armed'
  );

  button.disabled =
    false;

  button.title =
    '删除当前媒体（需要二次确认）';
  button.setAttribute('aria-label',button.title);
  const label = button.querySelector('.feedToolLabel');
  if (label) label.textContent = '删除';
}

function armFeedDelete() {
  const button =
    document.querySelector(
      '#feedDelete'
    );

  if (
    !button ||
    !currentFeedKey
  ) {
    return;
  }

  if (
    button.classList.contains(
      'armed'
    )
  ) {
    deleteCurrentFeedMovie(
      button
    );

    return;
  }

  button.classList.add(
    'armed'
  );

  button.title =
    '再次点击确认永久删除';

  clearTimeout(
    feedDeleteTimer
  );

  feedDeleteTimer =
    setTimeout(
      resetFeedDeleteButton,
      3000
    );
}

async function deleteCurrentFeedMovie(
  button
) {
  const key =
    currentFeedKey;

  const source =
    currentRenderedItems.length
      ? currentRenderedItems
      : allItems;

  const index =
    source.findIndex(
      item =>
        item.key === key
    );

  const nextItem =
    index >= 0
      ? (
          source[index + 1] ||
          source[index - 1] ||
          null
        )
      : null;

  button.disabled =
    true;

  try {
    const response =
      await fetch(
        '/api/delete',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              key
            })
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        '删除失败'
      );
    }

    allItems =
      allItems.filter(
        item =>
          item.key !==
            key
      );

    currentRenderedItems =
      currentRenderedItems
        .filter(
          item =>
            item.key !==
              key
        );

    pendingGridRender =
      true;

    resetFeedDeleteButton();

    if (
      nextItem &&
      nextItem.key !==
        key
    ) {
      openFeed(
        nextItem.key
      );
    } else {
      closeFeed();
    }
  } catch (error) {
    resetFeedDeleteButton();

    alert(
      error.message ||
      '删除失败'
    );
  }
}

let currentRenderedItems = [];
let feedObserver = null;
let currentFeedKey = '';
let pendingGridRender = false;

const TOUCH_MEDIA_DEVICE =
  Boolean(
    window.matchMedia &&
    window.matchMedia(
      '(pointer: coarse)'
    ).matches
  ) ||
  /iPad|iPhone|iPod|Android|Mobile/i
    .test(
      navigator.userAgent || ''
    );

// 为当前和相邻各 1 条视频预加载媒体数据，至多三个，其他条目及时释放。
const FEED_PRELOAD_RADIUS = 1;

const DATA_POLL_INTERVAL =
  TOUCH_MEDIA_DEVICE
    ? 6000
    : 2500;