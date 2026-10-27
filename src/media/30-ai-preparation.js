// v6.40 — unsegmented speech recognition preparation. Video sidecar stays beside the video.
// Audio files are uploaded unchanged; never modify the source or overwrite an existing file.
const AI_AUDIO_EXPORT_ROOT = path.join(os.homedir(),'Downloads','JustFun-AI'); // Legacy AI result discovery path only.
const AI_AUDIO_MAX_SECONDS=24*3600;
const aiAudioJobs=new Map();
function aiAudioFilename(value){
  let text=String(value||'课程').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').trim().slice(0,64);
  if(!text||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(text))text='课程';
  return text;
}
function aiAudioTime(seconds){
  const n=Math.max(0,Math.floor(Number(seconds)||0));
  return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,'0')).join(':');
}
function aiAudioProbe(file){
  return new Promise((resolve,reject)=>{
    let child;
    try{child=spawn('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_type:format=duration','-of','json',file],{stdio:['ignore','pipe','pipe'],windowsHide:true});}
    catch(error){reject(error);return;}
    activeMediaChildren.add(child);
    let data='',err='',settled=false;
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{};done(new Error('FFprobe 超时，无法确认音频长度'));},20000);
    function done(error,result){if(settled)return;settled=true;clearTimeout(timer);activeMediaChildren.delete(child);if(error)reject(error);else resolve(result);}
    child.stdout.on('data',buf=>{data+=buf.toString();if(data.length>50000){try{child.kill('SIGKILL');}catch{};done(new Error('媒体信息异常'));}});
    child.stderr.on('data',buf=>{err=(err+buf.toString()).slice(-1000);});
    child.on('error',done);
    child.on('close',code=>{
      if(settled)return;
      if(code!==0){done(new Error('无法识别音轨：'+err));return;}
      try{const result=JSON.parse(data);const duration=Number(result.format?.duration);
        if(!result.streams?.length||!Number.isFinite(duration)||duration<=0||duration>AI_AUDIO_MAX_SECONDS)throw Error('音频长度无效或超过 24 小时');
        done(null,duration);
      }catch(error){done(error);}
    });
  });
}
function aiAudioPrompt(item,parts,duration){
  const title=String(item.displayName||item.originalName||item.title||'课程');
  return `Just Fun 课程《${title}》\n媒体标识：${item.key}\n总时长毫秒：${Math.round(duration*1000)}\n\n请先在 Just Fun 完成语音转写、人工校订与「确认定稿」，然后上传导出的校订文字稿供 AI 分析。不要把音频可解码等同于已识别语音，也不要编造时间码。\n\n请只基于人工确认的真实文字稿生成：\nnotes.json: {"version":1,"sourceKey":"${item.key}","durationMs":${Math.round(duration*1000)},"segments":[{"startMs":0,"endMs":10000,"title":"知识点","note":"真实内容概括"}]}\noutline.json: {"version":1,"sourceKey":"${item.key}","durationMs":${Math.round(duration*1000)},"chapters":[{"startMs":0,"endMs":10000,"title":"章节","speakerPoints":["讲者观点"],"analysis":["AI解读"]]}\n\n原稿中的时间码为原媒体绝对时间，不要虚构毫秒精度。`; 
}
function aiAudioSidecarPath(source,key,stat){
  const ext=path.extname(source),base=path.basename(source,ext).slice(0,100);
  const fingerprint=crypto.createHash('sha256').update(`${stat.size}:${Math.floor(stat.mtimeMs)}:${key}`).digest('hex').slice(0,10);
  return path.join(path.dirname(source),base+'.justfun-audio-'+key+'-'+fingerprint+'.mp3');
}
function aiCopyToWindowsClipboard(text){
  if(process.platform!=='win32')return Promise.resolve(false);
  // PowerShell receives user content only on stdin, never as an executable command.
  // Explicit UTF-8 for Chinese names and punctuation; scripts encoded UTF-16LE by PowerShell convention.
  const command="$ErrorActionPreference='Stop';[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false);$content=[Console]::In.ReadToEnd();Set-Clipboard -Value $content";
  const encoded=Buffer.from(command,'utf16le').toString('base64');
  return new Promise(resolve=>{
    let child;
    try{child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{stdio:['pipe','ignore','ignore'],windowsHide:true});}
    catch{return resolve(false);}
    let settled=false;
    const done=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{};done(false);},7000);
    child.on('error',()=>done(false));child.on('close',code=>done(code===0));
    child.stdin.on('error',()=>done(false));child.stdin.end(Buffer.from(text,'utf8'));
  });
}

