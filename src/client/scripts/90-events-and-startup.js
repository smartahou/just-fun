

grid.addEventListener(
  'pointermove',
  moveRating
);

grid.addEventListener(
  'pointerup',
  endRating
);

grid.addEventListener(
  'input',
  event => {
    const range =
      event.target.closest(
        '.coverRange'
      );

    if (!range) {
      return;
    }

    const seek =
      range.closest(
        '.coverSeek'
      );

    const label =
      seek &&
      seek.querySelector(
        '.coverTime'
      );

    if (label) {
      label.textContent =
        formatTime(
          Number(
            range.value
          )
        );
    }

    queueCover(
      range
    );
  }
);

document
  .querySelector(
    '#search'
  )
  .addEventListener(
    'input',
    render
  );

document
  .querySelector(
    '#creatorToggle'
  )
  .addEventListener(
    'click',
    () => {
      creatorOpen =
        !creatorOpen;

      document
        .querySelector(
          '#creatorPanel'
        )
        .classList.toggle(
          'collapsed',
          !creatorOpen
        );

      renderCreatorTags();
    }
  );

function updateSortButtons() {
  const ratingButton =
    document.querySelector(
      '#sortRatingBtn'
    );

  const mtimeButton =
    document.querySelector(
      '#sortMtimeBtn'
    );

  const arrow =
    sortDirection === 'desc'
      ? '↓'
      : '↑';

  ratingButton.classList.toggle(
    'active',
    sortMode === 'rating'
  );

  mtimeButton.classList.toggle(
    'active',
    sortMode === 'mtime'
  );

  ratingButton.textContent =
    '评分 ' +
    (sortMode === 'rating'
      ? arrow
      : '');

  mtimeButton.textContent =
    '修改时间 ' +
    (sortMode === 'mtime'
      ? arrow
      : '');
}

function selectSortMode(mode) {
  if (sortMode === mode) {
    sortDirection =
      sortDirection === 'desc'
        ? 'asc'
        : 'desc';
  } else {
    sortMode = mode;
    // 切换排序字段时默认把评分最高 / 文件最新的放前面。
    sortDirection = 'desc';
  }

  updateSortButtons();
  render();
}

document
  .querySelector(
    '#sortRatingBtn'
  )
  .addEventListener(
    'click',
    () => {
      selectSortMode(
        'rating'
      );
    }
  );

document
  .querySelector(
    '#sortMtimeBtn'
  )
  .addEventListener(
    'click',
    () => {
      selectSortMode(
        'mtime'
      );
    }
  );

const feedScrollerElement =
  document.querySelector(
    '#feedScroller'
  );

if (feedScrollerElement) {
  feedScrollerElement.addEventListener(
    'pointerdown',
    event => {
      if (
        fullscreenVideoElement()
      ) {
        return;
      }

      const stars =
        event.target.closest(
          '.feedRating'
        );

      if (!stars) {
        return;
      }

      event.stopPropagation();

      startRating(
        event,
        stars
      );
    }
  );

  feedScrollerElement.addEventListener(
    'pointermove',
    moveRating
  );

  feedScrollerElement.addEventListener(
    'pointerup',
    endRating
  );
}

// 普通 Feed 的触屏滑动只在抬手时切换一次，不交由浏览器惯性滚动。
const feedTouchGesture = { pointerId:null, x:0, y:0 };
const feedTouchScroller = document.querySelector('#feedScroller');
if (feedTouchScroller) {
  feedTouchScroller.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (fullscreenVideoElement() || document.querySelector('.shotStudioBack, .portraitDialogBack')) return;
    if (event.target.closest('button, input, select, textarea, .feedRating')) return;
    const video = event.target.closest('video');
    if (video && (video.getBoundingClientRect().bottom - event.clientY) < 90) return;
    if (video && focusZoomStates.get(video)?.enabled) return;
    feedTouchGesture.pointerId = event.pointerId;
    feedTouchGesture.x = event.clientX;
    feedTouchGesture.y = event.clientY;
  }, { passive:true });
  feedTouchScroller.addEventListener('pointerup', event => {
    if (feedTouchGesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - feedTouchGesture.x;
    const dy = event.clientY - feedTouchGesture.y;
    feedTouchGesture.pointerId = null;
    if (Math.abs(dy) < 65 || Math.abs(dy) < Math.abs(dx) * 1.25) return;
    stepFeed(dy < 0 ? 1 : -1);
  });
  feedTouchScroller.addEventListener('pointercancel', () => {
    feedTouchGesture.pointerId = null;
  });
}

const feedOverlayElement =
  document.querySelector(
    '#feedOverlay'
  );

