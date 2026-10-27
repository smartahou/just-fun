
const AUDIO_SPEED_STORAGE_KEY = 'douyin-audio-playback-speed';
const AUDIO_SPEED_OPTIONS = [0.5,0.75,1,1.25,1.5,1.75,2];
let audioPlaybackRate = 1;
try {
  const savedRate = Number(localStorage.getItem(AUDIO_SPEED_STORAGE_KEY));
  if (AUDIO_SPEED_OPTIONS.includes(savedRate)) audioPlaybackRate = savedRate;
} catch {}
function audioSpeedLabel(rate) { return String(rate)+'×'; }
let audioLoopEnabled = true;
try { audioLoopEnabled = localStorage.getItem(AUDIO_LOOP_STORAGE_KEY) !== 'off'; } catch {}
const audioABStates = new Map();
const audioClipJobs = new Set();
let renderedAudioSignature = '';
let pendingAudioRender = false;
let activeAudioKey = null;
// Session-only layout preference: never tracks which media was played.
let audioDockManuallyMinimized = false;
const BGM_VOLUME_KEY='justfun-bgm-volume';
function storedBgmVolume(){
  try {
    const raw=localStorage.getItem(BGM_VOLUME_KEY);
    return raw===null?1:Math.min(1,Math.max(0,Number(raw)||0));
  }catch{return 1;}
}
// The compact BGM control may be moved away from captions or video tools.
// The position is presentation-only, separated by monitor orientation and never saved in media indexes.
const BGM_MINI_POSITION_KEY='justfun-bgm-mini-position-v1';
let bgmMiniPositions={};
try {
  const saved=JSON.parse(localStorage.getItem(BGM_MINI_POSITION_KEY)||'{}');
  if(saved && typeof saved==='object' && !Array.isArray(saved)) bgmMiniPositions=saved;
} catch {}
function bgmScreenOrientation(){return innerHeight>innerWidth?'portrait':'landscape';}
function bgmMiniClamp(left,bottom){
  const maxLeft=Math.max(8,innerWidth-98),maxBottom=Math.max(8,innerHeight-54);
  return {left:Math.max(8,Math.min(maxLeft,left)),bottom:Math.max(8,Math.min(maxBottom,bottom))};
}
function placeBgmMini(left,bottom){
  const dock=document.querySelector('#audioDock');
  dock.classList.remove('isSnappedRight');
  const pos=bgmMiniClamp(left,bottom);
  dock.style.setProperty('--bgm-mini-left',pos.left+'px');
  dock.style.setProperty('--bgm-mini-bottom',pos.bottom+'px');
  return pos;
}
function restoreBgmMiniPosition(){
  const dock=document.querySelector('#audioDock');
  const saved=bgmMiniPositions[bgmScreenOrientation()];
  if(!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y) ||
     saved.x<0 || saved.x>1 || saved.y<0 || saved.y>1){
    dock.classList.remove('isSnappedRight');
    dock.style.removeProperty('--bgm-mini-left');
    dock.style.removeProperty('--bgm-mini-bottom');
    return;
  }
  snapBgmMini(saved.x*innerWidth,saved.y*Math.max(0,innerHeight-54),false);
}
function snapBgmMini(centerX,bottom,persist=true){
  const dock=document.querySelector('#audioDock');
  const edge=Math.max(14,Math.min(24,innerWidth*.018));
  const right=centerX>=innerWidth/2;
  const clampedBottom=bgmMiniClamp(0,bottom).bottom;
  dock.classList.toggle('isSnappedRight',right);
  dock.style.setProperty('--bgm-mini-left',(right?Math.max(edge,innerWidth-46-edge):edge)+'px');
  dock.style.setProperty('--bgm-mini-right',edge+'px');
  dock.style.setProperty('--bgm-mini-bottom',clampedBottom+'px');
  if(persist){
    bgmMiniPositions[bgmScreenOrientation()]={x:right?1:0,y:clampedBottom/Math.max(1,innerHeight-54)};
    try{localStorage.setItem(BGM_MINI_POSITION_KEY,JSON.stringify(bgmMiniPositions));}catch{}
  }
}
function rememberBgmMiniPosition(left,bottom){snapBgmMini(left+23,bottom,true);}

