


function makeExtensionlessCoverName(seed) {
  return crypto
    .createHash('sha256')
    .update(
      String(seed) +
      '|' +
      Date.now() +
      '|' +
      crypto
        .randomBytes(8)
        .toString('hex')
    )
    .digest('hex')
    .slice(0, 32);
}

function migrateLegacyCoverFiles() {
  let changed = false;
  let migrated = 0;

  // 1. 先迁移 data.json 中明确引用的旧封面。
  for (const item of catalog.items) {
    if (!item.cover) {
      continue;
    }

    const oldRel =
      String(item.cover);

    const oldFull =
      path.join(
        ASSET_DIR,
        oldRel
      );

    if (
      !fs.existsSync(
        oldFull
      )
    ) {
      continue;
    }

    if (
      !path.extname(
        path.basename(
          oldRel
        )
      )
    ) {
      continue;
    }

    let newName;

    do {
      newName =
        makeExtensionlessCoverName(
          item.key +
          '|' +
          oldRel
        );
    } while (
      fs.existsSync(
        path.join(
          COVER_DIR,
          newName
        )
      )
    );

    const newRel =
      `covers/${newName}`;

    const newFull =
      path.join(
        ASSET_DIR,
        newRel
      );

    try {
      fs.renameSync(
        oldFull,
        newFull
      );

      item.cover =
        newRel;

      changed =
        true;

      migrated++;

      logStep(
        `旧封面去后缀：${path.basename(oldFull)} → ${newName}`
      );
    } catch (error) {
      logStep(
        `旧封面迁移失败：${path.basename(oldFull)} · ${error.message}`
      );
    }
  }

  // 2. 再处理 covers 目录中遗留的孤立带后缀文件。
  //    即便已不在 data.json 中引用，也不让目录里继续出现 .jpg/.png 等。
  try {
    const files =
      fs.readdirSync(
        COVER_DIR,
        {
          withFileTypes: true
        }
      );

    for (const entry of files) {
      if (!entry.isFile()) {
        continue;
      }

      if (
        !path.extname(
          entry.name
        )
      ) {
        continue;
      }

      const oldFull =
        path.join(
          COVER_DIR,
          entry.name
        );

      let newName;

      do {
        newName =
          makeExtensionlessCoverName(
            entry.name
          );
      } while (
        fs.existsSync(
          path.join(
            COVER_DIR,
            newName
          )
        )
      );

      try {
        fs.renameSync(
          oldFull,
          path.join(
            COVER_DIR,
            newName
          )
        );

        migrated++;

        logStep(
          `遗留截图去后缀：${entry.name} → ${newName}`
        );
      } catch (error) {
        logStep(
          `遗留截图迁移失败：${entry.name} · ${error.message}`
        );
      }
    }
  } catch {}

  if (changed) {
    saveCatalog();
  }

  if (migrated) {
    logStep(
      `截图迁移完成：共处理 ${migrated} 个旧文件`
    );
  } else {
    logStep(
      '截图迁移检查：没有发现带后缀的旧截图'
    );
  }
}

function recoverPendingImports() {
  let changed = false;

  for (
    const item of catalog.items
  ) {
    if (
      item.state !==
      'pending'
    ) {
      continue;
    }

    const managed =
      managedPath(
        item
      );

    const original =
      originalPendingPath(
        item
      );

    if (
      fs.existsSync(
        managed
      )
    ) {
      item.state =
        'ready';
      if(item.pendingOriginalName){delete item.pendingOriginalName;item.readOnly=false;}

      changed =
        true;

      continue;
    }

    if (
      original &&
      fs.existsSync(
        original
      )
    ) {
      try {
        fs.renameSync(
          original,
          managed
        );

        item.state =
          'ready';
        if(item.pendingOriginalName){delete item.pendingOriginalName;item.readOnly=false;}

        changed =
          true;

        logStep(
          `恢复上次未完成导入：${item.originalName} → ${item.managedName}`
        );
      } catch (error) {
        logStep(
          `恢复导入失败：${item.originalName} · ${error.message}`
        );
      }
    }
  }

  const before =
    catalog.items.length;

  catalog.items =
    catalog.items.filter(
      item =>
        item.state !== 'pending' ||
        fs.existsSync(
          managedPath(
            item
          )
        ) ||
        (
          item.originalName &&
          fs.existsSync(
            originalPendingPath(
              item
            )
          )
        )
    );

  if (
    changed ||
    before !==
      catalog.items.length
  ) {
    saveCatalog();
  }
}

// 管理 data/ 内分组目录：原名只存在 data.json，磁盘上是 32 位 hash。
function folderInCatalog(relativeDir) {
  return catalog.folders.find(f => f.relativeDir === relativeDir);
}

function randomFolderHash(parentDir) {
  let h;
  do {
    h = crypto.randomBytes(16).toString('hex');
  } while (fs.existsSync(path.join(targetDir, safeMediaRelativeDir(parentDir), h)));
  return h;
}

