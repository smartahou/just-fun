// Local HLS VOD support. Source playlists are never rewritten on disk.
// Child files are private playlist resources, not independent video cards.
const jfHlsChildKeys=new Set();
let jfHlsServerPort=0;
// The HTTP listener may move from 3865 to 3866 (or another free port).
// FFmpeg must use the actual bound listener, never a guessed URL.
function jfHlsLocalUrl(item){
  if(!jfHlsServerPort)throw Error('HLS 本地播放器服务尚未准备好');
  return 'http://127.0.0.1:'+jfHlsServerPort+'/media/'+item.key;
}
// A very long VOD can have hundreds of thousands of entries. HTTP requests
// must NOT re-scan the entire asset array for every segment/ready check.
const jfHlsRuntimeCache=new WeakMap();
function jfHlsRuntime(item){
  const assets=Array.isArray(item?.hlsAssets)?item.hlsAssets:[];
  const cached=jfHlsRuntimeCache.get(item);
  if(cached&&cached.assets===assets)return cached;
  const byId=new Map(),byOriginal=new Map();
  let allReady=assets.length>0;
  for(const asset of assets){
    if(!asset||asset.state!=='ready'){
      allReady=false;
      continue;
    }
    byId.set(asset.id,asset);
    byOriginal.set(asset.original,asset);
  }
  const runtime={assets,byId,byOriginal,allReady};
  jfHlsRuntimeCache.set(item,runtime);
  return runtime;
}
function jfHlsReady(item){
  return jfHlsIsPlaylist(item)&&!item.hlsError&&jfHlsRuntime(item).allReady;
}
let jfHlsIndexedOriginals=new Map();
let jfHlsIndexedPhysical=new Set();
let jfHlsSharedAssets=new Map();
// 5 MiB/30k segments rejected normal long recordings. Keep bounded safety
// limits, but allow large local VOD playlists and their distinct resources.
const JF_HLS_MAX_ASSETS=200000;
const JF_HLS_MAX_PLAYLIST=64*1024*1024;
function jfHlsIsPlaylist(item){return String(item?.originalExt||'').toLowerCase()==='.m3u8';}
function jfHlsRoot(item){return path.dirname(managedPath(item));}
function jfHlsRelative(value,parent=''){
  let raw=String(value||'').trim();
  // Offline HLS files sometimes retain cache-busting URL parameters from
  // the downloader, while the actual local filenames contain no query string.
  // Strip only the URI query/fragment; never fetch a remote segment.
  raw=raw.split(/[?#]/,1)[0];
  // HLS URIs are URL-encoded even when they refer to local Unicode filenames.
  try{raw=decodeURIComponent(raw);}catch{throw Error('HLS 资源 URI 编码无效');}
  if(!raw||raw.includes('\\')||/[?#]/.test(raw)||raw.startsWith('/')||
     /^[a-z][a-z0-9+.-]*:/i.test(raw)||raw.startsWith('//')||
     /[\x00-\x1f]/.test(raw))throw Error('HLS 只允许本地相对资源路径');
  const rel=path.posix.normalize(path.posix.join(path.posix.dirname(parent||'index.m3u8'),raw));
  if(!rel||rel==='.'||rel==='..'||rel.startsWith('../')||path.posix.isAbsolute(rel))
    throw Error('HLS 资源超出播放清单目录');
  return rel;
}
// Process one line at a time. Avoid materializing two additional giant
// arrays (split lines + URI references) when a playlist is tens of MiB.
function* jfHlsReferences(content){
  const source=String(content);
  let start=0;
  while(start<source.length){
    const end=source.indexOf('\n',start);
    const line=source.slice(start,end<0?source.length:end).trim();
    if(line.startsWith('#')){
      for(const match of line.matchAll(/\bURI="([^"]+)"/g))yield match[1];
    }else if(line)yield line;
    if(end<0)break;
    start=end+1;
  }
}
function jfHlsContained(base,file){
  const rel=path.relative(base,file);
  if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))
    throw Error('HLS 资源越界');
  let current=base;
  for(const part of rel.split(path.sep)){
    current=path.join(current,part);
    const st=fs.lstatSync(current);
    if(st.isSymbolicLink())throw Error('HLS 不允许符号链接资源');
  }
  if(!fs.lstatSync(file).isFile())throw Error('HLS 资源不是普通文件');
  return file;
}
// A data/ subdirectory can have a hashed physical name. Resolve its known
// original label through the folder index; never discover hidden folders.
function jfHlsOriginalPath(item,relative){
  const base=jfHlsRoot(item);
  const pieces=relative.split('/');
  let cursor=base;
  for(let i=0;i<pieces.length;i++){
    const segment=pieces[i];
    if(i<pieces.length-1){
      const folder=catalog.folders.find(f=>f.originalName===segment&&f.state==='ready'&&
        path.resolve(targetDir,safeMediaRelativeDir(f.parentDir))===cursor);
      cursor=path.join(cursor,folder?path.basename(f.relativeDir):segment);
    }else cursor=path.join(cursor,segment);
  }
  const rel=path.relative(base,cursor);
  if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))
    throw Error('HLS 资源路径越界');
  return cursor;
}
function jfHlsStoredPath(item,stored){
  const base=jfHlsRoot(item);
  const full=path.resolve(base,...String(stored).split('/'));
  return jfHlsContained(base,full);
}
function jfHlsExistingAsset(item,relative){
  const base=jfHlsRoot(item);
  let original;
  try{original=jfHlsOriginalPath(item,relative);}catch{return null;}
  // Indexed media or shared HLS resources may already have anonymous files.
  const indexed=jfHlsIndexedOriginals.get(original);
  if(indexed){
    try{
      jfHlsContained(base,indexed.file);
      jfHlsChildKeys.add(indexed.key);
      return indexed.file;
    }catch{}
  }
  const shared=jfHlsSharedAssets.get(original);
  if(shared){
    try{return jfHlsStoredPath(shared.item,shared.asset.stored);}catch{}
  }
  try{return jfHlsContained(base,original);}catch{return null;}
}
function jfHlsScanOne(item){
  const old=Array.isArray(item.hlsAssets)?item.hlsAssets:[];
  const byName=new Map(old.map(a=>[a.original,a]));
  const seen=new Set();
  const queue=[{name:'',file:managedPath(item)}];
  const pending=[];
  const reservedNames=new Set();
  let count=0,changed=false;
  while(queue.length){
    const node=queue.shift();
    let content;
    try{
      const stat=fs.statSync(node.file);
      if(stat.size>JF_HLS_MAX_PLAYLIST)
        throw Error('HLS 清单超过 64 MiB 安全上限');
      content=fs.readFileSync(node.file,'utf8').replace(/^\uFEFF/,'');
      if(!content.startsWith('#EXTM3U'))throw Error('HLS 清单缺少 #EXTM3U');
    }catch(error){item.hlsError=error.message;return changed;}
    for(const value of jfHlsReferences(content)){
      let relative;
      try{relative=jfHlsRelative(value,node.name);}catch(error){item.hlsError=error.message;return changed;}
      if(seen.has(relative))continue;
      if(++count>JF_HLS_MAX_ASSETS){
        item.hlsError='HLS 不同资源超过 200000 个安全上限';return changed;
      }
      seen.add(relative);
      let asset=byName.get(relative);
      let full=null;
      if(asset){
        try{full=jfHlsStoredPath(item,asset.stored);}catch{}
        if(full&&asset.state==='pending'){asset.state='ready';changed=true;}
        if(!full&&asset.state==='pending'){
          try{full=jfHlsExistingAsset(item,relative);}catch{}
          if(full)pending.push({asset,from:full});
        }
      }else{
        full=jfHlsExistingAsset(item,relative);
        if(!full){item.hlsError='HLS 缺少本地分片：'+relative;return changed;}
        const originalExt=path.posix.extname(relative).toLowerCase();
        let stored=path.relative(jfHlsRoot(item),full).split(path.sep).join('/');
        let state='ready';
        const indexed=jfHlsIndexedPhysical.has(full);
        if(HASH_ENABLED&&!indexed&&!safeManagedName(path.basename(full))){
          let anonymous;
          do{anonymous=crypto.randomBytes(16).toString('hex');}
          while(fs.existsSync(path.join(path.dirname(full),anonymous))||
                reservedNames.has(path.join(path.dirname(full),anonymous)));
          const reserved=path.join(path.dirname(full),anonymous);
          reservedNames.add(reserved);
          stored=path.relative(jfHlsRoot(item),reserved).split(path.sep).join('/');
          state='pending';
        }
        asset={id:crypto.createHash('sha256').update(item.key+':'+relative).digest('hex').slice(0,32),
          original:relative,stored,ext:originalExt,state};
        byName.set(relative,asset);changed=true;
        if(state==='pending')pending.push({asset,from:full});
      }
      if(path.posix.extname(relative).toLowerCase()==='.m3u8'){
        // The nested playlist is read before its new anonymous filename is used.
        const actual=full||jfHlsStoredPath(item,asset.stored);
        queue.push({name:relative,file:actual});
      }
    }
  }
  const next=[...byName.values()].filter(a=>seen.has(a.original));
  if(next.length!==old.length)changed=true;
  // Keep the array identity for unchanged scans. This preserves the prebuilt
  // by-ID lookup on large playlists rather than rebuilding it every refresh.
  const sameOrder=!changed&&next.length===old.length&&
    next.every((asset,index)=>asset===old[index]);
  if(!sameOrder){
    item.hlsAssets=next;
    jfHlsRuntimeCache.delete(item);
  }
  delete item.hlsError;
  // Journal all planned name changes BEFORE touching any HLS resource.
  if(changed||pending.length)saveCatalog();
  for(const operation of pending){
    const dest=path.resolve(jfHlsRoot(item),...operation.asset.stored.split('/'));
    try{
      if(fs.existsSync(dest)){operation.asset.state='ready';continue;}
      const from=operation.from;
      if(!from||!fs.existsSync(from))continue;
      jfHlsContained(jfHlsRoot(item),from);
      if(from!==dest)fs.renameSync(from,dest);
      operation.asset.state='ready';changed=true;
    }catch(error){item.hlsError='分片匿名化失败：'+error.message;}
  }
  if(pending.length)saveCatalog();
  return changed;
}
function jfHlsScan(){
  jfHlsChildKeys.clear();
  jfHlsIndexedOriginals=new Map();
  jfHlsIndexedPhysical=new Set();
  jfHlsSharedAssets=new Map();
  for(const item of catalog.items){
    if(item.state!=='ready')continue;
    try{
      const file=managedPath(item);
      jfHlsIndexedPhysical.add(file);
      const original=path.join(path.dirname(file),item.originalName||item.managedName);
      jfHlsIndexedOriginals.set(original,{file,key:item.key});
    }catch{}
  }
  const addShared=item=>{
    for(const asset of item.hlsAssets||[]){
      try{jfHlsSharedAssets.set(jfHlsOriginalPath(item,asset.original),{item,asset});}
      catch{}
    }
  };
  for(const item of catalog.items){
    if(item.state==='ready'&&jfHlsIsPlaylist(item))addShared(item);
  }
  let statusChanged=false;
  for(const item of catalog.items){
    if(item.state!=='ready'||!jfHlsIsPlaylist(item))continue;
    const previous=String(item.hlsError||'');
    try{jfHlsScanOne(item);addShared(item);}
    catch(error){item.hlsError=error.message;}
    if(previous!==String(item.hlsError||''))statusChanged=true;
  }
  if(statusChanged)saveCatalog();
  // Child resources remain in the catalog for identity/recovery; only their
  // duplicate media cards are suppressed.
}
function jfHlsManifest(item,relative,content){
  const lookup=jfHlsRuntime(item).byOriginal;
  const mapUri=(raw)=>{
    const name=jfHlsRelative(raw,relative);
    const asset=lookup.get(name);
    if(!asset)throw Error('HLS 资源未完成索引：'+name);
    // The physical file remains extensionless in Hash mode. The virtual URL
    // carries only the media TYPE suffix: FFmpeg's HLS demuxer refuses
    // extensionless fragment URLs by default, and some codecs need this hint.
    const suffix=/^\.[a-z0-9]{1,10}$/i.test(asset.ext||'')?asset.ext:'.bin';
    return '/api/hls/'+item.key+'/'+asset.id+suffix;
  };
  return String(content).split(/\r?\n/).map(line=>{
    if(line.startsWith('#'))return line.replace(/\bURI="([^"]+)"/g,(_all,url)=>
      'URI="'+mapUri(url)+'"');
    return line.trim()?mapUri(line.trim()):line;
  }).join('\n');
}
function jfHlsServe(req,res,item,id='',requestedExt=''){
  if(!jfHlsIsPlaylist(item)||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
  if(!jfHlsReady(item)){
    res.writeHead(409,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
    res.end('HLS 清单未就绪：'+String(item.hlsError||'资源尚未完成索引').slice(0,240));
    return;
  }
  try{
    const asset=id?jfHlsRuntime(item).byId.get(id):null;
    if(id&&(!asset||(requestedExt&&asset.ext!==requestedExt))){
      res.writeHead(404);res.end();return;
    }
    const file=asset?jfHlsStoredPath(item,asset.stored):managedPath(item);
    const ext=asset?asset.ext:'.m3u8';
    if(ext==='.m3u8'){
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>JF_HLS_MAX_PLAYLIST)
        throw Error('HLS 清单无效');
      const body=jfHlsManifest(item,asset?asset.original:'',
        fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
      res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl; charset=utf-8',
        'Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});
      res.end(req.method==='HEAD'?'':body);
    }else{
      if(req.method==='HEAD'){
        const stat=fs.statSync(file);
        res.writeHead(200,{'Content-Length':stat.size,
          'Content-Type':({'.m4s':'video/iso.segment','.key':'application/octet-stream',
            '.vtt':'text/vtt','.mp4':'video/mp4','.ts':'video/mp2t'}[ext]||MIME_BY_EXT[ext]||'application/octet-stream'),
          'Accept-Ranges':'bytes'});res.end();return;
      }
      streamMedia(req,res,{mime:({'.m4s':'video/iso.segment','.key':'application/octet-stream',
        '.vtt':'text/vtt','.mp4':'video/mp4','.ts':'video/mp2t'}[ext]||
        MIME_BY_EXT[ext]||'application/octet-stream'),originalExt:ext},file);
    }
  }catch(error){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('HLS 资源不可用：'+error.message);}
}
