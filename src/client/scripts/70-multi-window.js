

function installMiniResize(box, handle) {
  let resizing = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  handle.addEventListener(
    'pointerdown',
    event => {
      if (
        event.button !== undefined &&
        event.button !== 0
      ) {
        return;
      }

      resizing = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startWidth = box.offsetWidth;
      startHeight = box.offsetHeight;

      bringMiniToFront(box);

      try {
        handle.setPointerCapture(
          pointerId
        );
      } catch {}

      event.preventDefault();
      event.stopPropagation();
    }
  );

  handle.addEventListener(
    'pointermove',
    event => {
      if (
        !resizing ||
        event.pointerId !==
          pointerId
      ) {
        return;
      }

      const left =
        parseFloat(
          box.style.left || '0'
        );

      const top =
        parseFloat(
          box.style.top || '0'
        );

      const maxWidth =
        Math.max(
          220,
          window.innerWidth -
          left
        );

      const width =
        Math.max(
          220,
          Math.min(
            maxWidth,
            startWidth +
            event.clientX -
            startX
          )
        );

      const height =
        Math.max(
          180,
          startHeight +
          event.clientY -
          startY
        );

      box.style.width =
        width + 'px';

      box.style.height =
        height + 'px';

      const video =
        box.querySelector(
          'video'
        );

      if (video) {
        const focusState =
          focusZoomStates.get(
            video
          );

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
            video.dataset.rotation || 0
          );
        }
      }
    }
  );

  const stop =
    event => {
      if (
        !resizing ||
        (
          event &&
          event.pointerId !==
            pointerId
        )
      ) {
        return;
      }

      resizing = false;
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


window.addEventListener(
  'resize',
  () => {
    document
      .querySelectorAll(
        '.miniPlayer video[data-rotation]'
      )
      .forEach(
        video => {
          const focusState =
            focusZoomStates.get(
              video
            );

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
              video.dataset.rotation || 0
            );
          }
        }
      );
  }
);


function updateMiniVisibilityToggle() {
  const dock =
    document.querySelector(
      '#multiDock'
    );

  const button =
    document.querySelector(
      '#miniVisibilityToggle'
    );

  const syncButton =
    document.querySelector(
      '#miniSyncStart'
    );

  if (
    !dock ||
    !button
  ) {
    return;
  }

  const count =
    dock.querySelectorAll(
      '.miniPlayer'
    ).length;

  const videoCount =
    dock.querySelectorAll(
      '.miniPlayer video'
    ).length;

  button.classList.toggle(
    'show',
    count > 0
  );

  if (syncButton) {
    syncButton.classList.toggle(
      'show',
      videoCount > 0
    );

    syncButton.title =
      videoCount > 1
        ? '全部 ' + videoCount + ' 个多开视频从 0 秒同时播放'
        : '多开视频从 0 秒重新播放';

    syncButton.setAttribute(
      'aria-label',
      syncButton.title
    );
  }

  if (
    count === 0
  ) {
    dock.classList.remove(
      'hiddenWindows'
    );
  }

  const hidden =
    dock.classList.contains(
      'hiddenWindows'
    );

  const eyeOn =
    button.querySelector(
      '.eyeOn'
    );

  const eyeOff =
    button.querySelector(
      '.eyeOff'
    );

  if (eyeOn) {
    eyeOn.style.display =
      hidden
        ? 'none'
        : '';
  }

  if (eyeOff) {
    eyeOff.style.display =
      hidden
        ? ''
        : 'none';
  }

  button.title =
    hidden
      ? '显示多开窗口'
      : '暂时隐藏多开窗口';

  button.setAttribute(
    'aria-label',
    button.title
  );
}

function toggleMiniWindowsVisibility() {
  const dock =
    document.querySelector(
      '#multiDock'
    );

  if (!dock) {
    return;
  }

  dock.classList.toggle(
    'hiddenWindows'
  );

  updateMiniVisibilityToggle();
}

function restartAllMiniVideos() {
  const videos =
    [
      ...document.querySelectorAll(
        '#multiDock .miniPlayer video'
      )
    ];

  if (!videos.length) {
    return;
  }

  for (const video of videos) {
    try {
      video.currentTime = 0;
    } catch {}
  }

  // 同一次用户点击里统一调用 play，尽可能让各窗口同时起跑。
  for (const video of videos) {
    try {
      const promise =
        video.play();

      if (
        promise &&
        typeof promise.catch ===
          'function'
      ) {
        promise.catch(
          () => {}
        );
      }
    } catch {}
  }
}


