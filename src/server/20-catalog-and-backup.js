

function hashKey(value) {
  return crypto
    .createHash('sha1')
    .update(String(value))
    .digest('hex')
    .slice(0, 16);
}

function makeManagedName(
  originalName,
  stat
) {
  const salt =
    crypto
      .randomBytes(16)
      .toString('hex');

  return crypto
    .createHash('sha256')
    .update(
      [
        originalName,
        stat.size,
        stat.mtimeMs,
        salt
      ].join('|')
    )
    .digest('hex')
    .slice(0, 32);
}

function formatBytes(n) {
  if (!Number.isFinite(n)) {
    return '';
  }

  const units =
    ['B','KB','MB','GB','TB'];

  let value = n;
  let i = 0;

  while (
    value >= 1024 &&
    i < units.length - 1
  ) {
    value /= 1024;
    i++;
  }

  return (
    (
      value >= 10 || i === 0
        ? value.toFixed(0)
        : value.toFixed(1)
    ) +
    ' ' +
    units[i]
  );
}

function formatDuration(seconds) {
  seconds =
    Number(seconds);

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return '';
  }

  const h =
    Math.floor(
      seconds / 3600
    );

  const m =
    Math.floor(
      (seconds % 3600) / 60
    );

  const s =
    Math.floor(
      seconds % 60
    );

  return h
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${m}:${String(s).padStart(2,'0')}`;
}

function cleanText(value) {
  return String(
    value || ''
  )
    .replace(
      /[\x00-\x1f]/g,
      ''
    )
    .trim();
}

function parseOriginalName(fileName) {
  const ext =
    path.extname(
      fileName
    );

  const base =
    path.basename(
      fileName,
      ext
    ).trim();

  let match =
    base.match(
      /^(.+?)\s+[-–—]\s+(.+)$/
    );

  if (!match) {
    match =
      base.match(
        /^(.+?)\s*[-–—]\s*(video-\d{8}_\d{6}.*)$/i
      );
  }

  if (match) {
    return {
      creator:
        match[1].trim(),
      title:
        match[2].trim()
    };
  }

  return {
    creator: '',
    title: base
  };
}

let catalog = {
  version: 1,
  target: targetDir,
  updatedAt: null,
  scanStatus: 'idle',
  scanMessage: '',
  creatorLinks: {},
  clips: [], // A/B 片段只存时间区间，不复制源视频
  items: []
};

let catalogLoadError = null;
let catalogLoadedFromBackup = false;

function readCatalogFile(file) {
  const value = vaultReadJson(file);

  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.items)
  ) {
    throw new Error(
      '缓存格式无效'
    );
  }

  return value;
}

function targetContainsManagedMedia() {
  // A missing data.json must not silently re-index a former hash library as
  // plain files. Search the generated data/ hierarchy as well as root.
  const inspect=(dir,depth)=>{
    if(depth>12)return false;
    try{
      return fs.readdirSync(dir,{withFileTypes:true}).some(entry=>{
        if(entry.isSymbolicLink())return false;
        if(entry.isFile())return safeManagedName(entry.name);
        if(entry.isDirectory()){
          if(safeManagedName(entry.name))return true;
          return inspect(path.join(dir,entry.name),depth+1);
        }
        return false;
      });
    }catch{return false;}
  };
  return inspect(targetDir,0);
}

function loadCatalogAfterUnlock(){
  catalogLoadError=null;
  catalogLoadedFromBackup=false;
try {
  let old = null;

  if (fs.existsSync(DATA_FILE)) {
    try {
      old =
        readCatalogFile(
          DATA_FILE
        );
    } catch (primaryError) {
      if (fs.existsSync(DATA_BACKUP_FILE)) {
        old =
          readCatalogFile(
            DATA_BACKUP_FILE
          );

        catalogLoadedFromBackup =
          true;
      } else {
        throw primaryError;
      }
    }
  } else if (
    fs.existsSync(
      DATA_BACKUP_FILE
    )
  ) {
    old =
      readCatalogFile(
        DATA_BACKUP_FILE
      );

    catalogLoadedFromBackup =
      true;
  } else if (
    targetContainsManagedMedia()
  ) {
    throw new Error(
      '检测到已有 hash 媒体文件，但 data.json 缓存缺失。为防止历史数据被重新生成覆盖，已停止启动。请恢复 .douyin-nav-cache，或把旧目录完整迁移后再启动。'
    );
  }

  if (old) {
    catalog = {
      ...catalog,
      ...old,
      target:
        targetDir
    };
  }

  if (!catalog.creatorLinks || typeof catalog.creatorLinks !== 'object' || Array.isArray(catalog.creatorLinks)) {
    catalog.creatorLinks = {};
  }
  if (!Array.isArray(catalog.folders)) catalog.folders = [];
  if (!Array.isArray(catalog.clips)) catalog.clips = [];
  delete catalog.aiUsageNotice;
} catch (error) {
  catalogLoadError =
    error instanceof Error
      ? error
      : new Error(
          String(error)
        );
}
}



function migrateLegacyItemKinds() {
  let changed = false;
  let fixed = 0;

  for (
    const item of catalog.items
  ) {
    const kind =
      itemMediaKind(
        item
      );

    if (
      kind &&
      item.kind !== kind
    ) {
      item.kind =
        kind;

      changed =
        true;

      fixed++;
    }

    if (
      item.kind === 'video' &&
      ![0,90,180,270]
        .includes(
          Number(
            item.rotation
          )
        )
    ) {
      item.rotation =
        0;

      changed =
        true;
    }
  }

  if (changed) {
    saveCatalog();

    logStep(
      `旧缓存媒体类型迁移：修复 ${fixed} 条`
    );
  }
}

function saveCatalog() {
  delete catalog.aiUsageNotice;
  if (catalogLoadError) {
    throw new Error(
      '缓存未安全加载，拒绝写入 data.json'
    );
  }

  catalog.updatedAt =
    new Date()
      .toISOString();

  fs.mkdirSync(
    CACHE_DIR,
    { recursive:true }
  );

  const json = JSON.stringify(catalog,null,2);

  const temp =
    DATA_FILE +
    '.tmp-' +
    process.pid +
    '-' +
    Date.now();

  fs.writeFileSync(temp,vaultEncrypt(DATA_FILE,json),{flag:'wx',mode:0o600});

  try {
    if (fs.existsSync(DATA_FILE)) {
      vaultWriteBytes(DATA_BACKUP_FILE,vaultReadBytes(DATA_FILE));
    }

    fs.renameSync(
      temp,
      DATA_FILE
    );

    // 第一次保存时也建立一份可恢复备份。
    if (!fs.existsSync(DATA_BACKUP_FILE)) {
      vaultWriteBytes(DATA_BACKUP_FILE,vaultReadBytes(DATA_FILE));
    }
  } catch (error) {
    try {
      if (fs.existsSync(temp)) {
        fs.unlinkSync(temp);
      }
    } catch {}

    throw error;
  }
}

function ensureExternalBackupDir() {
  fs.mkdirSync(
    EXTERNAL_BACKUP_DIR,
    { recursive:true }
  );

  if (
    process.platform ===
      'win32'
  ) {
    try {
      execFileSync(
        'attrib',
        ['+h', EXTERNAL_BACKUP_DIR],
        {
          windowsHide:true,
          stdio:'ignore'
        }
      );
    } catch {}
  }
}

function validLibraryId(value) {
  return /^[a-f0-9]{24}$/i.test(
    String(value || '')
  );
}

function ensureCatalogLibraryId() {
  if (
    validLibraryId(
      catalog.libraryId
    )
  ) {
    return false;
  }

  catalog.libraryId =
    crypto
      .randomBytes(12)
      .toString('hex');

  // 只增加稳定的媒体库 ID，不改变任何用户历史字段。
  saveCatalog();

  return true;
}

function backupStamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace('Z', '')
    .replace('.', '-');
}

function readExternalBackupEnvelope(file) {
  const envelope =
    JSON.parse(
      fs.readFileSync(
        file,
        'utf8'
      )
    );

  if (
    !envelope ||
    envelope.format !==
      EXTERNAL_BACKUP_FORMAT ||
    Number(envelope.version) !==
      EXTERNAL_BACKUP_VERSION ||
    !envelope.meta ||
    !envelope.crypto
  ) {
    throw new Error(
      '不是有效的抖音媒体库备份'
    );
  }

  return envelope;
}

function listExternalBackupRecords() {
  if (
    !fs.existsSync(
      EXTERNAL_BACKUP_DIR
    )
  ) {
    return [];
  }

  const records = [];

  for (
    const entry of
    fs.readdirSync(
      EXTERNAL_BACKUP_DIR,
      { withFileTypes:true }
    )
  ) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(
        '.douyinbak'
      )
    ) {
      continue;
    }

    const file =
      path.join(
        EXTERNAL_BACKUP_DIR,
        entry.name
      );

    try {
      const envelope =
        readExternalBackupEnvelope(
          file
        );

      records.push({
        file,
        envelope
      });
    } catch {}
  }

  records.sort(
    (a, b) =>
      String(
        b.envelope.meta.createdAt || ''
      ).localeCompare(
        String(
          a.envelope.meta.createdAt || ''
        )
      )
  );

  return records;
}

function pruneExternalBackups(
  libraryId
) {
  const records =
    listExternalBackupRecords()
      .filter(
        record =>
          String(
            record.envelope.meta.libraryId || ''
          ) ===
          String(libraryId)
      );

  for (
    const record of
    records.slice(
      EXTERNAL_BACKUP_KEEP
    )
  ) {
    try {
      fs.unlinkSync(
        record.file
      );
    } catch {}
  }
}

function createEncryptedRunBackup(
  password
) {
  if (
    !password ||
    !fs.existsSync(
      DATA_FILE
    )
  ) {
    return null;
  }

  // 备份前再次验证 data.json，避免把损坏文件加入三份轮换。
  const sourceCatalog =
    readCatalogFile(
      DATA_FILE
    );

  if (
    !validLibraryId(
      sourceCatalog.libraryId
    )
  ) {
    throw new Error(
      '媒体库 ID 无效，拒绝生成安全备份'
    );
  }

  ensureExternalBackupDir();

  const plaintext = Buffer.from(JSON.stringify(sourceCatalog),'utf8');

  const salt =
    crypto.randomBytes(16);

  const iv =
    crypto.randomBytes(12);

  const key =
    crypto.scryptSync(
      String(password),
      salt,
      32
    );

  const cipher =
    crypto.createCipheriv(
      'aes-256-gcm',
      key,
      iv
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        plaintext
      ),
      cipher.final()
    ]);

  const tag =
    cipher.getAuthTag();

  const createdAt =
    new Date()
      .toISOString();

  const envelope = {
    format:
      EXTERNAL_BACKUP_FORMAT,
    version:
      EXTERNAL_BACKUP_VERSION,
    meta: {
      createdAt,
      // Avoid exposing the private media path and inventory in the backup header.
      // Both are already inside authenticated encrypted catalog data.
      libraryId:
        sourceCatalog.libraryId
    },
    crypto: {
      kdf:'scrypt',
      cipher:'aes-256-gcm',
      salt:
        salt.toString('base64'),
      iv:
        iv.toString('base64'),
      tag:
        tag.toString('base64'),
      data:
        encrypted.toString('base64')
    }
  };

  const fileName =
    `${backupStamp()}-${sourceCatalog.libraryId}.douyinbak`;

  const file =
    path.join(
      EXTERNAL_BACKUP_DIR,
      fileName
    );

  const temp =
    file +
    '.tmp-' +
    process.pid;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      envelope,
      null,
      2
    ),
    {
      encoding:'utf8',
      mode:0o600
    }
  );

  fs.renameSync(
    temp,
    file
  );

  pruneExternalBackups(
    sourceCatalog.libraryId
  );

  return file;
}

function formatBackupDate(value) {
  const date =
    new Date(value);

  if (
    !Number.isFinite(
      date.getTime()
    )
  ) {
    return String(value || '');
  }

  const pad =
    value =>
      String(value)
        .padStart(2, '0');

  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())} ` +
    `${pad(date.getHours())}:` +
    `${pad(date.getMinutes())}:` +
    `${pad(date.getSeconds())}`
  );
}

