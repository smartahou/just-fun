

let nativeFullscreenVideo = null;
let nativeFullscreenKey = '';
let nativeFullscreenOrigin = null;

function captureNativeFullscreenOrigin(video) {
  if (
    !video ||
    (
      nativeFullscreenOrigin &&
      nativeFullscreenOrigin.video === video
    )
  ) {
    return;
  }

  const section =
    video.closest(
      '.feedItem'
    );

  const sectionKey =
    section &&
    section.dataset.key
      ? section.dataset.key
      : '';

  nativeFullscreenOrigin = {
    video,
    sectionKey,
    itemKey:
      video.dataset.itemKey ||
      sectionKey,
    fullscreenKey:
      video.dataset.fullscreenKey ||
      sectionKey,
    rotation:
      video.dataset.rotation ||
      (
        section &&
        section.dataset.rotation
      ) ||
      '0',
    loaded:
      video.dataset.loaded ||
      '0',
    poster:
      video.getAttribute(
        'poster'
      ) ||
      '',
    currentTime:
      Number(
        video.currentTime || 0
      )
  };
}

function restoreNativeFullscreenHost() {
  const origin =
    nativeFullscreenOrigin;

  nativeFullscreenOrigin =
    null;

  if (
    !origin ||
    !origin.video ||
    origin.video.isConnected === false
  ) {
    return;
  }

  const video =
    origin.video;

  try {
    video.pause();
  } catch {}

  video.dataset.itemKey =
    origin.itemKey ||
    origin.sectionKey;

  video.dataset.fullscreenKey =
    origin.fullscreenKey ||
    origin.sectionKey;

  video.dataset.rotation =
    String(
      normalizeRotation(
        origin.rotation || 0
      )
    );

  video.classList.remove(
    'nativeSwitching'
  );

  if (origin.poster) {
    video.setAttribute(
      'poster',
      origin.poster
    );
  } else {
    video.removeAttribute(
      'poster'
    );
  }

  const source =
    video.dataset.src ||
    '';

  if (
    origin.loaded === '1' &&
    source
  ) {
    video.src =
      source;

    video.dataset.loaded =
      '1';

    try {
      video.load();
    } catch {}

    if (
      currentFeedKey ===
        origin.sectionKey &&
      Number.isFinite(
        origin.currentTime
      )
    ) {
      try {
        video.currentTime =
          origin.currentTime;
      } catch {}
    }
  } else {
    video.removeAttribute(
      'src'
    );

    video.dataset.loaded =
      '0';

    try {
      video.load();
    } catch {}
  }

  applyRotationToVideo(
    video,
    origin.rotation || 0
  );
}

function fullscreenVideoElement() {
  const element =
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    null;

  if (
    element &&
    element.matches &&
    element.matches(
      'video.feedVideo'
    )
  ) {
    return element;
  }

  return null;
}

function feedSourceItems() {
  return currentRenderedItems.length
    ? currentRenderedItems
    : allItems;
}

function adjacentVideoItem(
  key,
  direction
) {
  const source =
    feedSourceItems();

  const videos =
    source.filter(
      item =>
        item.kind ===
        'video'
    );

  if (!videos.length) {
    return null;
  }

  let index =
    videos.findIndex(
      item =>
        item.key ===
        key
    );

  if (index < 0) {
    index = 0;
  }

  const next =
    index +
    direction;

  if (
    next < 0 ||
    next >= videos.length
  ) {
    return null;
  }

  return videos[next];
}

function syncFeedBehind(
  key
) {
  const scroller =
    document.querySelector(
      '#feedScroller'
    );

  if (!scroller) {
    return;
  }

  const section =
    [...scroller.querySelectorAll(
      '.feedItem'
    )]
      .find(
        node =>
          node.dataset.key ===
          key
      );

  if (!section) {
    return;
  }

  const index =
    feedSectionIndex(
      section
    );

  if (index >= 0) {
    hydrateFeedWindow(
      index
    );
  }

  section.scrollIntoView({
    behavior:'auto',
    block:'start'
  });
}

