
purgeRememberedLauncherDirectory();
const RESTORE_MODE = args.includes('--restore');
const restoreBackupPath = RESTORE_MODE ? readLibraryDirectory('请输入加密备份路径（输入隐藏）：') : '';
const CACHE_DIR = path.join(
  targetDir,
  '.douyin-nav-cache'
);

// 用户放置图片、漫画目录、音频组的入口；内部只使用无扩展名 hash 文件。
const DATA_DIR = path.join(targetDir, 'data');
// 固定数字目录只表示生成素材的内部归档位置，不透露媒体内容。
const FRAME_SUBDIR = '1001';
const AUDIO_SUBDIR = '1002';

const ASSET_DIR = path.join(
  CACHE_DIR,
  'assets'
);

const COVER_DIR = path.join(
  ASSET_DIR,
  'covers'
);

const DATA_FILE = path.join(
  CACHE_DIR,
  'data.json'
);

const AI_USAGE_NOTICE = [
  'AI 使用约定（君子条款）',
  '本软件源代码、缓存索引、元数据及相关私有媒体库，未经权利人事先明确授权，不得交由 AI/自动化系统进行解读、分析、审计、训练、摘要、重构、逆向或数据挖掘，也不得对外传播。',
  '例外：权利人明确发起的协作开发、功能增加和故障修复等任务，仅限该次授权必需的范围。',
  '本约定表达权利人意愿；本身不构成技术访问控制，也不能保证第三方 AI 自动遵守。'
].join('\n');

const AI_USAGE_NOTICE_FILE = path.join(
  CACHE_DIR,
  'AI_USAGE_NOTICE.txt'
);

function ensureAiUsageNotice() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const text = AI_USAGE_NOTICE + '\n';
  if (!fs.existsSync(AI_USAGE_NOTICE_FILE) ||
      fs.readFileSync(AI_USAGE_NOTICE_FILE, 'utf8') !== text) {
    fs.writeFileSync(AI_USAGE_NOTICE_FILE, text, {
      encoding: 'utf8', mode: 0o600
    });
  }
}

const SECURITY_FILE = path.join(
  CACHE_DIR,
  'security.json'
);

const LIBRARY_SETTINGS_FILE = path.join(CACHE_DIR, 'library-settings.json');
function readLibrarySettings() {
  if (fs.existsSync(LIBRARY_SETTINGS_FILE)) {
    const config = JSON.parse(fs.readFileSync(LIBRARY_SETTINGS_FILE, 'utf8'));
    if (!config || config.version !== 1 ||
        typeof config.hashEnabled !== 'boolean' ||
        typeof config.passwordEnabled !== 'boolean') {
      throw new Error('媒体库初始化配置损坏，已拒绝启动');
    }
    return { hashEnabled:config.hashEnabled, passwordEnabled:config.passwordEnabled, legacy:false, persisted:true };
  }
  // Any pre-v6.21 cache (including a partially recovered legacy index) must be
  // treated as BOTH enabled, irrespective of flags passed today.
  if (fs.existsSync(CACHE_DIR) && fs.readdirSync(CACHE_DIR).length > 0) {
    return { hashEnabled:true, passwordEnabled:true, legacy:true, persisted:false };
  }
  // Restoring a pre-v6.21 encrypted backup also restores the legacy security mode.
  if(RESTORE_MODE)return {hashEnabled:true,passwordEnabled:true,legacy:true,persisted:false};
  return {hashEnabled:REQUEST_HASH,passwordEnabled:REQUEST_PWD,legacy:false,persisted:false};
}
let librarySettings;
try { librarySettings=readLibrarySettings(); }
catch(error) { console.error(error.message); process.exit(1); }
const HASH_ENABLED=librarySettings.hashEnabled;
const PWD_ENABLED=librarySettings.passwordEnabled;
const ERASE_AFTER_THREE=HASH_ENABLED && PWD_ENABLED;
function persistLibrarySettings() {
  if (librarySettings.persisted) return;
  fs.mkdirSync(CACHE_DIR,{recursive:true});
  const data=JSON.stringify({version:1,hashEnabled:HASH_ENABLED,passwordEnabled:PWD_ENABLED,createdAt:new Date().toISOString()},null,2);
  // Exclusive create ensures a failed/repeated first run cannot override the mode.
  try {fs.writeFileSync(LIBRARY_SETTINGS_FILE,data,{flag:'wx',mode:0o600});}
  catch(error) {if(error.code!=='EEXIST')throw error; const existing=readLibrarySettings();
    if(existing.hashEnabled!==HASH_ENABLED || existing.passwordEnabled!==PWD_ENABLED)throw new Error('媒体库配置在启动期间发生变化，已停止');}
  librarySettings.persisted=true;
}


