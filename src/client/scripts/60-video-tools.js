

document.addEventListener(
  'visibilitychange',
  () => {
    if (!document.hidden) {
      restoreAudioCoexistence();
    }
  }
);

window.addEventListener(
  'pageshow',
  restoreAudioCoexistence
);

if (
  'audioSession' in navigator &&
  navigator.audioSession &&
  typeof navigator.audioSession
    .addEventListener ===
    'function'
) {
  navigator.audioSession.addEventListener(
    'statechange',
    () => {
      const state =
        navigator.audioSession.state;

      if (
        state ===
          'interrupted'
      ) {
        for (
          const video of
          audioKnownPlayingVideos
        ) {
          if (
            video &&
            video.isConnected
          ) {
            audioInterruptedVideos.add(
              video
            );
          }
        }

        return;
      }

      if (
        state === 'active' ||
        state === 'inactive'
      ) {
        restoreAudioCoexistence();

        for (
          const video of
          [...audioInterruptedVideos]
        ) {
          audioInterruptedVideos.delete(
            video
          );

          if (
            video &&
            video.isConnected &&
            video.paused &&
            !video.ended
          ) {
            video
              .play()
              .catch(
                () => {}
              );
          }
        }
      }
    }
  );
}

const focusZoomStates =
  new WeakMap();

function focusViewportSize(video) {
  const nativeFullscreen =
    (
      document.fullscreenElement ===
        video ||
      document.webkitFullscreenElement ===
        video
    );

  if (nativeFullscreen) {
    return {
      width:
        window.innerWidth,
      height:
        window.innerHeight
    };
  }

  const host =
    video.parentElement;

  return {
    width:
      host
        ? host.clientWidth
        : 0,
    height:
      host
        ? host.clientHeight
        : 0
  };
}

function ensureFocusHost(video) {
  const host =
    video.parentElement;

  if (!host) {
    return null;
  }

  host.classList.add(
    'videoFocusHost'
  );

  return host;
}

function getFocusState(video) {
  let state =
    focusZoomStates.get(
      video
    );

  if (state) {
    return state;
  }

  state = {
    enabled:false,
    zoom:1,
    x:0,
    y:0,
    dragging:false,
    pointerId:null,
    startX:0,
    startY:0,
    startOffsetX:0,
    startOffsetY:0,
    touchPointers:
      new Map(),
    pinchStartDistance:0,
    pinchStartZoom:1
  };

  focusZoomStates.set(
    video,
    state
  );

  return state;
}

function focusVisualSize(video) {
  const rotation =
    normalizeRotation(
      video.dataset.rotation ||
      0
    );

  const rotated =
    rotation === 90 ||
    rotation === 270;

  return {
    width:
      rotated
        ? video.videoHeight
        : video.videoWidth,
    height:
      rotated
        ? video.videoWidth
        : video.videoHeight,
    rotation
  };
}

function focusMinimumScale(video) {
  if (
    !video.videoWidth ||
    !video.videoHeight
  ) {
    return 1;
  }

  const viewport =
    focusViewportSize(
      video
    );

  const visual =
    focusVisualSize(
      video
    );

  if (
    !viewport.width ||
    !viewport.height ||
    !visual.width ||
    !visual.height
  ) {
    return 1;
  }

  // 先计算普通播放 contain 时的实际缩放比例。
  //
  // “宽屏聚焦”的最低倍率不是直接 cover 到 100vw，
  // 而是普通播放尺寸的 2 倍。
  //
  // 例如正常竖屏视频显示宽度约 500px：
  // 开启聚焦后最低宽度约 1000px。
  const containScale =
    Math.min(
      viewport.width /
        visual.width,
      viewport.height /
        visual.height
    );

  return containScale;
}

function focusPanLimits(
  video,
  scale
) {
  const viewport =
    focusViewportSize(
      video
    );

  const visual =
    focusVisualSize(
      video
    );

  return {
    x:
      Math.max(
        0,
        (
          visual.width *
          scale -
          viewport.width
        ) /
        2
      ),
    y:
      Math.max(
        0,
        (
          visual.height *
          scale -
          viewport.height
        ) /
        2
      )
  };
}

function applyFocusTransform(video) {
  if (
    !video ||
    !video.videoWidth ||
    !video.videoHeight
  ) {
    return;
  }

  const state =
    getFocusState(
      video
    );

  if (
    !state.enabled
  ) {
    rotationTransform(
      video,
      video.dataset.rotation ||
      0
    );

    return;
  }

  const visual =
    focusVisualSize(
      video
    );

  const scale =
    focusMinimumScale(
      video
    ) *
    state.zoom;

  const limits =
    focusPanLimits(
      video,
      scale
    );

  state.x =
    Math.max(
      -limits.x,
      Math.min(
        limits.x,
        state.x
      )
    );

  state.y =
    Math.max(
      -limits.y,
      Math.min(
        limits.y,
        state.y
      )
    );

  // 只做统一 scale + 位移 + rotate，不做非等比拉伸。
  video.style.width =
    video.videoWidth +
    'px';

  video.style.height =
    video.videoHeight +
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
    'translate(' +
    state.x +
    'px,' +
    state.y +
    'px) rotate(' +
    visual.rotation +
    'deg) scale(' +
    scale +
    ')';
}