function recoverPendingFolders() {
  let changed = false;
  for (const folder of catalog.folders) {
    if (folder.state !== 'pending') continue;
    const parent = path.join(targetDir, safeMediaRelativeDir(folder.parentDir));
    const dest = path.join(targetDir, safeMediaRelativeDir(folder.relativeDir));
    const source = path.join(parent, folder.originalName);
    if (fs.existsSync(dest)) {
      folder.state = 'ready'; changed = true;
    } else if (fs.existsSync(source)) {
      fs.renameSync(source, dest);
      folder.state = 'ready'; changed = true;
    }
  }
  if (changed) saveCatalog();
}

// 和根目录导入一样，先提交 pending 元数据再改名，防止异常中断丢失原名。
function importDataFile(fullPath, relativeDir, entry) {
  const ext = path.extname(entry.name).toLowerCase();
  if (isArchiveSidecar(entry.name) || !MEDIA_EXTENSIONS.has(ext)) return;
  const stat = fs.statSync(fullPath);
  if (!stat.isFile() || isPaxHeaderPayload(fullPath,stat)) return;
  const parsed = parseOriginalName(entry.name);
  if (!HASH_ENABLED) {
    if (!catalog.items.some(x => x.relativeDir===relativeDir && x.managedName===entry.name)) {
      catalog.items.push({key:hashKey(relativeDir+'/'+entry.name),managedName:entry.name,originalName:entry.name,
        originalExt:ext,relativeDir,kind:mediaKindFromExt(ext),mime:MIME_BY_EXT[ext]||'application/octet-stream',
        creator:parsed.creator,title:parsed.title,rating:0,rotation:0,cover:'',coverTime:0,
        duration:0,durationText:'',width:0,height:0,resolution:'',codec:'',size:stat.size,
        sizeText:formatBytes(stat.size),importedAt:new Date().toISOString(),modifiedTimeMs:Number(stat.mtimeMs)||0,
        modifiedAt:new Date(stat.mtimeMs).toISOString(),fingerprint:`${stat.size}-${Math.floor(stat.mtimeMs)}`,state:'ready'});
      saveCatalog();
    }
    return;
  }
  let managedName;
  do {
    managedName = makeManagedName(entry.name, stat);
  } while (fs.existsSync(path.join(path.dirname(fullPath), managedName)));
  const item = {
    key:hashKey(managedName), managedName, originalName:entry.name,
    originalExt:ext, relativeDir,
    kind:mediaKindFromExt(ext), mime:MIME_BY_EXT[ext] || 'application/octet-stream',
    creator:parsed.creator, title:parsed.title, rating:0, rotation:0,
    cover:'', coverTime:0, duration:0, durationText:'', width:0, height:0,
    resolution:'', codec:'', size:stat.size, sizeText:formatBytes(stat.size),
    importedAt:new Date().toISOString(),
    modifiedTimeMs:Number(stat.mtimeMs)||0, modifiedAt:new Date(stat.mtimeMs).toISOString(),
    fingerprint:`${stat.size}-${Math.floor(stat.mtimeMs)}`, state:'pending'
  };
  catalog.items.push(item);
  saveCatalog();
  fs.renameSync(fullPath, managedPath(item));
  item.state = 'ready';
  saveCatalog();
}

function ingestDataTree() {
  fs.mkdirSync(DATA_DIR, {recursive:true});
  recoverPendingFolders();
  const walk = (relativeDir, depth) => {
    if (depth > 12) return;
    const dir = path.join(targetDir, safeMediaRelativeDir(relativeDir));
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      if (entry.isSymbolicLink() || isArchiveSidecar(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (relativeDir === 'data' && [FRAME_SUBDIR, AUDIO_SUBDIR].includes(entry.name)) {
          walk(relativeDir + '/' + entry.name, depth + 1);
          continue;
        }
        let childName = entry.name;
        if (!HASH_ENABLED) {
          if(!folderInCatalog(relativeDir+'/'+childName)) {
            catalog.folders.push({relativeDir:relativeDir+'/'+childName,parentDir:relativeDir,originalName:childName,state:'ready'});
            saveCatalog();
          }
          walk(relativeDir+'/'+childName,depth+1);
          continue;
        }
        if (!safeManagedName(childName)) {
          const hash = randomFolderHash(relativeDir);
          const newRel = relativeDir + '/' + hash;
          const record = {relativeDir:newRel, parentDir:relativeDir,
            originalName:childName, state:'pending'};
          catalog.folders.push(record);
          saveCatalog();
          fs.renameSync(full, path.join(dir, hash));
          record.state = 'ready';
          saveCatalog();
          childName = hash;
        } else if (!folderInCatalog(relativeDir + '/' + childName)) {
          // 如果磁盘有未知 hash 目录但索引丢失，绝不猜测或覆盖原名。
          continue;
        }
        walk(relativeDir + '/' + childName, depth + 1);
      } else if (entry.isFile()) {
        if (safeManagedName(entry.name)) continue;
        if (MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          importDataFile(full, relativeDir, entry);
        }
      }
    }
  };
  walk('data', 0);
}