let bgmMiniDrag=null;
let bgmMiniSuppressClick=false;
const bgmDock=document.querySelector('#audioDock');
bgmDock.addEventListener('pointerdown',event=>{
  if(event.button!==0 || !bgmDock.classList.contains('isMinimized') ||
     !event.target.closest('.bgmMiniOpen'))return;
  const rect=bgmDock.getBoundingClientRect();
  bgmMiniDrag={id:event.pointerId,x:event.clientX,y:event.clientY,
    left:rect.left,bottom:innerHeight-rect.bottom,moved:false};
  event.target.setPointerCapture?.(event.pointerId);
});
bgmDock.addEventListener('pointermove',event=>{
  const drag=bgmMiniDrag;
  if(!drag || event.pointerId!==drag.id)return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if(!drag.moved && Math.hypot(dx,dy)<7)return;
  drag.moved=true;
  bgmDock.classList.add('isDragging');
  placeBgmMini(drag.left+dx,drag.bottom-dy);
  event.preventDefault();
});
function finishBgmMiniDrag(event){
  const drag=bgmMiniDrag;
  if(!drag || event.pointerId!==drag.id)return;
  bgmMiniDrag=null;
  bgmDock.classList.remove('isDragging');
  if(drag.moved){
    bgmMiniSuppressClick=event.type==='pointerup';
    const rect=bgmDock.getBoundingClientRect();
    rememberBgmMiniPosition(rect.left,innerHeight-rect.bottom);
  }
}
bgmDock.addEventListener('pointerup',finishBgmMiniDrag);
bgmDock.addEventListener('pointercancel',finishBgmMiniDrag);
window.addEventListener('resize',()=>{if(!bgmMiniDrag)restoreBgmMiniPosition();});
// Audio remains a separate playback lane; video-only arbiter must not pause it.
function setAudioDockMinimized(minimized,manual=false){
  const dock=document.querySelector('#audioDock');
  if(manual) audioDockManuallyMinimized=Boolean(minimized);
  const compact=Boolean(minimized);
  dock.classList.toggle('isMinimized',compact);
  if(compact && !bgmMiniDrag)restoreBgmMiniPosition();
  dock.dataset.minimized=String(compact);
  document.body.classList.toggle('audioDockVisible',!compact && !dock.hidden && libraryMode==='audio');
  document.body.classList.toggle('bgmActive',!dock.hidden);
  const sound=dock.querySelector('.audioTrack audio');
  const button=dock.querySelector('.audioDockMinimize');
  if(button) button.setAttribute('aria-label','最小化播放器');
  const play=dock.querySelector('.bgmMiniPlay');
  if(play && sound){
    play.dataset.playing=String(!sound.paused);
    play.setAttribute('aria-label',sound.paused?'播放背景音乐':'暂停背景音乐');
    play.title=sound.paused?'播放背景音乐':'暂停背景音乐';
  }
  const mute=dock.querySelector('.bgmMiniOpen');
  if(mute) mute.setAttribute('aria-expanded',String(!compact));
}
function syncAudioDockMode(){
  const dock=document.querySelector('#audioDock');
  if(dock.hidden)return;
  setAudioDockMinimized(audioDockManuallyMinimized || libraryMode!=='audio');
}


function audioClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const n=Math.max(0,Number(seconds));
  const h=Math.floor(n/3600),m=Math.floor((n%3600)/60),sec=Math.floor(n%60);
  const prefix=h?h+':'+String(m).padStart(2,'0')+':':m+':';
  return prefix+String(sec).padStart(2,'0')+'.'+String(Math.floor((n%1)*100)).padStart(2,'0');
}
function audioTrackFrom(element) { return element && element.closest('.audioTrack'); }
function audioABState(key) {
  if (!audioABStates.has(key)) audioABStates.set(key,{a:null,b:null,enabled:false});
  return audioABStates.get(key);
}
function audioValidAB(state,duration) {
  return Number.isFinite(state.a) && Number.isFinite(state.b) &&
    state.a>=0 && state.b>state.a+0.05 && (!Number.isFinite(duration) || duration<=0 || state.b<=duration+0.05);
}
function audioUIStamp(items,folders) {
  return JSON.stringify([items.filter(x=>x.kind==='audio').map(x=>[x.key,x.title,x.originalName,x.displayName,x.relativeDir,x.sizeText,x.durationText]),
    folders.map(x=>[x.relativeDir,x.parentDir,x.originalName])]);
}
function syncAudioTrack(audio) {
  const track=audioTrackFrom(audio);
  if (!track) return;
  const state=audioABState(track.dataset.audioKey);
  const duration=Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:0;
  const at=Number.isFinite(audio.currentTime)?audio.currentTime:0;
  const playing=!audio.paused;
  if (audio.playbackRate !== audioPlaybackRate) audio.playbackRate=audioPlaybackRate;
  const play=track.querySelector('.audioPlay');
  play.dataset.playing=String(playing);
  play.title=playing?'暂停':'播放';
  play.setAttribute('aria-label',play.title);
  track.querySelector('.audioTimeCurrent').textContent=audioClock(at);
  track.querySelector('.audioTimeDuration').textContent=duration?audioClock(duration):'--:--';
  const seek=track.querySelector('.audioSeek');
  if (duration) { seek.max=String(duration); seek.disabled=false; }
  else seek.disabled=true;
  if (!seek.dataset.dragging) seek.value=String(Math.min(at,duration||0));
  const percent=duration?Math.min(100,Math.max(0,at/duration*100)):0;
  seek.style.setProperty('--audio-progress',percent+'%');
  for(const point of ['a','b']) {
    const el=track.querySelector('.audioMark'+point.toUpperCase());
    const n=state[point];
    const visible=duration&&Number.isFinite(n);
    el.style.display=visible?'block':'none';
    if(visible) el.style.left=Math.min(100,Math.max(0,n/duration*100))+'%';
    track.querySelector('.audio'+point.toUpperCase()).classList.toggle('on',Number.isFinite(n));
  }
  const valid=audioValidAB(state,duration);
  track.querySelector('.audioABInfo').textContent='A '+(Number.isFinite(state.a)?audioClock(state.a):'未设置')+'  ·  B '+(Number.isFinite(state.b)?audioClock(state.b):'未设置');
  const ab=track.querySelector('.audioABLoop');
  ab.disabled=!valid; ab.classList.toggle('on',valid&&state.enabled);
  ab.setAttribute('aria-pressed',String(Boolean(valid&&state.enabled)));
  ab.title=valid&&state.enabled?'关闭区间循环':'开启区间循环';
  ab.setAttribute('aria-label',ab.title);
  const clip=track.querySelector('.audioClip');
  clip.disabled=!valid||audioClipJobs.has(track.dataset.audioKey);
  clip.classList.toggle('loading',audioClipJobs.has(track.dataset.audioKey));
  clip.querySelector('.audioControlLabel').textContent=audioClipJobs.has(track.dataset.audioKey)?'截取中…':'截取片段';
  audio.loop=audioLoopEnabled && !(valid&&state.enabled);
  const loop=track.querySelector('.audioLoop');
  loop.classList.toggle('on',audioLoopEnabled); loop.setAttribute('aria-pressed',String(audioLoopEnabled));
  loop.title=audioLoopEnabled?'整曲循环已开启':'整曲循环已关闭';
  const speedButton=track.querySelector('.audioSpeed');
  speedButton.querySelector('.audioSpeedValue').textContent=audioSpeedLabel(audioPlaybackRate);
  speedButton.title='播放倍速：当前 '+audioSpeedLabel(audioPlaybackRate);
  track.querySelectorAll('.audioSpeedChoice').forEach(option=>{
    const selected=Number(option.dataset.audioSpeed)===audioPlaybackRate;
    option.classList.toggle('on',selected);
    option.setAttribute('aria-pressed',String(selected));
  });
  const mute=track.querySelector('.audioMute');
  mute.dataset.muted=String(Boolean(audio.muted||audio.volume===0));
  mute.title='音量（点击后竖向调节）';
  const volume=track.querySelector('.audioVolume');
  if (document.activeElement!==volume) volume.value=String(Math.round(audio.volume*100));
  if(track.closest('#audioDock')) syncAudioMiniState(audio);
}
function syncAudioMiniState(audio){
  const mini=audio.closest('#audioDock')?.querySelector('.bgmMiniPlay');
  if(!mini)return;
  mini.dataset.playing=String(!audio.paused);
  mini.setAttribute('aria-label',audio.paused?'播放背景音乐':'暂停背景音乐');
  mini.title=audio.paused?'播放背景音乐':'暂停背景音乐';
}
function resetAllAudioStates() {document.querySelectorAll('#audioDock .audioTrack audio').forEach(syncAudioTrack);}
async function playAudioSafely(audio) {
  const track=audioTrackFrom(audio); if (!track) return;
  const msg=track.querySelector('.audioMessage'); msg.textContent='';
  if (audio.readyState===0 && audio.networkState===HTMLMediaElement.NETWORK_EMPTY) audio.load();
  try {await audio.play();}
  catch(error) {
    // 只有加载被浏览器中断时才重试；格式不支持、源文件损坏不会无限重试。
    if (audio.isConnected && error && error.name==='AbortError') {
      try { await audio.play(); return; } catch(next){error=next;}
    }
    if (!audio.isConnected) return;
    msg.textContent='播放失败：'+(error?.message||'音频无法解码或读取');
    syncAudioTrack(audio);
  }
}

