
// 工作台级快捷键；不劫持播放器、弹窗中的方向键或媒体按键。
document.addEventListener('keydown', event => {
  const target=event.target;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k') {
    if (document.querySelector('.feedOverlay.open, .assetView.open, .shotStudioBack, .clipShelfBack:not([hidden])')) return;
    event.preventDefault(); document.querySelector('#search').focus(); document.querySelector('#search').select();
  } else if (event.key==='/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
    !target.closest('input, textarea, select, [contenteditable="true"]') &&
    !document.querySelector('.feedOverlay.open, .assetView.open, .shotStudioBack, .clipShelfBack:not([hidden])')) {
    event.preventDefault(); document.querySelector('#search').focus();
  }
});
let allItems = [];
let allFolders = [];
// 媒体目录导航：首次进入视频默认「原媒体目录」；保留每类媒体上次浏览位置。
// 仅保存界面偏好，不写入媒体库 data.json，也不影响 hash 文件名。
const MEDIA_FOLDER_DEFAULTS = {video:'root', image:'all', audio:'all'};
function safeMediaFolderValue(value) {
  if (value === 'root' || value === 'all' || value === 'data') return value;
  // Virtual work/study folders have real Unicode names. Validate against the
  // server-provided tree rather than the restricted data/ Hash grammar.
  if (typeof value === 'string' && (value === 'source' || value.startsWith('source/')))
    return allFolders.some(x=>x.relativeDir===value && x.readOnly===true) ? value : null;
  return typeof value === 'string' && value.startsWith('data/') && value.slice(5).split('/').every(part => /^(?:[a-f0-9]{32}|1001|1002)$/i.test(part)) ? value : null;
}
// Folder choice and active media tab are transient UI state, never remembered across reloads.
try { localStorage.removeItem('douyin-media-folders-v1'); sessionStorage.removeItem('douyin-media-current-tab-v1'); } catch (_) {}
const mediaFolderPositions = {...MEDIA_FOLDER_DEFAULTS};
let libraryMode = 'video';
let activeFolder = MEDIA_FOLDER_DEFAULTS.video;
function mediaFolderExists(dir) {
  return dir === 'all' || dir === 'root' || dir === 'data' ||
    dir === 'data/1001' || dir === 'data/1002' ||
    allFolders.some(folder => folder.relativeDir === dir);
}
function rememberMediaFolder(dir) {
  const value = safeMediaFolderValue(dir);
  if (!value || !mediaFolderExists(value)) return false;
  activeFolder = value;
  mediaFolderPositions[libraryMode] = value;
  return true;
}
function ensureMediaFolderExists() {
  if (mediaFolderExists(activeFolder)) return;
  rememberMediaFolder(MEDIA_FOLDER_DEFAULTS[libraryMode]);
}
function changeMediaCategory(kind) {
  if (!Object.hasOwn(MEDIA_FOLDER_DEFAULTS, kind)) return;
  const switching = kind !== libraryMode;
  libraryMode = kind;
  // 切回任意媒体页都继续上次使用的目录；首次进入仍使用默认值。
  const destination = mediaFolderPositions[kind] || MEDIA_FOLDER_DEFAULTS[kind];
  if (switching) {
    if (!rememberMediaFolder(destination)) rememberMediaFolder(MEDIA_FOLDER_DEFAULTS[kind]);
  } else {
    ensureMediaFolderExists();
  }
}
// Each media tab has its own *session-only* browsing context. Do not persist
// search terms, selections or scroll positions to disk / localStorage.
const jfMediaTabSessions = Object.create(null);
let jfMediaTabRestoreToken = 0;
function jfSaveMediaTabSession(kind=libraryMode) {
  if (!Object.hasOwn(MEDIA_FOLDER_DEFAULTS,kind)) return;
  jfMediaTabSessions[kind] = {
    scrollY: Math.max(0,window.scrollY),
    search: document.getElementById('search').value,
    folder: activeFolder,
    favoriteOnly: unifiedFavoriteOnly,
    sortMode, sortDirection, fileSortAscending,
    selectedCreator, creatorOpen,
    selecting: mediaSelectMode,
    selectedKeys: [...mediaSelectedKeys],
    lastSelectedKey: unifiedLastSelectedKey
  };
}
function jfLoadMediaTabSession(kind) {
  const state=jfMediaTabSessions[kind];
  document.getElementById('search').value=state?.search || '';
  unifiedFavoriteOnly=state?.favoriteOnly || false;
  sortMode=state?.sortMode || 'rating';
  sortDirection=state?.sortDirection || 'desc';
  fileSortAscending=state?.fileSortAscending ?? true;
  selectedCreator=state?.selectedCreator || '';
  creatorOpen=state?.creatorOpen || false;
  document.getElementById('creatorPanel').classList.toggle('collapsed',!creatorOpen);
  mediaSelectMode=state?.selecting || false;
  photoSelectMode=mediaSelectMode && kind==='image';
  mediaSelectedKeys.clear();
  const available=new Set(allItems.filter(item=>item.kind===kind).map(item=>item.key));
  for(const key of state?.selectedKeys || [])if(available.has(key))mediaSelectedKeys.add(key);
  unifiedLastSelectedKey=available.has(state?.lastSelectedKey)?state.lastSelectedKey:null;
  // Folder selection must be validated against the currently indexed library.
  if(state?.folder)rememberMediaFolder(state.folder);
  ensureMediaFolderExists();
  updateSortButtons();
  if(kind==='video')renderCreatorTags();
}
function jfRestoreMediaTabScroll(kind) {
  const token=++jfMediaTabRestoreToken;
  const target=Math.max(0,jfMediaTabSessions[kind]?.scrollY || 0);
  const apply=()=>{
    if(token!==jfMediaTabRestoreToken || libraryMode!==kind || document.body.classList.contains('jfBooksMode'))return;
    window.scrollTo(0,target);
    if(kind==='video' && jfCoverVirtualState)jfPaintVideoWindow(true);
  };
  apply();
  // A second pass follows CSS layout / virtual cover mounting; stale restores
  // are cancelled by the token when users switch tabs again immediately.
  requestAnimationFrame(apply);
}