let immersiveHideTimer =
  null;

function currentFeedFocusEnabled() {
  const video =
    getCurrentFeedVideo();

  if (!video) {
    return false;
  }

  const state =
    focusZoomStates.get(
      video
    );

  return Boolean(
    state &&
    state.enabled
  );
}

function showImmersiveChrome() {
  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  if (!overlay) {
    return;
  }

  overlay.classList.remove(
    'chromeHidden'
  );

  overlay.classList.remove(
    'cursorHidden'
  );
}

function hideImmersiveChrome() {
  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  if (
    !overlay ||
    !overlay.classList.contains(
      'open'
    ) ||
    !currentFeedFocusEnabled()
  ) {
    return;
  }

  overlay.classList.add(
    'chromeHidden'
  );

  overlay.classList.add(
    'cursorHidden'
  );
}

function scheduleImmersiveChromeHide() {
  clearTimeout(
    immersiveHideTimer
  );

  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  if (
    !overlay ||
    !overlay.classList.contains(
      'open'
    ) ||
    !currentFeedFocusEnabled()
  ) {
    if (overlay) {
      overlay.classList.remove(
        'focusImmersive'
      );

      overlay.classList.remove(
        'chromeHidden'
      );

      overlay.classList.remove(
        'cursorHidden'
      );
    }

    return;
  }

  overlay.classList.add(
    'focusImmersive'
  );

  showImmersiveChrome();

  immersiveHideTimer =
    setTimeout(
      hideImmersiveChrome,
      3000
    );
}

function exitImmersiveChrome() {
  clearTimeout(
    immersiveHideTimer
  );

  immersiveHideTimer =
    null;

  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  if (!overlay) {
    return;
  }

  overlay.classList.remove(
    'focusImmersive'
  );

  overlay.classList.remove(
    'chromeHidden'
  );

  overlay.classList.remove(
    'cursorHidden'
  );
}

function setFocusZoomEnabled(
  video,
  enabled
) {
  if (!video) {
    return false;
  }

  installFocusZoom(
    video
  );

  const state =
    getFocusState(
      video
    );

  state.enabled =
    Boolean(
      enabled
    );

  const host =
    ensureFocusHost(
      video
    );

  if (host) {
    host.classList.toggle(
      'focusOn',
      state.enabled
    );
  }

  video.classList.toggle(
    'videoFocusMode',
    state.enabled
  );

  if (
    state.enabled
  ) {
    state.zoom =
      Math.max(
        1,
        Number(
          state.zoom ||
          1
        )
      );

    if (
      !Number.isFinite(
        state.x
      )
    ) {
      state.x = 0;
    }

    if (
      !Number.isFinite(
        state.y
      )
    ) {
      state.y = 0;
    }
  } else {
    state.dragging =
      false;

    state.pointerId =
      null;

    state.touchPointers.clear();

    state.pinchStartDistance =
      0;

    video.classList.remove(
      'dragging'
    );
  }

  requestAnimationFrame(
    () =>
      applyFocusTransform(
        video
      )
  );

  // Feed 当前视频开启宽屏聚焦时进入沉浸模式。
  if (
    video.classList.contains(
      'feedVideo'
    ) &&
    video.dataset.itemKey ===
      currentFeedKey
  ) {
    if (state.enabled) {
      scheduleImmersiveChromeHide();
    } else {
      exitImmersiveChrome();
    }
  }

  return state.enabled;
}

function toggleFocusZoom(video) {
  if (!video) {
    return false;
  }

  const state =
    getFocusState(
      video
    );

  return setFocusZoomEnabled(
    video,
    !state.enabled
  );
}