// 唯一驻留的音频播放实例不参与文件列表的重绘，避免切换目录、轮询打断播放。
function audioDockMarkup(item) {
  return '<article class="audioTrack" data-audio-key="'+esc(item.key)+'">'+
      '<div class="audioTrackHeader"><span class="audioArtwork" aria-hidden="true">'+studioIcon('audio')+'</span>'+
      '<div class="audioTrackInfo"><div class="audioTitle" title="'+esc(audioDisplayName(item))+'">'+esc(audioDisplayName(item))+'</div>'+
      '<div class="audioMeta">'+esc(item.sizeText||'音频文件')+'</div></div>'+
      '<div class="audioDockHeaderActions"><button type="button" class="audioDockMinimize" title="最小化 · 保持音乐播放" aria-label="最小化播放器">'+studioIcon('minus')+'</button>'+ 
      '<button type="button" class="audioDockClose" title="停止音乐并关闭" aria-label="停止音乐并关闭">×</button></div></div>'+
      '<div class="audioTimeline">'+
      '<button type="button" class="audioIconBtn audioPlay" data-playing="false" data-audio-action="play" title="播放" aria-label="播放">'+
      '<svg class="audioGlyphPlay" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 5.8 L18.5 12 L8.5 18.2 Z" fill="currentColor"/></svg>'+
      '<svg class="audioGlyphPause" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 6.5 V17.5 M15.5 6.5 V17.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg></button>'+
      '<span class="audioTime audioTimeCurrent">0:00.00</span>'+
      '<div class="audioSeekWrap"><input class="audioSeek" type="range" min="0" max="100" value="0" step="0.01" aria-label="精确播放进度：方向键微调 0.05 秒" disabled>'+
      '<i class="audioMark audioMarkA"></i><i class="audioMark audioMarkB"></i><div class="jfAnnotationAudioMarks" data-annotation-key="'+esc(item.key)+'"></div></div>'+
      '<span class="audioTime audioTimeDuration">--:--</span></div>'+
      '<div class="audioTools audioToolsExpanded"><div class="audioABTools">'+
      '<button type="button" class="audioIconBtn jfAudioBookmark" data-annotation-action="point" title="标记当前时间点" aria-label="添加时间标记">'+'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v16l-5-4-5 4z"/><path d="M12 7v5M9.5 9.5h5"/></svg>'+'</button>'+
      '<button type="button" class="audioIconBtn jfAudioRange" data-annotation-action="range" title="开始区间标注"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5v14M19 5v14M8 12h8M10.5 9.5 8 12l2.5 2.5M13.5 9.5 16 12l-2.5 2.5"/></svg></button>'+
      '<button type="button" class="audioIconBtn jfAudioShelf" data-annotation-action="shelf" title="打开标注库">'+'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h8"/></svg>'+'</button>'+
      '<button type="button" class="audioIconBtn audioABBtn audioA" data-audio-action="set-a" title="将当前时间设为 A 点"><span class="audioLetterIcon">A</span><span class="audioControlLabel">设 A</span></button>'+
      '<button type="button" class="audioIconBtn audioABBtn audioB" data-audio-action="set-b" title="将当前时间设为 B 点"><span class="audioLetterIcon">B</span><span class="audioControlLabel">设 B</span></button>'+
      '<button type="button" class="audioIconBtn audioABLoop" data-audio-action="ab" aria-pressed="false" title="开启区间循环" disabled><span class="audioControlIcon">'+studioIcon('repeat')+'</span><span class="audioControlLabel">区间循环</span></button>'+
      '<button type="button" class="audioIconBtn audioClip" data-audio-action="clip" title="截取选定区间并保存为音频" disabled><span class="audioControlIcon">'+studioIcon('scissors')+'</span><span class="audioControlLabel">截取片段</span></button>'+
      '</div><span class="audioABInfo" aria-live="polite">A 未设置 · B 未设置</span>'+
      '<div class="audioRightTools">'+
      '<button type="button" class="audioIconBtn audioLoop'+(audioLoopEnabled?' on':'')+'" data-audio-action="loop" aria-pressed="'+(audioLoopEnabled?'true':'false')+'" title="单曲循环"><span class="audioControlIcon">'+studioIcon('repeat')+'</span><span class="audioControlLabel">单曲循环</span></button>'+
      '<div class="audioSpeedBox"><button type="button" class="audioIconBtn audioSpeed" data-audio-action="speed" aria-haspopup="true" aria-expanded="false" title="选择播放倍速"><span class="audioSpeedValue">'+audioSpeedLabel(audioPlaybackRate)+'</span></button>'+
      '<div class="audioSpeedPopup" role="group" aria-label="音频播放倍速">'+AUDIO_SPEED_OPTIONS.map(rate=>
      '<button type="button" class="audioSpeedChoice'+(rate===audioPlaybackRate?' on':'')+'" data-audio-speed="'+rate+'" aria-pressed="'+(rate===audioPlaybackRate?'true':'false')+'">'+audioSpeedLabel(rate)+'</button>'
      ).join('')+'</div></div>'+
      '<div class="audioVolumeBox"><button type="button" class="audioIconBtn audioMute" data-muted="false" data-audio-action="volume" aria-label="调整音量" title="点击调节音量"><span class="audioControlIcon audioVolumeOn">'+studioIcon('volume')+'</span><span class="audioControlIcon audioVolumeOff">'+studioIcon('mute')+'</span></button>'+
      '<div class="audioVolumePopup"><input class="audioVolume" type="range" min="0" max="100" value="100" step="1" aria-label="音量"></div></div></div></div>'+
      '<div class="audioMessage" role="status" aria-live="polite"></div>'+
      '<audio preload="metadata" playsinline src="'+esc(item.mediaUrl)+'"></audio></article>'+ 
      '<div class="bgmMini" role="group" aria-label="背景音乐控制">'+
      '<button type="button" class="bgmMiniOpen" title="展开背景音乐播放器" aria-label="展开背景音乐播放器" aria-expanded="false">'+studioIcon('audio')+'</button>'+ 
      '<button type="button" class="bgmMiniPlay" data-playing="false" aria-label="播放背景音乐" title="播放背景音乐"><svg viewBox="0 0 24 24" aria-hidden="true" class="bgmIconPause"><path d="M9 6v12M15 6v12"/></svg><svg viewBox="0 0 24 24" aria-hidden="true" class="bgmIconPlay"><path d="m8 5 11 7-11 7Z"/></svg></button></div>';
}
function closeAudioDock() {
  const dock=document.querySelector('#audioDock');
  const audio=dock.querySelector('audio');
  if(audio) {audio.pause();audio.removeAttribute('src');audio.load();}
  dock.hidden=true;
  dock.replaceChildren();
  document.body.classList.remove('audioDockVisible','bgmActive');
  audioDockManuallyMinimized=false;
  activeAudioKey=null;
  document.querySelectorAll('.audioFileTile.isActive').forEach(el=>el.classList.remove('isActive'));
}
function syncActiveAudioTiles() {
  document.querySelectorAll('.audioFileTile').forEach(el=>{
    const isActive=el.dataset.audioFileKey===activeAudioKey;
    el.classList.toggle('isActive',isActive);
    el.setAttribute('aria-pressed',String(isActive));
  });
}
function openAudioDock(key) {
  const item=allItems.find(x=>x.key===key && x.kind==='audio');
  if(!item)return;
  const dock=document.querySelector('#audioDock');
  const old=dock.querySelector('audio');
  if(activeAudioKey===key && old) {
    if(old.paused)playAudioSafely(old);
    syncActiveAudioTiles();
    return;
  }
  const lastVolume=old ? old.volume : 1;
  if(old) old.pause();
  activeAudioKey=key;
  dock.innerHTML=audioDockMarkup(item);
  dock.hidden=false;
  const audio=dock.querySelector('audio');
  audio.volume=old?lastVolume:storedBgmVolume();
  audio.playbackRate=audioPlaybackRate;
  syncAudioTrack(audio);
  syncActiveAudioTiles();
  syncAudioDockMode();
  playAudioSafely(audio);
}