function printExternalBackups() {
  const records =
    listExternalBackupRecords();

  if (!records.length) {
    console.log(
      '暂无安全备份'
    );

    return;
  }

  console.log(
    `安全备份：${records.length} 份`
  );

  records.forEach(
    (record, index) => {
      const meta =
        record.envelope.meta;

      console.log('');
      console.log(
        `[${index + 1}] ${formatBackupDate(meta.createdAt)}`
      );
      console.log(
        `原目录：${meta.originalTarget || '未知'}`
      );
      console.log(
        `媒体数：${Number(meta.itemCount) || 0}`
      );
      console.log(
        `备份文件：${record.file}`
      );
    }
  );
}

function decryptExternalBackup(
  envelope,
  password
) {
  const cryptoPart =
    envelope.crypto || {};

  if (
    cryptoPart.kdf !== 'scrypt' ||
    cryptoPart.cipher !==
      'aes-256-gcm'
  ) {
    throw new Error(
      '不支持的备份加密格式'
    );
  }

  const salt =
    Buffer.from(
      String(cryptoPart.salt || ''),
      'base64'
    );

  const iv =
    Buffer.from(
      String(cryptoPart.iv || ''),
      'base64'
    );

  const tag =
    Buffer.from(
      String(cryptoPart.tag || ''),
      'base64'
    );

  const encrypted =
    Buffer.from(
      String(cryptoPart.data || ''),
      'base64'
    );

  const key =
    crypto.scryptSync(
      String(password),
      salt,
      32
    );

  const decipher =
    crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      iv
    );

  decipher.setAuthTag(
    tag
  );

  const plaintext =
    Buffer.concat([
      decipher.update(
        encrypted
      ),
      decipher.final()
    ]).toString('utf8');

  const value =
    JSON.parse(
      plaintext
    );

  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.items)
  ) {
    throw new Error(
      '备份中的 data.json 无效'
    );
  }

  return value;
}

