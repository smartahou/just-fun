

function itemPublic(item) {
  // 封面每次更新都会生成新的 hash 路径，路径本身已具备缓存失效能力。
  // 避免每次 /api/data 访问都对库中每个封面执行同步 statSync。
  const coverVersion = item.cover ? path.basename(item.cover) : '';

  const mediaUrl =
    `/media/${item.key}`;

  return {
    key:
      item.key,
    seamlessClipLoop:
      item.seamlessClipLoop === true,
    livePhoto: item.livePhoto === true,
    kind:
      itemMediaKind(item) || 'video',
    relativeDir: item.relativeDir || '',
    readOnly:item.readOnly===true,
    originalName: item.originalName || '',
    originalExt: item.originalExt || '',
    displayName: item.displayName || '',
    favorite: item.favorite === true,
    creator:
      item.creator || '',
    creatorLink:
      (catalog.creatorLinks && catalog.creatorLinks[String(item.creator || '').trim()]) || '',
    title:
      item.title || '',
    rating:
      Number(
        item.rating || 0
      ),
    rotation:
      [0,90,180,270].includes(
        Number(item.rotation)
      )
        ? Number(item.rotation)
        : 0,
    duration:
      item.duration || 0,
    durationText:
      item.durationText || '',
    resolution:
      item.resolution || '',
    codec:
      item.codec || '',
    size:
      item.size || 0,
    sizeText:
      item.sizeText || '',
    modifiedTimeMs:
      Number(
        item.modifiedTimeMs || 0
      ),
    modifiedAt:
      item.modifiedAt || '',
    coverTime:
      item.coverTime || 0,
    cover:
      itemMediaKind(
        item
      ) === 'image'
        ? (item.livePhoto===true?'/api/image-thumb/'+item.key:mediaUrl)
        : (
            item.cover
              ? (
                  '/asset/' +
                  encodeURIComponent(
                    item.cover
                  ) +
                  (
                    coverVersion
                      ? `?v=${coverVersion}`
                      : ''
                  )
                )
              : ''
          ),
    mediaUrl,
    videoUrl:
      (itemMediaKind(item) === 'video' || item.livePhoto===true)
        ? mediaUrl
        : ''
  };
}

function sendJson(
  res,
  data,
  status = 200
) {
  const body =
    JSON.stringify(
      data
    );

  res.writeHead(
    status,
    {
      'Content-Type':
        'application/json; charset=utf-8',
      'Content-Length':
        Buffer.byteLength(
          body
        ),
      'Cache-Control':
        'no-store'
    }
  );

  res.end(
    body
  );
}

function parseBody(req) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      let body = '';

      req.on(
        'data',
        chunk => {
          body +=
            chunk;

          if (
            body.length >
            1024 * 1024
          ) {
            reject(
              new Error(
                '请求过大'
              )
            );
          }
        }
      );

      req.on(
        'end',
        () => {
          try {
            resolve(
              body
                ? JSON.parse(
                    body
                  )
                : {}
            );
          } catch (error) {
            reject(
              error
            );
          }
        }
      );

      req.on(
        'error',
        reject
      );
    }
  );
}