let fileSortAscending = true;
const filenameCollator = new Intl.Collator('zh-CN', {numeric:true, sensitivity:'base'});
let imageViewerList = [];
let imageViewerIndex = 0;
let photoSelectMode = false;
let photoSelectedKeys = new Set();
let mediaSelectMode = false;
let unifiedFavoriteOnly = false;
const mediaSelectedKeys = photoSelectedKeys;
let unifiedRenameKey = null;
let unifiedLastSelectedKey = null;
let unifiedSuppressClickUntil = 0;
let unifiedToastTimer = null;
let photoOriginalRatio = false;
let photoObserver = null;
let photoTileSize = (typeof window !== 'undefined' && window.matchMedia('(max-width:700px)').matches) ? 105 : 150;
let photoViewerZoomed = false;
let photoViewerTouchStart = null;
let photoViewerScale=1, photoViewerPanX=0, photoViewerPanY=0;
// User-adjustable viewer response: high-resolution trackpads still scale continuously.
// The default is visibly faster than the old ~12.5% per 100px notch.
let jfPhotoZoomSpeed=1.6;
try{
  const stored=Number(localStorage.getItem('jf-photo-zoom-speed'));
  if(Number.isFinite(stored)&&stored>=0.6&&stored<=3.5)jfPhotoZoomSpeed=stored;
}catch{}
function jfPhotoSetZoomSpeed(next){
  jfPhotoZoomSpeed=Math.max(.6,Math.min(3.5,Math.round(Number(next)*10)/10));
  const control=document.getElementById('photoZoomSpeedRange');
  const output=document.getElementById('photoZoomSpeedValue');
  if(control)control.value=String(jfPhotoZoomSpeed);
  if(output)output.textContent=jfPhotoZoomSpeed.toFixed(1)+'×';
  try{localStorage.setItem('jf-photo-zoom-speed',String(jfPhotoZoomSpeed));}catch{}
}
function jfPhotoWheelFactor(deltaY,deltaMode=0){
  const unit=deltaMode===1?16:deltaMode===2?window.innerHeight:1;
  const pixels=Math.max(-120,Math.min(120,Number(deltaY||0)*unit));
  return Math.exp(-pixels*.00118*jfPhotoZoomSpeed);
}
// 静态图片与实况视频共享同一套相机缩放坐标与平移变换。
function applyPhotoTransform(){
  const surface=document.querySelector('#assetView .photoImageSurface');
  if(!surface)return;
  const transform='translate3d('+photoViewerPanX+'px,'+photoViewerPanY+'px,0) scale('+photoViewerScale+')';
  for(const media of [document.getElementById('assetViewImg'),surface.querySelector('.jfLivePhotoVideo')]){
    if(media){media.style.transform=transform;media.style.cursor=photoViewerScale>1?'grab':'zoom-in';}
  }
  surface.style.cursor=photoViewerScale>1?'grab':'zoom-in';
  photoViewerZoomed=photoViewerScale>1;
}
function setPhotoScale(scale,cx,cy){
  const surface=document.querySelector('.photoImageSurface');if(!surface)return;
  const rect=surface.getBoundingClientRect();
  const centerX=rect.left+rect.width/2,centerY=rect.top+rect.height/2;
  const newScale=Math.min(8,Math.max(1,scale));
  const factor=newScale/photoViewerScale;
  if(newScale===1){photoViewerPanX=0;photoViewerPanY=0;}
  else if(Number.isFinite(cx)&&Number.isFinite(cy)){
    photoViewerPanX=(cx-centerX)-(cx-centerX-photoViewerPanX)*factor;
    photoViewerPanY=(cy-centerY)-(cy-centerY-photoViewerPanY)*factor;
  }
  photoViewerScale=newScale;applyPhotoTransform();
}