async function restoreFromExternalBackup(
  backupFile
) {
  if (
    !backupFile ||
    !fs.existsSync(
      backupFile
    ) ||
    !fs.statSync(
      backupFile
    ).isFile()
  ) {
    console.error(
      '备份文件不可用'
    );

    return false;
  }

  let envelope;

  try {
    envelope =
      readExternalBackupEnvelope(
        backupFile
      );
  } catch {
    console.error(
      '备份文件无效'
    );

    return false;
  }

  const meta =
    envelope.meta || {};

  console.log(
    `备份时间：${formatBackupDate(meta.createdAt)}`
  );
  console.log(
    `原目录：${meta.originalTarget || '未知'}`
  );
  console.log(
    `媒体数：${Number(meta.itemCount) || 0}`
  );

  let restored = null;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    const password =
      await promptHidden(
        '备份密码：'
      );

    try {
      restored =
        decryptExternalBackup(
          envelope,
          password
        );

      break;
    } catch {
      console.log(
        `备份密码错误（${attempt}/3）`
      );
    }
  }

  if (!restored) {
    console.error(
      '恢复失败'
    );

    return false;
  }

  fs.mkdirSync(
    CACHE_DIR,
    { recursive:true }
  );

  // 恢复前固定保留当前 data.json，避免选错快照后无路可退。
  const preRestore =
    path.join(
      CACHE_DIR,
      'data.json.pre-restore.bak'
    );

  if (
    fs.existsSync(
      DATA_FILE
    )
  ) {
    vaultWriteBytes(preRestore,vaultReadBytes(DATA_FILE));
  }

  restored.target =
    targetDir;

  const temp =
    DATA_FILE +
    '.restore-' +
    process.pid;

  fs.writeFileSync(temp,vaultEncrypt(DATA_FILE,JSON.stringify(restored)),{flag:'wx',mode:0o600});

  if (
    fs.existsSync(
      DATA_FILE
    )
  ) {
    fs.unlinkSync(
      DATA_FILE
    );
  }

  fs.renameSync(
    temp,
    DATA_FILE
  );

  // data.json.bak 与恢复后的主文件同步；恢复前状态保存在 pre-restore.bak。
  vaultWriteBytes(DATA_BACKUP_FILE,vaultReadBytes(DATA_FILE));

  catalog = {
    ...catalog,
    ...restored,
    target:
      targetDir
  };

  catalogLoadError = null;
  catalogLoadedFromBackup = false;

  console.log(
    '历史数据已恢复'
  );

  return true;
}

