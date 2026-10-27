

// 截图逐帧选择直接定位视频，旧版拆帧缓存会在启动时清理。
const FRAME_TEMP_ROOT = path.join(CACHE_DIR, '.frame-previews');
// 逐帧截图：仅缓存低清 JPEG，正式截图和封面始终从原视频提取。
// 文件夹按源文件 hash+修改签名隔离，避免旧缩略图错配；保留最近 3 组以加速下次进入。
const framePreviewJobs = new Map();
const FRAME_PREVIEW_KEEP = 3;
function previewJobForKey(key) {
  const item = requiredVideo(key);
  const st = fs.statSync(managedPath(item));
  const signature = `${st.size}-${st.mtimeMs}`;
  const id = crypto.createHash('sha256').update(`${key}|${signature}`).digest('hex').slice(0,24);
  return {item, id, signature, dir:path.join(FRAME_TEMP_ROOT,id)};
}
function countPreviewFrames(dir) {
  try {return fs.readdirSync(dir).filter(name=>/^f\d{6}\.jpg$/.test(name)).length;}
  catch {return 0;}
}
function previewPublicStatus(job) {
  return {
    id:job.id,ready:String(job.error||'').startsWith('长视频已跳过')?0:countPreviewFrames(job.dir),done:!!job.done,
    total:job.total || 0,error:job.error || ''
  };
}
async function pruneFramePreviewCache() {
  try {
    const active = new Set([...framePreviewJobs.values()].filter(job=>job.running).map(job=>job.id));
    const found=await fs.promises.readdir(FRAME_TEMP_ROOT,{withFileTypes:true});
    const dirs=[];
    for (const entry of found) {
      if (!entry.isDirectory() || !/^[a-f0-9]{24}$/.test(entry.name)) continue;
      const full=path.join(FRAME_TEMP_ROOT,entry.name);
      try {const stat=await fs.promises.stat(full);dirs.push({name:entry.name,mtimeMs:stat.mtimeMs});} catch {}
    }
    dirs.sort((a,b)=>b.mtimeMs-a.mtimeMs);
    for (const entry of dirs.slice(FRAME_PREVIEW_KEEP)) {
      if (!active.has(entry.name)) {
        try {await fs.promises.rm(path.join(FRAME_TEMP_ROOT,entry.name),{recursive:true,force:true,maxRetries:1});}catch {}
      }
    }
  } catch {}
}

async function startFramePreview(key) {
  if (!HAS_FFMPEG) throw new Error('低清逐帧预览需要 FFmpeg');
  const entry = previewJobForKey(key);
  const cached = framePreviewJobs.get(key);
  // 缓存被 LRU 淘汰或上次生成失败后，重新进入时必须允许再生成。
  if (cached && cached.id === entry.id && (cached.running || (cached.done && countPreviewFrames(cached.dir)>0))) return previewPublicStatus(cached);
  if (cached && cached.running) { // 不删除仍在生成的缓存；新文件会使用新的签名目录。
    try {cached.child?.kill();} catch {}
  }
  const info = await getVideoFrameTimes(key);
  const totalFrames=info.count || info.times.length;
  // A long lecture may contain 100,000+ frames: never walk or regenerate
  // the old thumbnail collection synchronously just to open the viewer.
  if (totalFrames>2400) {
    const job={...entry,total:totalFrames,done:false,running:false,
      error:'长视频已跳过批量逐帧缓存，可继续定位并保存原图',child:null};
    framePreviewJobs.set(key,job);
    void fs.promises.rm(entry.dir,{recursive:true,force:true}).catch(()=>{});
    return previewPublicStatus(job);
  }
  fs.mkdirSync(FRAME_TEMP_ROOT,{recursive:true});
  let done = false;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(entry.dir,'complete.json'),'utf8'));
    done = meta.signature === entry.signature && meta.done === true && countPreviewFrames(entry.dir)>0;
  } catch {}
  if (!done) await fs.promises.rm(entry.dir,{recursive:true,force:true});
  fs.mkdirSync(entry.dir,{recursive:true});
  const job = {...entry,total:totalFrames,done,running:!done,error:'',child:null};
  framePreviewJobs.set(key,job);
  try {fs.utimesSync(job.dir,new Date(),new Date());} catch {}
  if (done) return previewPublicStatus(job);
  const output = path.join(job.dir,'f%06d.jpg');
  const args = ['-hide_banner','-loglevel','error','-nostdin','-threads','2',
    '-i',managedPath(job.item),'-map','0:v:0','-an','-sn','-dn',
    '-vf','scale=320:320:force_original_aspect_ratio=decrease:flags=fast_bilinear',
    '-fps_mode','passthrough','-q:v','8','-start_number','0','-y',output];
  const child = spawn('ffmpeg',args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
  job.child=child;
  activeMediaChildren.add(child);
  const timeout=setTimeout(()=>{
    if(job.running){job.timedOut=true;try{child.kill('SIGKILL');}catch{}}
  },60000);
  let stderr='';
  child.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-600);});
  const finish = error => {
    if (!job.running) return;
    job.running=false;
    clearTimeout(timeout);
    activeMediaChildren.delete(child);
    job.error=job.timedOut?'预览生成超时，已停止后台解码':(error || '');
    job.done=!job.error;
    if (job.done) {
      try {fs.writeFileSync(path.join(job.dir,'complete.json'),JSON.stringify({signature:job.signature,done:true,total:countPreviewFrames(job.dir)}));} catch {}
    }
    void pruneFramePreviewCache();
  };
  child.on('error',error=>finish(error.message));
  child.on('close',code=>finish(code===0?'':('低清预览生成失败：'+(stderr.trim() || code))));
  return previewPublicStatus(job);
}
function framePreviewStatus(key) {
  const current = previewJobForKey(key);
  const job = framePreviewJobs.get(key);
  if (!job || job.id !== current.id) return {id:'',ready:0,done:false,total:0,error:'未启动'};
  return previewPublicStatus(job);
}
const mediaJobs = new Set();