function installFocusZoom(video) {
  if (
    !video ||
    video.dataset.focusZoomInstalled ===
      '1'
  ) {
    return;
  }

  video.dataset.focusZoomInstalled =
    '1';

  ensureFocusHost(
    video
  );

  const state =
    getFocusState(
      video
    );

  video.addEventListener(
    'loadedmetadata',
    () => {
      if (
        state.enabled
      ) {
        requestAnimationFrame(
          () =>
            applyFocusTransform(
              video
            )
        );
      }
    }
  );

  const gestureSurface=ensureFocusHost(video)||video;
  gestureSurface.addEventListener(
    'pointerdown',
    event => {
      // Pointer events may originate on an overlay above the video.
      if(event.target?.closest?.('button,input,select,textarea,a,[role=button]'))return;
      // Touch navigation remains native until the second finger starts a pinch.
      if(!state.enabled && event.pointerType!=='touch')return;

      if (
        event.pointerType !==
          'touch' &&
        event.button !== undefined &&
        event.button !== 0
      ) {
        return;
      }

      const rect =
        video.getBoundingClientRect();

      // 底部 controls 区域继续交给原生播放器。
      if (
        rect.bottom -
        event.clientY <
        76
      ) {
        return;
      }

      if(state.enabled){event.preventDefault();event.stopPropagation();}

      if (
        event.pointerType ===
          'touch'
      ) {
        state.touchPointers.set(
          event.pointerId,
          {
            x:event.clientX,
            y:event.clientY
          }
        );

        try {
          video.setPointerCapture(
            event.pointerId
          );
        } catch {}

        if (
          state.touchPointers.size >=
            2
        ) {
          if(!state.enabled){setFocusZoomEnabled(video,true);state.touchPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});}
          // A second finger cancels feed's one-finger vertical page switch.
          if(typeof feedTouchGesture!=='undefined')feedTouchGesture.pointerId=null;
          event.preventDefault();event.stopPropagation();
          const points =
            [...state.touchPointers.values()];

          const dx =
            points[0].x -
            points[1].x;

          const dy =
            points[0].y -
            points[1].y;

          state.pinchStartDistance =
            Math.max(
              1,
              Math.hypot(
                dx,
                dy
              )
            );

          state.pinchStartZoom =
            state.zoom;

          state.dragging =
            false;

          state.pointerId =
            null;

          video.classList.remove(
            'dragging'
          );

          return;
        }
      }

      if(!state.enabled)return;
      state.dragging =
        true;

      state.pointerId =
        event.pointerId;

      state.startX =
        event.clientX;

      state.startY =
        event.clientY;

      state.startOffsetX =
        state.x;

      state.startOffsetY =
        state.y;

      video.classList.add(
        'dragging'
      );

      try {
        video.setPointerCapture(
          event.pointerId
        );
      } catch {}
    }
  );

  gestureSurface.addEventListener(
    'pointermove',
    event => {
      if (!state.enabled && event.pointerType==='touch' && state.touchPointers.has(event.pointerId)){
        state.touchPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});return;
      }
      if (!state.enabled)return;

      if (
        event.pointerType ===
          'touch' &&
        state.touchPointers.has(
          event.pointerId
        )
      ) {
        state.touchPointers.set(
          event.pointerId,
          {
            x:event.clientX,
            y:event.clientY
          }
        );
      }

      if (
        event.pointerType ===
          'touch' &&
        state.touchPointers.size >=
          2
      ) {
        event.preventDefault();
        event.stopPropagation();

        const points =
          [...state.touchPointers.values()];

        const dx =
          points[0].x -
          points[1].x;

        const dy =
          points[0].y -
          points[1].y;

        const distance =
          Math.max(
            1,
            Math.hypot(
              dx,
              dy
            )
          );

        if (
          state.pinchStartDistance >
            0
        ) {
          state.zoom =
            Math.max(
              1,
              Math.min(
                4,
                state.pinchStartZoom *
                (
                  distance /
                  state.pinchStartDistance
                )
              )
            );

          applyFocusTransform(
            video
          );
        }

        return;
      }

      if (
        !state.dragging ||
        event.pointerId !==
          state.pointerId
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      state.x =
        state.startOffsetX +
        event.clientX -
        state.startX;

      state.y =
        state.startOffsetY +
        event.clientY -
        state.startY;

      applyFocusTransform(
        video
      );
    }
  );

  const stop =
    event => {
      if(event?.pointerType==='touch' && state.enabled){event.stopPropagation();event.preventDefault();}
      if (
        event &&
        event.pointerType ===
          'touch'
      ) {
        state.touchPointers.delete(
          event.pointerId
        );

        if (
          state.touchPointers.size <
            2
        ) {
          state.pinchStartDistance =
            0;
        }
      }

      if(state.enabled && state.touchPointers.size===0 && state.zoom<=1.001 && event?.pointerType==='touch'){
        state.zoom=1;state.x=0;state.y=0;setFocusZoomEnabled(video,false);
      }
      if (
        state.dragging &&
        (
          !event ||
          event.pointerId ===
            state.pointerId
        )
      ) {
        state.dragging =
          false;

        state.pointerId =
          null;

        video.classList.remove(
          'dragging'
        );
      }

      // 双指缩放结束后若仍剩一根手指，
      // 允许继续无缝单指拖动画面。
      if (
        event &&
        event.pointerType ===
          'touch' &&
        state.touchPointers.size ===
          1
      ) {
        const entry =
          state.touchPointers
            .entries()
            .next()
            .value;

        if (entry) {
          const remainingId =
            entry[0];

          const point =
            entry[1];

          state.dragging =
            true;

          state.pointerId =
            remainingId;

          state.startX =
            point.x;

          state.startY =
            point.y;

          state.startOffsetX =
            state.x;

          state.startOffsetY =
            state.y;

          video.classList.add(
            'dragging'
          );
        }
      }
    };

  gestureSurface.addEventListener(
    'pointerup',
    stop
  );

  gestureSurface.addEventListener(
    'pointercancel',
    stop
  );

  gestureSurface.addEventListener(
    'wheel',
    event => {
      // Precision trackpads on Windows produce Ctrl+Wheel during two-finger pinch.
      // Alt+Wheel gives a discoverable mouse fallback without hijacking feed scrolling.
      if(event.target?.closest?.('button,input,select,textarea,a,[role=button]'))return;
      if(!state.enabled && !event.ctrlKey && !event.metaKey && !event.altKey)return;
      event.preventDefault();
      event.stopPropagation();
      if(!state.enabled)setFocusZoomEnabled(video,true);

      state.zoom =
        Math.max(
          1,
          Math.min(
            4,
            state.zoom +
            (
              event.deltaY < 0
                ? 0.12
                : -0.12
            )
          )
        );

      if(state.zoom<=1.001){state.zoom=1;state.x=0;state.y=0;setFocusZoomEnabled(video,false);}
      else applyFocusTransform(video);
    },
    {passive:false}
  );
}