function managedPath(item) {
  const relativeDir=String(item.relativeDir || '');
  if (relativeDir === 'source' || relativeDir.startsWith('source/')) {
    if (item.readOnly !== true) throw new Error('来源目录条目必须是只读索引');
    const result=path.join(targetDir,safeMediaRelativeDir(relativeDir),safeOriginalFilename(item.managedName));
    // Do not follow symlink/reparse-point chains introduced after indexing.
    const relative=path.relative(targetDir,result).split(path.sep);
    let cursor=targetDir;
    for (const part of relative) {
      cursor=path.join(cursor,part);
      const stat=fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error('不允许访问符号链接');
    }
    return result;
  }
  return path.join(targetDir,safeMediaRelativeDir(relativeDir),item.managedName);
}

// Explicit user deletion is allowed in every indexed media directory. Source
// folders remain protected against implicit rename/move or non-media cleanup.
function verifyIndexedMediaSource(item) {
  const file = managedPath(item);
  if (item.readOnly === true) {
    // A stale index must never delete a newly-replaced document, directory,
    // symbolic link or another file at the old path. Ask the user to refresh.
    const stat = fs.lstatSync(file);
    const ext = path.extname(file).toLowerCase();
    if (!stat.isFile() || stat.isSymbolicLink() || !MEDIA_EXTENSIONS.has(ext) ||
        ext !== String(item.originalExt || '').toLowerCase()) {
      throw new Error('源媒体文件类型已改变，请刷新媒体库');
    }
    const fingerprint = `${stat.size}-${Math.floor(stat.mtimeMs)}`;
    if (item.fingerprint && fingerprint !== item.fingerprint) {
      throw new Error('源文件已在外部发生变化，请刷新后重新删除');
    }
  }
  return file;
}
function deleteIndexedMediaFile(item) {
  const file=verifyIndexedMediaSource(item);
  // Existing managed-library semantics: an already-removed file can have its
  // stale catalog entry cleaned up by deletion as before.
  if (item.readOnly === true || fs.existsSync(file)) fs.unlinkSync(file);
  return file;
}