function formatMiniTime(seconds) {
  seconds =
    Number(seconds);

  if (
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return '--:--';
  }

  const m =
    Math.floor(
      seconds / 60
    );

  const s =
    Math.floor(
      seconds % 60
    );

  const tenth =
    Math.floor(
      (seconds % 1) * 10
    );

  return (
    m +
    ':' +
    String(s)
      .padStart(2,'0') +
    '.' +
    tenth
  );
}

function validABState(state) {
  return (
    state &&
    Number.isFinite(
      state.a
    ) &&
    Number.isFinite(
      state.b
    ) &&
    state.a >= 0 &&
    state.b >
      state.a +
      0.05
  );
}

function updateMiniABUi(
  box,
  state
) {
  const aButton =
    box.querySelector(
      '.miniSetA'
    );

  const bButton =
    box.querySelector(
      '.miniSetB'
    );

  const loopButton =
    box.querySelector(
      '.miniABLoop'
    );

  if (aButton) {
    aButton.classList.toggle(
      'set',
      Number.isFinite(
        state.a
      )
    );

    aButton.textContent = 'A';

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
  }

  if (bButton) {
    bButton.classList.toggle(
      'set',
      Number.isFinite(
        state.b
      )
    );

    bButton.textContent = 'B';

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
        ? '关闭 A-B 循环'
        : '开启 A-B 循环';
  }
}

function installMiniAB(
  box,
  item,
  video
) {
  if (
    !video ||
    item.kind !==
      'video'
  ) {
    return;
  }

  const state = {
    a: NaN,
    b: NaN,
    enabled: false
  };

  const aButton =
    box.querySelector(
      '.miniSetA'
    );

  const bButton =
    box.querySelector(
      '.miniSetB'
    );

  const loopButton =
    box.querySelector(
      '.miniABLoop'
    );

  const clipButton =
    box.querySelector(
      '.miniClipBtn'
    );
  const saveClipButton=box.querySelector('.miniSaveAB');
  if(saveClipButton) saveClipButton.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    openClipShelf({sourceKey:item.key, state, video});
  });

  if (aButton) {
    aButton.addEventListener(
      'click',
      event => {
        event.stopPropagation();

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

        updateMiniABUi(
          box,
          state
        );
      }
    );
  }

  if (bButton) {
    bButton.addEventListener(
      'click',
      event => {
        event.stopPropagation();

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

        updateMiniABUi(
          box,
          state
        );
      }
    );
  }

  if (loopButton) {
    loopButton.addEventListener(
      'click',
      event => {
        event.stopPropagation();

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

        // 普通情况下仍然保持全视频 loop；
        // A-B 开启时由 timeupdate 自己循环。
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

        updateMiniABUi(
          box,
          state
        );
      }
    );
  }

  const configureClip = () => {
    video.loop = !(state.enabled && validABState(state));
    updateMiniABUi(box, state);
  };
  video.addEventListener('loadedmetadata', configureClip);
  video.addEventListener('durationchange', configureClip);
  installResponsiveVideoLoop(video, () => state);
  if (video.readyState >= 1) configureClip();

  if (clipButton) {
    clipButton.addEventListener(
      'click',
      async event => {
        event.stopPropagation();

        if (
          clipButton.classList.contains(
            'loading'
          )
        ) {
          return;
        }

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

        clipButton.classList.add(
          'loading'
        );

        clipButton.disabled =
          true;

        clipButton.title =
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

          if (data.item) {
            allItems.push(
              data.item
            );

            renderCreatorTags();
            render();
          }

          clipButton.classList.remove(
            'loading'
          );

          clipButton.classList.add(
            'done'
          );

          clipButton.textContent =
            '✓';

          clipButton.title =
            '已生成新视频';

          setTimeout(
            () => {
              clipButton.classList.remove(
                'done'
              );

              clipButton.innerHTML = studioIcon('scissors');

              clipButton.title =
                '截取 A-B 为新视频';

              clipButton.disabled =
                false;
            },
            1200
          );
        } catch (error) {
          clipButton.classList.remove(
            'loading'
          );

          clipButton.disabled =
            false;

          clipButton.innerHTML = studioIcon('scissors');

          clipButton.title =
            '截取 A-B 为新视频';

          alert(
            error.message ||
            '截取失败'
          );
        }
      }
    );
  }

  updateMiniABUi(
    box,
    state
  );
}