let selectedCreator = '';
let creatorOpen = false;
let sortMode = 'rating';
let sortDirection = 'desc';
let lastStamp = '';


// VOLUME_PREF_START
// 全局视频音量偏好：默认 10%。用户在任意视频上调整后，
// 会持久化到浏览器本地，并立即同步到当前页面的其他视频。
// 只记音量值，不记 muted 状态，避免误点静音后永久静音。
const DEFAULT_VIDEO_VOLUME = 0.10;
const VIDEO_VOLUME_STORAGE_KEY = 'douyin-video-volume';

function normalizeRememberedVolume(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return DEFAULT_VIDEO_VOLUME;
  }

  return Math.max(
    0,
    Math.min(1, number)
  );
}

function readRememberedVolume() {
  try {
    const raw =
      localStorage.getItem(
        VIDEO_VOLUME_STORAGE_KEY
      );

    if (
      raw === null ||
      raw === ''
    ) {
      return DEFAULT_VIDEO_VOLUME;
    }

    return normalizeRememberedVolume(
      raw
    );
  } catch {
    return DEFAULT_VIDEO_VOLUME;
  }
}

let rememberedVideoVolume =
  readRememberedVolume();

function saveRememberedVolume(value) {
  rememberedVideoVolume =
    normalizeRememberedVolume(
      value
    );

  try {
    localStorage.setItem(
      VIDEO_VOLUME_STORAGE_KEY,
      String(rememberedVideoVolume)
    );
  } catch {}

  return rememberedVideoVolume;
}

function applyRememberedVolume(video) {
  if (!video) {
    return;
  }

  const current =
    Number(video.volume);

  if (
    !Number.isFinite(current) ||
    Math.abs(
      current -
      rememberedVideoVolume
    ) > 0.0001
  ) {
    try {
      video.volume =
        rememberedVideoVolume;
    } catch {}
  }
}

function hasIndependentVolume(video) {
  return Boolean(
    video &&
    video.dataset &&
    video.dataset.independentVolume === '1'
  );
}

function syncRememberedVolume(
  sourceVideo
) {
  document
    .querySelectorAll('video')
    .forEach(
      video => {
        if (
          video !== sourceVideo &&
          !hasIndependentVolume(video)
        ) {
          applyRememberedVolume(
            video
          );
        }
      }
    );
}

function installRememberedVolume(video) {
  if (!video) {
    return;
  }

  // 每次视频重新进入使用状态时，都重新套用当前全局音量。
  applyRememberedVolume(video);

  if (
    video.dataset.volumeMemoryInstalled ===
      '1'
  ) {
    return;
  }

  video.dataset.volumeMemoryInstalled =
    '1';

  video.addEventListener(
    'volumechange',
    () => {
      // 多开窗口使用独立音量：只改变当前 video，
      // 不覆盖全局记忆，也不影响其他普通/多开视频。
      if (
        hasIndependentVolume(
          video
        )
      ) {
        return;
      }

      const next =
        normalizeRememberedVolume(
          video.volume
        );

      // 我们给其他普通视频同步音量时也会触发 volumechange。
      // 值已经一致就直接退出，避免事件互相递归。
      if (
        Math.abs(
          next -
          rememberedVideoVolume
        ) <= 0.0001
      ) {
        return;
      }

      saveRememberedVolume(
        next
      );

      syncRememberedVolume(
        video
      );
    }
  );
}
// VOLUME_PREF_END

