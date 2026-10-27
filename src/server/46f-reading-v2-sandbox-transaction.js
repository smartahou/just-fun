// v7.16: multi-object transaction rehearsal, strictly limited to disposable fixtures.
// NO production caller, HTTP route, or opt-in migration endpoint. Promoting this
// protocol requires separate Windows/NTFS and crash-recovery verification.
function jfReadingV2Plan(workspace){
  if(!workspace||workspace.version!==1||!Number.isSafeInteger(workspace.revision)||workspace.revision<0||
    !Array.isArray(workspace.notes)||!Array.isArray(workspace.marks)||
    !workspace.progress||typeof workspace.progress!=='object'||Array.isArray(workspace.progress))
    throw jfReaderError(409,'v2 事务输入必须是完整的 Workspace v1');
  const next=structuredClone(workspace),objects=new Map();
  for(const note of next.notes){
    if(!note||typeof note!=='object')throw jfReaderError(409,'笔记结构错误');
    if(note.quotes===undefined)continue; // legacy notes need not have excerpts
    if(!Array.isArray(note.quotes))throw jfReaderError(409,'笔记摘录格式错误');
    for(const quote of note.quotes){
      if(!quote||quote.type!=='image')continue;
      const pages=Array.isArray(quote.pages)&&quote.pages.length?quote.pages:[quote];
      if(pages!==quote && quote.image!==pages[0].image)
        throw jfReaderError(409,'跨页摘录封面与第一页不一致，拒绝迁移');
      for(const page of pages){
        if(!page||typeof page!=='object'||Object.hasOwn(page,'imageRef'))
          throw jfReaderError(409,'v1 图片对象包含非法引用');
        const identity=jfReadingImageIdentity(page.image);
        const bytes=Buffer.from(page.image.slice(JF_READING_IMAGE_PREFIX.length),'base64');
        if(!objects.has(identity.imageRef))objects.set(identity.imageRef,bytes);
        delete page.image;page.imageRef=identity.imageRef;
      }
      if(pages!==quote){
        delete quote.image;quote.imageRef=pages[0].imageRef;
      }
    }
  }
  next.version=2;
  const serialized=Buffer.from(JSON.stringify(next),'utf8');
  if(serialized.length>JF_READING_JSON_SAFE_BYTES)throw jfReaderError(413,'v2 工作区超过安全尺寸');
  return {next,serialized,objects};
}
function jfReadingV2SandboxOnly(){
  const tmp=fs.realpathSync(os.tmpdir()),root=path.resolve(JF_READING_DIR,'..');
  // Fixture roots must be real, dedicated mkdtemp directories, not symlinks
  // or arbitrary subdirectories of the real user's cache.
  if(!root.startsWith(tmp+path.sep)||!path.basename(root).startsWith('jf-v716-tx-')||
      path.basename(JF_READING_DIR)!=='reading'||fs.realpathSync(root)!==root||
      fs.lstatSync(root).isSymbolicLink())
    throw jfReaderError(403,'v2 事务写入仅允许独立临时测试库');
  return root;
}
function jfReadingV2SandboxCommit(workspace,options={}){
  jfReadingV2SandboxOnly();
  const plan=jfReadingV2Plan(workspace),failAt=options.failAt||null;
  const fail=stage=>{if(stage===failAt)throw jfReaderError(503,'注入事务故障：'+stage);};
  // Fixture must be freshly provisioned and contain its original v1 main.
  const main=JF_READING_DATA,backup=JF_READING_BACKUP;
  if(fs.lstatSync(JF_READING_DIR).isSymbolicLink()||!fs.lstatSync(JF_READING_DIR).isDirectory()||
      fs.existsSync(backup)||!fs.existsSync(main))
    throw jfReaderError(409,'隔离事务夹具不是初始状态');
  const original=vaultReadBytes(main);
  if(!original.equals(Buffer.from(JSON.stringify(workspace),'utf8')))
    throw jfReaderError(409,'隔离事务原始状态与输入不一致');
  const ensureDir=folder=>{
    if(!fs.existsSync(folder))fs.mkdirSync(folder,{mode:0o700});
    const st=fs.lstatSync(folder);
    if(!st.isDirectory()||st.isSymbolicLink())throw jfReaderError(409,'图片对象目录包含非法文件类型');
  };
  const verifyObject=ref=>{
    const uri=jfReadingV2ReadImage(ref);
    if(jfReadingImageIdentity(uri).imageRef!==ref)throw jfReaderError(409,'图片对象身份验证失败');
  };
  let committed=false,backupWritten=false;
  try{
    fail('before_objects');
    ensureDir(path.join(JF_READING_DIR,'objects'));
    let index=0;
    for(const [ref,bytes] of plan.objects){
      const target=jfReadingV2ObjectPath(ref);
      ensureDir(path.dirname(target));
      // Never replace an existing object, even if it was corrupted.
      if(fs.existsSync(target)||(()=>{try{fs.lstatSync(target);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}})()){
        verifyObject(ref);
      }else{
        const fd=fs.openSync(target,'wx',0o600);
        try{fs.writeFileSync(fd,vaultEncrypt(target,bytes));fs.fsyncSync(fd);}
        finally{fs.closeSync(fd);}
        // Persist directory entry as well as contents, where supported.
        let dirfd;
        try{dirfd=fs.openSync(path.dirname(target),'r');fs.fsyncSync(dirfd);}
        catch(e){if(process.platform!=='win32'||!['EPERM','EACCES','EINVAL','ENOTSUP','EISDIR'].includes(e.code))throw e;}
        finally{if(dirfd!==undefined)fs.closeSync(dirfd);}
        verifyObject(ref);
      }
      if(++index===1)fail('after_first_object');
    }
    fail('after_objects');
    // The backup has independent path-bound AAD, and is verified BEFORE commit.
    fail('before_backup');
    vaultWriteBytes(backup,original,{durable:true});backupWritten=true;
    if(!vaultReadBytes(backup).equals(original))throw jfReaderError(500,'事务备份认证失败');
    fail('after_backup');
    fail('before_commit');
    vaultWriteBytes(main,plan.serialized,{durable:true});committed=true;
    fail('after_commit');
    if(!vaultReadBytes(main).equals(plan.serialized))throw jfReaderError(500,'v2 主文件读回失败');
    const rehydrated=jfReadingV2HydrateWorkspace(plan.next);
    const canonical=value=>JSON.stringify(value,(key,v)=>
      v&&typeof v==='object'&&!Array.isArray(v)?
        Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
    if(canonical(rehydrated)!==canonical(workspace))
      throw jfReaderError(500,'v2 双读数据不等价，拒绝提交');
    fail('after_verification');
    return {ok:true,isolated:true,committed:true,revision:plan.next.revision,
      objects:plan.objects.size,backupAuthenticated:true};
  }catch(error){
    // A post-rename failure must not strand the fixture at v2. Re-encrypt under
    // the MAIN AAD, verify, retain authenticated backup and immutable objects.
    try{
      const current=vaultReadBytes(main);
      if(!current.equals(original)){
        vaultWriteBytes(main,original,{durable:true});
      }
      if(!vaultReadBytes(main).equals(original))throw Error('rollback readback mismatch');
      if(backupWritten&&!vaultReadBytes(backup).equals(original))throw Error('backup changed');
    }catch(rollbackError){
      throw jfReaderError(500,'v2 事务与回滚均失败，保留现场：'+rollbackError.message);
    }
    throw error;
  }
}