function installFocusZoomIn(root) {
  const scope =
    root ||
    document;

  scope
    .querySelectorAll(
      'video'
    )
    .forEach(
      installFocusZoom
    );
}


function feedSections() {
  const scroller =
    document.querySelector(
      '#feedScroller'
    );

  if (!scroller) {
    return [];
  }

  if (jfFeedVirtualState && jfFeedVirtualState.sections[0]?.parentElement===scroller)
    return jfFeedVirtualState.sections;
  return [
    ...scroller.querySelectorAll(
      '.feedItem'
    )
  ];
}

function feedSectionIndex(section) {
  if (!section) {
    return -1;
  }

  const value =
    Number(
      section.dataset.index
    );

  return Number.isFinite(value)
    ? value
    : -1;
}

function disconnectFeedVideoObserver(video) {
  if (
    !video ||
    typeof videoResizeObservers ===
      'undefined'
  ) {
    return;
  }

  const observer =
    videoResizeObservers.get(video);

  if (observer) {
    try {
      observer.disconnect();
    } catch {}

    try {
      videoResizeObservers.delete(video);
    } catch {}
  }
}

function setupFeedVideo(video, section) {
  if (!video || !section) {
    return;
  }

  installRememberedVolume(
    video
  );

  const key = section.dataset.key;

  if (
    video.dataset.feedSetup !== '1'
  ) {
    video.dataset.feedSetup = '1';

    installFeedABVideo(video, key);
    installFocusZoom(video);
  }

  const activeFullscreen =
    fullscreenVideoElement();

  if (video !== activeFullscreen) {
    video.dataset.itemKey = key;
    video.dataset.fullscreenKey = key;
    video.dataset.rotation =
      section.dataset.rotation || '0';
  }

  applyRotationToVideo(
    video,
    Number(video.dataset.rotation || 0)
  );
}

function loadFeedVideo(video, section, active) {
  if (!video || !section) {
    return;
  }

  setupFeedVideo(video, section);
  if (video.dataset.ghostMode==='1') return;

  const activeFullscreen =
    fullscreenVideoElement();

  const fullscreenKey =
    video.dataset.fullscreenKey ||
    '';

  // 原生全屏切换时，同一个 video 会临时承载其他媒体。
  // 后台 Feed 预加载不能再按宿主卡片的 data-src 把它覆盖回去。
  if (
    video === activeFullscreen &&
    fullscreenKey &&
    fullscreenKey !==
      section.dataset.key
  ) {
    video.preload =
      'auto';

    return;
  }

  const src = video.dataset.src;
  if (!src) {
    return;
  }

  const alreadyLoaded =
    video.dataset.loaded === '1' &&
    video.getAttribute('src') === src;

  // Adjacent players may buffer in background, but must never auto-play.
  video.preload = 'auto';

  if (!alreadyLoaded) {
    video.src = src;
    video.dataset.loaded = '1';

    try {
      video.load();
    } catch {}
  }
}

function unloadFeedVideo(video) {
  if (!video) {
    return;
  }

  const activeFullscreen =
    fullscreenVideoElement();

  if (
    video === activeFullscreen ||
    (
      nativeFullscreenVideo === video &&
      activeFullscreen
    )
  ) {
    return;
  }

  if (
    video.dataset.loaded !== '1' &&
    !video.hasAttribute('src')
  ) {
    disconnectFeedVideoObserver(video);
    return;
  }

  try {
    video.pause();
  } catch {}

  disconnectFeedVideoObserver(video);
  video.preload = 'none';
  video.dataset.loaded = '0';
  video.removeAttribute('src');

  try {
    video.load();
  } catch {}
}