// Work/study source: virtual source/ path maps back to the selected directory.
// Data/ remains an independently managed hierarchy with existing Hash semantics.
function safeMediaRelativeDir(dir) {
  if (!dir) return '';
  const parts=String(dir).split('/');
  if(parts[0]==='source') {
    if(parts.length>33 || parts.some(x=>!x||x==='.'||x==='..'||/[\\/:*?"<>|\x00-\x1f]/.test(x)))throw new Error('非法来源目录');
    return parts.length===1?'':path.join(...parts.slice(1));
  }
  if(parts[0]!=='data' || parts.some(x=>!x || x==='.' || x==='..' || /[\\\/:*?"<>|\x00-\x1f]/.test(x)) || parts.length>13) throw new Error('非法素材目录');
  if(HASH_ENABLED && parts.slice(1).some(x=>!/^(?:[a-f0-9]{32}|1001|1002)$/i.test(x)))throw new Error('非法 hash 素材目录');
  return path.join(...parts);
}
function safeOriginalFilename(name) {
  const s=String(name||'');
  if(!s || s==='.' || s==='..' || /[\\\/:*?"<>|\x00-\x1f]/.test(s) || s.length>240) throw new Error('非法文件名');
  return s;
}
function safeGeneratedFilename(name) {
  let cleaned=String(name||'媒体').replace(/[\\\/:*?"<>|\x00-\x1f]/g,'_');
  if(cleaned.length>180){const ext=path.extname(cleaned);cleaned=cleaned.slice(0,180-ext.length)+ext;}
  return safeOriginalFilename(cleaned);
}
function uniqueVisibleName(dir, name) {
  const full=safeOriginalFilename(name);const ext=path.extname(full);
  const base=path.basename(full,ext);let candidate=full,i=2;
  while(fs.existsSync(path.join(dir,candidate))){candidate=safeOriginalFilename(base+' ('+i+++')'+ext);}
  return candidate;
}

function originalPendingPath(item) {
  return path.join(
    targetDir,
    safeMediaRelativeDir(item.relativeDir || ''),
    item.originalName || ''
  );
}

function coverFullPath(item) {
  return item.cover
    ? path.join(
        ASSET_DIR,
        item.cover
      )
    : '';
}

function removeCover(item) {
  const full =
    coverFullPath(
      item
    );

  if (!full) {
    return;
  }

  try {
    if (
      fs.existsSync(
        full
      )
    ) {
      fs.unlinkSync(
        full
      );
    }
  } catch {}
}