function openMulti(key) {
  const item =
    allItems.find(
      x => x.key === key
    );

  if (!item) {
    return;
  }

  const id =
    'mini-' +
    item.key;

  const existing =
    document.getElementById(
      id
    );

  if (existing) {
    bringMiniToFront(
      existing
    );

    return;
  }

  const box =
    document.createElement(
      'div'
    );

  box.id = id;
  box.className = 'miniPlayer';

  miniWindowSeed++;

  const offset =
    (miniWindowSeed - 1) %
    7;

  // Top-left cascade keeps the resize corner reachable away from the screen edge.
  const startLeft = Math.min(Math.max(12, innerWidth - 340), 20 + offset * 30);
  const startTop = Math.min(Math.max(12, innerHeight - 360), 96 + offset * 28);

  box.style.left =
    startLeft + 'px';

  box.style.top =
    startTop + 'px';

  bringMiniToFront(box);

  const media =
    item.kind === 'image'
      ? '<img src="' +
        esc(item.mediaUrl) +
        '" alt="' +
        esc(item.title || '图片') +
        '">'
      : '<video controls playsinline autoplay loop preload="metadata" data-item-key="' +
        esc(item.key) +
        '" data-rotation="' +
        esc(String(Number(item.rotation || 0))) +
        '" src="' +
        esc(item.mediaUrl) +
        '"></video>';

  box.innerHTML =
    '<div class="miniHead">' +
      '<span class="miniLabel">' +
        esc(item.title || '未命名') +
      '</span>' +
      (
        item.kind === 'video'
          ? '<button class="miniToolsToggle" type="button" title="更多操作" aria-label="更多操作" aria-expanded="false">···</button><div class="miniAdvanced">' + '<button class="miniABBtn miniSetA" type="button" title="将当前时间设为 A">A</button>' +
            '<button class="miniABBtn miniSetB" type="button" title="将当前时间设为 B">B</button>' +
            '<button class="miniABBtn miniABLoop" type="button" title="开启 A-B 循环">'+studioIcon('repeat')+'</button>' +
            '<button class="miniABBtn miniSaveAB" type="button" title="保存或管理 A/B 片段">'+studioIcon('clips')+'</button>' +
            '<button class="miniClipBtn" type="button" title="截取 A-B 为新视频">'+studioIcon('scissors')+'</button>' +
            '<button class="miniPortrait" type="button" title="选择 9:16 横向裁剪范围，新增竖屏视频">'+studioIcon('portrait')+'</button>' +
            '<button class="miniMagnify" type="button" title="宽屏聚焦">'+studioIcon('magnify')+'</button>' +
            '<button class="miniRotate" type="button" title="旋转视频">'+studioIcon('rotate')+'</button></div>'
          : ''
      ) +
      '<button class="miniClose" type="button" title="关闭">×</button>' +
    '</div>' +
    '<div class="miniMediaWrap">' +
      media +
      '<div class="miniResize" title="拖拽调整大小"></div>' +
    '</div>';

  const head =
    box.querySelector(
      '.miniHead'
    );

  const resize =
    box.querySelector(
      '.miniResize'
    );

  const miniToggle = box.querySelector('.miniToolsToggle');
  if (miniToggle) miniToggle.addEventListener('click', event => {
    event.stopPropagation();
    const open=box.classList.toggle('miniToolsOpen');
    miniToggle.setAttribute('aria-expanded',String(open));
  });
  installMiniDrag(
    box,
    head
  );

  installMiniResize(
    box,
    resize
  );

  const miniVideo =
    box.querySelector(
      'video'
    );

  if (miniVideo) {
    // 多开视频只在创建时继承一次当前记忆音量；
    // 后续音量调整完全独立，不参与全局同步。
    miniVideo.dataset.independentVolume =
      '1';

    installRememberedVolume(
      miniVideo
    );

    applyRotationToVideo(
      miniVideo,
      item.rotation || 0
    );
  }

  installMiniAB(
    box,
    item,
    miniVideo
  );

  if (miniVideo) {
    installFocusZoom(
      miniVideo
    );
  }

  const miniPortrait = box.querySelector('.miniPortrait');
  if (miniPortrait) {
    miniPortrait.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      makePortraitVideo(item.key, miniPortrait, miniVideo);
    });
  }

  const miniMagnify =
    box.querySelector(
      '.miniMagnify'
    );

  if (miniMagnify) {
    miniMagnify.addEventListener(
      'click',
      event => {
        event.preventDefault();
        event.stopPropagation();

        const enabled =
          toggleFocusZoom(
            miniVideo
          );

        miniMagnify.classList.toggle(
          'active',
          enabled
        );

        miniMagnify.title =
          enabled
            ? '关闭宽屏聚焦'
            : '宽屏聚焦';
      }
    );
  }

  const miniRotate =
    box.querySelector(
      '.miniRotate'
    );

  if (miniRotate) {
    miniRotate.addEventListener(
      'click',
      async event => {
        event.preventDefault();
        event.stopPropagation();

        const next =
          (
            normalizeRotation(
              item.rotation
            ) +
            90
          ) %
          360;

        const saved =
          await setItemRotation(
            item.key,
            next
          );

        if (
          saved === null
        ) {
          return;
        }

        item.rotation =
          saved;

        if (miniVideo) {
          applyRotationToVideo(
            miniVideo,
            saved
          );

          requestAnimationFrame(
            () =>
              rotationTransform(
                miniVideo,
                saved
              )
          );
        }

        miniRotate.title =
          '旋转视频 ' +
          saved +
          '°';

        render();
      }
    );
  }

  box.addEventListener(
    'pointerdown',
    () =>
      bringMiniToFront(
        box
      )
  );

  box
    .querySelector(
      '.miniClose'
    )
    .addEventListener(
      'click',
      event => {
        event.stopPropagation();

        const video =
          box.querySelector(
            'video'
          );

        if (video) {
          video.pause();
        }

        box.remove();

        updateMiniVisibilityToggle();
      }
    );

  document
    .querySelector(
      '#multiDock'
    )
    .appendChild(
      box
    );

  updateMiniVisibilityToggle();
}