function unifiedFolderTileHTML(dir) {
  const name=folderDisplayName(dir);
  return '<div class="unifiedFolderTile"><button type="button" data-open-folder="'+esc(dir)+'" class="folderEntry" title="打开 '+esc(name)+'">'+
    '<span class="studioFolderIcon" aria-hidden="true">'+studioIcon('folder')+'</span><span class="studioFolderName">'+esc(name)+'</span></button>'+
    (allFolders.some(f=>f.relativeDir===dir&&!f.readOnly)?'<button type="button" class="unifiedFolderMore" data-folder-more="'+esc(dir)+'" aria-label="管理目录 '+esc(name)+'" title="目录操作">⋯</button>':'')+'</div>';
}
// Esc collapses the expanded music player without pausing the audio.
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey)return;
  const dock=document.querySelector('#audioDock');
  if(!dock||dock.hidden||dock.classList.contains('isMinimized'))return;
  if(event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  if(document.fullscreenElement||document.querySelector('#feedOverlay.open, #clipShelfBack:not([hidden]), #jfMarkPopover:not([hidden]), #assetView.open, .shotStudioBack:not([hidden]), .portraitDialogBack:not([hidden]), #unifiedAlbumBack:not([hidden]), #unifiedMoveBack:not([hidden]), #unifiedRenameBack:not([hidden]), .unifiedContext:not([hidden]), .audioSpeedBox.open'))return;
  setAudioDockMinimized(true,true);event.preventDefault();event.stopPropagation();
});