const esc = value =>
  String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');

function formatTime(sec) {
  sec = Number(sec);

  if (!Number.isFinite(sec)) {
    return '';
  }

  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);

  return h
    ? h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0')
    : m + ':' + String(s).padStart(2,'0');
}

function feedRatingMarkup(item) {
  const rating =
    Number(item.rating || 0);

  const stars =
    [1,2,3,4,5]
      .map(n => {
        const fill =
          Math.max(
            0,
            Math.min(
              100,
              (rating - (n - 1)) * 100
            )
          );

        return (
          '<button class="ratingStar" type="button" aria-label="评分 ' + n + '">' +
            '<span class="ratingStarBase">★</span>' +
            '<span class="ratingStarFill" style="width:' + fill + '%">★</span>' +
          '</button>'
        );
      })
      .join('');

  return (
    '<div class="stars feedRating" data-key="' +
      esc(item.key) +
      '" data-rating="' +
      rating +
      '" title="拖动或点击评分">' +
      stars +
      '<span class="ratingValue">' +
        rating.toFixed(1) +
      '</span>' +
    '</div>'
  );
}

// 仅生成新视频，不改动原视频或缓存里的原有记录。
const portraitPendingKeys = new Set();

// 水平取景范围用 0..1 表示：0=最左，0.5=正中，1=最右。
// 在 Canvas 中持续绘制源视频帧，所见即所得地选择整个视频的固定裁剪位置。
function choosePortraitCrop(item, previewTime) {
  return new Promise(resolve => {
    let finished = false;
    let cropX = 0.5;
    let previewReady = false;
    let imageWidth = 1;
    let imageHeight = 1;
    let cropWidth = 1;
    let cropHeight = 1;
    let dragging = false;
    let grabDelta = 0;
    let frameHandle = null;
    let frameHandleKind = '';
    let initializedGeometry = false;

    const backdrop = document.createElement('div');
    backdrop.className = 'portraitDialogBack';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', '选择竖屏裁剪范围');
    backdrop.innerHTML =
      '<div class="portraitDialog">' +
        '<div class="portraitDialogTop"><div>' +
          '<h3>选择 9:16 竖屏画面</h3>' +
          '<p>视频可播放、暂停或拖动进度；左右移动白框选择保留范围。整段视频使用同一个取景位置，不拉伸原片。</p>' +
        '</div><button class="portraitClose" type="button" aria-label="关闭">×</button></div>' +
        '<div class="portraitStage"><div class="portraitFrame">' +
          '<canvas aria-label="动态视频裁剪预览"></canvas>' +
          '<div class="portraitSelection"></div>' +
        '</div></div>' +
        '<div class="portraitPlayerBar">' +
          '<button class="portraitPlayback" type="button" disabled>▶ 播放</button>' +
          '<input class="portraitTimeline" type="range" min="0" max="100" step="0.05" value="0" disabled aria-label="视频播放进度">' +
          '<span class="portraitClock">0:00 / 0:00</span>' +
          '<button class="portraitSound" type="button" aria-label="开启预览声音" title="开启预览声音">静音</button>' +
        '</div>' +
        '<div class="portraitScaleBox"><label for="portraitHorizontal">水平取景</label>' +
          '<input id="portraitHorizontal" type="range" min="0" max="100" step="0.1" value="50" disabled aria-label="水平裁剪位置">' +
          '<span class="portraitCropValue">50%</span></div>' +
        '<div class="portraitDialogBottom"><span class="portraitDialogHelp">正在加载视频预览…</span>' +
          '<div class="portraitDialogActions"><button class="portraitCancel" type="button">取消</button>' +
          '<button class="portraitSubmit" type="button" disabled>生成竖屏视频</button></div></div>' +
      '</div>';
    document.body.appendChild(backdrop);

    const frame = backdrop.querySelector('.portraitFrame');
    const canvas = backdrop.querySelector('canvas');
    const highlight = backdrop.querySelector('.portraitSelection');
    const slider = backdrop.querySelector('#portraitHorizontal');
    const value = backdrop.querySelector('.portraitCropValue');
    const help = backdrop.querySelector('.portraitDialogHelp');
    const submit = backdrop.querySelector('.portraitSubmit');
    const playButton = backdrop.querySelector('.portraitPlayback');
    const timeline = backdrop.querySelector('.portraitTimeline');
    const clock = backdrop.querySelector('.portraitClock');
    const soundButton = backdrop.querySelector('.portraitSound');
    const stage = backdrop.querySelector('.portraitStage');
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true; // 后台原视频也可能带声音，避免自动播放时突发音量。
    video.playsInline = true;

    function updateBox() {
      if (!previewReady || finished) return;
      const aspect = imageWidth / imageHeight;
      const maxW = Math.min(900, Math.max(1, stage.clientWidth - 16));
      const maxH = Math.max(100, window.innerHeight * 0.48);
      const w = Math.max(1, Math.min(maxW, maxH * aspect));
      const h = w / aspect;
      frame.style.width = w + 'px';
      frame.style.height = h + 'px';
      const percentW = cropWidth / imageWidth * 100;
      const percentH = cropHeight / imageHeight * 100;
      highlight.style.width = percentW + '%';
      highlight.style.height = percentH + '%';
      highlight.style.left = (100 - percentW) * cropX + '%';
      highlight.style.top = (100 - percentH) / 2 + '%';
      slider.value = String(cropX * 100);
      value.textContent = Math.round(cropX * 100) + '%';
    }

    function setCropX(next) {
      cropX = Math.max(0, Math.min(1, Math.round(Number(next) * 1000) / 1000));
      updateBox();
    }

    function stopFrames() {
      if (frameHandle === null) return;
      if (frameHandleKind === 'video' && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(frameHandle);
      } else if (frameHandleKind === 'raf') {
        window.cancelAnimationFrame(frameHandle);
      }
      frameHandle = null;
    }

    function finish(result) {
      if (finished) return;
      finished = true;
      window.removeEventListener('resize', updateBox);
      document.removeEventListener('keydown', onKeyboard, true);
      stopFrames();
      video.pause();
      video.removeAttribute('src');
      video.load();
      backdrop.remove();
      resolve(result);
    }

    function onKeyboard(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(null);
      } else if (event.code === 'Space' && event.target.tagName !== 'INPUT' && event.target.tagName !== 'BUTTON') {
        event.preventDefault();
        event.stopImmediatePropagation();
        togglePlayback();
      }
    }
    document.addEventListener('keydown', onKeyboard, true);
    window.addEventListener('resize', updateBox);
    backdrop.querySelector('.portraitClose').addEventListener('click', () => finish(null));
    backdrop.querySelector('.portraitCancel').addEventListener('click', () => finish(null));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) finish(null); });
    submit.addEventListener('click', () => { if (previewReady) finish(cropX); });
    slider.addEventListener('input', () => setCropX(Number(slider.value) / 100));

    // 拖动白框，预览帧仍持续更新，无需暂停视频。
    frame.addEventListener('pointerdown', event => {
      if (!previewReady || cropWidth >= imageWidth - 0.001) return;
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const rect = frame.getBoundingClientRect();
      const shownWidth = rect.width * cropWidth / imageWidth;
      const currentLeft = rect.width * (1 - cropWidth / imageWidth) * cropX;
      const pointerX = event.clientX - rect.left;
      grabDelta = pointerX >= currentLeft && pointerX <= currentLeft + shownWidth
        ? pointerX - currentLeft : shownWidth / 2;
      dragging = true;
      frame.setPointerCapture(event.pointerId);
      frame.style.cursor = 'grabbing';
      event.preventDefault();
      const maxLeft = rect.width - shownWidth;
      if (maxLeft > 0) setCropX((pointerX - grabDelta) / maxLeft);
    });
    frame.addEventListener('pointermove', event => {
      if (!dragging) return;
      const rect = frame.getBoundingClientRect();
      const shownWidth = rect.width * cropWidth / imageWidth;
      const maxLeft = rect.width - shownWidth;
      if (maxLeft > 0) setCropX((event.clientX - rect.left - grabDelta) / maxLeft);
    });
    function stopDrag() { dragging = false; frame.style.cursor = ''; }
    frame.addEventListener('pointerup', stopDrag);
    frame.addEventListener('pointercancel', stopDrag);
    frame.addEventListener('lostpointercapture', stopDrag);

    function updateProgress() {
      if (finished) return;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      timeline.disabled = duration <= 0;
      if (duration > 0) timeline.max = String(duration);
      timeline.value = String(Math.min(duration || 0, current));
      clock.textContent = formatTime(current) + ' / ' + formatTime(duration);
    }

    function updatePlayButton() {
      playButton.textContent = video.paused ? (video.ended ? '↻ 重播' : '▶ 播放') : 'Ⅱ 暂停';
    }

    function togglePlayback() {
      if (!previewReady) return;
      if (video.paused || video.ended) {
        if (video.ended) video.currentTime = 0;
        video.play().catch(() => {
          help.textContent = '浏览器阻止了自动播放，请点击播放或检查视频格式。';
        });
      } else {
        video.pause();
        updatePlayButton();
      }
    }

    playButton.addEventListener('click', togglePlayback);
    timeline.addEventListener('input', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration <= 0) return;
      video.currentTime = Math.min(duration, Math.max(0, Number(timeline.value)));
      updateProgress();
    });
    soundButton.addEventListener('click', () => {
      video.muted = !video.muted;
      soundButton.textContent = video.muted ? '静音' : '有声';
      soundButton.title = video.muted ? '开启预览声音' : '关闭预览声音';
      soundButton.setAttribute('aria-label', soundButton.title);
    });

    // Canvas 负责旋转与叠框：保留原图等比显示，编码端同样先旋转再裁剪。
    function drawVideoFrame() {
      if (finished || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      const rotation = Number(item.rotation || 0);
      const turned = rotation === 90 || rotation === 270;
      const rawW = video.videoWidth;
      const rawH = video.videoHeight;
      const width = turned ? rawH : rawW;
      const height = turned ? rawW : rawH;
      if (!initializedGeometry || width !== imageWidth || height !== imageHeight) {
        imageWidth = width;
        imageHeight = height;
        const downscale = Math.min(1, 1200 / width, 900 / height);
        canvas.width = Math.max(1, Math.round(width * downscale));
        canvas.height = Math.max(1, Math.round(height * downscale));
        cropWidth = Math.min(width, height * 9 / 16);
        cropHeight = Math.min(height, width * 16 / 9);
        initializedGeometry = true;
        previewReady = true;
        slider.disabled = cropWidth >= imageWidth - 0.001;
        submit.disabled = false;
        playButton.disabled = false;
        help.textContent = slider.disabled
          ? '该画面宽度已完全保留，无法再左右移动。'
          : '边播放边拖动白框，或暂停、跳进度确认主体始终在白框内。';
        updateBox();
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (rotation === 90) {
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
      } else if (rotation === 180) {
        ctx.translate(canvas.width, canvas.height);
        ctx.rotate(Math.PI);
      } else if (rotation === 270) {
        ctx.translate(0, canvas.height);
        ctx.rotate(-Math.PI / 2);
      }
      ctx.drawImage(video, 0, 0,
        turned ? canvas.height : canvas.width,
        turned ? canvas.width : canvas.height);
      ctx.restore();
    }

    function scheduleFrames() {
      if (finished || video.paused || video.ended || frameHandle !== null) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        frameHandleKind = 'video';
        frameHandle = video.requestVideoFrameCallback(() => {
          frameHandle = null;
          drawVideoFrame();
          scheduleFrames();
        });
      } else {
        frameHandleKind = 'raf';
        frameHandle = window.requestAnimationFrame(() => {
          frameHandle = null;
          drawVideoFrame();
          scheduleFrames();
        });
      }
    }

    video.addEventListener('play', () => { updatePlayButton(); scheduleFrames(); });
    video.addEventListener('pause', () => { stopFrames(); updatePlayButton(); drawVideoFrame(); });
    video.addEventListener('ended', () => { stopFrames(); updatePlayButton(); updateProgress(); });
    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('seeked', () => { drawVideoFrame(); updateProgress(); scheduleFrames(); });
    video.addEventListener('error', () => {
      if (finished) return;
      help.textContent = '浏览器无法解码该视频，因此无法动态预览裁剪范围。';
    });
    video.addEventListener('loadedmetadata', updateProgress);
    video.addEventListener('loadeddata', async () => {
      if (finished) return;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const time = Math.max(0, Math.min(Number(previewTime) || 0, Math.max(0, duration - 0.2)));
      if (time > 0.05) {
        try { video.currentTime = time; } catch {}
      }
      drawVideoFrame();
      updateProgress();
      // 静音自动播放避免浏览器拦截；即使原片暂停也可以直接观察动态取景。
      try { await video.play(); }
      catch {
        if (!finished) help.textContent = '点击「播放」开始动态预览。';
      }
    }, {once:true});
    video.src = item.mediaUrl;
    video.load();
  });
}