// Common media interactions: one menu / selection / rename flow across all three libraries.
function unifiedToast(message) {
  const toast=document.querySelector('#unifiedToast');
  toast.textContent=String(message);toast.hidden=false;
  clearTimeout(unifiedToastTimer);
  unifiedToastTimer=setTimeout(()=>{toast.hidden=true;},2600);
}
function unifiedVisibleItems() {
  if(libraryMode==='video')return currentRenderedItems.filter(x=>x.kind==='video');
  if(libraryMode==='image')return imageViewerList;
  return [...document.querySelectorAll('#grid .audioFileTile[data-media-key]')]
    .map(el=>allItems.find(x=>x.key===el.dataset.mediaKey)).filter(Boolean);
}
function syncUnifiedControls() {
  const btn=document.querySelector('#unifiedSelectTop');if(!btn)return;
  const fav=document.querySelector('#unifiedFavoriteFilter');fav.setAttribute('aria-pressed',String(unifiedFavoriteOnly));
  fav.querySelector('.studioFavoriteLabel').textContent=unifiedFavoriteOnly?'仅看收藏':'收藏';
  document.body.classList.toggle('unifiedSelecting',mediaSelectMode);
  btn.setAttribute('aria-pressed',String(mediaSelectMode));
  btn.textContent=mediaSelectMode?'完成选择':'选择';
  const bar=document.querySelector('#unifiedBatchBar');bar.hidden=!mediaSelectMode;
  const count=mediaSelectedKeys.size;
  document.querySelector('#unifiedCount').textContent='已选 '+count+' 项';
  document.querySelector('#unifiedExport').disabled=count!==1;
  document.querySelector('#unifiedDelete').disabled=count===0;
  document.querySelector('#unifiedFavorite').disabled=count===0;
  document.querySelector('#unifiedMove').disabled=count===0;
  const extract=document.querySelector('#unifiedExtractAudio');
  if(extract){extract.hidden=libraryMode!=='video';extract.disabled=libraryMode!=='video'||!count||jfBatchAudioRunning;
    extract.textContent=jfBatchAudioRunning?'正在提取音轨…':'提取音轨';}
  const items=[...mediaSelectedKeys].map(k=>allItems.find(x=>x.key===k)).filter(Boolean);
  document.querySelector('#unifiedFavorite').textContent=items.length&&items.every(x=>x.favorite)?'★ 取消收藏':'☆ 收藏';
  document.querySelector('#unifiedSelectAll').textContent='全选当前列表';
}