// The library has ONE global Hash setting. `source/` is a legacy virtual path
// prefix for existing nested folders, never a second "work-directory mode".
// Neither folders nor media acquire a different Hash policy from their location.
function jfLstatExists(full){
  try{fs.lstatSync(full);return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function jfCheckOrdinaryMediaFile(file,stat,ext){
  if(!MEDIA_EXTENSIONS.has(ext) || !stat.isFile() || stat.isSymbolicLink())
    throw new Error('不是可管理的普通媒体文件');
  // No symlinks/reparse points in source-folder ancestors. Preserve all documents.
  let current=targetDir;
  const relative=path.relative(targetDir,path.dirname(file));
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('媒体文件超出库目录');
  for(const part of relative.split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    const info=fs.lstatSync(current);
    if(!info.isDirectory()||info.isSymbolicLink())throw new Error('目录包含符号链接，拒绝导入');
  }
}
// Rename an already-indexed original-name media file without changing its key,
// caption, notes, clips, playback metadata, or the containing folder.
// Persist the target + pending source name before touching any media bytes.
function jfHashAdoptIndexedMedia(item,oldFull,stat){
  if(!HASH_ENABLED || item.state!=='ready' || safeManagedName(item.managedName))return false;
  const ext=path.extname(item.managedName).toLowerCase();
  jfCheckOrdinaryMediaFile(oldFull,stat,ext);
  if(ext!==String(item.originalExt||'').toLowerCase())throw new Error('原媒体扩展名已改变，拒绝匿名改名');
  const current=fs.lstatSync(oldFull);
  if(!current.isFile()||current.isSymbolicLink()||current.size!==stat.size||
     Math.floor(current.mtimeMs)!==Math.floor(stat.mtimeMs)||
     current.dev!==stat.dev||current.ino!==stat.ino)
    throw new Error('媒体文件正在外部变化，稍后重新扫描');
  const oldName=item.managedName,oldReadOnly=item.readOnly;
  let newName,newFull;
  do{
    newName=makeManagedName(oldName,stat);
    newFull=path.join(path.dirname(oldFull),newName);
  }while(jfLstatExists(newFull));
  item.managedName=newName;
  item.pendingOriginalName=oldName;
  item.state='pending';
  try{saveCatalog();}
  catch(error){item.managedName=oldName;delete item.pendingOriginalName;item.state='ready';throw error;}
  try{fs.renameSync(oldFull,newFull);}
  catch(error){
    item.managedName=oldName;delete item.pendingOriginalName;
    item.state='ready';item.readOnly=oldReadOnly;
    saveCatalog();throw error;
  }
  item.state='ready';item.readOnly=false;
  delete item.pendingOriginalName;
  saveCatalog();
  return true;
}

function ingestSourceTree(){
  const isSource=x=>x.relativeDir==='source'||String(x.relativeDir||'').startsWith('source/');
  const indexed=new Map(catalog.items.filter(isSource).map(x=>[x.relativeDir+'/'+x.managedName,x]));
  const folders=new Map(catalog.folders.filter(x=>x.relativeDir==='source'||x.relativeDir.startsWith('source/'))
    .map(x=>[x.relativeDir,x]));
  let changed=false;
  const discovered=new Set(),seenDirs=new Set(['source']);
  const walk=(absolute,virtual,depth)=>{
    if(depth>32)return;
    let children;
    try{children=fs.readdirSync(absolute,{withFileTypes:true});}catch{return;}
    for(const entry of children){
      if(entry.isSymbolicLink()||isArchiveSidecar(entry.name)||entry.name.startsWith('.')||
         entry.name==='node_modules'||entry.name==='.git')continue;
      if(depth===0&&entry.name==='data')continue;
      const physical=path.join(absolute,entry.name);
      if(entry.isDirectory()){
        if(depth<32)walk(physical,virtual+'/'+entry.name,depth+1);
        continue;
      }
      if(!entry.isFile())continue;
      // Root media belong exclusively to ingestNewFiles(), never to the
      // backward-compatible nested-folder virtual index.
      if(depth===0)continue;
      const id=virtual+'/'+entry.name;
      let item=indexed.get(id);
      const ext=path.extname(entry.name).toLowerCase();
      // Anonymous files have no extension, but are recognized through the
      // persisted catalog rather than guessed from their contents.
      if(!item&&!MEDIA_EXTENSIONS.has(ext))continue;
      let stat;
      try{stat=fs.lstatSync(physical);if(!stat.isFile()||stat.isSymbolicLink())continue;}
      catch{continue;}
      if(!item&&isPaxHeaderPayload(physical,stat))continue;
      let parent=virtual;
      while(parent&&parent!=='source'){
        seenDirs.add(parent);parent=parent.slice(0,parent.lastIndexOf('/'));
      }
      const fp=`${stat.size}-${Math.floor(stat.mtimeMs)}`;
      if(item){
        if(item.state==='pending'){
          discovered.add(id);continue;
        }
        if(item.fingerprint!==fp){
          item.fingerprint=fp;item.size=stat.size;item.sizeText=formatBytes(stat.size);
          item.modifiedTimeMs=Number(stat.mtimeMs)||0;
          item.modifiedAt=new Date(stat.mtimeMs).toISOString();
          item.duration=0;item.durationText='';item.resolution='';
          item.width=0;item.height=0;item.codec='';item.cover='';item.coverTime=0;
          item.probeAttemptFingerprint='';item.coverAttemptFingerprint='';changed=true;
        }
      }else{
        const parsed=parseOriginalName(entry.name);
        item={key:hashKey('source/'+id),managedName:entry.name,originalName:entry.name,
          relativeDir:virtual,readOnly:false,originalExt:ext,kind:mediaKindFromExt(ext),
          mime:MIME_BY_EXT[ext]||'application/octet-stream',creator:parsed.creator,title:parsed.title,
          rating:0,rotation:0,cover:'',coverTime:0,duration:0,durationText:'',width:0,height:0,
          resolution:'',codec:'',size:stat.size,sizeText:formatBytes(stat.size),
          importedAt:new Date().toISOString(),modifiedTimeMs:Number(stat.mtimeMs)||0,
          modifiedAt:new Date(stat.mtimeMs).toISOString(),fingerprint:fp,state:'ready'};
        catalog.items.push(item);indexed.set(id,item);changed=true;
        // For Hash mode, persist the original identity first, then the pending
        // rename journal; a crash between these writes is still recoverable.
        if(HASH_ENABLED)saveCatalog();
      }
      if(HASH_ENABLED&&!safeManagedName(item.managedName)){
        try{jfHashAdoptIndexedMedia(item,physical,stat);changed=true;}
        catch(error){logStep('子目录媒体匿名命名失败：'+entry.name+' · '+error.message);}
      }
      if(!HASH_ENABLED&&item.readOnly){item.readOnly=false;changed=true;}
      discovered.add(item.relativeDir+'/'+item.managedName);
    }
  };
  walk(targetDir,'source',0);
  const before=catalog.items.length;
  // Never discard a write-ahead pending record during an interrupted rename.
  catalog.items=catalog.items.filter(x=>x.state==='pending'||!isSource(x)||discovered.has(x.relativeDir+'/'+x.managedName));
  if(before!==catalog.items.length)changed=true;
  const beforeFolders=catalog.folders.length;
  catalog.folders=catalog.folders.filter(x=>!(x.relativeDir==='source'||x.relativeDir.startsWith('source/'))||seenDirs.has(x.relativeDir));
  if(beforeFolders!==catalog.folders.length)changed=true;
  for(const dir of seenDirs){
    if(dir==='source'||folders.has(dir))continue;
    const i=dir.lastIndexOf('/');
    catalog.folders.push({relativeDir:dir,parentDir:dir.slice(0,i),originalName:dir.slice(i+1),state:'ready',readOnly:true});
    changed=true;
  }
  const hasSource=discovered.size>0;
  const sourceRoot=catalog.folders.find(x=>x.relativeDir==='source');
  if(hasSource&&!sourceRoot){
    catalog.folders.push({relativeDir:'source',parentDir:'root',originalName:'子目录',state:'ready',readOnly:true});
    changed=true;
  }
  if(!hasSource&&sourceRoot){catalog.folders=catalog.folders.filter(x=>x!==sourceRoot);changed=true;}
  if(sourceRoot&&sourceRoot.originalName==='工作学习目录'){
    sourceRoot.originalName='子目录';changed=true;
  }
  if(changed)saveCatalog();
}

// No inferred "mixed workspace" mode: hashEnabled is the library-wide switch.

function ingestNewFiles() {
  const started =
    Date.now();
  const entries =
    fs.readdirSync(
      targetDir,
      {
        withFileTypes: true
      }
    );

  const candidates =
    entries.filter(
      entry =>
        entry.isFile() &&
        !isArchiveSidecar(entry.name) &&
        MEDIA_EXTENSIONS.has(
          path
            .extname(entry.name)
            .toLowerCase()
        )
    );

  if (!candidates.length) {
    return {
      added: 0,
      failed: 0
    };
  }

  logStep(
    `发现 ${candidates.length} 个新增媒体文件`
  );

  let added = 0;
  let failed = 0;
  // Original-name imports do not mutate source files. Index each filename at
  // most once, then atomically persist the catalog once after the scan.
  // Hash imports must retain their per-file journal-before-rename semantics.
  // Legacy mixed-workspace imports may already be indexed under original names.
  // Never silently re-import, rename or duplicate those existing source files.
  const existingRootNames=new Map(catalog.items
    .filter(x=>(x.relativeDir||'')==='').map(x=>[x.managedName,x]));

  for (
    const entry of candidates
  ) {
    const originalPath =
      path.join(
        targetDir,
        entry.name
      );

    try {
      const stat =
        fs.statSync(
          originalPath
        );
      if(isPaxHeaderPayload(originalPath,stat))continue;
      if(existingRootNames.has(entry.name)){
        const old=existingRootNames.get(entry.name);
        if(HASH_ENABLED&&old.state==='ready'&&!safeManagedName(old.managedName)){
          try{jfHashAdoptIndexedMedia(old,originalPath,stat);added++;}
          catch(error){failed++;logStep('旧原名媒体匿名命名失败：'+entry.name+' · '+error.message);}
        }
        continue;
      }

      if (!HASH_ENABLED) {
        // In non-Hash mode, retain the original filename in any folder.
        if (!existingRootNames.has(entry.name)) {
          const ext=path.extname(entry.name).toLowerCase();
          const parsed=parseOriginalName(entry.name);
          catalog.items.push({key:hashKey('root/'+entry.name),managedName:entry.name,originalName:entry.name,
            originalExt:ext,kind:mediaKindFromExt(ext),mime:MIME_BY_EXT[ext]||'application/octet-stream',
            readOnly:false,creator:parsed.creator,title:parsed.title,rating:0,rotation:0,cover:'',coverTime:0,
            duration:0,durationText:'',width:0,height:0,resolution:'',codec:'',size:stat.size,
            sizeText:formatBytes(stat.size),importedAt:new Date().toISOString(),
            modifiedTimeMs:Number(stat.mtimeMs)||0,modifiedAt:new Date(stat.mtimeMs).toISOString(),
            fingerprint:`${stat.size}-${Math.floor(stat.mtimeMs)}`,state:'ready'});
          existingRootNames.set(entry.name,catalog.items[catalog.items.length-1]);added++;
        }
        continue;
      }

      const parsed =
        parseOriginalName(
          entry.name
        );

      let managedName;

      do {
        managedName =
          makeManagedName(
            entry.name,
            stat
          );
      } while (
        fs.existsSync(
          path.join(
            targetDir,
            managedName
          )
        )
      );

      const originalExt =
        path
          .extname(
            entry.name
          )
          .toLowerCase();

      const kind =
        mediaKindFromExt(
          originalExt
        );

      const item = {
        key:
          hashKey(
            managedName
          ),
        managedName,
        originalName:
          entry.name,
        originalExt,
        kind,
        mime:
          MIME_BY_EXT[
            originalExt
          ] ||
          'application/octet-stream',
        creator:
          parsed.creator,
        title:
          parsed.title,
        rating: 0,
        rotation: 0,
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
        modifiedTimeMs:
          Number(stat.mtimeMs) || 0,
        modifiedAt:
          Number(stat.mtimeMs)
            ? new Date(stat.mtimeMs)
                .toISOString()
            : '',
        fingerprint:
          `${stat.size}-${Math.floor(stat.mtimeMs)}`,
        state:
          'pending'
      };

      // 先记录原名与 hash 映射，避免程序恰好在 rename 后崩溃导致映射丢失。
      catalog.items.push(
        item
      );

      saveCatalog();

      fs.renameSync(
        originalPath,
        managedPath(
          item
        )
      );

      item.state =
        'ready';

      saveCatalog();

      added++;

      logStep(
        `导入：${entry.name} → ${managedName}`
      );
    } catch (error) {
      failed++;

      logStep(
        `导入失败：${entry.name} · ${error.message}`
      );
    }
  }

  // A failed commit is a hard failure: never report in-memory only entries
  // as imported, and do not change the original files. Retrying is safe.
  if(!HASH_ENABLED && added)saveCatalog();

  logStep(
    `新增视频处理完成：成功 ${added}，失败 ${failed}，耗时 ${elapsedText(started)}`
  );

  return {
    added,
    failed
  };
}

function reconcileCatalog() {
  const before =
    catalog.items.length;

  catalog.items =
    catalog.items.filter(
      item => {
        if (
          item.state ===
          'pending'
        ) {
          return true;
        }

        const exists =
          fs.existsSync(
            managedPath(
              item
            )
          );

        if (!exists) {
          removeCover(
            item
          );
        }

        return exists;
      }
    );

  const removed =
    before -
    catalog.items.length;

  if (removed) {
    logStep(
      `清理 ${removed} 个已不存在的视频记录`
    );

    saveCatalog();
  }
}

function syncFileModificationTimes() {
  let changed = false;

  for (const item of catalog.items) {
    if (item.state !== 'ready') {
      continue;
    }

    try {
      const file=managedPath(item);
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink())continue;
      const modifiedTimeMs =
        Number(stat.mtimeMs) || 0;

      const modifiedAt =
        modifiedTimeMs
          ? new Date(modifiedTimeMs)
              .toISOString()
          : '';

      if (
        Number(item.modifiedTimeMs || 0) !==
          modifiedTimeMs ||
        String(item.modifiedAt || '') !==
          modifiedAt
      ) {
        item.modifiedTimeMs =
          modifiedTimeMs;
        item.modifiedAt =
          modifiedAt;
        changed = true;
      }
      // An external editor can update an indexed work/study media file.
      // Refresh its deletion guard on the normal scan so explicit deletion
      // does not permanently fail on an old size/mtime fingerprint.
      if(item.readOnly===true && MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())){
        const fingerprint=`${stat.size}-${Math.floor(stat.mtimeMs)}`;
        if(item.fingerprint!==fingerprint){
          item.fingerprint=fingerprint;
          item.size=stat.size;
          item.sizeText=formatBytes(stat.size);
          changed=true;
        }
      }
    } catch {}
  }

  if (changed) {
    saveCatalog();
  }

  return changed;
}