function waitForFreshFullscreenFrame(video) {
  return new Promise(
    resolve => {
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;

        requestAnimationFrame(
          () =>
            requestAnimationFrame(
              resolve
            )
        );
      };

      if (
        video.readyState >= 2
      ) {
        finish();
      } else {
        video.addEventListener(
          'loadeddata',
          finish,
          { once:true }
        );
      }

      setTimeout(
        finish,
        1200
      );
    }
  );
}

async function paintNativeFullscreenBlack(video, nextPoster) {
  video.classList.add('nativeSwitching');
  // During native fullscreen source replacement, keep a ready cover instead of
  // intentionally blanking the entire fullscreen element for two frames.
  if (nextPoster) video.setAttribute('poster',nextPoster);
  else video.removeAttribute('poster');
}

let nativeFullscreenSwitching = false;

async function stepNativeFullscreen(
  direction
) {
  // 原生 fullscreen 使用单个 video 异步换源，禁止上一条尚未
  // 解码完成时再次换源，避免相互覆盖和多条跳跃。
  if (nativeFullscreenSwitching) {
    return true;
  }

  const video =
    fullscreenVideoElement() ||
    nativeFullscreenVideo;

  if (
    !video ||
    video.isConnected === false
  ) {
    return false;
  }

  captureNativeFullscreenOrigin(
    video
  );

  const currentKey =
    nativeFullscreenKey ||
    (
      video.closest(
        '.feedItem'
      ) &&
      video.closest(
        '.feedItem'
      ).dataset.key
    ) ||
    currentFeedKey;

  const next =
    adjacentVideoItem(
      currentKey,
      direction
    );

  if (!next) {
    return true;
  }

  nativeFullscreenSwitching = true;
  try {
  nativeFullscreenVideo =
    video;
  // Silence all background videos before any awaits / source changes.
  silenceOtherFeedVideos(video);

  resetFeedVideoSession(next.key);

  nativeFullscreenKey =
    next.key;

  currentFeedKey =
    next.key;

  updateFeedABUi();

  await paintNativeFullscreenBlack(video,next.cover || '');

  video.pause();

  video.loop =
    true;

  video.dataset.itemKey =
    next.key;

  video.dataset.rotation =
    String(
      normalizeRotation(
        next.rotation || 0
      )
    );

  video.src =
    next.mediaUrl;

  video.dataset.fullscreenKey =
    next.key;

  video.load();

  applyRotationToVideo(
    video,
    next.rotation || 0
  );

  syncFeedBehind(
    next.key
  );
  // syncFeedBehind hydrates/scrolls another section and triggers its observer.
  // It must not result in a second playing <video> beneath fullscreen.
  silenceOtherFeedVideos(video);

  try {
    await video.play();
  } catch {}

  await waitForFreshFullscreenFrame(
    video
  );
  silenceOtherFeedVideos(video);

  video.classList.remove(
    'nativeSwitching'
  );

  return true;
  } finally {
    nativeFullscreenSwitching = false;
    video.classList.remove('nativeSwitching');
  }
}

function rememberFullscreenState() {
  const video =
    fullscreenVideoElement();

  if (!video) {
    restoreNativeFullscreenHost();

    nativeFullscreenVideo =
      null;

    nativeFullscreenKey =
      '';

    if (currentFeedKey) {
      syncFeedBehind(
        currentFeedKey
      );
    }
    // The restored old fullscreen host is paused. Activate only the video
    // belonging to the selected new section; never revive both tracks.
    const currentSection=[...document.querySelectorAll('#feedScroller .feedItem')]
      .find(section=>section.dataset.key===currentFeedKey);
    pauseInactiveFeedVideos(currentSection);

    return;
  }

  captureNativeFullscreenOrigin(
    video
  );

  // 原生全屏切换媒体时，旧 poster 会被浏览器短暂重新绘制。
  // 进入全屏后先移除，退出时由 restoreNativeFullscreenHost 恢复。
  video.removeAttribute(
    'poster'
  );

  nativeFullscreenVideo =
    video;

  const section =
    video.closest(
      '.feedItem'
    );

  nativeFullscreenKey =
    video.dataset.fullscreenKey ||
    (
      section &&
      section.dataset.key
    ) ||
    currentFeedKey;

  currentFeedKey =
    nativeFullscreenKey ||
    currentFeedKey;
}