function jfCleanupFeedSection(section) {
  if (!section) return;
  const video = section.querySelector('video.feedVideo');
  if (video) {
    // The native fullscreen host must stay connected even while its source
    // temporarily represents a different item from its original section.
    if (video === fullscreenVideoElement() ||
        (nativeFullscreenVideo === video && fullscreenVideoElement())) return false;
    try { video.pause(); } catch {}
    unloadFeedVideo(video);
    if (typeof focusZoomStates !== 'undefined') {
      const zoom = focusZoomStates.get(video);
      if (zoom) {
        try { setFocusZoomEnabled(video,false); } catch {}
        focusZoomStates.delete(video);
      }
    }
  }
  section.replaceChildren();
  return true;
}

function hydrateFeedWindow(centerIndex) {
  const virtual = jfFeedVirtualState;
  if (virtual) {
    const {sections,items,mounted} = virtual;
    if (centerIndex < 0 || centerIndex >= sections.length) return;
    const start = Math.max(0,centerIndex-JF_FEED_DOM_RADIUS);
    const end = Math.min(sections.length-1,centerIndex+JF_FEED_DOM_RADIUS);
    // Mount before unmount: the next item is ready by the time scroll moves.
    for (let i=start;i<=end;i++) {
      if (!mounted.has(i)) {
        sections[i].innerHTML = jfFeedInteriorMarkup(items[i]);
        mounted.add(i);
      }
    }
    for (const i of [...mounted]) {
      if (i < start || i > end) {
        if (jfCleanupFeedSection(sections[i])) mounted.delete(i);
      }
    }
    for (let i=start;i<=end;i++) {
      const video=sections[i].querySelector('video.feedVideo');
      if (!video) continue;
      const distance = Math.abs(i-centerIndex);
      if (distance<=FEED_PRELOAD_RADIUS) {
        // Only initiate network preloads for the current or immediately
        // adjacent item. This preserves the existing bandwidth budget.
        loadFeedVideo(video,sections[i],i===centerIndex);
      } else if (video.dataset.loaded !== '1') {
        // v7.20: a recently visited item at distance two is still inside
        // the existing five-node DOM window. Keep its buffered media until
        // it actually leaves that window; otherwise fast 350↔351 swipes
        // repeatedly unload/reload 349 and 352 (60 loads in 30 swipes).
        // We never fetch a NEW distance-two item and never retain beyond
        // the five original v7.19 nodes. No persistent disk cache.
        unloadFeedVideo(video);
      }
    }
    return;
  }
  const sections = feedSections();

  if (
    centerIndex < 0 ||
    !sections.length
  ) {
    return;
  }

  for (
    let index = 0;
    index < sections.length;
    index++
  ) {
    const section = sections[index];
    const video =
      section.querySelector(
        'video.feedVideo'
      );

    if (!video) {
      continue;
    }

    const distance =
      Math.abs(index - centerIndex);

    if (
      distance <= FEED_PRELOAD_RADIUS
    ) {
      loadFeedVideo(
        video,
        section,
        index === centerIndex
      );
    } else {
      unloadFeedVideo(video);
    }
  }
}

// Playback arbiter: the native fullscreen video is the *only* audible Feed
// player while fullscreen is active.  The scroll Feed still contains video
// elements for navigation/preload; those must never start a second soundtrack.
function feedAudibleVideo() {
  const scroller=document.getElementById('feedScroller');
  if (!scroller || !document.getElementById('feedOverlay')?.classList.contains('open')) return null;
  const fullscreen=fullscreenVideoElement();
  if (fullscreen && scroller.contains(fullscreen)) return fullscreen;
  const active=[...scroller.querySelectorAll('.feedItem')]
    .find(section=>section.dataset.key===currentFeedKey);
  return active?.querySelector('video.feedVideo')||null;
}
function silenceOtherFeedVideos(keep=null) {
  document.querySelectorAll('#feedScroller video.feedVideo').forEach(video=>{
    if (video!==keep) { try { video.pause(); } catch {} }
  });
}
// A delayed play() promise, loadedmetadata callback or IntersectionObserver
// can try to restart an old video *after* a fullscreen switch. Cancel it at
// the media event boundary too; never let two Feed videos continue playing.
document.addEventListener('play',event=>{
  const video=event.target;
  if (!video?.matches?.('#feedScroller video.feedVideo')) return;
  const expected=feedAudibleVideo();
  if (document.querySelector('.shotStudioBack') || video!==expected) {
    try { video.pause(); } catch {}
    return;
  }
  silenceOtherFeedVideos(video);
},true);

function pauseInactiveFeedVideos(activeSection) {
  if (document.querySelector('.shotStudioBack')) {
    silenceOtherFeedVideos();
    return;
  }
  const scroller=document.getElementById('feedScroller');
  if (!scroller) return;
  const fullscreen=fullscreenVideoElement();
  // Important: the video hosting native fullscreen might belong to the OLD
  // section while its src is switched to a NEW key. Never start the video's
  // new background card just because it became intersecting or got hydrated.
  if (fullscreen) {
    silenceOtherFeedVideos(fullscreen);
    return;
  }
  const expected=feedAudibleVideo();
  silenceOtherFeedVideos(expected);
  if (expected && expected.dataset.loaded==='1' && expected.paused &&
      !document.querySelector('.shotStudioBack')) {
    expected.play().catch(()=>{});
  }
}

