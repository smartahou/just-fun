// v7.15: Explicit, fail-closed Workspace v1 recovery. No automatic restoration.
// Depends on 15-metadata-vault, 46-reading-and-notes and Node built-ins.
// The backup is authenticated with its OWN path-bound AAD, never renamed raw.
function jfReadingRecoveryRead(file){
  // existsSync follows links and incorrectly treats dangling symlinks as absent.
  // Distinguish a genuinely missing file from an unsafe on-disk entry.
  try{fs.lstatSync(file);}catch(e){return {state:e.code==='ENOENT'?'missing':'invalid'};}
  try{
    const bytes=vaultReadBytes(file);
    const d=JSON.parse(bytes.toString('utf8'));
    if(!d||d.version!==1||!Number.isSafeInteger(d.revision)||d.revision<0||
      !Array.isArray(d.notes)||!Array.isArray(d.marks||[])||
      !d.progress||typeof d.progress!=='object'||Array.isArray(d.progress))
      throw Error('Workspace schema invalid');
    return {state:'valid',revision:d.revision,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes};
  }catch{return {state:'invalid'};}
}
function jfReadingRecoveryStatus(){
  const main=jfReadingRecoveryRead(JF_READING_DATA), backup=jfReadingRecoveryRead(JF_READING_BACKUP);
  // A healthy main is ALWAYS authoritative: never offer a rollback over it.
  const recoverable=main.state!=='valid'&&backup.state==='valid';
  return {ok:true,readOnly:true,main:{state:main.state,revision:main.revision??null},
    backup:{state:backup.state,revision:backup.revision??null,
      sha256:backup.state==='valid'?backup.sha256:null},
    recoverable,requiresExplicitConfirmation:true,
    advice:recoverable?'仅在确认主文件不可读时，使用备份哈希与修订号执行显式恢复':
      main.state==='valid'?'主文件健康，不允许回退至旧备份':'没有可认证的恢复备份，禁止自动创建空白工作区'};
}
function jfReadingRestoreBackup(body){
  if(!body||body.action!=='restore-backup'||body.confirm!=='RESTORE_BACKUP')
    throw jfReaderError(400,'需明确确认使用经过认证的备份恢复');
  const main=jfReadingRecoveryRead(JF_READING_DATA),backup=jfReadingRecoveryRead(JF_READING_BACKUP);
  if(main.state==='valid')throw jfReaderError(409,'主工作区可正常读取，禁止旧备份覆盖');
  if(backup.state!=='valid')throw jfReaderError(409,'没有可认证的工作区备份，拒绝恢复');
  if(body.expectedSha256!==backup.sha256||body.expectedRevision!==backup.revision)
    throw jfReaderError(409,'备份已变化，请重新检查恢复状态');
  let preserved=null;
  if(main.state==='invalid'){
    // Keep the original unmodified corrupted bytes for forensic/manual recovery.
    // Symlinks and special files are never copied or overwritten.
    const st=fs.lstatSync(JF_READING_DATA);
    if(!st.isFile()||st.isSymbolicLink()||st.size>64*1024*1024)
      throw jfReaderError(409,'主文件类型异常，拒绝覆盖');
    const raw=fs.readFileSync(JF_READING_DATA),origSha=crypto.createHash('sha256').update(raw).digest('hex');
    preserved=JF_READING_DATA+'.damaged-'+crypto.randomBytes(8).toString('hex');
    fs.copyFileSync(JF_READING_DATA,preserved,fs.constants.COPYFILE_EXCL);
    try{
      fs.chmodSync(preserved,0o600);
      const fd=fs.openSync(preserved,'r');
      try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      if(crypto.createHash('sha256').update(fs.readFileSync(preserved)).digest('hex')!==origSha)
        throw Error('damaged snapshot verification failed');
      // Publish the preservation evidence before replacing the broken main.
      let dirfd;
      try{dirfd=fs.openSync(path.dirname(JF_READING_DATA),'r');fs.fsyncSync(dirfd);}
      catch(e){if(process.platform!=='win32'||!['EPERM','EACCES','EINVAL','ENOTSUP','EISDIR'].includes(e.code))throw e;}
      finally{if(dirfd!==undefined)fs.closeSync(dirfd);}
    }catch(e){throw jfReaderError(500,'损坏主文件留存失败，恢复已中止：'+e.message);}
  }
  // Re-encrypt plaintext under the MAIN pathname AAD; backup is never touched.
  vaultWriteBytes(JF_READING_DATA,backup.bytes,{durable:true});
  const verify=jfReadingRecoveryRead(JF_READING_DATA);
  if(verify.state!=='valid'||verify.sha256!==backup.sha256)
    throw jfReaderError(500,'恢复后认证失败，请保留备份和损坏文件并检查磁盘');
  return {ok:true,restored:true,revision:backup.revision,
    originalPreserved:!!preserved,mainVerified:true,backupPreserved:true};
}
