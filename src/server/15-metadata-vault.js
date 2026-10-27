// v6.48 — password-bound metadata vault. Never store the raw password or vault key.
// Envelope authenticates both its contents and the path's role via AES-GCM AAD.
const VAULT_FORMAT='justfun-metadata-vault';
const VAULT_VERSION=1;
const VAULT_MAX_READ=64*1024*1024;
let vaultKey=null;
let vaultSealed=false;
function vaultBound(file){
  // Only cache-owned metadata is in scope. Generated media is intentionally excluded.
  const resolved=path.resolve(file);
  const base=path.resolve(CACHE_DIR)+path.sep;
  if(!resolved.startsWith(base))throw Error('保险箱路径不合法');
  return path.relative(CACHE_DIR,resolved).replace(/\\/g,'/');
}
function vaultIsEnvelope(value){
  return value && typeof value==='object' && value.format===VAULT_FORMAT;
}
function vaultIsEncryptedFile(file){
  if(!fs.existsSync(file))return false;
  const v=JSON.parse(fs.readFileSync(file,'utf8'));
  return vaultIsEnvelope(v);
}
function vaultUnlock(password){
  if(!PWD_ENABLED)return;
  if(typeof password!=='string'||!password)throw Error('没有访问密码，不能开启保险箱');
  fs.mkdirSync(CACHE_DIR,{recursive:true});
  let config;
  if(fs.existsSync(VAULT_SALT_FILE)){
    config=JSON.parse(fs.readFileSync(VAULT_SALT_FILE,'utf8'));
    if(config?.format!==VAULT_FORMAT||config?.version!==1||
      !/^[a-f0-9]{32}$/.test(config.salt||''))throw Error('保险箱密钥配置损坏，拒绝启动');
  }else{
    // Never overwrite an existing encrypted index with a new, incompatible salt.
    for(const file of [DATA_FILE,DATA_BACKUP_FILE]){
      if(fs.existsSync(file)&&vaultIsEncryptedFile(file))throw Error('保险箱盐值丢失，拒绝覆盖加密数据');
    }
    config={format:VAULT_FORMAT,version:1,kdf:'scrypt',cipher:'aes-256-gcm',salt:crypto.randomBytes(16).toString('hex'),sealed:false};
    fs.writeFileSync(VAULT_SALT_FILE,JSON.stringify(config),{flag:'wx',mode:0o600});
  }
  vaultSealed=config.sealed===true;
  // scrypt's deliberately expensive password derivation runs only once at unlock.
  vaultKey=crypto.scryptSync(password,Buffer.from(config.salt,'hex'),32,
    {N:1<<15,r:8,p:1,maxmem:64*1024*1024});
}
function vaultEncrypt(file,raw){
  if(!PWD_ENABLED)return Buffer.isBuffer(raw)?raw:Buffer.from(raw,'utf8');
  if(!vaultKey)throw Error('保险箱尚未解锁');
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',vaultKey,iv);
  cipher.setAAD(Buffer.from('JustFun/v1/'+vaultBound(file)));
  const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw,'utf8');
  const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return Buffer.from(JSON.stringify({format:VAULT_FORMAT,version:VAULT_VERSION,iv:iv.toString('base64'),
    tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')}));
}
function vaultDecrypt(file,raw){
  let env;
  try{env=JSON.parse(raw.toString('utf8'));}catch{throw Error('缓存文件格式损坏，拒绝覆盖');}
  if(!vaultIsEnvelope(env)){
    if(PWD_ENABLED&&!vaultKey)throw Error('保险箱未解锁，拒绝读取明文缓存');
    if(PWD_ENABLED&&vaultSealed)throw Error('检测到加密保险箱被明文替换，已拒绝降级读取');
    return raw; // Legacy metadata, migrated after the authenticated backup is taken.
  }
  if(!PWD_ENABLED||!vaultKey)throw Error('保险箱未解锁，拒绝读取加密缓存');
  if(env.version!==VAULT_VERSION||!['iv','tag','data'].every(k=>typeof env[k]==='string'))throw Error('加密缓存版本或结构不匹配');
  const iv=Buffer.from(env.iv,'base64'),tag=Buffer.from(env.tag,'base64');
  if(iv.length!==12||tag.length!==16)throw Error('加密缓存校验参数错误');
  try{
    const decipher=crypto.createDecipheriv('aes-256-gcm',vaultKey,iv);
    decipher.setAAD(Buffer.from('JustFun/v1/'+vaultBound(file)));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(env.data,'base64')),decipher.final()]);
  }catch{throw Error('缓存认证失败（密码不符、密钥损坏或文件被修改），已拒绝启动/读取');}
}
function vaultReadBytes(file){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>VAULT_MAX_READ)throw Error('缓存文件类型或大小异常');
  return vaultDecrypt(file,fs.readFileSync(file));
}
function vaultReadJson(file){return JSON.parse(vaultReadBytes(file).toString('utf8'));}
function vaultWriteBytes(file,bytes,options){
  // Never write plaintext even temporarily, and always use a fresh per-write nonce.
  // v7.14: only explicitly durable metadata (Workspace) pays for a file sync
  // before publication. Other high-frequency media metadata keeps old behavior.
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const out=vaultEncrypt(file,bytes);
  const temp=file+'.tmp-'+crypto.randomBytes(8).toString('hex');
  try{
    if(options?.durable){
      const fd=fs.openSync(temp,'wx',0o600);
      try{fs.writeFileSync(fd,out);fs.fsyncSync(fd);}
      finally{fs.closeSync(fd);}
    }else fs.writeFileSync(temp,out,{flag:'wx',mode:0o600});
    fs.renameSync(temp,file);
    if(options?.durable){
      // Directory fsync secures rename metadata on supporting filesystems.
      // Windows does not support POSIX directory fsync via Node: skip ONLY
      // that unsupported operation; actual NTFS power-loss needs real testing.
      let dirfd;
      try{dirfd=fs.openSync(path.dirname(file),'r');fs.fsyncSync(dirfd);}
      catch(e){if(process.platform!=='win32'||!['EPERM','EACCES','EINVAL','ENOTSUP','EISDIR'].includes(e.code))throw e;}
      finally{if(dirfd!==undefined)fs.closeSync(dirfd);}
    }
  }finally{try{fs.rmSync(temp,{force:true});}catch{}}
}
function vaultWriteJson(file,value){vaultWriteBytes(file,JSON.stringify(value));}
function vaultMigrateOne(file){
  if(!PWD_ENABLED||!fs.existsSync(file))return false;
  const raw=fs.readFileSync(file);
  let data;
  try{data=JSON.parse(raw.toString('utf8'));}catch{throw Error('历史缓存文件损坏，迁移暂停');}
  if(vaultIsEnvelope(data)){
    vaultDecrypt(file,raw); // Authenticate existing ciphertext, don't silently skip corruption.
    return false;
  }
  if(vaultSealed)throw Error('已封存的保险箱出现明文缓存，拒绝降级读取');
  // Prevent replacing malformed/unrecognized files under a trusted metadata name.
  if(!data||typeof data!=='object')throw Error('历史缓存内容异常，迁移暂停');
  vaultWriteBytes(file,raw);
  if(vaultReadBytes(file).toString('utf8')!==raw.toString('utf8'))throw Error('迁移校验失败，拒绝继续');
  return true;
}
function vaultMigrateLegacyMetadata(){
  if(!PWD_ENABLED)return {migrated:0};
  if(!vaultKey)throw Error('保险箱未解锁');
  let migrated=0;
  // Encrypt both the index and its emergency recovery copy.
  for(const p of [DATA_FILE,DATA_BACKUP_FILE,path.join(CACHE_DIR,'data.json.pre-restore.bak')]){
    if(vaultMigrateOne(p))migrated++;
  }
  const directory=path.join(CACHE_DIR,'ai-learning');
  if(fs.existsSync(directory)){
    for(const e of fs.readdirSync(directory,{withFileTypes:true})){
      if(!e.isFile()||e.isSymbolicLink())continue;
      // Only application-owned AI metadata; never ingest user-uploaded files.
      if(!/^[a-f0-9]{16}(?:\.transcript(?:-previous)?|\.asr-task)?\.json$/.test(e.name))continue;
      if(vaultMigrateOne(path.join(directory,e.name)))migrated++;
    }
  }
  if(!vaultSealed){
    const config=JSON.parse(fs.readFileSync(VAULT_SALT_FILE,'utf8'));
    config.sealed=true;
    // Protect sealed state from partial writes. Salt remains unchanged.
    const temp=VAULT_SALT_FILE+'.tmp-'+crypto.randomBytes(8).toString('hex');
    try{fs.writeFileSync(temp,JSON.stringify(config),{flag:'wx',mode:0o600});fs.renameSync(temp,VAULT_SALT_FILE);}
    finally{try{fs.rmSync(temp,{force:true});}catch{}}
    vaultSealed=true;
  }
  return {migrated};
}