// v6.20 - unobtrusive transcoding status, works while POST remains pending.
const jfRunningJobs=new Map();
function jfStartMediaProgress(label){
  const raw=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  let panel=document.querySelector('#jfMediaJobHUD');
  if(!panel){
    panel=document.createElement('div');panel.id='jfMediaJobHUD';
    panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');
    panel.innerHTML='<div class="jfJobLine"><span class="jfJobName"></span><span class="jfJobPercent">处理中…</span></div><div class="jfJobTrack"><i></i></div>';
    document.body.appendChild(panel);
  }
  panel.hidden=false;
  panel.querySelector('.jfJobName').textContent=label;
  const percent=panel.querySelector('.jfJobPercent');
  const bar=panel.querySelector('.jfJobTrack i');
  percent.textContent='准备中…';bar.style.width='0%';
  let closed=false;
  jfRunningJobs.set(raw,true);
  let polling=false;
  const timer=setInterval(async()=>{
    if(closed||polling||document.hidden)return;
    polling=true;
    try{
      const response=await fetch('/api/media-progress?id='+encodeURIComponent(raw),{cache:'no-store'});
      const data=await response.json();
      if(!response.ok || !data.ok)return;
      if(data.percent===null){percent.textContent='处理中…';}
      else{percent.textContent=data.status==='done'?'100%':data.percent+'%';bar.style.width=data.percent+'%';}
    }catch(_){/* A running conversion must not fail because its progress view timed out. */}
    finally{polling=false;}
  },450);
  return {id:raw,done(success){
    closed=true;clearInterval(timer);jfRunningJobs.delete(raw);
    if(!jfRunningJobs.size){
      if(success){percent.textContent='已完成';bar.style.width='100%';}
      else{percent.textContent='已结束';}
      setTimeout(()=>{if(!jfRunningJobs.size)panel.hidden=true;},1250);
    }
  }};
}

