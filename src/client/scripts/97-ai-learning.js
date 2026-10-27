// Just Fun v6.38 — AI notes drawer, linked seeking and local JSON import.
(function jfAiLearningInit(){
  const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 1 4 17.5Z"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8M8 11h6"/></svg>';
  const drawer=document.createElement('aside');drawer.id='jfAiLearningDrawer';drawer.hidden=true;drawer.setAttribute('role','complementary');drawer.setAttribute('aria-label','AI 学习笔记');
  drawer.innerHTML='<header class="jfLearnHeader"><div><strong>AI 学习笔记</strong><span class="jfLearnSource"></span></div><button type="button" class="jfLearnClose" aria-label="关闭笔记面板">×</button></header>'+
    '<nav class="jfLearnTabs" role="tablist" aria-label="AI 资料类型"><button type="button" data-tab="transcript" role="tab" aria-selected="true">文字校订</button><button type="button" data-tab="notes" role="tab" aria-selected="false">时间笔记</button><button type="button" data-tab="outline" role="tab" aria-selected="false">大纲与解读</button></nav>'+
    '<div class="jfLearnToolbar"><button type="button" class="jfTransRegenerate">重新生成</button><button type="button" class="jfTransAnalyze">AI 分析 ↗</button><input type="file" class="jfLearnInput" accept=".json,application/json" multiple hidden></div>'+
    '<p class="jfLearnStatus" role="status"></p><div class="jfLearnContent" tabindex="0"></div><div class="jfLearnDrop" hidden>松开以导入 JSON</div><button type="button" class="jfLearnResize" title="拖动调整宽度与高度，也可用方向键调整" aria-label="调整笔记窗口大小"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15V4h11M4 4l16 16M9 20h11V9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>';
  document.body.appendChild(drawer);
  let key=null,tab='transcript',result=null,work=false,transcript=null,dirty=false,autoTimer=null,savePromise=null,timePicker=null;
  const q=sel=>drawer.querySelector(sel);
  function status(text,error=false){const el=q('.jfLearnStatus');el.textContent=text;el.classList.toggle('isError',error);}
  function selectedMedia(){
    if(document.querySelector('#feedOverlay.open')){const item=getCurrentFeedItem();if(item?.kind==='video')return item;}
    return allItems.find(x=>x.key===activeAudioKey&&x.kind==='audio')||null;
  }
  function create(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
  function time(ms){let sec=Math.floor(ms/1000),h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return (h?h+':'+String(m).padStart(2,'0')+':':'')+String(m).padStart(h?2:1,'0')+':'+String(s).padStart(2,'0');}
  function close(){closeTimePicker();drawer.hidden=true; if(dirty)saveTranscript().catch(()=>{});}
  function seek(ms){
    const media=allItems.find(x=>x.key===key);if(!media)return;
    jfAnnotationSeek(key,ms/1000,media.kind);
    // Keep notes visible: timecodes are useful while listening and studying.
  }
  function fitEditor(editor){if(!editor?.isConnected)return;editor.style.height='auto';editor.style.height=Math.max(44,editor.scrollHeight+2)+'px';}
  function render(){
    closeTimePicker();
    for(const btn of drawer.querySelectorAll('[data-tab]'))btn.setAttribute('aria-selected',String(btn.dataset.tab===tab));
    q('.jfLearnToolbar').hidden=tab!=='transcript';
    q('.jfTransRegenerate').disabled=!transcript?.segments?.length||transcript?.complete===false;
    q('.jfTransAnalyze').disabled=!transcript?.segments?.length||transcript?.complete===false;
    const area=q('.jfLearnContent');area.replaceChildren();
    if(tab==='transcript'){
      if(!transcript?.segments?.length){area.appendChild(create('p','jfLearnEmpty','还没有识别初稿。在音视频播放器点击「智能转写」，直接提交整段音轨。'));return;}
      area.appendChild(create('p','jfTransGuide',transcript.complete===false?'仍有音频尚未识别完成，请返回转写页面继续任务。':'自动保存修改 · 点击时间复听，点击铅笔调整区间'));
      transcript.segments.forEach((row,index)=>{
        const card=create('section','jfLearnEntry jfTransEntry');
        const editor=create('textarea','jfTransRowEdit');editor.value=row.text;editor.dataset.row=String(index);editor.rows=1;editor.disabled=transcript.complete===false;editor.setAttribute('aria-label',time(row.startMs)+' 的语音文本');card.appendChild(editor);
        const timeline=create('div','jfTransTimeActions');
        const jump=create('button','jfLearnJump jfTransJump',time(row.startMs)+'–'+time(row.endMs));jump.type='button';jump.title='从 '+time(row.startMs)+' 播放';jump.addEventListener('click',()=>seek(row.startMs));timeline.appendChild(jump);
        const edit=create('button','jfTransTimeEdit');edit.type='button';edit.dataset.row=String(index);edit.title='调整本段开始与结束时间';edit.setAttribute('aria-label','修改第 '+(index+1)+' 段时间范围');
        edit.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4.7-1.1L20 7.5a2.1 2.1 0 0 0-3-3L5.6 15.9 4 20Z"/></svg>';
        edit.disabled=transcript.complete===false;edit.addEventListener('click',()=>openTimePicker(index,edit));timeline.appendChild(edit);card.appendChild(timeline);area.appendChild(card);
        requestAnimationFrame(()=>fitEditor(editor));
      });return;
    }

    const collection=result?.[tab],rows=tab==='notes'?collection?.segments:collection?.chapters;
    if(!rows?.length){area.appendChild(create('p','jfLearnEmpty','还没有'+(tab==='notes'?'时间笔记':'大纲与解读')+'。可以下载 ChatGPT 生成的 JSON，然后点「检查下载结果」，或将文件拖入这里。'));return;}
    rows.forEach(row=>{
      const card=create('section','jfLearnEntry');
      const heading=create('button','jfLearnJump');heading.type='button';heading.title='跳转到 '+time(row.startMs);
      heading.append(create('span','jfLearnTime',time(row.startMs)),create('strong','jfLearnTitle',row.title||'未命名内容'));
      heading.addEventListener('click',()=>seek(row.startMs));card.appendChild(heading);
      if(tab==='notes'){
        if(row.note)card.appendChild(create('p','jfLearnNote',row.note));
        if(row.quote)card.appendChild(create('blockquote','jfLearnQuote',row.quote));
      }else{
        if(row.speakerPoints?.length){card.appendChild(create('div','jfLearnSubhead','讲者观点'));for(const p of row.speakerPoints)card.appendChild(create('p','jfLearnNote',p));}
        if(row.analysis?.length){card.appendChild(create('div','jfLearnSubhead','AI 解读 · 非讲者原话'));for(const p of row.analysis)card.appendChild(create('p','jfLearnAnalysis',p));}
      }
      area.appendChild(card);
    });
  }
  // Seconds-precision range picker; drop-downs prevent arbitrary input.
  // The save endpoint independently validates and strictly merges overlapping intervals.
  function closeTimePicker(){
    if(!timePicker)return;
    const view=timePicker;timePicker=null;
    view.cleanup?.();view.element.remove();
  }
  function mergeTranscriptRanges(rows){
    const sorted=rows.map((row,i)=>({...row,_order:i})).sort((a,b)=>a.startMs-b.startMs||a._order-b._order),out=[];
    for(const row of sorted){
      const prev=out[out.length-1];
      if(prev&&row.startMs<prev.endMs){
        prev.endMs=Math.max(prev.endMs,row.endMs);
        if(row.text)prev.text+=(prev.text?'\n\n':'')+row.text;
      }else out.push({startMs:row.startMs,endMs:row.endMs,text:row.text});
    }
    return out;
  }
  async function openTimePicker(index,button){
    if(timePicker)closeTimePicker();
    if(!transcript||transcript.complete===false||!transcript.segments[index])return;
    try{if(dirty)await saveTranscript();}catch{return;}
    if(!transcript?.segments[index]||drawer.hidden||tab!=='transcript')return;
    const row=transcript.segments[index],maxSec=Math.ceil(transcript.durationMs/1000);
    const panel=create('section','jfTransTimePicker');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','时间范围选择器');
    panel.appendChild(create('div','jfTransPickerTitle','调整时间范围'));
    const columns=create('div','jfTransPickerColumns');panel.appendChild(columns);
    const state={start:Math.floor(row.startMs/1000),end:Math.ceil(row.endMs/1000)};
    state.end=Math.min(maxSec,Math.max(state.start+1,state.end));
    const groups={};
    function formatParts(sec){return [Math.floor(sec/3600),Math.floor(sec%3600/60),sec%60];}
    // Self-rendered stepper: avoids native <select> popups escaping the dialog on Windows.
    function selector(type,unit,values,current){
      const field=create('div','jfTransTimeSelect');field.tabIndex=0;
      const label=(type==='start'?'开始':'结束')+'时间'+['小时','分钟','秒'][unit];
      field.setAttribute('role','spinbutton');field.setAttribute('aria-label',label);
      field.setAttribute('aria-valuemin','0');field.setAttribute('aria-valuemax',String(values-1));
      const minus=create('button','jfTransSpinMinus','−'),number=create('span','jfTransSpinNumber',String(current).padStart(2,'0')),plus=create('button','jfTransSpinPlus','+');
      minus.type='button';plus.type='button';minus.setAttribute('aria-label',label+'减少');plus.setAttribute('aria-label',label+'增加');
      let value=current;
      function set(n){value=(n+values)%values;number.textContent=String(value).padStart(2,'0');field.setAttribute('aria-valuenow',String(value));field.dispatchEvent(new Event('change',{bubbles:true}));}
      Object.defineProperty(field,'value',{get:()=>String(value),set:n=>{const val=Number(n);if(Number.isInteger(val)&&val>=0&&val<values)set(val);}});
      minus.addEventListener('click',()=>set(value-1));plus.addEventListener('click',()=>set(value+1));
      field.addEventListener('keydown',event=>{const dir=event.key==='ArrowUp'?1:event.key==='ArrowDown'?-1:0;if(dir){event.preventDefault();set(value+dir);}});
      field.addEventListener('wheel',event=>{event.preventDefault();set(value+(event.deltaY<0?1:-1));},{passive:false});
      field.append(plus,number,minus);field.setAttribute('aria-valuenow',String(value));return field;
    }
    for(const [type,heading] of [['start','开始'],['end','结束']]){
      const group=create('div','jfTransPickerGroup');group.appendChild(create('span','jfTransPickerLabel',heading));
      const fields=create('div','jfTransPickerFields'),parts=formatParts(state[type]);
      groups[type]=[selector(type,0,Math.floor(maxSec/3600)+1,parts[0]),selector(type,1,60,parts[1]),selector(type,2,60,parts[2])];
      groups[type].forEach((select,i)=>{fields.appendChild(select);if(i<2)fields.appendChild(create('span','jfTransPickerColon',':'));});
      group.appendChild(fields);columns.appendChild(group);
    }
    const warning=create('p','jfTransPickerError');warning.setAttribute('role','status');panel.appendChild(warning);
    const actions=create('div','jfTransPickerActions'),cancel=create('button','jfTransPickerCancel','取消'),apply=create('button','jfTransPickerApply','应用时间');
    cancel.type='button';apply.type='button';actions.append(cancel,apply);panel.appendChild(actions);
    const getSec=type=>groups[type].reduce((v,el,i)=>v+Number(el.value)*[3600,60,1][i],0);
    function update(){
      state.start=getSec('start');state.end=getSec('end');
      const valid=state.start>=0&&state.start<state.end&&state.end<=maxSec;
      warning.textContent=valid?'重叠区间将自动合并，首尾相接不会合并。':state.start>=state.end?'开始时间必须早于结束时间。':'时间不能超出音轨长度。';
      warning.classList.toggle('isError',!valid);apply.disabled=!valid;return valid;
    }
    Object.values(groups).flat().forEach(el=>el.addEventListener('change',update));update();
    const rect=button.getBoundingClientRect();
    document.body.appendChild(panel);const w=panel.offsetWidth||315,h=panel.offsetHeight||230;
    panel.style.left=Math.max(8,Math.min(window.innerWidth-w-8,rect.right-w))+'px';
    panel.style.top=(rect.bottom+h+8<window.innerHeight?rect.bottom+5:Math.max(8,rect.top-h-5))+'px';
    let busy=false;
    cancel.addEventListener('click',closeTimePicker);
    apply.addEventListener('click',async()=>{
      if(busy||!update())return;busy=true;apply.disabled=true;
      try{
        // Resolve any pending text autosave before calculating the revision.
        if(dirty)await saveTranscript();
        if(!transcript||key===null||!transcript.segments[index])throw Error('文字稿已变更，请重新打开时间选择器');
        const duration=transcript.durationMs;
        const next=transcript.segments.map((r,i)=>i===index?{...r,startMs:state.start*1000,endMs:Math.min(duration,state.end*1000)}:{...r});
        const merged=mergeTranscriptRanges(next);
        if(merged.some(r=>r.text.length>65536))throw Error('合并后文字过长，请缩小时间范围');
        const res=await api('/api/ai-transcript/save','POST',{key,segments:merged,revision:transcript.revision,confirm:false});
        transcript=res.data;dirty=false;closeTimePicker();render();
        status(merged.length<next.length?'时间已调整 · 重叠段落及文字已合并':'时间范围已更新 · 自动保存完成');
      }catch(e){warning.textContent='保存失败：'+e.message;warning.classList.add('isError');}
      finally{busy=false;if(timePicker?.element===panel)update();}
    });
    const outside=e=>{if(!panel.contains(e.target)&&e.target!==button)closeTimePicker();};
    const keyboard=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();e.preventDefault();closeTimePicker();button.focus();}};
    const scroll=e=>{if(!panel.contains(e.target))closeTimePicker();};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keyboard,true);
    q('.jfLearnContent').addEventListener('scroll',scroll,{passive:true});
    timePicker={element:panel,cleanup:()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keyboard,true);q('.jfLearnContent').removeEventListener('scroll',scroll);}};
    groups.start[2].focus();
  }
  async function api(url,method,body){
    const resp=await fetch(url,{method:method||'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const result=await resp.json();if(!resp.ok||!result.ok)throw Error(result.error||'读取失败');return result;
  }
  async function reload(){if(!key)return;const res=await api('/api/ai-learning?key='+encodeURIComponent(key));result=res.data||null;render();}
  async function discover(silent=false){
    if(work||!key)return;work=true;const discoverButton=q('.jfLearnDiscover');if(discoverButton)discoverButton.disabled=true;
    if(!silent)status('正在检查下载目录…');
    try{
      const res=await api('/api/ai-learning/discover','POST',{key});
      if(res.found?.length){await reload();status(res.result?.skipped?'资料已存在；自动回收不会覆盖手动导入的版本。':'已导入：'+res.found.map(x=>x==='notes'?'时间笔记':'大纲与解读').join('、'));}
      else if(!silent)status('未找到带有当前媒体标识的结果。请拖入 JSON 文件，或让 ChatGPT 按最新 Prompt 重新生成。');
    }catch(e){if(!silent)status(e.message,true);}finally{work=false;if(discoverButton)discoverButton.disabled=false;}
  }
  async function open(mediaKey,requestedTab){
    const item=allItems.find(x=>x.key===mediaKey&&['audio','video'].includes(x.kind));if(!item)return;
    closeTimePicker();key=item.key;result=null;transcript=null;dirty=false;clearTimeout(autoTimer);tab=requestedTab==='notes'||requestedTab==='outline'?requestedTab:'transcript';drawer.hidden=false;
    q('.jfLearnSource').textContent=item.displayName||item.title||item.originalName||'';
    status('');render();try{const record=await api('/api/ai-transcript?key='+encodeURIComponent(key));transcript=record.data;render();await reload();await discover(true);}catch(e){status(e.message,true);}
  }
  // Autosave is the only editing state. Never require an extra approval to use the transcript.
  async function saveTranscript(){
    if(!transcript?.segments?.length||transcript.complete===false)return false;
    if(savePromise){await savePromise;if(dirty)return saveTranscript();return true;}
    if(!dirty)return true;
    clearTimeout(autoTimer);
    const snapshot=JSON.stringify(transcript.segments),activeKey=key,revision=transcript.revision;
    savePromise=(async()=>{
      const data=await api('/api/ai-transcript/save','POST',{key:activeKey,segments:JSON.parse(snapshot),revision,confirm:false});
      if(activeKey!==key||!transcript)return;
      transcript.revision=data.data.revision;
      dirty=JSON.stringify(transcript.segments)!==snapshot;
      if(!dirty)status('已自动保存');
    })();
    try{await savePromise;}catch(e){status('保存失败：'+e.message,true);throw e;}
    finally{savePromise=null;}
    if(dirty)return saveTranscript();
    return true;
  }
  function analysisMarkdown(){
    const media=allItems.find(x=>x.key===key);
    const filename=media?.displayName||media?.title||media?.originalName||'未命名课程';
    const lines=[
      '# Just Fun · 课程分析任务',
      '',
      '## 任务说明',
      '你是一名严谨的中文课程分析助手。下文是我人工校订过的语音识别文字稿，可能仍有方言、同音字和古文术语错误。',
      '请以这份文字稿为唯一课程内容依据，不要声称听过原始音频，不得补写不存在的课程观点。',
      '保留说话人的论证与术语；识别疑似错别字时标注【待核实】并给出依据，而非擅自改写。',
      '明确区分【讲者原意】与【AI 补充解读】，后者可以结合通行知识解释，但不得冒充原话。',
      '',
      '## 需要的成果',
      '1. 先概述课程结构、核心概念、争议与值得复听的时间点。',
      '2. 生成 `notes.json`（时间笔记）和 `outline.json`（大纲与解读），作为两个独立、可下载的 UTF-8 JSON 文件。',
      '3. 文件严格符合以下结构；时间均为原媒体绝对毫秒，不能由文字内容臆造新时间码。',
      '4. 如文件生成能力不可用，明确说明并输出合法完整 JSON，不得声称已生成文件。',
      '',
      '时间笔记示例结构：',
      '```json',
      '{"version":1,"sourceKey":"'+key+'","durationMs":'+Math.round(transcript.durationMs)+',"segments":[{"startMs":1000,"endMs":5000,"title":"示例标题","note":"讲者要点","quote":"可选的原话"}]}',
      '```',
      '大纲解读示例结构：',
      '```json',
      '{"version":1,"sourceKey":"'+key+'","durationMs":'+Math.round(transcript.durationMs)+',"chapters":[{"startMs":1000,"endMs":5000,"title":"章节名称","speakerPoints":["讲者观点"],"analysis":["AI 解读（需明确并非讲者原话）"]}]}',
      '```',
      '以上时间码仅为结构示例，实际生成必须从下文逐字稿内已提供的区间选择，且排序、时长和媒体标识必须正确。',
      '建议按主题合并邻近的句段；每个条目需有可追溯的真实起止时间，避免输出冗余碎片。',
      '完成后我会把 JSON 导入 Just Fun，因此请保证 `sourceKey` 与 `durationMs` 原样保留。',
      '',
      '## 媒体信息',
      '- 名称：'+String(filename).replace(/[\r\n]/g,' '),
      '- sourceKey：`'+key+'`',
      '- durationMs：`'+Math.round(transcript.durationMs)+'`',
      '- 时间码单位：原媒体绝对时间（非 MP3 分片相对时间）',
      '',
      '## 人工校订文字稿',
      ''
    ];
    for(const seg of transcript.segments){
      // Preserve the user text verbatim; use separate timecode lines to prevent Markdown injections
      // from masquerading as task instructions by clearly delimiting untrusted transcription data.
      lines.push('**['+time(seg.startMs)+' → '+time(seg.endMs)+']**');
      lines.push('```text');
      lines.push(String(seg.text).replace(/```/g,'` ` `'));
      lines.push('```','');
    }
    return lines.join('\n');
  }
  async function analyze(){
    if(!transcript?.segments?.length||transcript.complete===false){status('请先完成转写。',true);return;}
    // Reserve the new tab during the user click. Async save would otherwise trigger popup blocking.
    const chat=window.open('about:blank','_blank');
    if(chat){try{chat.opener=null;chat.document.title='Just Fun · 正在准备 AI 分析';}catch{}}
    try{
      await saveTranscript();
      const content=analysisMarkdown();
      const blob=new Blob(['\ufeff'+content],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download='JustFun-AI分析-'+key+'.md';document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      if(chat&&!chat.closed)chat.location.replace('https://chatgpt.com/');
      status('已导出含完整校订文字稿和分析要求的 MD；在新开的 ChatGPT 中上传该文件即可。'+(!chat?'（浏览器阻止了新窗口，请手动打开 chatgpt.com）':''));
    }catch(e){if(chat&&!chat.closed)chat.close();status('AI 分析准备失败：'+e.message,true);}
  }
  function regenerate(){
    if(!transcript?.segments?.length)return;
    if(!window.confirm('重新生成会再次调用千问付费语音识别，并在成功后替换当前文字稿。旧稿会在本机备份。确定继续吗？'))return;
    clearTimeout(autoTimer);
    if(dirty){status('正在保存现有修改…');saveTranscript().then(()=>{
      drawer.hidden=true;if(typeof window.jfAiAudioRegenerate==='function')window.jfAiAudioRegenerate(key);
      else status('转写入口暂不可用，请重新打开媒体播放器。',true);
    }).catch(()=>{});return;}
    drawer.hidden=true;
    if(typeof window.jfAiAudioRegenerate==='function')window.jfAiAudioRegenerate(key);
    else{drawer.hidden=false;status('转写入口暂不可用，请重新打开媒体播放器。',true);}
  }
  async function importFiles(files){
    if(work||!key)return;const matched=Array.from(files||[]).filter(f=>/^(notes|outline)(?: \(\d+\))?\.json$/i.test(f.name));
    if(!matched.length){status('请选择 notes.json 和/或 outline.json',true);return;}
    work=true;const changes={};
    try{
      for(const f of matched){if(f.size>700*1024)throw Error(f.name+' 超过 700KB');
        const kind=f.name.toLowerCase().startsWith('notes')?'notes':'outline';
        const data=JSON.parse((await f.text()).replace(/^\ufeff/,''));
        if(data.sourceKey!==undefined&&data.sourceKey!==key)throw Error(f.name+' 属于其他媒体');
        changes[kind]=data;
      }
      const res=await api('/api/ai-learning/import','POST',{key,...changes});await reload();status('导入成功 · '+res.result.notes+' 条笔记，'+res.result.outline+' 个章节');
    }catch(e){status('导入失败：'+e.message,true);}finally{work=false;q('.jfLearnInput').value='';}
  }
  function attach(){
    document.querySelectorAll('.feedItem .jfTimeline').forEach(t=>{
      if(t.querySelector('.jfLearnLaunch'))return;
      const btn=create('button','jfLearnLaunch jfLearnVideo');btn.type='button';btn.title='AI 学习笔记';btn.setAttribute('aria-label','打开 AI 学习笔记');btn.innerHTML=icon;
      const ref=t.querySelector('.jfAiLaunch,.jfTimelineRate');if(ref)ref.before(btn);else t.append(btn);
    });
    const header=document.querySelector('#audioDock .audioDockHeaderActions');
    if(header&&!header.querySelector('.jfLearnLaunch')){
      const btn=create('button','jfLearnLaunch jfLearnAudio');btn.type='button';btn.title='AI 学习笔记';btn.setAttribute('aria-label','打开 AI 学习笔记');btn.innerHTML=icon;
      header.prepend(btn);
    }
  }
  let scheduled=false;function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;attach();});}
  const feed=document.querySelector('#feedScroller'),audio=document.querySelector('#audioDock');
  if(feed)new MutationObserver(schedule).observe(feed,{subtree:true,childList:true});
  if(audio)new MutationObserver(schedule).observe(audio,{subtree:true,childList:true});schedule();
  document.addEventListener('click',e=>{
    const trigger=e.target.closest?.('.jfLearnLaunch');if(!trigger)return;
    e.preventDefault();e.stopImmediatePropagation();
    const current=trigger.closest('.feedItem')?.dataset.key||activeAudioKey;open(current);
  },true);
  q('.jfLearnClose').addEventListener('click',close);
  q('.jfLearnInput').addEventListener('change',e=>importFiles(e.target.files));
  drawer.querySelector('.jfLearnTabs').addEventListener('click',async e=>{const target=e.target.closest('[data-tab]');if(target){try{if(dirty)await saveTranscript();tab=target.dataset.tab;render();}catch{}}});
  q('.jfLearnContent').addEventListener('input',e=>{
    if(!e.target.matches('.jfTransRowEdit')||!transcript)return;
    const row=Number(e.target.dataset.row);if(!Number.isInteger(row)||!transcript.segments[row])return;
    transcript.segments[row].text=e.target.value;transcript.confirmed=false;dirty=true;
    fitEditor(e.target);status('编辑中 · 自动保存');
    clearTimeout(autoTimer);autoTimer=setTimeout(()=>saveTranscript(false),1300);
  });
  q('.jfTransRegenerate').addEventListener('click',regenerate);
  q('.jfTransAnalyze').addEventListener('click',analyze);

  drawer.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files')){e.preventDefault();q('.jfLearnDrop').hidden=false;}});
  drawer.addEventListener('dragleave',e=>{if(!drawer.contains(e.relatedTarget))q('.jfLearnDrop').hidden=true;});
  drawer.addEventListener('drop',e=>{e.preventDefault();q('.jfLearnDrop').hidden=true;importFiles(e.dataTransfer.files);});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!drawer.hidden){e.preventDefault();e.stopImmediatePropagation();close();}
  },true);
  // Resizable north-west handle: right/bottom anchoring keeps the player visible.
  const sizeKey='jf-ai-learning-size-v642';
  function bounds(){return {w:Math.max(300,innerWidth-28),h:Math.max(240,innerHeight-28)};}
  function setSize(w,h){const b=bounds();drawer.style.width=Math.min(b.w,Math.max(Math.min(380,b.w),w))+'px';drawer.style.height=Math.min(b.h,Math.max(Math.min(320,b.h),h))+'px';}
  try{const saved=JSON.parse(localStorage.getItem(sizeKey));if(saved&&Number.isFinite(saved.w)&&Number.isFinite(saved.h))setSize(saved.w,saved.h);}catch{}
  let resizeAt=null;
  q('.jfLearnResize').addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    resizeAt={x:e.clientX,y:e.clientY,w:drawer.getBoundingClientRect().width,h:drawer.getBoundingClientRect().height};
    e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();
  });
  q('.jfLearnResize').addEventListener('pointermove',e=>{
    if(!resizeAt)return;
    setSize(resizeAt.w+resizeAt.x-e.clientX,resizeAt.h+resizeAt.y-e.clientY);
  });
  function finishResize(){if(!resizeAt)return;resizeAt=null;try{localStorage.setItem(sizeKey,JSON.stringify({w:drawer.getBoundingClientRect().width,h:drawer.getBoundingClientRect().height}));}catch{}}
  q('.jfLearnResize').addEventListener('pointerup',finishResize);
  q('.jfLearnResize').addEventListener('pointercancel',finishResize);
  q('.jfLearnResize').addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();const size=drawer.getBoundingClientRect(),step=e.shiftKey?60:24;
    setSize(size.width+(e.key==='ArrowLeft'?step:e.key==='ArrowRight'?-step:0),size.height+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0));
    finishResize();try{localStorage.setItem(sizeKey,JSON.stringify({w:drawer.getBoundingClientRect().width,h:drawer.getBoundingClientRect().height}));}catch{}
  });
  window.addEventListener('resize',()=>{if(drawer.style.width)setSize(drawer.getBoundingClientRect().width,drawer.getBoundingClientRect().height);});
  // Results downloaded in another tab become discoverable on return, without a third toolbar action.
  window.addEventListener('focus',()=>{if(!drawer.hidden&&key&&tab!=='transcript')discover(true);});
  window.jfAiLearningOpen=open;
})();
