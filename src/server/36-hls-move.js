// Transactional HLS group moves. An ordinary video renamed *.m3u8 has no
// dependent assets and is deliberately treated as a single media file.
function jfHlsHasCompanions(item){
  if(!jfHlsIsPlaylist(item)||jfHlsDirectVideo(item)||jfHlsBinaryTs(item))
    return false;
  // A malformed/mislabeled standalone file has no indexed dependents. Only
  // an actual text playlist, or an older catalog with saved HLS assets, needs
  // a bundle transaction.
  if(item.hlsDetectedFormat&&item.hlsDetectedFormat!=='playlist'&&
     !item.hlsAssets?.length)return false;
  return true;
}
function jfMoveExists(file){
  try{fs.lstatSync(file);return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function jfMoveRelative(full){
  const relative=path.relative(targetDir,full);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||
      path.isAbsolute(relative))throw Error('移动路径超出媒体库');
  return relative.split(path.sep).join('/');
}
function jfMoveJournalPath(relative){
  if(typeof relative!=='string'||!relative||relative.includes('\\')||
     relative.split('/').some(part=>!part||part==='.'||part==='..'))
    throw Error('移动恢复记录路径无效');
  const full=path.resolve(targetDir,...relative.split('/'));
  jfMoveRelative(full);
  return full;
}
function jfMoveSafeDirectory(full){
  const relative=path.relative(targetDir,full);
  if(relative.startsWith('..')||path.isAbsolute(relative))
    throw Error('目标目录越界');
  let current=targetDir;
  for(const part of relative.split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    const stat=fs.lstatSync(current);
    if(!stat.isDirectory()||stat.isSymbolicLink())
      throw Error('目标目录包含符号链接或非文件夹');
  }
}
function jfMoveRemoveEmptyFolders(directories){
  for(const entry of [...directories].reverse()){
    try{
      const full=jfMoveJournalPath(entry);
      const stat=fs.lstatSync(full);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('目录类型已改变');
      fs.rmdirSync(full);
    }catch(error){
      if(error.code==='ENOENT')continue;
      // On rollback all new folders should be empty. A third-party file or
      // a failed rollback is not something the importer should erase.
      throw Error('无法回滚新建目录 '+entry+'：'+error.message);
    }
  }
}
// Called BEFORE import/scanning. A crash in the rename phase leaves the
// catalog untouched and a journal of physical moves. Roll them back first.
// A committed phase means catalog + moves were already saved atomically;
// only the harmless journal cleanup remains.
function jfRecoverPendingHlsMove(){
  const journal=catalog.pendingHlsMove;
  if(!journal)return;
  if(journal.version!==1||!['moving','committed'].includes(journal.phase)||
     !Array.isArray(journal.files)||!Array.isArray(journal.directories))
    throw Error('HLS 移动恢复记录无效，已停止扫描以保护媒体');
  if(journal.phase==='moving'){
    for(const entry of [...journal.files].reverse()){
      const from=jfMoveJournalPath(entry.from),to=jfMoveJournalPath(entry.to);
      const source=jfMoveExists(from),destination=jfMoveExists(to);
      if(source&&destination)
        throw Error('HLS 移动恢复发现源、目标都存在，请检查后重试：'+entry.from);
      if(!source&&destination)fs.renameSync(to,from);
      if(!jfMoveExists(from))
        throw Error('HLS 移动恢复发现资源丢失，停止扫描：'+entry.from);
    }
    jfMoveRemoveEmptyFolders(journal.directories);
  }
  delete catalog.pendingHlsMove;
  saveCatalog();
}
function jfMoveHlsGroup(items,targetRelative){
  if(catalog.pendingHlsMove)
    throw Error('上次 HLS 迁移尚未恢复，暂不允许再次移动');
  if(scanRunning)
    throw Error('正在核对媒体索引，完成后再移动一次');
  const destination=path.join(targetDir,safeMediaRelativeDir(targetRelative));
  jfMoveSafeDirectory(destination);
  const occupied=new Map(),foldersToCreate=[],folderRecords=[],metadata=new Map();
  const filePlans=new Map(),itemPlans=new Map(),playlistPlans=new Map();
  const selected=new Set(items.map(item=>item.key));
  const roots=items.filter(jfHlsHasCompanions);
  const plannedFolders=new Map();
  const rootParent=targetRelative||'source';
  const physicalDir=relativeDir=>path.join(targetDir,safeMediaRelativeDir(relativeDir));
  const ensureSubfolder=(parent,label)=>{
    safeOriginalFilename(label);
    const key=parent+'|'+label;
    if(plannedFolders.has(key))return plannedFolders.get(key);
    const existing=catalog.folders.find(f=>f.state==='ready'&&
      f.parentDir===parent&&f.originalName===label);
    if(existing){
      jfMoveSafeDirectory(physicalDir(existing.relativeDir));
      plannedFolders.set(key,existing.relativeDir);
      return existing.relativeDir;
    }
    const parentFull=physicalDir(parent);
    const name=HASH_ENABLED&&parent.startsWith('data')?
      crypto.randomBytes(16).toString('hex'):label;
    const dir=parent+'/'+name;
    const full=physicalDir(dir);
    // The plan may itself contain a parent folder that does not exist yet.
    if(jfMoveExists(full))throw Error('目标子目录同名冲突：'+label);
    plannedFolders.set(key,dir);
    foldersToCreate.push({dir,full});
    folderRecords.push({relativeDir:dir,parentDir:parent,originalName:label,
      state:'ready',readOnly:parent.startsWith('source')});
    return dir;
  };
  const planFolder=(original)=>{
    const parent=path.posix.dirname(original);
    if(parent==='.')return {relativeDir:targetRelative,physical:destination};
    let virtual=rootParent;
    for(const name of parent.split('/')){
      if(!name||name==='.'||name==='..')throw Error('HLS 子目录非法');
      virtual=ensureSubfolder(virtual,name);
    }
    return {relativeDir:virtual,physical:physicalDir(virtual)};
  };
  const planFile=(from,to,item=null,newDir='',newName='')=>{
    if(from===to)return;
    const existing=filePlans.get(from);
    if(existing){
      if(existing.to!==to)throw Error('两个 HLS 清单引用同一文件且目标不同，请分别整理');
    }else{
      if(jfMoveExists(to)||occupied.has(to))
        throw Error('目标目录存在同名文件，未覆盖任何数据：'+path.basename(to));
      const stat=fs.lstatSync(from);
      if(!stat.isFile()||stat.isSymbolicLink())
        throw Error('HLS 关联资源不再是普通文件：'+path.basename(from));
      // Validate all ancestors before committing the journal.
      const rel=path.relative(targetDir,path.dirname(from));
      let ancestor=targetDir;
      for(const part of rel.split(path.sep).filter(Boolean)){
        ancestor=path.join(ancestor,part);
        const info=fs.lstatSync(ancestor);
        if(!info.isDirectory()||info.isSymbolicLink())
          throw Error('来源目录包含符号链接，拒绝移动');
      }
      filePlans.set(from,{from,to});
      occupied.set(to,from);
    }
    if(item){
      const existingItem=itemPlans.get(item);
      if(existingItem&&(existingItem.relativeDir!==newDir||existingItem.managedName!==newName))
        throw Error('同一媒体记录被要求移到不同位置');
      itemPlans.set(item,{relativeDir:newDir,managedName:newName,readOnly:false});
    }
  };
  // Pre-index catalog file identities without changing them. An indexed .ts
  // fragment must follow its HLS master and keep its key/notes/history.
  const indexed=new Map();
  for(const item of catalog.items){
    if(item.state!=='ready')continue;
    try{indexed.set(managedPath(item),item);}catch{}
  }
  for(const root of roots){
    if(root.hlsError||!jfHlsReady(root))
      throw Error('HLS 资源未完整索引，不能安全移动：'+
        String(root.hlsError||root.originalName||'请刷新媒体库'));
    if((root.relativeDir||'')===targetRelative)continue;
    const from=verifyIndexedMediaSource(root);
    let newName=root.managedName;
    if(root.readOnly&&HASH_ENABLED&&!safeManagedName(newName)){
      do{newName=makeManagedName(root.originalName||newName,fs.lstatSync(from));}
      while(jfMoveExists(path.join(destination,newName))||occupied.has(path.join(destination,newName)));
    }
    planFile(from,path.join(destination,newName),root,targetRelative,newName);
    const byPhysical=new Set();
    const planUpdates=[];
    for(const asset of root.hlsAssets||[]){
      if(asset.state!=='ready')throw Error('HLS 关联资源未就绪：'+asset.original);
      const original=asset.original;
      const storedFrom=jfHlsStoredPath(root,asset.stored);
      const folder=planFolder(original);
      let targetName=path.basename(storedFrom);
      if(HASH_ENABLED&&!safeManagedName(targetName)){
        do{targetName=crypto.randomBytes(16).toString('hex');}
        while(jfMoveExists(path.join(folder.physical,targetName))||
          occupied.has(path.join(folder.physical,targetName)));
      }
      const to=path.join(folder.physical,targetName);
      if(byPhysical.has(storedFrom))throw Error('HLS 存在重复的物理分片映射');
      byPhysical.add(storedFrom);
      const child=indexed.get(storedFrom)||null;
      planFile(storedFrom,to,child,folder.relativeDir,targetName);
      const stored=path.relative(destination,to).split(path.sep).join('/');
      if(stored==='..'||stored.startsWith('../'))
        throw Error('HLS 分片目标超出清单目录');
      planUpdates.push({asset,stored});
    }
    playlistPlans.set(root,planUpdates);
  }
  // Include ordinary files in the same user request. An HLS child is moved
  // automatically with its master; never move it alone and break references.
  for(const item of items){
    if(itemPlans.has(item)||((item.relativeDir||'')===targetRelative))continue;
    if(jfHlsChildKeys.has(item.key))
      throw Error('这是 HLS 的关联分片，请移动对应的 HLS 视频条目');
    if(jfHlsHasCompanions(item))continue;
    const source=verifyIndexedMediaSource(item);
    let name=item.managedName;
    if(item.readOnly&&HASH_ENABLED&&!safeManagedName(name)){
      do{name=makeManagedName(item.originalName||name,fs.lstatSync(source));}
      while(jfMoveExists(path.join(destination,name))||
        occupied.has(path.join(destination,name)));
    }
    planFile(source,path.join(destination,name),item,targetRelative,name);
  }
  // Shared resources are not safe to move independently: another playlist's
  // virtual URLs would otherwise point to a file that no longer exists.
  const movingFiles=new Set(filePlans.keys());
  for(const other of catalog.items){
    if(other.state!=='ready'||!jfHlsHasCompanions(other)||playlistPlans.has(other))continue;
    for(const asset of other.hlsAssets||[]){
      const full=path.resolve(path.dirname(managedPath(other)),...String(asset.stored).split('/'));
      if(movingFiles.has(full))
        throw Error('分片正被另一个 HLS 视频共用，不能单独迁移：'+other.originalName);
    }
  }
  const moving=[...filePlans.values()];
  if(!moving.length)return 0;
  // UI reports selected media entries, not the number of hidden HLS fragments.
  const visibleMoved=items.filter(item=>itemPlans.has(item)).length;
  // A destination may not coincide with another file's old path.
  for(const entry of moving){
    if(movingFiles.has(entry.to))throw Error('目标路径与待移动媒体冲突');
  }
  const folderJournal=foldersToCreate.map(x=>jfMoveRelative(x.full));
  const journal={version:1,phase:'moving',
    files:moving.map(x=>({from:jfMoveRelative(x.from),to:jfMoveRelative(x.to)})),
    directories:folderJournal};
  catalog.pendingHlsMove=journal;
  try{saveCatalog();}
  catch(error){delete catalog.pendingHlsMove;throw error;}
  const states=[...itemPlans].map(([item])=>({
    item,relativeDir:item.relativeDir,managedName:item.managedName,readOnly:item.readOnly
  }));
  const savedFolders=catalog.folders.length;
  const savedAssets=[...playlistPlans].map(([item,updates])=>({
    item,states:updates.map(update=>({asset:update.asset,stored:update.asset.stored})),
    fingerprint:item.hlsScanFingerprint,nested:item.hlsNestedPlaylists
  }));
  let committed=false;
  try{
    for(const dir of foldersToCreate)fs.mkdirSync(dir.full);
    for(const entry of moving)fs.renameSync(entry.from,entry.to);
    for(const [item,meta] of itemPlans)Object.assign(item,meta);
    for(const [item,updates] of playlistPlans){
      for(const update of updates)update.asset.stored=update.stored;
      delete item.hlsScanFingerprint;
      delete item.hlsNestedPlaylists;
      jfHlsRuntimeCache.delete(item);
    }
    catalog.folders.push(...folderRecords);
    journal.phase='committed';
    saveCatalog(); // Commit metadata and completion marker in ONE atomic save.
    committed=true;
  }catch(error){
    for(const state of states){
      Object.assign(state.item,{relativeDir:state.relativeDir,
        managedName:state.managedName,readOnly:state.readOnly});
    }
    for(const prev of savedAssets){
      for(const state of prev.states)state.asset.stored=state.stored;
      if(prev.fingerprint===undefined)delete prev.item.hlsScanFingerprint;
      else prev.item.hlsScanFingerprint=prev.fingerprint;
      if(prev.nested===undefined)delete prev.item.hlsNestedPlaylists;
      else prev.item.hlsNestedPlaylists=prev.nested;
      jfHlsRuntimeCache.delete(prev.item);
    }
    catalog.folders.length=savedFolders;
    journal.phase='moving';
    // Journal remains persisted if rollback itself fails; startup retries.
    try{jfRecoverPendingHlsMove();}
    catch(rollback){error.message+='；回滚待恢复：'+rollback.message;}
    throw error;
  }
  if(committed){
    delete catalog.pendingHlsMove;
    try{saveCatalog();}
    catch{
      // Durable committed phase persists on disk. Startup will clear it.
    }
  }
  return visibleMoved;
}