if (feedOverlayElement) {
  const wakeImmersiveChrome =
    () => {
      if (
        !currentFeedFocusEnabled()
      ) {
        return;
      }

      showImmersiveChrome();

      scheduleImmersiveChromeHide();
    };

  feedOverlayElement.addEventListener(
    'pointermove',
    wakeImmersiveChrome,
    {
      passive:true
    }
  );

  feedOverlayElement.addEventListener(
    'pointerdown',
    wakeImmersiveChrome,
    {
      passive:true
    }
  );

  feedOverlayElement.addEventListener(
    'wheel',
    () => {
      if (
        currentFeedFocusEnabled()
      ) {
        showImmersiveChrome();

        scheduleImmersiveChromeHide();
      }
    },
    {
      passive:true
    }
  );
}

document
  .querySelector(
    '#feedClose'
  )
  .addEventListener(
    'click',
    closeFeed
  );

document
  .querySelector(
    '#feedSetA'
  )
  .addEventListener(
    'click',
    () => {
      const item =
        getCurrentFeedItem();

      const video =
        getCurrentFeedVideo();

      if (
        !item ||
        item.kind !== 'video' ||
        !video
      ) {
        return;
      }

      const state =
        getFeedABState(
          item.key
        );

      if (state.auto) { state.b = NaN; state.enabled = false; video.loop = true; }
      state.manual = true;
      state.auto = false;
      state.a =
        Number(
          video.currentTime || 0
        );

      if (
        Number.isFinite(
          state.b
        ) &&
        state.b <=
          state.a
      ) {
        state.b =
          NaN;

        state.enabled =
          false;

        video.loop =
          true;
      }

      updateFeedABUi();
    }
  );

document
  .querySelector(
    '#feedSetB'
  )
  .addEventListener(
    'click',
    () => {
      const item =
        getCurrentFeedItem();

      const video =
        getCurrentFeedVideo();

      if (
        !item ||
        item.kind !== 'video' ||
        !video
      ) {
        return;
      }

      const state =
        getFeedABState(
          item.key
        );

      state.manual = true;
      state.auto = false;
      state.b =
        Number(
          video.currentTime || 0
        );

      if (
        Number.isFinite(
          state.a
        ) &&
        state.b <=
          state.a
      ) {
        state.enabled =
          false;

        video.loop =
          true;
      }

      updateFeedABUi();
    }
  );