async function jfTrackedMediaPost(url,body,label){
  const task=jfStartMediaProgress(label);
  let success=false;
  try {
    const result=await mediaPost(url,{...body,jobId:task.id});
    success=true;
    return result;
  }finally{task.done(success);}
}

async function makePortraitVideo(key, button, sourceVideo) {
  const item = allItems.find(x => x.key === key);
  if (!item || item.kind !== 'video') return;
  if (portraitPendingKeys.has(key)) return;

  portraitPendingKeys.add(key);
  const buttonLabel = button && button.querySelector('.feedToolLabel');
  const oldText = buttonLabel ? buttonLabel.textContent : '';
  if (button) button.disabled = true;
  try {
    // 裁剪时暂停背后原播放器，避免两条声音与画面同时运行；关闭后恢复原状态。
    const sourceWasPlaying = Boolean(sourceVideo && !sourceVideo.paused && !sourceVideo.ended);
    if (sourceWasPlaying) sourceVideo.pause();
    let cropX;
    try {
      cropX = await choosePortraitCrop(item, sourceVideo ? sourceVideo.currentTime : item.coverTime);
    } finally {
      if (sourceWasPlaying && sourceVideo && sourceVideo.isConnected) {
        sourceVideo.play().catch(() => {});
      }
    }
    if (cropX === null) return;
    if (button && button.isConnected) {
      button.classList.add('loading');
      button.setAttribute('aria-busy','true');
      if (buttonLabel) buttonLabel.textContent = '处理中';
    }
    const task=jfStartMediaProgress('生成竖屏视频');
    let response;
    try {response = await fetch('/api/create-portrait', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({key, cropX,jobId:task.id})
    });
    } finally {task.done(Boolean(response && response.ok));}
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || '竖屏生成失败');
    }
    await load();
    alert(result.reused
      ? '这个水平取景位置已生成过竖屏视频，可在列表中找到。'
      : '9:16 竖屏视频已生成并加入媒体库，原视频保留。\n关闭播放界面即可找到新视频。');
  } catch (error) {
    alert('竖屏生成失败：' + (error.message || error));
  } finally {
    portraitPendingKeys.delete(key);
    if (button && button.isConnected) {
      button.disabled = false;
      button.classList.remove('loading');
      button.removeAttribute('aria-busy');
      if (buttonLabel) buttonLabel.textContent = oldText;
    }
  }
}