// v7.19: Keep scroll positions for the whole catalog but allocate only
// nearby media/controls. The old small-catalog path remains unchanged.
const JF_FEED_DOM_THRESHOLD = 140;
const JF_FEED_DOM_RADIUS = 2;
let jfFeedVirtualState = null;
// Every open/close invalidates callbacks queued by the previous Feed session.
// IntersectionObserver.disconnect() does not revoke callbacks already queued.
let jfFeedSessionGeneration = 0;

function jfFeedInteriorMarkup(item) {
          const media =
            item.kind === 'image'
              ? '<img class="feedMedia feedImage" loading="lazy" decoding="async" src="' +
                esc(item.mediaUrl) +
                '" alt="' +
                esc(item.title || item.creator || '图片') +
                '">'
              : '<div class="videoStage">' +
                '<video class="feedMedia feedVideo" playsinline loop preload="none" data-loaded="0" data-src="' +
                esc(item.mediaUrl) +
                '" data-item-key="' +
                esc(item.key) +
                '" data-fullscreen-key="' +
                esc(item.key) +
                '" data-rotation="' +
                esc(String(Number(item.rotation || 0))) +
                '"' +
                (
                  item.cover
                    ? ' poster="' +
                      esc(item.cover) +
                      '"'
                    : ''
                ) +
                '></video>' +
                '<div class="jfTimeline" role="group" aria-label="视频播放时间轴">' +
  '<button type="button" class="jfTimelinePlay" aria-label="播放或暂停" title="播放 / 暂停">'+'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m8 5 11 7-11 7z"/></svg>'+ '</button>' +
  '<span class="jfTimelineTime">0:00 / --:--</span>' +
  '<div class="jfTimelineTrack">' +
    '<div class="jfAnnotationRail" data-annotation-key="' + esc(item.key) + '" aria-label="视频时间标注"></div>' +
    '<input class="jfVideoSeek" type="range" min="0" max="1000" value="0" step="0.01" aria-label="视频播放进度">' +
  '</div>' +
  '<span class="jfTimelineMarkActions" role="group" aria-label="时间标注快捷操作">' +
    '<button type="button" class="jfTimelineMarkPoint" title="标记当前时间" aria-label="添加时间标注"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v16l-5-4-5 4z"/><path d="M12 7v5M9.5 9.5h5"/></svg></button>' +
    '<button type="button" class="jfTimelineMarkRange" title="记区间起点 / 终点" aria-label="添加区间标注" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5v14M19 5v14M8 12h8M10.5 9.5 8 12l2.5 2.5M13.5 9.5 16 12l-2.5 2.5"/></svg></button>' +
  '</span>' +
  '<button type="button" class="jfTimelineVolumeToggle" aria-label="静音或恢复" title="静音">'+'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9zM17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>'+ '</button>' +
  '<input class="jfTimelineVolume" type="range" min="0" max="1" step="0.05" value="1" aria-label="视频音量">' +
  '<button type="button" class="jfTimelineRate" title="切换播放倍速" aria-label="视频播放倍速">1×</button>' +
  '<button type="button" class="jfTimelineFullscreen" aria-label="原生全屏" title="原生全屏">'+'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg>'+ '</button>' +
'</div>' +
                '</div>';

  return (
              media +
              '<div class="feedDetails">' +
                '<div class="feedInfo">' +
                  '<div class="feedCreator">' +
                    esc(item.creator || '未设置创作者') +
                  '</div>' +
                  '<div class="feedTitle">' +
                    esc(item.title || '未命名') +
                  '</div>' +
                '</div>' +
                (
                  item.kind === 'video'
                    ? feedRatingMarkup(item)
                    : ''
                ) +
              '</div>'
  );
}

function jfFeedSectionMarkup(item,index,lightweight) {
  return '<section class="feedItem" data-index="' + index +
    '" data-key="' + esc(item.key) +
    '" data-rotation="' + esc(String(Number(item.rotation || 0))) +
    '">' + (lightweight ? '' : jfFeedInteriorMarkup(item)) + '</section>';
}