// Read audio duration once from real media metadata; no playback history is recorded.
let audioDurationSweepRunning=false;
async function sweepAudioDurations() {
  if(audioDurationSweepRunning||!HAS_FFPROBE)return;
  audioDurationSweepRunning=true;
  try {
    let changed=0;
    const items=catalog.items.filter(x=>x.state==='ready' && itemMediaKind(x)==='audio' && !(Number(x.duration)>0));
    for(const item of items){
      if(!fs.existsSync(managedPath(item)))continue;
      const duration=await new Promise(resolve=>{
        const child=spawn('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',managedPath(item)],{windowsHide:true,stdio:['ignore','pipe','ignore']});
        let out='',closed=false;
        const timeout=setTimeout(()=>{try{child.kill()}catch{}},5000);
        child.stdout.on('data',chunk=>{if(out.length<128)out+=chunk.toString()});
        child.on('error',()=>{if(!closed){closed=true;clearTimeout(timeout);resolve(0)}});
        child.on('close',()=>{if(!closed){closed=true;clearTimeout(timeout);resolve(Number(out.trim())||0)}});
      });
      if(duration>0 && Number.isFinite(duration)){
        item.duration=duration;
        item.durationText=formatDuration(duration);
        changed++;
      }
      if(changed>=10){saveCatalog();changed=0;}
    }
    if(changed)saveCatalog();
  } finally {audioDurationSweepRunning=false;}
}
// Ghost loop: decode/encode into a disposable preview, never change original media or index.
// Video is forward-then-reverse; audio repeats original forward sound twice.
const ghostLoopJobs = new Map();
const GHOST_DIR = path.join(ASSET_DIR, 'ghost-loop');
function ghostMediaDetails(key, a, b) {
  const item=catalog.items.find(x=>x.key===key && x.state==='ready' && itemMediaKind(x)==='video');
  if(!item)throw new Error('视频不存在');
  const start=Number(a), end=Number(b);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start+0.15||end-start>20.01||end>Number(item.duration||0)+0.05) {
    throw new Error('鬼畜循环支持 0.2～20 秒的短视频或 A/B 片段');
  }
  const id=crypto.createHash('sha256').update([item.key,item.fingerprint||'',start.toFixed(3),end.toFixed(3),'v65'].join(':')).digest('hex').slice(0,40);
  return {item,start,end,id,file:path.join(GHOST_DIR,id+'.mp4')};
}
async function makeGhostLoop(details) {
  fs.mkdirSync(GHOST_DIR,{recursive:true});
  for(const name of fs.readdirSync(GHOST_DIR)) {
    if(!/^[a-f0-9]{40}\.mp4$/.test(name))continue;
    try{const full=path.join(GHOST_DIR,name);if(Date.now()-fs.statSync(full).mtimeMs>14*86400000)fs.unlinkSync(full)}catch{}
  }
  if(fs.existsSync(details.file) && fs.statSync(details.file).size>3000) return;
  if(!HAS_FFMPEG || !HAS_FFPROBE)throw new Error('此功能需要 FFmpeg 和 FFprobe');
  const output=details.file+'.tmp-'+process.pid+'.mp4';
  const src=managedPath(details.item);
  const probe=spawnSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=index','-of','csv=p=0',src],{encoding:'utf8',timeout:12000,windowsHide:true});
  const hasSound=probe.status===0 && Boolean(String(probe.stdout||'').trim());
  const a=details.start.toFixed(3),b=details.end.toFixed(3);
  // Cap decoded frames for reverse-filter memory safety. Keep original untouched.
  const videoFilter='[0:v]trim=start='+a+':end='+b+',setpts=PTS-STARTPTS,fps=24,scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,split=2[vf][vt];[vt]reverse,setpts=PTS-STARTPTS[vr];[vf][vr]concat=n=2:v=1:a=0,format=yuv420p[v]';
  const audioFilter=hasSound?';[0:a:0]atrim=start='+a+':end='+b+',asetpts=PTS-STARTPTS,asplit=2[af][ar];[af][ar]concat=n=2:v=0:a=1[a]':'';
  const args=['-hide_banner','-loglevel','error','-nostdin','-y','-i',src,'-filter_complex',videoFilter+audioFilter,'-map','[v]'];
  if(hasSound) args.push('-map','[a]');
  args.push('-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart');
  if(hasSound)args.push('-c:a','aac','-b:a','160k');
  args.push(output);
  try {
    await new Promise((resolve,reject)=>{
      const child=spawn('ffmpeg',args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
      let stderr='',done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve();};
      const timer=setTimeout(()=>{try{child.kill('SIGKILL')}catch{};finish(new Error('生成超时'))},110000);
      child.stderr.on('data',chunk=>{if(stderr.length<8000)stderr+=chunk.toString()});
      child.once('error',error=>finish(error));
      child.once('close',code=>finish(code===0?null:new Error(stderr.trim()||'生成失败')));
    });
    if(!fs.existsSync(output)||fs.statSync(output).size<3000)throw new Error('生成失败');
    fs.renameSync(output,details.file);
  } finally {try{fs.unlinkSync(output)}catch{}}
}

