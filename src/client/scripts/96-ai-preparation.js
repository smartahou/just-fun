// Just Fun v6.37 — small, local audio-upload preparation surface.
// Nothing is sent to ChatGPT automatically.
(function jfAiAudioSetup(){
  const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M4 16.5V7.5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3Z"/><path d="M8 13V10m4 6V8m4 5v-3"/></svg>';
  const box=document.createElement('section');
  box.id='jfAiAudioOverlay';box.hidden=true;box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','智能转写');
  box.innerHTML='<div class="jfAiAudioPanel"><header><strong>智能转写 · 人工校订</strong><button class="jfAiClose" type="button" aria-label="关闭">×</button></header><p class="jfAiHint">不切片：视频提取完整 MP3 并保存在原视频目录；音频直接使用源文件。确认后才上传千问云端识别。</p><p class="jfAiSelected"></p><div class="jfAiProgress" hidden><div class="jfAiMeter"><i></i></div><span class="jfAiStatus" role="status">准备中</span></div><div class="jfAiResult" hidden><p class="jfAiFolder"></p><p class="jfAiParts"></p><p class="jfAiClipboard"></p></div><div class="jfAsrSetup" hidden><p>首次使用千问长音频识别，请输入 API Key。密钥仅保存在你自己的电脑；Windows 使用用户级加密保护。</p><input class="jfAsrSecret" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴千问平台 API Key" aria-label="千问 API Key"><div class="jfAsrKeyActions"><button type="button" class="jfAsrKeySave">保存并继续识别</button><button type="button" class="jfAsrKeyCancel">取消</button></div></div><div class="jfAsrControls" hidden><label>专业术语（可选，逗号分隔）<input class="jfAsrTerms" type="text" value="周易参同契,魏伯阳,坎离,铅汞,龙虎" maxlength="600"></label><p class="jfAsrDisclosure">点击开始后会将完整音轨上传至千问临时存储进行付费识别；云端临时文件约 48 小时后清理。未经点击不会上传。</p><p class="jfAsrStatus" role="status"></p></div><div class="jfAiActions"><button class="jfAiStart" type="button">开始转写 · 整段上传</button><button class="jfAiTranscribe" type="button" hidden>继续云端转写</button><button class="jfAsrKeyManage" type="button" hidden>管理密钥</button><button class="jfAiCopy" type="button" hidden>复制 Prompt</button><button class="jfAiOpen" type="button" hidden>打开导出文件夹</button><button class="jfAiChat" type="button" hidden>打开 ChatGPT</button><button class="jfAiReadNotes" type="button" hidden>查看 AI 笔记</button></div></div>';
  document.body.appendChild(box);
  let selectedKey=null,currentJob=null,latestPrompt='',pollTimer=null,asrPollTimer=null,asrJob=null,autoCloud=false,regenerateNext=false;
  const el=sel=>box.querySelector(sel);
  function resetTimer(){if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}}
  function close(){box.hidden=true;} // Jobs keep running if dialog is dismissed.
  async function jsonFetch(url,method,data){
    const resp=await fetch(url,{method:method||'GET',cache:'no-store',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
    const parsed=await resp.json();if(!resp.ok||!parsed.ok)throw Error(parsed.error||'处理失败');return parsed;
  }
  function show(key){
    const item=allItems.find(i=>i.key===key&&['audio','video'].includes(i.kind));if(!item)return;
    if(currentJob&&!latestPrompt&&pollTimer){box.hidden=false;return;}
    selectedKey=key;currentJob=null;latestPrompt='';autoCloud=false;regenerateNext=false;resetTimer();
    el('.jfAiSelected').textContent=item.displayName||item.title||item.originalName||'当前媒体';
    el('.jfAiProgress').hidden=true;el('.jfAiResult').hidden=true;
    el('.jfAiStart').hidden=false;el('.jfAiStart').disabled=false;
    el('.jfAiCopy').hidden=true;el('.jfAiOpen').hidden=true;el('.jfAiChat').hidden=true;el('.jfAiReadNotes').hidden=true;
    el('.jfAiTranscribe').hidden=true;el('.jfAsrKeyManage').hidden=true;el('.jfAsrSetup').hidden=true;el('.jfAsrControls').hidden=true;
    box.hidden=false;
  }
  function attachButtons(){
    document.querySelectorAll('.feedItem .jfTimeline').forEach(timeline=>{
      if(timeline.querySelector('.jfAiLaunch'))return;
      const b=document.createElement('button');b.type='button';b.className='jfAiLaunch jfAiVideoLaunch';
      b.title='导出轻量音频用于 AI 笔记';b.setAttribute('aria-label','导出 AI 音频');b.innerHTML=icon;
      const ref=timeline.querySelector('.jfTimelineRate,.jfTimelineFullscreen');
      if(ref)ref.before(b);else timeline.appendChild(b);
    });
    const header=document.querySelector('#audioDock .audioDockHeaderActions');
    if(header&&!header.querySelector('.jfAiLaunch')){
      const b=document.createElement('button');b.type='button';b.className='jfAiLaunch jfAiAudioLaunch';
      b.title='准备音频给 AI';b.setAttribute('aria-label','导出 AI 音频');b.innerHTML=icon;
      header.prepend(b);
    }
  }
  const feed=document.querySelector('#feedScroller'),audioDock=document.querySelector('#audioDock');
  let queued=false;
  function scheduleAttach(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;attachButtons();});}
  if(feed)new MutationObserver(scheduleAttach).observe(feed,{childList:true,subtree:true});
  if(audioDock)new MutationObserver(scheduleAttach).observe(audioDock,{childList:true,subtree:true});
  scheduleAttach();
  document.addEventListener('click',e=>{
    const launch=e.target.closest?.('.jfAiLaunch');if(!launch)return;
    e.preventDefault();e.stopImmediatePropagation();
    const item=launch.closest('.feedItem');const key=item?.dataset.key||activeAudioKey;
    show(key);
  },true);
  async function startCloud(){
    if(!currentJob||!selectedKey)throw Error('请先导出音轨');
    el('.jfAiTranscribe').disabled=true;el('.jfAsrStatus').textContent='提交转写任务…';
    try{
      const task=await jsonFetch('/api/ai-transcript/start','POST',{key:selectedKey,exportId:currentJob,vocabulary:el('.jfAsrTerms').value,regenerate:regenerateNext});
      asrJob=task.id;regenerateNext=false;
      if(asrPollTimer)clearInterval(asrPollTimer);
      async function poll(){
        try{
          const state=await jsonFetch('/api/ai-transcript/job?id='+encodeURIComponent(asrJob));
          el('.jfAsrStatus').textContent=state.label+(state.total?' · '+state.current+'/'+state.total:'');
          if(state.status!=='running'){
            clearInterval(asrPollTimer);asrPollTimer=null;el('.jfAiTranscribe').disabled=false;
            if(state.status==='done'){
              el('.jfAiTranscribe').hidden=true;
              el('.jfAiReadNotes').textContent='打开文字校订';
              if(!box.hidden&&typeof window.jfAiLearningOpen==='function'){close();window.jfAiLearningOpen(selectedKey,'transcript');}
            }
          }
        }catch(err){clearInterval(asrPollTimer);asrPollTimer=null;el('.jfAiTranscribe').disabled=false;el('.jfAsrStatus').textContent=err.message;}
      }
      asrPollTimer=setInterval(poll,2200);await poll();
    }catch(e){el('.jfAiTranscribe').disabled=false;el('.jfAsrStatus').textContent=e.message;}
  }
  async function requestTranscribe(){
    try{
      const state=await jsonFetch('/api/ai-transcript/key');
      if(!state.configured){el('.jfAsrSetup').hidden=false;el('.jfAsrSecret').focus();return;}
      await startCloud();
    }catch(e){el('.jfAsrStatus').textContent=e.message;}
  }
  box.addEventListener('click',async e=>{
    if(e.target===box||e.target.closest('.jfAiClose')){close();return;}
    if(e.target.closest('.jfAiTranscribe')){await requestTranscribe();
    }else if(e.target.closest('.jfAsrKeySave')){
      const key=el('.jfAsrSecret').value;
      try{await jsonFetch('/api/ai-transcript/key','POST',{key});el('.jfAsrSecret').value='';el('.jfAsrSetup').hidden=true;await startCloud();}
      catch(error){el('.jfAsrStatus').textContent=error.message;}
    }else if(e.target.closest('.jfAsrKeyCancel')){
      el('.jfAsrSecret').value='';el('.jfAsrSetup').hidden=true;
    }else if(e.target.closest('.jfAsrKeyManage')){
      const state=await jsonFetch('/api/ai-transcript/key').catch(()=>({configured:false}));
      if(state.configured){
        const remove=window.confirm('是否删除本机保存的千问 API Key？取消则可以直接更换密钥。');
        if(remove){try{await jsonFetch('/api/ai-transcript/key','DELETE');el('.jfAsrStatus').textContent='本机密钥已删除';}catch(error){el('.jfAsrStatus').textContent=error.message;}}
        else{el('.jfAsrSetup').hidden=false;el('.jfAsrSecret').focus();}
      }else{el('.jfAsrSetup').hidden=false;el('.jfAsrSecret').focus();}
    }else if(e.target.closest('.jfAiStart')){
      autoCloud=true;el('.jfAsrControls').hidden=false;
      el('.jfAiStart').disabled=true;el('.jfAiProgress').hidden=false;
      el('.jfAiStatus').textContent='分析音轨…';el('.jfAiMeter i').style.width='1%';
      try{
        const job=await jsonFetch('/api/ai-audio-export','POST',{key:selectedKey});currentJob=job.id;
        async function poll(){
          try{
            const state=await jsonFetch('/api/ai-audio-export?id='+encodeURIComponent(job.id));
            el('.jfAiStatus').textContent=state.label||'处理中';
            el('.jfAiMeter i').style.width=(state.percent||1)+'%';
            if(state.status==='done'){
              resetTimer();latestPrompt=state.prompt;el('.jfAiStart').hidden=true;
              el('.jfAiMeter i').style.width='100%';
              el('.jfAiResult').hidden=false;
              el('.jfAiFolder').textContent='导出位置：'+state.directory;
              el('.jfAiParts').textContent='完整音轨 · 不切片 · 仅 1 个音频文件';
              el('.jfAiClipboard').textContent='音轨已准备完成。';
              el('.jfAiCopy').hidden=true;el('.jfAiOpen').hidden=false;el('.jfAiChat').hidden=true;el('.jfAiReadNotes').hidden=false;
              el('.jfAiTranscribe').hidden=false;el('.jfAsrKeyManage').hidden=false;el('.jfAsrControls').hidden=false;
              if(autoCloud){autoCloud=false;await requestTranscribe();}
            }else if(state.status==='error'){
              resetTimer();autoCloud=false;el('.jfAiStart').hidden=false;el('.jfAiStart').disabled=false;
              el('.jfAiStatus').textContent='处理失败：'+state.label;
            }
          }catch(error){resetTimer();el('.jfAiStart').hidden=false;autoCloud=false;el('.jfAiStart').disabled=false;el('.jfAiStatus').textContent=error.message;}
        }
        await poll();if(pollTimer===null&&!latestPrompt&&el('.jfAiStart').disabled)pollTimer=setInterval(poll,950);
      }catch(error){autoCloud=false;el('.jfAiStart').disabled=false;el('.jfAiStatus').textContent=error.message;}
    }else if(e.target.closest('.jfAiCopy')){
      try{
        if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(latestPrompt);
        else{
          const t=document.createElement('textarea');t.value=latestPrompt;box.appendChild(t);t.select();
          const ok=document.execCommand('copy');t.remove();if(!ok)throw Error('请打开 PROMPT.txt 复制');
        }
        el('.jfAiClipboard').textContent='Prompt 已复制，可以粘贴到 ChatGPT。';
      }catch(error){el('.jfAiClipboard').textContent='剪切板访问失败，请打开导出目录内的 PROMPT.txt 复制。';}
    }else if(e.target.closest('.jfAiOpen')){
      try{await jsonFetch('/api/ai-audio-open','POST',{id:currentJob});}
      catch(error){el('.jfAiClipboard').textContent=error.message;}
    }else if(e.target.closest('.jfAiReadNotes')){
      const key=selectedKey;close();if(key&&typeof window.jfAiLearningOpen==='function')window.jfAiLearningOpen(key,'transcript');
    }else if(e.target.closest('.jfAiChat')){
      window.open('https://chatgpt.com/','_blank','noopener,noreferrer');
    }
  });
  window.jfAiAudioRegenerate=(key)=>{show(key);regenerateNext=true;el('.jfAiStart').click();};
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!box.hidden){e.stopImmediatePropagation();e.preventDefault();close();}
  },true);
})();