async function aiExportAudio(key,id){
  const item=catalog.items.find(x=>x.key===key&&x.state==='ready');
  if(!item||!['video','audio'].includes(itemMediaKind(item)))throw Error('请先选择视频或音频');
  if(!HAS_FFPROBE)throw Error('需要 FFprobe 确认音轨长度');
  const source=managedPath(item),stat=fs.lstatSync(source);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('源文件无效');
  const duration=await aiAudioProbe(source);
  const kind=itemMediaKind(item),job=aiAudioJobs.get(id);
  let output=source,created=false,tmp='';
  try{
    if(kind==='video'||!['.mp3','.m4a','.aac','.wav','.flac','.ogg','.opus','.wma'].includes(path.extname(source).toLowerCase())){
      if(!HAS_FFMPEG)throw Error('提取音轨需要 FFmpeg');
      output=aiAudioSidecarPath(source,key,stat);
      // Reuse a trusted named sidecar without modifying it; an existing invalid
      // file belongs to the user and must never be overwritten.
      let exists=false;
      try{const old=await fs.promises.lstat(output);exists=true;
        if(!old.isFile()||old.isSymbolicLink()||old.size<200||old.mtimeMs<stat.mtimeMs)throw Error('同名音轨已存在但不能安全复用，请检查文件');
        const oldDuration=await aiAudioProbe(output);
        if(Math.abs(oldDuration-duration)>Math.max(2,duration*.005))throw Error('同名音轨时长不一致，不能覆盖');
        job.label='复用原目录已有完整音轨';
      }catch(e){if(e.code!=='ENOENT')throw e;}
      if(!exists){
        tmp=path.join(path.dirname(source),'.jf-audio-'+crypto.randomBytes(10).toString('hex')+'.mp3');
        job.label='正在完整提取音轨（不切片）';
        const progress=mediaProgressJobs.get(id);if(progress){progress.label=job.label;progress.updated=Date.now();}
        try{await runCommand('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n','-i',source,'-map','0:a:0','-vn','-sn','-dn','-ac','1','-ar','24000','-c:a','libmp3lame','-b:a','64k','-map_metadata','-1',tmp],
          {stdio:['ignore','ignore','pipe'],timeoutMs:60*60*1000,progressId:id,progressDuration:duration,progressBase:0,progressTotal:duration});}
        catch(e){if(e.code==='EACCES'||e.code==='EPERM')throw Error('视频所在目录不可写，请调整目录权限后重试');throw e;}
        const converted=await fs.promises.lstat(tmp);
        if(!converted.isFile()||converted.isSymbolicLink()||converted.size<200)throw Error('提取音频失败');
        const after=fs.lstatSync(source);
        if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('原视频已发生变化，已取消生成');
        // Hard-link creation gives atomic no-clobber semantics. Never use -y or
        // rename over an existing user file, even with concurrent processes.
        try{await fs.promises.link(tmp,output);created=true;}
        catch(e){if(e.code==='EEXIST')throw Error('同名音轨已存在，为避免覆盖已取消');throw e;}
      }
    }
    const outputStat=await fs.promises.lstat(output);
    if(!outputStat.isFile()||outputStat.isSymbolicLink()||outputStat.size>2*1024*1024*1024)throw Error('音频文件无效或超过云端 2GB 限制');
    if(kind==='audio' && !['.mp3','.m4a','.aac','.wav','.flac','.ogg','.opus','.wma'].includes(path.extname(output).toLowerCase()))throw Error('当前音频格式不支持直接上传');
    const after=fs.lstatSync(source);
    if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('源媒体在准备期间发生变化');
    job.directory=path.dirname(output);job.filePath=output;job.sourceKey=key;
    job.sourceFingerprint=`${stat.size}-${Math.floor(stat.mtimeMs)}`;
    const parts=[{file:path.basename(output),startSeconds:0,endSeconds:duration,bytes:outputStat.size}];
    job.parts=parts;job.prompt=aiAudioPrompt(item,parts,duration);
    job.clipboardCopied=false;job.status='done';job.label=created?'已在源文件同目录生成完整 MP3':'完整音轨已就绪';
    updateMediaProgress(id,duration,duration);finishMediaProgress(id);
  }catch(error){job.status='error';job.label=error.message;finishMediaProgress(id,error);throw error;}
  finally{if(tmp)await fs.promises.rm(tmp,{force:true}).catch(()=>{});}
}
function aiExportPublic(job){
  const progress=mediaProgressJobs.get(job.id);
  return {ok:true,id:job.id,status:job.status,label:job.label,percent:progress?.percent??null,
    directory:job.status==='done'?job.directory:null,parts:job.status==='done'?job.parts:null,
    clipboardCopied:job.status==='done'?job.clipboardCopied:false,
    prompt:job.status==='done'?job.prompt:null};
}
function aiExportCleanup(){
  for(const [id,job] of aiAudioJobs){if(job.status!=='running'&&Date.now()-job.started>60*60*1000)aiAudioJobs.delete(id);}
}
