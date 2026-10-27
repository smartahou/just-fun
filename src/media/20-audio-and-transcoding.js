

// 音频 A-B 精准重编码：以 m4a 保存到现有匿名化音频素材目录。
const audioClipLocks=new Set();
async function createAudioClip(key,start,end,progressId=null) {
  const item=catalog.items.find(x=>x.key===key&&x.state==='ready'&&itemMediaKind(x)==='audio');
  if(!item||!fs.existsSync(managedPath(item))) throw new Error('音频文件不存在');
  if(!HAS_FFMPEG) throw new Error('截取音频需要 FFmpeg');
  start=Number(start);end=Number(end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<=0.05)throw new Error('A-B 区间无效');
  if(end-start>12*3600)throw new Error('截取区间超过 12 小时');
  if(audioClipLocks.has(key))throw new Error('这条音频正在截取中');
  audioClipLocks.add(key);
  const tmp=path.join(CACHE_DIR,'.audio-clip-'+crypto.randomBytes(12).toString('hex')+'.m4a');
  try {
    await runCommand('ffmpeg',[
      '-hide_banner','-loglevel','error','-nostdin','-y',
      '-ss',String(start),'-i',managedPath(item),'-t',String(end-start),
      '-map','0:a:0','-vn','-c:a','aac','-b:a','192k','-movflags','+faststart',tmp
    ],{stdio:['ignore','ignore','pipe'],progressId,progressDuration:end-start});
    const basename=path.basename(item.originalName||item.title||'音频',item.originalExt||'');
    return addGeneratedMedia(tmp,'.m4a','data/'+AUDIO_SUBDIR,
      basename+' - 片段 '+start.toFixed(2)+'-'+end.toFixed(2)+'.m4a',item,
      {audioSourceKey:key,audioClipStart:start,audioClipEnd:end});
  } finally {
    audioClipLocks.delete(key);
    try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}
  }
}

async function extractAudio(key,progressId=null) {
  const item = requiredVideo(key);
  if (mediaJobs.has('audio:' + key)) throw new Error('正在提取音轨');
  mediaJobs.add('audio:' + key);
  const tmp = path.join(CACHE_DIR, '.audio-'+crypto.randomBytes(12).toString('hex')+'.m4a');
  try {
    await runCommand('ffmpeg', [
      '-hide_banner','-loglevel','error','-nostdin','-y',
      '-i',managedPath(item),'-map','0:a:0','-vn','-c:a','aac','-b:a','192k',tmp
    ], {stdio:['ignore','ignore','pipe'],progressId,progressDuration:Number(item.duration)||0});
    return addGeneratedMedia(tmp,'.m4a','data/'+AUDIO_SUBDIR,
      (item.title||'视频')+' - 音轨.m4a',item,{audioSourceKey:key});
  } finally {
    mediaJobs.delete('audio:' + key);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  }
}

// 9:16 生成任务按源视频去重，避免按钮重复点击同时写入多份文件。
const portraitJobs = new Set();