function openFeed(key) {
  const feedSession = ++jfFeedSessionGeneration;
  resetFeedVideoSession(key,true);
  resetFeedWheelGesture();
  const source =
    currentRenderedItems.length
      ? currentRenderedItems
      : allItems;

  if (!source.length) {
    return;
  }

  currentFeedKey = key;
  

  const scroller =
    document.querySelector(
      '#feedScroller'
    );

  // A second open (e.g. delete-next) must not strand the old media players,
  // ResizeObservers, or fullscreen-era IO callbacks outside the new feed.
  if (feedObserver) { feedObserver.disconnect(); feedObserver=null; }
  scroller.querySelectorAll('video.feedVideo').forEach(video => {
    try { video.pause(); } catch {}
    disconnectFeedVideoObserver(video);
    video.removeAttribute('src');
    video.preload='none';
    try { video.load(); } catch {}
  });

  const useLightweightFeed = source.length > JF_FEED_DOM_THRESHOLD;
  // Snapshot this ordering; updates while immersed are picked up on reopen.
  jfFeedVirtualState = null;
  scroller.innerHTML = source.map((item,index) =>
    jfFeedSectionMarkup(item,index,useLightweightFeed)
  ).join('');
  if (useLightweightFeed) {
    jfFeedVirtualState = {
      items: source.slice(),
      sections: Array.from(scroller.children),
      mounted: new Set()
    };
  }

  const sections = feedSections();

  let startIndex =
    sections.findIndex(
      section =>
        section.dataset.key === key
    );

  if (startIndex < 0) {
    startIndex = 0;

    if (sections[0]) {
      currentFeedKey =
        sections[0].dataset.key;
    }
  }

  hydrateFeedWindow(startIndex);
  updateFeedABUi();
  resetFeedDeleteButton();

  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  overlay.classList.add('open');
  resetStudioFeedPanels();
  renderFeedFilmstrip();
  wakeStudioFeedChrome();
  overlay.setAttribute(
    'aria-hidden',
    'false'
  );

  if (currentFeedFocusEnabled()) {
    scheduleImmersiveChromeHide();
  } else {
    exitImmersiveChrome();
  }

  if (feedObserver) {
    feedObserver.disconnect();
  }

  feedObserver =
    new IntersectionObserver(
      entries => {
        // Detached sections and previously queued callbacks must never
        // reactivate a closed Feed or overwrite a newly opened session.
        if (feedSession !== jfFeedSessionGeneration ||
            !overlay.classList.contains('open')) return;
        for (const entry of entries) {
          if (entry.target.parentElement !== scroller) continue;
          if (
            !entry.isIntersecting ||
            entry.intersectionRatio < 0.65
          ) {
            continue;
          }

          const section = entry.target;
          // A stale intersection delivered after a rapid switch must not
          // restore the previous item or start an outdated soundtrack.
          if (jfFeedVirtualState &&
              Math.abs(section.offsetTop-scroller.scrollTop) >
                Math.max(6,scroller.clientHeight*0.45)) continue;
          const index =
            feedSectionIndex(section);

          hydrateFeedWindow(index);

          if (!fullscreenVideoElement()) {
            resetFeedVideoSession(section.dataset.key);
            currentFeedKey =
              section.dataset.key;
            
            renderFeedFilmstrip();
            renderStudioRatingDock();

            updateFeedABUi();
            resetFeedDeleteButton();

            if (currentFeedFocusEnabled()) {
              scheduleImmersiveChromeHide();
            } else {
              exitImmersiveChrome();
            }
          }

          pauseInactiveFeedVideos(section);
        }
      },
      {
        root: scroller,
        threshold: [0.65]
      }
    );

  sections.forEach(
    section =>
      feedObserver.observe(section)
  );

  requestAnimationFrame(
    () => {
      if (feedSession !== jfFeedSessionGeneration ||
          !overlay.classList.contains('open')) return;
      const target = sections[startIndex];

      if (target) {
        target.scrollIntoView({
          block:'start'
        });

        const video =
          target.querySelector(
            'video.feedVideo'
          );

        if (video) {
          video.play().catch(() => {});
        }
      }
    }
  );
}

function scrollGridToFeedKey(
  key
) {
  if (!key) {
    return;
  }
  const feedSession = jfFeedSessionGeneration;
  requestAnimationFrame(
    () => {
      if (feedSession !== jfFeedSessionGeneration) return;
      requestAnimationFrame(
        () => {
          if (feedSession !== jfFeedSessionGeneration ||
              document.querySelector('#feedOverlay')?.classList.contains('open')) return;
          const card =
            [...document.querySelectorAll(
              '#grid .card'
            )]
              .find(
                node =>
                  node.dataset.key ===
                  key
              );

          if (!card) {
            const state = jfCoverVirtualState;
            if (!state || !state.rows) return;
            const row = state.rows.find(row =>
              row.entries.some(entry=>entry.item.key===key));
            if (!row) return;
            const top=window.scrollY+state.grid.getBoundingClientRect().top+
              state.paddingTop+row.top-window.innerHeight*0.4;
            window.scrollTo({top:Math.max(0,top),behavior:'instant'});
            jfPaintVideoWindow(true);
            const visible=Array.from(state.grid.querySelectorAll('.card'))
              .find(node=>node.dataset.key===key);
            if (visible) visible.scrollIntoView({behavior:'instant',block:'center'});
            return;
          }

          card.scrollIntoView({
            behavior:'auto',
            block:'center',
            inline:'nearest'
          });
        }
      );
    }
  );
}