const fullscreenDrag = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  triggered: false,
  ignore: false
};

function resetFullscreenDrag() {
  fullscreenDrag.active = false;
  fullscreenDrag.pointerId = null;
  fullscreenDrag.startX = 0;
  fullscreenDrag.startY = 0;
  fullscreenDrag.triggered = false;
  fullscreenDrag.ignore = false;
}

function shouldIgnoreFullscreenDragStart(video, event) {
  if (!video) {
    return true;
  }

  const rect =
    video.getBoundingClientRect();

  // 保留底部原生 controls 区域，不抢占进度条/音量拖拽。
  return (
    rect.bottom -
    event.clientY <
    76
  );
}

document.addEventListener(
  'pointerdown',
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

    if (
      event.button !== undefined &&
      event.button !== 0
    ) {
      return;
    }

    fullscreenDrag.active = true;
    fullscreenDrag.pointerId = event.pointerId;
    fullscreenDrag.startX = event.clientX;
    fullscreenDrag.startY = event.clientY;
    fullscreenDrag.triggered = false;
    fullscreenDrag.ignore =
      shouldIgnoreFullscreenDragStart(
        video,
        event
      );

    if (
      !fullscreenDrag.ignore
    ) {
      try {
        video.setPointerCapture(
          event.pointerId
        );
      } catch {}
    }
  },
  {
    capture:true
  }
);

