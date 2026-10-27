

function mimeForAsset(file) {
  const ext =
    path
      .extname(file)
      .toLowerCase();

  if (
    ext === '.jpg' ||
    ext === '.jpeg'
  ) {
    return 'image/jpeg';
  }

  if (ext === '.png') {
    return 'image/png';
  }

  return 'application/octet-stream';
}


// v6.20 - Transient FFmpeg job progress; bounded, memory only.
const mediaProgressJobs = new Map();
function validProgressId(id){return typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);}
function beginMediaProgress(id,label){
  if(!validProgressId(id))return;
  for(const [key,job] of mediaProgressJobs){
    if(Date.now()-job.updated>120000 || mediaProgressJobs.size>48)mediaProgressJobs.delete(key);
  }
  mediaProgressJobs.set(id,{label,status:'running',percent:null,updated:Date.now()});
}
function finishMediaProgress(id,error){
  const job=mediaProgressJobs.get(id);
  if(!job)return;
  job.status=error?'error':'done';job.percent=error?job.percent:100;
  job.updated=Date.now();
}
function updateMediaProgress(id,duration,seconds){
  const job=mediaProgressJobs.get(id);
  if(!job || job.status!=='running' || !(duration>0) || !(seconds>=0))return;
  job.percent=Math.max(job.percent||0,Math.min(98,Math.round(seconds/duration*98)));
  job.updated=Date.now();
}

// Track FFmpeg/FFprobe processes so a shutdown never leaves a background encoder.
const activeMediaChildren = new Set();
function stopActiveMediaChildren() {
  for (const child of activeMediaChildren) {
    try { child.kill('SIGTERM'); } catch {}
  }
}
function runCommand(
  command,
  args,
  options = {}
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const {progressId,progressDuration,progressBase=0,progressTotal=0,timeoutMs=0,...spawnOptions}=options;
      // out_time is a processed presentation timestamp, not bytes written.
      const ffmpegArgs=progressId && mediaProgressJobs.has(progressId) && command==='ffmpeg'
        ? [...args.slice(0,-1),'-progress','pipe:2','-nostats',args[args.length-1]]
        : args;
      let child;
      try { child = spawn(command,ffmpegArgs,{windowsHide:true,...spawnOptions}); }
      catch (error) { reject(error); return; }
      activeMediaChildren.add(child);
      let settled=false;
      let timedOut=false;
      const timer=timeoutMs>0?setTimeout(()=>{
        timedOut=true;
        try { child.kill('SIGKILL'); } catch {}
        finish(new Error(`${command} 处理超时（${Math.ceil(timeoutMs/1000)} 秒），已中止；原文件未被修改`));
      },timeoutMs):null;
      const finish = (error,result) => {
        if (settled) return;
        settled=true;
        if (timer) clearTimeout(timer);
        activeMediaChildren.delete(child);
        if (error) reject(error); else resolve(result);
      };
      let progressBuffer='';

      let stderr =
        '';

      if (child.stderr) {
        child.stderr.on(
          'data',
          chunk => {
            const output=chunk.toString();
            stderr=(stderr+output).slice(-16000);
            if(progressId && progressDuration>0){
              progressBuffer+=output;
              const lines=progressBuffer.split(String.fromCharCode(10));
              progressBuffer=lines.pop() || '';
              for(const line of lines){
                if(!line.startsWith('out_time='))continue;
                const parts=line.slice(9).trim().split(':').map(Number);
                if(parts.length===3 && parts.every(Number.isFinite)){
                  updateMediaProgress(progressId,progressTotal||progressDuration,progressBase+parts[0]*3600+parts[1]*60+parts[2]);
                }
              }
              if(progressBuffer.length>8192)progressBuffer='';
            }
          }
        );
      }

      child.on('error',error=>finish(error));

      child.on('close',code=>{
        if (timedOut) finish(new Error(`${command} 处理超时（${Math.ceil(timeoutMs/1000)} 秒），已中止；原文件未被修改`));
        else if (code===0) finish(null,{code,stderr});
        else finish(new Error(stderr.trim() || `${command} 退出码 ${code}`));
      });
    }
  );
}