async function probeVideo(filePath) {
  if (!HAS_FFPROBE) {
    return {};
  }

  // Never block all HTTP requests while probing a malformed/unresponsive video.
  const result=await new Promise(resolve=>{
    let child,stdout='',size=0,settled=false;
    const done=(status)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      if(child)activeMediaChildren.delete(child);
      resolve({status,stdout});
    };
    try{child=spawn('ffprobe',['-v','error','-print_format','json',
      '-show_format','-show_streams',filePath],{windowsHide:true,stdio:['ignore','pipe','ignore']});}
    catch{return resolve({status:-1,stdout:''});}
    activeMediaChildren.add(child);
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{};done(-1);},15000);
    child.stdout.on('data',buf=>{
      size+=buf.length;
      if(size>5*1024*1024){try{child.kill('SIGKILL');}catch{};done(-1);}
      else if(!settled)stdout+=buf.toString();
    });
    child.on('error',()=>done(-1));
    child.on('close',code=>done(code));
  });

  if (
    result.status !== 0 ||
    !result.stdout
  ) {
    return {};
  }

  try {
    const data =
      JSON.parse(
        result.stdout
      );

    const video =
      (data.streams || [])
        .find(
          stream =>
            stream.codec_type ===
            'video'
        ) || {};

    const duration =
      Number(
        data.format &&
        data.format.duration
      ) ||
      Number(
        video.duration
      ) ||
      0;

    const width =
      Number(
        video.width
      ) || 0;

    const height =
      Number(
        video.height
      ) || 0;

    const tags={...(data.format?.tags||{}),...(video.tags||{})};
    const appleLive=Object.entries(tags).some(([k,v])=>/com\.apple\.quicktime\.content\.identifier/i.test(k) && typeof v==='string' && v.trim().length>5);
    return {
      appleLive,
      duration,
      durationText:
        formatDuration(
          duration
        ),
      width,
      height,
      resolution:
        width && height
          ? `${width}×${height}`
          : '',
      codec:
        video.codec_name || ''
    };
  } catch {
    return {};
  }
}