// 逐帧时间表：优先解析视频 packet PTS（不解码逐帧帧信息），避免同步 ffprobe 卡住整个服务。
// 某些文件/磁盘响应极慢时按帧率降级；此时截图与封面以原视频的帧序号提取，避免估算时刻错帧。
const frameTimestampCache = new Map();
const frameTimestampPending = new Map();
const FRAME_PROBE_LIMIT_MS = 8000;
function runFrameProbe(args, timeout = FRAME_PROBE_LIMIT_MS, maxBytes = 12 * 1024 * 1024) {
  return new Promise(resolve => {
    let child;
    try { child = spawn('ffprobe',args,{windowsHide:true,stdio:['ignore','pipe','pipe']}); }
    catch(error) { resolve({ok:false,reason:error.message,stdout:''}); return; }
    let stdout='', stderr='', bytes=0, settled=false, timedOut=false;
    const finish = (ok,reason) => {
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      resolve({ok,reason:reason||'',stdout});
    };
    const timer = setTimeout(()=>{
      timedOut=true;
      try {child.kill();}catch{}
      finish(false,'读取超时');
    },timeout);
    child.stdout?.on('data',data=>{
      if(settled)return;
      bytes+=data.length;
      if(bytes>maxBytes){
        try{child.kill();}catch{}
        finish(false,'帧数过多');
      } else stdout+=data.toString();
    });
    child.stderr?.on('data',data=>{stderr=(stderr+data.toString()).slice(-500);});
    child.on('error',error=>finish(false,error.message));
    child.on('close',code=>finish(!timedOut&&code===0,stderr.trim()||String(code)));
  });
}
function readRate(rate) {
  const match=String(rate||'').match(/^(\d+)(?:\/(\d+))?$/);
  if(!match)return 0;
  const n=Number(match[1]),d=Number(match[2]||1);
  const value=n/d;
  return Number.isFinite(value)&&value>=1&&value<=240?value:0;
}
// The old 120000-frame cap truncated movies after 66m40s at 30 fps.
// Long films return a *virtual* frame index instead of allocating/serializing
// hundreds of thousands of numbers. Client computes time = frameIndex/fps.
const COMPACT_FRAME_THRESHOLD = 2400;
const DIRECT_ESTIMATE_DURATION = 1800;
function fallbackFrameInfo(item, detail, reason, durationHint) {
  let stream={};let format={};
  try {const value=JSON.parse(detail||'{}');stream=value.streams?.[0]||{};format=value.format||{};}catch{}
  const duration=[Number(item.duration),Number(durationHint),Number(stream.duration),Number(format.duration)]
    .find(x=>Number.isFinite(x)&&x>0) || 0;
  const fps=readRate(stream.avg_frame_rate)||readRate(stream.r_frame_rate)||30;
  const reportedCount=Number(stream.nb_frames);
  const predicted=Math.max(1,Math.ceil(duration*fps));
  // Some files advertise an inaccurate nb_frames (or count only one segment).
  const plausible=Number.isSafeInteger(reportedCount)&&reportedCount>0&&
    (duration<=0||Math.abs(reportedCount-predicted)<=Math.max(2,predicted*.03));
  const count=plausible?reportedCount:predicted;
  const compact=count>COMPACT_FRAME_THRESHOLD;
  const times=compact?[]:Array.from({length:count},(_,i)=>Number((i/fps).toFixed(6)));
  return {times,count,compact,duration:duration||((count-1)/fps),fps,estimated:true,
    warning:'精确帧时间读取较慢，已切换到帧率估算。截图和封面将按所选时间从原视频提取。',
    reason:String(reason||'').slice(0,140)};
}
async function getVideoFrameTimes(key, durationHint=0) {
  const item = requiredVideo(key);
  if (!HAS_FFPROBE) throw new Error('逐帧截图需要安装 FFprobe（随 FFmpeg 提供）');
  const stat = fs.statSync(managedPath(item));
  const signature=stat.size+'-'+stat.mtimeMs;
  const cached=frameTimestampCache.get(key);
  // 降级结果只短期缓存，磁盘响应恢复后仍有机会重新取得精确 PTS。
  if(cached&&cached.signature===signature&&(!cached.info.estimated||Date.now()-cached.createdAt<30000))return cached.info;
  const pending=frameTimestampPending.get(key);
  if(pending&&pending.signature===signature)return pending.promise;
  const promise=(async()=>{
    const file=managedPath(item);
    // Multi-hour films: avoid slow multi-MB packet dumps and huge timestamp arrays.
    const duration=Number(item.duration)||Number(durationHint)||0;
    let info=null, reason='长视频采用按帧率定位（不生成完整时间戳数组）';
    if(duration<=DIRECT_ESTIMATE_DURATION){
      // For short clips retain precise PTS positioning (including VFR).
      const packets=await runFrameProbe([
        '-v','error','-select_streams','v:0','-show_packets',
        '-show_entries','packet=pts_time','-of','csv=p=0',file
      ]);
      reason=packets.reason||'视频时间戳读取失败';
      if(packets.ok){
        const times=[...new Set(packets.stdout.split(/\r?\n/)
          .filter(line=>line.trim())
          .map(line=>Number(line.trim().split(',')[0]))
          .filter(n=>Number.isFinite(n)&&n>=0))].sort((a,b)=>a-b);
        if(times.length)info={times,count:times.length,compact:false,
          duration:duration||times[times.length-1],estimated:false};
      }
    }
    if(!info){
      const meta=await runFrameProbe([
        '-v','error','-select_streams','v:0','-show_entries',
        'stream=avg_frame_rate,r_frame_rate,nb_frames,duration:format=duration',
        '-of','json',file
      ],4000,128*1024);
      info=fallbackFrameInfo(item,meta.ok?meta.stdout:'',reason,durationHint);
    }
    frameTimestampCache.set(key,{signature,info,createdAt:Date.now()});
    if(frameTimestampCache.size>8)frameTimestampCache.delete(frameTimestampCache.keys().next().value);
    return info;
  })();
  frameTimestampPending.set(key,{signature,promise});
  try {return await promise;}
  finally {if(frameTimestampPending.get(key)?.promise===promise)frameTimestampPending.delete(key);}
}