async function createClipFromItem(
  item,
  start,
  end,
  progressId = null
) {
  if (!HAS_FFMPEG) {
    throw new Error(
      '没有找到 ffmpeg，无法截取视频'
    );
  }

  if (
    itemMediaKind(
      item
    ) !==
    'video'
  ) {
    throw new Error(
      '只有视频支持 A-B 截取'
    );
  }

  start =
    Number(start);

  end =
    Number(end);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <=
      start +
      0.05
  ) {
    throw new Error(
      'A-B 时间范围无效'
    );
  }

  const source =
    managedPath(
      item
    );

  if (
    !fs.existsSync(
      source
    )
  ) {
    throw new Error(
      '源视频不存在'
    );
  }

  const knownDuration =
    Number(
      item.duration || 0
    );

  if (
    knownDuration > 0 &&
    end >
      knownDuration +
      0.25
  ) {
    throw new Error(
      'B 点超过视频时长'
    );
  }

  const duration =
    end -
    start;

  const tempName =
    `.clip-${
      crypto
        .randomBytes(12)
        .toString('hex')
    }.mp4`;

  const tempPath =
    path.join(
      CACHE_DIR,
      tempName
    );

  const common = [
    '-hide_banner',
    '-loglevel','error',
    '-y',
    '-ss',
    String(start),
    '-i',
    source,
    '-t',
    String(duration)
  ];

  try {
    // 优先精确重编码，A / B 点不会受关键帧限制。
    await runCommand(
      'ffmpeg',
      [
        ...common,
        '-map','0:v:0?',
        '-map','0:a:0?',
        '-sn',
        '-c:v','libx264',
        '-preset','veryfast',
        '-crf','20',
        '-g','12',
        '-bf','0',
        '-pix_fmt','yuv420p',
        '-c:a','aac',
        '-movflags','+faststart',
        '-f','mp4',
        tempPath
      ],
      {
        stdio:[
          'ignore',
          'ignore',
          'pipe'
        ],
        progressId,progressDuration:duration
      }
    );
  } catch (firstError) {
    try {
      if (
        fs.existsSync(
          tempPath
        )
      ) {
        fs.unlinkSync(
          tempPath
        );
      }
    } catch {}

    // 某些 ffmpeg 构建没有 libx264，退回 stream copy。
    // 速度更快，但切点可能靠近关键帧。
    await runCommand(
      'ffmpeg',
      [
        ...common,
        '-map','0:v:0?',
        '-map','0:a:0?',
        '-sn',
        '-c','copy',
        '-avoid_negative_ts',
        'make_zero',
        '-f','mp4',
        tempPath
      ],
      {
        stdio:[
          'ignore',
          'ignore',
          'pipe'
        ],
        progressId,progressDuration:duration
      }
    );
  }

  if (
    !fs.existsSync(
      tempPath
    ) ||
    fs.statSync(
      tempPath
    ).size <= 0
  ) {
    throw new Error(
      'FFmpeg 没有生成有效片段'
    );
  }

  const stat =
    fs.statSync(
      tempPath
    );

  let managedName;

  do {
    managedName = HASH_ENABLED ? makeManagedName(item.originalName || item.title || item.key, stat)
      : uniqueVisibleName(targetDir, safeOriginalFilename((item.title || '视频片段').replace(/[\\\/:*?"<>|]/g,'_') + ' - 片段.mp4'));
  } while (
    fs.existsSync(
      path.join(
        targetDir,
        managedName
      )
    )
  );

  const finalPath =
    path.join(
      targetDir,
      managedName
    );

  fs.renameSync(
    tempPath,
    finalPath
  );

  const rangeText =
    `${formatDuration(start)}-${formatDuration(end)}`;

  const newItem = {
    key:
      hashKey(HASH_ENABLED ? managedName : 'root/'+managedName),
    managedName,
    originalName:
      `${
        item.creator
          ? item.creator +
            ' - '
          : ''
      }${
        item.title ||
        '视频'
      } · 片段 ${
        rangeText
      }.mp4`,
    originalExt:
      '.mp4',
    kind:
      'video',
    mime:
      'video/mp4',
    seamlessClipLoop: true,
    sourceClipKey: item.key,
    creator:
      item.creator || '',
    title:
      `${
        item.title ||
        '视频'
      } · 片段 ${
        rangeText
      }`,
    rating: 0,
    rotation:
      [0,90,180,270]
        .includes(
          Number(
            item.rotation
          )
        )
          ? Number(
              item.rotation
            )
          : 0,
    cover: '',
    coverTime: 0,
    duration: 0,
    durationText: '',
    width: 0,
    height: 0,
    resolution: '',
    codec: '',
    size:
      stat.size,
    sizeText:
      formatBytes(
        stat.size
      ),
    importedAt:
      new Date()
        .toISOString(),
    fingerprint:
      `${stat.size}-${Math.floor(stat.mtimeMs)}`,
    state:
      'ready'
  };

  Object.assign(
    newItem,
    await probeVideo(
      finalPath
    )
  );

  if (
    !NO_SCREENSHOT &&
    newItem.duration
  ) {
    await writeCover(
      newItem,
      Math.min(
        Math.max(
          0.2,
          newItem.duration *
            0.35
        ),
        Math.max(
          0.2,
          newItem.duration -
            0.2
        )
      )
    );
  }

  catalog.items.push(
    newItem
  );

  saveCatalog();

  logStep(
    `A-B 截取完成：${
      item.title ||
      item.key
    } · ${rangeText}`
  );

  return newItem;
}


// 生成素材统一走 data/纯数字目录，文件名全部为无扩展名的 hash。
function addGeneratedMedia(temp, ext, relativeDir, displayName, sourceItem, extras = {}) {
  fs.mkdirSync(path.join(targetDir, safeMediaRelativeDir(relativeDir)), {recursive:true});
  const stat = fs.statSync(temp);
  if (!stat.isFile() || stat.size === 0) throw new Error('输出媒体为空');
  let managedName;
  do {
    managedName = HASH_ENABLED ? makeManagedName(displayName, stat) : uniqueVisibleName(path.join(targetDir,safeMediaRelativeDir(relativeDir)), safeGeneratedFilename(displayName));
  } while (fs.existsSync(path.join(targetDir, safeMediaRelativeDir(relativeDir), managedName)));
  const item = {
    key:hashKey(HASH_ENABLED?managedName:relativeDir+'/'+managedName), managedName, originalName:HASH_ENABLED?displayName:managedName,
    originalExt:ext, relativeDir,
    kind:mediaKindFromExt(ext), mime:MIME_BY_EXT[ext],
    creator:sourceItem.creator || '',
    title:path.basename(displayName, ext), rating:0, rotation:0,
    cover:'', coverTime:0, duration:0, durationText:'', width:0, height:0,
    resolution:'', codec:'', size:stat.size, sizeText:formatBytes(stat.size),
    importedAt:new Date().toISOString(), state:'pending', ...extras
  };
  catalog.items.push(item);
  saveCatalog();
  fs.renameSync(temp, managedPath(item));
  item.state = 'ready';
  const updated = fs.statSync(managedPath(item));
  item.modifiedTimeMs = Number(updated.mtimeMs)||0;
  item.modifiedAt = new Date(updated.mtimeMs).toISOString();
  item.fingerprint = `${updated.size}-${Math.floor(updated.mtimeMs)}`;
  saveCatalog();
  return item;
}

function requiredVideo(key) {
  const item = catalog.items.find(x => x.key === key && x.state === 'ready');
  if (!item || itemMediaKind(item) !== 'video') throw new Error('源视频不存在');
  if (!fs.existsSync(managedPath(item))) throw new Error('源视频文件不存在');
  if (!HAS_FFMPEG) throw new Error('需要在 PATH 中安装 FFmpeg');
  return item;
}