document.addEventListener(
  'pointermove',
  event => {
    if (
      !fullscreenDrag.active ||
      fullscreenDrag.ignore ||
      fullscreenDrag.triggered ||
      event.pointerId !==
        fullscreenDrag.pointerId
    ) {
      return;
    }

    const video =
      fullscreenVideoElement();

    if (!video) {
      resetFullscreenDrag();
      return;
    }

    const dx =
      event.clientX -
      fullscreenDrag.startX;

    const dy =
      event.clientY -
      fullscreenDrag.startY;

    const vertical =
      Math.abs(dy);

    const horizontal =
      Math.abs(dx);

    if (
      vertical < 70 ||
      vertical <
        horizontal * 1.25
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    fullscreenDrag.triggered = true;

    // 向上拖：下一条；向下拖：上一条。
    stepNativeFullscreen(
      dy < 0
        ? 1
        : -1
    );
  },
  {
    passive:false,
    capture:true
  }
);

document.addEventListener(
  'pointerup',
  event => {
    if (
      event.pointerId ===
      fullscreenDrag.pointerId
    ) {
      resetFullscreenDrag();
    }
  },
  {
    capture:true
  }
);

document.addEventListener(
  'pointercancel',
  event => {
    if (
      event.pointerId ===
      fullscreenDrag.pointerId
    ) {
      resetFullscreenDrag();
    }
  },
  {
    capture:true
  }
);


function normalizeRotation(value) {
  value = Number(value) || 0;
  value = ((value % 360) + 360) % 360;
  return [0,90,180,270].includes(value) ? value : 0;
}

function rotationTransform(
  video,
  rotation
) {
  if (!video) {
    return;
  }

  rotation =
    normalizeRotation(
      rotation
    );

  const parent =
    video.parentElement;

  if (!parent) {
    return;
  }

  const parentWidth =
    parent.clientWidth;

  const parentHeight =
    parent.clientHeight;

  if (
    !parentWidth ||
    !parentHeight
  ) {
    return;
  }

  const rotated =
    rotation === 90 ||
    rotation === 270;

  // 普通播放不再根据视频原始分辨率算第二层 scale。
  //
  // 0 / 180:
  //   video box = 容器本身
  //
  // 90 / 270:
  //   先把 video box 的宽高交换，再 rotate。
  //
  // 因此 Feed 的普通竖屏视频始终拥有完整 100vh 播放区域，
  // object-fit: contain 只负责在这个区域里保持视频比例。
  video.style.width =
    (
      rotated
        ? parentHeight
        : parentWidth
    ) +
    'px';

  video.style.height =
    (
      rotated
        ? parentWidth
        : parentHeight
    ) +
    'px';

  video.style.maxWidth =
    'none';

  video.style.maxHeight =
    'none';

  video.style.flex =
    '0 0 auto';

  video.style.objectFit =
    'contain';

  video.style.transformOrigin =
    'center center';

  video.style.transform =
    'rotate(' +
    rotation +
    'deg)';
}

const videoResizeObservers =
  new WeakMap();

function applyRotationToVideo(video, rotation) {
  if (!video) {
    return;
  }

  video.classList.add(
    'rotatableVideo'
  );

  video.dataset.rotation =
    String(
      normalizeRotation(
        rotation
      )
    );

  const apply =
    () => {
      if (
        !video.isConnected
      ) {
        return;
      }

      const focusState =
        typeof focusZoomStates !==
          'undefined'
          ? focusZoomStates.get(
              video
            )
          : null;

      if (
        focusState &&
        focusState.enabled
      ) {
        applyFocusTransform(
          video
        );
      } else {
        rotationTransform(
          video,
          video.dataset.rotation
        );
      }
    };

  if (
    video.readyState >= 1
  ) {
    apply();
  }

  video.addEventListener(
    'loadedmetadata',
    apply,
    {
      once:true
    }
  );

  const oldObserver =
    videoResizeObservers.get(
      video
    );

  if (oldObserver) {
    try {
      oldObserver.disconnect();
    } catch {}
  }

  if (
    typeof ResizeObserver !==
      'undefined'
  ) {
    const target =
      video.parentElement;

    if (target) {
      const observer =
        new ResizeObserver(
          () => {
            requestAnimationFrame(
              apply
            );
          }
        );

      observer.observe(
        target
      );

      videoResizeObservers.set(
        video,
        observer
      );
    }
  }
}

function applyRotationsIn(root) {
  const scope = root || document;

  scope
    .querySelectorAll('video[data-rotation]')
    .forEach(video =>
      applyRotationToVideo(
        video,
        Number(video.dataset.rotation || 0)
      )
    );
}

async function setItemRotation(key, rotation) {
  rotation = normalizeRotation(rotation);

  const item = allItems.find(x => x.key === key);
  if (!item) return null;

  try {
    const r = await fetch('/api/update-rotation', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({key,rotation})
    });

    const data = await r.json();

    if (!r.ok || !data.ok) {
      throw new Error(data.error || '保存旋转角度失败');
    }

    item.rotation = data.rotation;
    return data.rotation;
  } catch (error) {
    alert(error.message || '保存旋转角度失败');
    return null;
  }
}

async function rotateItem(key) {
  const item = allItems.find(x => x.key === key);

  if (!item || item.kind !== 'video') {
    return;
  }

  const next =
    (normalizeRotation(item.rotation) + 90) % 360;

  const saved =
    await setItemRotation(key, next);

  if (saved === null) {
    return;
  }

  document
    .querySelectorAll(
      'video[data-item-key="' +
      CSS.escape(key) +
      '"]'
    )
    .forEach(video =>
      applyRotationToVideo(video, saved)
    );

  render();
}