async function captureFrame(key, time, frameIndex=null) {
  const item = requiredVideo(key);
  time = Number(time);
  if (!Number.isFinite(time) || time < 0 || (item.duration > 0 && time > item.duration + .5)) {
    throw new Error('截图时间无效');
  }
  fs.mkdirSync(CACHE_DIR, {recursive:true});
  const tmp = path.join(CACHE_DIR, '.shot-' + crypto.randomBytes(12).toString('hex') + '.jpg');
  try {
    const indexed=Number.isSafeInteger(frameIndex)&&frameIndex>=0&&frameIndex<=120000;
    await runCommand('ffmpeg', indexed ? [
      '-hide_banner','-loglevel','error','-nostdin','-y',
      '-i',managedPath(item),'-vf',`select=eq(n\\,${frameIndex})`,
      '-vsync','0','-frames:v','1','-q:v','2',tmp
    ] : [
      '-hide_banner','-loglevel','error','-nostdin','-y',
      // Input-side accurate seek avoids decoding a long film from time zero.
      '-ss',String(time),'-i',managedPath(item),'-frames:v','1','-q:v','2',tmp
    ], {stdio:['ignore','ignore','pipe'],timeoutMs:60000});
    return addGeneratedMedia(tmp,'.jpg','data/'+FRAME_SUBDIR,
      (item.title||'视频')+' - 截图-'+time.toFixed(3)+'.jpg',item,{screenshotTime:time});
  } finally { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {} }
}