function streamMedia(
  req,
  res,
  item,
  overrideFile = null
) {
  const file = overrideFile || managedPath(item);

  if (
    !fs.existsSync(
      file
    )
  ) {
    res.writeHead(
      404
    );
    res.end();
    return;
  }

  const stat =
    fs.statSync(
      file
    );

  const size =
    stat.size;

  const range =
    req.headers.range;

  const mime =
    item.mime ||
    MIME_BY_EXT[
      item.originalExt
    ] ||
    'application/octet-stream';

  // 本地播放器通常请求一个字节区间。多区间请求需要 multipart/byteranges，
  // 本服务选择按 HTTP 规范忽略 Range 并返回完整文件，而不是错误返回第一个区间。
  if (!range || String(range).includes(',')) {
    res.writeHead(
      200,
      {
        'Content-Type': mime,
        'Content-Length': size,
        'Accept-Ranges': 'bytes'
      }
    );

    fs.createReadStream(file).pipe(res);
    return;
  }

  // 必须完整匹配单个区间，防止把畸形请求当作合法范围。
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());

  const rejectRange = () => {
    res.writeHead(
      416,
      {
        'Content-Range': `bytes */${size}`,
        'Accept-Ranges': 'bytes'
      }
    );
    res.end();
  };

  if (!match || (!match[1] && !match[2]) || size === 0) {
    rejectRange();
    return;
  }

  let start;
  let end;

  if (!match[1]) {
    // bytes=-N：请求文件尾部 N 字节。
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      rejectRange();
      return;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(requestedEnd) ||
      start < 0 ||
      requestedEnd < start ||
      start >= size
    ) {
      rejectRange();
      return;
    }
    end = Math.min(size - 1, requestedEnd);
  }

  res.writeHead(
    206,
    {
      'Content-Type': mime,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes'
    }
  );

  fs.createReadStream(file, { start, end }).pipe(res);
}

const APP_FAVICON_ICO = Buffer.from('__JUSTFUN_FAVICON_BASE64__', 'base64');

function manifestJson() {
  return JSON.stringify(
    {
      name: '本地媒体库',
      short_name: '媒体库',
      start_url: '/',
      scope: '/',
      display: 'fullscreen',
      orientation: 'any',
      background_color: '#0b1119',
      theme_color: '#0b1119'
    }
  );
}