function closeFeed() {
  ++jfFeedSessionGeneration;
  resetFeedVideoSession("",true);
  resetFeedWheelGesture();
  const closingKey =
    currentFeedKey;

  resetFeedDeleteButton();
  exitImmersiveChrome();

  nativeFullscreenVideo =
    null;

  nativeFullscreenKey =
    '';

  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  overlay.classList.remove(
    'open'
  );
  resetStudioFeedPanels();

  overlay.setAttribute(
    'aria-hidden',
    'true'
  );

  if (feedObserver) {
    feedObserver.disconnect();
    feedObserver = null;
  }
  jfFeedVirtualState = null;

  document
    .querySelectorAll(
      '#feedScroller video'
    )
    .forEach(
      video => {
        try {
          video.pause();
        } catch {}

        disconnectFeedVideoObserver(
          video
        );

        video.removeAttribute(
          'src'
        );

        video.preload = 'none';

        try {
          video.load();
        } catch {}
      }
    );

  document.querySelector(
    '#feedScroller'
  ).innerHTML = '';

  if (pendingGridRender) {
    renderCreatorTags();
    render();
    pendingGridRender = false;
  }

  // Return to the library without collecting viewing history.
  renderStudioEntrance();
  scrollGridToFeedKey(
    closingKey
  );
  currentFeedKey="";
}

function stepFeed(direction) {
  const scroller =
    document.querySelector(
      '#feedScroller'
    );

  const items =
    [...scroller.querySelectorAll(
      '.feedItem'
    )];

  if (!items.length) {
    return;
  }

  let index =
    items.findIndex(
      item =>
        item.dataset.key ===
        currentFeedKey
    );

  if (index < 0) {
    index = 0;
  }

  index =
    Math.max(
      0,
      Math.min(
        items.length - 1,
        index + direction
      )
    );

  if (
    items[index].dataset.key === currentFeedKey &&
    Math.abs(scroller.scrollTop - items[index].offsetTop) < 2
  ) {
    return;
  }

  // 先固定当前索引，再跳转画面。不能等待 IntersectionObserver 回调，
  // 否则输入事件在动画期间会使用旧索引并连续跨条目。
  resetFeedVideoSession(items[index].dataset.key);
  currentFeedKey = items[index].dataset.key;
  hydrateFeedWindow(index);
  scroller.scrollTo({
    top: items[index].offsetTop,
    behavior:'instant'
  });
  updateFeedABUi();
  resetFeedDeleteButton();
  pauseInactiveFeedVideos(items[index]);

  if (currentFeedFocusEnabled()) {
    scheduleImmersiveChromeHide();
  }
}

let miniWindowSeed = 0;
let miniZIndex = 1200;

function bringMiniToFront(box) {
  miniZIndex++;
  box.style.zIndex =
    String(miniZIndex);
}

function clampMiniPosition(box, left, top) {
  const width =
    box.offsetWidth || 320;

  const height =
    box.offsetHeight || 360;

  const maxLeft =
    Math.max(
      0,
      window.innerWidth -
      Math.min(
        width,
        window.innerWidth
      )
    );

  const maxTop =
    Math.max(
      0,
      window.innerHeight -
      Math.min(
        height,
        window.innerHeight
      )
    );

  return {
    left:
      Math.max(
        0,
        Math.min(
          maxLeft,
          left
        )
      ),
    top:
      Math.max(
        0,
        Math.min(
          maxTop,
          top
        )
      )
  };
}

function installMiniDrag(box, handle) {
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  handle.addEventListener(
    'pointerdown',
    event => {
      if (
        event.button !== undefined &&
        event.button !== 0
      ) {
        return;
      }

      if (
        event.target.closest(
          'button'
        )
      ) {
        return;
      }

      dragging = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startLeft =
        parseFloat(
          box.style.left || '0'
        );
      startTop =
        parseFloat(
          box.style.top || '0'
        );

      bringMiniToFront(box);

      try {
        handle.setPointerCapture(
          pointerId
        );
      } catch {}

      event.preventDefault();
    }
  );

  handle.addEventListener(
    'pointermove',
    event => {
      if (
        !dragging ||
        event.pointerId !==
          pointerId
      ) {
        return;
      }

      const next =
        clampMiniPosition(
          box,
          startLeft +
          event.clientX -
          startX,
          startTop +
          event.clientY -
          startY
        );

      box.style.left =
        next.left + 'px';

      box.style.top =
        next.top + 'px';
    }
  );

  const stop =
    event => {
      if (
        !dragging ||
        (
          event &&
          event.pointerId !==
            pointerId
        )
      ) {
        return;
      }

      dragging = false;
      pointerId = null;
    };

  handle.addEventListener(
    'pointerup',
    stop
  );

  handle.addEventListener(
    'pointercancel',
    stop
  );
}