function clampCoverTime(
  duration,
  time
) {
  duration =
    Number(duration);

  time =
    Number(time);

  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return 0;
  }

  if (
    !Number.isFinite(time)
  ) {
    time =
      duration * 0.35;
  }

  return Math.max(
    0.2,
    Math.min(
      Math.max(
        0.2,
        duration - 0.2
      ),
      time
    )
  );
}

async function writeCover(
  item,
  time,
  precise = false,
  frameIndex = null
) {
  if (
    NO_SCREENSHOT ||
    !HAS_FFMPEG ||
    !item.duration
  ) {
    return null;
  }

  const t = precise
    ? Math.max(0,Math.min(Number(time)||0,Math.max(0,Number(item.duration)-0.001)))
    : clampCoverTime(item.duration,time);

  const stamp =
    Date.now()
      .toString(36) +
    '-' +
    crypto
      .randomBytes(3)
      .toString('hex');

  const rel =
    `covers/${
      crypto
        .createHash('sha256')
        .update(
          item.key +
          '|' +
          stamp +
          '|' +
          t
        )
        .digest('hex')
        .slice(0, 32)
    }`;

  const out =
    path.join(
      ASSET_DIR,
      rel
    );

  const temp =
    out + '.tmp.jpg';

  const indexed=Number.isSafeInteger(frameIndex)&&frameIndex>=0&&frameIndex<=120000;
  // Async capture: never block the HTTP loop while FFmpeg is decoding.
  // A stalled encoder must be killed, with the old cover left untouched.
  let succeeded=false;
  try {
    await runCommand('ffmpeg',[
      '-hide_banner','-loglevel','error','-nostdin','-y',
      ...(indexed?[]:['-ss',String(t)]),
      '-i',managedPath(item),'-frames:v','1',
      ...(indexed?['-vsync','0']:[]),
      '-vf',indexed?`select=eq(n\\,${frameIndex}),scale=720:-2`:'scale=720:-2',
      '-q:v','4',temp
    ],{stdio:['ignore','ignore','pipe'],timeoutMs:60000});
    succeeded=true;
  } catch (error) {
    try {fs.unlinkSync(temp);} catch {}
    throw error;
  }

  if (
    !succeeded ||
    !fs.existsSync(
      temp
    )
  ) {
    try {
      fs.unlinkSync(
        temp
      );
    } catch {}

    return null;
  }

  fs.renameSync(
    temp,
    out
  );

  const old =
    coverFullPath(
      item
    );

  item.cover =
    rel;

  item.coverTime =
    t;

  if (
    old &&
    old !== out
  ) {
    try {
      if (
        fs.existsSync(
          old
        )
      ) {
        fs.unlinkSync(
          old
        );
      }
    } catch {}
  }

  return {
    rel,
    time:t
  };
}