// 图片图库缩略图：在本地独立缓存，限制并发，避免页面直接解码大量原始图片。
const PHOTO_THUMB_DIR = path.join(ASSET_DIR, 'photo-thumbs');
const photoThumbJobs = new Map();
const photoThumbQueue = [];
let photoThumbRunning = 0;
function enqueuePhotoThumb(work) {
  return new Promise((resolve,reject)=>{
    photoThumbQueue.push({work,resolve,reject});
    drainPhotoThumbQueue();
  });
}
function drainPhotoThumbQueue() {
  while(photoThumbRunning<2&&photoThumbQueue.length){
    const task=photoThumbQueue.shift();photoThumbRunning++;
    Promise.resolve().then(task.work).then(task.resolve,task.reject).finally(()=>{photoThumbRunning--;drainPhotoThumbQueue();});
  }
}
async function createPhotoThumb(item) {
  fs.mkdirSync(PHOTO_THUMB_DIR,{recursive:true});
  const source=managedPath(item);
  const output=path.join(PHOTO_THUMB_DIR,item.key);
  const stat=fs.statSync(source);
  try {
    const cached=fs.statSync(output);
    if(cached.size>100&&cached.mtimeMs>=stat.mtimeMs)return output;
  } catch {}
  if(!HAS_FFMPEG)throw new Error('FFmpeg 未安装');
  const temp=output+'.tmp-'+crypto.randomBytes(6).toString('hex');
  try {
    await new Promise((resolve,reject)=>{
      const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',source,
        '-frames:v','1','-vf',"scale='min(400,iw)':-2",'-q:v','5','-f','image2','-update','1',temp],
        {windowsHide:true,stdio:['ignore','ignore','pipe']});
      let settled=false;
      const timer=setTimeout(()=>{if(!settled){child.kill();finish(new Error('生成缩略图超时'));}},10000);
      function finish(error){if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve();}
      child.on('error',finish);child.on('close',code=>finish(code===0?null:new Error('缩略图处理失败')));
    });
    if(fs.statSync(temp).size<100)throw new Error('缩略图为空');
    fs.renameSync(temp,output);
    return output;
  }finally{try{if(fs.existsSync(temp))fs.unlinkSync(temp);}catch{}}
}
async function servePhotoThumbnail(req,res,key) {
  const item=catalog.items.find(x=>x.key===key&&x.state==='ready'&&itemMediaKind(x)==='image');
  if(!item){res.writeHead(404);res.end();return;}
  let promise=photoThumbJobs.get(key);
  if(!promise){
    promise=enqueuePhotoThumb(()=>createPhotoThumb(item));
    photoThumbJobs.set(key,promise);
    promise.finally(()=>photoThumbJobs.delete(key)).catch(()=>{});
  }
  try {
    const file=await promise,stat=fs.statSync(file);
    res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':stat.size,'Cache-Control':'private, max-age=86400'});
    fs.createReadStream(file).pipe(res);
  }catch{
    // 缩略图失败时回退原图，不让图片变成灰色空白。
    streamMedia(req,res,item);
  }
}
// v6.46 — receive an already rasterized still-photo crop. Strictly bounded binary
// payload and independently validated local catalog source. No source overwrite.
async function jfReadPhotoCrop(req){
  const MAX=32*1024*1024, length=Number(req.headers['content-length']);
  if(Number.isFinite(length)&&length>MAX)throw Error('裁剪图片超过 32 MiB 上限');
  const buffers=[];let total=0;
  for await(const chunk of req){
    total+=chunk.length;
    if(total>MAX)throw Error('裁剪图片超过 32 MiB 上限');
    buffers.push(chunk);
  }
  if(total<32)throw Error('裁剪图片数据不完整');
  return Buffer.concat(buffers,total);
}
async function jfSavePhotoCrop(req){
  jfAsrCheckOrigin(req);
  const key=String(req.headers['x-justfun-media-key']||'');
  if(!/^[a-f0-9]{16}$/.test(key))throw Error('图片编号无效');
  const item=catalog.items.find(x=>x.key===key&&x.state==='ready'&&itemMediaKind(x)==='image');
  if(!item)throw Error('当前媒体不支持静态裁剪');
  const mime=String(req.headers['content-type']||'').split(';')[0].trim();
  if(!['image/jpeg','image/png'].includes(mime))throw Error('仅允许 JPEG 或 PNG 裁剪结果');
  const content=await jfReadPhotoCrop(req);
  const isJpg=content.subarray(0,3).equals(Buffer.from([255,216,255])) && content[content.length-2]===255&&content[content.length-1]===217;
  const isPng=content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if((mime==='image/jpeg'&&!isJpg)||(mime==='image/png'&&!isPng))throw Error('文件内容与图像格式不匹配');
  // Do not accept a new symlink or changed source between opening the viewer and saving.
  const original=managedPath(item), info=fs.lstatSync(original);
  if(!info.isFile()||info.isSymbolicLink())throw Error('原图已改变，请刷新图库');
  const realRoot=fs.realpathSync(targetDir),realParent=fs.realpathSync(path.dirname(original));
  const rel=path.relative(realRoot,realParent);
  if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('裁剪目标目录越界');
  const folderInfo=fs.lstatSync(path.dirname(original));
  if(!folderInfo.isDirectory()||folderInfo.isSymbolicLink())throw Error('目标目录不安全');
  const name=String(item.originalName||item.managedName||'照片');
  const stem=path.parse(name).name.replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').replace(/[. ]+$/,'').slice(0,78)||'照片';
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/T/,'-').replace(/\..*$/,'');
  const ext=mime==='image/jpeg'?'.jpg':'.png';
  let saved='';
  for(let tries=0;tries<5;tries++){
    const dest=path.join(realParent,stem+'-裁剪-'+stamp+'-'+crypto.randomBytes(3).toString('hex')+ext);
    try{fs.writeFileSync(dest,content,{flag:'wx',mode:0o600});saved=dest;break;}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  if(!saved)throw Error('无法生成不重复的裁剪文件名');
  // Persist the generated file first; the library scanner can later index it
  // even if an interrupted scan needs to be retried.
  let scanError='';
  try{await scanAll('新裁剪图片已保存');}catch(error){scanError=String(error.message||'索引更新失败');}
  return {fileName:path.basename(saved),indexed:!scanError,warning:scanError?'裁剪已保存，刷新图库后可查看：'+scanError:''};
}
