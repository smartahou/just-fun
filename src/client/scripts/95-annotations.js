// Just Fun v6.31 — persistent media annotations. Never mutates source media.
let clipShelfRecords=[];
let clipShelfContext=null;
let clipShelfDraft=null;
let clipShelfPlayingBefore=null;
let clipShelfRequestBusy=false;
const jfAnnotationPendingRanges=new Map();
const jfAnnotationColors={default:'#a9e5e7',amber:'#f3c377',rose:'#f0a5b6',violet:'#bdacf5',green:'#91ddaf',blue:'#9ecafa'};
function jfAnnotationColor(mark){return Object.hasOwn(jfAnnotationColors,mark?.color)?mark.color:'default';}
function clipTime(seconds){
  const milli=Math.max(0,Math.round((Number(seconds)||0)*1000));
  const total=Math.floor(milli/1000),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),sec=total%60;
  return (h?String(h)+':'+String(m).padStart(2,'0'):String(m))+':'+String(sec).padStart(2,'0')+'.'+String(milli%1000).padStart(3,'0');
}
function clipReadTime(value){
  const parts=String(value??'').trim().split(':');
  if(parts.length>3||parts.some(x=>!/^\d+(?:\.\d+)?$/.test(x.trim())))return NaN;
  return parts.reduce((total,part)=>total*60+Number(part),0);
}
function clipShelfVisible(){return !document.querySelector('#clipShelfBack').hidden;}
async function clipShelfFetch(){
  const response=await fetch('/api/clips',{cache:'no-store'}),data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||'加载标注失败');
  clipShelfRecords=Array.isArray(data.clips)?data.clips:[];
  jfAnnotationRenderAll();
}
async function clipShelfPost(body,url='/api/clips'){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||'标注操作失败');
  return data;
}
function clipShelfToast(message,error=false){
  const node=document.querySelector('#clipShelfToast');
  if(!node)return;
  node.textContent=message;node.style.color=error?'#ffafb7':'#b8e6c2';
}
function jfAnnotationSource(key){return allItems.find(x=>x.key===key&&(x.kind==='video'||x.kind==='audio'));}
function jfAnnotationContext(){
  if(clipShelfContext&&jfAnnotationSource(clipShelfContext.sourceKey))return clipShelfContext;
  const video=document.querySelector('#feedOverlay.open')?getCurrentFeedVideo():null;
  const item=video&&getCurrentFeedItem();
  if(item&&item.kind==='video')return {sourceKey:item.key,media:video,state:getFeedABState(item.key)};
  const audio=document.querySelector('#audioDock .audioTrack audio');
  if(audio&&activeAudioKey)return {sourceKey:activeAudioKey,media:audio};
  return null;
}
function jfAnnotationDuration(media,key){
  if(media&&Number.isFinite(media.duration)&&media.duration>0)return media.duration;
  const item=jfAnnotationSource(key);return Number(item&&item.duration)||0;
}
function jfAnnotationValidTimes(a,b,duration){
  return Number.isFinite(a)&&a>=0&&a<=604800&&(!duration||a<=duration+.25)&&
    (b===null||(Number.isFinite(b)&&b>=a+.06&&b<=604800&&(!duration||b<=duration+.25)));
}
async function jfAnnotationSaveQuick(key,a,b=null){
  const item=jfAnnotationSource(key);
  if(!item||!jfAnnotationValidTimes(a,b,jfAnnotationDuration(null,key))){unifiedToast('标注时间无效');return;}
  const name=(b===null?'标记 ':'区间 ')+clipTime(a)+(b===null?'':' — '+clipTime(b));
  try{
    const result=await clipShelfPost({action:'create',sourceKey:key,name,a,b});
    if(!clipShelfRecords.some(x=>x.id===result.clip.id))clipShelfRecords.push(result.clip);
    jfAnnotationRenderAll();
    if(clipShelfVisible())clipShelfRender();
    // A successful annotation is visible immediately on the timeline; no toast.
  }catch(error){unifiedToast('标注失败：'+error.message);}
}
function jfAnnotationSetRangeButton(key){
  const videoKey=getCurrentFeedItem()&&getCurrentFeedItem().key;
  const videoBtn=document.querySelector('#feedRangeMark');
  if(videoBtn)videoBtn.setAttribute('aria-pressed',String(Boolean(key===videoKey&&jfAnnotationPendingRanges.has(videoKey))));
  const barBtn=document.querySelector('.feedItem.studioCurrent .jfTimelineMarkRange');
  if(barBtn)barBtn.setAttribute('aria-pressed',String(jfAnnotationPendingRanges.has(videoKey))); 
  const audioBtn=document.querySelector('#audioDock .jfAudioRange');
  if(audioBtn)audioBtn.setAttribute('aria-pressed',String(jfAnnotationPendingRanges.has(activeAudioKey)));
}
async function jfAnnotationToggleRange(key,media){
  const a=Math.max(0,Number(media.currentTime)||0),old=jfAnnotationPendingRanges.get(key);
  if(old===undefined){jfAnnotationPendingRanges.set(key,a);}
  else if(a<old+.06){unifiedToast('请播放或跳转至起点之后，再保存终点');return;}
  else{jfAnnotationPendingRanges.delete(key);await jfAnnotationSaveQuick(key,old,a);}
  jfAnnotationSetRangeButton(key);
}
function jfAnnotationSeek(key,time,kind){
  const item=jfAnnotationSource(key);if(!item)return;
  if(kind==='audio'){
    openAudioDock(key);
    const audio=document.querySelector('#audioDock .audioTrack audio');
    if(!audio)return;
    const seek=()=>{if(audio.isConnected&&activeAudioKey===key){audio.currentTime=Math.min(time,jfAnnotationDuration(audio,key)||time);syncAudioTrack(audio);}};
    if(audio.readyState>=1)seek();else audio.addEventListener('loadedmetadata',seek,{once:true});
    return;
  }
  if(!document.querySelector('#feedOverlay').classList.contains('open')||getCurrentFeedItem()?.key!==key){
    if(libraryMode!=='video')changeMediaCategory('video');
    currentRenderedItems=allItems.filter(x=>x.kind==='video');
    openFeed(key);
  }
  const video=getCurrentFeedVideo();
  if(!video)return;
  const seek=()=>{if(video.isConnected&&getCurrentFeedItem()?.key===key)video.currentTime=Math.min(time,jfAnnotationDuration(video,key)||time);};
  if(video.readyState>=1)seek();else video.addEventListener('loadedmetadata',seek,{once:true});
}
function jfAnnotationPaint(root,media){
  const key=root.dataset.annotationKey;
  const duration=jfAnnotationDuration(media,key);
  root.replaceChildren();
  if(!duration)return;
  for(const mark of clipShelfRecords.filter(x=>x.sourceKey===key)){
    if(mark.a<0||mark.a>duration+.25)continue;
    const pos=Math.max(0,Math.min(100,100*mark.a/duration));
    const span=Number.isFinite(mark.b)&&mark.b>mark.a;
    const node=document.createElement('button');node.type='button';
    node.className=span?'jfAnnotationSpan':'jfAnnotationPoint';
    node.style.left=pos+'%';
    if(span)node.style.width=Math.max(.4,Math.min(100-pos,100*(mark.b-mark.a)/duration))+'%';
    node.title=mark.name+' · '+clipTime(mark.a)+(span?' — '+clipTime(mark.b):'');
    node.dataset.annotationKind=span?'range':'point';
    node.setAttribute('aria-label','跳转：'+node.title);
    node.dataset.annotationId=mark.id;
    node.dataset.annotationColor=jfAnnotationColor(mark);
    node.style.setProperty('--jf-mark-color',jfAnnotationColors[jfAnnotationColor(mark)]);
    root.appendChild(node);
  }
}
function jfAnnotationRenderAll(){
  document.querySelectorAll('.jfAnnotationRail').forEach(rail=>{
    const video=rail.parentElement.querySelector('video');jfAnnotationPaint(rail,video);
  });
  document.querySelectorAll('.jfAnnotationAudioMarks').forEach(rail=>{
    const audio=rail.closest('.audioTrack')?.querySelector('audio');jfAnnotationPaint(rail,audio);
  });
  jfAnnotationSetRangeButton();

}
function clipShelfRender(){
  const root=document.querySelector('#clipShelfList');if(!root)return;
  const query=document.querySelector('#clipShelfSearch').value.trim().toLowerCase();
  const only=Boolean(document.querySelector('#feedOverlay.open'))||document.querySelector('#clipShelfOnly').checked;
  const current=clipShelfContext?.sourceKey;
  const entries=clipShelfRecords.filter(c=>(!only||c.sourceKey===current)&&(!query||(c.name+' '+c.sourceTitle).toLowerCase().includes(query)))
    .sort((a,b)=>only?(a.a-b.a):String(b.updatedAt).localeCompare(String(a.updatedAt)));
  root.innerHTML=entries.length?entries.map(mark=>{
    const source=jfAnnotationSource(mark.sourceKey);
    const poster=source&&source.kind==='video'&&source.cover?source.cover:'';
    const span=Number.isFinite(mark.b);
    const detail=(mark.kind==='audio'?'♫ ':'▶ ')+(span?'区间 · ':'标记 · ')+clipTime(mark.a)+(span?' — '+clipTime(mark.b):'');
    return '<article class="clipShelfRow'+(mark.kind==='audio'?' audio':'')+(mark.sourceAvailable?'':' missing')+'" data-clip-id="'+esc(mark.id)+'">'+
      '<div class="clipShelfPoster" aria-hidden="true">'+(poster?'<img loading="lazy" alt="" src="'+esc(poster)+'">':'<span class="jfAnnotationPosterGlyph">'+(mark.kind==='audio'?'♫':'▶')+'</span>')+'</div>'+
      '<div><div class="clipShelfRowTitle" title="'+esc(mark.name)+'"><i class="jfClipColorDot" style="--jf-mark-color:'+jfAnnotationColors[jfAnnotationColor(mark)]+'"></i>'+esc(mark.name)+'</div>'+
      '<div class="clipShelfRowInfo" title="'+esc(mark.sourceTitle)+'">'+esc(detail)+'<div>'+esc(mark.sourceTitle)+'</div>'+(mark.sourceAvailable?'':' · 源媒体不可用')+'</div></div>'+
      '<div class="clipShelfRowActions">'+

      (span?'<button type="button" data-clip-action="export"'+(mark.sourceAvailable?'':' disabled')+'>导出</button>':'')+
      '<button type="button" data-clip-action="delete" class="warn">删除</button></div></article>';
  }).join(''):'<div class="clipShelfEmpty">还没有标注。播放视频或音频时点击「＋标记」，就能从这里快速定位。</div>';
  const onlyCheckbox=document.querySelector('#clipShelfOnly');onlyCheckbox.disabled=!current||Boolean(document.querySelector('#feedOverlay.open'));onlyCheckbox.checked=Boolean(document.querySelector('#feedOverlay.open'))||onlyCheckbox.checked;
}
function clipShelfBeginForm(clip){
  const ctx=clip?{sourceKey:clip.sourceKey}:jfAnnotationContext();
  if(!ctx){unifiedToast('请先播放一段视频或音频');return;}
  const source=jfAnnotationSource(ctx.sourceKey);
  if(!clip&&!source){unifiedToast('媒体不存在');return;}
  clipShelfDraft={mode:clip?'edit':'create',id:clip?.id,sourceKey:ctx.sourceKey};
  const a=clip?clip.a:(Number((ctx.media||ctx.video)?.currentTime)||0);
  const state=ctx.state;
  const b=clip?clip.b:(state&&Number.isFinite(state.a)&&Number.isFinite(state.b)&&state.b>state.a+.06?state.b:null);
  const start=clip?a:(b!==null&&state?state.a:a);
  document.querySelector('#clipShelfFormTip').textContent=(clip?'编辑标注 · ':'新建标注 · ')+(source?.title||clip?.sourceTitle||'媒体');
  document.querySelector('#clipShelfName').value=clip?clip.name:((b===null?'标记 ':'区间 ')+clipTime(start));
  document.querySelector('#clipShelfA').value=clipTime(start);
  document.querySelector('#clipShelfB').value=b===null?'':clipTime(b);
  document.querySelector('#clipShelfFav').checked=!!clip?.favorite;
  clipShelfToast('');document.querySelector('#clipShelfForm').hidden=false;
  document.querySelector('#clipShelfName').focus();
  document.querySelector('#clipShelfForm').scrollIntoView({block:'nearest'});
}
function clipShelfCancelForm(){clipShelfDraft=null;document.querySelector('#clipShelfForm').hidden=true;clipShelfToast('');}
async function openClipShelf(context=null){
  const activeVideo=document.querySelector('#feedOverlay.open')?getCurrentFeedItem():null;
  clipShelfContext=activeVideo?.kind==='video'?{sourceKey:activeVideo.key,media:getCurrentFeedVideo()}:context||jfAnnotationContext();clipShelfCancelForm();
  document.querySelector('#clipShelfBack').hidden=false;
  document.querySelector('#clipShelfSearch').value='';
  document.querySelector('#clipShelfOnly').checked=!!clipShelfContext;
  const playing=clipShelfContext?.video||clipShelfContext?.media||null;
  clipShelfPlayingBefore=playing&&!playing.paused?playing:null;
  if(clipShelfPlayingBefore)clipShelfPlayingBefore.pause();
  try{await clipShelfFetch();clipShelfRender();}catch(error){clipShelfToast(error.message,true);document.querySelector('#clipShelfList').textContent=error.message;}
}
function closeClipShelf(resume=true){
  if(!clipShelfVisible())return;
  document.querySelector('#clipShelfBack').hidden=true;clipShelfCancelForm();
  if(resume&&clipShelfPlayingBefore?.isConnected)clipShelfPlayingBefore.play().catch(()=>{});
  clipShelfPlayingBefore=null;clipShelfContext=null;
}
// Work/study interval preview is independent of the A/B looping and ghost effect.
// It plays once and pauses at the annotation end without editing A/B state.
let jfAnnotationIntervalPreview=null;
function clipShelfPlay(mark){
  if(!mark.sourceAvailable)return;
  closeClipShelf(false);
  jfAnnotationSeek(mark.sourceKey,mark.a,mark.kind);
  jfAnnotationIntervalPreview=null;
  if(!Number.isFinite(mark.b)||mark.b<=mark.a){
    const media=mark.kind==='video'?getCurrentFeedVideo():document.querySelector('#audioDock .audioTrack audio');
    if(media){const play=()=>media.play().catch(()=>{});if(media.readyState>=1)play();else media.addEventListener('loadedmetadata',play,{once:true});}
    return;
  }
  const ab=mark.kind==='video'?getFeedABState(mark.sourceKey):audioABState(mark.sourceKey);
  if(ab?.enabled){unifiedToast('已定位起点 · 关闭 A/B 循环后可单次播放标注区间');return;}
  const media=mark.kind==='video'?getCurrentFeedVideo():document.querySelector('#audioDock .audioTrack audio');
  if(!media)return;
  const start=()=>{
    if(!media.isConnected)return;
    media.currentTime=mark.a;
    jfAnnotationIntervalPreview={media,end:mark.b,key:mark.sourceKey};
    media.play().catch(()=>{});
  };
  if(media.readyState>=1)start();else media.addEventListener('loadedmetadata',start,{once:true});
}
// Capture runs before target-level entertainment A/B listeners.
document.addEventListener('timeupdate',event=>{
  const preview=jfAnnotationIntervalPreview;
  if(!preview||preview.media!==event.target)return;
  if(!preview.media.isConnected || (preview.media.matches('video.feedVideo') && preview.media.dataset.itemKey!==preview.key)){
    jfAnnotationIntervalPreview=null;return;
  }
  if(preview.media.currentTime>=preview.end-.035){
    try{preview.media.pause();}catch{}
    jfAnnotationIntervalPreview=null;
    // The playhead and paused state already communicate interval completion.
  }
},true);
async function clipShelfDispatch(event){
  const button=event.target.closest('button[data-clip-action]');if(!button||clipShelfRequestBusy)return;
  const row=button.closest('[data-clip-id]');if(!row)return;
  const mark=clipShelfRecords.find(x=>x.id===row.dataset.clipId);if(!mark)return;
  const action=button.dataset.clipAction;
  if(action==='delete'&&!confirm('删除标注「'+mark.name+'」？原始音视频不会删除。'))return;
  clipShelfRequestBusy=true;button.disabled=true;
  try{
    if(action==='export'){
      const task=jfStartMediaProgress('导出视频区间');let result;
      try{result=mark.kind==='audio'
        ?await clipShelfPost({key:mark.sourceKey,start:mark.a,end:mark.b,jobId:task.id},'/api/clip-audio')
        :await clipShelfPost({id:mark.id,jobId:task.id},'/api/clips/export');}
      finally{task.done(Boolean(result));}
      if(result.item&&!allItems.some(x=>x.key===result.item.key))allItems.push(result.item);
      renderCreatorTags();render();unifiedToast('已导出视频片段');
    }else{
      await clipShelfPost({action:'delete',id:mark.id});
      await clipShelfFetch();clipShelfRender();
    }
  }catch(error){clipShelfToast(error.message,true);unifiedToast('操作失败：'+error.message);}
  finally{clipShelfRequestBusy=false;button.disabled=false;}
}
function initClipShelf(){
  document.querySelector('#clipShelfTop').addEventListener('click',()=>openClipShelf());
  document.querySelector('#feedClipShelf').addEventListener('click',()=>{
    const item=getCurrentFeedItem();if(!item||item.kind!=='video')return;
    openClipShelf({sourceKey:item.key,media:getCurrentFeedVideo(),state:getFeedABState(item.key)});
  });
  document.querySelector('#clipShelfList').addEventListener('dblclick',event=>{
    if(event.target.closest('button,input,a'))return;
    const row=event.target.closest('[data-clip-id]');
    const mark=row&&clipShelfRecords.find(x=>x.id===row.dataset.clipId);
    if(mark?.sourceAvailable)clipShelfPlay(mark);
  });
  document.querySelector('#clipShelfClose').addEventListener('click',()=>closeClipShelf());
  document.querySelector('#clipShelfBack').addEventListener('click',e=>{if(e.target.id==='clipShelfBack')closeClipShelf();});
  document.querySelector('#clipShelfSearch').addEventListener('input',clipShelfRender);
  document.querySelector('#clipShelfOnly').addEventListener('change',clipShelfRender);
  document.querySelector('#clipShelfFavOnly').addEventListener('change',clipShelfRender);
  document.querySelector('#clipShelfCancelEdit').addEventListener('click',clipShelfCancelForm);
  document.querySelector('#clipShelfList').addEventListener('click',clipShelfDispatch);
  document.querySelector('#clipShelfForm').addEventListener('submit',async event=>{
    event.preventDefault();if(!clipShelfDraft||clipShelfRequestBusy)return;
    const a=clipReadTime(document.querySelector('#clipShelfA').value);
    const endValue=document.querySelector('#clipShelfB').value.trim();
    const b=endValue?clipReadTime(endValue):null;
    const name=document.querySelector('#clipShelfName').value.trim();
    const source=jfAnnotationSource(clipShelfDraft.sourceKey);
    if(!jfAnnotationValidTimes(a,b,Number(source?.duration)||0)){clipShelfToast('标注时间无效，请检查起止时间和媒体长度',true);return;}
    clipShelfRequestBusy=true;
    const submit=document.querySelector('#clipShelfSubmit');submit.disabled=true;
    try{
      const body=clipShelfDraft.mode==='create'?{action:'create',sourceKey:clipShelfDraft.sourceKey,name,a,b}:
        {action:'update',id:clipShelfDraft.id,name,a,b};
      await clipShelfPost(body);await clipShelfFetch();
      clipShelfCancelForm();clipShelfRender();
    }catch(error){clipShelfToast(error.message||'保存失败',true);}
    finally{clipShelfRequestBusy=false;submit.disabled=false;}
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&clipShelfVisible()){event.stopImmediatePropagation();event.preventDefault();closeClipShelf();}
  },true);
  document.querySelector('#feedBookmark').addEventListener('click',()=>{
    const video=getCurrentFeedVideo(),item=getCurrentFeedItem();
    if(video&&item?.kind==='video')jfAnnotationSaveQuick(item.key,video.currentTime);
  });
  document.querySelector('#feedRangeMark').addEventListener('click',()=>{
    const video=getCurrentFeedVideo(),item=getCurrentFeedItem();
    if(video&&item?.kind==='video')jfAnnotationToggleRange(item.key,video);
  });
  document.querySelector('#audioDock').addEventListener('click',event=>{
    const button=event.target.closest('[data-annotation-action]');if(!button)return;
    const audio=document.querySelector('#audioDock .audioTrack audio');if(!audio||!activeAudioKey)return;
    const action=button.dataset.annotationAction;
    if(action==='point')jfAnnotationSaveQuick(activeAudioKey,audio.currentTime);
    else if(action==='range')jfAnnotationToggleRange(activeAudioKey,audio);
    else if(action==='shelf')openClipShelf({sourceKey:activeAudioKey,media:audio});
  });
  // Clicking rail markers only seeks: it does not trigger the underlying video overlay.
  document.addEventListener('click',event=>{
    const point=event.target.closest('button[data-annotation-id]');if(!point)return;
    event.stopPropagation();event.preventDefault();
    const mark=clipShelfRecords.find(x=>x.id===point.dataset.annotationId);
    if(mark)jfAnnotationSeek(mark.sourceKey,mark.a,mark.kind);
  },true);
  document.addEventListener('loadedmetadata',event=>{
    if(event.target.matches?.('video.feedVideo, #audioDock .audioTrack audio'))jfAnnotationRenderAll();
  },true);
  const feed=document.querySelector('#feedScroller'),audio=document.querySelector('#audioDock');
  new MutationObserver(()=>jfAnnotationRenderAll()).observe(feed,{childList:true});
  new MutationObserver(()=>jfAnnotationRenderAll()).observe(audio,{childList:true});
  clipShelfFetch().catch(()=>{});
}
initClipShelf();
initJfTimeline();