async function enrichCatalog() {
  const started =
    Date.now();

  const jobs =
    catalog.items.filter(
      item => {
        if (
          item.state !==
          'ready'
        ) {
          return false;
        }

        if (itemMediaKind(item) !== 'video') return false;

        const cover=coverFullPath(item);
        const freshProbe=REFRESH || ((!item.duration||!item.resolution) &&
          (!item.probeAttemptFingerprint||item.probeAttemptFingerprint!==item.fingerprint));
        const missingCover=!item.cover||!cover||!fs.existsSync(cover);
        const freshCover=!NO_SCREENSHOT && (REFRESH||missingCover) &&
          (REFRESH||!item.coverAttemptFingerprint||item.coverAttemptFingerprint!==item.fingerprint);
        return freshProbe || (freshCover && (item.duration>0||freshProbe));
      }
    );

  logStep(
    `缓存检查：共 ${catalog.items.length} 个媒体，视频需要处理 ${jobs.length}`
  );

  // 没有待处理视频时，不更新索引时间戳、不重写 data.json/.bak。
  // 原版本每 15 秒无条件保存一次，导致浏览器重复拉取完整媒体库。
  if (!jobs.length) {
    const message = HASH_ENABLED ? '就绪 · 匿名媒体库' : '就绪 · 原名媒体库';
    if (catalog.scanStatus !== 'ready' || catalog.scanMessage !== message) {
      catalog.scanStatus = 'ready';
      catalog.scanMessage = message;
      saveCatalog();
    }
    return;
  }

  catalog.scanStatus = 'scanning';

  for (
    let i = 0;
    i < jobs.length;
    i++
  ) {
    const item =
      jobs[i];

    catalog.scanMessage =
      `正在处理 ${i + 1}/${jobs.length}：${item.creator || '未设置创作者'} · ${item.title}`;

    saveCatalog();

    const itemStarted =
      Date.now();

    if(REFRESH || ((!item.duration||!item.resolution) &&
      (!item.probeAttemptFingerprint||item.probeAttemptFingerprint!==item.fingerprint))){
      const meta=await probeVideo(managedPath(item));
      // Apple metadata and an accompanying same-stem still image are strong indicators.
      // Exported MP4 may have lost both: those remain video until the owner classifies them.
      const stillBase=path.parse(item.originalName||item.managedName||'').name.toLowerCase();
      const paired=Number(meta.duration)>0&&Number(meta.duration)<=10&&catalog.items.some(other=>
        other!==item&&other.state==='ready'&&other.relativeDir===item.relativeDir&&
        IMAGE_EXTENSIONS.has(String(other.originalExt||'').toLowerCase())&&
        path.parse(other.originalName||other.managedName||'').name.toLowerCase()===stillBase);
      Object.assign(item,meta);
      if(item.livePhotoManual!==false && (meta.appleLive||paired))item.livePhoto=true;
      item.probeAttemptFingerprint=item.fingerprint;
    }

    const cover =
      coverFullPath(
        item
      );

    if (
      !NO_SCREENSHOT &&
      item.duration &&
      (
        REFRESH ||
        !item.cover ||
        !cover ||
        !fs.existsSync(
          cover
        )
      )
    ) {
      if(REFRESH || !item.coverAttemptFingerprint || item.coverAttemptFingerprint!==item.fingerprint){
        try {await writeCover(item,item.coverTime || item.duration * 0.35);}
        catch (error) {logStep('封面处理失败：'+error.message);}
        item.coverAttemptFingerprint=item.fingerprint;
      }
    }

    saveCatalog();
    // Do not monopolize the HTTP event loop while indexing a large work tree.
    await new Promise(resolve=>setImmediate(resolve));

    logStep(
      `[${i + 1}/${jobs.length}] 完成：${elapsedText(itemStarted)}`
    );
  }

  catalog.scanStatus =
    'ready';

  catalog.scanMessage =
    HASH_ENABLED ? '就绪 · 匿名媒体库' : '就绪 · 原名媒体库';

  saveCatalog();

  logStep(
    `扫描完成：${elapsedText(started)}`
  );
}