// 截取视频默认使用播放器内的 A-B 跳转循环，而不是等待原生 loop 的 ended 重启。
// 老版本生成的片段根据内部命名规则识别，避免要求用户重新截取历史视频。
function isGeneratedABClip(item) {
  return Boolean(item && item.kind === 'video' && (
    item.seamlessClipLoop === true ||
    (typeof item.title === 'string' && / · 片段 [0-9]+:[0-9]/.test(item.title))
  ));
}

function prepareClipLoopState(video, item, state) {
  if (!video || !state || !isGeneratedABClip(item) || state.manual) return;
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0.07) return;
  // 留少量结束缓冲：尽可能在 ended 之前回到首帧。
  const lead = Math.min(0.09, duration * 0.12);
  state.a = 0;
  state.b = duration - lead;
  state.enabled = true;
  state.auto = true;
  video.loop = false;
  video.preload = 'auto';
}

// rVFC 按视频帧检查；不支持时以动画帧轮询，timeupdate/ended 兜底。
// 不复制视频、不预先生成图片，保持音画轨同步和原有播放器结构。
function installResponsiveVideoLoop(video, readState) {
  if (!video || video.dataset.responsiveLoopInstalled === '1') return;
  video.dataset.responsiveLoopInstalled = '1';
  let pending = false;
  const inspect = () => {
    if (video.paused || video.seeking || video.readyState < 2) return;
    const state = readState();
    if (!state || !state.enabled || !validABState(state)) return;
    const margin = state.auto ? 0.008 : 0;
    if (video.currentTime >= state.b - margin) {
      video.currentTime = state.a;
    }
  };
  const checkFrame = () => {
    pending = false;
    inspect();
    if (!video.paused) schedule();
  };
  const schedule = () => {
    if (pending || video.paused) return;
    pending = true;
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(checkFrame);
    } else {
      requestAnimationFrame(checkFrame);
    }
  };
  video.addEventListener('play', schedule);
  video.addEventListener('timeupdate', inspect);
  video.addEventListener('seeked', schedule);
  video.addEventListener('ended', () => {
    const state = readState();
    if (!state || !state.enabled || !validABState(state)) return;
    video.currentTime = state.a;
    video.play().catch(() => {});
  });
  if (!video.paused) schedule();
}

const feedABStates =
  new Map();
let ghostPlayback=null;
let ghostPreparing=false;
let ghostRequestGeneration=0;

// Video-only session state must not follow a different media item.
// Keep the user's global volume (and mute setting) untouched.
function resetFeedVideoSession(nextKey, force=false) {
  if(!force && nextKey===currentFeedKey) return false;
  ++ghostRequestGeneration; // invalidate an outstanding FFmpeg request
  ghostPreparing=false;
  stopGhostPlayback(false); // synchronously restore the original media URL
  feedABStates.clear();
  jfResetVideoFilter();
  document.querySelectorAll('#feedScroller video.feedVideo').forEach(video=>{
    const focus=focusZoomStates.get(video);
    if(focus){
      setFocusZoomEnabled(video,false);
      focus.zoom=1; focus.x=0; focus.y=0;
      focusZoomStates.delete(video);
    }
    video.playbackRate=1;
    video.loop=true;
  });
  exitImmersiveChrome();
  return true;
}

function getFeedABState(key) {
  if (
    !feedABStates.has(
      key
    )
  ) {
    feedABStates.set(
      key,
      {
        a: NaN,
        b: NaN,
        enabled: false
      }
    );
  }

  return feedABStates.get(
    key
  );
}

function getCurrentFeedItem() {
  return allItems.find(
    item =>
      item.key ===
      currentFeedKey
  ) || null;
}