async function createPortraitFromItem(item, cropX = 0.5, progressId=null) {
  if (!HAS_FFMPEG) {
    throw new Error('需要安装 FFmpeg 并将 ffmpeg 加入 PATH');
  }
  if (!item || itemMediaKind(item) !== 'video') {
    throw new Error('只有视频可以生成竖屏版本');
  }
  const source = managedPath(item);
  if (!fs.existsSync(source)) {
    throw new Error('原视频不存在');
  }

  // crop 只裁切像素，从不 scale 或拉伸。
  // 水平位置 0=左、0.5=中、1=右；偶数边界兼容 yuv420p。
  // 窄视频如需裁剪高度，仍保持垂直居中。
  const transforms = {
    90: 'transpose=clock',
    180: 'hflip,vflip',
    270: 'transpose=cclock'
  };
  const filterParts = [];
  const extraRotation = Number(item.rotation || 0);
  if (transforms[extraRotation]) filterParts.push(transforms[extraRotation]);
  filterParts.push(
    'crop=trunc(min(iw\\,ih*9/16)/2+0.5)*2:' +
    'trunc(min(ih\\,iw*16/9)/2+0.5)*2:' +
    'trunc((iw-ow)*' + cropX.toFixed(3) + '/2)*2:(ih-oh)/2'
  );

  const tempPath = path.join(
    CACHE_DIR,
    '.portrait-' + crypto.randomBytes(12).toString('hex') + '.mp4'
  );
  let finalPath = '';
  let newItem = null;
  try {
    // 不采用 stream copy：裁剪必须重新编码。优先 H.264；缺少 libx264 时回退 MPEG-4。
    const baseArgs = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', source,
      '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
      '-vf', filterParts.join(','),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-metadata:s:v:0', 'rotate=0',
      '-movflags', '+faststart', '-f', 'mp4'
    ];
    try {
      await runCommand('ffmpeg', [
        ...baseArgs, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', tempPath
      ], {stdio: ['ignore', 'ignore', 'pipe'],progressId,progressDuration:Number(item.duration)||0});
    } catch (error) {
      if (!/unknown encoder ['"]?libx264|encoder.*libx264.*not found/i.test(String(error.message))) {
        throw error;
      }
      try { fs.unlinkSync(tempPath); } catch {}
      await runCommand('ffmpeg', [
        ...baseArgs, '-c:v', 'mpeg4', '-q:v', '3', tempPath
      ], {stdio: ['ignore', 'ignore', 'pipe'],progressId,progressDuration:Number(item.duration)||0});
    }

    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size <= 0) {
      throw new Error('FFmpeg 未能生成有效的竖屏视频');
    }
    const stat = fs.statSync(tempPath);
    let managedName = '';
    do {
      managedName = HASH_ENABLED ? makeManagedName((item.originalName || item.title || item.key) + '-9x16', stat)
        : uniqueVisibleName(targetDir, safeOriginalFilename((item.title || '视频').replace(/[\\\/:*?"<>|]/g,'_') + '-9x16.mp4'));
    } while (
      fs.existsSync(path.join(targetDir, managedName)) ||
      catalog.items.some(x => x.managedName === managedName)
    );

    finalPath = path.join(targetDir, managedName);
    fs.renameSync(tempPath, finalPath);
    const newStat = fs.statSync(finalPath);
    const title = (item.title || '视频') + ' · 竖屏 9:16 · 横向' + Math.round(cropX * 100) + '%';
    newItem = {
      key: hashKey(HASH_ENABLED ? managedName : 'root/'+managedName),
      managedName,
      originalName: (item.creator ? item.creator + ' - ' : '') + title + '.mp4',
      originalExt: '.mp4',
      kind: 'video',
      mime: 'video/mp4',
      creator: item.creator || '',
      title,
      rating: Number(item.rating || 0),
      rotation: 0,
      portraitSourceKey: item.key,
      portraitAspect: '9:16',
      portraitCropX: cropX,
      cover: '', coverTime: 0,
      duration: 0, durationText: '',
      width: 0, height: 0, resolution: '', codec: '',
      size: newStat.size,
      sizeText: formatBytes(newStat.size),
      importedAt: new Date().toISOString(),
      modifiedTimeMs: Number(newStat.mtimeMs) || 0,
      modifiedAt: new Date(newStat.mtimeMs).toISOString(),
      fingerprint: `${newStat.size}-${Math.floor(newStat.mtimeMs)}`,
      state: 'ready'
    };
    Object.assign(newItem, await probeVideo(finalPath));
    if (!NO_SCREENSHOT && newItem.duration) {
      await writeCover(newItem, newItem.duration * 0.35);
    }
    catalog.items.push(newItem);
    try {
      saveCatalog();
    } catch (error) {
      catalog.items = catalog.items.filter(x => x !== newItem);
      removeCover(newItem);
      throw error;
    }
    return newItem;
  } catch (error) {
    // 失败时不留下半个新媒体；源视频始终不受影响。
    if (finalPath && fs.existsSync(finalPath)) {
      try { fs.unlinkSync(finalPath); } catch {}
    }
    throw error;
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }
}

// Compatibility decisions are advisory: codec names alone cannot prove hardware/browser decodability.
const videoCompatibilityLocks=new Set();
function inspectVideoCompatibility(key) {
  const item=requiredVideo(key);
  if(!HAS_FFPROBE)throw new Error('需要 FFprobe 检测媒体编码');
  const result=spawnSync('ffprobe',['-v','error','-show_entries',
    'format=format_name,duration:stream=index,codec_name,codec_type,pix_fmt,profile,level,bit_rate',
    '-of','json',managedPath(item)],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:3*1024*1024});
  if(result.status!==0 || !result.stdout)throw new Error('FFprobe 无法读取媒体流，文件可能损坏');
  let obj;
  try{obj=JSON.parse(result.stdout);}catch{throw new Error('FFprobe 返回格式无效');}
  const streams=obj.streams||[];
  const v=streams.find(s=>s.codec_type==='video');
  const a=streams.find(s=>s.codec_type==='audio');
  if(!v)throw new Error('没有检测到可转码的视频流');
  const container=path.extname(item.originalName||item.managedName).toLowerCase().replace(/^\./,'')||'unknown';
  const duration=Number(obj.format?.duration)||Number(item.duration)||0;
  // MP4 + H.264 8-bit 4:2:0 + AAC (or silent) can be stream-copied. A full
  // encode remains available in the UI even if this conservative check passes.
  const copy= v.codec_name==='h264' && v.pix_fmt==='yuv420p' && (!a || a.codec_name==='aac');
  return {container,videoCodec:v.codec_name||'unknown',audioCodec:a?.codec_name||'',
    pixelFormat:v.pix_fmt||'',profile:v.profile||'',duration,
    suggest:copy?'copy':'encode',alreadyMp4:container==='mp4',
    notice:'检测只是建议，无法可靠识别播放时卡顿或局部坏帧。新文件不覆盖原件。内嵌字幕和附加数据轨不复制。'};
}
async function convertVideoCompatibility(key,mode='auto',progressId=null) {
  const item=requiredVideo(key);
  if(mode!=='auto'&&mode!=='encode')throw new Error('未知转码模式');
  if(videoCompatibilityLocks.size>0)throw new Error('已有视频正在转码，请等待完成');
  videoCompatibilityLocks.add(key);
  let temp='';
  try {
    const analysis=inspectVideoCompatibility(key);
    const method=mode==='encode'?'encode':analysis.suggest;
    temp=path.join(CACHE_DIR,'.compat-'+crypto.randomBytes(12).toString('hex')+'.mp4');
    const args=['-hide_banner','-loglevel','error','-nostdin','-n',
      '-i',managedPath(item),'-map','0:v:0','-map','0:a?',
      '-map_metadata','0','-map_chapters','0','-sn','-dn'];
    if(method==='copy')args.push('-c:v','copy','-c:a','copy');
    else args.push('-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p',
      '-c:a','aac','-b:a','256k');
    args.push('-movflags','+faststart','-f','mp4',temp);
    await runCommand('ffmpeg',args,{stdio:['ignore','ignore','pipe'],progressId,
      progressDuration:analysis.duration});
    if(!fs.existsSync(temp)||fs.statSync(temp).size<256)throw new Error('转码结果为空');
    // Verify the actual output, not only FFmpeg's exit status.
    const test=spawnSync('ffprobe',['-v','error','-select_streams','v:0',
      '-show_entries','stream=codec_name,pix_fmt','-of','json',temp],
      {encoding:'utf8',timeout:20000,windowsHide:true});
    let video={};try{video=JSON.parse(test.stdout).streams?.[0]||{};}catch{}
    if(test.status!==0||video.codec_name!=='h264'||video.pix_fmt!=='yuv420p')throw new Error('输出不符合 H.264 8-bit 兼容格式');
    const base=path.basename(item.originalName||item.title||'视频',item.originalExt||'');
    const created=addGeneratedMedia(temp,'.mp4','data',base+(method==='copy'?' - 兼容封装.mp4':' - 兼容转码.mp4'),item,
      {conversionSourceKey:item.key,conversionMode:method});
    return {item:created,method};
  } finally {
    videoCompatibilityLocks.delete(key);
    if(temp)try{fs.rmSync(temp,{force:true});}catch{}
  }
}