async function toggleGhostPlayback() {
  const item=getCurrentFeedItem(),video=getCurrentFeedVideo();
  if(!item || item.kind!=='video' || !video || ghostPreparing)return;
  if(ghostPlayback && ghostPlayback.key===item.key){stopGhostPlayback(true);return;}
  if(ghostPlayback)stopGhostPlayback(true);
  const ab=getFeedABState(item.key);
  const total=Number(item.duration||video.duration||0);
  const segment=validABState(ab)?{a:ab.a,b:ab.b}:{a:0,b:total};
  if(!segment.b || segment.b-segment.a>20.01){alert('鬼畜循环仅支持 20 秒以内的视频或 A/B 区间，请先标记较短的 A/B 片段。');return;}
  const requestGeneration=++ghostRequestGeneration;
  ghostPreparing=true;updateFeedABUi();
  try{
    const result=await fetch('/api/ghost-loop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:item.key,...segment})}).then(r=>r.json());
    if(requestGeneration!==ghostRequestGeneration || currentFeedKey!==item.key ||
       !video.isConnected || !document.querySelector('#feedOverlay').classList.contains('open'))return;
    if(!result.ok)throw new Error(result.error||'生成失败');
    const playing=!video.paused;
    const originalSrc=item.mediaUrl;
    // Ghost video already contains normal-direction audio in both halves.
    ab.enabled=false;
    video.pause();
    video.dataset.ghostMode='1';
    video.src=result.url;
    video.loop=true;
    video.load();
    ghostPlayback={key:item.key,video,originalSrc,a:segment.a,b:segment.b};
    if(playing)await video.play();
  }catch(error){if(requestGeneration===ghostRequestGeneration)alert('鬼畜循环不可用：'+error.message);}
  finally{if(requestGeneration===ghostRequestGeneration){ghostPreparing=false;updateFeedABUi();}}
}
function stopGhostPlayback(restore) {
  const old=ghostPlayback;
  ghostPlayback=null;
  if(!old)return;
  const video=old.video;
  if(!video)return;
  if(!restore){
    video.pause();
    delete video.dataset.ghostMode;
    video.src=old.originalSrc;
    video.loop=true;
    video.dataset.loaded='1';
    video.load();
    return;
  }
  const playing=!video.paused;
  const length=old.b-old.a;
  const pos=Number(video.currentTime)||0;
  const phase=length>0?pos%(2*length):0;
  const desired=phase<=length?old.a+phase:old.b-(phase-length);
  video.pause();
  delete video.dataset.ghostMode;
  video.src=old.originalSrc;
  video.loop=true;
  video.load();
  video.addEventListener('loadedmetadata',function once(){
    video.removeEventListener('loadedmetadata',once);
    try{video.currentTime=Math.max(0,Math.min(desired,video.duration||desired));}catch{}
    if(playing && currentFeedKey===old.key)video.play().catch(()=>{});
  });
  updateFeedABUi();
}
document.querySelector('#feedGhostLoop').addEventListener('click',toggleGhostPlayback);
// Any other editing action leaves ghost mode to keep original-file time coordinates correct.
document.querySelector('#feedToolPanel')?.addEventListener('click',event=>{
  if(ghostPlayback && event.target.closest('button')?.id!=='feedGhostLoop'){
    stopGhostPlayback(true);
    event.preventDefault();
    event.stopImmediatePropagation();
    if(typeof unifiedToast==='function')unifiedToast('已退出鬼畜模式，请再次操作');
  }
},true);

document
  .querySelector(
    '#feedABLoop'
  )
  .addEventListener(
    'click',
    () => {
      const item =
        getCurrentFeedItem();

      const video =
        getCurrentFeedVideo();

      if (
        !item ||
        item.kind !== 'video' ||
        !video
      ) {
        return;
      }

      const state =
        getFeedABState(
          item.key
        );

      if (
        !validABState(
          state
        )
      ) {
        alert(
          '请先设置有效的 A、B 时间点，且 B 必须晚于 A。'
        );

        return;
      }

      state.manual = true;
      state.auto = false;
      state.enabled =
        !state.enabled;

      video.loop =
        !state.enabled;

      if (state.enabled) {
        if (
          video.currentTime <
            state.a ||
          video.currentTime >=
            state.b
        ) {
          video.currentTime =
            state.a;
        }

        video
          .play()
          .catch(
            () => {}
          );
      }

      updateFeedABUi();
    }
  );

document.getElementById('feedABQuickActions').addEventListener('click', event=>{
  if(!event.target.closest('button') || !ghostPlayback)return;
  stopGhostPlayback(true);
  event.preventDefault();
  event.stopImmediatePropagation();
  if(typeof unifiedToast==='function')unifiedToast('已退出鬼畜模式，请再次操作');
},true);
document
  .querySelector(
    '#feedClip'
  )
  .addEventListener(
    'click',
    clipCurrentFeedAB
  );

// v6.31: unified point and interval annotations are implemented in 95-annotations.js.


document.querySelector('#feedScreenshot').addEventListener('click',()=>performVideoAction('shot'));
document.querySelector('#feedAudio').addEventListener('click',()=>performVideoAction('audio'));

document.querySelector('#feedPortrait').addEventListener('click', () => {
  if (currentFeedKey) {
    makePortraitVideo(currentFeedKey, document.querySelector('#feedPortrait'), getCurrentFeedVideo());
  }
});

document
  .querySelector(
    '#feedMagnify'
  )
  .addEventListener(
    'click',
    () => {
      const video =
        getCurrentFeedVideo();

      const button =
        document.querySelector(
          '#feedMagnify'
        );

      if (
        !video ||
        !button
      ) {
        return;
      }

      const enabled =
        toggleFocusZoom(
          video
        );

      button.classList.toggle(
        'active',
        enabled
      );

      button.title =
        enabled
          ? '关闭宽屏聚焦'
          : '宽屏聚焦';
      button.setAttribute('aria-pressed',String(enabled));
      button.setAttribute('aria-label',button.title);
    }
  );

document
  .querySelector(
    '#feedDelete'
  )
  .addEventListener(
    'click',
    armFeedDelete
  );

document
  .querySelector(
    '#feedRotate'
  )
  .addEventListener(
    'click',
    () => {
      if (!currentFeedKey) {
        return;
      }

      const item =
        allItems.find(
          x => x.key === currentFeedKey
        );

      if (!item || item.kind !== 'video') {
        return;
      }

      rotateItem(currentFeedKey);
    }
  );

document
  .querySelector(
    '#feedMulti'
  )
  .addEventListener(
    'click',
    () => {
      if (
        currentFeedKey
      ) {
        openMulti(
          currentFeedKey
        );
      }
    }
  );

// 以滚轮/触控板「整次手势」为单位限跳，而不是固定 430ms 后解锁。
// 惯性尾部通常持续多个事件；每收到一个事件都重新计时，
// 直到真的停下来才允许下一次切换。
const FEED_WHEEL_IDLE_MS = 340;
const FEED_WHEEL_MIN_DELTA = 30;
let feedWheelGestureTriggered = false;
let feedWheelGestureDistance = 0;
let feedWheelUnlockTimer = null;

function resetFeedWheelGesture() {
  clearTimeout(feedWheelUnlockTimer);
  feedWheelUnlockTimer = null;
  feedWheelGestureTriggered = false;
  feedWheelGestureDistance = 0;
}

function navigateByWheel(event) {
  // 包括小于 8px 的惯性尾部也要拦截，不能回退给浏览器原生滚动。
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();

  if (!document.querySelector('#feedOverlay').classList.contains('open')) {
    return;
  }
  if (document.querySelector('.shotStudioBack, .portraitDialogBack')) {
    return;
  }

  const wasIdle = feedWheelUnlockTimer === null;
  clearTimeout(feedWheelUnlockTimer);
  feedWheelUnlockTimer = setTimeout(resetFeedWheelGesture, FEED_WHEEL_IDLE_MS);
  if (wasIdle) {
    feedWheelGestureTriggered = false;
    feedWheelGestureDistance = 0;
  }
  if (feedWheelGestureTriggered) return;

  // 触控板使用像素滚动；传统鼠标滚轮可以使用行/页单位。
  const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
  const dy = Number(event.deltaY || 0) * factor;
  const dx = Number(event.deltaX || 0) * factor;
  if (Math.abs(dx) > Math.abs(dy) * 1.3) return;
  feedWheelGestureDistance += dy;
  if (Math.abs(feedWheelGestureDistance) < FEED_WHEEL_MIN_DELTA) return;

  feedWheelGestureTriggered = true;
  const direction = feedWheelGestureDistance > 0 ? 1 : -1;
  if (fullscreenVideoElement()) {
    stepNativeFullscreen(direction);
  } else {
    stepFeed(direction);
  }
}

document
  .querySelector(
    '#feedScroller'
  )
  .addEventListener(
    'wheel',
    event => {
      // 原生 video fullscreen 时由 document capture 监听处理，
      // 防止底层 Feed 再收到一次相同滚轮事件。
      if (
        fullscreenVideoElement()
      ) {
        return;
      }

      navigateByWheel(
        event
      );
    },
    {
      passive:false
    }
  );

// 原生 video fullscreen 会把 video 放到浏览器顶层。
// 用 capture 监听，确保滚轮作用于“当前全屏 video”，
// 而不是滚动被它遮住的 Feed。
document.addEventListener(
  'wheel',
  event => {
    const video =
      fullscreenVideoElement();

    if (!video) {
      return;
    }

    const magnifier =
      focusZoomStates.get(
        video
      );

    if (
      magnifier &&
      magnifier.enabled
    ) {
      return;
    }

    navigateByWheel(
      event
    );
  },
  {
    passive:false,
    capture:true
  }
);

document.addEventListener(
  'fullscreenchange',
  rememberFullscreenState
);

document.addEventListener(
  'webkitfullscreenchange',
  rememberFullscreenState
);


// v6.30: use a single capture-phase keyboard shortcut for both the Feed and
// independently opened mini players.  The previous bubble handler never
// handled mini players and allowed Chromium's native controls to intercept
// the arrow keys when the video was focused.
let keyboardActiveMiniVideo = null;
document.addEventListener('pointerdown', event => {
  const box = event.target?.closest?.('#multiDock .miniPlayer');
  if (box) keyboardActiveMiniVideo = box.querySelector('video');
  else keyboardActiveMiniVideo = null;
}, true);

document.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (event.defaultPrevented || event.ctrlKey || event.altKey ||
      event.metaKey || event.shiftKey) return;

  const target = event.target;
  // Do not override editing, native sliders, screen-shot frame stepping,
  // photo navigation, audio sliders or modal dialog shortcuts.
  if (target?.closest?.('input, textarea, select, [contenteditable], [role="slider"]') ||
      document.querySelector('.shotStudioBack, .portraitDialogBack, #clipShelfBack:not([hidden]), #assetView.open, .unifiedRenameBack:not([hidden]), .unifiedMoveBack:not([hidden]), .unifiedAlbumBack:not([hidden])')) return;

  const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
  const nativeVideo = fullscreen?.matches?.('video.feedVideo, #multiDock .miniPlayer video') ? fullscreen : null;
  const activeMini = target?.closest?.('#multiDock .miniPlayer')?.querySelector('video') ||
    (keyboardActiveMiniVideo?.isConnected ? keyboardActiveMiniVideo : null);
  const feedOpen = document.querySelector('#feedOverlay')?.classList.contains('open');
  // When a Feed is open, it wins unless the user explicitly focused a mini
  // video. In library view, only a previously interacted mini player qualifies.
  const focusedMini = target?.closest?.('#multiDock .miniPlayer')?.querySelector('video');
  const video = nativeVideo || focusedMini ||
    (feedOpen ? getCurrentFeedVideo() : activeMini);
  if (!seekVideoSeconds(video, event.key === 'ArrowRight' ? 5 : -5)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

document.addEventListener(
  'keydown',
  event => {
    if (
      !document
        .querySelector(
          '#feedOverlay'
        )
        .classList.contains(
          'open'
        )
    ) {
      return;
    }

    const target =
      event.target;

    if (
      target &&
      (
        target.tagName ===
          'INPUT' ||
        target.tagName ===
          'TEXTAREA'
      )
    ) {
      return;
    }

    // Video seeking is handled by the capturing listener below, before the
    // browser's native <video controls> keyboard handling can take precedence.
    // Keep this handler for Up/Down, Escape, etc.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return;

    if (
      event.repeat &&
      ['ArrowDown','ArrowUp','PageDown','PageUp'].includes(event.key)
    ) {
      event.preventDefault();
      return;
    }

    if (
      event.key ===
        'ArrowDown' ||
      event.key ===
        'PageDown'
    ) {
      event.preventDefault();

      if (
        fullscreenVideoElement()
      ) {
        stepNativeFullscreen(
          1
        );
      } else {
        stepFeed(
          1
        );
      }
    } else if (
      event.key ===
        'ArrowUp' ||
      event.key ===
        'PageUp'
    ) {
      event.preventDefault();

      if (
        fullscreenVideoElement()
      ) {
        stepNativeFullscreen(
          -1
        );
      } else {
        stepFeed(
          -1
        );
      }
    } else if (
      event.key ===
        'Escape'
    ) {
      // 原生全屏时浏览器自己先处理 Esc 退出 fullscreen。
      // 非原生全屏状态下才关闭 Feed。
      if (
        !fullscreenVideoElement()
      ) {
        closeFeed();
      }
    }
  }
);

document
  .querySelector(
    '#miniSyncStart'
  )
  .addEventListener(
    'click',
    restartAllMiniVideos
  );

document
  .querySelector(
    '#miniVisibilityToggle'
  )
  .addEventListener(
    'click',
    toggleMiniWindowsVisibility
  );

updateMiniVisibilityToggle();


// Just Fun v6.7 — conservative real-time color grading; no face segmentation, no file changes.
const jfFilterState={video:{preset:'none',strength:65},photo:{preset:'none',strength:65}};
const jfFilterCurves={
  clear:{brightness:1.055,contrast:1.04,saturate:1.08,sepia:.015,hue:-1},
  cream:{brightness:1.035,contrast:.96,saturate:1.09,sepia:.10,hue:-3},
  night:{brightness:1.17,contrast:1.11,saturate:1.14,sepia:.02,hue:-1},
  bold:{brightness:1.005,contrast:1.25,saturate:1.36,sepia:.06,hue:-2},
  flame:{brightness:1.02,contrast:1.18,saturate:1.35,sepia:.2,hue:-8},
  honey:{brightness:1.025,contrast:1.17,saturate:1.27,sepia:.25,hue:-5},
  vivid:{brightness:1.015,contrast:1.22,saturate:1.56,sepia:.035,hue:0}
};

// Dynamic, luminance-sampled character rendering, not a green tint overlay.
// Each frame samples the *actual* current video/image pixels (no external model).
const jfMatrixRuntime={video:null,photo:null};
function jfStopMatrix(mode){
 const job=jfMatrixRuntime[mode];if(!job)return;
 job.running=false;
 if(job.frame)cancelAnimationFrame(job.frame);
 job.canvas.remove();jfMatrixRuntime[mode]=null;
}
function jfStartMatrix(mode){
 let source=mode==='video'?getCurrentFeedVideo():(document.querySelector('#assetView .jfLivePhotoVideo')||document.getElementById('assetViewImg'));
 let host=mode==='video'?source?.closest('.videoStage'):document.querySelector('#assetView .photoImageSurface');
 if(!source||!host||jfFilterState[mode].preset!=='matrix'){jfStopMatrix(mode);return;}
 const current=jfMatrixRuntime[mode];
 if(current&&current.source===source&&current.host===host)return;
 jfStopMatrix(mode);
 const canvas=document.createElement('canvas');canvas.className='jfFilterMatrixCanvas';canvas.setAttribute('aria-hidden','true');
 const computed=getComputedStyle(host);if(computed.position==='static')host.style.position='relative';
 host.append(canvas);
 const sample=document.createElement('canvas');const sx=sample.getContext('2d',{willReadFrequently:true});
 const ctx=canvas.getContext('2d',{alpha:false});
 if(!ctx||!sx){canvas.remove();return;}
 const job={running:true,canvas,source,host,frame:0,last:0};jfMatrixRuntime[mode]=job;
 const render=stamp=>{
  if(!job.running)return;
  job.frame=requestAnimationFrame(render);
  if(stamp-job.last<120)return;job.last=stamp;
  if(jfFilterState[mode].preset!=='matrix' || (mode==='video'&&source!==getCurrentFeedVideo())){jfStopMatrix(mode);return;}
  const w=host.clientWidth,h=host.clientHeight;
  const isMotion=source.tagName==='VIDEO';
  const ready=isMotion?source.readyState>=2:source.complete&&source.naturalWidth>0;
  const sw=isMotion?source.videoWidth:source.naturalWidth,sh=isMotion?source.videoHeight:source.naturalHeight;
  if(!ready||!sw||!sh||w<2||h<2)return;
  // Compute object-fit:contain output rectangle, including picture zoom and drag.
  const hostRect=host.getBoundingClientRect(),srcRect=source.getBoundingClientRect();
  let x=0,y=0,dw=0,dh=0;
  if(mode==='video'){
   const videoW=srcRect.width||w, videoH=srcRect.height||h;
   const scale=Math.min(videoW/sw,videoH/sh);
   dw=sw*scale;dh=sh*scale;x=srcRect.left-hostRect.left+(videoW-dw)/2;y=srcRect.top-hostRect.top+(videoH-dh)/2;
  } else {
   const fit=Math.min(srcRect.width/sw,srcRect.height/sh);
   dw=sw*fit;dh=sh*fit;x=srcRect.left-hostRect.left+(srcRect.width-dw)/2;y=srcRect.top-hostRect.top+(srcRect.height-dh)/2;
  }
  const ratio=Math.min(window.devicePixelRatio||1,1.5);
  const cw=Math.max(1,Math.round(w*ratio)),ch=Math.max(1,Math.round(h*ratio));
  if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
  ctx.save();ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
  ctx.fillStyle='rgba(0,4,2,.96)';ctx.fillRect(x,y,dw,dh);
  // Cells stay small enough to reveal facial structure but remain real digits.
  const cellW=Math.max(7,Math.min(12,dw/84));const cellH=cellW*1.26;
  const cols=Math.max(1,Math.ceil(dw/cellW)),rows=Math.max(1,Math.ceil(dh/cellH));
  if(sample.width!==cols||sample.height!==rows){sample.width=cols;sample.height=rows;}
  let pixels;
  try{sx.drawImage(source,0,0,cols,rows);pixels=sx.getImageData(0,0,cols,rows).data;}
  catch(e){ // Cross-origin/decoder restrictions: stop cleanly, never break playback.
    jfStopMatrix(mode);ctx.restore();return;
  }
  ctx.font='bold '+(cellH*.86)+'px monospace';ctx.textBaseline='top';
  const phase=Math.floor(stamp/115);
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
   const off=(row*cols+col)*4;
   const r=pixels[off],g=pixels[off+1],b=pixels[off+2];
   const lum=(r*.26+g*.62+b*.12)/255;
   const edge=col>0?Math.abs(lum-(pixels[off-4]*.26+pixels[off-3]*.62+pixels[off-2]*.12)/255):0;
   // Reconstruct faces/contours from luminance and contrast, not random rain alone.
   const intensity=Math.min(1,Math.pow(lum,.75)*.92+edge*1.45);
   const stream=(col*17+phase-row*3)%29===0? .2:0;
   const alpha=Math.max(.055,Math.min(1,intensity*.96+stream));
   const green=Math.round(135+intensity*120);const red=Math.round(14+intensity*58);
   ctx.fillStyle='rgba('+red+','+green+','+Math.round(55+intensity*88)+','+alpha.toFixed(3)+')';
   const digit=((row*71+col*37+Math.floor(phase/3))%7)<3?'0':'1';
   ctx.fillText(digit,x+col*cellW,y+row*cellH);
  }
  ctx.restore();
 };
 job.frame=requestAnimationFrame(render);
}

function jfFilterCSS(mode){
 const state=jfFilterState[mode];
 const target=jfFilterCurves[state.preset];
 if(!target||state.strength===0)return 'none';
 const ratio=state.strength/100;
 const interp=(value,neutral)=>Number((neutral+(value-neutral)*ratio).toFixed(4));
 return 'brightness('+interp(target.brightness,1)+') contrast('+interp(target.contrast,1)+') saturate('+interp(target.saturate,1)+') sepia('+interp(target.sepia,0)+') hue-rotate('+Number((target.hue*ratio).toFixed(2))+'deg)';
}
let jfLastFilteredVideo=null;
function jfApplyFilter(mode){
 const css=jfFilterCSS(mode);
 if(jfFilterState[mode].preset==='matrix'){
  jfStartMatrix(mode);
 }else jfStopMatrix(mode);
 if(mode==='photo'){
   // The live-photo VIDEO replaces (and hides) the IMG; both must share the grade.
   for(const surface of [document.getElementById('assetViewImg'),document.querySelector('#assetView .jfLivePhotoVideo')]){
     if(surface)surface.style.setProperty('filter',css,'important');
   }
 }else{
   const video=getCurrentFeedVideo();
   // Switching or dragging the strength slider never traverses the entire feed DOM.
   if(jfLastFilteredVideo&&jfLastFilteredVideo!==video)jfLastFilteredVideo.style.removeProperty('filter');
   if(video){video.style.setProperty('filter',css,'important');jfLastFilteredVideo=video;}
   else jfLastFilteredVideo=null;
 }
 const panel=document.querySelector('.jfFilterPanel[data-jf-mode="'+mode+'"]');
 if(!panel)return;
 panel.dataset.jfActivePreset=jfFilterState[mode].preset;
 panel.querySelectorAll('[data-jf-preset]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.jfPreset===jfFilterState[mode].preset)));
 const slider=panel.querySelector('[data-jf-strength]');
 slider.value=String(jfFilterState[mode].strength);
 slider.disabled=jfFilterState[mode].preset==='none';
 panel.querySelector('[data-jf-value]').textContent=String(jfFilterState[mode].strength)+'%';
}
function jfCloseFilter(mode){
 const panel=document.querySelector('.jfFilterPanel[data-jf-mode="'+mode+'"]');
 if(panel)panel.hidden=true;
}
function jfResetVideoFilter(){
 jfStopMatrix('video');
 jfFilterState.video={preset:'none',strength:65};
 jfCloseFilter('video');jfApplyFilter('video');
}
function jfResetPhotoFilter(){
 jfStopMatrix('photo');
 jfFilterState.photo={preset:'none',strength:65};
 jfCloseFilter('photo');jfApplyFilter('photo');
}
function jfToggleFilter(mode){
 const panel=document.querySelector('.jfFilterPanel[data-jf-mode="'+mode+'"]');
 if(!panel)return;
 const visible=panel.hidden;panel.hidden=!visible;
 if(mode==='video' && visible && document.querySelector('#feedOverlay')?.classList.contains('toolsOpen'))setStudioFeedPanel('tools',false);
 if(mode==='photo' && visible){document.getElementById('photoMorePanel').hidden=true;document.getElementById('photoMoreToggle').setAttribute('aria-expanded','false');}
 jfApplyFilter(mode);
}
document.querySelector('#feedFilter').addEventListener('click',()=>jfToggleFilter('video'));
document.querySelector('#photoFilterToggle').addEventListener('click',()=>jfToggleFilter('photo'));
document.querySelectorAll('.jfFilterPanel').forEach(panel=>{
 const mode=panel.dataset.jfMode;
 panel.addEventListener('pointerdown',e=>e.stopPropagation());
 panel.querySelector('.jfFilterClose').addEventListener('click',()=>jfCloseFilter(mode));
 panel.addEventListener('click',e=>{
  const btn=e.target.closest('[data-jf-preset]');if(!btn)return;
  jfFilterState[mode].preset=btn.dataset.jfPreset;jfApplyFilter(mode);
 });
 panel.querySelector('[data-jf-strength]').addEventListener('input',e=>{
  jfFilterState[mode].strength=Math.max(0,Math.min(100,Number(e.target.value)||0));jfApplyFilter(mode);
 });
});


/* v6.16: scroll-aware header, contextual media rail, persisted list density. */
const studioViewToggle=document.getElementById('videoViewToggle');
studioViewToggle.addEventListener('click',()=>{
  videoViewMode=videoViewMode==='cover'?'text':'cover';
  try {localStorage.setItem(VIDEO_VIEW_PREF,videoViewMode);} catch (_) {}
  if(libraryMode==='video')render();
});
const studioRailToggle=document.getElementById('studioRailToggle');
const studioMediaRail=document.getElementById('studioMediaRail');
function railOverlap(a,b){return a.left<b.right+6&&a.right+6>b.left&&a.top<b.bottom+6&&a.bottom+6>b.top;}
function studioPositionRail(){
  const music=document.getElementById('audioDock');
  music?.style.removeProperty('--jf-rail-music-shift');
  studioRailToggle.style.removeProperty('--rail-toggle-left');
  studioMediaRail.style.removeProperty('--rail-left');
  if(!music || music.hidden || !music.classList.contains('isMinimized'))return;
  const base=innerWidth<=700?11:18;
  // Open rail always stays anchored bottom-left. Only the tiny music bubble moves,
  // without rewriting its persisted drag position or changing width/height.
  const m=music.getBoundingClientRect();
  if(studioMediaRail.classList.contains('railOpen')){
    const w=studioMediaRail.offsetWidth,h=studioMediaRail.offsetHeight;
    const bottom=innerWidth<=700?69:78;
    const rail={left:base,right:base+w,top:innerHeight-bottom-h,bottom:innerHeight-bottom};
    const delta=Math.min(Math.max(0,innerWidth-m.right-8),rail.right-m.left+12);
    if(railOverlap(rail,m) && delta>0)music.style.setProperty('--jf-rail-music-shift',delta+'px');
    else if(railOverlap(rail,m))studioMediaRail.style.setProperty('--rail-left',Math.max(base,innerWidth-w-9)+'px');
  }
  const shifted=music.getBoundingClientRect(),btn=studioRailToggle.getBoundingClientRect();
  if(railOverlap(btn,shifted))studioRailToggle.style.setProperty('--rail-toggle-left',Math.min(innerWidth-55,Math.max(base,shifted.right+12))+'px');
}
function studioSetRail(open){
  studioMediaRail.classList.toggle('railOpen',open);
  studioRailToggle.setAttribute('aria-expanded',String(open));
  studioRailToggle.setAttribute('aria-label',open?'收起媒体导航':'展开媒体导航');
  studioRailToggle.title=open?'收起媒体导航':'展开媒体导航';
  requestAnimationFrame(studioPositionRail);
}
studioRailToggle.addEventListener('click',()=>studioSetRail(!studioMediaRail.classList.contains('railOpen')));
studioMediaRail.addEventListener('click',event=>{if(event.target.closest('[data-media-kind]'))studioSetRail(false);});
document.addEventListener('pointerdown',event=>{
  if(studioMediaRail.classList.contains('railOpen')&&!studioMediaRail.contains(event.target)&&!studioRailToggle.contains(event.target))studioSetRail(false);
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&studioMediaRail.classList.contains('railOpen'))studioSetRail(false);});
window.addEventListener('resize',()=>requestAnimationFrame(studioPositionRail),{passive:true});
const railMusicObserver=new MutationObserver(()=>requestAnimationFrame(studioPositionRail));
railMusicObserver.observe(document.getElementById('audioDock'),{attributes:true,attributeFilter:['class','hidden','style']});
let lastHeaderScroll=window.scrollY,headerTick=false;
window.addEventListener('scroll',()=>{
  if(headerTick)return;headerTick=true;
  requestAnimationFrame(()=>{
    headerTick=false;
    const now=Math.max(0,window.scrollY),delta=now-lastHeaderScroll;
    lastHeaderScroll=now;
    const header=document.querySelector('body>.studioHeader');
    if(now<header.offsetHeight+20 || header.contains(document.activeElement) || document.body.classList.contains('unifiedSelecting'))header.classList.remove('studioHeaderCollapsed');
    else if(delta>7)header.classList.add('studioHeaderCollapsed');
    else if(delta<-7)header.classList.remove('studioHeaderCollapsed');
  });
},{passive:true});
requestAnimationFrame(studioPositionRail);

// v6.22: the first successful media render (or a safe timeout) releases splash.
// Never wait on full-library thumbnails: only the first visible few are relevant.
let jfBootSplashReleased=false;
let jfBootSplashScheduled=false;
const jfBootSplash=document.getElementById('jfAppSplash');
if(jfBootSplash){
  const source=document.querySelector('.studioBrandLogo');
  const target=jfBootSplash.querySelector('.jfSplashLogo');
  if(source && target) target.src=source.src;
}
function jfReleaseBootSplash(){
  if(jfBootSplashReleased || jfBootSplashScheduled)return;
  jfBootSplashScheduled=true;
  (async()=>{
    const thumbnails=[...document.querySelectorAll('#grid .jfCoverTile .cover img.cover')].slice(0,4);
    const firstPaint=Promise.all(thumbnails.map(img=>img.complete ? Promise.resolve() : (img.decode ? img.decode().catch(()=>{}) : new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});}))));
    await Promise.race([firstPaint,new Promise(resolve=>setTimeout(resolve,850))]);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(jfBootSplashReleased)return;
    jfBootSplashReleased=true;
    document.body.classList.remove('jfBooting');
    if(jfBootSplash){
      jfBootSplash.classList.add('jfSplashExit');
      jfBootSplash.addEventListener('transitionend',()=>{jfBootSplash.hidden=true;},{once:true});
      setTimeout(()=>{jfBootSplash.hidden=true;},700);
    }
  })();
}
// Corrupt/unavailable index must not leave an inaccessible page forever.
setTimeout(()=>{if(!jfBootSplashReleased)jfReleaseBootSplash();},7000);
load();

setInterval(
  load,
  DATA_POLL_INTERVAL
);