function getCurrentFeedVideo() {
  if (!currentFeedKey) {
    return null;
  }

  const scroller =
    document.querySelector(
      '#feedScroller'
    );

  if (!scroller) {
    return null;
  }

  const section =
    [...scroller.querySelectorAll(
      '.feedItem'
    )]
      .find(
        node =>
          node.dataset.key ===
          currentFeedKey
      );

  if (!section) {
    return null;
  }

  return section.querySelector(
    'video.feedVideo'
  );
}

// v6.30: one timing rule for the main player and floating video windows.
// Keep the seek on currentTime instead of simulating repeated keyboard events:
// native Chromium media controls use their own step, which varies by focus.
function seekVideoSeconds(video, deltaSeconds) {
  if (!video || !(video.currentSrc || video.getAttribute('src'))) return false;
  const current = Number(video.currentTime);
  if (!Number.isFinite(current)) return false;
  const duration = Number(video.duration);
  let next = Math.max(0, current + deltaSeconds);
  if (Number.isFinite(duration)) next = Math.min(Math.max(0, duration), next);
  try {
    video.currentTime = next;
    return true;
  } catch {
    return false;
  }
}

function seekCurrentFeedSeconds(deltaSeconds) {
  return seekVideoSeconds(fullscreenVideoElement() || getCurrentFeedVideo(), deltaSeconds);
}

function syncFeedABQuickActions() {
  const dock=document.getElementById('feedABQuickActions');
  if(!dock)return;
  const item=getCurrentFeedItem();
  const overlay=document.getElementById('feedOverlay');
  const state=item && item.kind==='video' ? feedABStates.get(item.key) : null;
  const visible=Boolean(overlay?.classList.contains('open') && state?.enabled && validABState(state));
  dock.hidden=!visible;
  dock.setAttribute('aria-hidden',String(!visible));
}

function updateFeedABUi() {
  const ghostButton=document.querySelector('#feedGhostLoop');
  if(ghostButton){
    const active=Boolean(ghostPlayback && ghostPlayback.key===currentFeedKey);
    ghostButton.classList.toggle('active',active);
    ghostButton.setAttribute('aria-pressed',String(active));
    ghostButton.textContent=ghostPreparing ? '生成中…' : '鬼畜';
    ghostButton.disabled=ghostPreparing;
  }
  const item =
    getCurrentFeedItem();

  const aButton =
    document.querySelector(
      '#feedSetA'
    );

  const bButton =
    document.querySelector(
      '#feedSetB'
    );

  const loopButton =
    document.querySelector(
      '#feedABLoop'
    );

  const clipButton =
    document.querySelector(
      '#feedClip'
    );
  const portraitButton = document.querySelector('#feedPortrait');
  const clipShelfButton = document.querySelector('#feedClipShelf');

  const magnifyButton =
    document.querySelector(
      '#feedMagnify'
    );

  const currentVideo =
    getCurrentFeedVideo();

  if (magnifyButton) {
    const state =
      currentVideo
        ? focusZoomStates.get(
            currentVideo
          )
        : null;

    const enabled =
      Boolean(
        state &&
        state.enabled
      );

    magnifyButton.classList.toggle(
      'active',
      enabled
    );

    magnifyButton.title =
      enabled
        ? '关闭宽屏聚焦'
        : '宽屏聚焦';
    magnifyButton.setAttribute('aria-pressed',String(enabled));
    magnifyButton.setAttribute('aria-label',magnifyButton.title);
  }

  const videoMode =
    item &&
    item.kind ===
      'video';

  for (
    const button of [
      aButton,
      bButton,
      loopButton,
      clipButton,
      portraitButton,
      clipShelfButton,
      document.querySelector('#feedScreenshot'),
      document.querySelector('#feedAudio')
    ]
  ) {
    if (!button) {
      continue;
    }

    button.disabled =
      !videoMode;

    button.style.opacity =
      videoMode
        ? ''
        : '.35';
  }

  if (!videoMode) {
    syncFeedABQuickActions();
    if (aButton) {
      aButton.dataset.pointTime = '';
      aButton.classList.remove(
        'set'
      );
    }

    if (bButton) {
      bButton.dataset.pointTime = '';
      bButton.classList.remove(
        'set'
      );
    }

    if (loopButton) {
      loopButton.classList.remove(
        'active'
      );
      loopButton.setAttribute('aria-pressed','false');
    }

    return;
  }

  const state =
    getFeedABState(
      item.key
    );

  if (aButton) {
    aButton.classList.toggle(
      'set',
      Number.isFinite(
        state.a
      )
    );

    aButton.dataset.pointTime = Number.isFinite(state.a) ? formatMiniTime(state.a) : '';

    aButton.title =
      Number.isFinite(
        state.a
      )
        ? 'A = ' +
          formatMiniTime(
            state.a
          ) +
          '；点击重新设置'
        : '将当前时间设为 A';
    aButton.setAttribute('aria-label',aButton.title);
  }

  if (bButton) {
    bButton.classList.toggle(
      'set',
      Number.isFinite(
        state.b
      )
    );

    bButton.dataset.pointTime = Number.isFinite(state.b) ? formatMiniTime(state.b) : '';

    bButton.title =
      Number.isFinite(
        state.b
      )
        ? 'B = ' +
          formatMiniTime(
            state.b
          ) +
          '；点击重新设置'
        : '将当前时间设为 B';
    bButton.setAttribute('aria-label',bButton.title);
  }

  if (loopButton) {
    loopButton.classList.toggle(
      'active',
      Boolean(
        state.enabled
      )
    );

    loopButton.title =
      state.enabled
        ? '关闭 A-B 区间循环'
        : '开启 A-B 区间循环';
    loopButton.setAttribute('aria-label',loopButton.title);
    loopButton.setAttribute('aria-pressed',String(Boolean(state.enabled)));
  }
  syncFeedABQuickActions();
}