let scanRunning = false;
let rescanPending = false;

async function scanAll(
  reason = ''
) {
  if (scanRunning) {
    rescanPending =
      true;

    return;
  }

  scanRunning =
    true;

  try {
    do {
      rescanPending =
        false;

      if (reason) {
        logStep(
          reason
        );
      }

      recoverPendingImports();
      ingestNewFiles();
      ingestDataTree();
      ingestSourceTree();
      reconcileCatalog();
      syncFileModificationTimes();

      await enrichCatalog();
      // Yield between coalesced passes so HTTP playback and library polling
      // cannot be starved by a sustained burst of filesystem changes.
      if (rescanPending) await new Promise(resolve => setImmediate(resolve));
    } while (
      rescanPending
    );
  } finally {
    scanRunning =
      false;
  }
}

// 统一媒体标注。兼容已有 catalog.clips（旧视频 A/B 片段原样保留）。
// b === null 代表单点书签；b > a 代表区间。记录只保存在缓存，绝不写入原媒体。
// Stored as a restricted palette token, never arbitrary CSS or user-provided markup.
const CLIP_COLORS=new Set(['default','amber','rose','violet','green','blue']);
function validClipColor(value){
  if(typeof value!=='string'||!CLIP_COLORS.has(value))throw new Error('标注颜色无效');
  return value;
}
function publicClip(clip) {
  const source = catalog.items.find(item => item.key === clip.sourceKey && item.state === 'ready' &&
    (itemMediaKind(item)==='video' || itemMediaKind(item)==='audio'));
  return {
    id:clip.id, sourceKey:clip.sourceKey, name:clip.name, a:clip.a,
    b:Number.isFinite(clip.b)?clip.b:null,
    kind:source?itemMediaKind(source):(clip.kind==='audio'?'audio':'video'),
    favorite:!!clip.favorite, color:CLIP_COLORS.has(clip.color)?clip.color:'default', createdAt:clip.createdAt, updatedAt:clip.updatedAt,
    sourceTitle:source?(source.title||source.originalName||'未命名媒体'):(clip.sourceTitle||'源媒体'),
    sourceAvailable:!!source, sourceDuration:source?Number(source.duration||0):0
  };
}
function validateClipRange(item, start, end) {
  const a=Number(start), duration=Number(item.duration||0);
  if(!Number.isFinite(a)||a<0||a>604800||(duration>0&&a>duration+.25))
    throw new Error('标注起点无效或超过媒体长度');
  let b=null;
  if(end !== null && end !== undefined && end !== '') {
    b=Number(end);
    if(!Number.isFinite(b)||b-a<.06||b>604800||(duration>0&&b>duration+.25))
      throw new Error('终点必须晚于起点至少 0.06 秒，且不能超过媒体长度');
    b=Math.round(b*1000)/1000;
  }
  return {a:Math.round(a*1000)/1000,b};
}
function validClipName(value) {
  const name=String(value==null?'':value).replace(/[\x00-\x1f\x7f]/g,'').trim();
  if(!name||name.length>100) throw new Error('标注名称应为 1–100 字符');
  return name;
}
function clipSource(key) {
  const item=catalog.items.find(x=>x.key===key&&x.state==='ready'&&
    (itemMediaKind(x)==='video'||itemMediaKind(x)==='audio'));
  if(!item||!fs.existsSync(managedPath(item))) throw new Error('源媒体已不存在，无法操作标注');
  return item;
}
function mutateClip(body) {
  const action=String(body.action||''), clips=catalog.clips;
  if(action==='create') {
    if(clips.length>=10000)throw new Error('标注记录已达上限');
    const source=clipSource(String(body.sourceKey||''));
    const range=validateClipRange(source,body.a,body.b);
    const now=new Date().toISOString();
    const clip={id:crypto.randomBytes(12).toString('hex'),sourceKey:source.key,
      sourceTitle:source.title||source.originalName||'',kind:itemMediaKind(source),
      name:validClipName(body.name),...range,color:body.color===undefined?'default':validClipColor(body.color),favorite:!!body.favorite,createdAt:now,updatedAt:now};
    clips.push(clip);saveCatalog();return publicClip(clip);
  }
  if(!/^[a-f0-9]{24}$/.test(String(body.id||'')))throw new Error('标注 ID 无效');
  const index=clips.findIndex(c=>c.id===body.id);
  if(index<0)throw new Error('标注不存在');
  const clip=clips[index];
  if(action==='delete') {
    clips.splice(index,1);saveCatalog();return {id:body.id};
  }
  if(action==='update') {
    const patch={};
    if(body.name!==undefined)patch.name=validClipName(body.name);
    if(body.a!==undefined||Object.prototype.hasOwnProperty.call(body,'b')){
      Object.assign(patch,validateClipRange(clipSource(clip.sourceKey),
        body.a===undefined?clip.a:body.a,
        Object.prototype.hasOwnProperty.call(body,'b')?body.b:clip.b));
    }
    if(body.color!==undefined)patch.color=validClipColor(body.color);
    if(body.favorite!==undefined) {
      if(typeof body.favorite!=='boolean')throw new Error('收藏状态无效');
      patch.favorite=body.favorite;
    }
    Object.assign(clip,patch,{updatedAt:new Date().toISOString()});
    saveCatalog();return publicClip(clip);
  }
  throw new Error('未知标注操作');
}