// data.json 的上一版备份。用于异常中断、JSON 损坏时恢复。
const DATA_BACKUP_FILE =
  DATA_FILE + '.bak';
// v6.48 password-protected metadata vault. Salt is public; the secret stays in memory.
const VAULT_SALT_FILE=path.join(CACHE_DIR,'vault.json');


// 独立灾难恢复快照：永远放在 douyin.js 同目录，不跟媒体库走。
// data.json 内容使用 AES-256-GCM 加密；目录/时间/数量仅作为明文索引，
// 供 `node douyin --backups` 快速识别备份属于哪个媒体库。
const SCRIPT_DIR =
  path.dirname(
    path.resolve(
      __filename
    )
  );

const EXTERNAL_BACKUP_DIR =
  path.join(
    SCRIPT_DIR,
    '.douyin-data-backup'
  );

const EXTERNAL_BACKUP_FORMAT =
  'douyin-encrypted-data-backup';

const EXTERNAL_BACKUP_VERSION = 1;
const EXTERNAL_BACKUP_KEEP = 3;

function samePath(a, b) {
  const left = path.resolve(String(a || ''));
  const right = path.resolve(String(b || ''));

  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function copyMissingTree(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) {
    return 0;
  }

  fs.mkdirSync(destinationDir, { recursive:true });

  let copied = 0;

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes:true })) {
    const source = path.join(sourceDir, entry.name);
    const destination = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      copied += copyMissingTree(source, destination);
      continue;
    }

    if (!entry.isFile() || fs.existsSync(destination)) {
      continue;
    }

    fs.copyFileSync(source, destination);
    copied++;
  }

  return copied;
}

// No cross-library cache recovery: selecting a new target must never copy
// another library's hash index, password, or initialization configuration.

const STARTED_AT = Date.now();

function logStep(message) {
  // 安静模式：不输出目录、媒体名、扫描进度、缓存信息等。
  void message;
}


function elapsedText(from) {
  const ms =
    Date.now() - from;

  return ms < 1000
    ? `${ms}ms`
    : `${(ms / 1000).toFixed(2)}s`;
}

function commandExists(command) {
  const checker =
    process.platform === 'win32'
      ? 'where'
      : 'which';

  const result =
    spawnSync(
      checker,
      [command],
      {
        windowsHide: true,
        stdio: 'ignore'
      }
    );

  return result.status === 0;
}

const HAS_FFPROBE =
  commandExists(
    'ffprobe'
  );

const HAS_FFMPEG =
  commandExists(
    'ffmpeg'
  );

function ensureDirs() {
  fs.mkdirSync(
    COVER_DIR,
    {
      recursive: true
    }
  );

  // Windows 下把缓存目录设为隐藏，避免普通目录浏览时太显眼。
  if (process.platform === 'win32') {
    try {
      execFileSync(
        'attrib',
        ['+h', CACHE_DIR],
        {
          windowsHide: true,
          stdio: 'ignore'
        }
      );
    } catch {}
  }
}


function ensureSecurityDir() {
  fs.mkdirSync(
    CACHE_DIR,
    {
      recursive:true
    }
  );

  if (
    process.platform ===
      'win32'
  ) {
    try {
      execFileSync(
        'attrib',
        ['+h', CACHE_DIR],
        {
          windowsHide:true,
          stdio:'ignore'
        }
      );
    } catch {}
  }
}

let nonTtyLineReader =
  null;

const nonTtyLineQueue =
  [];

const nonTtyLineWaiters =
  [];