function installFeedABVideo(video, key) {
  if (!video || video.dataset.abInstalled === '1') return;
  video.dataset.abInstalled = '1';
  // 全屏上下切换会复用同一个 video，不能把监听器绑定到最初的媒体 key。
  const activeKey = () => video.dataset.itemKey || key;
  const resolveState = () => getFeedABState(activeKey());
  const configure = () => {
    const mediaKey = activeKey();
    const item = allItems.find(entry => entry.key === mediaKey);
    const state = resolveState();
    if(video.dataset.ghostMode==='1'){video.loop=true;return;}
    video.loop = !(state.enabled && validABState(state));
    if (mediaKey === currentFeedKey) updateFeedABUi();
  };
  video.addEventListener('loadedmetadata', configure);
  video.addEventListener('durationchange', configure);
  installResponsiveVideoLoop(video, () => video.dataset.ghostMode==='1' ? null : resolveState());
  if (video.readyState >= 1) configure();
}

function installAllFeedABVideos() {
  document
    .querySelectorAll(
      '#feedScroller video.feedVideo'
    )
    .forEach(
      video => {
        const key =
          video.dataset.itemKey;

        if (key) {
          installFeedABVideo(
            video,
            key
          );
        }
      }
    );
}

async function clipCurrentFeedAB() {
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

  const button =
    document.querySelector(
      '#feedClip'
    );

  if (
    !button ||
    button.classList.contains(
      'loading'
    )
  ) {
    return;
  }

  button.classList.add(
    'loading'
  );
  button.setAttribute('aria-busy','true');
  const runningLabel = button.querySelector('.feedToolLabel');
  if (runningLabel) runningLabel.textContent = '截取中';

  button.disabled =
    true;

  button.title =
    '正在截取视频…';

  try {
    const task=jfStartMediaProgress('截取视频片段');
    let r;
    try {r =
      await fetch(
        '/api/clip',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              key:
                item.key,
              start:
                state.a,
              end:
                state.b,
              jobId:task.id
            })
        }
      );
    } finally {task.done(Boolean(r && r.ok));}

    const data =
      await r.json();

    if (
      !r.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        '截取失败'
      );
    }

    if (
      data.item &&
      !allItems.some(
        x =>
          x.key ===
          data.item.key
      )
    ) {
      allItems.push(
        data.item
      );
    }

    button.classList.remove(
      'loading'
    );
    button.removeAttribute('aria-busy');

    button.classList.add(
      'done'
    );

    const label = button.querySelector('.feedToolLabel');
    if (label) label.textContent = '已截取';

    button.title =
      '已生成新视频';

    renderCreatorTags();
    render();

    setTimeout(
      () => {
        button.classList.remove(
          'done'
        );

        if (label) label.textContent = '截取视频';

        button.title =
          '截取 A-B 为新视频';

        button.disabled =
          false;
      },
      1200
    );
  } catch (error) {
    button.classList.remove(
      'loading'
    );
    button.removeAttribute('aria-busy');

    button.disabled =
      false;

    const label = button.querySelector('.feedToolLabel');
    if (label) label.textContent = '截取视频';

    button.title =
      '截取 A-B 为新视频';

    alert(
      error.message ||
      '截取失败'
    );
  }
}