// v6.32 — an independent, accessible reference layer. A/B entertainment
// playback is not modified by annotation edits. The native video controls are
// retained inside true video-element fullscreen, while ordinary playback uses
// a time-aligned, app-owned seek surface and a separate annotation track.
function jfTimelineTimestamp(seconds){
  const val=Math.max(0,Number(seconds)||0),h=Math.floor(val/3600),m=Math.floor(val%3600/60),s=Math.floor(val%60);
  return (h?String(h)+':'+String(m).padStart(2,'0'):String(m))+':'+String(s).padStart(2,'0');
}
function jfTimelineUpdate(video){
  const stage=video?.closest('.videoStage'),ui=stage?.querySelector('.jfTimeline');
  if(!ui)return;
  const duration=Number(video.duration),valid=Number.isFinite(duration)&&duration>0;
  const current=Number.isFinite(video.currentTime)?video.currentTime:0;
  const slider=ui.querySelector('.jfVideoSeek');
  if(!slider.matches(':active'))slider.value=valid?String(Math.min(1000,current/duration*1000)):'0';
  slider.disabled=!valid;
  slider.style.setProperty('--jf-video-progress',valid?(100*current/duration)+'%':'0%');
  ui.querySelector('.jfTimelineTime').textContent=jfTimelineTimestamp(current)+' / '+(valid?jfTimelineTimestamp(duration):'--:--');
  ui.querySelector('.jfTimelinePlay').dataset.playing=String(!video.paused);
  ui.querySelector('.jfTimelinePlay').setAttribute('aria-label',video.paused?'播放':'暂停');
  ui.querySelector('.jfTimelineVolume').value=video.muted?'0':String(video.volume);
  ui.querySelector('.jfTimelineVolumeToggle').setAttribute('aria-label',video.muted?'恢复声音':'静音');
  const rate=ui.querySelector('.jfTimelineRate');if(rate){rate.textContent=(Number(video.playbackRate)||1)+'×';rate.title='倍速 '+rate.textContent+' · 点击切换';}
  const key=video.closest('.feedItem')?.dataset.key;
  ui.querySelector('.jfTimelineMarkRange')?.setAttribute('aria-pressed',String(Boolean(key&&jfAnnotationPendingRanges.has(key))));
}
let jfPopoverMarkId=null;
let jfPopoverTimer=null;
function jfPopoverHide(){
  clearTimeout(jfPopoverTimer);
  jfPopoverMarkId=null;
  const pop=document.querySelector('#jfMarkPopover');if(pop)pop.hidden=true;
}
function jfPopoverScheduleHide(){
  clearTimeout(jfPopoverTimer);
  jfPopoverTimer=setTimeout(()=>{const pop=document.querySelector('#jfMarkPopover');if(pop&&!pop.matches(':hover')&&!pop.contains(document.activeElement))jfPopoverHide();},280);
}
function jfPopoverOpen(markId,anchor){
  const mark=clipShelfRecords.find(x=>x.id===markId),pop=document.querySelector('#jfMarkPopover');
  if(!mark||!pop||!anchor)return;
  clearTimeout(jfPopoverTimer);
  jfPopoverMarkId=markId;
  const span=Number.isFinite(mark.b)&&mark.b>mark.a;
  pop.querySelector('.jfMarkPopoverType').textContent=span?'区间标注':'时间标注';
  pop.querySelector('.jfMarkPopoverName').value=mark.name;
  pop.querySelectorAll('[data-jf-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.jfColor===jfAnnotationColor(mark))));
  pop.querySelector('.jfMarkPopoverTime').textContent=clipTime(mark.a)+(span?' — '+clipTime(mark.b):'')+' · '+(mark.kind==='video'?'视频':'音频');
  pop.hidden=false;
  // The portal escapes overflow-hidden player stages and compact audio docks.
  const rect=anchor.getBoundingClientRect(),w=pop.offsetWidth||260,h=pop.offsetHeight||150;
  const x=Math.max(10,Math.min(innerWidth-w-10,rect.left+rect.width/2-w/2));
  let y=rect.top-h-12;
  if(y<12)y=Math.min(innerHeight-h-12,rect.bottom+12);
  pop.style.left=Math.round(x)+'px';pop.style.top=Math.round(Math.max(8,y))+'px';
}
function jfAnnotationCopyText(mark){
  const source=jfAnnotationSource(mark.sourceKey);
  const media=source?.title||mark.sourceTitle||mark.sourceKey;
  const a=clipTime(mark.a),b=Number.isFinite(mark.b)?' — '+clipTime(mark.b):'';
  return (mark.kind==='audio'?'音频':'视频')+'：'+media+'\n标注：'+mark.name+'\n时间：'+a+b;
}
async function jfAnnotationClipboard(text){
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}
  const input=document.createElement('textarea');input.value=text;input.style.cssText='position:fixed;left:-9999px';document.body.append(input);
  input.select();const ok=document.execCommand('copy');input.remove();if(!ok)throw new Error('浏览器未允许复制');
}
function jfTimelineControls(event){
  const target=event.target,ui=target.closest('.jfTimeline');if(!ui)return;
  const video=ui.closest('.videoStage')?.querySelector('video.feedVideo');if(!video)return;
  if(target.closest('.jfTimelineMarkPoint,.jfTimelineMarkRange')){
    const item=getCurrentFeedItem();
    if(item?.kind==='video' && item.key===video.closest('.feedItem')?.dataset.key){
      if(target.closest('.jfTimelineMarkPoint'))jfAnnotationSaveQuick(item.key,video.currentTime);
      else jfAnnotationToggleRange(item.key,video);
    }
  }else if(target.closest('.jfTimelinePlay')){
    if(video.paused)video.play().catch(()=>{});else video.pause();
  }else if(target.closest('.jfTimelineVolumeToggle')){
    video.muted=!video.muted;
  }else if(target.closest('.jfTimelineRate')){
    const rates=[1,1.25,1.5,2,.75];
    const i=rates.findIndex(x=>Math.abs(video.playbackRate-x)<.01);
    video.playbackRate=rates[(i+1)%rates.length];
  }else if(target.closest('.jfTimelineFullscreen')){
    video.controls=true;
    const promise=video.requestFullscreen?.();
    if(promise?.catch)promise.catch(()=>{video.controls=false;unifiedToast('浏览器拒绝全屏');});
  }
  jfTimelineUpdate(video);
}
function initJfTimeline(){
  const feed=document.querySelector('#feedScroller'),pop=document.querySelector('#jfMarkPopover');
  feed.addEventListener('click',event=>{
    if(!event.target.closest('.jfTimeline'))return;
    if(event.target.closest('.jfAnnotationRail button'))return;
    event.stopPropagation();jfTimelineControls(event);
  });
  feed.addEventListener('pointerdown',event=>{if(event.target.closest('.jfTimeline'))event.stopPropagation();});
  let videoClickTimer=null;
  feed.addEventListener('click',event=>{
    if(!event.target.matches?.('video.feedVideo'))return;
    if(event.detail>=2){clearTimeout(videoClickTimer);videoClickTimer=null;return;}
    const video=event.target;
    clearTimeout(videoClickTimer);
    videoClickTimer=setTimeout(()=>{if(!video.isConnected)return;if(video.paused)video.play().catch(()=>{});else video.pause();},240);
  });
  feed.addEventListener('dblclick',event=>{
    if(!event.target.matches?.('video.feedVideo'))return;
    clearTimeout(videoClickTimer);videoClickTimer=null;
    const video=event.target;
    event.preventDefault();event.stopPropagation();
    if(document.fullscreenElement===video){document.exitFullscreen?.().catch(()=>{});return;}
    if(document.fullscreenElement)return;
    video.controls=true;
    video.requestFullscreen?.().catch(()=>{video.controls=false;unifiedToast('浏览器拒绝全屏');});
  });

  feed.addEventListener('input',event=>{
    const seek=event.target.closest('.jfVideoSeek'),volume=event.target.closest('.jfTimelineVolume');
    const video=event.target.closest('.videoStage')?.querySelector('video.feedVideo');if(!video)return;
    if(seek&&Number.isFinite(video.duration)&&video.duration>0){
      video.currentTime=Math.max(0,Math.min(video.duration,Number(seek.value)/1000*video.duration));
      jfTimelineUpdate(video);
    }else if(volume){video.volume=Number(volume.value);video.muted=video.volume===0;jfTimelineUpdate(video);}
  });
  for(const type of ['timeupdate','seeked','durationchange','loadedmetadata','play','pause','volumechange','ratechange']){
    feed.addEventListener(type,event=>{
      if(!event.target.matches?.('video.feedVideo'))return;
      jfTimelineUpdate(event.target);
    },true);
  }
  document.addEventListener('fullscreenchange',()=>{
    document.querySelectorAll('#feedScroller video.feedVideo').forEach(video=>{
      video.controls=document.fullscreenElement===video;
      jfTimelineUpdate(video);
    });
  },true);
  // Hover/focus can open a named popover without blocking time seek or dragging.
  document.addEventListener('pointerover',event=>{
    const mark=event.target.closest?.('.jfAnnotationPoint,.jfAnnotationSpan');
    if(mark&&mark.dataset.annotationId)jfPopoverOpen(mark.dataset.annotationId,mark);
  },true);
  document.addEventListener('focusin',event=>{
    const mark=event.target.closest?.('.jfAnnotationPoint,.jfAnnotationSpan');
    if(mark)jfPopoverOpen(mark.dataset.annotationId,mark);
  });
  document.addEventListener('pointerout',event=>{
    if(event.target.closest?.('.jfAnnotationPoint,.jfAnnotationSpan')&&!event.relatedTarget?.closest?.('#jfMarkPopover'))jfPopoverScheduleHide();
  },true);
  pop.addEventListener('pointerenter',()=>clearTimeout(jfPopoverTimer));
  pop.addEventListener('pointerleave',jfPopoverScheduleHide);
  const nameField=pop.querySelector('.jfMarkPopoverName');
  let nameSaveBusy=false;
  async function savePopoverName(){
    if(nameSaveBusy||!jfPopoverMarkId)return;
    const mark=clipShelfRecords.find(x=>x.id===jfPopoverMarkId);
    if(!mark)return;
    const name=nameField.value.trim();
    if(!name||name===mark.name){if(!name)nameField.value=mark.name;return;}
    nameSaveBusy=true;
    try{
      await clipShelfPost({action:'update',id:mark.id,name,a:mark.a,b:mark.b});
      mark.name=name;
      jfAnnotationRenderAll();if(clipShelfVisible())clipShelfRender();
    }catch(error){nameField.value=mark.name;unifiedToast('自动保存失败：'+error.message);}
    finally{nameSaveBusy=false;}
  }
  nameField.addEventListener('blur',savePopoverName);
  nameField.addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();nameField.blur();}
    if(event.key==='Escape'){event.stopPropagation();nameField.value=clipShelfRecords.find(x=>x.id===jfPopoverMarkId)?.name||nameField.value;nameField.blur();}
  });
  pop.addEventListener('click',async event=>{
    const colorButton=event.target.closest('[data-jf-color]');
    if(colorButton&&jfPopoverMarkId){
      const mark=clipShelfRecords.find(x=>x.id===jfPopoverMarkId);
      if(!mark||colorButton.disabled||jfAnnotationColor(mark)===colorButton.dataset.jfColor)return;
      colorButton.disabled=true;
      try{
        const result=await clipShelfPost({action:'update',id:mark.id,color:colorButton.dataset.jfColor});
        mark.color=result.clip.color;
        pop.querySelectorAll('[data-jf-color]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.jfColor===mark.color)));
        jfAnnotationRenderAll();if(clipShelfVisible())clipShelfRender();
      }catch(error){unifiedToast('标注颜色保存失败：'+error.message);}
      finally{colorButton.disabled=false;}
      return;
    }
    const action=event.target.closest('[data-jf-pop]')?.dataset.jfPop;
    if(!action||!jfPopoverMarkId)return;
    const mark=clipShelfRecords.find(x=>x.id===jfPopoverMarkId);if(!mark)return;
    const button=event.target.closest('button');button.disabled=true;
    try{
      if(action==='copy'){
        await jfAnnotationClipboard(jfAnnotationCopyText(mark));
      }else if(action==='delete'){
        if(!confirm('删除标注「'+mark.name+'」？原文件不会删除。'))return;
        await clipShelfPost({action:'delete',id:mark.id});
        clipShelfRecords=clipShelfRecords.filter(x=>x.id!==mark.id);jfPopoverHide();jfAnnotationRenderAll();
        if(clipShelfVisible())clipShelfRender();
      }
    }catch(error){unifiedToast('标注操作失败：'+error.message);}
    finally{button.disabled=false;}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!pop.hidden)jfPopoverHide();});
  document.querySelector('#feedClose').addEventListener('click',jfPopoverHide);
}