function ensureNonTtyLineReader() {
  if (
    nonTtyLineReader
  ) {
    return;
  }

  nonTtyLineReader =
    readline.createInterface({
      input:
        process.stdin,
      crlfDelay:
        Infinity
    });

  nonTtyLineReader.on(
    'line',
    line => {
      const waiter =
        nonTtyLineWaiters.shift();

      if (waiter) {
        waiter(
          line
        );
      } else {
        nonTtyLineQueue.push(
          line
        );
      }
    }
  );

  nonTtyLineReader.on(
    'close',
    () => {
      while (
        nonTtyLineWaiters.length
      ) {
        const waiter =
          nonTtyLineWaiters.shift();

        waiter('');
      }
    }
  );
}

function readNonTtyLine() {
  ensureNonTtyLineReader();

  if (
    nonTtyLineQueue.length
  ) {
    return Promise.resolve(
      nonTtyLineQueue.shift()
    );
  }

  return new Promise(
    resolve => {
      nonTtyLineWaiters.push(
        resolve
      );
    }
  );
}

function promptHidden(
  question
) {
  if (
    !process.stdin.isTTY
  ) {
    process.stdout.write(
      question
    );

    return readNonTtyLine()
      .then(
        answer => {
          process.stdout.write(
            '\n'
          );

          return answer;
        }
      );
  }

  return new Promise(
    (
      resolve,
      reject
    ) => {
      let muted =
        true;

      const silentOutput =
        new Writable({
          write(
            chunk,
            encoding,
            callback
          ) {
            if (!muted) {
              process.stdout.write(
                chunk,
                encoding
              );
            }

            callback();
          }
        });

      const rl =
        readline.createInterface({
          input:
            process.stdin,
          output:
            silentOutput,
          terminal:true
        });

      let settled =
        false;

      const finish =
        (
          error,
          value
        ) => {
          if (settled) {
            return;
          }

          settled =
            true;

          muted =
            false;

          try {
            rl.close();
          } catch {}

          process.stdout.write(
            '\n'
          );

          if (error) {
            reject(
              error
            );
          } else {
            resolve(
              value
            );
          }
        };

      rl.on(
        'SIGINT',
        () => {
          finish(
            new Error(
              '已取消'
            )
          );
        }
      );

      process.stdout.write(
        question
      );

      rl.question(
        '',
        answer => {
          finish(
            null,
            answer
          );
        }
      );
    }
  );
}


function makePasswordRecord(
  password
) {
  const salt =
    crypto.randomBytes(
      16
    );

  const key =
    crypto.scryptSync(
      password,
      salt,
      64
    );

  return {
    version:1,
    kdf:'scrypt',
    salt:
      salt.toString(
        'hex'
      ),
    hash:
      key.toString(
        'hex'
      ),
    failedAttempts:0,
    createdAt:
      new Date()
        .toISOString(),
    lastSuccessAt:null
  };
}

function readSecurityRecord() {
  if (
    !fs.existsSync(
      SECURITY_FILE
    )
  ) {
    return null;
  }

  const record =
    JSON.parse(
      fs.readFileSync(
        SECURITY_FILE,
        'utf8'
      )
    );

  if (
    !record ||
    record.kdf !==
      'scrypt' ||
    typeof record.salt !==
      'string' ||
    typeof record.hash !==
      'string'
  ) {
    throw new Error(
      '密码配置损坏，已拒绝启动。'
    );
  }

  return record;
}

function writeSecurityRecord(
  record
) {
  ensureSecurityDir();

  const temp =
    SECURITY_FILE +
    '.tmp-' +
    process.pid;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      record,
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
    SECURITY_FILE
  );
}

function verifyPassword(
  password,
  record
) {
  try {
    const salt =
      Buffer.from(
        record.salt,
        'hex'
      );

    const expected =
      Buffer.from(
        record.hash,
        'hex'
      );

    const actual =
      crypto.scryptSync(
        password,
        salt,
        expected.length
      );

    return (
      expected.length ===
        actual.length &&
      crypto.timingSafeEqual(
        expected,
        actual
      )
    );
  } catch {
    return false;
  }
}