const isStandaloneWebApp =
  Boolean(
    window.matchMedia &&
    window.matchMedia(
      '(display-mode: standalone)'
    ).matches
  ) ||
  Boolean(
    window.matchMedia &&
    window.matchMedia(
      '(display-mode: fullscreen)'
    ).matches
  ) ||
  Boolean(
    navigator.standalone
  );

if (isStandaloneWebApp) {
  document.documentElement
    .classList.add(
      'standaloneWebApp'
    );
}

let audioCoexistenceSupported =
  false;

let audioCoexistenceEnabled =
  false;

const audioInterruptedVideos =
  new Set();

const audioKnownPlayingVideos =
  new Set();

function enableAudioCoexistence() {
  try {
    if (
      !(
        'audioSession' in
        navigator
      ) ||
      !navigator.audioSession
    ) {
      audioCoexistenceSupported =
        false;

      return false;
    }

    navigator.audioSession.type =
      'ambient';

    audioCoexistenceSupported =
      true;

    audioCoexistenceEnabled =
      navigator.audioSession.type ===
        'ambient';

    return audioCoexistenceEnabled;
  } catch {
    audioCoexistenceSupported =
      false;

    audioCoexistenceEnabled =
      false;

    return false;
  }
}

function restoreAudioCoexistence() {
  if (
    !audioCoexistenceSupported
  ) {
    enableAudioCoexistence();
    return;
  }

  try {
    if (
      navigator.audioSession.type !==
        'ambient'
    ) {
      navigator.audioSession.type =
        'ambient';
    }

    audioCoexistenceEnabled =
      true;
  } catch {}
}

function rememberVideoPlaying(video) {
  if (!video) {
    return;
  }

  audioKnownPlayingVideos.add(
    video
  );
}

function rememberVideoPaused(video) {
  if (!video) {
    return;
  }

  try {
    if (
      audioCoexistenceSupported &&
      navigator.audioSession &&
      navigator.audioSession.state ===
        'interrupted'
    ) {
      audioInterruptedVideos.add(
        video
      );

      return;
    }
  } catch {}

  audioKnownPlayingVideos.delete(
    video
  );
}

enableAudioCoexistence();

document.addEventListener(
  'play',
  event => {
    const video =
      event.target;

    if (
      !video ||
      video.tagName !==
        'VIDEO'
    ) {
      return;
    }

    rememberVideoPlaying(
      video
    );

    restoreAudioCoexistence();
  },
  true
);

document.addEventListener(
  'pause',
  event => {
    const video =
      event.target;

    if (
      !video ||
      video.tagName !==
        'VIDEO'
    ) {
      return;
    }

    rememberVideoPaused(
      video
    );
  },
  true
);