function safeManagedName(
  value
) {
  const name =
    String(
      value || ''
    );

  return (
    path.basename(
      name
    ) === name &&
    /^[a-f0-9]{32}$/i
      .test(
        name
      )
  );
}

function destroyProtectedLibraryData() {
  const deleted = [];
  const failed = [];

  const resolvedTarget =
    path.resolve(
      targetDir
    );

  const root =
    path.parse(
      resolvedTarget
    ).root;

  // 防止目录参数误写成磁盘根目录，例如 C:\ 或 G:\。
  // 用户指定的普通目录（例如 G:\抖音媒体）则会清空其全部内容。
  if (
    resolvedTarget ===
      root
  ) {
    return {
      deleted:0,
      failed:[
        {
          path:
            resolvedTarget,
          error:
            '拒绝清空磁盘根目录'
        }
      ]
    };
  }

  let entries = [];

  try {
    entries =
      fs.readdirSync(
        resolvedTarget,
        {
          withFileTypes:true
        }
      );
  } catch (error) {
    return {
      deleted:0,
      failed:[
        {
          path:
            resolvedTarget,
          error:
            error.message
        }
      ]
    };
  }

  for (
    const entry of
    entries
  ) {
    const fullPath =
      path.join(
        resolvedTarget,
        entry.name
      );

    try {
      fs.rmSync(
        fullPath,
        {
          recursive:true,
          force:true,
          maxRetries:3,
          retryDelay:120
        }
      );

      deleted.push(
        fullPath
      );
    } catch (error) {
      // Windows 上遇到只读属性时再尝试一次。
      try {
        if (
          fs.existsSync(
            fullPath
          )
        ) {
          try {
            fs.chmodSync(
              fullPath,
              0o777
            );
          } catch {}

          fs.rmSync(
            fullPath,
            {
              recursive:true,
              force:true,
              maxRetries:3,
              retryDelay:120
            }
          );
        }

        deleted.push(
          fullPath
        );
      } catch (retryError) {
        failed.push({
          path:
            fullPath,
          error:
            retryError.message ||
            error.message
        });
      }
    }
  }

  return {
    deleted:
      deleted.length,
    failed
  };
}


async function setupFirstPassword() {
  while (true) {
    const password =
      await promptHidden(
        '设置密码：'
      );

    if (
      !String(
        password
      ).length
    ) {
      console.log(
        '密码不能为空'
      );

      continue;
    }

    const again =
      await promptHidden(
        '确认密码：'
      );

    if (
      password !==
        again
    ) {
      console.log(
        '两次密码不一致'
      );

      continue;
    }

    writeSecurityRecord(
      makePasswordRecord(
        password
      )
    );

    console.log(
      '密码已设置'
    );

    return password;
  }
}

async function unlockLibrary() {
  ensureSecurityDir();

  let record =
    readSecurityRecord();

  if (!record) {
    return setupFirstPassword();
  }

  let failedAttempts =
    Math.max(
      0,
      Math.min(
        3,
        Number(
          record.failedAttempts ||
          0
        )
      )
    );

  while (
    failedAttempts <
      3
  ) {
    const password =
      await promptHidden(
        '密码：'
      );

    if (
      verifyPassword(
        password,
        record
      )
    ) {
      record.failedAttempts =
        0;

      record.lastSuccessAt =
        new Date()
          .toISOString();

      writeSecurityRecord(
        record
      );

      console.log(
        '验证通过'
      );

      return password;
    }

    failedAttempts++;

    record.failedAttempts =
      failedAttempts;

    record.lastFailedAt =
      new Date()
        .toISOString();

    writeSecurityRecord(
      record
    );

    console.log(
      `密码错误（${failedAttempts}/3）`
    );
  }

  if (!ERASE_AFTER_THREE) {
    // Password-only libraries fail closed, but must never delete any files.
    record.failedAttempts=0;
    writeSecurityRecord(record);
    return false;
  }

  // 第三次错误后静默清空目标目录。
  // 不输出目标路径、删除进度、删除结果或失败项。
  destroyProtectedLibraryData();

  return false;
}