/*
 * AI 使用约定（君子条款）
 * 本软件源代码、缓存索引、元数据及由此构成的私有媒体库，均仅供权利人授权的用途使用。
 * 未经权利人事先明确许可，请勿将这些内容交给 AI/自动化系统进行解读、分析、审计、
 * 训练、摘要、重构、逆向或数据挖掘，也请勿对外传播。
 * 例外：权利人主动授权的协作开发、修复 Bug、新增功能等任务（例如本项目的协作迭代），
 * 仅可在该次授权任务的必要范围内处理相应内容。
 * 这是一项请求合作方自觉遵守的使用约定，并非加密/访问控制或对 AI 行为的技术保证。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const readline = require('readline');
const { Writable } = require('stream');
const { spawn, spawnSync, execFileSync } = require('child_process');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.wmv', '.mov', '.m4v',
  '.flv', '.rmvb', '.ts', '.webm', '.mpg', '.mpeg'
]);

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp'
]);

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma', '.aiff', '.alac'
]);

const MEDIA_EXTENSIONS = new Set([
  ...VIDEO_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...AUDIO_EXTENSIONS
]);

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.rmvb': 'application/vnd.rn-realmedia-vbr',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.aac':'audio/aac',
  '.wav':'audio/wav', '.flac':'audio/flac', '.ogg':'audio/ogg',
  '.opus':'audio/ogg', '.wma':'audio/x-ms-wma', '.aiff':'audio/aiff',
  '.alac':'audio/mp4'
};

function mediaKindFromExt(ext) {
  ext =
    String(ext || '')
      .toLowerCase();

  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }

  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';

  return '';
}

function itemMediaKind(item) {
  if (!item) {
    return '';
  }

  const explicit =
    String(
      item.kind || ''
    ).toLowerCase();

  if (
    explicit === 'video' ||
    explicit === 'image' ||
    explicit === 'audio'
  ) {
    return explicit;
  }

  return mediaKindFromExt(
    item.originalExt
  );
}


const args = process.argv.slice(2);

function getArgValue(name) {
  const prefix = `${name}=`;
  const direct = args.find(v => v.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);

  const i = args.indexOf(name);

  if (
    i >= 0 &&
    args[i + 1] &&
    !args[i + 1].startsWith('--')
  ) {
    return args[i + 1];
  }

  return '';
}

const REFRESH = args.includes('--refresh');
const NO_SCREENSHOT = args.includes('--no-screenshot');
const BACKUPS_MODE = args.includes('--backups');
const PORT = Number(getArgValue('--port')) || 3865;
// 安全策略：服务只监听本机回环地址，禁止局域网设备访问。
// 即使传入 --host 参数也不会改变监听地址。
const HOST = '127.0.0.1';

// v6.21: directory names must never appear as command-line arguments, logs, or launcher state.
// Read synchronously before any library path or cache is touched. Raw TTY mode
// suppresses terminal echo, and a pipe is supported for isolated automated tests.
function readLibraryDirectory(question='请输入媒体目录（输入内容隐藏）：') {
  process.stdout.write(question);
  const wasRaw = Boolean(process.stdin.isTTY && process.stdin.isRaw);
  const raw = Boolean(process.stdin.isTTY && typeof process.stdin.setRawMode === 'function');
  const chars = [];
  const byte = Buffer.allocUnsafe(1);
  try {
    if (raw) process.stdin.setRawMode(true);
    while (true) {
      let n;
      try { n = fs.readSync(0, byte, 0, 1, null); }
      catch (e) { if (e.code === 'EAGAIN' || e.code === 'EINTR') continue; throw e; }
      if (!n) break;
      const c = byte[0];
      if (c === 10 || c === 13) break;
      if (c === 3 && raw) throw new Error('用户已取消');
      if (c === 127 || c === 8) {
        // Backspace one UTF-8 code point without echoing anything.
        if (chars.length) {
          chars.pop();
          while (chars.length && (chars[chars.length-1] & 0xc0) === 0x80) chars.pop();
        }
        continue;
      }
      if (chars.length >= 16384) throw new Error('输入过长');
      chars.push(c);
    }
  } finally {
    if (raw) process.stdin.setRawMode(wasRaw);
    process.stdout.write('\n');
  }
  const result = Buffer.from(chars).toString('utf8').trim().replace(/^['"]|['"]$/g,'');
  if (!result) throw new Error('未输入有效媒体目录');
  return path.resolve(result);
}

const LEGACY_BACKUP_LIST = BACKUPS_MODE;
const REQUEST_HASH = args.includes('--hash');
const REQUEST_PWD = args.includes('--pwd');
const allowed = new Set(['--hash','--pwd','--no-screenshot','--refresh','--backups','--restore']);
for(let i=0;i<args.length;i++) {
  const a=args[i];
  if(a==='--port' || a==='--host'){i++;continue;}
  if(!allowed.has(a) && !a.startsWith('--port=') && !a.startsWith('--host=')) {
    console.error('不再接受命令行媒体路径；请运行 node douyin [--hash] [--pwd]，然后输入目录。');
    process.exit(2);
  }
}
// --backups retains the legacy backup listing without requesting a directory.
const targetDir = LEGACY_BACKUP_LIST ? process.cwd() : readLibraryDirectory();
// Previous releases stored lastTargetDir under HOME. Remove only that obsolete
// launcher key; never use it to select or recover a different media library.
function purgeRememberedLauncherDirectory() {
  const file=path.join(os.homedir(),'.douyin-nav','launcher.json');
  try {
    if(!fs.existsSync(file) || !fs.statSync(file).isFile())return;
    const state=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!state || typeof state!=='object' || !Object.hasOwn(state,'lastTargetDir'))return;
    delete state.lastTargetDir;
    delete state.updatedAt;
    if(!Object.keys(state).length){fs.unlinkSync(file);return;}
    const temp=file+'.tmp-'+process.pid;
    fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});
    fs.renameSync(temp,file);
  } catch { /* launch must not fail if obsolete launcher metadata is inaccessible */ }
}
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
  aiUsageNotice: AI_USAGE_NOTICE,
  items: []
};

let catalogLoadError = null;
let catalogLoadedFromBackup = false;

function readCatalogFile(file) {
  const value =
    JSON.parse(
      fs.readFileSync(
        file,
        'utf8'
      )
    );

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
  catalog.aiUsageNotice = AI_USAGE_NOTICE;
} catch (error) {
  catalogLoadError =
    error instanceof Error
      ? error
      : new Error(
          String(error)
        );
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
  catalog.aiUsageNotice = AI_USAGE_NOTICE;
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

  const json =
    JSON.stringify(
      catalog,
      null,
      2
    );

  const temp =
    DATA_FILE +
    '.tmp-' +
    process.pid +
    '-' +
    Date.now();

  fs.writeFileSync(
    temp,
    json,
    'utf8'
  );

  try {
    if (fs.existsSync(DATA_FILE)) {
      fs.copyFileSync(
        DATA_FILE,
        DATA_BACKUP_FILE
      );
    }

    fs.renameSync(
      temp,
      DATA_FILE
    );

    // 第一次保存时也建立一份可恢复备份。
    if (!fs.existsSync(DATA_BACKUP_FILE)) {
      fs.copyFileSync(
        DATA_FILE,
        DATA_BACKUP_FILE
      );
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

  const plaintext =
    Buffer.from(
      fs.readFileSync(
        DATA_FILE,
        'utf8'
      ),
      'utf8'
    );

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
      originalTarget:
        targetDir,
      itemCount:
        sourceCatalog.items.length,
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
    fs.copyFileSync(
      DATA_FILE,
      preRestore
    );
  }

  restored.target =
    targetDir;

  const temp =
    DATA_FILE +
    '.restore-' +
    process.pid;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      restored,
      null,
      2
    ),
    'utf8'
  );

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
  fs.copyFileSync(
    DATA_FILE,
    DATA_BACKUP_FILE
  );

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
  return path.join(
    targetDir,
    safeMediaRelativeDir(item.relativeDir || ''),
    item.managedName
  );
}

// 只允许 data 下预期的 hash / 数字层级，阻止索引损坏导致越目录访问。
function safeMediaRelativeDir(dir) {
  if (!dir) return '';
  const parts=String(dir).split('/');
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
  if (!MEDIA_EXTENSIONS.has(ext)) return;
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) return;
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
      if (entry.isSymbolicLink()) continue;
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

      if (!HASH_ENABLED) {
        // Original filename and bytes remain untouched. Only index metadata is added.
        if (!catalog.items.some(x => (x.relativeDir||'')==='' && x.managedName===entry.name)) {
          const ext=path.extname(entry.name).toLowerCase();
          const parsed=parseOriginalName(entry.name);
          catalog.items.push({key:hashKey('root/'+entry.name),managedName:entry.name,originalName:entry.name,
            originalExt:ext,kind:mediaKindFromExt(ext),mime:MIME_BY_EXT[ext]||'application/octet-stream',
            creator:parsed.creator,title:parsed.title,rating:0,rotation:0,cover:'',coverTime:0,
            duration:0,durationText:'',width:0,height:0,resolution:'',codec:'',size:stat.size,
            sizeText:formatBytes(stat.size),importedAt:new Date().toISOString(),
            modifiedTimeMs:Number(stat.mtimeMs)||0,modifiedAt:new Date(stat.mtimeMs).toISOString(),
            fingerprint:`${stat.size}-${Math.floor(stat.mtimeMs)}`,state:'ready'});
          saveCatalog();added++;
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
      const stat =
        fs.statSync(
          managedPath(item)
        );

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
    } catch {}
  }

  if (changed) {
    saveCatalog();
  }

  return changed;
}

function probeVideo(filePath) {
  if (!HAS_FFPROBE) {
    return {};
  }

  const result =
    spawnSync(
      'ffprobe',
      [
        '-v','error',
        '-print_format','json',
        '-show_format',
        '-show_streams',
        filePath
      ],
      {
        encoding:'utf8',
        windowsHide:true,
        maxBuffer:
          5 * 1024 * 1024
      }
    );

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

    return {
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

function writeCover(
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
  const result =
    spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel','error',
        '-y',
        ...(indexed?[]:['-ss',String(t)]),
        '-i',managedPath(item),
        '-frames:v','1',
        ...(indexed?['-vsync','0']:[]),
        '-vf',indexed?`select=eq(n\\,${frameIndex}),scale=720:-2`:'scale=720:-2',
        '-q:v','4',
        temp
      ],
      {
        windowsHide:true,
        stdio:'ignore'
      }
    );

  if (
    result.status !== 0 ||
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

        const cover =
          coverFullPath(
            item
          );

        return (
          REFRESH ||
          !item.duration ||
          !item.resolution ||
          !item.cover ||
          !cover ||
          !fs.existsSync(
            cover
          )
        );
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

    if (
      REFRESH ||
      !item.duration ||
      !item.resolution
    ) {
      Object.assign(
        item,
        probeVideo(
          managedPath(
            item
          )
        )
      );
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
      writeCover(
        item,
        item.coverTime ||
        item.duration * 0.35
      );
    }

    saveCatalog();

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
      reconcileCatalog();
      syncFileModificationTimes();

      await enrichCatalog();
    } while (
      rescanPending
    );
  } finally {
    scanRunning =
      false;
  }
}

// A/B 片段只是原视频上的虚拟时间区间，不生成新媒体，不改原文件。
function publicClip(clip) {
  const source = catalog.items.find(item => item.key === clip.sourceKey && item.state === 'ready' && itemMediaKind(item) === 'video');
  return {
    id:clip.id, sourceKey:clip.sourceKey, name:clip.name, a:clip.a, b:clip.b,
    favorite:!!clip.favorite, createdAt:clip.createdAt, updatedAt:clip.updatedAt,
    sourceTitle:source ? (source.title || source.originalName || '未命名视频') : (clip.sourceTitle || '源视频'),
    sourceAvailable:Boolean(source),
    sourceDuration:source ? Number(source.duration || 0) : 0
  };
}
function validateClipRange(item, a, b) {
  a = Number(a); b = Number(b);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b - a < .06 || b > 86400) {
    throw new Error('A/B 范围无效，B 必须比 A 至少晚 0.06 秒');
  }
  const duration = Number(item.duration || 0);
  if (duration > 0 && b > duration + .25) throw new Error('B 点超过源视频长度');
  return {a:Math.round(a * 1000) / 1000, b:Math.round(b * 1000) / 1000};
}
function validClipName(value) {
  const name = String(value == null ? '' : value).replace(/[\x00-\x1f\x7f]/g,'').trim();
  if (!name || name.length > 100) throw new Error('片段名称应为 1–100 字符');
  return name;
}
function clipSource(key) {
  const item = catalog.items.find(x => x.key === key && x.state === 'ready' && itemMediaKind(x) === 'video');
  if (!item || !fs.existsSync(managedPath(item))) throw new Error('源视频已不存在，无法操作此片段');
  return item;
}
function mutateClip(body) {
  const action = String(body.action || '');
  const clips = catalog.clips;
  if (action === 'create') {
    if (clips.length >= 10000) throw new Error('片段记录已达上限');
    const source = clipSource(String(body.sourceKey || ''));
    const range = validateClipRange(source,body.a,body.b);
    const now = new Date().toISOString();
    const clip = {id:crypto.randomBytes(12).toString('hex'),sourceKey:source.key,
      sourceTitle:source.title || source.originalName || '',
      name:validClipName(body.name),...range,favorite:!!body.favorite,createdAt:now,updatedAt:now};
    clips.push(clip);
    saveCatalog();
    return publicClip(clip);
  }
  if (!/^[a-f0-9]{24}$/.test(String(body.id || ''))) throw new Error('片段 ID 无效');
  const index = clips.findIndex(c => c.id === body.id);
  if (index < 0) throw new Error('片段记录不存在');
  const clip = clips[index];
  if (action === 'delete') {
    // 只删除记录，绝不删除源视频或已导出的 MP4。
    clips.splice(index,1);
    saveCatalog();
    return {id:body.id};
  }
  if (action === 'update') {
    const patch = {};
    if (body.name !== undefined) patch.name = validClipName(body.name);
    if (body.a !== undefined || body.b !== undefined) {
      Object.assign(patch,validateClipRange(clipSource(clip.sourceKey),
        body.a === undefined ? clip.a : body.a,body.b === undefined ? clip.b : body.b));
    }
    if (body.favorite !== undefined) {
      if (typeof body.favorite !== 'boolean') throw new Error('收藏状态无效');
      patch.favorite = body.favorite;
    }
    Object.assign(clip,patch,{updatedAt:new Date().toISOString()});
    saveCatalog();
    return publicClip(clip);
  }
  throw new Error('未知片段操作');
}

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
    kind:
      itemMediaKind(item) || 'video',
    relativeDir: item.relativeDir || '',
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
        ? mediaUrl
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
      itemMediaKind(
        item
      ) === 'video'
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

const APP_FAVICON_ICO = Buffer.from('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vWdN/Q4A8F0//PGB/3Lri1+zbrL62krVvAxE20mZNECj2XZotDpod3PklmFdQBCATIQkSWBMDFAAglht6Ggcm7tD5j/LdvkTn7hpw5f2ld04IkL7AXULgddc/bNjVW895ZRQOjvi3rlzT/zeD9x6xaaNA9drTVuV0Zv7+tIRCaHfk4qKJhPk3qtmbv0CwEec4yfm5/NDp//13kfe9q7Xts/+HQcOiDl4EPxCzd2/ICAiNCuiewINF/mz1IEDYvbsuTytZGu43BChPXv2KCkMwpR/qrIhpBjGIEWvYO81syJ6z57iNc/121/DGtawhjWsYQ1rWMMa1rCGNaxhDWtYwxq+IvC/AN+lrRpmcjrIAAAAAElFTkSuQmCCiVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAACjK0lEQVR4nOy9d4BlWVUu/q299znnhsqhq3NPT07MDDMMOXSDjyBJxG5QRJSk7xl/z4coD61qBAmKCiiKYgDFh9UqoiggSjcOmWGYnFPn6VRd4d57wg7r98fe59zbI+D0zHS+H9RUVXfF23evvda3vvUtoI8++uijjz766KOPPvroo48++uijjz766KOPPvroo48++uijjz766KOPPvroo48++uijjz766KOPPvroo48++uijjz766KOPPvroo48++uijjz766KOPPvroo48++uijjz7OGBDAdLJ/iEcKcbJ/gD76OF0xPc1i27ZtipklMwtmJmYGMxD+TG3btk1NT3P/nPXRx5mA6elpsW3bNiXE97zkv+tfhOAgmU+t7OCU+mH66ONURTi4gohs+Wd/+Kc3X3HeupFnj4w1Lh1oqhVxTJMA6sSkc4MDaTu///C8u+GGO/Kvvu3n1t7b87Vk79fpo48+TmHMMsvy7Z/75c+vv+6re37t/geXvrbnoU6xkDIvFcyLOXOrYM4tHwXHzAcOZq077mn/++e2HXjT+U/+1yEAEILQLw366ONUhk/bBQC89KWfnvrGN/a9a9ee1lxumRdT5l37U3v/nnZ+3+52vnN/lh9a0EUnNVpro402hTE2t9YWPgx47N6X3v3Zfz/wRgT+jXuCSx999HGKYHp6WlAokP/uU/e9Yceu1m7tmB+aK/ienUvZrffO6VvvOWxuu++wvfOBeXvfriW7e39qD80XdrGtbTszNs20ywvjjLHGGlNY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', 'base64');

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

function htmlPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0b1119">
<meta name="apple-mobile-web-app-title" content="本地媒体库">
<link rel="icon" type="image/x-icon" href="/favicon.ico?v=6.16" sizes="any">
<link rel="shortcut icon" href="/favicon.ico?v=6.16" type="image/x-icon">
<link rel="manifest" href="/manifest.webmanifest">
<title>本地媒体库</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;background:#101114;color:#eceef2;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
body{min-height:100vh}
button,input{font:inherit}
header{position:sticky;top:0;z-index:20;background:rgba(16,17,20,.96);backdrop-filter:blur(14px);border-bottom:1px solid #292c33;padding:13px 20px}
.top{display:flex;gap:10px;align-items:center}
h1{font-size:19px;margin:0 10px 0 0;white-space:nowrap}
#search{flex:1;min-width:180px;background:#1d1f24;color:#fff;border:1px solid #353943;border-radius:11px;padding:10px 12px;outline:none}
#search:focus{border-color:#596171}
.creatorToggle,.sortBtn{border:1px solid #353943;background:#1d1f24;color:#d9dde4;border-radius:10px;padding:9px 11px;cursor:pointer;white-space:nowrap}
.sortBtn.active{background:#eef1f5;color:#17181b;border-color:#eef1f5;font-weight:700}
.sortBtn:not(.active):hover{background:#272a31;border-color:#454a56}
.creatorPanel{max-height:min(38vh,360px);overflow-x:hidden;overflow-y:auto;opacity:1;transition:max-height .18s ease,opacity .15s ease;scrollbar-gutter:stable}
.creatorPanel::-webkit-scrollbar{width:8px}
.creatorPanel::-webkit-scrollbar-track{background:transparent}
.creatorPanel::-webkit-scrollbar-thumb{background:#343943;border:2px solid #101114;border-radius:999px}
.creatorPanel.collapsed{max-height:0;overflow:hidden;opacity:0;pointer-events:none}
.creatorTags{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:10px 4px 6px 0}
.creatorTag{min-height:30px;border:1px solid #353943;background:#1d1f24;color:#bfc5cf;border-radius:999px;padding:0 10px;font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}
.creatorTag.on{background:#eee;color:#17181b;border-color:#eee;font-weight:700}
.creatorTagGroup{height:30px;max-width:100%;flex:0 1 auto;display:inline-flex;align-items:stretch;border:1px solid #353943;border-radius:999px;overflow:hidden;background:#1d1f24}
.creatorTagGroup .creatorTag{min-width:0;max-width:min(240px,40vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;border-radius:0;background:transparent}
.creatorTagGroup .creatorTag.on{background:#eee;color:#17181b;font-weight:700}
.creatorRename{width:28px;height:100%;flex:0 0 28px;border:0;border-left:1px solid #353943;background:#202329;color:#8fa2ba;cursor:pointer;font-size:13px;line-height:1;padding:0;display:inline-flex;align-items:center;justify-content:center}
.creatorRename:hover{background:#2a2e36;color:#fff}
.creatorRow{display:flex;align-items:center;gap:4px;min-width:0}
.creatorEditBtn{width:24px;height:24px;border:0;background:transparent;color:#69788c;border-radius:6px;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.creatorEditBtn:hover{background:#252830;color:#c7d5e6}
.creatorLinkBtn{width:24px;height:24px;border:0;background:transparent;color:#69788c;border-radius:6px;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;text-decoration:none;font-size:14px}
.creatorLinkBtn:hover{background:#252830;color:#c7d5e6}
.creatorLinkEdit{width:28px;height:100%;flex:0 0 28px;border:0;border-left:1px solid #353943;background:#202329;color:#8fa2ba;cursor:pointer;font-size:12px;line-height:1;padding:0;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.creatorLinkEdit:hover{background:#2a2e36;color:#fff}
@media(max-width:650px){.creatorPanel{max-height:32vh}.creatorTags{gap:6px;padding-right:2px}.creatorTagGroup .creatorTag{max-width:145px}}
.status{font-size:12px;color:#969daa;margin-top:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(245px,1fr));gap:15px;padding:18px}
.mediaTabs{display:flex;gap:5px;padding:2px;border:1px solid #363a42;background:#1b1d22;border-radius:11px;white-space:nowrap}
.mediaTabs button{border:0;color:#aeb8c6;background:transparent;border-radius:8px;padding:8px 13px;cursor:pointer}
.mediaTabs button.on{background:#e5ebf5;color:#171b22;font-weight:750}
.assetFolders{display:flex;flex-wrap:wrap;gap:8px;margin:13px 18px 0;align-items:center}
.assetFolders button{border:1px solid #3c414c;border-radius:10px;background:#202329;color:#ccd2df;padding:9px 13px;cursor:pointer;text-align:left}
.assetFolders button:hover,.assetFolders button.on{background:#394353;color:white}
.folderContext{font-size:12px;color:#a8b1bd;padding:0 18px;margin-top:12px}
.assetFolderTiles{display:flex;gap:10px;flex-wrap:wrap;margin:12px 18px 0}
.assetFolderTiles .folderEntry{width:auto!important;min-width:160px;max-width:100%;margin:0!important}
.pictureWall{column-count:5;column-gap:12px;padding:15px 18px}
.pictureTile{display:inline-block;width:100%;break-inside:avoid;margin:0 0 12px;background:#1b1d22;border:1px solid #31353e;border-radius:10px;overflow:hidden;cursor:pointer}
.pictureTile img{display:block;width:100%;height:auto;min-height:45px;background:#111;max-height:540px;object-fit:contain}
.pictureTile span{display:block;padding:8px 9px;color:#cbd1dc;font-size:12px;overflow-wrap:anywhere}
/* 音频：最大宽度操作区 + 长进度轨 + A/B 区间 + 弹出式竖直音量。 */
.audioList{display:flex;flex-direction:column;gap:14px;padding:16px 18px;width:100%;max-width:none;margin:0;box-sizing:border-box}
.audioTrack{background:#1b1e25;border:1px solid #343b48;border-radius:14px;padding:16px 18px;min-width:0;width:100%;box-sizing:border-box;box-shadow:0 2px 12px #00000014}
.audioTrack:focus-within{border-color:#586679}
.audioTrackHeader{display:flex;align-items:center;gap:12px;min-width:0;margin-bottom:15px}
.audioArtwork{display:flex;align-items:center;justify-content:center;flex:0 0 42px;height:42px;border-radius:11px;background:#29394b;color:#9cc6ff;font-size:24px}
.audioTrackInfo{flex:1;min-width:0}
.audioTrack .audioTitle{font-size:15px;font-weight:650;color:#e9edf5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.audioMeta{margin-top:4px;font-size:12px;color:#8994a7}
.audioTrack audio{display:none}
.audioTimeline{display:flex;align-items:center;gap:12px;width:100%;min-width:0}
.audioIconBtn{height:34px;min-width:34px;display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:0 10px;border:1px solid #3b4554;background:#232a35;color:#cdd9e9;border-radius:9px;cursor:pointer;flex:0 0 auto;font-size:12px;white-space:nowrap}
.audioIconBtn:hover{background:#334154;color:#fff}
.audioIconBtn:disabled{opacity:.4;cursor:not-allowed}
.audioPlay{height:40px;width:40px;min-width:40px;border-radius:50%;background:#e5ebf5;color:#151922;border:0;padding:0;display:grid;place-items:center;line-height:0}
.audioPlay:hover{background:#fff;color:#151922}
.audioPlay svg{display:block;width:22px;height:22px;flex:none;overflow:visible}
.audioPlay .audioGlyphPlay{transform:translateX(1px)}
.audioPlay[data-playing="true"] .audioGlyphPlay{display:none}
.audioPlay:not([data-playing="true"]) .audioGlyphPause{display:none}
.audioPlay:focus-visible,.audioSpeed:focus-visible,.audioSpeedChoice:focus-visible{outline:2px solid #a7caff;outline-offset:3px}
.audioTime{font-size:13px;color:#c2cbdb;font-variant-numeric:tabular-nums;white-space:nowrap;flex:0 0 auto;text-align:center;min-width:61px}
.audioSeekWrap{position:relative;flex:1;min-width:60px;display:flex;align-items:center;height:32px}
.audioSeek{flex:1;width:100%;min-width:0;display:block;appearance:none;-webkit-appearance:none;cursor:pointer;outline:none;background:linear-gradient(to right,#bbd7ff 0%,#bbd7ff var(--audio-progress,0%),#465162 var(--audio-progress,0%),#465162 100%);border:0;border-radius:999px;height:7px;margin:0;accent-color:#a7caff}
.audioSeek::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:#f0f6ff;border:2px solid #8baedb;box-shadow:0 0 0 3px #151a20}
.audioSeek::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#f0f6ff;border:2px solid #8baedb}
.audioSeek:focus-visible,.audioVolume:focus-visible{outline:2px solid #a7caff;outline-offset:6px}
.audioMark{position:absolute;top:2px;height:12px;width:2px;border-radius:1px;pointer-events:none;display:none;transform:translateX(-50%);z-index:1}
.audioMarkA{background:#7dbdff}.audioMarkB{background:#ffbb80}
.audioTools{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:13px 0 0 52px;flex-wrap:wrap}
.audioABTools,.audioRightTools{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.audioABInfo{font-size:12px;color:#95a3b7;font-variant-numeric:tabular-nums;margin-left:3px}
.audioABBtn{min-width:33px;padding:0 11px}
.audioABBtn.on{color:#d9eaff;background:#294363;border-color:#6b96c9}
.audioABLoop.on{background:#a7caff;color:#121b29;border-color:#d7e7ff;font-weight:750;box-shadow:0 0 0 2px #a7caff30}
.audioABLoop.on:hover{background:#d7e7ff;color:#121b29}
.audioABLoop.on:disabled{opacity:.4}
.audioClip{color:#c2ddff}
.audioLoop.on{color:#d9e7ff;background:#2b3c52;border-color:#58708f}
.audioSpeedBox{position:relative;display:flex;align-items:center}
.audioSpeed{min-width:53px;font-variant-numeric:tabular-nums}
.audioSpeedPopup{position:absolute;bottom:calc(100% + 10px);right:0;min-width:98px;max-height:min(340px,55dvh);overflow-y:auto;padding:5px;border:1px solid #47566d;border-radius:11px;background:#242c39;box-shadow:0 12px 36px #0009;display:none;flex-direction:column;gap:2px;z-index:10}
.audioSpeedBox.open .audioSpeedPopup{display:flex}
.audioSpeedChoice{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:9px 11px;border:0;border-radius:7px;text-align:left;background:transparent;color:#dce6f4;font-size:13px;cursor:pointer}
.audioSpeedChoice:hover,.audioSpeedChoice.on{background:#385071;color:#fff}
.audioSpeedChoice.on:after{content:'✓';font-weight:750}
.audioSpeedPopup::-webkit-scrollbar{width:5px}
.audioSpeedPopup::-webkit-scrollbar-thumb{background:#58677d;border-radius:9px}
.audioVolumeBox{position:relative;display:flex;align-items:center}
.audioVolumePopup{position:absolute;bottom:calc(100% + 10px);right:0;width:52px;height:166px;border:1px solid #47566d;border-radius:12px;background:#242c39;box-shadow:0 12px 36px #0009;display:none;align-items:center;justify-content:center;z-index:8}
.audioVolumeBox.open .audioVolumePopup{display:flex}
.audioVolume{appearance:none;-webkit-appearance:none;writing-mode:vertical-lr;direction:rtl;width:9px;height:126px;border-radius:999px;background:#4b5c73;accent-color:#a7caff;cursor:pointer;outline:none}
.audioVolume::-webkit-slider-thumb{-webkit-appearance:none;width:17px;height:17px;border:2px solid #83a6d4;border-radius:50%;background:#e5eeff}
.audioVolume::-moz-range-thumb{width:15px;height:15px;border:2px solid #83a6d4;border-radius:50%;background:#e5eeff}
.audioTrack .assetRemove{padding:7px 11px;flex:0 0 auto}
.audioMessage{font-size:12px;color:#f0adad;padding:8px 0 0 52px;min-height:0}
.audioMessage:empty{display:none}
@media(max-width:700px){.audioList{padding:10px}.audioTrack{padding:12px}.audioTimeline{gap:7px}.audioTime{font-size:11px;min-width:44px}.audioTools{margin-left:0}.audioIconBtn{padding:0 8px}.audioABInfo{width:100%;margin:2px 0}.audioMessage{padding-left:0}}

/* 音频列表与播放区解耦：多列展示，最多三行文件名。 */
.audioFileGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,245px),1fr));gap:12px;padding:16px 18px 24px;align-content:start}
.audioFileTile{display:flex;align-items:flex-start;min-width:0;min-height:108px;gap:11px;background:#1b1e25;border:1px solid #343b48;border-radius:12px;padding:13px 11px;position:relative;cursor:default;transition:border-color .13s,background .13s}
.audioFileTile:hover{background:#222834;border-color:#5b6880}
.audioFileTile.isActive{background:#233348;border-color:#7ca6dc;box-shadow:inset 0 0 0 1px #7ca6dc45}
.audioFileTile:focus-visible{outline:2px solid #a7caff;outline-offset:3px}
.audioFileArt{flex:0 0 35px;width:35px;height:35px;border-radius:9px;background:#303c50;color:#a7caff;display:grid;place-items:center;font-size:20px}
.audioFileText{flex:1;min-width:0;padding-top:1px}
.audioFileName{font-size:14px;font-weight:630;line-height:1.45;color:#e7edf8;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow-wrap:anywhere;min-height:20px;max-height:calc(1.45em * 3)}
.audioFileMeta{margin-top:7px;color:#8795a8;font-size:11px}
.audioFileActions{display:flex;flex:0 0 auto;flex-direction:column;align-items:center;gap:7px}
.audioFileRename{color:#b6cadf;background:transparent;border:0;border-radius:6px;padding:3px 5px;line-height:1;cursor:pointer;opacity:.7}
.audioFileRename:hover,.audioFileRename:focus-visible{background:#314256;color:#d8eaff;opacity:1}
.audioRenameRow{display:flex;align-items:center;gap:5px;min-width:0;max-width:100%;flex-wrap:wrap}
.audioRenameInput{flex:1 1 110px;min-width:75px;width:100%;padding:6px 7px;background:#0f1825;color:#f3f7ff;border:1px solid #7da3d8;border-radius:6px;font-size:13px;outline:none}
.audioRenameExt{font-size:11px;color:#a9b9cf;white-space:nowrap}
.audioRenameConfirm,.audioRenameCancel{padding:4px 6px;border-radius:5px;background:#2a3e59;color:#eaf2ff;border:1px solid #577395;cursor:pointer;font-size:12px}
.audioRenameCancel{background:#292b32;border-color:#4c5563}
.audioRenameHint{margin-top:5px;color:#9aaac0;font-size:10px}
.audioFileTile.isRenaming{border-color:#7da3d8}
.audioFileTile.isRenaming .audioFileActions{display:none}
.audioFileDelete{flex:0 0 auto;color:#a4adba;background:transparent;border:0;border-radius:6px;cursor:pointer;font-size:21px;line-height:1;padding:1px 4px;opacity:.6}
.audioFileTile:hover .audioFileDelete,.audioFileDelete:focus-visible{opacity:1;color:#f4aab7;background:#3a2934}
.audioDock[hidden]{display:none!important}
.audioDock{position:fixed;z-index:65;inset:auto 0 0;background:#12161cf5;border-top:1px solid #455166;box-shadow:0 -15px 48px #000a;backdrop-filter:blur(15px);padding:9px max(18px,calc((100vw - 1640px)/2)) calc(10px + env(safe-area-inset-bottom));box-sizing:border-box}
.audioDock .audioTrack{width:100%;border:0;border-radius:0;background:transparent;box-shadow:none;padding:3px 0 0}
.audioDock .audioTrackHeader{margin-bottom:8px;gap:10px}
.audioDock .audioArtwork{width:32px;height:32px;flex-basis:32px;font-size:18px}
.audioDock .audioTrack .audioTitle{font-size:13px}
.audioDock .audioMeta{display:none}
.audioDock .audioTimeline{gap:11px}
.audioDock .audioTools{margin:7px 0 0 43px}
.audioDock .audioPlay{width:37px;height:37px;min-width:37px}
.audioDockClose{margin-left:auto;color:#b4bfce;border:1px solid #3b4555;border-radius:8px;background:#252e3b;cursor:pointer;width:31px;height:29px;font-size:20px;line-height:1}
.audioDockClose:hover{background:#424c5c;color:white}
body.audioDockVisible:has(#audioDock:not([hidden])){padding-bottom:190px}
@media(max-width:700px){
.audioFileGrid{grid-template-columns:repeat(auto-fill,minmax(min(100%,165px),1fr));gap:9px;padding:10px}
.audioFileTile{padding:10px 8px;min-height:116px;gap:7px}
.audioFileArt{height:28px;width:28px;flex-basis:28px;font-size:16px}
.audioFileName{font-size:12px}
.audioFileDelete{font-size:18px}
.audioDock{padding:7px 10px calc(8px + env(safe-area-inset-bottom))}
.audioDock .audioTimeline{gap:6px}
.audioDock .audioTools{margin-left:0}
.audioDock .audioABInfo{width:auto}
body.audioDockVisible:has(#audioDock:not([hidden])){padding-bottom:255px}
}

.assetRemove{border:1px solid #574047;color:#f0aab4;border-radius:7px;background:#33242a;padding:7px 12px;cursor:pointer}
.assetView{position:fixed;inset:0;z-index:250000;background:rgba(0,0,0,.97);display:none;align-items:center;justify-content:center;flex-direction:column;padding:16px;gap:8px}
.assetView.open{display:flex}
.assetView img{max-width:min(96vw,1400px);max-height:calc(100dvh - 130px);object-fit:contain}
.assetViewControls{display:flex;gap:10px;align-items:center;max-width:95vw}
.assetViewControls button{border:1px solid #536072;color:#eef1f8;background:#252b34;border-radius:9px;padding:9px 12px;cursor:pointer}
.assetViewName{font-size:12px;color:#c9ced8;max-width:50vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 截图逐帧工作台：视频复用浏览器解码，保持清晰、低等待、无大批图片。 */
.shotStudioBack{position:fixed;inset:0;z-index:250100;display:flex;align-items:center;justify-content:center;background:#050609ed;backdrop-filter:blur(10px);padding:18px;overscroll-behavior:contain}
body.shotStudioOpen{overflow:hidden}
.shotStudio{width:min(1450px,100%);height:min(94dvh,950px);min-height:300px;display:flex;flex-direction:column;background:#16191f;color:#eef2f8;border:1px solid #424a57;border-radius:16px;overflow:hidden;box-shadow:0 20px 80px #000c}
.shotTop{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border-bottom:1px solid #313742;flex:0 0 auto}
.shotHeading{display:flex;flex-direction:column;min-width:0;gap:4px}.shotHeading strong{font-size:16px}.shotHeading small{font-size:12px;color:#a9b3c2;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;max-width:50vw}
.shotActions{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.shotActions button,.shotFoot button{border:1px solid #485365;color:#e9eef8;background:#292f39;border-radius:9px;padding:9px 14px;font-size:13px;font-weight:650;white-space:nowrap;cursor:pointer}
.shotActions button:hover:enabled,.shotFoot button:hover:enabled{background:#384659}
.shotActions .shotSave{background:#e5ebf5;color:#1b2028;border-color:#e5ebf5}
.shotActions .shotSave:hover:enabled{background:#fff;color:#1b2028}
.shotActions .shotCover{color:#b7d4ff;border-color:#4c678a}
.shotActions .shotClose{font-size:21px;padding:6px 12px;line-height:1.1}
.shotStudio button:disabled{opacity:.45;cursor:not-allowed}
.shotStage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#030405;overflow:hidden}
.shotStage .shotVideo,.shotSnapshot{display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;border:0;border-radius:0;background:#030405}
.shotSnapshot{position:absolute;inset:0;z-index:1;pointer-events:none}
.shotSnapshot[hidden]{display:none}
.shotThumbProgress{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:2;background:#161a20d8;border:1px solid #4d5867;border-radius:20px;padding:5px 12px;color:#dce8f9;font-size:12px;pointer-events:none;white-space:nowrap}.shotThumbProgress[hidden]{display:none}
.shotFoot{display:flex;align-items:center;justify-content:space-between;gap:14px;flex:0 0 auto;border-top:1px solid #313742;padding:12px 16px}
.shotInfo{display:flex;flex-direction:column;gap:3px;align-items:center;text-align:center;min-width:0}
.shotIndex{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;color:#f0f4ff}
.shotTime{font-size:12px;color:#a5afc0;font-variant-numeric:tabular-nums}
.shotFeedback{font-size:12px;color:#a0e4bd;min-height:1em;overflow-wrap:anywhere}
@media(max-width:700px){.shotStudioBack{padding:6px}.shotStudio{height:97dvh;border-radius:11px}.shotTop{padding:9px;gap:7px;flex-wrap:wrap}.shotHeading{flex:1;min-width:100px}.shotHeading small{max-width:48vw}.shotActions{gap:5px}.shotActions button,.shotFoot button{padding:8px 9px;font-size:12px}.shotFoot{padding:10px 8px;gap:6px}.shotTime{font-size:11px}.shotIndex{font-size:12px}}
@media(max-width:1100px){.pictureWall{column-count:4}}
@media(max-width:700px){.pictureWall{column-count:2;padding:10px;column-gap:8px}.top .mediaTabs{order:-1}.assetFolders{margin:10px}.audioList{padding:10px}}
.card{background:#191b20;border:1px solid #292d34;border-radius:14px;overflow:hidden;box-shadow:0 8px 22px rgba(0,0,0,.16)}
.coverWrap{position:relative;aspect-ratio:9/16;background:#090a0c;cursor:pointer;overflow:hidden}
.cover{width:100%;height:100%;object-fit:cover;display:block}
.badges{position:absolute;left:8px;bottom:8px;display:flex;gap:5px;flex-wrap:wrap}
.badge{padding:3px 6px;border-radius:6px;background:rgba(0,0,0,.7);font-size:11px}
.coverSeek{padding:7px 10px 6px;background:#15171b;border-top:1px solid #262930}
.coverSeekTop{display:flex;justify-content:space-between;font-size:10px;color:#aeb3be;margin-bottom:3px}
.coverRange{display:block;width:100%;margin:0;cursor:pointer;accent-color:#d8dbe2}
.coverSeek.loading{opacity:.6}
.body{padding:11px}
.creatorText{font-size:12px;color:#8fa2ba;display:inline-block;border-radius:5px;padding:2px 3px;margin-left:-3px;cursor:text}
.creatorText:hover,.titleText:hover{background:#252830}
.titleText{display:block;font-size:14px;line-height:1.45;color:#f0f1f4;min-height:41px;border-radius:6px;padding:2px 3px;margin:2px 0 0 -3px;cursor:text}
.inlineInput{width:100%;background:#101216;color:#fff;border:1px solid #566070;border-radius:7px;padding:6px 7px;outline:none}
.meta{display:flex;gap:7px;flex-wrap:wrap;font-size:11px;color:#8d95a1;margin-top:7px}
.actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:10px;padding-top:9px;border-top:1px solid #292d34}
.stars{display:flex;align-items:center;gap:1px;touch-action:none;user-select:none;transition:transform .12s ease}
.stars.ratingActive{transform:scale(1.05)}
.ratingStar{position:relative;width:22px;height:24px;border:0;background:none;padding:0;font-size:22px;line-height:24px;cursor:pointer}
.ratingStarBase{position:absolute;inset:0;color:#555;pointer-events:none}
.ratingStarFill{position:absolute;left:0;top:0;bottom:0;color:#ffc857;overflow:hidden;white-space:nowrap;pointer-events:none;transition:width .05s linear}
.ratingStar.hot{transform:scale(1.15)}
.ratingValue{font-size:10px;color:#9299a5;margin-left:4px;min-width:23px}
.iconActions{margin-left:auto;display:flex;gap:5px}
.iconBtn{width:29px;height:29px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #3b3f48;background:#21242a;color:#aeb4bf;border-radius:8px;padding:0;cursor:pointer}
.iconBtn:hover{background:#2b3037;color:#fff}
.iconBtn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.deleteBtn{color:#bd9498}
.deleteBtn.armed{background:#7b252d;color:#fff;border-color:#b13c47}
.card.deleting{pointer-events:none;animation:deleteCard .32s ease forwards}
@keyframes deleteCard{to{opacity:0;transform:scale(.93)}}
.empty{padding:70px;text-align:center;color:#8d939d}
.modal{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.9);z-index:50;padding:20px}
.modal.open{display:flex}
.modalBox{width:min(1100px,96vw)}
video{width:100%;max-height:88vh;background:#000;border-radius:10px}
.close{float:right;margin-bottom:7px;border:0;border-radius:8px;background:#292d35;color:#fff;padding:6px 10px;cursor:pointer}

.feedOverlay{position:fixed;inset:0;z-index:60;background:#08090b;display:none}
.feedOverlay.open{display:block}
.feedHeader{position:absolute;left:0;right:0;top:0;z-index:4;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(rgba(0,0,0,.72),rgba(0,0,0,0))}
.feedClose,.feedMulti,.feedDelete{width:38px;height:38px;border:1px solid rgba(255,255,255,.18);background:rgba(18,20,24,.72);color:#fff;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.feedClose svg,.feedMulti svg,.feedDelete svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.feedDelete{color:#e7a7ad}.feedDelete.armed{background:#7b252d;color:#fff;border-color:#b13c47}
.feedScroller{height:100vh;overflow-y:auto;scroll-snap-type:y mandatory;overscroll-behavior:contain;scrollbar-width:none}
.feedScroller::-webkit-scrollbar{display:none}
.feedItem{height:100vh;scroll-snap-align:start;scroll-snap-stop:always;display:flex;align-items:center;justify-content:center;position:relative;padding:52px 14px 18px}
.feedMedia{max-width:min(620px,94vw);max-height:92vh;width:auto;height:auto;background:#000;border-radius:12px;object-fit:contain;box-shadow:0 10px 40px rgba(0,0,0,.4)}
.feedMedia.feedVideo{width:min(620px,94vw)}
.feedInfo{position:absolute;left:max(18px,calc(50% - 310px));right:max(18px,calc(50% - 310px));bottom:22px;pointer-events:none;text-shadow:0 2px 8px #000}
.feedCreator{font-size:13px;font-weight:700;margin-bottom:4px}
.feedTitle{font-size:14px;line-height:1.4}
.feedRating{position:absolute;right:24px;bottom:calc(78px + var(--safe-bottom,0px));margin-top:0;width:max-content;max-width:calc(100vw - 48px);padding:5px 8px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(10,12,16,.72);backdrop-filter:blur(8px);pointer-events:auto;text-shadow:none;z-index:3}
.feedRating .ratingStar{width:20px;height:22px;font-size:20px;line-height:22px}
.feedRating .ratingValue{color:#d7dbe2}
.feedVideo.nativeSwitching{opacity:1!important} /* retain next cover during first-frame decoding */
.feedVideo::backdrop{background:#000}
.multiDock{position:fixed;inset:0;z-index:80;pointer-events:none}
.miniPlayer{position:absolute;width:320px;height:360px;min-width:220px;min-height:180px;max-width:90vw;background:#17191e;border:1px solid #343840;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.42);pointer-events:auto;display:flex;flex-direction:column}
.miniHead{display:flex;align-items:center;gap:7px;padding:7px 8px;font-size:11px;color:#c8ccd3;cursor:move;user-select:none;touch-action:none;background:#1d2026;border-bottom:1px solid #2b2f36}
.miniLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.miniMediaWrap{position:relative;min-height:0;flex:1;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}
.miniPlayer video,.miniPlayer img{display:block;width:100%;height:100%;object-fit:contain;background:#000}
.miniResize{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;z-index:3;touch-action:none}
.miniResize:before,.miniResize:after{content:"";position:absolute;right:4px;bottom:4px;border-right:1px solid rgba(255,255,255,.55);border-bottom:1px solid rgba(255,255,255,.55)}
.miniResize:before{width:9px;height:9px}
.miniResize:after{width:5px;height:5px;right:8px;bottom:8px}
.mediaKindBadge{position:absolute;right:8px;top:8px;padding:3px 6px;border-radius:6px;background:rgba(0,0,0,.62);font-size:10px}

.videoStage{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;width:100%;height:100%}
.rotatableVideo{transform-origin:center center;will-change:transform}
.rotateBtn.rotated{color:#a9d2ff;border-color:#48698b;background:#223140}
.feedRotate{width:38px;height:38px;border:1px solid rgba(255,255,255,.18);background:rgba(18,20,24,.72);color:#fff;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.feedRotate svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.miniRotate,.miniClose{width:26px;height:26px;border:0;background:#272a31;color:#ddd;border-radius:7px;cursor:pointer;flex:0 0 auto}
.miniRotate:hover,.miniClose:hover{background:#343842;color:#fff}

.miniVisibilityToggle,.miniSyncStart{position:fixed;bottom:14px;z-index:999;width:42px;height:42px;border:1px solid #464b55;background:rgba(27,30,36,.92);color:#d9dde4;border-radius:12px;display:none;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;box-shadow:0 8px 24px rgba(0,0,0,.35);backdrop-filter:blur(8px)}
.miniVisibilityToggle{right:14px}
.miniSyncStart{right:64px;font-size:12px;font-weight:750;letter-spacing:-.2px}
.miniVisibilityToggle.show,.miniSyncStart.show{display:inline-flex}
.miniVisibilityToggle:hover,.miniSyncStart:hover{background:#2c3138;color:#fff;border-color:#5d6572}
.miniVisibilityToggle svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.miniSyncStart:active{transform:translateY(1px)}
.multiDock.hiddenWindows .miniPlayer{visibility:hidden;pointer-events:none}

.miniABBtn,.miniClipBtn{height:26px;min-width:26px;border:0;background:#272a31;color:#cfd4dd;border-radius:7px;padding:0 6px;cursor:pointer;flex:0 0 auto;font-size:11px;line-height:26px}
.miniABBtn:hover,.miniClipBtn:hover{background:#343842;color:#fff}
.miniABBtn.set{color:#a9d2ff;background:#223140}
.miniABBtn.active{color:#b7efc7;background:#233b2b}
.miniClipBtn.loading{opacity:.6;cursor:wait}
.miniClipBtn.done{color:#b7efc7;background:#233b2b}

.feedABBtn{height:38px;min-width:38px;border:1px solid rgba(255,255,255,.18);background:rgba(18,20,24,.72);color:#fff;border-radius:10px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;white-space:nowrap}
.feedABBtn:hover{background:rgba(45,49,57,.9)}
.feedABBtn.set{color:#a9d2ff;border-color:#4d6c8e;background:#223140}
.feedABBtn.active{color:#b7efc7;border-color:#416f4d;background:#233b2b}
.feedABBtn.loading{opacity:.6;cursor:wait}
.feedABBtn.done{color:#b7efc7;border-color:#416f4d;background:#233b2b}
.feedHeaderActions::-webkit-scrollbar{display:none}
.feedPortrait{font-weight:700;letter-spacing:-.4px}
.feedPortrait:disabled,.miniPortrait:disabled{opacity:.42;cursor:wait}
.miniPortrait{height:26px;min-width:33px;border:0;background:#272a31;color:#d6dded;border-radius:7px;padding:0 6px;cursor:pointer;flex:0 0 auto;font-size:10px;font-weight:700}
.miniPortrait:hover{background:#343842;color:#fff}
/* 9:16 动态裁剪预览：原视频实时播放，画面白框可左右拖动，播放器可暂停、跳转。 */
.portraitDialogBack{position:fixed;inset:0;z-index:200000;background:rgba(0,0,0,.83);backdrop-filter:blur(9px);display:flex;justify-content:center;align-items:center;padding:18px;overscroll-behavior:contain}
.portraitDialog{width:min(970px,100%);max-height:calc(100dvh - 36px);overflow:auto;background:#1b1d22;border:1px solid #444951;box-shadow:0 24px 80px #0009;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:14px;color:#e9edf4}
.portraitDialogTop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.portraitDialogTop h3{font-size:17px;font-weight:650;margin:0 0 5px}
.portraitDialogTop p{font-size:12px;color:#a5aab6;margin:0;line-height:1.6}
.portraitClose{background:none;border:0;color:#bdc4d0;font-size:25px;line-height:1;cursor:pointer;padding:0 5px}
.portraitStage{min-height:150px;display:flex;align-items:center;justify-content:center;background:#0a0b0d;border-radius:11px;overflow:hidden;position:relative;padding:8px}
.portraitFrame{position:relative;overflow:hidden;touch-action:none;max-width:100%;border-radius:3px;background:#000;user-select:none}
.portraitFrame canvas{display:block;width:100%;height:100%;pointer-events:none}
.portraitSelection{position:absolute;border:2px solid #fff;box-shadow:0 0 0 200vmax rgba(0,0,0,.57),inset 0 0 0 1px #ffffff50;cursor:grab;touch-action:none;z-index:2;pointer-events:none}
.portraitSelection:after{content:'⇆';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:white;font-weight:700;font-size:24px;text-shadow:0 1px 4px black;opacity:.75;pointer-events:none}
/* 裁剪预览下方提供独立时间轴；不把播放手势和拖动选区混在一起。 */
.portraitPlayerBar{display:flex;align-items:center;gap:12px;min-height:35px}
.portraitPlayerBar button{border:1px solid #4a505b;border-radius:8px;background:#292d34;color:#e8edf6;padding:7px 10px;cursor:pointer;white-space:nowrap;min-width:70px}
.portraitPlayerBar button:hover{background:#383d47}
.portraitPlayerBar button:disabled{opacity:.45;cursor:default}
.portraitTimeline{flex:1;min-width:35px;accent-color:#d5e7ff;cursor:pointer}
.portraitTimeline:disabled{opacity:.5;cursor:default}
.portraitClock{font-size:12px;color:#d0d5de;font-variant-numeric:tabular-nums;white-space:nowrap;min-width:86px;text-align:right}
.portraitPlayerBar .portraitSound{min-width:36px;padding:7px 8px}
.portraitScaleBox{display:flex;gap:10px;align-items:center}
.portraitScaleBox label{font-size:13px;color:#d7dbe4;white-space:nowrap}
.portraitScaleBox input{width:100%;flex:1;accent-color:#d5e7ff;min-width:0;cursor:pointer}
.portraitCropValue{color:#b8d7ff;font-variant-numeric:tabular-nums;font-size:12px;min-width:45px;text-align:right}
.portraitDialogBottom{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
.portraitDialogHelp{font-size:12px;color:#9ba1ab;line-height:1.55}
.portraitDialogActions{display:flex;gap:9px;margin-left:auto}
.portraitDialogActions button{padding:10px 17px;border-radius:9px;border:1px solid #4a505b;background:#292d34;color:#f1f3f6;cursor:pointer}
.portraitDialogActions .portraitSubmit{background:#dce8fa;color:#111820;border:1px solid #dce8fa;font-weight:700}
.portraitDialogActions button:disabled{opacity:.4;cursor:not-allowed}
@media(max-width:600px){.portraitDialog{padding:12px;gap:11px}.portraitStage{min-height:105px;padding:4px}.portraitDialogActions{width:100%}.portraitDialogActions button{flex:1}.portraitPlayerBar{gap:7px}.portraitPlayerBar button{min-width:60px;padding:7px 6px;font-size:12px}.portraitPlayerBar .portraitSound{min-width:32px}.portraitClock{min-width:75px;font-size:11px}}

.magnifyBtn.active,.feedMagnify.active,.miniMagnify.active{color:#b7e0ff;border-color:#52789d;background:#223140}
.videoFocusHost{position:relative;overflow:hidden!important;background:#000}
.videoFocusMode{cursor:grab!important;user-select:none;touch-action:none;will-change:transform}
.videoFocusMode.dragging{cursor:grabbing!important}
.feedHeader{transition:opacity .22s ease,transform .22s ease}
.feedOverlay.focusImmersive.chromeHidden .feedHeader{opacity:0;transform:translateY(-14px);pointer-events:none}
.feedOverlay.focusImmersive.cursorHidden,.feedOverlay.focusImmersive.cursorHidden *{cursor:none!important}
.feedMagnify{width:38px;height:38px;border:1px solid rgba(255,255,255,.18);background:rgba(18,20,24,.72);color:#fff;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.feedMagnify svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.miniMagnify{width:26px;height:26px;border:0;background:#272a31;color:#ddd;border-radius:7px;cursor:pointer;flex:0 0 auto}
.miniMagnify:hover{background:#343842;color:#fff}

/* v1.2.6：Feed 真正全屏。header / footer 只做覆盖层，不参与布局。 */
.feedOverlay{position:fixed;inset:0;z-index:70;background:#000;display:none;overflow:hidden}
.feedOverlay.open{display:block}
.feedScroller{position:absolute;inset:0;width:100vw;height:100vh;overflow-y:auto;overflow-x:hidden;scroll-snap-type:y mandatory;background:#000}
.feedItem{position:relative;width:100vw;height:100vh!important;min-height:100vh!important;max-height:100vh!important;scroll-snap-align:start;scroll-snap-stop:always;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center}
.feedItem .videoStage{position:absolute!important;inset:0!important;width:100vw!important;height:100vh!important;min-height:100vh!important;max-height:100vh!important;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000}
.feedMedia{display:block}
.feedMedia.feedVideo,.feedMedia.feedImage{width:100vw;height:100vh;max-width:100vw;max-height:100vh;object-fit:contain;border-radius:0}
.feedHeader{position:fixed!important;left:0;right:0;top:0;z-index:82;display:flex;align-items:flex-start;justify-content:space-between;padding:14px 16px;pointer-events:none}
.feedHeader button,.feedHeader>div{pointer-events:auto}
.feedInfo{position:absolute!important;left:0;right:0;bottom:0;z-index:81;padding:72px 24px 22px;background:linear-gradient(to top,rgba(0,0,0,.72),rgba(0,0,0,.22),transparent);pointer-events:none}
.feedCreator,.feedTitle{pointer-events:none}
.feedOverlay.chromeHidden .feedInfo{opacity:0;transform:translateY(12px);pointer-events:none}
.feedInfo{transition:opacity .22s ease,transform .22s ease}

/* v1.3.0 - iPad / 手机 */
:root{
  --safe-top:env(safe-area-inset-top,0px);
  --safe-right:env(safe-area-inset-right,0px);
  --safe-bottom:env(safe-area-inset-bottom,0px);
  --safe-left:env(safe-area-inset-left,0px);
}

/* 视频切换必须由手势控制：原生滚动惯性可一次跨过数个 feedItem。 */
.feedScroller{
  overflow-y:hidden!important;
  scroll-snap-type:none!important;
  touch-action:none;
  overscroll-behavior:contain;
}
.feedScroller .feedItem,
.feedScroller .videoStage,
.feedScroller .feedVideo,
.feedScroller .feedImage{
  touch-action:none;
}
.feedVideo{
  -webkit-user-select:none;
  user-select:none;
}
.videoFocusMode{
  touch-action:none!important;
}

@supports(height:100dvh){
  .feedOverlay,
  .feedScroller,
  .feedItem,
  .feedItem .videoStage{
    height:100dvh!important;
    min-height:100dvh!important;
    max-height:100dvh!important;
  }

  .feedMedia.feedVideo,
  .feedMedia.feedImage{
    height:100dvh;
    max-height:100dvh;
  }
}

.feedScroller{
  overscroll-behavior-y:contain;
  -webkit-overflow-scrolling:touch;
}

.feedHeader{
  padding-top:calc(12px + var(--safe-top))!important;
  padding-right:calc(12px + var(--safe-right))!important;
  padding-left:calc(12px + var(--safe-left))!important;
}

.feedInfo{
  padding-bottom:calc(18px + var(--safe-bottom))!important;
  padding-left:calc(18px + var(--safe-left))!important;
  padding-right:calc(18px + var(--safe-right))!important;
}

@media(pointer:coarse){
  .feedHeader{
    gap:8px;
  }

  .feedHeader>div{
    max-width:calc(100vw - 76px - var(--safe-left) - var(--safe-right));
    overflow-x:auto;
    overflow-y:hidden;
    scrollbar-width:none;
    -webkit-overflow-scrolling:touch;
    padding-bottom:2px;
  }

  .feedHeader>div::-webkit-scrollbar{
    display:none;
  }

  .feedClose,
  .feedRotate,
  .feedMulti,
  .feedDelete,
  .feedMagnify,
  .feedABBtn{
    min-width:44px!important;
    width:auto;
    height:44px!important;
    min-height:44px!important;
    border-radius:12px!important;
    flex:0 0 auto;
  }

  .feedABBtn{
    padding:0 12px!important;
    font-size:13px!important;
  }

  .miniHead{
    min-height:44px;
  }

  .miniRotate,
  .miniMagnify,
  .miniClose,
  .miniABBtn,
  .miniClipBtn{
    min-width:36px!important;
    width:auto;
    height:36px!important;
    min-height:36px!important;
    line-height:36px!important;
    padding:0 9px!important;
  }

  .miniResize{
    width:34px!important;
    height:34px!important;
  }

  .miniVisibilityToggle{
    right:calc(14px + var(--safe-right))!important;
    bottom:calc(14px + var(--safe-bottom))!important;
    width:48px!important;
    height:48px!important;
  }

  .miniSyncStart{
    right:calc(70px + var(--safe-right))!important;
    bottom:calc(14px + var(--safe-bottom))!important;
    width:48px!important;
    height:48px!important;
    font-size:13px!important;
  }
}


/* v1.3.2：移动端 Feed 性能模式 */
@media(pointer:coarse){
  .feedItem{
    content-visibility:auto;
    contain:layout paint style;
    contain-intrinsic-size:100vw 100dvh;
  }
}
@media(max-width:650px){
  .feedHeader{
    padding-top:calc(8px + var(--safe-top))!important;
    padding-left:calc(8px + var(--safe-left))!important;
    padding-right:calc(8px + var(--safe-right))!important;
  }

  .feedInfo{
    padding-left:14px!important;
    padding-right:14px!important;
    padding-bottom:calc(14px + var(--safe-bottom))!important;
  }

  .feedRating{
    right:14px!important;
    bottom:calc(72px + var(--safe-bottom,0px))!important;
    max-width:calc(100vw - 28px)!important;
  }

  .feedCreator{
    font-size:14px!important;
  }

  .feedTitle{
    font-size:13px!important;
    line-height:1.35!important;
  }

  .miniPlayer{
    min-width:200px!important;
    min-height:160px!important;
  }
}
@media(max-width:650px){header{padding:10px 12px}.top{flex-wrap:wrap}h1{width:100%}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:10px}.body{padding:8px}.titleText{font-size:13px}}

/* 照片图库：紧凑网格、相簿拼贴、多选工具栏与沉浸式原图浏览 */
#photoToolbar[hidden],#photoSelectionBar[hidden]{display:none!important}
.photoToolbar{padding:18px 22px 8px;color:#f5f5f7}
.photoToolbarHead{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;flex-wrap:wrap}
.photoToolbarHead>div:first-child{display:flex;align-items:baseline;gap:12px}
.photoToolbarHead strong{font-size:25px;letter-spacing:-.04em}
.photoSummary{font-size:12px;color:#929cab}
.photoToolbarActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.photoToolbarActions button,.photoSelectionBar button{border:1px solid #414854;background:#252a32;color:#e3e8f0;border-radius:10px;padding:9px 13px;cursor:pointer;font-size:13px}
.photoToolbarActions button:hover,.photoSelectionBar button:hover{background:#343c47}
#photoSelect{background:#276bdb;color:#fff;border-color:#3478ee}
#photoSelect[aria-pressed="true"]{background:#e9eef7;color:#121720}
.photoZoomControl{display:flex;align-items:center;gap:7px;color:#aeb6c2;font-size:12px;border:1px solid #3b424d;border-radius:10px;padding:5px 10px}
.photoZoomControl input{accent-color:#6fa5ff;width:110px;cursor:pointer}
.photoSelectionBar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding-top:13px;color:#c2cfdf;font-size:13px}
.photoSelectionBar #photoSelectedCount{margin-right:auto}
.photoSelectionBar .photoDestructive,.photoDestructive{color:#ffaaa9!important}
.photoSelectionBar .photoDestructive:disabled{opacity:.4;cursor:not-allowed}
body:has(#photoToolbar:not([hidden])) #assetFolders{margin:9px 22px 6px;gap:4px}
body:has(#photoToolbar:not([hidden])) #assetFolders button{border:0;background:none;color:#b7becb;padding:6px 9px;font-size:13px;border-radius:7px}
body:has(#photoToolbar:not([hidden])) #assetFolders button.on{color:#fff;background:#2c3440}
body:has(#photoToolbar:not([hidden])) #folderContext{margin:5px 0 10px;padding:0 22px;color:#798695}
body:has(#photoToolbar:not([hidden])) .assetFolderTiles{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin:8px 22px 15px}
.photoAlbum{display:flex;flex-direction:column;gap:8px;padding:0;border:0;background:none;color:#e6eaf0;text-align:left;cursor:pointer;min-width:0}
.photoAlbumMosaic{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));aspect-ratio:1/1;border-radius:14px;overflow:hidden;gap:2px;background:#252b32;transition:transform .15s}
.photoAlbum:hover .photoAlbumMosaic{transform:translateY(-2px)}
.photoAlbumMosaic img{height:100%;width:100%;object-fit:cover;display:block;background:#2c3037}
.photoAlbumMosaic[data-count="1"] img{grid-row:span 2;grid-column:span 2}
.photoAlbumMosaic[data-count="2"] img{grid-row:span 2}
.photoAlbumMosaic span{grid-column:span 2;grid-row:span 2;display:grid;place-items:center;font-size:42px;color:#8292a7}
.photoAlbumName{font-size:14px;font-weight:650;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.photoAlbumCount{font-size:12px;color:#919aa7;margin-top:-5px}
#grid.pictureWall{--photo-cell:150px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--photo-cell)),1fr));column-count:unset;gap:3px;padding:0 22px 80px;align-items:stretch}
#grid.pictureWall.photoOriginalRatio{grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--photo-cell)),1fr));align-items:start;gap:8px}
#grid.pictureWall .pictureTile{position:relative;display:block;width:100%;margin:0;padding:0;border:0;background:#242931;border-radius:2px;overflow:hidden;aspect-ratio:1/1;min-width:0;break-inside:auto;cursor:pointer;content-visibility:auto;contain-intrinsic-size:150px 150px}
#grid.pictureWall.photoOriginalRatio .pictureTile{aspect-ratio:auto;content-visibility:visible;border-radius:8px;min-height:80px}
#grid.pictureWall .pictureTile img{display:block;width:100%;height:100%;min-height:0;max-height:none;object-fit:cover;aspect-ratio:1/1;background:linear-gradient(130deg,#20232b,#353b46);transition:transform .16s ease,opacity .2s}
#grid.pictureWall.photoOriginalRatio .pictureTile img{height:auto;object-fit:contain;aspect-ratio:auto;max-height:420px}
@media(hover:hover){#grid.pictureWall .pictureTile:hover img{transform:scale(1.035)}}
#grid.pictureWall .pictureTile .photoTileName{position:absolute;left:0;right:0;bottom:0;max-width:100%;color:#fff;background:linear-gradient(transparent,#000b);padding:22px 8px 7px;font-size:11px;line-height:1.3;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;opacity:0;pointer-events:none}
@media(hover:hover){#grid.pictureWall .pictureTile:hover .photoTileName{opacity:1}}
#grid.pictureWall .pictureTile .photoCheck{display:grid;place-items:center;position:absolute;top:9px;right:9px;width:23px;height:23px;border-radius:50%;border:2px solid #fff;background:#0006;color:transparent;box-shadow:0 1px 5px #0007;font-size:14px;opacity:0}
#grid.pictureWall.photoSelecting .photoTileName{opacity:1}
#grid.pictureWall.photoSelecting .photoCheck{opacity:1}
#grid.pictureWall .pictureTile.selected .photoCheck{background:#2581ff;border-color:#2581ff;color:white;opacity:1}
#grid.pictureWall .pictureTile.selected:after{content:"";position:absolute;inset:0;pointer-events:none;border:3px solid #2685ff}
.photoGridMore{grid-column:1/-1;display:grid;place-items:center;color:#8d98a8;padding:20px;font-size:12px;min-height:60px}
/* 查看器 */
body.photoDetailOpen{overflow:hidden}
#assetView.photoDetail{position:fixed;inset:0;z-index:250000;padding:0;gap:0;display:none;flex-direction:column;background:#08090b;color:#f4f5f7}
#assetView.photoDetail.open{display:flex}
.photoDetailTop{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px;flex:0 0 auto;background:#15171c;border-bottom:1px solid #30343b;min-height:62px}
.photoDetailTop button{background:#292e36;color:#f2f3f5;border:0;border-radius:10px;padding:9px 13px;cursor:pointer;font-size:13px}
.photoDetailTop button:hover{background:#3a414c}
.photoBack{white-space:nowrap}.photoBack:first-letter{font-size:23px}
.photoDetailHeading{display:flex;flex-direction:column;align-items:center;flex:1;min-width:0;gap:3px}
.photoDetailHeading #assetViewName{max-width:min(50vw,620px);font-size:13px;color:#f1f3f6;font-weight:650;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.photoDetailHeading small{color:#8994a1;font-size:11px}
.photoDetailActions{display:flex;gap:7px;white-space:nowrap}
#assetView .photoDetailStage{width:100%;min-height:0;flex:1;display:flex;align-items:center;justify-content:space-between;gap:4px;overflow:hidden;padding:0 8px}
.photoImageSurface{display:flex;justify-content:center;align-items:center;flex:1;min-height:0;min-width:0;height:100%;overflow:hidden;position:relative;touch-action:pan-y}
#assetView .photoImageSurface img{display:block;object-fit:contain;max-width:100%;max-height:100%;width:auto;height:auto;transition:opacity .1s;background:transparent}
#assetView .photoImageSurface.zoomed{overflow:auto;justify-content:safe center;align-items:safe center;touch-action:pan-x pan-y}
#assetView .photoImageSurface.zoomed img{max-width:none;max-height:none;min-width:100%;max-width:250%;cursor:zoom-out;object-fit:contain}
.photoLoading{display:none;position:absolute;bottom:22px;left:50%;transform:translateX(-50%);background:#1d2330c9;color:#bfcde0;border-radius:99px;padding:7px 14px;font-size:12px;pointer-events:none}
.photoImageSurface.isLoading .photoLoading{display:block}
#assetView .photoSideArrow{border:0;background:#20242ab8;color:#e1e7ef;border-radius:50%;width:40px;height:40px;flex:0 0 40px;cursor:pointer;font-size:30px;line-height:0;padding:0;display:grid;place-items:center}
#assetView .photoSideArrow:hover{background:#323b49}
.photoDetailBottom{width:100%;display:flex;align-items:center;flex-direction:column;gap:8px;padding:9px 12px 11px;background:#15171c;border-top:1px solid #30343b}
.photoFilmstrip{max-width:100%;display:flex;align-items:center;gap:5px;overflow-x:auto;scrollbar-width:thin;scrollbar-color:#566171 transparent;scroll-behavior:smooth}
.photoFilmstrip button{width:51px;height:54px;flex:0 0 51px;border:2px solid transparent;border-radius:5px;overflow:hidden;background:#2a313a;padding:0;cursor:pointer;opacity:.65}
.photoFilmstrip button.isCurrent{border-color:#f3f5f8;opacity:1}
.photoFilmstrip img{display:block;height:100%;width:100%;object-fit:cover}
.photoDetailHelp{font-size:11px;color:#838d9b}
@media(max-width:700px){
.photoToolbar{padding:12px 11px 6px}.photoToolbarHead strong{font-size:22px}.photoToolbarHead{gap:8px}.photoToolbarHead>div:first-child{gap:7px}
.photoToolbarActions{width:100%;justify-content:space-between}.photoZoomControl input{width:72px}
body:has(#photoToolbar:not([hidden])) #assetFolders{margin:8px 10px}
body:has(#photoToolbar:not([hidden])) #folderContext{padding:0 11px;margin-bottom:8px}
body:has(#photoToolbar:not([hidden])) .assetFolderTiles{grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:10px;margin:9px 11px}
#grid.pictureWall{--photo-cell:105px;gap:2px;padding:0 6px 45px}
#grid.pictureWall.photoOriginalRatio{gap:5px}
.photoDetailTop{padding:8px 9px;gap:5px;min-height:56px}.photoBack span{display:none}.photoDetailHeading #assetViewName{max-width:40vw}
.photoDetailTop button{padding:8px 7px;font-size:11px}.photoDetailActions{gap:3px}
#assetView .photoSideArrow{width:27px;height:35px;flex-basis:27px;border-radius:8px;font-size:23px}
#assetView .photoDetailStage{padding:0 2px;gap:0}.photoFilmstrip button{width:43px;height:48px;flex-basis:43px}.photoDetailHelp{font-size:10px}
}


/* 片段库：非破坏性 A/B 预设，保存只是写入 data.json。 */
.clipShelfButton{border:1px solid #424955;background:#242933;color:#e5edff;border-radius:10px;padding:9px 13px;white-space:nowrap;cursor:pointer}
.clipShelfButton:hover{background:#303d50}
.clipShelfBack[hidden],.clipShelfForm[hidden]{display:none!important}
.clipShelfBack{position:fixed;inset:0;z-index:260000;background:#03050acc;backdrop-filter:blur(9px);display:flex;align-items:center;justify-content:center;padding:18px;overscroll-behavior:contain}
.clipShelf{background:#171b22;border:1px solid #3a4351;border-radius:18px;width:min(1050px,100%);height:min(820px,calc(100dvh - 36px));display:flex;flex-direction:column;color:#eef2fa;overflow:hidden;box-shadow:0 30px 90px #000b}
.clipShelf button,.clipShelf input{font:inherit}
.clipShelfHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid #363d49}
.clipShelfHead h2{font-size:19px;margin:0}
.clipShelfHead small{color:#99a5b6;font-size:12px}
.clipShelf button{border:1px solid #465061;border-radius:9px;padding:9px 12px;background:#282f3a;color:#e9eef7;cursor:pointer;white-space:nowrap}
.clipShelf button:hover:not(:disabled){background:#3b4656}
.clipShelf button:disabled{opacity:.42;cursor:not-allowed}
.clipShelf button.primary{background:#bcd8ff;color:#101923;border-color:#bcd8ff;font-weight:700}
.clipShelf button.warn{color:#f1abb3;border-color:#75444d}
.clipShelfToolbar{display:flex;flex-wrap:wrap;align-items:center;gap:9px;padding:12px 20px;border-bottom:1px solid #343d48}
.clipShelfToolbar input[type=search]{flex:1;min-width:140px}
.clipShelf input:not([type=checkbox]){background:#101319;border:1px solid #495363;color:#f3f5fa;border-radius:8px;padding:9px;min-width:0}
.clipShelfToolbar label{font-size:12px;color:#c0c9d4;display:flex;align-items:center;gap:5px}
.clipShelfList{overflow:auto;min-height:0;flex:1;padding:14px 20px;scrollbar-color:#505b70 #171b22;scrollbar-width:thin}
.clipShelfRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 18px;align-items:center;padding:14px;border:1px solid #343e4d;background:#1e242e;border-radius:12px;margin-bottom:10px}
.clipShelfRow.missing{opacity:.65}
.clipShelfRowTitle{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.clipShelfRowInfo{font-size:12px;color:#aab5c6;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.clipShelfRowActions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.clipShelfRowActions button{font-size:12px;padding:7px 9px}
.clipShelfRowActions button.fave{color:#ffcf68;border-color:#82652b}
.clipShelfEmpty{padding:58px 10px;text-align:center;color:#96a3b5}
.clipShelfForm{padding:14px 20px;border-top:1px solid #3e4755;background:#1b222d;display:grid;gap:10px}
.clipShelfFormFields{display:grid;grid-template-columns:minmax(140px,2fr) minmax(75px,1fr) minmax(75px,1fr) auto;gap:9px;align-items:end}
.clipShelfForm label{font-size:12px;color:#abb8cc;display:grid;gap:5px}
.clipShelfFormActions{display:flex;gap:8px;align-items:center;justify-content:flex-end}
.clipShelfToast{font-size:12px;color:#b8e6c2;flex:1;min-width:0}
@media(max-width:650px){.clipShelfBack{padding:0}.clipShelf{height:100dvh;border-radius:0;width:100%}.clipShelfHead,.clipShelfToolbar,.clipShelfList,.clipShelfForm{padding-left:12px;padding-right:12px}.clipShelfRow{grid-template-columns:1fr}.clipShelfRowActions{justify-content:flex-start}.clipShelfFormFields{grid-template-columns:1fr 1fr}.clipShelfFormFields label:first-child{grid-column:1/-1}}

/* 统一媒体交互：选择模式、右键菜单、重命名、状态反馈 */
#unifiedBatchBar[hidden],#unifiedContext[hidden],#unifiedRenameBack[hidden],#unifiedMoveBack[hidden],#unifiedAlbumBack[hidden],#unifiedToast[hidden]{display:none!important}
.unifiedFolderNew{border:1px solid #55647a;background:#303a48;color:#f1f5ff;padding:9px 12px;border-radius:10px;cursor:pointer;white-space:nowrap}
.unifiedMoveBack,.unifiedAlbumBack{position:fixed;inset:0;z-index:310000;background:#02040bdd;display:flex;align-items:center;justify-content:center;padding:16px}
.unifiedMovePanel{width:min(470px,100%);padding:23px;display:grid;gap:14px;background:#202630;color:#f1f5ff;border:1px solid #526277;border-radius:17px;box-shadow:0 20px 65px #000c}
.unifiedMovePanel h3{font-size:19px;margin:0}.unifiedMovePanel p{font-size:12px;color:#aebdd0;margin:0}
.unifiedMovePanel label{display:grid;gap:7px;font-size:13px}
.unifiedMovePanel input,.unifiedMovePanel select{width:100%;padding:12px;background:#141a23;border:1px solid #65748b;border-radius:10px;color:#f4f6fa;font:inherit}
.unifiedMoveActions{display:flex;justify-content:flex-end;gap:8px}.unifiedMoveActions button{padding:10px 16px;border:1px solid #5d6d82;background:#313d4f;color:#eff5ff;border-radius:9px;cursor:pointer}.unifiedMoveActions button[type=submit]{background:#d7e7ff;color:#162640;font-weight:700}
#folderTiles .unifiedDropTarget,#assetFolders .unifiedDropTarget{outline:3px solid #82b0ff!important;outline-offset:2px;background:#35465f!important}
/* File operations are shared; folders have their own visibly accessible menu. */
.unifiedFolderTile{position:relative;min-width:170px;min-height:44px;max-width:100%}
.unifiedFolderTile>.folderEntry{width:100%!important;min-width:0!important;padding:12px 42px 12px 14px!important;min-height:48px;height:100%;text-align:left;border:1px solid #455060;background:#242b35;color:#e8eefa;border-radius:11px;cursor:pointer;overflow-wrap:anywhere;font-size:13px}
.unifiedFolderTile>.folderEntry:hover,.unifiedFolderTile>.folderEntry:focus-visible{background:#313c4d;border-color:#6a7d98}
.unifiedFolderTile>.photoAlbum{width:100%;padding:0}
.unifiedFolderTile>.unifiedFolderMore{position:absolute;right:7px;top:8px;z-index:3;width:29px;height:29px;display:grid;place-items:center;background:#293345e8;color:#f1f5fb;border:1px solid #536178;border-radius:8px;font-weight:700;cursor:pointer}
.unifiedFolderTile>.unifiedFolderMore:hover,.unifiedFolderTile>.unifiedFolderMore:focus-visible{background:#4b6586}
.unifiedFolderTile>.photoAlbum+.unifiedFolderMore{top:8px;right:8px}
.unifiedFolderTile:focus-within{outline:2px solid #8aaeff;outline-offset:3px;border-radius:8px}
body:has(#photoToolbar:not([hidden])) .unifiedFolderTile{min-width:0}
#unifiedAlbumParentLabel[hidden]{display:none!important}

body.unifiedDragging #folderTiles [data-open-folder]{border-color:#7496bd!important}
.unifiedBatchBar button#unifiedMove:disabled{opacity:.4}

#photoSelectionBar,#photoSelect{display:none!important}
.unifiedHeaderButton{padding:9px 15px;background:#282e39;border:1px solid #485366;color:#e5ebf5;border-radius:10px;cursor:pointer;white-space:nowrap}
.unifiedHeaderButton[aria-pressed="true"]{background:#d7e7ff;color:#132039;border-color:#d7e7ff;font-weight:700}
#unifiedFavoriteFilter[aria-pressed="true"]{background:#4f4126;color:#ffe1a1;border-color:#b69043}
.unifiedBatchBar{position:fixed;bottom:17px;left:50%;transform:translateX(-50%);z-index:180000;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 22px);padding:11px;border-radius:15px;background:#242b37;box-shadow:0 13px 48px #000b;border:1px solid #607087;color:#edf4ff;flex-wrap:wrap;justify-content:center}
.unifiedBatchBar strong{font-size:13px;white-space:nowrap;margin:0 8px}
.unifiedBatchBar button{background:#323b49;color:#e8eef8;border:1px solid #536072;padding:8px 12px;border-radius:9px;cursor:pointer;font-size:12px;white-space:nowrap}
.unifiedBatchBar button:hover:not(:disabled){background:#455165}
.unifiedBatchBar button:disabled{opacity:.4;cursor:not-allowed}
.unifiedBatchBar .danger{color:#ffb8c4;border-color:#89505c}
body.audioDockVisible .unifiedBatchBar{bottom:190px}
@media(max-width:700px){body.audioDockVisible .unifiedBatchBar{bottom:245px}}
.mediaTile{position:relative}
.mediaTile[data-favorite="true"]:before{content:"★";position:absolute;top:8px;left:9px;z-index:4;color:#ffd479;font-size:16px;text-shadow:0 1px 5px #000b;pointer-events:none}
.audioFileTile .unifiedMore{margin-left:auto;align-self:flex-start;flex:0 0 auto}
.mediaTileCheck{display:none;position:absolute;top:10px;right:10px;z-index:5;width:27px;height:27px;border-radius:50%;border:2px solid #eee;background:#1119;color:transparent;font-weight:bold;align-items:center;justify-content:center;box-shadow:0 2px 9px #0009;cursor:pointer}
body.unifiedSelecting .mediaTileCheck{display:flex}
.mediaTile.unifiedSelected .mediaTileCheck{background:#3484f5;border-color:#3484f5;color:white}
.mediaTile.unifiedSelected{outline:3px solid #3484f5;outline-offset:-3px}
.card .deleteBtn,.audioFileTile .audioFileActions{display:none!important}
#grid.pictureWall .pictureTile.unifiedSelected:after{content:"";pointer-events:none;position:absolute;inset:0;border:3px solid #3484f5}
#grid.pictureWall .pictureTile.unifiedSelected .photoCheck{background:#3484f5;border-color:#3484f5;color:white;opacity:1}
#grid.pictureWall .pictureTile .unifiedMore{position:absolute;right:7px;bottom:7px;z-index:2;background:#141920c9}
body.unifiedSelecting .unifiedMore{display:none!important}
.unifiedMore{min-width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#303846;color:#e7eef9;border:1px solid #566276;border-radius:8px;cursor:pointer;line-height:1}
.unifiedMore:hover{background:#506078}
.unifiedContext{position:fixed;z-index:300000;display:flex;flex-direction:column;min-width:190px;max-width:min(280px,90vw);padding:5px;background:#232a34;border:1px solid #657083;border-radius:12px;box-shadow:0 14px 48px #000b;color:#f3f5fa}
.unifiedContext .contextHeading{padding:8px 11px;color:#aebbd0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-bottom:1px solid #495261;margin-bottom:4px}
.unifiedContext button{font:inherit;font-size:13px;color:inherit;border:0;background:transparent;border-radius:7px;padding:9px 11px;cursor:pointer;text-align:left}
.unifiedContext button:hover,.unifiedContext button:focus-visible{background:#3d4959;outline:none}
.unifiedContext button.danger{color:#ffbbc3}
.unifiedRenameBack{position:fixed;inset:0;background:#02040bcc;z-index:310000;display:flex;align-items:center;justify-content:center;padding:16px}
.unifiedRenamePanel{width:min(450px,100%);padding:24px;background:#1d232d;color:#eaf0f9;border:1px solid #536174;border-radius:16px;box-shadow:0 20px 70px #000c;display:grid;gap:12px}
.unifiedRenamePanel h3{font-size:20px;margin:0}.unifiedRenamePanel p{font-size:12px;margin:0 0 8px;color:#aeb9c8}.unifiedRenamePanel label{font-size:12px;color:#c9d2e0}
.unifiedRenameRow{display:flex;gap:5px;align-items:center;background:#111821;border:1px solid #60718b;border-radius:10px;padding:4px 10px}
.unifiedRenameRow input{min-width:0;flex:1;background:transparent;color:white;border:0;outline:0;padding:9px 0;font:inherit}
.unifiedRenameRow span{color:#91a5bc;font-size:13px}
.unifiedRenameButtons{display:flex;justify-content:flex-end;gap:8px}
.unifiedRenameButtons button{background:#303b4b;border:1px solid #53647c;color:#eaf0fa;border-radius:9px;padding:10px 18px;cursor:pointer}
.unifiedRenameButtons .primary{background:#cfe3ff;border-color:#cfe3ff;color:#152438;font-weight:700}
.unifiedToast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:320000;background:#34445b;color:#fff;padding:11px 18px;border:1px solid #7b91b2;border-radius:12px;box-shadow:0 12px 38px #000a;font-size:13px;max-width:90vw}
@media(max-width:650px){.unifiedBatchBar{bottom:8px;gap:5px;padding:8px}.unifiedBatchBar button{padding:8px}.unifiedHeaderButton{padding:8px 11px}.unifiedMore{min-width:26px;height:26px}}


/* ── 影格 Studio / Unified visual system (2026-10-19) ──
   Presentation only: existing API, storage and player event handlers stay untouched. */
:root { --studio-bg:#0b1119; --studio-surface:#121c29; --studio-panel:#182535;
  --studio-raised:#203249; --studio-line:#2b3d50; --studio-line-strong:#3b5672;
  --studio-text:#e9f0f8; --studio-muted:#91a5bc; --studio-faint:#637c96;
  --studio-accent:#7aa9e8; --studio-accent-bg:#263e59; --studio-danger:#ef9daa;
  --studio-r-sm:8px; --studio-r:12px; --studio-r-lg:17px;
  color-scheme:dark; }
html, body {background:var(--studio-bg);color:var(--studio-text);font-size:14px;-webkit-font-smoothing:antialiased}
button,input,select {font-family:inherit}
button {transition:background-color .14s ease,border-color .14s ease,color .14s ease,box-shadow .14s ease}
button:focus-visible,[role="button"]:focus-visible,a:focus-visible {outline:2px solid var(--studio-accent)!important;outline-offset:2px}
input:focus-visible,select:focus-visible {outline:2px solid var(--studio-accent);outline-offset:1px}
input[type="range"] {accent-color:var(--studio-accent)}
button:disabled {cursor:not-allowed}
[hidden] {display:none!important}
.studioHeader {position:relative;top:auto;z-index:20;background:var(--studio-bg);backdrop-filter:none;border-bottom:1px solid var(--studio-line);padding:0 30px}
.studioTop {display:grid;grid-template-columns:240px minmax(260px,max-content) 1fr;align-items:center;gap:25px;min-height:80px;border-bottom:1px solid #202e3d}
.studioBrand {display:flex;align-items:center;gap:12px;min-width:0}
.studioMark {width:43px;height:43px;flex:0 0 43px;display:grid;place-items:center;border:1px solid #385572;border-radius:13px;background:linear-gradient(145deg,#1b3653,#17283a);color:#bcd7fa;box-shadow:0 5px 16px #0003}
.studioMark svg {width:27px;height:27px}
.studioBrandText {display:flex;flex-direction:column;gap:2px;min-width:0}
.studioBrandText small,.studioEyebrow {font-size:9px;letter-spacing:.2em;color:#8ea9c8;font-weight:750;white-space:nowrap}
.studioBrandText strong {font-size:21px;font-weight:760;letter-spacing:-.025em;white-space:nowrap;line-height:1.3}
.studioBrandText em {font-size:10px;color:#8fb7eb;font-weight:750;letter-spacing:.16em;font-style:normal;vertical-align:middle}
.studioTop .mediaTabs {display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:4px;border:1px solid var(--studio-line);background:#0d1722;border-radius:13px}
.studioTop .mediaTabs button {min-width:86px;padding:10px 18px;border:1px solid transparent;color:#a7bbd3;font-weight:600;border-radius:9px}
.studioTop .mediaTabs button.on {background:var(--studio-accent-bg);color:#e0eeff;border-color:#466b95;box-shadow:0 1px 5px #0003}
.studioTop .mediaTabs button:not(.on):hover {background:#192b3f;color:white}
.studioTabIcon {font-size:16px;margin-right:5px;color:#8fb4e3}
.studioTopRight {justify-self:end;display:flex;align-items:center;gap:22px;min-width:0}
.studioLocal {font-size:11px;color:#91a5bb;white-space:nowrap}
.studioLocal i,.studioStatusDot {display:inline-block;width:8px;height:8px;border-radius:50%;background:#65bea5;box-shadow:0 0 0 4px #65bea517;margin-right:7px;vertical-align:middle}
.studioWorkspace {display:flex;align-items:center;gap:26px;padding:21px 0 13px}
.studioContextTitle {width:200px;flex:0 0 200px;min-width:0}
.studioContextTitle h1 {margin:8px 0 0;font-size:25px;font-weight:730;letter-spacing:-.04em;line-height:1.1;color:#f3f7fc}
.studioControls {display:flex;align-items:center;gap:12px;flex:1;min-width:0;flex-wrap:wrap}
.studioSearchWrap {display:flex;align-items:center;gap:10px;flex:1 1 230px;min-width:170px;height:43px;background:#101c2a;border:1px solid var(--studio-line);border-radius:11px;padding:0 12px;color:#7f98b5;transition:border-color .15s}
.studioSearchWrap:focus-within {border-color:#5c87bc;box-shadow:0 0 0 3px #547eb323}
.studioSearchWrap svg {width:17px;height:17px;flex:0 0 17px}
.studioSearchWrap #search {width:100%;height:100%;min-width:0;padding:0;color:var(--studio-text);background:transparent;border:0;outline:none;box-shadow:none;font-size:13px}
.studioSearchWrap #search::-webkit-search-cancel-button {cursor:pointer}
.studioSearchWrap kbd {white-space:nowrap;border:1px solid #324960;border-radius:5px;font-size:10px;font-weight:500;padding:3px 5px;color:#829ab6;background:#1b2b3d}
.studioActions {display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.studioSort {display:flex;gap:5px;align-items:center}
.studioActions button,.studioTopRight button,.photoToolbarActions button,#assetFolders button,.assetFolderTiles button.folderEntry,.unifiedBatchBar button {border:1px solid var(--studio-line);background:#182637;color:#cbdaf0;border-radius:10px;padding:10px 12px;font-size:12px;min-height:39px;white-space:nowrap}
.studioTopRight button {background:#263a54;border-color:#3a5471;color:#e0eaff}
.studioActions button:hover:not(:disabled),.studioTopRight button:hover,#assetFolders button:hover,.assetFolderTiles button.folderEntry:hover {background:#293e55;border-color:#577595;color:#fff}
.studioActions .sortBtn.active,.studioActions .unifiedHeaderButton[aria-pressed="true"] {background:#2b4563;color:#e4f0ff;border-color:#6489b5}
.studioActions #unifiedFavoriteFilter[aria-pressed="true"] {background:#413827;color:#ffdda4;border-color:#876b3a}
.studioStatus {display:flex;align-items:center;min-height:37px;gap:0;padding:4px 0 10px}
.studioStatusDot {width:6px;height:6px;box-shadow:0 0 0 3px #65bea514;margin-right:10px;flex:0 0 6px}
.studioStatus .status {margin:0;font-size:11px;color:#93a7be;min-width:0}
.studioHint {margin-left:auto;color:#607791;font-size:11px;white-space:nowrap}
.creatorPanel {max-height:min(25vh,260px);border-top:1px solid #223043}
.creatorTags {padding:10px 0}
.creatorTag,.creatorTagGroup {background:#172637!important;border-color:#354a61!important;color:#b5c8df!important}
.creatorTag.on,.creatorTagGroup .creatorTag.on {background:#304c69!important;color:#e6f2ff!important}
/* Content regions */
#photoToolbar {padding:19px 30px 9px;background:var(--studio-bg)}
.photoToolbarHead strong {font-size:23px;color:#eaf1fc;font-weight:710}
.photoSummary,.folderContext {color:var(--studio-muted);font-size:12px}
.photoToolbarActions button,.photoSelectionBar button {background:#192839;border-color:var(--studio-line);color:#d7e4f4}
.photoZoomControl {color:#a5b9d1}
.assetFolders {margin:0;padding:10px 30px 9px;border-bottom:1px solid #223143;gap:7px;min-height:55px}
.assetFolders button,.assetFolders .unifiedFolderNew {background:transparent;border-color:transparent;color:#acbfd5;font-size:12px;min-height:34px;padding:7px 11px}
.assetFolders button.on {background:#29435f;border:1px solid #496d93;color:#eaf5ff;font-weight:650}
#folderContext {padding:0 30px;margin:12px 0;color:#8098b2}
.assetFolderTiles {margin:10px 30px 4px;gap:13px}
.assetFolderTiles .folderEntry {min-width:160px}
.unifiedFolderTile {min-width:0}
.unifiedFolderTile>.unifiedFolderMore {background:#203249;border-color:#47607b;color:#dae8f7}
.grid {grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:16px;padding:18px 30px 70px;align-items:start}
.card {background:#131e2b;border:1px solid #26384b;border-radius:14px;box-shadow:none;transition:transform .17s ease,border-color .17s ease,box-shadow .17s ease}
@media(hover:hover){.card:hover {transform:translateY(-2px);border-color:#436280;box-shadow:0 10px 30px #0005}}
.coverWrap {background:#070b11;aspect-ratio:9/15;}
.coverSeek {background:#111d2a;border-top-color:#2e4052}
.coverSeekTop {color:#9fb2ca}
.body {padding:12px 13px 13px}
.creatorText {color:#86aace;font-size:11px}
.titleText {color:#ebf3fb;font-size:13px;font-weight:610;line-height:1.5;min-height:39px}
.creatorText:hover,.titleText:hover {background:#27394a}
.meta,.ratingValue {color:#8498b0}
.actions {border-top-color:#293c50}
.iconBtn,.unifiedMore {background:#1d2c3d;border-color:#3c536b;color:#d8e5f6}
.iconBtn:hover,.unifiedMore:hover {background:#314a65;color:white}
.mediaTile.unifiedSelected {outline-color:var(--studio-accent)}
.mediaTile.unifiedSelected .mediaTileCheck {background:#477cad;border-color:#477cad}
/* Photos: crisp square grid and Apple Photos-like albums */
body:has(#photoToolbar:not([hidden])) #assetFolders {margin:3px 30px 6px;padding:5px 0 10px}
body:has(#photoToolbar:not([hidden])) #folderContext {padding:0 30px;margin:7px 0 12px}
body:has(#photoToolbar:not([hidden])) .assetFolderTiles {margin:9px 30px 18px;grid-template-columns:repeat(auto-fill,minmax(160px,190px));gap:16px}
.photoAlbumMosaic {background:#1d2a37;border-radius:12px}
.photoAlbumName {color:#e8f0fa;font-weight:620}
.photoAlbumCount {color:#889db6}
#grid.pictureWall {padding:0 30px 85px;gap:5px}
#grid.pictureWall.photoOriginalRatio {gap:9px}
#grid.pictureWall .pictureTile {background:#172534;border-radius:8px}
#grid.pictureWall.photoOriginalRatio .pictureTile {border-radius:10px}
#grid.pictureWall .pictureTile img {background:#1d2d40}
/* Audio: compact grid, readable line clamping, calm fixed dock */
.audioFileGrid {grid-template-columns:repeat(auto-fill,minmax(min(100%,215px),1fr));padding:17px 30px 80px;gap:11px}
.audioFileTile {background:#152232;border:1px solid #2b3e52;min-height:106px;border-radius:12px;padding:12px;cursor:default}
.audioFileTile:hover {background:#1d3045;border-color:#506f90}
.audioFileTile.isActive {background:#243c54;border-color:#7aa9e8;box-shadow:inset 0 0 0 1px #709ace40}
.audioFileArt,.audioArtwork {background:#253e58;color:#a7cbf6;border-radius:10px}
.audioFileName {font-weight:590;font-size:13px;color:#e9f0fa;line-height:1.4;-webkit-line-clamp:3;line-clamp:3;max-height:calc(1.4em * 3)}
.audioFileMeta {color:#879eb7}
.audioDock {background:#101b2af7;border-top:1px solid #3b5269;box-shadow:0 -16px 42px #0008}
.audioDock .audioTrack {background:transparent}
.audioIconBtn {background:#1d3045;border:1px solid #375370;color:#dce9f8;border-radius:9px}
.audioIconBtn:hover,.audioSpeedChoice:hover {background:#314d69;color:#fff}
.audioSeek {background:linear-gradient(to right,#86b1ed 0%,#86b1ed var(--audio-progress,0%),#3b5169 var(--audio-progress,0%),#3b5169 100%)}
.audioSpeedPopup,.audioVolumePopup {background:#192b40;border-color:#496585}
/* Dialog consistency */
.unifiedContext {background:#1a2a3c;border:1px solid #4b657e;box-shadow:0 20px 65px #000b;border-radius:13px;padding:6px}
.unifiedContext .contextHeading {color:#91a9c2;border-bottom-color:#354a60}
.unifiedContext button:hover,.unifiedContext button:focus-visible {background:#30465d}
.unifiedRenameBack,.unifiedMoveBack,.unifiedAlbumBack,.clipShelfBack {background:#020710c9}
.unifiedRenamePanel,.unifiedMovePanel,.clipShelf,.shotStudio,.portraitDialog {background:#152335;color:#eaf1fb;border-color:#3d5570;box-shadow:0 24px 70px #0009;border-radius:17px}
.unifiedRenamePanel p,.unifiedMovePanel p,.clipShelfHead small {color:#94a8c0}
.unifiedRenameRow,.unifiedMovePanel input,.unifiedMovePanel select,.clipShelf input:not([type=checkbox]) {background:#101a27;border-color:#465e77;color:#e9f1fc}
.unifiedRenameButtons button,.unifiedMoveActions button,.clipShelf button,.portraitDialogActions button,.photoDetailTop button {background:#24364b;border-color:#425e7c;color:#e7f1fd;border-radius:9px}
.unifiedRenameButtons .primary,.unifiedMoveActions button[type=submit],.clipShelf button.primary,.portraitDialogActions .portraitSubmit {background:#88b1e5;border-color:#88b1e5;color:#102037;font-weight:700}
.clipShelfHead,.clipShelfToolbar {border-bottom-color:#344c65}
.clipShelfRow {background:#1c3045;border-color:#344f6a}
.clipShelfForm {background:#18293c}
.unifiedBatchBar {background:#1c3046;border-color:#55718d;box-shadow:0 12px 50px #000a}
.unifiedToast {background:#294562;border-color:#6486aa}
/* Full-screen control chrome; retain video gesture and layout mechanics. */
.feedHeader {background:linear-gradient(to bottom,#071019d9,transparent)}
.feedHeader .feedABBtn,.feedHeader .feedClose,.feedHeader .feedMagnify,.feedHeader .feedRotate,.feedHeader .feedMulti,.feedHeader .feedDelete {border:1px solid #52677b92;background:#182a3cdb;color:#edf3fc;border-radius:10px;backdrop-filter:blur(8px)}
.feedHeader button:hover:not(:disabled) {background:#315172e8}
.feedHeader .feedABBtn.set,.feedHeader .feedABBtn.active {background:#385775;color:#eff6ff;border-color:#83a9cc}
.photoDetailTop,.photoDetailBottom {background:#101b29;border-color:#2d4256}
#assetView .photoSideArrow {background:#25384dbd}
#assetView .photoSideArrow:hover {background:#3b5673}
.photoFilmstrip button.isCurrent {border-color:#92bbec}
::selection {background:#4876a5;color:white}
::-webkit-scrollbar {width:9px;height:9px}
::-webkit-scrollbar-thumb {border-radius:9px;background:#314559;border:2px solid var(--studio-bg)}
::-webkit-scrollbar-track {background:transparent}
@media(max-width:1120px){
 .studioTop {grid-template-columns:205px minmax(220px,max-content) 1fr;gap:14px}
 .studioTop .mediaTabs button {min-width:70px;padding:9px 12px}
 .studioContextTitle {width:175px;flex-basis:175px}
 .studioWorkspace {gap:18px}
 .studioLocal {display:none}
 .studioSort {display:none}
}
@media(max-width:760px){
 .studioHeader {padding:0 13px}
 .studioTop {grid-template-columns:minmax(0,1fr) auto;gap:8px;min-height:63px;padding-top:5px;padding-bottom:5px}
 .studioMark {height:38px;width:38px;flex-basis:38px;border-radius:12px}
 .studioBrand {gap:9px}
 .studioBrandText strong {font-size:19px}
 .studioBrandText small {font-size:8px;letter-spacing:.15em}
 .studioTopRight {gap:7px}
 .studioTopRight .clipShelfButton {min-height:35px;padding:7px 10px;font-size:11px}
 .studioTop .mediaTabs {grid-column:1/-1;grid-row:2;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%;margin:0 0 5px}
 .studioTop .mediaTabs button {min-width:0;padding:10px 4px}
 .studioWorkspace {display:block;padding:17px 0 11px}
 .studioContextTitle {width:auto;margin-bottom:13px}
 .studioContextTitle h1 {font-size:23px;margin-top:5px}
 .studioControls {display:block}
 .studioSearchWrap {width:100%;height:42px;margin-bottom:10px}
 .studioSearchWrap kbd {display:none}
 .studioActions {justify-content:flex-start;gap:8px}
 .studioActions button {min-height:36px;padding:8px 12px}
 .studioHint {display:none}
 .studioStatus {min-height:34px;padding:3px 0 9px}
 .studioStatus .status {font-size:10px}
 #photoToolbar {padding:15px 13px 9px}
 .photoToolbarHead {align-items:start;gap:9px}
 .photoToolbarHead strong {font-size:21px}
 .assetFolders {margin:0;padding:9px 13px 9px;gap:5px;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none}
 .assetFolders::-webkit-scrollbar {display:none}
 .assetFolders button {flex:0 0 auto;padding:7px 9px;min-height:34px}
 #folderContext {margin:10px 0;padding:0 13px;font-size:11px}
 .assetFolderTiles {margin:10px 13px 6px;gap:9px}
 .grid {padding:13px 13px 80px;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
 .card {border-radius:12px}
 .card .body {padding:10px}
 .titleText {font-size:12px}
 .coverWrap {aspect-ratio:9/14}
 .ratingStar {width:18px;font-size:19px}
 body:has(#photoToolbar:not([hidden])) #assetFolders {margin:2px 13px 7px;padding:6px 0 9px}
 body:has(#photoToolbar:not([hidden])) #folderContext {padding:0 13px}
 body:has(#photoToolbar:not([hidden])) .assetFolderTiles {margin:7px 13px 15px;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
 #grid.pictureWall {padding:0 13px 75px;gap:4px;grid-template-columns:repeat(2,minmax(0,1fr))}
 #grid.pictureWall.photoOriginalRatio {gap:6px}
 #grid.pictureWall .pictureTile {border-radius:6px}
 .audioFileGrid {grid-template-columns:repeat(2,minmax(0,1fr));padding:12px 13px 80px;gap:9px}
 .audioFileTile {padding:10px 8px;min-height:112px;gap:7px}
 .audioFileName {font-size:12px}
 .audioDock {padding:9px 12px calc(12px + env(safe-area-inset-bottom))}
 .audioDock .audioTrackHeader {margin-bottom:8px}
 .audioDock .audioTools {gap:7px}
 .audioABTools,.audioRightTools {gap:5px}
 .audioDock .audioIconBtn {min-height:34px}
 .unifiedBatchBar {bottom:calc(10px + env(safe-area-inset-bottom));gap:5px;padding:9px}
}
@media(max-width:360px){
 .studioBrandText small {font-size:7px}
 .studioTopRight .clipShelfButton {font-size:10px;padding:6px 8px}
 .studioActions button {padding:8px 9px}
 .studioContextTitle h1 {font-size:21px}
 .audioFileArt {display:none}
}
@media(prefers-reduced-motion:reduce){
 button,.card,#grid.pictureWall .pictureTile img {transition:none!important}
}


/* 影格 Studio · 播放器统一工具栏：一致图标、标签、状态和分组。 */
.feedHeader {gap:12px;padding:12px max(14px,env(safe-area-inset-right)) 12px max(14px,env(safe-area-inset-left));align-items:flex-start}
.feedHeader>.feedClose {flex:0 0 40px;width:40px;height:40px;min-width:40px;border-radius:11px}
.feedHeaderActions {display:flex;align-items:center;flex:1 1 auto;justify-content:flex-end;gap:9px;min-width:0;max-width:none!important;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;padding:0 1px 5px;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
.feedHeaderActions::-webkit-scrollbar {display:none}
.feedToolGroup {display:flex;align-items:center;gap:5px;flex:0 0 auto;padding-right:9px;border-right:1px solid #6985a13f}
.feedToolGroup:last-child {padding-right:0;border-right:0}
.feedHeader .feedTool {box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:7px;flex:0 0 auto;height:40px;min-height:40px;min-width:40px;width:auto;padding:0 10px;border:1px solid #60799388;border-radius:10px;background:#152638e8;color:#dce9f7;font:550 12px/1.1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:0;white-space:nowrap;cursor:pointer;transition:background .14s,border-color .14s,color .14s,box-shadow .14s}
.feedHeader .feedTool:hover:not(:disabled) {background:#284562;border-color:#7093b7;color:#fff}
.feedHeader .feedTool:focus-visible {outline:2px solid #94bdeb;outline-offset:2px}
.feedHeader .feedTool:active:not(:disabled) {background:#355875}
.feedToolGlyph {display:flex;align-items:center;justify-content:center;flex:0 0 18px;width:18px;height:18px;color:inherit}
.feedToolGlyph svg {display:block;width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.feedToolLetter {font-size:13px;font-weight:720;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;border:1px solid currentColor;border-radius:5px;width:18px;height:18px;flex-basis:18px}
.feedToolLabel {display:inline-block;line-height:1.15}
.feedHeader .feedTool.set,.feedHeader .feedTool.active,.feedHeader .feedTool[aria-pressed="true"] {background:#294761;color:#bcdbff;border-color:#668db9}
.feedHeader .feedTool.set .feedToolLetter {background:#8ebcf5;color:#112339;border-color:#8ebcf5}
.feedHeader .feedTool.loading {cursor:wait;border-color:#607993;opacity:.75}
.feedHeader .feedTool.done {background:#21483f;border-color:#608e7f;color:#b6e2d3}
.feedHeader .feedTool:disabled {opacity:.37;cursor:not-allowed}
.feedHeader .feedTool.armed,.feedHeader .feedTool.armed:hover {background:#7c2f3c;color:#fff1f2;border-color:#dc8190}
.feedToolGroupDanger .feedTool:not(.armed) {color:#e5b5bc}
@media(max-width:1180px) {
 .feedHeaderActions {justify-content:flex-start}
 .feedHeader .feedTool {gap:6px;padding:0 9px}
 .feedToolGroup {padding-right:7px;gap:4px}
}
@media(max-width:760px) {
 .feedHeader {gap:8px;padding:calc(9px + env(safe-area-inset-top)) calc(9px + env(safe-area-inset-right)) 9px calc(9px + env(safe-area-inset-left))}
 .feedHeader>.feedClose {height:44px;min-height:44px;flex-basis:44px;width:44px;border-radius:11px}
 .feedHeaderActions {flex:1 1 0;max-width:none!important;padding:0 1px 3px}
 .feedHeader .feedTool {height:44px!important;min-height:44px!important;min-width:44px!important;width:44px!important;padding:0!important;border-radius:11px!important}
 .feedToolLabel {display:none}
 .feedToolGroup {gap:5px;padding-right:9px}
}
@media(prefers-reduced-motion:reduce) { .feedHeader .feedTool {transition:none} }


/* 影格 Studio · UI 文案及控件规范 v1 (2026-10-19)
   使用共享尺寸、线性图标、清楚的状态。只针对显示层；保留原事件、API 与媒体数据。 */
:root {
  --studio-control-sm:36px;
  --studio-control-md:40px;
  --studio-control-touch:44px;
  --studio-icon-size:18px;
  --studio-control-gap:7px;
  --studio-control-radius:10px;
  --studio-ease:140ms ease;
}
/* 菜单：与工具栏同一文字层级和图标描边，危险动作单独分隔 */
.unifiedContext {min-width:224px;max-width:min(290px,calc(100vw - 16px));padding:6px;border:1px solid var(--studio-line-strong);border-radius:var(--studio-r);background:var(--studio-panel);box-shadow:0 18px 56px #000a}
.unifiedContext .contextHeading {font-size:11px;font-weight:550;letter-spacing:.015em;color:var(--studio-muted);padding:9px 11px 10px;margin-bottom:5px;border-bottom:1px solid var(--studio-line);max-width:260px}
.unifiedContext .studioMenuRow {display:flex;align-items:center;gap:11px;width:100%;min-height:var(--studio-control-md);padding:9px 11px;line-height:1.35;font-size:13px;font-weight:500;color:var(--studio-text);border:1px solid transparent;border-radius:8px;white-space:nowrap}
.unifiedContext .studioMenuRow:hover,.unifiedContext .studioMenuRow:focus-visible {background:#29425b;border-color:#365575;outline:none}
.unifiedContext .studioMenuRow.danger {color:var(--studio-danger);margin-top:5px;border-top:1px solid var(--studio-line);border-radius:0 0 8px 8px;padding-top:12px}
.unifiedContext .studioMenuRow.danger:hover {background:#4b2b3a;border-color:transparent}
.studioMenuIcon,.audioControlIcon {display:inline-flex;align-items:center;justify-content:center;flex:0 0 var(--studio-icon-size);width:var(--studio-icon-size);height:var(--studio-icon-size)}
.studioMenuIcon svg,.audioControlIcon svg {width:var(--studio-icon-size);height:var(--studio-icon-size);display:block;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.studioMenuLabel,.audioControlLabel {display:inline-block;line-height:1.25}
/* 音频控制：按钮与视频共用视觉规格；时间标记另置，不挤压动作 */
.audioDock {background:#101b2af8;border-top:1px solid var(--studio-line-strong)}
.audioDock .audioTrackHeader {margin-bottom:9px}
.audioDock .audioTrack .audioTitle {font-size:13px;font-weight:620;color:var(--studio-text)}
.audioDock .audioTimeline {gap:10px}
.audioDock .audioTools {display:flex;align-items:center;justify-content:space-between;gap:8px 15px;margin:11px 0 0;flex-wrap:wrap}
.audioDock .audioABTools,.audioDock .audioRightTools {gap:6px;flex-wrap:nowrap}
.audioDock .audioIconBtn {height:var(--studio-control-sm);min-height:var(--studio-control-sm);min-width:var(--studio-control-sm);display:inline-flex;align-items:center;gap:6px;padding:0 10px;background:#1b2c40;color:#d9e7f6;border:1px solid #415a75;border-radius:var(--studio-control-radius);font-size:12px;font-weight:550;line-height:1.15;box-shadow:none;transition:background var(--studio-ease),border-color var(--studio-ease),color var(--studio-ease)}
.audioDock .audioIconBtn:hover:not(:disabled),.audioDock .audioIconBtn:focus-visible {color:#fff;background:#2c4865;border-color:#6a8db5}
.audioDock .audioIconBtn:disabled {opacity:.37}
.audioLetterIcon {display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px;width:18px;height:18px;font:700 12px ui-monospace,SFMono-Regular,Consolas,monospace;border:1px solid currentColor;border-radius:5px}
.audioDock .audioIconBtn.on,.audioDock .audioIconBtn[aria-pressed="true"] {background:#294761;color:#bcdbff;border-color:#668db9}
.audioDock .audioABBtn.on .audioLetterIcon {color:#112339;border-color:#8ebcf5;background:#8ebcf5}
.audioDock .audioABInfo {order:2;flex:1 1 120px;margin:0;color:var(--studio-muted);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.audioDock .audioRightTools {margin-left:auto;order:3}
.audioDock .audioSpeed {font-variant-numeric:tabular-nums;min-width:54px}
.audioDock .audioMute {width:var(--studio-control-sm);padding:0}
.audioMute[data-muted="false"] .audioVolumeOff,.audioMute[data-muted="true"] .audioVolumeOn {display:none}
.audioDock .audioPlay {width:40px;min-width:40px;height:40px;min-height:40px;padding:0}
.audioDock .audioABTools .audioABLoop,.audioDock .audioABTools .audioClip {min-width:0}
.audioDock .audioClip.loading {cursor:wait}
.audioDock .audioSeek {min-width:0}
.audioVolumePopup,.audioSpeedPopup {border-radius:var(--studio-r);background:var(--studio-panel);border-color:var(--studio-line-strong)}
/* 图片预览：桌面快捷键和手机手势分别解释，统一简短术语 */
.photoDetailBottom {gap:7px;padding:8px 12px 10px}
.photoDetailHelp {font-size:11px;font-weight:500;color:var(--studio-muted);opacity:.78;letter-spacing:.01em}
.photoDetailHelp .helpMobile {display:none}
.photoDetailTop button,.clipShelf button,.unifiedRenameButtons button,.unifiedMoveActions button {font-size:12px;font-weight:550}
@media(max-width:900px) {
  .audioDock .audioTools {gap:7px 11px}
  .audioDock .audioABInfo {flex-basis:100%;order:4}
}
@media(max-width:760px) {
  .unifiedContext .studioMenuRow {min-height:var(--studio-control-touch);font-size:13px}
  .audioDock .audioTools {align-items:center;row-gap:8px}
  .audioDock .audioABTools {max-width:100%;gap:6px;overflow-x:auto;scrollbar-width:none}
  .audioDock .audioABTools::-webkit-scrollbar {display:none}
  .audioDock .audioRightTools {margin-left:0;flex-wrap:nowrap;order:2}
  .audioDock .audioABInfo {order:3;flex-basis:100%;font-size:11px}
  .audioDock .audioIconBtn {min-height:var(--studio-control-touch);height:var(--studio-control-touch);min-width:var(--studio-control-touch);padding:0 10px}
  .audioDock .audioMute {width:var(--studio-control-touch)}
  .audioDock .audioPlay {width:var(--studio-control-touch);height:var(--studio-control-touch)}
  .audioDock .audioRightTools {margin-left:auto}
  .photoDetailHelp .helpDesktop {display:none}
  .photoDetailHelp .helpMobile {display:inline}
}
@media(max-width:410px) {
  .audioDock .audioControlLabel {font-size:11px}
  .audioDock .audioABTools .audioIconBtn {padding:0 7px}
  .audioDock .audioABTools {width:100%}
  .audioDock .audioRightTools {width:100%;justify-content:flex-end}
  .audioDock .audioTools {gap:7px}
}

/* 导航/文件目录/音频封面，使用与操作控件一致的线性图标 */
.studioTop .mediaTabs button {display:flex;align-items:center;justify-content:center;gap:7px}
.studioTabIcon,.studioTopActionIcon,.studioFolderIcon {display:inline-flex;align-items:center;justify-content:center;flex:0 0 17px;width:17px;height:17px}
.studioTabIcon {margin:0}
.studioTabIcon svg,.studioTopActionIcon svg,.studioFolderIcon svg {width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.studioTopRight .clipShelfButton,#unifiedFavoriteFilter,#photoRatio {display:inline-flex;align-items:center;justify-content:center;gap:7px}
.unifiedFolderTile>.folderEntry {display:flex;align-items:center;gap:8px}
.studioFolderIcon {flex:0 0 18px;color:#8eafd0}
.studioFolderName {overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.audioFileArt svg,.audioArtwork svg {display:block;width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.audioArtwork {display:grid;place-items:center}


/* 影格 Studio v2 · 视频操作与片头信息布局修复（不修改媒体处理逻辑） */
.feedHeaderActions {
  --feed-tool-gap: 8px;
  gap: var(--feed-tool-gap) !important;
  align-items: center;
  padding-bottom: 3px;
}
/* 语义分组保留在 DOM/无障碍信息中，但视觉间隔一致。 */
.feedToolGroup,
.feedToolGroup:last-child {
  gap: var(--feed-tool-gap) !important;
  padding-right: 0 !important;
  border-right: 0 !important;
  margin: 0 !important;
}
.feedHeader .feedTool {
  gap: 7px;
  height: 40px;
  min-height: 40px;
  min-width: 40px;
  padding: 0 12px;
  border-radius: 10px;
}
/* A/B 是两个纯文本操作，不再重复字母徽记；激活态仅通过颜色表达。 */
.feedHeader #feedSetA,
.feedHeader #feedSetB {
  min-width: 90px;
  padding: 0 13px;
  font-variant-numeric: tabular-nums;
}
.feedHeader #feedSetA.set,
.feedHeader #feedSetB.set {
  box-shadow: inset 0 -2px 0 #8ebcf5;
}
/* 原生 video controls 处于底部独立层。标题和创作者整体上移到安全区域。 */
.feedItem > .feedInfo {
  position: absolute !important;
  z-index: 3;
  top: auto !important;
  left: 0 !important;
  right: 0 !important;
  bottom: calc(96px + var(--safe-bottom, 0px)) !important;
  box-sizing: border-box;
  padding: 12px 24px !important;
  background: linear-gradient(90deg, rgba(0,0,0,.62),rgba(0,0,0,.18) 67%,transparent);
  pointer-events: none;
}
.feedItem > .feedInfo .feedCreator,
.feedItem > .feedInfo .feedTitle {
  max-width: min(680px, calc(100vw - 245px));
  margin: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.feedItem > .feedInfo .feedCreator {
  margin-bottom: 4px;
  font-size: 13px;
  line-height: 1.35;
}
.feedItem > .feedInfo .feedTitle {
  font-size: 14px;
  line-height: 1.42;
  font-weight: 500;
}
/* 评分悬浮控件独立定位，避免挤占标题两行。 */
.feedItem > .feedRating {
  position: absolute;
  right: calc(20px + var(--safe-right, 0px)) !important;
  bottom: calc(100px + var(--safe-bottom, 0px)) !important;
  z-index: 4;
}
@media (max-width: 760px) {
  .feedHeader #feedSetA,
  .feedHeader #feedSetB {
    min-width: 44px !important;
    width: 44px !important;
    padding: 0 !important;
  }
  /* 移动端以简洁 A/B 文本保留区间操作的可辨识性。 */
  .feedHeader #feedSetA .feedToolLabel,
  .feedHeader #feedSetB .feedToolLabel {
    display: block !important;
    font: 700 13px/1 ui-monospace,SFMono-Regular,Consolas,monospace;
  }
  .feedHeader #feedSetA .feedToolLabel { font-size: 0; }
  .feedHeader #feedSetA .feedToolLabel::after { content: 'A'; font-size: 14px; }
  .feedHeader #feedSetB .feedToolLabel { font-size: 0; }
  .feedHeader #feedSetB .feedToolLabel::after { content: 'B'; font-size: 14px; }
  .feedItem > .feedInfo {
    bottom: calc(90px + var(--safe-bottom, 0px)) !important;
    padding: 10px 14px !important;
    background: linear-gradient(90deg,rgba(0,0,0,.65),rgba(0,0,0,.15));
  }
  .feedItem > .feedInfo .feedCreator,
  .feedItem > .feedInfo .feedTitle {
    max-width: calc(100vw - 28px);
  }
  .feedItem > .feedRating {
    right: calc(14px + var(--safe-right, 0px)) !important;
    bottom: calc(182px + var(--safe-bottom, 0px)) !important;
  }
}


/* 影格 Studio v3 · 紧凑的信息/评分组合；原生播放控制条拥有自己的底部区域。 */
.feedItem > .feedDetails {
  position:absolute;
  z-index:81;
  left:calc(20px + var(--safe-left,0px));
  bottom:calc(78px + var(--safe-bottom,0px));
  display:flex;
  align-items:center;
  flex-wrap:nowrap;
  gap:14px;
  width:max-content;
  max-width:calc(100vw - 40px - var(--safe-left,0px) - var(--safe-right,0px));
  box-sizing:border-box;
  padding:10px 12px;
  border:1px solid rgba(137,166,198,.20);
  border-radius:12px;
  background:rgba(11,19,30,.76);
  box-shadow:0 4px 18px rgba(0,0,0,.20);
  -webkit-backdrop-filter:blur(9px);
  backdrop-filter:blur(9px);
  transition:opacity .22s ease,transform .22s ease;
  pointer-events:none;
}
.feedItem > .feedDetails > .feedInfo {
  position:static!important;
  inset:auto!important;
  z-index:auto!important;
  display:block!important;
  flex:0 1 auto;
  min-width:0;
  width:auto!important;
  max-width:min(440px,calc(100vw - 268px));
  box-sizing:border-box;
  padding:0!important;
  margin:0!important;
  background:none!important;
  transform:none!important;
  opacity:1!important;
  text-shadow:0 1px 6px rgba(0,0,0,.65);
}
.feedItem > .feedDetails .feedCreator,
.feedItem > .feedDetails .feedTitle {
  display:block!important;
  min-width:0;
  overflow:hidden;
  white-space:nowrap;
  text-overflow:ellipsis;
  overflow-wrap:normal;
  -webkit-line-clamp:unset;
  line-clamp:unset;
}
.feedItem > .feedDetails .feedCreator {font-size:12px!important;line-height:1.5!important;font-weight:650;margin:0 0 1px!important;color:#f4f7fc}
.feedItem > .feedDetails .feedTitle {font-size:13px!important;line-height:1.45!important;font-weight:450;margin:0!important;color:#d3deeb}
.feedItem > .feedDetails > .feedRating {
  position:static!important;
  inset:auto!important;
  z-index:auto!important;
  display:flex;
  align-items:center;
  flex:0 0 auto;
  min-width:0;
  width:auto!important;
  max-width:100%!important;
  margin:0!important;
  padding:2px 0 2px 12px!important;
  border:0;
  border-left:1px solid rgba(148,173,201,.3);
  border-radius:0;
  background:transparent;
  box-shadow:none;
  backdrop-filter:none;
  pointer-events:auto;
}
.feedItem > .feedDetails .feedRating .ratingStar {width:19px;height:22px;font-size:19px;line-height:22px}
.feedOverlay.chromeHidden .feedItem > .feedDetails,
.feedOverlay.focusImmersive.chromeHidden .feedItem > .feedDetails {opacity:0;transform:translateY(10px);pointer-events:none}
@media(max-width:760px){
  .feedItem > .feedDetails {
    left:calc(12px + var(--safe-left,0px));
    bottom:calc(78px + var(--safe-bottom,0px));
    flex-wrap:wrap;
    gap:6px;
    max-width:calc(100vw - 24px - var(--safe-left,0px) - var(--safe-right,0px));
    padding:8px 10px;
  }
  .feedItem > .feedDetails > .feedInfo {flex:1 1 100%;max-width:calc(100vw - 46px)}
  .feedItem > .feedDetails > .feedRating {padding:0!important;border:0;max-width:100%}
  .feedItem > .feedDetails .feedCreator {font-size:12px!important}
  .feedItem > .feedDetails .feedTitle {font-size:12px!important}
}
@media(max-height:390px){
  .feedItem > .feedDetails {bottom:calc(68px + var(--safe-bottom,0px));padding:6px 10px}
  .feedItem > .feedDetails > .feedInfo .feedCreator {line-height:1.2!important}
  .feedItem > .feedDetails > .feedInfo .feedTitle {line-height:1.25!important}
}


/* ===== 影格 Studio v4 · PURE VIEWING · 只让内容成为主角 ===== */
:root{--yg-bg:#070b11;--yg-surface:#0d1420;--yg-line:#ffffff17;--yg-bright:#d9e7f8;--yg-soft:#8a97aa;--yg-accent:#9bc4ff}
html,body{background:var(--yg-bg);color:var(--yg-bright)}
body{padding-left:82px;background:radial-gradient(ellipse at 85% 1%,#17253d 0,transparent 42%),#070b11}
/* A single quiet top line; library navigation floats independently at the left. */
.studioHeader{display:flex;align-items:center;gap:22px;min-height:76px;padding:11px 28px!important;border-bottom:1px solid #ffffff12;background:#090f19ed}
.studioTop{display:flex;align-items:center;min-height:52px;padding:0!important;flex:0 0 auto;gap:8px}
.studioBrand{gap:9px}.studioBrandText small,.studioEyebrow,.studioHint,.studioLocal,.studioStatus,.studioContextTitle{display:none!important}
.studioBrandText strong{font-size:16px;letter-spacing:-.025em;font-weight:570}.studioBrandText em{font-size:12px;font-weight:440;letter-spacing:.02em}
.studioMark{width:34px;height:34px;flex-basis:34px;border-radius:10px;background:#17273a;border:1px solid #ffffff1a}
.studioTop .mediaTabs{position:fixed!important;left:12px;top:92px;bottom:auto;z-index:24;width:58px!important;display:flex!important;flex-direction:column;gap:8px;padding:5px!important;background:#0e1723;border:1px solid #ffffff15;border-radius:17px;box-shadow:0 15px 42px #0008}
.studioTop .mediaTabs button{width:46px!important;height:48px;min-width:46px!important;min-height:48px!important;padding:0!important;border-radius:12px;color:#8197ad;font-size:0!important}
.studioTop .mediaTabs button.on{color:#c5defa;background:#24405f;box-shadow:inset 0 0 0 1px #6c91bb52}
.studioTop .mediaTabs button .studioTabIcon,.studioTop .mediaTabs button .studioTabIcon svg{width:21px;height:21px}
.studioTopRight{position:fixed;left:17px;top:263px;z-index:25;display:flex!important}
.studioTopRight #clipShelfTop{height:46px;width:46px;min-height:46px;padding:0!important;background:transparent;border:1px solid transparent;font-size:0;color:#8ba4c2;border-radius:12px}
.studioTopRight #clipShelfTop:hover{background:#233b55}.studioTopRight #clipShelfTop svg{width:21px;height:21px}
.studioWorkspace{flex:1;min-width:0;margin:0;padding:0!important;display:block}.studioControls{display:flex;gap:14px;align-items:center;flex-wrap:nowrap}
.studioSearchWrap{height:42px;flex:1 1 260px;max-width:660px;background:#121f30;border:1px solid #ffffff1b;border-radius:13px}
.studioSearchWrap kbd{display:none}.studioActions{flex-wrap:nowrap;gap:8px}.studioActions button{background:transparent;border-color:#ffffff1a;color:#aabace;border-radius:10px;font-weight:470}
.studioActions .sortBtn.active{background:#203248;border-color:#496b8d;color:#dceafa}
#unifiedFavoriteFilter,#unifiedFavorite,.studioFavoriteLabel{display:none!important}
#creatorToggle{font-size:0;min-width:42px}.creatorToggle:after{content:'⌁';font-size:21px;line-height:1}.creatorPanel.collapsed{display:none!important}.creatorPanel:not(.collapsed){position:absolute;top:75px;left:82px;right:0;z-index:31;padding:10px 28px;background:#0e1724f5;border:1px solid #ffffff1a;border-radius:0 0 15px 15px;box-shadow:0 15px 35px #000a}
#photoToolbar{background:transparent}.studioRoomEyebrow{font-size:10px;letter-spacing:.26em;color:#8293aa}
.studioEntrance{display:block;margin:0;padding:26px 28px 0}.studioEntrance[hidden]{display:none!important}
.studioRoomIntro{display:flex;align-items:end;justify-content:space-between;padding:18px 0 38px;gap:10px}
.studioRoomIntro h2{font-size:clamp(29px,3.1vw,48px);line-height:1.13;letter-spacing:-.07em;font-weight:350;margin:14px 0 6px;color:#e8effc}
.studioRoomAccent{color:#8cb7ee}.studioRoomIntro p{font-size:12px;letter-spacing:.15em;color:#788fa9;margin:0}.studioRoomCount{font-size:12px;color:#8597ac;padding-bottom:11px}
.studioRoomSection{margin-bottom:26px}.studioRoomSectionHead{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin:0 0 14px}
.studioRoomSectionHead h3{font-size:16px;font-weight:560;margin:0;color:#dce7f4;letter-spacing:.01em}.studioRoomSectionHead>span{font-size:11px;color:#687e99}.studioLibraryHeading{margin:31px 0 12px}
.studioRoomRow{display:flex;align-items:stretch;gap:13px;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;scrollbar-color:#37516e transparent;padding:0 1px 12px;scroll-snap-type:x proximity}
.studioRoomTile{position:relative;display:block;flex:0 0 clamp(136px,13vw,196px);aspect-ratio:9/13;border:1px solid #ffffff20;border-radius:12px;padding:0;overflow:hidden;background:linear-gradient(160deg,#1e3049,#070c14);color:white;cursor:pointer;text-align:left;scroll-snap-align:start;transition:border-color .18s ease,transform .18s ease,box-shadow .18s ease}
.studioRoomTile>img{width:100%;height:100%;display:block;object-fit:cover;transition:transform .45s cubic-bezier(.2,.8,.2,1)}
.studioRoomTile:hover{transform:translateY(-3px);border-color:#91b5da;box-shadow:0 17px 38px #0008}.studioRoomTile:hover>img{transform:scale(1.04)}
.studioRoomShade{position:absolute;inset:36% 0 0;background:linear-gradient(0deg,#020509eb 0%,#02050954 44%,transparent)}
.studioRoomPlay{position:absolute;top:12px;right:12px;display:grid;place-items:center;width:29px;height:29px;border:1px solid #ffffff53;border-radius:50%;background:#080d13a3;opacity:0;transition:opacity .18s}.studioRoomTile:hover .studioRoomPlay,.studioRoomTile:focus-visible .studioRoomPlay{opacity:1}
.studioRoomPlay svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6}.studioRoomCaption{position:absolute;bottom:0;left:0;right:0;padding:18px 11px 12px;display:grid;gap:4px}
.studioRoomCaption strong{font-weight:510;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}.studioRoomCaption small{font-size:10px;color:#bac7d4}.studioRoomPlaceholder{position:absolute;inset:0;display:grid;place-items:center;color:#759cbd}.studioRoomPlaceholder svg{width:40px;height:40px}
#assetFolders{margin:0 28px!important;padding:9px 0 12px!important;border-bottom:1px solid #ffffff14;min-height:0;gap:6px}
#folderContext{padding:0 28px!important;color:#667f98;font-size:11px;margin:9px 0!important}
#folderTiles.assetFolderTiles{padding:0 28px;margin:16px 0;gap:12px}
.grid{grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;padding:18px 28px 80px}.card{background:#0d1520;border-color:#ffffff16;border-radius:12px;overflow:hidden;transition:transform .2s,border-color .2s}.card:hover{border-color:#7e9ebc73;transform:translateY(-2px)}
.coverWrap{aspect-ratio:9/13;background:#080e16}.card .cover{transition:transform .3s ease}.card:hover .cover{transform:scale(1.035)}
.card .body{padding:10px 11px}.card .creatorText{font-size:10px;color:#7f9fbd}.card .titleText{font-size:12px;font-weight:510;min-height:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.card .meta{display:none}.card .actions{margin-top:6px;padding-top:4px;border:0}.card .creatorEditBtn,.card .creatorLinkBtn,.card .coverSeek{opacity:0;transition:opacity .15s}.card:hover .creatorEditBtn,.card:focus-within .creatorEditBtn,.card:hover .creatorLinkBtn,.card:focus-within .creatorLinkBtn,.card:hover .coverSeek,.card:focus-within .coverSeek{opacity:1}
.card .coverSeek{position:absolute;left:0;right:0;bottom:0;z-index:3;background:#070c12ed}.card .stars{transform:scale(.82);transform-origin:left center;margin-right:-25px}.card .mediaKindBadge{display:none!important}
.mediaTile[data-favorite=true]:before{display:none!important}
#grid.pictureWall{padding:8px 28px 85px}.audioFileGrid{padding:18px 28px 85px}
/* Player is an entirely separate, edge-to-edge space. Zero fixed banner height. */
.feedOverlay{background:#020407!important}
.feedItem,.feedItem .videoStage{background:#020407!important}
.feedBackdrop{position:absolute;inset:-12%;width:124%;height:124%;object-fit:cover;filter:blur(70px) brightness(.50) saturate(.85);opacity:.47;pointer-events:none;z-index:0;transform:scale(1.08)}
.feedMedia.feedVideo{position:relative;z-index:1;width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;object-fit:contain;filter:none;box-shadow:none;border-radius:0}
.feedHeader{position:fixed!important;inset:0 0 auto!important;height:0!important;min-height:0!important;overflow:visible!important;display:block!important;padding:0!important;background:none!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important;pointer-events:none!important;z-index:85}
.feedHeader>.feedClose,.feedToolsToggle,.feedRailToggle,.feedRatingToggle{position:fixed;display:grid;place-items:center;width:40px;height:40px;min-width:40px;min-height:40px;padding:0!important;z-index:87;pointer-events:auto!important;background:#0b142094!important;border:1px solid #ffffff36!important;color:#d6e3f3!important;border-radius:50%!important;box-shadow:0 6px 18px #0005;cursor:pointer;transition:opacity .22s,background .16s,transform .16s}
.feedHeader>.feedClose{left:18px;top:18px;width:40px!important;height:40px!important}
.feedToolsToggle{right:20px;top:18px}.feedRatingToggle{right:20px;top:69px}.feedRailToggle{left:18px;top:69px}
.feedToolsToggle svg,.feedRailToggle svg,.feedRatingToggle svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.feedToolsToggle svg circle{fill:currentColor;stroke:none}
.feedOverlay.toolsOpen .feedToolsToggle,.feedOverlay.infoVisible .feedRatingToggle,.feedOverlay.railOpen .feedRailToggle{background:#284967!important;border-color:#93b8df!important;color:#fff!important}
.feedHeader .feedHeaderActions{position:fixed!important;right:18px;top:126px;z-index:89;box-sizing:border-box;width:300px!important;max-width:calc(100vw - 36px)!important;max-height:calc(100dvh - 144px);overflow-y:auto!important;overflow-x:hidden!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px!important;padding:13px!important;border:1px solid #ffffff31;background:#0b1421ed;box-shadow:0 25px 75px #000c;border-radius:18px;backdrop-filter:blur(25px);-webkit-backdrop-filter:blur(25px);visibility:hidden;opacity:0;pointer-events:none!important;transform:translateY(-8px) scale(.985);transition:opacity .18s,transform .18s,visibility .18s}
.feedOverlay.toolsOpen .feedHeaderActions{visibility:visible;opacity:1;pointer-events:auto!important;transform:translateY(0) scale(1)}
.feedHeader .feedToolGroup,.feedHeader .feedToolGroup:last-child{display:contents!important;padding:0!important;border:0!important}
.feedHeader .feedHeaderActions .feedTool{display:flex;flex-direction:column;gap:8px;width:100%;min-width:0;height:74px;min-height:74px!important;padding:10px 3px!important;border-radius:12px;background:#111d2dbd!important;border:1px solid #ffffff1c!important;color:#c9d9eb;font-weight:450;letter-spacing:0}
.feedHeader .feedToolGlyph,.feedHeader .feedToolGlyph svg{width:22px;height:22px;flex-basis:22px}
.feedHeader .feedToolLabel{display:block!important;font-size:11px!important;font-weight:450!important;line-height:1.2}.feedHeader #feedSetA .feedToolLabel::after,.feedHeader #feedSetB .feedToolLabel::after{content:none!important}
.feedHeader .feedTool.active,.feedHeader .feedTool.set{background:#2b4764!important;color:#dcebff;border-color:#7eafd9!important}.feedHeader .feedTool:disabled{opacity:.35}
.feedHeader .feedToolGroupDanger .feedTool{color:#e5a8b1!important}
.feedHeader .feedTool:hover:not(:disabled){background:#28435e!important;border-color:#8cabca!important}
.feedItem > .feedDetails{position:fixed!important;left:18px;bottom:96px!important;width:min(390px,calc(100vw - 36px));max-width:calc(100vw - 36px);z-index:86;opacity:0;transform:translateY(12px);pointer-events:none;visibility:hidden;transition:opacity .18s,transform .18s,visibility .18s;background:#0c1520e8;border-color:#ffffff24;border-radius:14px;box-shadow:0 12px 35px #000a}
.feedOverlay.infoVisible .feedItem.studioCurrent > .feedDetails{opacity:1;visibility:visible;transform:none;pointer-events:auto}
.feedItem > .feedDetails > .feedInfo{max-width:230px!important}.feedItem > .feedDetails .feedRating{pointer-events:auto}
.feedFilmstrip{position:fixed;left:14px;top:124px;bottom:18px;width:78px;padding:8px 7px;display:flex;flex-direction:column;align-items:stretch;gap:9px;z-index:83;overflow-y:auto;scrollbar-width:none;background:#070c14c9;border:1px solid #ffffff24;border-radius:15px;backdrop-filter:blur(18px);box-shadow:0 17px 44px #0008;visibility:hidden;opacity:0;transform:translateX(-12px);pointer-events:none;transition:opacity .2s,transform .2s,visibility .2s}
.feedOverlay.railOpen .feedFilmstrip{visibility:visible;opacity:1;transform:none;pointer-events:auto}
.feedFilmTile{flex:0 0 auto;width:62px;height:92px;border-radius:8px;border:1px solid #ffffff28;background:#142033;overflow:hidden;padding:0;color:#bbcfe6;cursor:pointer}.feedFilmTile img{display:block;width:100%;height:100%;object-fit:cover}.feedFilmTile.current{border-color:#a2c8fa;box-shadow:0 0 0 2px #719de65c}
.feedOverlay.chromeHidden .feedHeader>.feedClose,.feedOverlay.chromeHidden .feedToolsToggle,.feedOverlay.chromeHidden .feedRailToggle,.feedOverlay.chromeHidden .feedRatingToggle,.feedOverlay.chromeIdle .feedHeader>.feedClose,.feedOverlay.chromeIdle .feedToolsToggle,.feedOverlay.chromeIdle .feedRailToggle,.feedOverlay.chromeIdle .feedRatingToggle{opacity:0;pointer-events:none!important}
.feedOverlay.toolsOpen .feedToolsToggle,.feedOverlay.infoVisible .feedRatingToggle,.feedOverlay.railOpen .feedRailToggle{opacity:1;pointer-events:auto!important}
#clipShelfFavOnly,#clipShelfFav{display:none!important}
@media(max-width:820px){body{padding-left:60px}.studioHeader{padding:9px 14px!important;gap:8px;flex-wrap:wrap}.studioTop .mediaTabs{left:6px;top:75px;width:47px!important;padding:3px!important}.studioTop .mediaTabs button{width:40px!important;min-width:40px!important;height:44px!important;min-height:44px!important}.studioTopRight{left:5px;top:231px}.studioTopRight #clipShelfTop{width:46px!important;height:44px!important}.studioControls{flex-wrap:wrap}.studioRoomIntro h2{font-size:29px}.studioRoomTile{flex-basis:142px}.studioEntrance,#folderTiles.assetFolderTiles{padding-left:14px;padding-right:14px}.grid{padding-left:14px;padding-right:14px}.feedHeader .feedHeaderActions{top:115px;right:12px}.feedToolsToggle,.feedRatingToggle{right:12px}.feedRailToggle,.feedHeader>.feedClose{left:12px}.feedBackdrop{filter:blur(45px) brightness(.48)}}
@media(max-height:480px){.feedFilmstrip{top:66px}.feedItem > .feedDetails{bottom:62px!important}.feedHeader .feedHeaderActions{top:65px;max-height:calc(100dvh - 80px)}.feedRatingToggle{top:18px;right:72px}.feedRailToggle{top:18px;left:72px}}
@media(prefers-reduced-motion:reduce){.studioRoomTile,.studioRoomTile img,.feedHeaderActions,.feedFilmstrip,.feedDetails{transition:none!important}}

/* ===== 影格 Studio v5 · CINEMA FIRST / ONE DESIGN LANGUAGE ===== */
:root {
  --v5-bg:#07090e;--v5-ink:#edf0f6;--v5-secondary:#89929e;--v5-hairline:rgba(202,214,231,.105);
  --v5-panel:#111823;--v5-hover:#1b2634;--v5-highlight:#b9d2f5;--v5-warn:#e6a8b2;
  --v5-radius:14px;--v5-ease:cubic-bezier(.22,.8,.24,1);
}
html{color-scheme:dark}
body{padding-left:86px;background:radial-gradient(ellipse 45% 35% at 94% 13%,#17243b 0%,transparent 100%),var(--v5-bg)!important;color:var(--v5-ink);font-feature-settings:'tnum' 1}
::selection{background:#608bb866;color:white}
:where(button,input,select,textarea){-webkit-tap-highlight-color:transparent}
:where(button,[tabindex],input,select):focus-visible{outline:2px solid #bed8ff!important;outline-offset:3px}
:where(button){transition:background-color .18s ease,border-color .18s ease,color .18s ease,opacity .18s ease,transform .18s var(--v5-ease)}
:where(button):disabled{cursor:not-allowed;opacity:.42}
/* A coherent, discreet app chrome: the library can show tools; the film cannot. */
.studioHeader{min-height:77px!important;gap:20px!important;background:#090d14ee!important;border:0!important;border-bottom:1px solid var(--v5-hairline)!important;padding:12px 33px 12px 27px!important;box-shadow:none!important;backdrop-filter:blur(28px)}
.studioTop{min-height:49px!important}.studioBrand{padding:0 18px 0 0;min-width:170px;border-right:1px solid var(--v5-hairline)}
.studioMark{border-radius:12px!important;width:37px;height:37px;flex-basis:37px;background:linear-gradient(140deg,#293548,#151c29)!important;border-color:#ffffff15!important;color:#dce8f7}
.studioBrandText strong{font-size:16px!important;letter-spacing:-.045em!important;font-weight:650!important}.studioBrandText em{font-size:11px!important;font-weight:420!important;letter-spacing:.105em!important;color:#adbfda}
.studioWorkspace{min-width:0!important}.studioControls{gap:18px!important}
.studioSearchWrap{height:43px!important;max-width:min(640px,55vw)!important;border:1px solid #ffffff15!important;background:#151d29!important;border-radius:12px!important;transition:border-color .16s,background .16s!important}
.studioSearchWrap:focus-within{border-color:#7899bd!important;background:#192434!important}
.studioSearchWrap svg{opacity:.75}.studioSearchWrap input{font-size:13px!important;letter-spacing:.01em}
.studioActions{gap:7px!important}.studioActions button{min-height:36px!important;height:36px;padding:0 12px!important;border-radius:9px!important;background:#101824!important;border:1px solid #ffffff15!important;font-size:12px!important;color:#aebacc!important;font-weight:500!important}
.studioActions button:hover:not(:disabled){background:#1b293a!important;border-color:#6583a355!important;color:#f0f5fb!important}
.studioActions button.active{background:#26394f!important;border-color:#8aaac36e!important;color:#f7faff!important}
.studioSort{display:flex;gap:6px}
.studioStatus{display:none!important}
/* Media type switches are a quiet icon rail, rather than a second banner. */
.studioTop .mediaTabs{left:16px!important;top:114px!important;bottom:auto!important;gap:6px!important;width:54px!important;padding:6px!important;background:#0e141ebf!important;border:1px solid #ffffff13!important;border-radius:17px!important;box-shadow:0 20px 50px #0005!important;backdrop-filter:blur(20px)}
.studioTop .mediaTabs button{width:40px!important;min-width:40px!important;height:45px!important;min-height:45px!important;border-radius:11px!important;background:transparent!important;color:#8d9cae!important}
.studioTop .mediaTabs button.on{background:#27384d!important;color:#f1f6fd!important;box-shadow:inset 0 0 0 1px #9cbbe343!important}
.studioTop .mediaTabs button:hover{color:#f1f6ff!important;background:#182638!important}
.studioTopRight{left:22px!important;top:278px!important}
.studioTopRight #clipShelfTop{width:42px!important;height:42px!important;background:transparent!important;border:0!important;color:#8d9eaf!important}
.studioTopRight #clipShelfTop:hover{background:#1a293d!important;color:#e5efff!important}
/* Entrance: the imagery is the hero. Less prose, quiet hierarchy, generous rhythm. */
.studioEntrance{padding:29px 35px 0!important}
.studioRoomIntro{padding:0 0 24px!important;align-items:end}
.studioRoomIntro h2{font-size:clamp(27px,2.5vw,42px)!important;letter-spacing:-.065em!important;font-weight:440!important;margin:7px 0!important;line-height:1.2!important}
.studioRoomIntro p{font-size:11px!important;letter-spacing:.04em!important;color:#6e7e94!important}
.studioRoomCount{font-size:11px!important;color:#8092a7!important}
.studioRoomSection{margin-bottom:25px!important}.studioRoomSectionHead{margin:0 0 14px!important}.studioRoomSectionHead h3{font-size:14px!important;font-weight:580!important;letter-spacing:.015em!important}
.studioRoomSectionHead>span{font-size:11px!important;opacity:.65}
.studioRoomRow{gap:13px!important;padding:2px 2px 12px!important;scrollbar-color:#2c3b52 transparent}
.studioRoomTile{flex-basis:clamp(140px,12.5vw,210px)!important;aspect-ratio:9/13.25!important;border-radius:12px!important;border-color:#ffffff16!important;background:#141b26!important;box-shadow:0 10px 26px #0003}
.studioRoomTile:hover{transform:translateY(-4px)!important;box-shadow:0 18px 40px #0008!important;border-color:#c0d6ed83!important}
.studioRoomTile:focus-visible{outline-offset:3px}.studioRoomShade{inset:34% 0 0!important;background:linear-gradient(0deg,#05080ded,transparent 94%)!important}
.studioRoomCaption{padding:28px 12px 12px!important}.studioRoomCaption strong{font-size:12px!important;font-weight:510!important}.studioRoomCaption small{color:#acbacb!important}
.studioRoomPlay{background:#0c111c99!important;backdrop-filter:blur(10px)}
.studioLibraryHeading{margin:16px 0 5px!important;border-top:1px solid var(--v5-hairline);padding:20px 0 0}
#assetFolders{margin:0 35px!important;padding:11px 0 15px!important;gap:7px!important;border-color:var(--v5-hairline)!important}
#assetFolders button{border:1px solid transparent!important;background:transparent!important;color:#8d9bad!important;font-size:12px!important;border-radius:9px!important;padding:8px 11px!important;min-height:34px!important}
#assetFolders button.on{border-color:#627c9a55!important;background:#1e2b3a!important;color:#dbe9fa!important}
#assetFolders button:hover{color:#edf3fd!important;background:#192535!important}
#assetFolders .unifiedFolderNew{margin-left:auto;border-color:#ffffff19!important;background:#111a26!important}
#folderTiles.assetFolderTiles{padding:0 35px!important;margin:17px 0 0!important;gap:11px!important}
#folderTiles .unifiedFolderTile{min-width:178px;max-width:250px;position:relative;border-radius:11px;overflow:hidden}
#folderTiles .unifiedFolderTile>.folderEntry{min-width:178px!important;min-height:59px!important;padding:12px 40px 12px 14px!important;background:#111a27!important;border:1px solid #ffffff16!important;border-radius:11px!important;color:#d3dce8!important;font-weight:450!important;font-size:12px!important}
#folderTiles .unifiedFolderTile>.folderEntry:hover{background:#1b2a3b!important;border-color:#718faa6c!important}
#folderTiles .unifiedFolderMore{border-radius:8px!important;background:#182536aa!important;border:0!important;color:#93a4b6!important}
#folderContext{margin:12px 0 0!important;padding:0 35px!important;color:#708197!important;font-size:11px!important}
.grid{grid-template-columns:repeat(auto-fill,minmax(164px,1fr))!important;gap:14px!important;padding:22px 35px 90px!important}
.card{border:1px solid #ffffff15!important;border-radius:12px!important;background:#0f1620!important;box-shadow:0 12px 30px #0003!important}
.card:hover{transform:translateY(-3px)!important;border-color:#9cbce573!important;box-shadow:0 15px 36px #0009!important}
.coverWrap{aspect-ratio:9/13.4!important;background:#070a10!important}.card .body{padding:9px 11px 11px!important}
.card .titleText{font-weight:480!important;font-size:12px!important;color:#dfe8f4!important}.card .creatorText{color:#91a4bb!important}
.card .actions{margin-top:2px!important}.card .stars{opacity:.82}
.grid.pictureWall{padding:20px 35px 90px!important;column-gap:13px!important}
.pictureTile{background:#0d151e!important;border-color:#ffffff19!important;border-radius:12px!important;margin-bottom:13px!important;transition:transform .2s var(--v5-ease),border-color .2s}
.pictureTile:hover{transform:translateY(-2px);border-color:#a8c3dc8c!important}.pictureTile .photoTileName{color:#acbacb;font-size:11px}
.audioFileGrid{padding:20px 35px 90px!important;gap:10px!important}
.audioFileTile{background:#111923!important;border:1px solid #ffffff17!important;border-radius:11px!important;min-height:95px!important;transition:background .18s,border-color .18s}
.audioFileTile:hover{background:#1a293a!important;border-color:#92afca85!important}.audioFileTile.isActive{border-color:#a1bdde91!important;background:#1a2b3f!important}
.audioFileName{font-weight:520!important}.audioFileMeta{color:#7f90a8!important}
/* The video continues to occupy ALL view height; overlays float and fade. */
.feedOverlay,.feedScroller,.feedItem,.feedItem .videoStage{background:#020305!important}
.feedBackdrop{opacity:.42!important;filter:blur(83px) saturate(.85) brightness(.54)!important}
.feedHeader>.feedClose,.feedToolsToggle,.feedRailToggle,.feedRatingToggle{width:35px!important;min-width:35px!important;height:35px!important;min-height:35px!important;border-radius:11px!important;background:#080e18a1!important;border:1px solid #ffffff1a!important;color:#dde9f6!important;box-shadow:none!important;backdrop-filter:blur(13px)!important}
.feedHeader>.feedClose{left:18px!important;top:16px!important}.feedToolsToggle{right:18px!important;top:16px!important}.feedRatingToggle{right:18px!important;top:59px!important}.feedRailToggle{left:18px!important;top:59px!important}
.feedHeader>.feedClose:hover,.feedToolsToggle:hover,.feedRatingToggle:hover,.feedRailToggle:hover{background:#26394e!important;border-color:#9fb8ce65!important}
.feedHeader .feedHeaderActions{top:60px!important;right:18px!important;width:272px!important;max-height:calc(100dvh - 80px)!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important;padding:11px!important;border-radius:15px!important;border:1px solid #c6d4e52a!important;background:#0c131ddf!important;box-shadow:0 24px 70px #000b!important;backdrop-filter:blur(30px)!important}
.feedHeader .feedToolGroup,.feedHeader .feedToolGroup:last-child{display:contents!important}
.feedHeader .feedHeaderActions .feedTool{height:53px!important;min-height:53px!important;display:flex!important;flex-direction:row!important;justify-content:flex-start!important;gap:9px!important;align-items:center!important;padding:0 10px!important;border-radius:9px!important;border:1px solid transparent!important;background:#ffffff07!important;font-size:11px!important;color:#c0cedf!important;text-align:left!important}
.feedHeader .feedToolGlyph,.feedHeader .feedToolGlyph svg{flex:0 0 17px!important;width:17px!important;height:17px!important}
.feedHeader .feedToolLabel{font-size:11px!important;white-space:nowrap!important;font-weight:480!important}
.feedHeader .feedTool:hover:not(:disabled){background:#26394b!important;border-color:#ffffff22!important}
.feedHeader .feedTool.active,.feedHeader .feedTool.set{background:#263b53!important;border-color:#a2c5f255!important;color:#f1f6ff!important}
.feedHeader .feedToolGroupDanger .feedTool{color:#dda4b0!important;background:#c25a6410!important}
.feedHeader #feedDelete{grid-column:span 2}
.feedFilmstrip{left:17px!important;top:107px!important;bottom:25px!important;padding:7px!important;width:69px!important;gap:7px!important;background:#0a1018c7!important;border:1px solid #ffffff1a!important;border-radius:12px!important;box-shadow:0 16px 40px #0007!important}
.feedFilmTile{width:53px!important;height:77px!important;border-radius:7px!important;border-color:#ffffff22!important}.feedFilmTile.current{box-shadow:0 0 0 2px #c2dcfa58!important}
.feedItem > .feedDetails{background:#0c121cdd!important;border:1px solid #ffffff1c!important;border-radius:12px!important;backdrop-filter:blur(16px)!important;box-shadow:0 16px 45px #0009!important}
/* Modal language: subdued surfaces, visible hierarchy, no oversized empty rectangle. */
.clipShelfBack,.unifiedRenameBack,.unifiedMoveBack,.unifiedAlbumBack,.portraitDialogBack{background:#02050ad9!important;backdrop-filter:blur(19px)!important}
.clipShelf{width:min(980px,calc(100vw - 46px))!important;height:min(760px,calc(100dvh - 52px))!important;border-radius:17px!important;background:#101720!important;border:1px solid #ffffff22!important;box-shadow:0 35px 110px #000d!important}
.clipShelfHead{padding:21px 25px 16px!important;border-bottom:1px solid var(--v5-hairline)!important;background:#101720!important}
.clipShelfHead h2{font-size:20px!important;letter-spacing:-.045em!important;font-weight:540!important}
.clipShelfHead small{font-size:11px!important;color:#8998ab!important;margin-top:5px;display:block}
.clipShelfHead #clipShelfClose{border:0!important;background:#ffffff0c!important;color:#a9bacd!important;font-size:12px!important;padding:8px 12px!important}
.clipShelfToolbar{background:#111a26!important;border-bottom:1px solid var(--v5-hairline)!important;padding:13px 25px!important;gap:12px!important}
.clipShelfToolbar input[type=search]{height:40px!important;border-radius:10px!important;background:#0a111a!important;border:1px solid #ffffff1d!important;padding:0 13px!important;font-size:12px!important}
.clipShelfToolbar input[type=search]:focus{border-color:#83a8d0!important;outline:none}
.clipShelfToolbar label{font-size:11px!important;color:#8494a6!important}
.clipShelf button{background:#1a2634!important;border:1px solid #ffffff1e!important;color:#cfdbe9!important;border-radius:9px!important;padding:8px 11px!important;font-size:12px!important;font-weight:450!important}
.clipShelf button:hover:not(:disabled){background:#29394a!important;border-color:#7396b96a!important}
.clipShelf button.primary,#clipShelfNew:not(:disabled){background:#c6d8f2!important;border-color:#c6d8f2!important;color:#142134!important;font-weight:580!important}
.clipShelf button.warn{color:#e9a3af!important;background:transparent!important;border-color:transparent!important}
.clipShelfList{padding:21px 25px!important;scrollbar-color:#3d5065 transparent!important;background:radial-gradient(ellipse at 90% 0%,#1d2a3c47,transparent 60%)}
.clipShelfRow{grid-template-columns:80px minmax(0,1fr) auto!important;gap:14px!important;min-height:100px;padding:11px!important;border-radius:13px!important;background:#151e2b!important;border:1px solid #ffffff18!important;margin-bottom:10px!important;box-shadow:0 8px 20px #0002!important;transition:border-color .18s,transform .18s}
.clipShelfRow:hover{border-color:#8dadc350!important;transform:translateY(-1px)}
.clipShelfPoster{width:80px;height:78px;border-radius:8px;background:linear-gradient(140deg,#2c3d53,#09101b);overflow:hidden;display:grid;place-items:center;border:1px solid #ffffff1b;color:#93a9c4}
.clipShelfPoster img{width:100%;height:100%;object-fit:cover;display:block}.clipShelfPoster svg{width:26px;height:26px;stroke:currentColor;fill:none}
.clipShelfRowTitle{font-size:13px!important;font-weight:570!important;color:#e6edf8!important}.clipShelfRowInfo{font-size:11px!important;line-height:1.7!important;white-space:normal!important;color:#899db3!important}
.clipShelfRowActions{gap:6px!important;align-self:center}.clipShelfRowActions button{font-size:11px!important;padding:7px 9px!important}
.clipShelfForm{background:#141e2b!important;border-top:1px solid #ffffff16!important;padding:18px 25px!important}.clipShelfFormFields{grid-template-columns:minmax(145px,2fr) minmax(100px,1fr) minmax(100px,1fr)!important}
.clipShelfForm label{font-size:11px!important}.clipShelfForm input{height:39px!important;border-radius:9px!important}
.clipShelfEmpty{display:grid;place-items:center;min-height:240px;color:#7d90a6!important;font-size:12px!important}
.unifiedRenamePanel,.unifiedMovePanel,.portraitDialog,.shotStudio{background:#121b27!important;border:1px solid #ffffff22!important;border-radius:16px!important;box-shadow:0 32px 95px #000c!important}
.unifiedRenamePanel,.unifiedMovePanel{padding:26px!important;gap:15px!important}.unifiedRenamePanel h3,.unifiedMovePanel h3{font-weight:540!important;letter-spacing:-.025em;font-size:19px!important}
.unifiedRenamePanel p,.unifiedMovePanel p{font-size:11px!important;line-height:1.65;color:#91a2b7!important}
.unifiedRenameRow,.unifiedMovePanel input,.unifiedMovePanel select{background:#0c131e!important;border:1px solid #ffffff28!important;color:#f0f5ff!important;border-radius:9px!important}
.unifiedRenameRow:focus-within{border-color:#97b9e4!important}
.unifiedRenameButtons button,.unifiedMoveActions button{border-radius:9px!important;background:#223043!important;border:1px solid #ffffff22!important;color:#dce5ef!important;padding:9px 15px!important;font-weight:490!important}
.unifiedRenameButtons .primary,.unifiedMoveActions button[type=submit]{background:#c6dbf7!important;border-color:#c6dbf7!important;color:#172333!important}
.unifiedContext{background:#111b28ed!important;backdrop-filter:blur(20px)!important;border:1px solid #ffffff26!important;border-radius:12px!important;box-shadow:0 18px 60px #000a!important;padding:6px!important}
.unifiedContext button{border-radius:8px!important;color:#d6dfeb!important;font-weight:470!important;font-size:12px!important}
.unifiedBatchBar{background:#142030f1!important;border:1px solid #ffffff2c!important;border-radius:14px!important;backdrop-filter:blur(19px)!important;box-shadow:0 20px 55px #000a!important}
.audioDock{background:#0b111bf0!important;border-top:1px solid #ffffff18!important;backdrop-filter:blur(22px)!important;box-shadow:0 -12px 38px #0008!important}
.audioDock .audioIconBtn{border-color:#ffffff23!important;background:#152132!important;color:#d1ddec!important;border-radius:9px!important}
.audioDock .audioPlay{background:#dbe6f5!important;color:#122034!important}
.audioDock .audioSeek{height:4px!important}
.assetView{background:#020408f8!important}.photoDetailTop,.photoDetailBottom{backdrop-filter:blur(14px)}
/* All unneeded decoration stays out of the way on a rotated desktop display. */
@media(max-width:1100px){.studioHeader{padding-right:18px!important;gap:10px!important}.studioBrand{min-width:142px}.studioSort{gap:3px}.studioSearchWrap{max-width:none!important;min-width:145px!important}.studioEntrance{padding:23px 20px 0!important}.grid{padding:19px 20px 85px!important}.grid.pictureWall{padding:19px 20px 85px!important}#assetFolders{margin:0 20px!important}#folderTiles.assetFolderTiles{padding:0 20px!important}#folderContext{padding:0 20px!important}}
@media(max-width:700px){body{padding-left:58px!important}.studioHeader{min-height:60px!important;padding:9px 13px!important}.studioBrand{min-width:0!important;border:0;padding:0}.studioBrandText em{display:none}.studioWorkspace{flex:1!important}.studioControls{flex-wrap:wrap!important;gap:7px!important}.studioSearchWrap{max-width:none!important;flex:1 1 100%!important}.studioActions{width:100%;justify-content:flex-end}.studioTop .mediaTabs{left:7px!important;top:75px!important;width:45px!important;padding:3px!important}.studioTop .mediaTabs button{height:39px!important;min-height:39px!important;width:37px!important;min-width:37px!important}.studioTopRight{left:8px!important;top:225px!important}.studioEntrance{padding:20px 13px 0!important}.studioRoomIntro h2{font-size:27px!important}.studioRoomTile{flex-basis:140px!important}.grid{grid-template-columns:repeat(auto-fill,minmax(135px,1fr))!important;padding:15px 13px 80px!important}.grid.pictureWall{padding:15px 13px 80px!important}#assetFolders{margin:0 13px!important}#folderTiles.assetFolderTiles{padding:0 13px!important}#folderContext{padding:0 13px!important}.feedHeader .feedHeaderActions{width:246px!important;top:58px!important;right:10px!important}.clipShelf{width:100%!important;height:100dvh!important;border-radius:0!important}.clipShelfRow{grid-template-columns:65px minmax(0,1fr)!important}.clipShelfPoster{width:65px;height:76px}.clipShelfRowActions{grid-column:1/-1;justify-content:flex-start!important}.clipShelfToolbar{padding:12px!important}.clipShelfHead,.clipShelfList,.clipShelfForm{padding-left:13px!important;padding-right:13px!important}}
@media(max-height:450px){.feedHeader .feedHeaderActions{top:55px!important;max-height:calc(100dvh - 64px)!important}.feedFilmstrip{top:62px!important}.feedItem>.feedDetails{bottom:59px!important}}
@media(prefers-reduced-motion:reduce){.studioRoomTile,.studioRoomTile img,.card,.pictureTile,.clipShelfRow,button{transition:none!important}}

/* v5 visual QA: sticky header with backdrop-filter forms a fixed containing block.
   Position dock relative to that block so it never covers library content. */
.studioTop .mediaTabs{left:-70px!important}
.studioTopRight{left:-64px!important}
/* Photo and editor surfaces speak the same language as the library. */
.photoToolbar{padding:21px 35px 6px!important;background:transparent!important}
.photoToolbarHead strong{font-size:20px!important;letter-spacing:-.045em!important;font-weight:510!important;color:#dfe7f3!important}
.photoToolbarActions button{background:#141d2a!important;border:1px solid #ffffff1c!important;border-radius:9px!important;color:#b8c9dd!important;font-size:12px!important}
.photoZoomControl{color:#8190a3!important;font-size:11px!important}
.photoAlbumMosaic{border-radius:12px!important;background:#111c29!important;border:1px solid #ffffff1a!important;box-shadow:0 9px 22px #0004}
.photoAlbumName{font-size:12px!important;font-weight:540!important;color:#dce6f2!important}.photoAlbumCount{font-size:11px!important;color:#8194ad!important}
.photoDetailTop,.photoDetailBottom{background:#080d15b7!important;backdrop-filter:blur(18px)!important;border-color:#ffffff14!important}
.photoDetailTop{min-height:56px!important;padding:9px 17px!important}
.photoDetailTop button,.photoDetailActions button,.photoDetailBottom button{background:#18243599!important;border:1px solid #ffffff1a!important;border-radius:9px!important;color:#d7e4f5!important}
.photoDetailHeading #assetViewName{font-size:12px!important;font-weight:500!important}
.photoDetailBottom{padding:7px 12px 8px!important}
.shotStudioBack{background:#020408e8!important;backdrop-filter:blur(19px)!important}
.shotStudio{border:1px solid #ffffff24!important;background:#101823!important;border-radius:15px!important;box-shadow:0 30px 95px #000c!important}
.shotStudio button,.portraitDialog button{border-radius:9px!important}
.portraitDialog{background:#111b28!important;border-color:#ffffff25!important;border-radius:15px!important}
.portraitDialogTop h3{font-size:17px!important;font-weight:530!important}.portraitDialogTop p{color:#8d9aac!important;font-size:11px!important}
.portraitDialogActions button,.portraitPlayerBar button{background:#1b2a3a!important;border:1px solid #ffffff22!important;color:#dce7f6!important;border-radius:9px!important}
.portraitDialogActions .portraitSubmit{background:#c1d9f8!important;color:#152437!important;border-color:#c1d9f8!important}
.portraitStage{background:#030508!important;border-radius:11px!important}
.unifiedBatchBar button{border-radius:8px!important;font-weight:480!important}
.unifiedContext .studioMenuRow{min-height:39px!important;font-size:12px!important;gap:10px!important;padding:8px 10px!important}
.unifiedContext .studioMenuRow:hover{background:#26384c!important}
#unifiedToast{border-radius:10px!important;background:#19293cee!important;backdrop-filter:blur(20px)!important}
@media(max-width:700px){.studioTop .mediaTabs{left:-52px!important}.studioTopRight{left:-50px!important}.photoToolbar{padding:17px 13px 7px!important}}


/* ========================================================================
   影格 Studio v6 / CRYSTAL IMMERSIVE
   Glass is a translucent, light-sensitive overlay — never a solid panel.
   Keep established IDs, click handlers, safety and media APIs unchanged.
   ======================================================================== */
:root {
  --cr-ink:#edf4ff;--cr-sub:#a4b8d1;--cr-dim:#7588a2;
  --cr-line:rgba(232,244,255,.26);--cr-hair:rgba(220,236,255,.105);
  --cr-rim:inset 0 1px 0 rgba(255,255,255,.29), inset 1px 0 0 rgba(255,255,255,.085), inset 0 -1px 0 rgba(123,157,210,.07);
  --cr-glass:linear-gradient(155deg,rgba(164,203,246,.23) 0%,rgba(41,66,105,.29) 24%,rgba(7,16,30,.43) 78%,rgba(13,24,45,.37) 100%);
  --cr-deep:linear-gradient(145deg,rgba(95,133,180,.39),rgba(14,27,47,.60) 39%,rgba(8,16,30,.62));
  --cr-shadow:0 22px 70px rgba(0,0,0,.50),0 4px 20px rgba(1,8,20,.25);
  --cr-blur:blur(35px) saturate(165%);
  --cr-ease:cubic-bezier(.2,.72,.21,1);
}
html{color-scheme:dark}
body{
  background:
   radial-gradient(ellipse 46% 48% at 98% 9%,rgba(42,94,165,.26),transparent 75%),
   radial-gradient(ellipse 32% 27% at 8% 70%,rgba(70,93,134,.18),transparent 78%),
   linear-gradient(123deg,#060a11 12%,#0b1322 65%,#080e19 100%)!important;
  color:var(--cr-ink)!important;
}
/* The library shell. Only controls float; the video itself never inherits this chrome. */
.studioHeader{
  background:linear-gradient(108deg,rgba(23,36,58,.53),rgba(10,18,32,.56))!important;
  border-bottom:1px solid rgba(239,247,255,.16)!important;
  box-shadow:var(--cr-rim),0 12px 36px rgba(0,0,0,.15)!important;
  -webkit-backdrop-filter:blur(35px) saturate(160%)!important;
  backdrop-filter:blur(35px) saturate(160%)!important;
}
.studioBrand{border-right-color:rgba(231,245,255,.12)!important}
.studioMark{
  background:linear-gradient(140deg,rgba(151,197,244,.25),rgba(12,30,61,.36))!important;
  border:1px solid rgba(228,244,255,.35)!important;
  box-shadow:inset 0 1px 0 #ffffff63,0 6px 16px #0005!important;
}
.studioBrandText strong{color:#f2f8ff!important}
.studioSearchWrap{
  background:linear-gradient(120deg,rgba(100,138,184,.16),rgba(15,26,44,.32))!important;
  border:1px solid rgba(224,242,255,.21)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 5px 20px rgba(0,0,0,.12)!important;
  -webkit-backdrop-filter:blur(25px) saturate(150%)!important;
  backdrop-filter:blur(25px) saturate(150%)!important;
}
.studioSearchWrap:focus-within{
  background:rgba(42,70,111,.37)!important;
  border-color:rgba(170,215,255,.68)!important;
  box-shadow:inset 0 1px 0 #ffffff4a,0 0 0 3px #8cc5ff19!important;
}
.studioActions button,.photoToolbarActions button{
  background:linear-gradient(150deg,rgba(103,144,196,.10),rgba(14,25,44,.23))!important;
  border:1px solid rgba(225,240,255,.18)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.13)!important;
  -webkit-backdrop-filter:blur(12px)!important;backdrop-filter:blur(12px)!important;
}
.studioActions button:hover:not(:disabled),.photoToolbarActions button:hover:not(:disabled){
  background:rgba(123,165,222,.21)!important;border-color:rgba(198,226,255,.42)!important;
}
.studioActions button.active{
  background:linear-gradient(160deg,rgba(144,194,246,.27),rgba(47,86,141,.17))!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 0 17px rgba(86,153,231,.13)!important;
  border-color:rgba(192,224,255,.58)!important;
}
.studioTop .mediaTabs{
  background:var(--cr-glass)!important;border:1px solid rgba(229,241,255,.27)!important;
  box-shadow:var(--cr-rim),var(--cr-shadow)!important;
  backdrop-filter:var(--cr-blur)!important;-webkit-backdrop-filter:var(--cr-blur)!important;
  border-radius:19px!important;
}
.studioTop .mediaTabs button.on{
  background:linear-gradient(150deg,rgba(171,210,248,.36),rgba(77,124,185,.24))!important;
  color:#f7fbff!important;
  box-shadow:inset 0 1px 0 #ffffff6c,inset 0 0 0 1px #c9e6ff3a,0 0 20px #6aace52e!important;
}
.studioTop .mediaTabs button:hover:not(.on){background:rgba(161,200,247,.13)!important}
.studioTopRight #clipShelfTop:hover{background:rgba(180,213,255,.16)!important}
/* Give content room without introducing a management dashboard. */
.studioRoomIntro h2{font-weight:370!important;color:#f1f5ff!important}
.studioRoomIntro p,.studioRoomCount{color:var(--cr-sub)!important}
.studioRoomSectionHead h3{font-weight:490!important;color:#e8f1ff!important}
.studioRoomRow{gap:16px!important}
.studioRoomTile{
  background:linear-gradient(145deg,rgba(40,69,106,.31),rgba(4,11,24,.39))!important;
  border:1px solid rgba(224,240,255,.23)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 12px 30px #0005!important;
  border-radius:15px!important;
}
.studioRoomTile:hover{
  border-color:rgba(223,242,255,.81)!important;
  box-shadow:inset 0 1px 0 #ffffff9e,0 20px 48px #000a,0 0 24px #85baf133!important;
}
.studioRoomShade{background:linear-gradient(0deg,rgba(2,7,15,.91),transparent 90%)!important}
.studioRoomPlay{background:rgba(28,46,75,.33)!important;border:1px solid #ffffff86!important;backdrop-filter:blur(15px) saturate(160%)!important}
#assetFolders{border-color:rgba(223,240,255,.14)!important}
#assetFolders button.on{background:rgba(131,177,234,.17)!important;border-color:rgba(197,226,255,.33)!important}
#assetFolders .unifiedFolderNew{background:rgba(101,141,195,.075)!important;border-color:rgba(215,235,255,.22)!important}
#folderTiles .unifiedFolderTile>.folderEntry{
  background:linear-gradient(128deg,rgba(87,129,186,.18),rgba(13,24,43,.35))!important;
  border:1px solid rgba(220,238,255,.27)!important;
  box-shadow:var(--cr-rim),0 8px 22px #0004!important;
  -webkit-backdrop-filter:blur(20px) saturate(155%)!important;
  backdrop-filter:blur(20px) saturate(155%)!important;
  border-radius:12px!important;
}
#folderTiles .unifiedFolderTile>.folderEntry:hover{background:rgba(110,159,216,.23)!important;border-color:rgba(210,237,255,.6)!important}
#folderTiles .unifiedFolderMore{background:rgba(255,255,255,.065)!important}
.card,.pictureTile,.audioFileTile,.photoAlbumMosaic{
  background:linear-gradient(144deg,rgba(68,106,148,.17),rgba(9,18,34,.42))!important;
  border:1px solid rgba(220,237,255,.20)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.11),0 10px 26px rgba(0,0,0,.26)!important;
  border-radius:13px!important;overflow:hidden;
}
.card:hover,.pictureTile:hover,.audioFileTile:hover,.photoAlbumMosaic:hover{
  border-color:rgba(223,240,255,.63)!important;
  box-shadow:inset 0 1px 0 #ffffff55,0 18px 35px #0007,0 0 20px #8dc6ff22!important;
}
.card .body{background:linear-gradient(180deg,rgba(17,29,50,.16),rgba(10,21,39,.35))!important}
.audioFileTile.isActive{background:linear-gradient(145deg,#80baff34,#172c4670)!important;border-color:#b5dbff80!important}
/* Player: zero fixed header, no permanent file list; light must pass through controls. */
.feedOverlay,.feedScroller,.feedItem,.feedItem .videoStage{background:#010203!important}
.feedBackdrop{opacity:.60!important;filter:blur(72px) brightness(.69) saturate(1.25)!important}
.feedHeader{height:0!important;min-height:0!important;background:none!important;backdrop-filter:none!important;pointer-events:none!important}
.feedHeader>.feedClose,.feedToolsToggle,.feedRailToggle,.feedRatingToggle{
  background:linear-gradient(145deg,rgba(111,156,211,.19),rgba(7,15,28,.38))!important;
  border:1px solid rgba(232,246,255,.35)!important;
  border-radius:50%!important;
  box-shadow:var(--cr-rim),0 6px 20px #0006!important;
  backdrop-filter:blur(24px) saturate(170%)!important;
  -webkit-backdrop-filter:blur(24px) saturate(170%)!important;
}
.feedHeader>.feedClose:hover,.feedToolsToggle:hover,.feedRailToggle:hover,.feedRatingToggle:hover{
  background:rgba(160,203,248,.30)!important;border-color:rgba(240,249,255,.7)!important;transform:translateY(-1px);
}
.feedOverlay.toolsOpen .feedToolsToggle,.feedOverlay.infoVisible .feedRatingToggle,.feedOverlay.railOpen .feedRailToggle{
  background:rgba(133,183,236,.27)!important;
  border-color:rgba(223,243,255,.66)!important;
  box-shadow:var(--cr-rim),0 0 22px #85bcff30!important;
}
.feedHeader .feedHeaderActions{
  top:61px!important;right:18px!important;
  width:290px!important;max-height:calc(100dvh - 78px)!important;
  padding:10px!important;gap:5px!important;
  grid-template-columns:repeat(2,minmax(0,1fr))!important;
  border-radius:19px!important;
  background:var(--cr-glass)!important;
  border:1px solid rgba(234,247,255,.40)!important;
  box-shadow:var(--cr-rim),0 29px 80px #0009,0 0 28px #abcfff13!important;
  -webkit-backdrop-filter:blur(38px) saturate(175%)!important;
  backdrop-filter:blur(38px) saturate(175%)!important;
}
.feedHeader .feedToolGroup,.feedHeader .feedToolGroup:last-child{display:contents!important}
.feedHeader .feedHeaderActions .feedTool{
  height:41px!important;min-height:41px!important;
  padding:0 10px!important;gap:8px!important;
  background:rgba(210,233,255,.035)!important;
  color:#e1eefa!important;border:1px solid rgba(231,244,255,.09)!important;
  border-radius:10px!important;box-shadow:inset 0 1px 0 #ffffff0c!important;
  font-size:11px!important;line-height:1.2!important;
}
.feedHeader .feedToolGlyph,.feedHeader .feedToolGlyph svg{width:17px!important;height:17px!important;flex-basis:17px!important;opacity:.85}
.feedHeader .feedToolLabel{font-size:11px!important;font-weight:460!important;letter-spacing:.015em!important}
.feedHeader #feedSetA,.feedHeader #feedSetB{gap:8px!important}
.feedHeader #feedSetA::before,.feedHeader #feedSetB::before{
  content:'';display:block;flex:0 0 17px;width:17px;height:17px;
  background:linear-gradient(90deg,transparent 6px,#b9d9ff 6px,#b9d9ff 8px,transparent 8px),radial-gradient(circle at 7px 8px,#eaf7ff 0 3px,transparent 3.5px);
  opacity:.85;
}
.feedHeader .feedTool:hover:not(:disabled){background:rgba(153,197,246,.20)!important;border-color:rgba(225,242,255,.40)!important;color:white!important}
.feedHeader .feedTool.active,.feedHeader .feedTool.set,.feedHeader .feedTool.done{
  background:linear-gradient(140deg,rgba(136,190,247,.29),rgba(52,94,157,.16))!important;
  color:#fff!important;border-color:rgba(220,242,255,.62)!important;
  box-shadow:inset 0 1px 0 #ffffff38,0 0 13px #7ebdff26!important;
}
.feedHeader #feedDelete{grid-column:span 2;height:35px!important;min-height:35px!important;justify-content:center!important;background:rgba(142,59,79,.07)!important;color:#efb6c0!important}
.feedHeader #feedDelete:hover{background:rgba(194,88,111,.18)!important;border-color:#ffb1c866!important}
.feedFilmstrip{
  background:linear-gradient(150deg,rgba(97,135,182,.17),rgba(5,15,30,.46))!important;
  border:1px solid rgba(228,243,255,.35)!important;
  border-radius:16px!important;
  box-shadow:var(--cr-rim),var(--cr-shadow)!important;
  -webkit-backdrop-filter:blur(32px) saturate(160%)!important;
  backdrop-filter:blur(32px) saturate(160%)!important;
}
.feedFilmTile.current{box-shadow:0 0 0 2px #dcf2ffbb,0 0 15px #a0cfff42!important}
.feedItem>.feedDetails{
  background:linear-gradient(125deg,rgba(80,122,174,.20),rgba(9,18,36,.52))!important;
  border:1px solid rgba(237,247,255,.25)!important;
  border-radius:12px!important;
  -webkit-backdrop-filter:blur(25px) saturate(160%)!important;
  backdrop-filter:blur(25px) saturate(160%)!important;
  box-shadow:var(--cr-rim),0 15px 35px #0007!important;
}
/* Every dialog shares the same material and edge lighting. */
.clipShelfBack,.unifiedRenameBack,.unifiedMoveBack,.unifiedAlbumBack,.portraitDialogBack,.shotStudioBack{
  background:rgba(2,7,15,.42)!important;
  -webkit-backdrop-filter:blur(19px) saturate(120%)!important;
  backdrop-filter:blur(19px) saturate(120%)!important;
}
.clipShelf,.unifiedRenamePanel,.unifiedMovePanel,.portraitDialog,.shotStudio{
  background:var(--cr-deep)!important;
  border:1px solid rgba(230,245,255,.37)!important;
  border-radius:20px!important;
  box-shadow:var(--cr-rim),0 36px 115px #000b,0 0 35px #97ccff0d!important;
  -webkit-backdrop-filter:blur(45px) saturate(175%)!important;
  backdrop-filter:blur(45px) saturate(175%)!important;
}
.clipShelf{height:min(700px,calc(100dvh - 72px))!important;width:min(930px,calc(100vw - 64px))!important}
.clipShelfHead,.clipShelfToolbar,.clipShelfForm{
  background:rgba(255,255,255,.025)!important;
  border-color:rgba(224,241,255,.15)!important;
}
.clipShelfHead{padding:20px 22px 14px!important}
.clipShelfToolbar{padding:12px 22px!important}
.clipShelfHead h2{font-weight:500!important;color:#f0f6ff!important}
.clipShelfToolbar input[type=search],.clipShelfForm input,.unifiedRenameRow,.unifiedMovePanel input,.unifiedMovePanel select{
  background:rgba(2,10,23,.28)!important;
  border:1px solid rgba(222,239,255,.24)!important;
  box-shadow:inset 0 1px 0 #ffffff0b!important;
  border-radius:11px!important;
}
.clipShelfList{background:transparent!important;padding:16px 22px!important}
.clipShelfRow{
  background:linear-gradient(130deg,rgba(122,166,219,.115),rgba(9,21,41,.26))!important;
  border:1px solid rgba(224,241,255,.22)!important;
  box-shadow:inset 0 1px 0 #ffffff1f,0 7px 21px #0003!important;
  border-radius:13px!important;
}
.clipShelfRow:hover{background:rgba(134,183,234,.17)!important;border-color:rgba(222,244,255,.53)!important}
.clipShelf button,.unifiedRenameButtons button,.unifiedMoveActions button,.portraitDialogActions button,.shotStudio button{
  background:rgba(175,211,250,.085)!important;
  border:1px solid rgba(233,246,255,.22)!important;
  border-radius:10px!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12)!important;
  color:#e2eefb!important;
}
.clipShelf button:hover:not(:disabled),.unifiedRenameButtons button:hover,.unifiedMoveActions button:hover{
  background:rgba(163,205,253,.22)!important;border-color:rgba(230,246,255,.48)!important;
}
.clipShelf button.primary,#clipShelfNew:not(:disabled),.unifiedRenameButtons .primary,.unifiedMoveActions button[type=submit],.portraitDialogActions .portraitSubmit{
  background:linear-gradient(150deg,rgba(208,234,255,.86),rgba(148,192,240,.70))!important;
  color:#11223a!important;border-color:rgba(247,253,255,.80)!important;
  box-shadow:inset 0 1px 0 white,0 6px 17px #75b8ee20!important;
}
.clipShelf button.warn{background:transparent!important;color:#e8aeb8!important;border-color:transparent!important}
.unifiedContext{
  background:var(--cr-deep)!important;
  border:1px solid rgba(239,250,255,.37)!important;
  box-shadow:var(--cr-rim),var(--cr-shadow)!important;
  -webkit-backdrop-filter:blur(36px) saturate(175%)!important;
  backdrop-filter:blur(36px) saturate(175%)!important;
  border-radius:14px!important;
}
.unifiedContext .studioMenuRow:hover{background:rgba(154,202,250,.19)!important}
.unifiedBatchBar,.audioDock{
  background:var(--cr-glass)!important;border-color:rgba(229,243,255,.25)!important;
  box-shadow:var(--cr-rim),0 13px 44px #0007!important;
  -webkit-backdrop-filter:blur(33px) saturate(160%)!important;
  backdrop-filter:blur(33px) saturate(160%)!important;
}
.audioDock .audioIconBtn,.photoDetailTop button,.photoDetailActions button,.photoDetailBottom button{
  background:rgba(173,210,252,.10)!important;border:1px solid rgba(224,243,255,.30)!important;
  box-shadow:inset 0 1px 0 #ffffff27!important;
}
.audioDock .audioPlay{background:linear-gradient(145deg,#e4f4ff,#9bbce8)!important;color:#0f2338!important}
.photoDetailTop,.photoDetailBottom{
  background:linear-gradient(145deg,rgba(82,112,159,.20),rgba(5,11,23,.45))!important;
  border-color:rgba(224,238,255,.18)!important;
  -webkit-backdrop-filter:blur(30px) saturate(170%)!important;
  backdrop-filter:blur(30px) saturate(170%)!important;
}
#unifiedToast{
  background:var(--cr-deep)!important;
  border:1px solid rgba(232,244,255,.28)!important;
  box-shadow:var(--cr-rim),0 18px 45px #0007!important;
  -webkit-backdrop-filter:blur(22px) saturate(170%)!important;
  backdrop-filter:blur(22px) saturate(170%)!important;
}
@media(max-width:700px){
 .clipShelf{width:calc(100vw - 20px)!important;height:calc(100dvh - 20px)!important;border-radius:17px!important}
 .feedHeader .feedHeaderActions{right:10px!important;max-width:calc(100vw - 20px)!important}
}
@media(max-height:450px){.feedHeader .feedHeaderActions{top:55px!important;max-height:calc(100dvh - 65px)!important}}
@media(prefers-reduced-motion:reduce){.studioRoomTile,.feedTool,.clipShelfRow{transition:none!important}}
/* When a portrait video is letterboxed, its blurred cover supplies atmospheric
   light in the side gutters. Mask its center so source pixels stay untouched.
   This does not alter the video canvas, aspect ratio or playback transforms. */
@media(orientation:landscape){
  .feedItem .feedBackdrop{
    z-index:2!important;
    pointer-events:none!important;
    opacity:.37!important;
    -webkit-mask-image:linear-gradient(90deg,#000 0%,#000 24%,transparent 37%,transparent 63%,#000 76%,#000 100%);
    mask-image:linear-gradient(90deg,#000 0%,#000 24%,transparent 37%,transparent 63%,#000 76%,#000 100%);
  }
}
@media(orientation:portrait){.feedItem .feedBackdrop{z-index:0!important}}
/* Keep this overrides block LAST, after older release rules, to avoid v5 specificity fights. */


/* ===========================================================
   影格 Studio v6.1 · 把内容、留白和晶透层次还给使用者
   =========================================================== */
:root{
 --cr-glass:linear-gradient(130deg,rgba(164,207,249,.13),rgba(56,99,151,.14) 38%,rgba(9,20,38,.24) 100%);
 --cr-deep:linear-gradient(145deg,rgba(125,170,217,.20),rgba(15,31,53,.35) 57%,rgba(7,18,34,.32));
 --cr-line:rgba(225,243,255,.31);
 --cr-rim:inset 0 1px 0 rgba(255,255,255,.35),inset 1px 0 0 rgba(255,255,255,.09),inset 0 -1px 0 rgba(160,201,253,.12);
}
/* Clean continuous top bar; no brand split, extra rules or stacked plate effect. */
.studioHeader{
 border:0!important;border-bottom:1px solid rgba(215,239,255,.12)!important;
 background:linear-gradient(110deg,rgba(17,35,56,.24),rgba(8,18,33,.21))!important;
 box-shadow:inset 0 1px 0 rgba(239,249,255,.11)!important;
 -webkit-backdrop-filter:blur(32px) saturate(155%)!important;
 backdrop-filter:blur(32px) saturate(155%)!important;
}
.studioBrand{border-right:0!important;padding-right:4px!important;min-width:175px!important}
.studioTop{border:0!important;box-shadow:none!important}
.studioWorkspace{border:0!important;box-shadow:none!important}
.studioSearchWrap{
 background:rgba(77,117,172,.095)!important;
 border:1px solid rgba(225,240,255,.18)!important;
 box-shadow:inset 0 1px 0 #ffffff1b!important;
}
.studioActions button,.photoToolbarActions button{
 background:rgba(125,170,218,.065)!important;
 border:1px solid rgba(224,242,255,.14)!important;
 box-shadow:inset 0 1px 0 #ffffff12!important;
}
.studioActions button.active{background:rgba(128,174,226,.18)!important}
/* Every navigation glyph is centered by geometry rather than the text baseline. */
.studioTop .mediaTabs{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;padding:7px 5px!important;gap:8px!important}
.studioTop .mediaTabs button{display:grid!important;place-items:center!important;flex:0 0 auto!important;line-height:1!important;text-align:center!important;justify-items:center!important;align-items:center!important;padding:0!important}
.studioTop .mediaTabs .studioTabIcon{display:grid!important;place-items:center!important;margin:0 auto!important;flex:none!important;width:24px!important;height:24px!important}
.studioTop .mediaTabs .studioTabIcon svg{display:block!important;width:23px!important;height:23px!important;margin:auto!important}
.studioTopRight #clipShelfTop{display:grid!important;place-items:center!important;padding:0!important}
.studioTopRight .studioTopActionIcon{display:grid!important;place-items:center!important;margin:auto!important}
/* Crystal, not painted opaque blue. */
.studioTop .mediaTabs,.feedFilmstrip,.feedHeader .feedHeaderActions,
.clipShelf,.unifiedRenamePanel,.unifiedMovePanel,.portraitDialog,.shotStudio,
.unifiedContext,.unifiedBatchBar,.audioDock{
 background:var(--cr-glass)!important;
 border:1px solid rgba(233,247,255,.33)!important;
 box-shadow:var(--cr-rim),0 16px 46px rgba(0,0,0,.28)!important;
 -webkit-backdrop-filter:blur(34px) saturate(170%)!important;
 backdrop-filter:blur(34px) saturate(170%)!important;
}
.feedHeader .feedHeaderActions{background:var(--cr-deep)!important}
.feedHeader .feedHeaderActions .feedTool{
 background:rgba(188,220,255,.036)!important;
 border:1px solid rgba(229,244,255,.075)!important;
 box-shadow:inset 0 1px 0 rgba(255,255,255,.08)!important;
}
.feedHeader .feedHeaderActions .feedTool:hover{background:rgba(168,216,255,.14)!important}
.feedFilmstrip{background:linear-gradient(130deg,rgba(106,148,198,.16),rgba(9,18,31,.24))!important}
.feedHeader>.feedClose,.feedRailToggle,.feedToolsToggle,.feedRatingToggle{
 background:rgba(29,55,84,.20)!important;
 border-color:rgba(227,242,255,.36)!important;
 -webkit-backdrop-filter:blur(20px) saturate(165%)!important;
 backdrop-filter:blur(20px) saturate(165%)!important;
}
/* Separate top-left close and filmstrip-toggle controls; avoid crowded targets. */
.feedHeader>.feedClose{top:17px!important;left:20px!important}
.feedRailToggle{top:84px!important;left:20px!important}
.feedFilmstrip{top:142px!important;bottom:17px!important}
.feedFilmTile{border-color:rgba(232,245,255,.21)!important;background:rgba(100,154,208,.10)!important}
/* File name / creator first, rating in its own line. */
.feedItem>.feedDetails{
 display:flex!important;flex-direction:column!important;align-items:stretch!important;
 gap:7px!important;width:min(330px,calc(100vw - 40px))!important;
 background:linear-gradient(135deg,rgba(87,131,180,.14),rgba(9,19,36,.31))!important;
}
.feedItem>.feedDetails>.feedInfo{
 flex:0 1 auto!important;max-width:100%!important;width:100%!important;
}
.feedItem>.feedDetails>.feedRating{
 border:0!important;border-top:1px solid rgba(229,244,255,.19)!important;
 padding:7px 0 0!important;min-width:0!important;width:100%!important;
 justify-content:flex-start!important;
}
.clipShelfRow{background:rgba(134,179,223,.09)!important}
.clipShelfHead,.clipShelfToolbar,.clipShelfForm{background:rgba(158,203,250,.04)!important}
@media(max-height:490px){
 .feedRailToggle{top:17px!important;left:86px!important}
 .feedFilmstrip{top:67px!important}
}
@media(max-width:700px){
 .studioBrand{min-width:0!important}
 .studioTop .mediaTabs{padding:6px 4px!important}
 .feedHeader>.feedClose{left:12px!important}
 .feedRailToggle{left:12px!important}
}
\n/* Yingge v6.2: behavior-led correction. Do not alter media APIs. */
.studioTop .mediaTabs{
 box-sizing:border-box!important;width:60px!important;left:20px!important;
 padding:8px!important;gap:9px!important;align-items:center!important;
 justify-content:flex-start!important;
}
.studioTop .mediaTabs > button,.studioTop .mediaTabs > #clipShelfTop{
 box-sizing:border-box!important;width:42px!important;height:46px!important;
 min-width:42px!important;min-height:46px!important;
 flex:0 0 46px!important;display:flex!important;align-items:center!important;
 justify-content:center!important;position:relative!important;
 line-height:0!important;font-size:0!important;padding:0!important;margin:0!important;
 vertical-align:middle!important;transform:none!important;gap:0!important;
}
.studioTop .mediaTabs > button .studioTabIcon,
.studioTop .mediaTabs > #clipShelfTop .studioTopActionIcon{
 display:flex!important;align-items:center!important;justify-content:center!important;
 width:24px!important;height:24px!important;min-width:24px!important;
 margin:0!important;padding:0!important;line-height:0!important;vertical-align:middle!important;
}
.studioTop .mediaTabs > button svg,
.studioTop .mediaTabs > #clipShelfTop svg{
 display:block!important;width:23px!important;height:23px!important;
 flex:0 0 23px!important;margin:0!important;position:static!important;
}
.studioTop .mediaTabs > #clipShelfTop{
 background:transparent!important;border:0!important;box-shadow:none!important;
 color:#97b4d2!important;border-radius:11px!important;
}
.studioTop .mediaTabs > #clipShelfTop:hover{background:#a2c8ef22!important;color:#fff!important}
.studioTopRight{display:none!important}
@media(max-width:700px){.studioTop .mediaTabs{left:9px!important;top:76px!important;width:51px!important;padding:6px!important;gap:5px!important}.studioTop .mediaTabs > button,.studioTop .mediaTabs > #clipShelfTop{width:37px!important;min-width:37px!important;height:42px!important;min-height:42px!important;flex-basis:42px!important}}
/* A cover-seek control must never float above the card action row on keyboard focus. */
.card > .coverSeek{display:none!important;position:relative!important;inset:auto!important;z-index:0!important;opacity:1!important;pointer-events:auto!important;margin:0!important}
.card:has(> .coverWrap:hover) > .coverSeek,
.card > .coverSeek:hover,.card > .coverSeek:focus-within{display:block!important}
.card > .body{position:relative!important;z-index:2!important}
/* SVG center is independent of invisible button label nodes. */
.studioTop .mediaTabs > button .studioTabIcon,
.studioTop .mediaTabs > #clipShelfTop .studioTopActionIcon{
 position:absolute!important;inset:0!important;box-sizing:border-box!important;
 display:grid!important;place-items:center!important;width:100%!important;height:100%!important;
}
.studioTop .mediaTabs > button .studioTabIcon svg,
.studioTop .mediaTabs > #clipShelfTop .studioTopActionIcon svg{
 position:static!important;display:block!important;margin:auto!important;
}
/* Four corners: identical 42px buttons, symmetrical 10px gaps. */
.feedHeader>.feedClose,.feedRailToggle,.feedToolsToggle,.feedRatingToggle{
 box-sizing:border-box!important;position:fixed!important;display:grid!important;
 width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;
 padding:0!important;place-items:center!important;border-radius:50%!important;
 transform:none!important;
}
.feedHeader>.feedClose{left:20px!important;right:auto!important;top:20px!important}
.feedRailToggle{left:20px!important;right:auto!important;top:72px!important}
.feedToolsToggle{right:20px!important;left:auto!important;top:20px!important}
.feedRatingToggle{right:20px!important;left:auto!important;top:72px!important}
.feedHeader>.feedClose svg,.feedRailToggle svg,.feedToolsToggle svg,.feedRatingToggle svg{display:block!important;width:20px!important;height:20px!important;min-width:20px!important;min-height:20px!important;margin:auto!important}
/* Never hide the enclosing header's interaction layer while focus is active. */
.feedOverlay.focusImmersive.chromeHidden .feedHeader{opacity:1!important;transform:none!important;pointer-events:none!important}
.feedOverlay.focusImmersive.chromeHidden.toolsOpen .feedToolsToggle,
.feedOverlay.focusImmersive.chromeHidden.infoVisible .feedRatingToggle,
.feedOverlay.focusImmersive.chromeHidden.railOpen .feedRailToggle{opacity:1!important;pointer-events:auto!important}
/* Lightweight icon-only tool palette: accessible labels are still in title/ARIA. */
.feedHeader .feedHeaderActions{
 box-sizing:border-box!important;top:123px!important;right:20px!important;
 width:244px!important;max-width:calc(100vw - 40px)!important;
 grid-template-columns:repeat(4,minmax(0,1fr))!important;
 gap:6px!important;padding:10px!important;
 max-height:calc(100dvh - 140px)!important;
 border-radius:17px!important;
}
.feedHeader .feedHeaderActions .feedTool{
 display:flex!important;flex-direction:column!important;align-items:center!important;
 justify-content:center!important;width:100%!important;min-width:0!important;
 height:48px!important;min-height:48px!important;padding:0!important;gap:0!important;
 border-radius:11px!important;
}
.feedHeader .feedToolGlyph{display:flex!important;align-items:center!important;justify-content:center!important;width:22px!important;height:22px!important;flex:0 0 22px!important}
.feedHeader .feedToolGlyph svg{width:22px!important;height:22px!important;flex:0 0 22px!important}
.feedHeader .feedToolLabel{display:none!important}
.feedHeader #feedSetA::before,.feedHeader #feedSetB::before{content:none!important;display:none!important}
.feedHeader #feedSetA .feedToolLabel,.feedHeader #feedSetB .feedToolLabel{
 display:block!important;font:600 19px/1 ui-monospace,Consolas,monospace!important;letter-spacing:0!important;
}
.feedHeader #feedSetA .feedToolLabel{font-size:0!important}
.feedHeader #feedSetB .feedToolLabel{font-size:0!important}
.feedHeader #feedSetA .feedToolLabel::after{content:'A'!important;font-size:19px!important}
.feedHeader #feedSetB .feedToolLabel::after{content:'B'!important;font-size:19px!important}
.feedHeader #feedDelete{grid-column:auto!important;height:48px!important;min-height:48px!important;padding:0!important}
.feedHeader .feedToolGroupDanger .feedTool{color:#e4a5b4!important}
/* Standalone rating popup cannot be clipped by a scrolling feed. */
.feedOverlay.infoVisible .feedItem.studioCurrent > .feedDetails{opacity:0!important;visibility:hidden!important;pointer-events:none!important}
.studioRatingDock{
 position:fixed;right:20px;top:123px;z-index:95;box-sizing:border-box;
 width:230px;max-width:calc(100vw - 40px);padding:14px 15px 13px;
 border:1px solid #dfefff60;border-radius:15px;
 background:linear-gradient(135deg,#6fa9d12b,#09172b72);
 box-shadow:inset 0 1px 0 #fff5,0 14px 45px #0008;
 backdrop-filter:blur(30px) saturate(155%);-webkit-backdrop-filter:blur(30px) saturate(155%);
 pointer-events:auto;
}
.studioRatingDock[hidden]{display:none!important}
.studioRatingDockName{color:#dceaff;font-size:12px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;padding-bottom:10px;border-bottom:1px solid #ffffff28}
.studioRatingDock .feedRating{position:relative!important;inset:auto!important;display:flex!important;align-items:center;justify-content:flex-start;width:100%!important;max-width:none!important;margin-top:10px!important;padding:0!important;background:none!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important;touch-action:none}
.studioRatingDock .ratingStar{width:29px!important;height:29px!important;font-size:25px!important;line-height:29px!important;flex:0 0 29px}
.studioRatingDock .ratingValue{margin-left:auto!important;font-size:12px!important;color:#c5d5e9}
@media(max-height:490px){
 .feedHeader>.feedClose{left:14px!important;top:14px!important}
 .feedRailToggle{left:66px!important;top:14px!important}
 .feedToolsToggle{right:14px!important;top:14px!important}
 .feedRatingToggle{right:66px!important;top:14px!important}
 .feedHeader .feedHeaderActions,.studioRatingDock{top:66px!important;right:14px!important;max-height:calc(100dvh - 76px)!important}
}

/* v6.2 navigation rail lives at body level; it can never cover the media grid. */
body > .mediaTabs{
 position:fixed!important;top:114px!important;left:18px!important;right:auto!important;bottom:auto!important;
 z-index:55!important;box-sizing:border-box!important;
 display:flex!important;flex-direction:column!important;align-items:center!important;
 justify-content:flex-start!important;gap:9px!important;padding:8px!important;
 width:60px!important;margin:0!important;
 border-radius:19px!important;border:1px solid #ecf6ff5c!important;
 background:linear-gradient(138deg,#5f91c531,#0715275e)!important;
 box-shadow:inset 0 1px 0 #ffffff42,0 16px 46px #0005!important;
 backdrop-filter:blur(30px) saturate(160%)!important;
 -webkit-backdrop-filter:blur(30px) saturate(160%)!important;
}
body > .mediaTabs > button{
 position:relative!important;box-sizing:border-box!important;
 display:grid!important;place-items:center!important;flex:0 0 46px!important;
 width:42px!important;height:46px!important;min-width:42px!important;min-height:46px!important;
 margin:0!important;padding:0!important;border:0!important;border-radius:12px!important;
 font-size:0!important;line-height:0!important;color:#a0b6ce!important;
 background:transparent!important;box-shadow:none!important;cursor:pointer;
}
body > .mediaTabs > button.on{
 background:linear-gradient(140deg,#b0daff48,#588ac631)!important;
 border:1px solid #c8e9ff78!important;color:#f3f9ff!important;
 box-shadow:inset 0 1px 0 #ffffff66,0 4px 20px #7aaefc24!important;
}
body > .mediaTabs > button:hover{color:#fff!important;background:#b9ddff20!important}
body > .mediaTabs > button > .studioTabIcon,
body > .mediaTabs > button > .studioTopActionIcon{
 position:absolute!important;inset:0!important;display:grid!important;place-items:center!important;
 width:100%!important;height:100%!important;margin:0!important;padding:0!important;
}
body > .mediaTabs > button svg{display:block!important;width:23px!important;height:23px!important;margin:auto!important;position:static!important}
@media(max-width:700px){body>.mediaTabs{top:80px!important;left:7px!important;width:48px!important;padding:5px!important;gap:5px!important}body>.mediaTabs>button{width:36px!important;height:41px!important;min-width:36px!important;min-height:41px!important;flex-basis:41px!important}}


/* 影格 Studio v6.3: owner-first viewing, minimal library controls. */
/* The main video is shown against pure black, never a synthetic ambient cover. */
.feedOverlay,.feedScroller,.feedItem,.feedItem .videoStage,
.feedItem .feedMedia,.feedVideo{background:#000!important}
.feedBackdrop{display:none!important}
/* Better legible, persistent indicators: A/B marks and enabled loop. */
.feedHeader .feedHeaderActions #feedSetA.set,
.feedHeader .feedHeaderActions #feedSetB.set,
.feedHeader .feedHeaderActions #feedABLoop.active{
 background:rgba(70,137,201,.42)!important;
 border:1px solid rgba(157,214,255,.86)!important;
 color:#f2faff!important;
 box-shadow:inset 0 1px 0 rgba(255,255,255,.37),0 0 0 2px rgba(64,161,255,.17),0 0 19px rgba(81,161,255,.28)!important;
}
.feedHeader .feedHeaderActions #feedABLoop.active{
 background:rgba(40,136,107,.40)!important;border-color:rgba(120,232,187,.88)!important;
 box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 0 0 2px rgba(76,219,159,.15)!important;
}
/* A rating dock contains ratings only, not unhelpful timestamp filenames. */
.studioRatingDock{padding:11px 13px!important;width:222px!important}
.studioRatingDock .feedRating{margin-top:0!important}
/* File names can be restored with the explicit header preference. */
body.studioHideVideoNames[data-studio-mode="video"] #grid .mediaTile .titleText{display:none!important}
body.studioHideVideoNames[data-studio-mode="video"] #grid .mediaTile .body .meta{margin-top:4px}
.studioNameToggle[aria-pressed="true"]{background:rgba(138,190,242,.16)!important;color:#bcdfff!important;border-color:rgba(161,203,247,.48)!important}
/* Media card footer offers rating, compact menu and multi-window only. */
#grid .mediaTile .iconActions{gap:8px!important}
#grid .mediaTile .iconActions .iconBtn{min-width:30px!important}
#grid .mediaTile .coverSeek{display:none!important}
#unifiedExport{display:none!important}
/* Clip shelf: unobtrusive single row, double-click to play. */
.clipShelfToolbar{display:none!important}
.clipShelfHeadActions{display:flex;align-items:center;gap:10px}
.clipShelfHeadActions button{width:36px;height:36px;min-width:36px;min-height:36px;padding:0!important;border-radius:10px;font-size:20px;display:grid;place-items:center}
.clipShelfRow{cursor:default}
.clipShelfRowActions{flex-wrap:nowrap!important}
.clipShelfRowActions button{min-width:55px}
/* Make the entire header a coherent horizontal glass band, while respecting the rail gutter. */
body>.studioHeader{
 box-sizing:border-box!important;
 margin-left:-86px!important;
 width:calc(100% + 86px)!important;
 padding-left:calc(86px + 28px)!important;
 border-top:0!important;border-left:0!important;border-right:0!important;
 border-radius:0!important;outline:0!important;
}
@media(max-width:700px){
 body>.studioHeader{margin-left:-58px!important;width:calc(100% + 58px)!important;padding-left:calc(58px + 13px)!important}
}
.studioHeader .studioTop,.studioHeader .studioWorkspace{border:0!important;box-shadow:none!important}


/* Just Fun v6.4 — immersive desktop viewing, no new media history. */
.studioHeader .studioBrand{border:0!important;min-width:0!important;padding:0!important;flex:0 0 auto!important;justify-content:flex-start!important}
.studioHeader .studioBrandText strong{font-family:Georgia,"Times New Roman",serif!important;font-size:26px!important;line-height:1.15!important;font-weight:500!important;font-style:italic!important;letter-spacing:.045em!important;color:#eaf4ff!important;text-shadow:0 1px 14px #8ab5ff33}
.studioHeader .studioMark,.studioHeader .studioBrandText small{display:none!important}
.studioHeader .studioTop{justify-content:flex-start!important;flex:0 0 auto!important}
.studioHeader .studioBrandText{display:block!important}
#creatorToggle{font-size:12px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:37px;gap:6px!important;line-height:1.2!important;padding:0 12px!important}
#creatorToggle::after{content:none!important;display:none!important}
/* Quiet audio — timeline first; A/B and clipping are on demand. */
.audioDock{left:clamp(15px,7vw,120px)!important;right:clamp(15px,7vw,120px)!important;bottom:14px!important;width:auto!important;border:1px solid #c3e3ff4a!important;border-radius:19px!important;background:linear-gradient(145deg,#14283bd1,#07111ccb)!important;box-shadow:0 28px 75px #0009,inset 0 1px #ffffff2b!important;backdrop-filter:blur(27px) saturate(1.35)!important;padding:13px 20px 15px!important;overflow:visible}
.audioDock .audioTrackHeader{margin-bottom:6px!important}
.audioDock .audioArtwork{width:26px!important;height:26px!important;flex-basis:26px!important;background:transparent!important;border-radius:6px!important}
.audioDock .audioTrack .audioTitle{font-size:12px!important;color:#c7d3e2!important;font-weight:440!important;opacity:.85}
.audioDock .audioTimeline{gap:13px!important}.audioDock .audioSeek{height:3px!important;background:linear-gradient(90deg,#b2d5ff 0%,#b2d5ff var(--audio-progress,0%),#6d80965c var(--audio-progress,0%),#6d80965c 100%)!important}
.audioDock .audioSeek::-webkit-slider-thumb{width:11px!important;height:11px!important;box-shadow:0 0 0 4px #bddbff25!important}
.audioDock .audioPlay{border-radius:50%!important;background:#d8e9fa!important;color:#13243a!important;box-shadow:0 3px 16px #82bbff35!important}
.audioDock .audioTools{margin:4px 0 0!important;justify-content:flex-end!important;gap:6px!important;min-height:35px!important}
.audioDock .audioABTools{display:none!important;align-items:center!important;flex-wrap:wrap!important;gap:5px!important}
.audioDock .audioToolsExpanded .audioABTools{display:flex!important}
.audioDock .audioABInfo{display:none!important}
.audioDock .audioAdvancedToggle{margin-right:auto!important;font-size:22px!important;line-height:0!important;letter-spacing:1px!important}
.audioDock .audioIconBtn{min-width:36px!important;width:36px!important;height:36px!important;min-height:36px!important;border:1px solid #d2e8ff29!important;background:#a4c8ee12!important;color:#d3e1f3!important;padding:0!important;border-radius:10px!important;justify-content:center!important;gap:0!important;backdrop-filter:blur(12px)}
.audioDock .audioIconBtn:hover,.audioDock .audioIconBtn.on{background:#7daaf339!important;border-color:#abceff88!important}
.audioDock .audioControlLabel{display:none!important}.audioDock .audioLetterIcon{border:0!important;background:transparent!important;font-size:16px!important;width:auto!important;height:auto!important}
.audioDock .audioABBtn.on .audioLetterIcon{color:#d9efff!important;background:transparent!important}
.audioDock .audioSpeed{width:auto!important;min-width:51px!important;padding:0 7px!important}
.audioDock .audioRightTools{margin-left:0!important;order:2!important;gap:6px!important}
.audioDock .audioSpeedPopup,.audioDock .audioVolumePopup{background:#182b40d9!important;backdrop-filter:blur(24px)}
body.audioDockVisible:has(#audioDock:not([hidden])){padding-bottom:150px!important}
/* Full-bleed image theater. All controls are floating and optional. */
#assetView.photoDetail{background:#000!important;display:none!important;padding:0!important;gap:0!important;overflow:hidden!important}
#assetView.photoDetail.open{display:block!important}
#assetView .photoDetailStage{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;display:block!important;padding:0!important;overflow:hidden!important;background:#000!important}
#assetView .photoImageSurface{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;display:flex!important;align-items:center!important;justify-content:center!important;touch-action:none!important;cursor:default!important;overflow:hidden!important}
#assetView .photoImageSurface img{max-width:100%!important;max-height:100%!important;min-width:0!important;width:auto!important;height:auto!important;object-fit:contain!important;user-select:none!important;transform-origin:center center!important;transition:none!important;will-change:transform!important}
#assetView .photoSideArrow{position:absolute!important;top:50%!important;z-index:2!important;transform:translateY(-50%)!important;width:37px!important;height:54px!important;border-radius:12px!important;font-size:28px!important;background:#14213340!important;color:#eef5ffb0!important;opacity:0;transition:opacity .2s ease!important}
#assetView:hover .photoSideArrow{opacity:.72!important}
#assetView #assetPrev{left:109px!important}#assetView #assetNext{right:15px!important}
#assetView.photoRailHidden #assetPrev{left:15px!important}
#assetView .photoFloatClose,#assetView .photoFloatRailToggle,#assetView .photoFloatMore{position:absolute!important;z-index:10!important;border:1px solid #e2f3ff44!important;background:linear-gradient(145deg,#23344d89,#090d18a4)!important;backdrop-filter:blur(21px)!important;box-shadow:0 4px 20px #0008,inset 0 1px #ffffff33!important;color:#f5f9ff!important;border-radius:50%!important;display:grid!important;place-items:center!important;width:38px!important;height:38px!important;padding:0!important;font-size:24px!important;cursor:pointer!important}
#assetView .photoFloatClose{right:20px!important;top:18px!important}
#assetView .photoFloatRailToggle{left:27px!important;top:20px!important}
#assetView .photoFloatRailToggle svg{width:18px;height:18px}
#assetView .photoFloatMore{right:20px!important;bottom:22px!important;font-size:20px!important}
#assetView .photoDetailRail{position:absolute!important;top:70px!important;bottom:18px!important;left:17px!important;width:83px!important;z-index:8!important;display:flex!important;min-height:0!important;align-items:stretch!important;border:1px solid #c9e4ff31!important;border-radius:18px!important;background:linear-gradient(145deg,#22334b74,#090e19a8)!important;backdrop-filter:blur(28px) saturate(1.15)!important;box-shadow:inset 0 1px #ffffff38,0 14px 35px #0009!important;overflow:hidden!important;transition:transform .24s ease,opacity .24s ease!important}
#assetView.photoRailHidden .photoDetailRail{transform:translateX(-130%)!important;opacity:0!important;pointer-events:none!important}
#assetView .photoFilmstrip{display:flex!important;flex:1!important;min-height:0!important;max-width:100%!important;flex-direction:column!important;align-items:center!important;gap:9px!important;padding:11px 7px!important;overflow-x:hidden!important;overflow-y:auto!important;scrollbar-width:thin!important;scrollbar-color:#a7bedc44 transparent!important}
#assetView .photoFilmstrip button{display:block!important;flex:0 0 64px!important;width:62px!important;height:84px!important;min-height:84px!important;opacity:.65!important;border:1px solid #ffffff1b!important;border-radius:10px!important;background:#1421337d!important;padding:0!important;transition:opacity .2s,border-color .2s!important}
#assetView .photoFilmstrip button.isCurrent{opacity:1!important;border-color:#e5f3ff!important;box-shadow:0 0 0 2px #9dc9ff44!important}
#assetView .photoFilmstrip button:hover{opacity:1!important}
#assetView .photoFilmstrip img{width:100%!important;height:100%!important;object-fit:cover!important}
#assetView .photoMorePanel[hidden]{display:none!important}
#assetView .photoMorePanel{position:absolute!important;right:20px!important;bottom:68px!important;z-index:15!important;border:1px solid #adcdec55!important;background:#16283acf!important;backdrop-filter:blur(24px)!important;border-radius:12px!important;padding:7px!important;box-shadow:0 18px 45px #000a!important}
#assetView .photoMorePanel button{background:transparent!important;border:0!important;border-radius:8px!important;color:#ffcad4!important;padding:10px 18px!important;cursor:pointer!important;font-size:12px!important}
#assetView .photoMorePanel button:hover{background:#ffffff13!important}
#assetView #photoZoomButton,#assetView #photoDownload{display:none!important}
#assetView .photoLoading{bottom:35px!important;left:50%!important}
/* Thumbnail-first clip cards. No wasted full-height single-item modal. */
.clipShelf{width:min(1180px,calc(100vw - 36px))!important;height:auto!important;max-height:calc(100dvh - 40px)!important;min-height:0!important;background:linear-gradient(145deg,#16283be5,#080f1bd9)!important;backdrop-filter:blur(35px) saturate(1.2)!important}
.clipShelfHead{padding:15px 23px!important}.clipShelfHead h2{font-weight:540!important;letter-spacing:.02em!important}
.clipShelfList{display:grid!important;flex:0 1 auto!important;max-height:calc(100dvh - 140px)!important;overflow-y:auto!important;grid-template-columns:repeat(auto-fill,minmax(165px,1fr))!important;grid-auto-rows:max-content!important;gap:16px!important;align-content:start!important;padding:22px!important}
.clipShelfRow{display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:0!important;position:relative!important;padding:0!important;margin:0!important;border-radius:15px!important;overflow:hidden!important;background:#17243578!important;border:1px solid #a8ceff32!important;backdrop-filter:blur(16px)!important;box-shadow:0 9px 25px #0005!important;cursor:pointer!important;transition:transform .16s,border-color .16s!important}
.clipShelfRow:hover{transform:translateY(-3px)!important;border-color:#e1edff79!important}
.clipShelfPoster{width:100%!important;height:auto!important;aspect-ratio:9/13!important;border:0!important;border-radius:0!important;background:#080c14!important}
.clipShelfPoster img{width:100%!important;height:100%!important;object-fit:cover!important}
.clipShelfRow>div:nth-child(2){min-width:0!important;padding:12px 12px 8px!important}
.clipShelfRowTitle{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:12px!important;font-weight:550!important}
.clipShelfRowInfo{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:10px!important;margin-top:5px!important;color:#a3b4c9!important}
.clipShelfRowActions{display:flex!important;justify-content:flex-end!important;align-items:center!important;gap:8px!important;padding:0 10px 11px!important;grid-column:auto!important}
.clipShelfRowActions button{padding:6px 11px!important;min-width:0!important;font-size:11px!important;border-radius:8px!important;background:#a8cfff1c!important;border-color:#a8cfff3a!important}
.clipShelfRowActions button.warn{color:#ffa8b9!important;background:transparent!important;border-color:transparent!important}
@media(max-width:660px){.clipShelfList{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important;padding:12px!important}.clipShelfRowActions{padding:0 6px 8px!important;gap:3px!important}#assetView .photoDetailRail{left:6px!important;width:65px!important}#assetView .photoFilmstrip button{width:49px!important;height:66px!important;min-height:66px!important;flex-basis:66px!important}#assetView #assetPrev{left:77px!important}}



/* Just Fun v6.5 — playback-first desktop polish */
#feedGhostLoop.active{color:#bfffd2!important;border-color:#a5ffd3aa!important;background:#27804a66!important;box-shadow:0 0 16px #4cff943c!important}
.studioHeader .studioBrandText strong{font-family:"Segoe Script","Segoe Print","Bradley Hand","Lucida Handwriting","GFS Olga",cursive!important;font-style:italic!important;font-weight:500!important;font-size:23px!important;letter-spacing:-.045em!important;white-space:nowrap!important;text-shadow:0 1px 12px #87b6ee24!important}
.studioHeader .studioBrand{margin:0 0 0 -13px!important;padding-left:0!important;justify-content:flex-start!important;min-width:0!important}
#creatorPanel.collapsed{display:none!important}
.audioDock{left:1vw!important;right:1vw!important;width:98vw!important;max-width:none!important;bottom:8px!important;padding:12px 18px 13px!important}
.audioDock .audioTrack{max-width:none!important;width:100%!important}
.audioDock .audioTools{display:flex!important;align-items:center!important;justify-content:flex-end!important;flex-wrap:wrap!important;margin:5px 0 0!important;gap:7px!important}
.audioDock .audioABTools{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:6px!important}
.audioDock .audioRightTools{display:flex!important;flex-wrap:wrap!important;align-items:center!important;margin-left:auto!important}
.audioDock .audioAdvancedToggle{display:none!important}
.audioFileMeta{display:flex;flex-wrap:wrap;align-items:center;gap:0;color:#b1c8e1!important;font-variant-numeric:tabular-nums;font-size:12px!important}
.audioFileSize{color:#8192a8;font-size:11px}
.miniPlayer{background:linear-gradient(155deg,#20334db8,#091323cb)!important;border:1px solid #bddaff55!important;backdrop-filter:blur(22px) saturate(1.2);box-shadow:0 18px 46px #0009,inset 0 1px #ffffff26!important;overflow:visible!important}
.miniHead{position:relative;min-height:31px;cursor:move;background:linear-gradient(110deg,#20354bbb,#101a2bd4)!important;border-bottom:1px solid #c8e5ff2b!important;padding:5px 7px!important;gap:6px!important}
.miniLabel{font-family:inherit;font-weight:500;font-size:11px;color:#dfeaf7;padding-left:3px}
.miniHead .miniClose{margin-left:0;order:4}
.miniToolsToggle{order:3;flex:0 0 27px;width:27px;height:27px;border:1px solid #d7e9ff35;border-radius:8px;background:#ffffff10;color:#edf5ff;font-size:17px;cursor:pointer;display:grid;place-items:center}
.miniAdvanced{display:none;position:absolute;right:4px;top:calc(100% + 7px);z-index:2000;width:194px;max-height:270px;overflow-y:auto;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:9px;border:1px solid #d5e6ff44;border-radius:12px;background:linear-gradient(140deg,#213450e5,#0c1526ea);backdrop-filter:blur(25px);box-shadow:0 16px 40px #000c}
.miniPlayer.miniToolsOpen .miniAdvanced{display:grid}
.miniAdvanced button{min-width:0!important;width:100%!important;height:37px!important;display:grid;place-items:center;border:1px solid #d1e5ff20!important;background:#a9c7ff13!important;border-radius:8px!important;font-size:11px!important;padding:0!important;color:#dbeaff!important}
.miniAdvanced button.active,.miniAdvanced button.set{background:#8cbaff42!important;border-color:#c3dcff88!important}
.miniMediaWrap{overflow:hidden!important;border-radius:0 0 11px 11px}



/* Just Fun 6.7 · 轻量滤镜浮层：只叠加实时观感，不篡改源文件或进度。 */
.jfFilterPanel[hidden]{display:none!important}
.jfFilterPanel{position:fixed;top:76px;right:18px;width:min(320px,calc(100vw - 28px));z-index:250;box-sizing:border-box;padding:16px;border:1px solid rgba(217,237,255,.31);border-radius:19px;background:linear-gradient(145deg,rgba(27,42,61,.82),rgba(7,13,24,.87));box-shadow:0 18px 64px rgba(0,0,0,.72),inset 0 1px rgba(255,255,255,.15);-webkit-backdrop-filter:blur(32px) saturate(1.5);backdrop-filter:blur(32px) saturate(1.5);color:#edf4ff;pointer-events:auto}
.jfFilterTop{display:flex;align-items:center;justify-content:space-between;gap:15px;font-size:14px;font-weight:650;letter-spacing:.03em;margin-bottom:13px}
.jfFilterClose{display:grid;place-items:center;width:27px;height:27px;border-radius:8px;border:1px solid rgba(231,243,255,.17);background:rgba(230,240,255,.07);color:#ebf4ff;cursor:pointer;font-size:19px;line-height:1}
.jfFilterPresets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.jfFilterPresets button{height:52px;min-width:0;display:grid;place-items:center;border:1px solid rgba(225,240,255,.15);border-radius:12px;background:rgba(100,145,188,.09);font-size:12px;font-weight:500;color:#c7d6e7;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.jfFilterPresets button[aria-pressed="true"]{background:rgba(129,184,234,.2);border-color:#a0cbf3;color:#fff;box-shadow:inset 0 1px rgba(255,255,255,.18)}
.jfFilterPresets button:hover{background:rgba(151,192,227,.2);color:#fff}
.jfFilterStrength{margin:16px 0 6px}.jfFilterStrength label{display:flex;justify-content:space-between;color:#c8d6e7;font-size:12px;line-height:1.3}.jfFilterStrength output{font-variant-numeric:tabular-nums;color:#e7f3ff}
.jfFilterStrength input:disabled{opacity:.35;cursor:default}.jfFilterStrength input{display:block;width:100%;height:22px;accent-color:#9ac4f0;cursor:pointer;margin:6px 0 0}
.jfFilterPanel small{display:block;color:#8facc6;font-size:10px;margin-top:4px}
#assetView .photoFloatFilter{position:absolute;right:20px;top:68px;z-index:12;display:grid;place-items:center;width:38px;height:38px;min-width:38px;padding:0;border-radius:50%;border:1px solid #e2f3ff44;background:linear-gradient(145deg,#23344d89,#090d18a4);-webkit-backdrop-filter:blur(21px);backdrop-filter:blur(21px);color:#f2f8ff;cursor:pointer;box-shadow:0 4px 20px #0008,inset 0 1px #ffffff33}
#assetView .photoFloatFilter svg{height:19px;width:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linejoin:round;stroke-linecap:round}
#assetView .jfFilterPanel{top:118px;z-index:30}
@media(max-height:490px){.jfFilterPanel{top:12px;right:10px;max-height:calc(100dvh - 24px);overflow-y:auto}.jfFilterPresets button{height:37px}#assetView .jfFilterPanel{top:12px;right:67px}}


/* Just Fun Filter v2: a compact icon-only crystal palette, no external icon font. */
.jfFilterPanel{width:min(278px,calc(100vw - 26px))!important;padding:13px!important;border-radius:17px!important;background:linear-gradient(145deg,rgba(19,35,49,.69),rgba(5,11,22,.76))!important;backdrop-filter:blur(30px) saturate(1.35)!important;-webkit-backdrop-filter:blur(30px) saturate(1.35)!important}
.jfFilterPresets{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:9px!important}
.jfFilterPresets button{height:57px!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:0!important;min-width:0!important;border-radius:13px!important;transition:background .16s,border-color .16s,transform .16s!important}
.jfFilterPresets button:hover{transform:translateY(-2px)}
.jfFilterPresets button[aria-pressed="true"]{border-color:rgba(186,226,255,.96)!important;background:linear-gradient(140deg,rgba(98,172,239,.31),rgba(52,104,153,.22))!important;box-shadow:inset 0 1px rgba(255,255,255,.29),0 0 16px rgba(82,170,255,.2)!important}
.jfFilterPresets button[data-jf-preset="matrix"][aria-pressed="true"]{color:#9dffbb!important;border-color:#62e69d!important;background:rgba(19,124,69,.25)!important;box-shadow:0 0 21px #28f98122!important}
.jfFilterPresets button svg{width:25px!important;height:25px!important;display:block!important;pointer-events:none!important;flex-shrink:0!important}
.jfFilterMatrixCanvas{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;display:block!important;pointer-events:none!important;z-index:2!important;background:#000!important;opacity:1!important;transform:none!important;filter:none!important;mix-blend-mode:normal!important;}
.jfFilterPanel[data-jf-active-preset="matrix"] .jfFilterStrength{display:none!important}
.photoImageSurface .jfFilterMatrixCanvas{z-index:5!important}
@media(max-height:490px){.jfFilterPresets button{height:43px!important}.jfFilterPresets button svg{width:20px!important;height:20px!important}}
/* Just Fun v7.0 — targeted interaction and UI correction, no new dependencies. */
body>.studioHeader{padding-left:11px!important;padding-right:24px!important}
@media(max-width:700px){body>.studioHeader{padding-left:9px!important;padding-right:10px!important}}
.studioHeader .studioBrand{margin-left:0!important}
.studioHeader .studioActions{margin-left:auto!important;justify-content:flex-end!important}
.studioHeader .studioWorkspace{min-width:0;flex:1}
/* The A/B library and clip tools live in a contextual dock only while A/B repeats. */
#feedABQuickActions[hidden]{display:none!important}
#feedABQuickActions{position:fixed;z-index:89;right:18px;bottom:clamp(96px,12dvh,160px);display:flex;gap:8px;padding:7px;border-radius:16px;border:1px solid rgba(215,236,255,.28);background:rgba(15,29,46,.58);backdrop-filter:blur(22px) saturate(1.25);-webkit-backdrop-filter:blur(22px) saturate(1.25);box-shadow:0 16px 46px #0008,inset 0 1px #ffffff21;pointer-events:auto}
#feedABQuickActions .feedTool{display:grid!important;place-items:center!important;box-sizing:border-box!important;width:41px!important;height:41px!important;min-height:41px!important;min-width:41px!important;padding:0!important;border-radius:11px!important;border:1px solid #a7d1fa2f!important;background:#bfdcff0c!important;color:#e0efff!important;cursor:pointer}
#feedABQuickActions .feedTool:hover:not(:disabled){background:#a3d0fb2e!important;border-color:#9fc8f67c!important}
#feedABQuickActions .feedToolGlyph,#feedABQuickActions .feedToolGlyph svg{width:21px;height:21px;display:block}
#feedABQuickActions .feedToolLabel{display:none!important}
.feedOverlay.chromeHidden #feedABQuickActions,.feedOverlay.chromeIdle #feedABQuickActions{opacity:0;pointer-events:none;transition:opacity .22s}
.feedOverlay.chromeHidden:has(.feedABQuickActions:not([hidden])) #feedABQuickActions:hover,.feedOverlay:not(.chromeIdle) #feedABQuickActions{opacity:1;pointer-events:auto}
@media(max-width:650px){#feedABQuickActions{right:9px;bottom:106px}}
/* Frame studio: the image fills the dialog, tools float in the outer edge, not in rigid header/footer bars. */
.shotStudio{position:relative!important;width:min(1520px,100%)!important;height:min(96dvh,1040px)!important;display:block!important;background:#000!important;isolation:isolate}
.shotStage{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;z-index:0!important;min-height:0!important;background:#000!important}
.shotTop{position:absolute!important;top:0;left:0;right:0;z-index:4!important;display:flex!important;align-items:flex-start!important;padding:14px!important;border:0!important;background:linear-gradient(180deg,#0009,transparent)!important;pointer-events:none!important}
.shotHeading{max-width:min(38%,260px);padding:5px 4px;pointer-events:none}
.shotHeading strong{font-size:12px!important;font-weight:500!important;color:#d9e9fa!important}
.shotHeading small{max-width:100%!important;font-size:10px!important;opacity:.65}
.shotActions{margin-left:auto;pointer-events:auto!important;gap:7px!important}
.shotActions button{background:#0d1b2ca3!important;border:1px solid #e0edff3a!important;border-radius:10px!important;backdrop-filter:blur(14px)!important;padding:8px 12px!important;font-size:12px!important}
.shotActions .shotSave{background:#bdddf2dc!important;color:#101c2a!important}
.shotFoot{position:absolute!important;z-index:4!important;left:50%;bottom:10px;transform:translateX(-50%);box-sizing:border-box;width:min(710px,calc(100% - 28px));display:flex!important;flex-direction:column!important;gap:9px!important;border:1px solid #aacbf532!important;background:#0a1825a8!important;backdrop-filter:blur(19px)!important;-webkit-backdrop-filter:blur(19px)!important;border-radius:15px;padding:9px 12px 10px!important;pointer-events:auto}
.shotInfo{display:flex!important;flex-direction:row!important;justify-content:center;align-items:center!important;gap:10px!important;min-height:16px!important;flex-wrap:wrap}
.shotIndex{font-size:12px!important}.shotTime{font-size:10px!important}
.shotFeedback:empty{display:none!important}
.shotScrubber{width:100%;display:flex;align-items:center;gap:11px}
.shotScrubber .shotSeek{appearance:none;-webkit-appearance:none;flex:1;min-width:0;width:100%;height:5px;border:0;outline:0;border-radius:999px;cursor:pointer;background:linear-gradient(90deg,#a9d6ff 0%,#a9d6ff var(--shot-position,0%),#9dbad44a var(--shot-position,0%),#9dbad44a 100%)}
.shotScrubber .shotSeek::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:13px;height:13px;border-radius:50%;border:2px solid #eaf6ff;background:#98caff;box-shadow:0 0 0 4px #9fcfff25}
.shotScrubber .shotSeek::-moz-range-thumb{width:11px;height:11px;border:2px solid #eaf6ff;border-radius:50%;background:#98caff}
.shotScrubber .shotSeek:focus-visible{outline:2px solid #9bc8ff;outline-offset:4px}
.shotScrubber button{flex:0 0 32px;width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;padding:0!important;border-radius:50%!important;background:#ffffff16!important;font-size:24px!important;font-weight:400!important;display:grid;place-items:center;line-height:1!important}
.shotScrubber button:disabled{opacity:.28!important}
@media(max-width:700px){.shotTop{padding:7px!important}.shotHeading{max-width:28%;padding:2px 0}.shotHeading small{display:none}.shotActions{gap:4px!important}.shotActions button{padding:7px 8px!important;font-size:10px!important}.shotFoot{bottom:5px!important;padding:7px 8px!important;gap:5px!important}}
/* Keep frame transport off the footage when vertical media is viewed on a wide monitor. */
@media(min-aspect-ratio:4/3) and (min-width:950px){
 .shotStudio.shotPortrait .shotFoot{left:13px!important;transform:none!important;width:var(--shot-side-width,330px)!important;max-width:calc(100% - 32px)!important}
 .shotStudio.shotPortrait .shotInfo{gap:3px!important}
 .shotStudio.shotPortrait .shotTime{font-size:9px!important}
}
/* Compact audio cards: calm alignment, smaller glyph, clear time metadata, no awkward line breaks. */
.audioFileGrid{grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))!important;gap:11px!important}
.audioFileTile{box-sizing:border-box;min-height:112px!important;align-items:flex-start!important;gap:10px!important;padding:13px 14px 12px!important;border-radius:16px!important;border:1px solid #b6d5f537!important;background:linear-gradient(150deg,rgba(59,85,118,.21),rgba(8,21,37,.4))!important;box-shadow:inset 0 1px #ffffff0b,0 9px 24px #0002!important;transition:background .15s,border-color .15s,transform .15s!important}
.audioFileTile:hover{background:linear-gradient(150deg,rgba(74,111,154,.30),rgba(18,37,59,.50))!important;border-color:#9cc9f07d!important;transform:translateY(-1px)}
.audioFileTile.isActive{background:linear-gradient(150deg,#3c659056,#172f4b99)!important;border-color:#9ac8f1ac!important}
.audioFileArt{flex:0 0 35px!important;width:35px!important;height:35px!important;border-radius:11px!important;background:#a3c9ee13!important;color:#add5fa!important}
.audioFileArt svg{width:20px!important;height:20px!important}
.audioFileText{min-width:0!important;flex:1 1 auto!important;padding:0!important;padding-right:23px!important}
.audioFileName{font-size:12.5px!important;line-height:1.45!important;font-weight:540!important;letter-spacing:.003em!important;min-height:0!important;max-height:calc(1.45em * 3)!important;overflow-wrap:anywhere;color:#e4effc!important}
.audioFileMeta{font-size:11px!important;margin-top:10px!important;gap:6px!important;color:#b3d6f5!important}
.audioFileSize{color:#93a9be!important;font-size:10.5px!important}
.audioFileTile .unifiedMore{position:absolute;right:11px;top:11px;width:31px!important;height:31px!important;border-radius:10px!important;border:1px solid transparent!important;background:transparent!important;color:#a9bdd3!important;display:grid;place-items:center;opacity:.77}
.audioFileTile:hover .unifiedMore,.audioFileTile .unifiedMore:focus-visible{border-color:#b4d6f537!important;background:#ffffff14!important;color:#f0f7ff!important;opacity:1}
.audioFileActions{display:none!important}
@media(max-width:700px){.audioFileGrid{grid-template-columns:repeat(auto-fill,minmax(min(100%,175px),1fr))!important;gap:8px!important}.audioFileTile{padding:10px!important;gap:7px!important}.audioFileArt{flex-basis:30px!important;width:30px!important;height:30px!important}.audioFileText{padding-right:14px!important}}


/* Just Fun v6.12 — Background music: one persistent audio lane, two presentation sizes. */
.audioDock:not([hidden]){z-index:260010!important;box-sizing:border-box!important;
  background:linear-gradient(126deg,rgba(120,166,211,.18),rgba(30,54,82,.25) 36%,rgba(5,13,26,.52) 100%)!important;
  border:1px solid rgba(219,240,255,.42)!important;
  box-shadow:0 15px 54px rgba(0,0,0,.48),inset 0 1px rgba(255,255,255,.30),inset 1px 0 rgba(193,221,253,.12)!important;
  backdrop-filter:blur(35px) saturate(1.45)!important;-webkit-backdrop-filter:blur(35px) saturate(1.45)!important;}
.audioDock .audioTrackHeader{display:flex!important;align-items:center!important;gap:10px!important}
.audioDock .audioTrackInfo{flex:1;min-width:0}
.audioDockHeaderActions{display:flex;align-items:center;gap:8px;margin-left:auto}
.audioDock .audioDockMinimize,.audioDock .audioDockClose{display:grid!important;place-items:center!important;width:29px!important;height:29px!important;padding:0!important;border-radius:9px!important;
  color:#dae9f8!important;background:rgba(178,210,249,.12)!important;border:1px solid rgba(200,228,255,.22)!important;cursor:pointer}
.audioDock .audioDockMinimize svg{width:16px;height:16px;stroke:currentColor;stroke-width:1.8;fill:none}
.audioDock .audioDockMinimize:hover,.audioDock .audioDockClose:hover{background:rgba(170,212,255,.24)!important}
.audioDock .audioIconBtn:not(.audioPlay){background:rgba(145,189,236,.09)!important;border-color:rgba(211,232,255,.19)!important;backdrop-filter:blur(18px)!important}
.audioDock .audioIconBtn.on:not(.audioPlay){background:rgba(108,161,223,.27)!important;border-color:rgba(188,217,255,.48)!important}
.audioDock .bgmMini{display:none}
/* Compact music indicator deliberately occupies only a 45px square until hovered/focused. */
.audioDock.isMinimized:not([hidden]){left:var(--bgm-mini-left,14px)!important;right:auto!important;bottom:var(--bgm-mini-bottom,84px)!important;width:46px!important;height:46px!important;max-width:none!important;
  padding:0!important;border-radius:24px!important;overflow:visible!important;
  background:linear-gradient(145deg,rgba(105,161,210,.23),rgba(16,30,51,.34))!important;
  transition:opacity .24s ease,background .2s ease!important;}
.audioDock.isMinimized:not([hidden]):hover,.audioDock.isMinimized:not([hidden]):focus-within{width:84px!important}
.audioDock.isMinimized .audioTrack{position:absolute!important;left:0!important;top:0!important;width:1px!important;height:1px!important;min-width:0!important;overflow:hidden!important;
  padding:0!important;border:0!important;opacity:0!important;pointer-events:none!important}
.audioDock.isMinimized .bgmMini{display:flex;align-items:center;justify-content:center;width:100%;height:100%;gap:0;padding:0 4px;box-sizing:border-box}
.audioDock.isMinimized .bgmMini button{display:grid;place-items:center;flex:0 0 36px;width:36px;height:36px;padding:0;
  border:0;border-radius:50%;color:#dfecff;background:transparent;cursor:pointer}
.audioDock.isMinimized .bgmMini svg{width:18px;height:18px;stroke:currentColor;stroke-width:1.8;fill:none}
.audioDock.isMinimized .bgmMiniPlay{opacity:0;visibility:hidden;pointer-events:none;transform:scale(.78);transition:opacity .16s,transform .16s}
.audioDock.isMinimized:hover .bgmMiniPlay,.audioDock.isMinimized:focus-within .bgmMiniPlay{opacity:1;visibility:visible;pointer-events:auto;transform:scale(1)}
.audioDock.isMinimized .bgmMini button:hover{background:rgba(180,216,255,.20)}
.bgmMiniPlay[data-playing="false"] .bgmIconPause,.bgmMiniPlay[data-playing="true"] .bgmIconPlay{display:none}
.audioDock.isMinimized .bgmMiniPlay .bgmIconPlay{fill:currentColor;stroke:none}
body:has(.feedOverlay.open) .audioDock.isMinimized:not([hidden]){bottom:var(--bgm-mini-bottom,82px)!important;opacity:.53}
body:has(.feedOverlay.open) .audioDock.isMinimized:hover,body:has(.feedOverlay.open) .audioDock.isMinimized:focus-within{opacity:1}
body:has(.assetView.open) .audioDock.isMinimized:not([hidden]){bottom:var(--bgm-mini-bottom,24px)!important;opacity:.48}
body:has(.assetView.open) .audioDock.isMinimized:hover{opacity:1}
body.audioDockVisible:has(#audioDock.isMinimized:not([hidden])){padding-bottom:0!important}
body:not(.audioDockVisible):has(#audioDock:not([hidden])){padding-bottom:0!important}
@media(max-width:700px){.audioDock.isMinimized:not([hidden]){left:var(--bgm-mini-left,10px)!important;bottom:var(--bgm-mini-bottom,74px)!important}}
.audioDock.isMinimized .bgmMiniOpen{touch-action:none;cursor:grab}
.audioDock.isMinimized.isDragging .bgmMiniOpen{cursor:grabbing}
.audioDock.isMinimized.isDragging{transition:none!important;opacity:1!important}

/* Just Fun v6.14 — replace text wordmark with uploaded symbol logo */
.studioHeader .studioBrandLogoOnly{display:flex!important;align-items:center!important;justify-content:flex-start!important;min-width:0!important;flex:0 0 auto!important;border:0!important;padding:0!important;margin:0 6px 0 0!important}
.studioHeader .studioBrandLogo{display:block!important;width:74px!important;height:auto!important;max-height:42px!important;object-fit:contain!important;filter:drop-shadow(0 2px 12px rgba(255,255,255,.08)) drop-shadow(0 8px 22px rgba(0,0,0,.24));opacity:.97}
.studioHeader .studioBrandText,.studioHeader .studioMark{display:none!important}
@media(max-width:700px){.studioHeader .studioBrandLogo{width:60px!important;max-height:36px!important}}


/* v6.15 - 34px brand symbol, no decorative glow, suitable for dark header. */
.studioHeader .studioBrandLogoOnly{margin:0!important;padding:0!important;width:40px!important;min-width:40px!important;height:40px!important;justify-content:center!important;align-items:center!important}
.studioHeader .studioBrandLogo{width:34px!important;height:34px!important;max-height:34px!important;object-fit:contain!important;opacity:1!important;filter:none!important}
@media(max-width:700px){.studioHeader .studioBrandLogoOnly{width:36px!important;min-width:36px!important;height:36px!important}.studioHeader .studioBrandLogo{width:30px!important;height:30px!important;max-height:30px!important}}

/* v6.16 - list-first, distraction-free desktop chrome */
body{padding-left:0!important}
/* Earlier dock layout offset the whole header to compensate for the old 86px rail. */
body > .studioHeader{margin-left:0!important;width:100%!important;box-sizing:border-box!important}
body > .studioHeader{position:sticky!important;top:0!important;z-index:105!important;transition:transform .23s cubic-bezier(.2,.7,.25,1)!important;will-change:transform}
body > .studioHeader.studioHeaderCollapsed{transform:translateY(-101%)!important;pointer-events:none!important}
body:has(.feedOverlay.open) > .studioHeader,body:has(.assetView.open) > .studioHeader{pointer-events:none}
#studioRailToggle{position:fixed;z-index:106;left:var(--rail-toggle-left,18px);bottom:18px;width:48px;height:48px;padding:11px;border:1px solid #d6ecff54;border-radius:16px;background:linear-gradient(150deg,#82ace52e,#09172f8a);box-shadow:0 8px 28px #0008,inset 0 1px #ffffff30;backdrop-filter:blur(25px) saturate(150%);color:#d7e9fb;cursor:pointer;transition:opacity .2s,background .2s}
#studioRailToggle svg{display:block;width:24px;height:24px;margin:auto}
#studioRailToggle:hover,#studioRailToggle[aria-expanded=true]{background:linear-gradient(145deg,#9ac9fa55,#1a3754b8);border-color:#cfeaffb8}
body>.mediaTabs#studioMediaRail{left:var(--rail-left,18px)!important;bottom:78px!important;top:auto!important;transform:translateX(-125%) scale(.96)!important;transform-origin:bottom left!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;transition:transform .22s cubic-bezier(.2,.75,.25,1),opacity .22s,visibility .22s!important;z-index:106!important}
body>.mediaTabs#studioMediaRail.railOpen{transform:translateX(0) scale(1)!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important}
body:has(.feedOverlay.open) #studioRailToggle,body:has(.assetView.open) #studioRailToggle,body:has(.feedOverlay.open) #studioMediaRail,body:has(.assetView.open) #studioMediaRail{opacity:0!important;pointer-events:none!important}
#grid.audioFileGrid{display:block!important;columns:250px;column-gap:11px;align-content:normal!important}
#grid.audioFileGrid .audioFileTile{display:flex!important;break-inside:avoid;page-break-inside:avoid;width:100%;min-height:0!important;height:auto!important;margin:0 0 11px;gap:9px!important;padding:11px 12px!important;align-items:flex-start!important}
#grid.audioFileGrid .audioFileText{padding-right:22px!important}
#grid.audioFileGrid .audioFileName{display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:3!important;line-clamp:3!important;max-height:calc(1.45em * 3)!important;overflow:hidden!important;min-height:0!important}
#grid.audioFileGrid .audioFileMeta{margin-top:5px!important}
#grid.audioFileGrid .audioStars{display:flex!important;align-items:center;gap:0!important;margin-top:7px;min-height:18px;touch-action:none;white-space:nowrap}
#grid.audioFileGrid .audioStars .ratingStar{width:19px!important;height:22px!important;min-width:19px!important;line-height:22px!important;font-size:18px!important;flex:0 0 19px!important}
#grid.audioFileGrid .audioStars .ratingValue{margin-left:7px!important;font-size:10px!important;color:#a0b5ca}
#grid.audioFileGrid .audioFileTile .unifiedMore{right:7px!important;top:8px!important}
#grid.videoTextGrid{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))!important;gap:10px!important}
#grid.videoTextGrid .videoTextTile{display:flex!important;align-items:flex-start!important;gap:11px!important;position:relative;padding:13px!important;min-height:0!important;height:auto!important;overflow:visible!important;background:linear-gradient(150deg,#4764892e,#0b182cbd)!important;border:1px solid #bddbff32!important;border-radius:14px!important}
#grid.videoTextGrid .videoTextOpen.coverWrap{position:static!important;display:grid!important;place-items:center!important;flex:0 0 38px!important;width:38px!important;min-width:38px!important;height:38px!important;min-height:38px!important;aspect-ratio:auto!important;border:0!important;border-radius:11px!important;background:#8fbef91a!important;color:#abcff4!important;padding:0!important;cursor:pointer;overflow:hidden!important}
#grid.videoTextGrid .videoTextOpen svg{display:block;width:21px;height:21px;stroke:currentColor;fill:none}
#grid.videoTextGrid .videoTextContent{flex:1;min-width:0;padding-right:26px}
#grid.videoTextGrid .titleText{display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:3!important;line-clamp:3!important;min-height:0!important;max-height:4.5em!important;white-space:normal!important;overflow:hidden!important;overflow-wrap:anywhere;font-size:13px!important;line-height:1.5!important;font-weight:520!important;padding:0!important;margin:0!important}
body.studioHideVideoNames[data-studio-mode=video] #grid.videoTextGrid .titleText{display:-webkit-box!important}
#grid.videoTextGrid .videoTextMeta{margin-top:6px;font-size:10px;color:#9cafc4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#grid.videoTextGrid .videoTextFoot .stars{display:flex!important;align-items:center;margin-top:9px!important;gap:0!important;touch-action:none}
#grid.videoTextGrid .videoTextFoot .ratingStar{width:19px!important;height:23px!important;font-size:18px!important;flex:0 0 19px!important;line-height:23px!important}
#grid.videoTextGrid .videoTextFoot .ratingValue{font-size:10px!important;margin-left:8px!important}
#grid.videoTextGrid .videoTextTile>.unifiedMore{position:absolute!important;right:10px!important;top:11px!important;width:30px!important;height:30px!important}
#grid.videoTextGrid .videoTextTile>.videoTextMulti{position:absolute!important;right:10px!important;bottom:9px!important;opacity:0;pointer-events:none;width:28px!important;height:28px!important;padding:5px!important}
#grid.videoTextGrid .videoTextTile:hover>.videoTextMulti,#grid.videoTextGrid .videoTextTile>.videoTextMulti:focus-visible{opacity:1;pointer-events:auto}
#grid.videoTextGrid .videoTextMeta .creatorText{font-size:10px!important;font-weight:450!important;color:#9cafc4!important;display:inline!important;min-height:0!important;padding:0!important;white-space:nowrap!important}
#grid.videoTextGrid .videoTextMeta .creatorLinkBtn{font-size:11px!important;display:inline-flex!important;vertical-align:middle!important}
.studioActions #videoViewToggle{display:inline-flex;align-items:center;justify-content:center;width:38px!important;min-width:38px!important;padding:8px!important;flex:0 0 38px}
.studioActions #videoViewToggle svg{width:18px!important;height:18px!important;display:block}
.studioActions #videoViewToggle[hidden]{display:none!important}
/* Only the outer rename group has a subtle border; the input never shows a nested focus ring. */
.unifiedRenameRow #unifiedRenameInput,.unifiedRenameRow #unifiedRenameInput:focus,.unifiedRenameRow #unifiedRenameInput:focus-visible{border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;appearance:none!important;-webkit-appearance:none!important}
.unifiedRenameRow:focus-within{border-color:#b2cff574!important;box-shadow:0 0 0 1px #b2cff518!important}
@media(max-width:700px){body{padding-left:0!important}#studioRailToggle{left:var(--rail-toggle-left,11px);bottom:12px;width:45px;height:45px}body>.mediaTabs#studioMediaRail{left:var(--rail-left,11px)!important;bottom:69px!important}#grid.audioFileGrid{columns:175px;column-gap:8px}#grid.videoTextGrid{grid-template-columns:repeat(auto-fill,minmax(175px,1fr))!important}}
@media(prefers-reduced-motion:reduce){body>.studioHeader,body>.mediaTabs#studioMediaRail,#studioRailToggle{transition:none!important}}

/* Just Fun 6.17 — text-first cinema library; common card language */
body:has(.feedOverlay.open)>.studioHeader,body:has(.assetView.open)>.studioHeader{
  visibility:hidden!important;opacity:0!important;transform:translateY(-105%)!important;pointer-events:none!important;
}
#grid.videoTextGrid,#grid.audioFileGrid{display:block!important;columns:285px;column-gap:13px!important;align-content:initial!important;padding:17px 21px 90px!important;}
#grid.videoTextGrid .videoTextTile,#grid.audioFileGrid .audioFileTile{
  display:block!important;box-sizing:border-box!important;width:100%!important;margin:0 0 13px!important;break-inside:avoid!important;
  min-width:0!important;min-height:0!important;height:auto!important;padding:15px 16px 13px!important;position:relative!important;
  border-radius:15px!important;border:1px solid rgba(175,200,231,.23)!important;
  background:linear-gradient(160deg,rgba(34,50,73,.50),rgba(10,20,35,.75))!important;
  box-shadow:inset 0 1px rgba(255,255,255,.07),0 7px 21px rgba(0,0,0,.16)!important;transform:none!important;
  color:#e4eefa!important;
}
#grid.videoTextGrid .videoTextTile:hover,#grid.audioFileGrid .audioFileTile:hover{
  border-color:rgba(169,211,252,.55)!important;background:linear-gradient(160deg,rgba(45,67,92,.59),rgba(14,27,45,.85))!important;
}
#grid.videoTextGrid .videoTextContent,#grid.audioFileGrid .audioFileText{padding:0!important;width:100%!important;min-width:0!important;display:block!important;flex:initial!important;}
#grid.videoTextGrid .videoTextHeading{display:flex;gap:9px;align-items:flex-start;min-width:0;}
#grid.videoTextGrid .titleText,#grid.audioFileGrid .audioFileName{
  display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:3!important;line-clamp:3!important;
  flex:1;min-width:0!important;max-width:none!important;max-height:calc(1.48em * 3)!important;min-height:0!important;
  margin:0!important;padding:0!important;white-space:normal!important;overflow:hidden!important;text-overflow:ellipsis!important;
  overflow-wrap:anywhere!important;word-break:break-word!important;font-size:13.4px!important;line-height:1.48!important;
  font-weight:540!important;letter-spacing:.01em!important;color:#e5effd!important;
}
#grid.videoTextGrid .videoTextHeading .unifiedMore,#grid.audioFileGrid .audioFileTile>.unifiedMore{
  position:static!important;flex:0 0 28px!important;width:28px!important;height:28px!important;min-width:28px!important;
  border:1px solid rgba(193,218,247,.19)!important;background:rgba(130,163,210,.06)!important;
  border-radius:9px!important;color:#aec0d7!important;opacity:.72!important;padding:0!important;
}
#grid.audioFileGrid .audioFileTile>.unifiedMore{position:absolute!important;right:13px!important;top:13px!important;}
#grid.audioFileGrid .audioFileName{padding-right:37px!important;}
#grid.videoTextGrid .videoTextAuthor{margin-top:8px!important;display:flex;min-width:0;align-items:center;gap:5px;color:#9eb2ca;}
#grid.videoTextGrid .creatorText{display:block!important;min-width:0!important;max-width:100%;font-size:11px!important;line-height:1.45!important;
  color:#9fb4cf!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;overflow-wrap:normal!important;
  margin:0!important;padding:0!important;background:transparent!important;font-weight:450!important;}
#grid.videoTextGrid .videoTextMeta,#grid.audioFileGrid .audioFileMeta{margin-top:8px!important;color:#8fa4ba!important;font-size:11px!important;
  line-height:1.5!important;min-height:0!important;white-space:normal!important;overflow-wrap:anywhere!important;overflow:visible!important;}
#grid.videoTextGrid .videoTextMeta:empty{display:none!important;}
#grid.videoTextGrid .metaSep{padding:0 5px;color:#5c718b;}
#grid.videoTextGrid .videoTextFoot{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-top:12px!important;min-width:0;}
#grid.videoTextGrid .videoTextFoot .stars,#grid.audioFileGrid .audioStars{display:flex!important;flex-wrap:nowrap!important;white-space:nowrap!important;margin:0!important;min-height:22px;align-items:center!important;}
#grid.videoTextGrid .ratingStar,#grid.audioFileGrid .ratingStar{width:21px!important;min-width:21px!important;flex:0 0 21px!important;height:24px!important;line-height:24px!important;font-size:19px!important;padding:0!important;}
#grid.videoTextGrid .ratingValue,#grid.audioFileGrid .ratingValue{margin-left:9px!important;font-size:10px!important;color:#8e9fb7!important;}
#grid.videoTextGrid .videoTextMulti{position:static!important;display:grid!important;place-items:center!important;flex:0 0 28px!important;width:28px!important;height:28px!important;min-width:28px!important;
  opacity:.67!important;pointer-events:auto!important;padding:5px!important;margin:0!important;border:1px solid #bbd8f526!important;border-radius:9px!important;background:#9cbfe012!important;}
#grid.videoTextGrid .videoTextMulti svg{width:17px;height:17px;stroke-width:1.7!important;fill:none!important;}
#grid.videoTextGrid .videoTextMulti:hover{opacity:1!important;background:#a3d5ff28!important;}
#grid.audioFileGrid .audioStars{margin-top:12px!important;}
#grid.audioFileGrid .audioFileArt{display:none!important;}
#grid.audioFileGrid .audioFileMeta{display:flex!important;align-items:center;gap:0!important;flex-wrap:wrap!important;}
#grid.audioFileGrid .audioFileSize{margin-left:2px;color:#8095b0!important;}
.miniPlayer .miniAdvanced{left:calc(100% + 9px)!important;right:auto!important;top:0!important;width:192px!important;max-width:calc(100vw - 20px)!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;}
.miniPlayer .miniAdvanced svg{width:19px!important;height:19px!important;stroke-width:1.8!important;fill:none!important;}
.miniPlayer .miniAdvanced .miniABBtn{font-size:12px!important;font-weight:600!important;}
.miniPlayer .miniAdvanced button{height:42px!important;background:rgba(109,140,190,.12)!important;border:1px solid rgba(196,220,249,.19)!important;}
.miniPlayer .miniAdvanced button:hover{background:rgba(128,175,225,.27)!important;}
@media(max-width:760px){#grid.videoTextGrid,#grid.audioFileGrid{columns:215px;padding:12px 12px 90px!important;column-gap:9px!important;}
 #grid.videoTextGrid .videoTextTile,#grid.audioFileGrid .audioFileTile{padding:12px!important;margin-bottom:9px!important;}
 .miniPlayer .miniAdvanced{left:0!important;top:calc(100% + 6px)!important;}
}


/* v6.18 — full-bleed video posters; keep every original action on the image. */
#grid:not(.videoTextGrid).grid {display:block!important;columns:245px!important;column-gap:12px!important;padding:16px 20px 90px!important;}
#grid:not(.videoTextGrid) .jfCoverTile{display:block!important;break-inside:avoid!important;page-break-inside:avoid!important;margin:0 0 12px!important;max-width:none!important;width:100%!important;height:auto!important;min-width:0!important;padding:0!important;border:1px solid rgba(192,216,244,.29)!important;border-radius:17px!important;overflow:hidden!important;background:#080e17!important;box-shadow:0 11px 25px #0005!important;transform:none!important;}
#grid:not(.videoTextGrid) .jfCoverTile:hover{border-color:rgba(215,232,252,.67)!important;box-shadow:0 16px 37px #0008!important;}
#grid .jfCoverTile .coverWrap{display:block!important;position:relative!important;width:100%!important;height:auto!important;aspect-ratio:var(--jf-video-ratio,9/16)!important;min-height:0!important;max-height:none!important;overflow:hidden!important;border-radius:0!important;margin:0!important;background:#070b12!important;}
#grid .jfCoverTile .coverWrap>.cover{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:contain!important;object-position:center!important;transform:none!important;filter:none!important;}
#grid .jfCoverTile .coverWrap>.badges{position:absolute!important;top:9px!important;left:10px!important;right:auto!important;bottom:auto!important;display:flex!important;gap:5px!important;z-index:3!important;pointer-events:none!important;}
#grid .jfCoverTile .badges .badge{font-size:10px!important;line-height:1.3!important;padding:4px 6px!important;border-radius:6px!important;background:rgba(7,14,24,.7)!important;color:#eaf3ff!important;backdrop-filter:blur(12px)!important;}
#grid .jfCoverTile .jfCoverInfo{position:absolute!important;display:flex!important;flex-direction:column!important;justify-content:flex-end!important;left:0!important;right:0!important;bottom:0!important;top:auto!important;z-index:2!important;padding:54px 11px 10px!important;box-sizing:border-box!important;border:0!important;border-radius:0!important;background:linear-gradient(to bottom,transparent 0%,rgba(3,8,17,.56) 38%,rgba(3,8,17,.9) 100%)!important;box-shadow:none!important;min-height:0!important;max-height:78%!important;pointer-events:none;}
#grid .jfCoverTile .jfCoverInfo :is(.creatorRow,.titleText,.actions){pointer-events:auto;}
#grid .jfCoverTile .creatorRow{display:flex!important;align-items:center!important;gap:7px!important;min-width:0!important;margin:0 0 6px!important;padding:0!important;}
#grid .jfCoverTile .creatorText{display:block!important;flex:0 1 auto!important;max-width:100%!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:12px!important;line-height:1.4!important;color:#edf4ff!important;font-weight:570!important;padding:0!important;margin:0!important;text-shadow:0 1px 5px #000d!important;}
#grid .jfCoverTile .titleText{display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:2!important;line-clamp:2!important;overflow:hidden!important;max-height:2.8em!important;min-height:0!important;line-height:1.4!important;color:#d3e0f2!important;font-size:11px!important;font-weight:450!important;margin:0 0 6px!important;padding:0!important;text-shadow:0 1px 6px #000d!important;}
body.studioHideVideoNames[data-studio-mode="video"] #grid .jfCoverTile .titleText{display:none!important;}
#grid .jfCoverTile .creatorEditBtn,#grid .jfCoverTile .creatorLinkBtn{width:21px!important;height:21px!important;min-width:21px!important;padding:2px!important;display:grid!important;place-items:center!important;color:#cee0f4!important;opacity:0!important;}
#grid .jfCoverTile :is(:hover,:focus-within)>.creatorEditBtn{opacity:1!important;}
#grid .jfCoverTile:hover .creatorEditBtn,#grid .jfCoverTile:hover .creatorLinkBtn,#grid .jfCoverTile:focus-within .creatorEditBtn,#grid .jfCoverTile:focus-within .creatorLinkBtn{opacity:.9!important;}
#grid .jfCoverTile .creatorEditBtn svg,#grid .jfCoverTile .creatorLinkBtn svg{width:15px!important;height:15px!important;display:block!important;}
#grid .jfCoverTile .actions{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:3px!important;width:100%!important;padding:0!important;margin:0!important;border:0!important;min-width:0!important;}
#grid .jfCoverTile .stars{display:flex!important;align-items:center!important;gap:0!important;min-width:0!important;transform:none!important;opacity:1!important;margin:0!important;padding:0!important;}
#grid .jfCoverTile .ratingStar{width:18px!important;min-width:18px!important;height:21px!important;flex:0 0 18px!important;padding:0!important;font-size:18px!important;line-height:21px!important;}
#grid .jfCoverTile .ratingValue{font-size:10px!important;margin-left:5px!important;color:#d5dcea!important;}
#grid .jfCoverTile .iconActions{display:flex!important;align-items:center!important;gap:3px!important;flex:0 0 auto!important;padding:0!important;margin:0!important;}
#grid .jfCoverTile .iconActions :is(.unifiedMore,.multiBtn){display:grid!important;place-items:center!important;width:27px!important;min-width:27px!important;height:27px!important;padding:4px!important;opacity:0!important;background:rgba(18,34,53,.74)!important;border:1px solid #d5eaff45!important;border-radius:8px!important;color:#ecf4ff!important;}
#grid .jfCoverTile:hover .iconActions :is(.unifiedMore,.multiBtn),#grid .jfCoverTile:focus-within .iconActions :is(.unifiedMore,.multiBtn){opacity:1!important;}
#grid .jfCoverTile .multiBtn svg{width:17px!important;height:17px!important;display:block!important;fill:none!important;stroke:currentColor!important;stroke-width:1.75!important;}
#grid .jfCoverTile .deleteBtn{display:none!important;}
#grid .jfCoverTile .mediaTileCheck{z-index:6!important;}
/* Audio explicitly flows across each row in sort order; column layout does not. */
#grid.audioFileGrid{display:grid!important;columns:auto!important;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))!important;grid-auto-flow:row!important;align-content:start!important;align-items:start!important;gap:12px!important;padding:17px 21px 90px!important;}
#grid.audioFileGrid .audioFileTile{margin:0!important;align-self:start!important;}
/* Shared tool vocabulary: matching glyphs and the same visual states on both players. */
.miniPlayer .miniAdvanced{width:226px!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:7px!important;padding:10px!important;border-radius:15px!important;background:linear-gradient(145deg,rgba(36,52,75,.93),rgba(12,22,37,.94))!important;}
.miniPlayer .miniAdvanced button{height:44px!important;border-radius:10px!important;display:grid!important;place-items:center!important;font-size:17px!important;font-weight:600!important;color:#dbeaff!important;background:rgba(108,146,196,.13)!important;border:1px solid rgba(195,219,247,.24)!important;}
.miniPlayer .miniAdvanced button svg{width:22px!important;height:22px!important;stroke-width:1.75!important;stroke-linejoin:round!important;stroke-linecap:round!important;}
.miniPlayer .miniAdvanced button:where(.active,.set){background:rgba(143,188,248,.32)!important;border-color:#b8d8ff8c!important;}
.feedHeader .feedHeaderActions .feedToolGlyph svg{stroke-linejoin:round!important;stroke-linecap:round!important;stroke-width:1.75!important;}
@media(max-width:700px){#grid.audioFileGrid{grid-template-columns:repeat(auto-fill,minmax(min(100%,172px),1fr))!important;gap:8px!important;padding:12px 12px 90px!important;}#grid:not(.videoTextGrid).grid{columns:175px!important;column-gap:9px!important;padding:12px 12px 90px!important;}.miniPlayer .miniAdvanced{left:0!important;right:auto!important;top:calc(100% + 7px)!important;}}


/* v6.19 — reading-order first. No CSS columns in sorted media grids. */
#grid.audioFileGrid{
 display:grid!important;columns:auto!important;
 grid-template-columns:repeat(auto-fill,minmax(min(100%,255px),1fr))!important;
 grid-auto-flow:row!important;align-items:stretch!important;align-content:start!important;
 gap:9px!important;
}
#grid.audioFileGrid .audioFileTile{
 box-sizing:border-box!important;display:flex!important;position:relative!important;
 height:149px!important;min-height:149px!important;max-height:149px!important;
 margin:0!important;align-self:stretch!important;
 padding:13px 14px 12px!important;
}
#grid.audioFileGrid .audioFileText{
 display:flex!important;flex-direction:column!important;
 width:100%!important;height:100%!important;min-height:0!important;
}
#grid.audioFileGrid .audioFileName{
 line-height:1.4!important;max-height:calc(1.4em * 3)!important;
 -webkit-line-clamp:3!important;line-clamp:3!important;
}
#grid.audioFileGrid .audioFileMeta{margin-top:6px!important;}
#grid.audioFileGrid .audioStars{margin-top:auto!important;padding-top:6px!important;}
/* Dense, ratio-correct justified rows. Native reading order, no visual column ordering. */
#grid.grid:not(.videoTextGrid){
 display:block!important;columns:auto!important;
 padding:16px 20px 90px!important;
}
#grid.grid:not(.videoTextGrid) .jfPosterRow{
 display:flex!important;align-items:flex-start!important;gap:11px!important;
 width:100%!important;margin:0 0 11px!important;
}
#grid.grid:not(.videoTextGrid) .jfPosterRow>.jfCoverTile{
 box-sizing:border-box!important;display:block!important;
 flex:0 0 var(--jf-slot-w)!important;width:var(--jf-slot-w)!important;
 min-width:0!important;margin:0!important;
}
@media(max-width:700px){
 #grid.audioFileGrid{grid-template-columns:repeat(auto-fill,minmax(min(100%,175px),1fr))!important;gap:8px!important;}
 #grid.audioFileGrid .audioFileTile{height:143px!important;min-height:143px!important;max-height:143px!important;padding:10px!important;}
 #grid.grid:not(.videoTextGrid){padding:12px 12px 90px!important;}
 #grid.grid:not(.videoTextGrid) .jfPosterRow{gap:8px!important;margin-bottom:8px!important;}
}

/* v6.20 — compact conversion progress; never masks player controls */
#jfMediaJobHUD:not([hidden]){position:fixed;top:13px;left:50%;transform:translateX(-50%);width:205px;max-width:calc(100vw - 30px);z-index:300020;padding:8px 11px;border-radius:11px;border:1px solid rgba(207,228,250,.25);background:rgba(8,17,30,.78);backdrop-filter:blur(18px);color:#cedef1;box-shadow:0 7px 25px #0007;font:11px/1.35 system-ui;pointer-events:none}
#jfMediaJobHUD .jfJobLine{display:flex;align-items:center;justify-content:space-between;gap:12px;white-space:nowrap}
#jfMediaJobHUD .jfJobName{overflow:hidden;text-overflow:ellipsis}
#jfMediaJobHUD .jfJobPercent{font-variant-numeric:tabular-nums;color:#e1f0ff}
#jfMediaJobHUD .jfJobTrack{height:2px;margin-top:6px;border-radius:6px;background:#8da8c041;overflow:hidden}
#jfMediaJobHUD .jfJobTrack i{display:block;width:0;height:100%;border-radius:inherit;background:#a7cff7;transition:width .25s linear}
/* v6.21: video text cards and audio cards share a strict row-first fixed grid. */
#grid.videoTextGrid{display:grid!important;columns:auto!important;grid-template-columns:repeat(auto-fill,minmax(min(100%,255px),1fr))!important;grid-auto-flow:row!important;gap:9px!important;align-content:start!important;align-items:stretch!important;padding:17px 21px 90px!important}
#grid.videoTextGrid .videoTextTile{box-sizing:border-box!important;display:flex!important;flex-direction:column!important;width:100%!important;height:149px!important;min-height:149px!important;max-height:149px!important;margin:0!important;padding:13px 14px 12px!important;break-inside:auto!important;overflow:hidden!important}
#grid.videoTextGrid .videoTextContent{display:flex!important;flex-direction:column!important;height:100%!important;min-height:0!important;width:100%!important;overflow:hidden!important}
#grid.videoTextGrid .videoTextHeading{flex:0 1 auto!important;min-height:0!important}
#grid.videoTextGrid .videoTextAuthor{flex:0 0 auto!important;margin-top:3px!important;white-space:nowrap!important;overflow:hidden!important}
#grid.videoTextGrid .videoTextMeta{flex:0 0 auto!important;margin-top:3px!important}
#grid.videoTextGrid .videoTextFoot{margin-top:auto!important;padding-top:8px!important;flex:0 0 auto!important}
@media(max-width:700px){#grid.videoTextGrid{grid-template-columns:repeat(auto-fill,minmax(min(100%,172px),1fr))!important;gap:8px!important;padding:12px 12px 90px!important}#grid.videoTextGrid .videoTextTile{height:143px!important;min-height:143px!important;max-height:143px!important}}
/* Rail open: move the mini-music control rather than stretching/overlapping either glass surface. */
.audioDock.isMinimized:not([hidden]){translate:var(--jf-rail-music-shift,0px) 0!important}
/* Hover previews are silent ephemeral elements; they never participate in global playback state. */
#grid .jfCoverTile .coverWrap>.jfHoverPreview{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:1;pointer-events:none}
#grid .jfCoverTile .coverWrap.previewLoading:after{content:"";position:absolute;top:10px;right:10px;width:11px;height:11px;border:2px solid #ffffff55;border-top-color:#e7f5ff;border-radius:50%;animation:jfPreviewSpin .9s linear infinite;z-index:5;pointer-events:none}
@keyframes jfPreviewSpin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){#grid .jfCoverTile .coverWrap.previewLoading:after{animation:none}}
</style>
<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,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">
</head>
<body>
<header class="studioHeader">
  <div class="top studioTop">
    <div class="studioBrand studioBrandLogoOnly" aria-label="首页标识"><img class="studioBrandLogo" src="data:image/png;base64,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" alt="" decoding="async"></div>
    <div class="studioTopRight"><span class="studioLocal"><i></i> 本地媒体库</span></div>
  </div>
  <div class="studioWorkspace">
    <div class="studioContextTitle"><span class="studioEyebrow">LIBRARY / COLLECTION</span><h1 id="studioModeTitle">视频工作台</h1></div>
    <div class="studioControls">
      <label class="studioSearchWrap" for="search"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/></svg><input id="search" type="search" autocomplete="off" aria-label="搜索当前媒体库" placeholder="搜索媒体、创作者…"><kbd>⌘ K</kbd></label>
      <div class="studioActions"><button type="button" id="unifiedFavoriteFilter" hidden class="unifiedHeaderButton" aria-pressed="false" title="只显示收藏的媒体"><span class="studioTopActionIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3 6.4 7 .9-5.1 4.9 1.2 7L12 18l-6.1 3.2 1.2-7L2 9.3l7-.9z"/></svg></span><span class="studioFavoriteLabel">收藏</span></button><button type="button" id="videoViewToggle" class="studioViewToggle" aria-label="切换视频列表展示方式" title="切换封面与纯文字视图" aria-pressed="false"><svg class="videoViewGlyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m5 16 5-5 4 4 3-3 4 4"/><circle cx="16" cy="9" r="1"/></svg></button><button type="button" id="studioNameToggle" class="studioNameToggle" aria-label="显示或隐藏视频文件名" title="显示或隐藏视频文件名" aria-pressed="true">名称</button><button type="button" id="unifiedSelectTop" class="unifiedHeaderButton" aria-pressed="false">选择</button><button id="creatorToggle" class="creatorToggle" type="button">创作者 ▾</button><div class="studioSort"><button id="sortRatingBtn" class="sortBtn active" type="button">评分 ↓</button><button id="sortMtimeBtn" class="sortBtn" type="button">修改时间 ↓</button></div></div>
    </div>
  </div>
  <div id="creatorPanel" class="creatorPanel collapsed"><div id="creatorTags" class="creatorTags"></div></div>
  <div class="studioStatus"><span class="studioStatusDot" aria-hidden="true"></span><div id="status" class="status" role="status" aria-live="polite">读取中…</div><span class="studioHint">双击标题可编辑 · 右键查看更多操作</span></div>
</header>
    <button type="button" id="studioRailToggle" aria-label="展开媒体导航" aria-controls="studioMediaRail" aria-expanded="false" title="展开媒体导航"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9 4.5v15M12.5 9h4M12.5 14h4"/></svg></button>
    <div id="studioMediaRail" class="mediaTabs" role="tablist" aria-label="媒体类型">
      <button type="button" class="on" data-media-kind="video" role="tab" aria-selected="true"><span class="studioTabIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg></span> 视频</button>
      <button type="button" data-media-kind="image" role="tab" aria-selected="false"><span class="studioTabIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 4 3 3-4 4 6"/></svg></span> 图片</button>
      <button type="button" data-media-kind="audio" role="tab" aria-selected="false"><span class="studioTabIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 18V5l10-2v13"/><ellipse cx="7" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg></span> 音频</button>
      <button id="clipShelfTop" class="clipShelfButton" type="button" title="片段库" aria-label="打开片段库"><span class="studioTopActionIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span>片段库</button>
    </div>

<section id="photoToolbar" class="photoToolbar" hidden aria-label="图片图库控制栏">
  <div class="photoToolbarHead"><div><strong>图库</strong><span id="photoSummary" class="photoSummary">正在整理图片…</span></div>
  <div class="photoToolbarActions">
    <button type="button" id="photoRatio" title="切换方格/原比例布局"><span class="studioTopActionIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg></span><span class="studioRatioLabel">方格</span></button>
    <label class="photoZoomControl" title="调节图片网格密度">大小 <input id="photoCellSize" aria-label="图片缩略图大小" type="range" min="90" max="250" step="10" value="150"></label>
    <button type="button" id="photoSelect" aria-pressed="false" hidden>选择</button>
  </div></div>
  <div id="photoSelectionBar" class="photoSelectionBar" hidden><span id="photoSelectedCount">已选择 0 张</span><button type="button" id="photoSelectAll">全选当前目录</button><button type="button" id="photoDeleteSelected" class="photoDestructive" disabled>删除选中</button><button type="button" id="photoCancelSelect">完成</button></div>
</section>
<section id="studioEntrance" class="studioEntrance" hidden aria-label="媒体首页"></section>
<nav id="assetFolders" class="assetFolders" style="display:none"></nav>
<div id="folderTiles" class="assetFolderTiles" style="display:none"></div>
<div id="folderContext" class="folderContext" style="display:none"></div>
<main id="grid" class="grid"></main>
<section id="unifiedBatchBar" class="unifiedBatchBar" hidden aria-label="批量媒体操作">
  <strong id="unifiedCount">已选 0 项</strong><button id="unifiedSelectAll" type="button">全选当前列表</button>
  <button id="unifiedFavorite" type="button" disabled hidden>☆ 收藏</button>
  <button id="unifiedMove" type="button" disabled>移动到…</button>
  <button id="unifiedExport" type="button" disabled hidden title="一次导出一个文件，多文件打包将在后续版本实现">导出单项</button>
  <button id="unifiedDelete" class="danger" type="button" disabled>删除</button>
  <button id="unifiedFinish" type="button">完成</button>
</section>
<div id="unifiedContext" class="unifiedContext" role="menu" hidden></div>
<div id="unifiedRenameBack" class="unifiedRenameBack" hidden role="presentation">
  <form id="unifiedRenameForm" class="unifiedRenamePanel" role="dialog" aria-modal="true" aria-labelledby="unifiedRenameHeading">
    <h3 id="unifiedRenameHeading">重命名</h3><p>修改当前媒体名称。</p>
    <label for="unifiedRenameInput">文件名称</label><div class="unifiedRenameRow"><input id="unifiedRenameInput" maxlength="180" required><span id="unifiedRenameExt"></span></div>
    <div class="unifiedRenameButtons"><button id="unifiedRenameCancel" type="button">取消</button><button type="submit" class="primary">保存</button></div>
  </form>
</div>
<div id="unifiedMoveBack" class="unifiedMoveBack" hidden>
  <form id="unifiedMoveForm" class="unifiedMovePanel" role="dialog" aria-modal="true" aria-labelledby="unifiedMoveHeading">
    <h3 id="unifiedMoveHeading">移动到目录</h3>
    <p id="unifiedMoveSummary">选择要移动到的素材目录。</p>
    <label>目标目录<select id="unifiedMoveTarget" required></select></label>
    <div class="unifiedMoveActions"><button type="button" id="unifiedMoveCancel">取消</button><button type="submit">移动</button></div>
  </form>
</div>
<div id="unifiedAlbumBack" class="unifiedAlbumBack" hidden>
  <form id="unifiedAlbumForm" class="unifiedMovePanel" role="dialog" aria-modal="true" aria-labelledby="unifiedAlbumHeading">
    <h3 id="unifiedAlbumHeading">新建相簿 / 文件夹</h3>
    <p id="unifiedAlbumHelp">创建一个媒体目录。</p>
    <label>名称<input id="unifiedAlbumName" maxlength="100" autocomplete="off" required placeholder="例如：漫画合集"></label>
    <label id="unifiedAlbumParentLabel">上级目录<select id="unifiedAlbumParent" required></select></label>
    <div class="unifiedMoveActions"><button type="button" id="unifiedAlbumCancel">取消</button><button type="submit" id="unifiedAlbumSubmit">新建</button></div>
  </form>
</div>
<div id="unifiedToast" class="unifiedToast" role="status" aria-live="polite" hidden></div>
<section id="audioDock" class="audioDock" hidden aria-label="当前音频播放器"></section>
<div id="assetView" class="assetView photoDetail" role="dialog" aria-modal="true" aria-label="图片浏览" aria-hidden="true">
  <button type="button" id="assetClose" class="photoFloatClose" aria-label="关闭图片浏览" title="关闭 (Esc)">×</button>
  <button type="button" id="photoRailToggle" class="photoFloatRailToggle" aria-label="收起图片列表" aria-pressed="true" title="显示/隐藏缩略图 (I)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M10 3v18M3 9h7M3 15h7"/></svg></button>
  <aside class="photoDetailRail" aria-label="图片缩略图轨道"><div id="photoFilmstrip" class="photoFilmstrip" aria-label="附近图片"></div></aside>
  <div id="photoDetailStage" class="photoDetailStage"><button type="button" id="assetPrev" class="photoSideArrow" aria-label="上一张">‹</button><div class="photoImageSurface"><img id="assetViewImg" alt="图片预览" draggable="false"><span class="photoLoading">加载中…</span></div><button type="button" id="assetNext" class="photoSideArrow" aria-label="下一张">›</button></div>
  <button type="button" id="photoFilterToggle" class="photoFloatFilter" aria-label="图片滤镜" title="滤镜"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5M8 3l.9 3 3.1.9-3.1.9L8 11l-.9-3.2L4 7l3.1-.9zM18 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/></svg></button>
  <aside class="jfFilterPanel" data-jf-mode="photo" role="group" aria-label="滤镜预览" hidden>
  <div class="jfFilterTop"><span>滤镜</span><button type="button" class="jfFilterClose" aria-label="关闭滤镜">×</button></div>
  <div class="jfFilterPresets"><button type="button" data-jf-preset="none" aria-label="原片" title="原片" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M6.3 17.7 17.7 6.3"/></svg></button><button type="button" data-jf-preset="clear" aria-label="清透" title="清透" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-2.9 4-6.5 7.5-6.5 11.2a6.5 6.5 0 0 0 13 0C18.5 10.5 14.9 7 12 3Z"/><path d="M9 16c.4 1.3 1.3 2 2.6 2.1"/></svg></button><button type="button" data-jf-preset="cream" aria-label="奶油" title="奶油" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7.5"/><path d="M7.2 8.5c1.8-2.8 5.6-3.3 8.2-.9M6.5 14.5c1.6 3.3 6.1 4.1 9.3 2"/></svg></button><button type="button" data-jf-preset="night" aria-label="夜景" title="夜景" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M19 15.7A8 8 0 0 1 8.3 5a8.4 8.4 0 1 0 10.7 10.7Z"/><path d="M17.5 4.5v4M15.5 6.5h4"/></svg></button><button type="button" data-jf-preset="bold" aria-label="浓颜" title="浓颜" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17c3-9 6-9 8-3s5 6 8-7"/><path d="M4 21h16"/></svg></button><button type="button" data-jf-preset="flame" aria-label="暖焰" title="暖焰" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c-4.5 0-7-3-7-7 0-4.4 3.5-7.4 5-11 .5 3.8 2.1 4.2 2.9 5.1C15.2 9.7 17 8 17.1 6c5.4 8.7 4.2 16-5.1 16Z"/><path d="M12 21c-2.3 0-3.2-1.6-3.2-3.4 0-1.5 1.6-3.2 3.2-4.9.2 2.4 2.8 3.7 2.8 5 0 1.7-1.1 3.3-2.8 3.3Z"/></svg></button><button type="button" data-jf-preset="honey" aria-label="蜜色" title="蜜色" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 7.7 4.5v9L12 20l-7.7-4.5v-9L12 2Z"/><path d="m12 7-4.4 2.5v5L12 17l4.4-2.5v-5L12 7Z"/></svg></button><button type="button" data-jf-preset="vivid" aria-label="艳丽" title="艳丽" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z"/></svg></button><button type="button" data-jf-preset="matrix" aria-label="数字矩阵" title="数字矩阵" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5v3m0 4v2M12 3v5m0 4v5m7-12v2m0 4v5"/><path d="M5 17.5h.01M12 21h.01M19 21h.01" stroke-width="3"/><path d="M8.5 8.5h.01M15.5 11h.01" stroke-width="2.4"/></svg></button></div>
  <div class="jfFilterStrength"><label>强度 <output data-jf-value>65%</output></label><input type="range" min="0" max="100" step="1" value="65" data-jf-strength aria-label="滤镜强度"></div>
  <small>仅实时预览，不修改原片</small>
 </aside>
  <button type="button" id="photoMoreToggle" class="photoFloatMore" aria-label="图片操作" aria-expanded="false" title="图片操作">···</button>
  <div id="photoMorePanel" class="photoMorePanel" hidden><button type="button" id="photoDeleteOne" class="photoDestructive">删除图片</button></div>
  <button type="button" id="photoZoomButton" hidden tabindex="-1" aria-hidden="true">放大</button><button type="button" id="photoDownload" hidden tabindex="-1" aria-hidden="true">保存原图</button>
  <span id="assetViewName" hidden></span><small id="photoDetailCount" hidden></small>
</div>

<div id="feedOverlay" class="feedOverlay" aria-hidden="true">
  <div class="feedHeader">
    <button id="feedClose" class="feedClose" type="button" title="关闭">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"></path></svg>
    </button>
    <button id="feedToolsToggle" class="feedToolsToggle" type="button" aria-label="展开播放工具" aria-expanded="false" aria-controls="feedToolPanel" title="工具 (T)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></button>
    <button id="feedRatingToggle" class="feedRatingToggle" type="button" aria-label="显示评分" aria-pressed="false" title="评分 (R)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.7 2.9 6 6.7 1-4.9 4.8 1.2 6.8-5.9-3.1-6 3.1 1.2-6.8-4.9-4.8 6.7-1z"/></svg></button>
    <button id="feedRailToggle" class="feedRailToggle" type="button" aria-label="展开相邻媒体" aria-pressed="false" title="相邻媒体 (L)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M10 3v18M4 9h6M4 15h6"/></svg></button>
    <div id="feedToolPanel" class="feedHeaderActions" role="toolbar" aria-label="视频操作工具栏">
      <div class="feedToolGroup" role="group" aria-label="区间循环与片段">
        <button id="feedSetA" class="feedABBtn feedTool " type="button" title="将当前播放位置设为 A 点（起点）" aria-label="设置 A 点，区间起点"><span class="feedToolLabel">标记 A 点</span></button>
        <button id="feedSetB" class="feedABBtn feedTool " type="button" title="将当前播放位置设为 B 点（终点）" aria-label="设置 B 点，区间终点"><span class="feedToolLabel">标记 B 点</span></button>
        <button id="feedABLoop" class="feedABBtn feedTool " type="button" title="开启 A-B 区间循环" aria-label="开启 A-B 区间循环"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 8V5h12a5 5 0 0 1 5 5v1m-3-3 3 3 3-3M21 16v3H9a5 5 0 0 1-5-5v-1m3 3-3-3-3 3"/></svg></span><span class="feedToolLabel">区间循环</span></button>
        <button id="feedGhostLoop" class="feedABBtn feedTool" type="button" title="鬼畜：画面正放倒放交替，音轨始终正放（最长 20 秒）" aria-label="鬼畜循环" aria-pressed="false"><span class="feedToolLabel">鬼畜</span></button>
        
      </div>
      <div class="feedToolGroup" role="group" aria-label="编辑与导出">
        
        <button id="feedPortrait" class="feedABBtn feedPortrait feedTool " type="button" title="选择 9:16 取景范围并生成竖屏 MP4" aria-label="选择 9:16 取景范围并生成竖屏 MP4"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/></svg></span><span class="feedToolLabel">竖屏裁剪</span></button>
        <button id="feedScreenshot" class="feedABBtn feedTool " type="button" title="逐帧截图或设置封面" aria-label="逐帧截图或设置封面"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h4l2-2h4l2 2h4v13H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span><span class="feedToolLabel">逐帧截图</span></button>
        <button id="feedAudio" class="feedABBtn feedTool " type="button" title="提取视频完整音轨" aria-label="提取视频完整音轨"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10 18V5l10-2v13"/><ellipse cx="7" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg></span><span class="feedToolLabel">提取音轨</span></button>
      </div>
      <div class="feedToolGroup" role="group" aria-label="观看与窗口">
        <button id="feedMagnify" class="feedMagnify feedTool " type="button" title="切换聚焦模式" aria-label="切换聚焦模式"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 5 5"/></svg></span><span class="feedToolLabel">聚焦</span></button>
        <button type="button" id="feedFilter" class="feedTool" title="滤镜 · 实时预览" aria-label="打开滤镜"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 19 19 5M8 3l.9 3 3.1.9-3.1.9L8 11l-.9-3.2L4 7l3.1-.9zM18 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/></svg></span><span class="feedToolLabel">滤镜</span></button>
        <button id="feedRotate" class="feedRotate feedTool " type="button" title="旋转当前视频" aria-label="旋转当前视频"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 8v-5l-4 4a8 8 0 1 0 4 6"/></svg></span><span class="feedToolLabel">旋转</span></button>
        <button id="feedMulti" class="feedMulti feedTool " type="button" title="在浮动窗口打开" aria-label="在浮动窗口打开"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="12" height="12" rx="2"/><path d="M9 9h9a2 2 0 0 1 2 2v9H11a2 2 0 0 1-2-2z"/></svg></span><span class="feedToolLabel">浮窗</span></button>
      </div>
      <div class="feedToolGroup feedToolGroupDanger" role="group" aria-label="危险操作">
        <button id="feedDelete" class="feedDelete feedTool " type="button" title="删除当前媒体（需要二次确认）" aria-label="删除当前媒体（需要二次确认）"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></span><span class="feedToolLabel">删除</span></button>
      </div>
    </div>
  </div>
  <aside id="feedABQuickActions" class="feedABQuickActions" hidden role="group" aria-label="A/B 循环快捷操作"><button id="feedClipShelf" class="feedABBtn feedTool " type="button" title="打开 A-B 片段库（只记录区间）" aria-label="打开 A-B 片段库（只记录区间）"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span><span class="feedToolLabel">片段库</span></button><button id="feedClip" class="feedABBtn feedTool " type="button" title="将 A-B 区间截取为新视频" aria-label="将 A-B 区间截取为新视频"><span class="feedToolGlyph" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="m8 8 12 12M8 16 20 4"/></svg></span><span class="feedToolLabel">截取片段</span></button></aside>
  <aside id="feedFilmstrip" class="feedFilmstrip" aria-label="相邻媒体快捷切换"></aside>
  <aside id="studioRatingDock" class="studioRatingDock" role="group" aria-label="视频评分" hidden></aside>
  <aside class="jfFilterPanel" data-jf-mode="video" role="group" aria-label="滤镜预览" hidden>
  <div class="jfFilterTop"><span>滤镜</span><button type="button" class="jfFilterClose" aria-label="关闭滤镜">×</button></div>
  <div class="jfFilterPresets"><button type="button" data-jf-preset="none" aria-label="原片" title="原片" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M6.3 17.7 17.7 6.3"/></svg></button><button type="button" data-jf-preset="clear" aria-label="清透" title="清透" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-2.9 4-6.5 7.5-6.5 11.2a6.5 6.5 0 0 0 13 0C18.5 10.5 14.9 7 12 3Z"/><path d="M9 16c.4 1.3 1.3 2 2.6 2.1"/></svg></button><button type="button" data-jf-preset="cream" aria-label="奶油" title="奶油" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7.5"/><path d="M7.2 8.5c1.8-2.8 5.6-3.3 8.2-.9M6.5 14.5c1.6 3.3 6.1 4.1 9.3 2"/></svg></button><button type="button" data-jf-preset="night" aria-label="夜景" title="夜景" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M19 15.7A8 8 0 0 1 8.3 5a8.4 8.4 0 1 0 10.7 10.7Z"/><path d="M17.5 4.5v4M15.5 6.5h4"/></svg></button><button type="button" data-jf-preset="bold" aria-label="浓颜" title="浓颜" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17c3-9 6-9 8-3s5 6 8-7"/><path d="M4 21h16"/></svg></button><button type="button" data-jf-preset="flame" aria-label="暖焰" title="暖焰" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c-4.5 0-7-3-7-7 0-4.4 3.5-7.4 5-11 .5 3.8 2.1 4.2 2.9 5.1C15.2 9.7 17 8 17.1 6c5.4 8.7 4.2 16-5.1 16Z"/><path d="M12 21c-2.3 0-3.2-1.6-3.2-3.4 0-1.5 1.6-3.2 3.2-4.9.2 2.4 2.8 3.7 2.8 5 0 1.7-1.1 3.3-2.8 3.3Z"/></svg></button><button type="button" data-jf-preset="honey" aria-label="蜜色" title="蜜色" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 7.7 4.5v9L12 20l-7.7-4.5v-9L12 2Z"/><path d="m12 7-4.4 2.5v5L12 17l4.4-2.5v-5L12 7Z"/></svg></button><button type="button" data-jf-preset="vivid" aria-label="艳丽" title="艳丽" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z"/></svg></button><button type="button" data-jf-preset="matrix" aria-label="数字矩阵" title="数字矩阵" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5v3m0 4v2M12 3v5m0 4v5m7-12v2m0 4v5"/><path d="M5 17.5h.01M12 21h.01M19 21h.01" stroke-width="3"/><path d="M8.5 8.5h.01M15.5 11h.01" stroke-width="2.4"/></svg></button></div>
  <div class="jfFilterStrength"><label>强度 <output data-jf-value>65%</output></label><input type="range" min="0" max="100" step="1" value="65" data-jf-strength aria-label="滤镜强度"></div>
  <small>仅实时预览，不修改原片</small>
 </aside>
  <div id="feedScroller" class="feedScroller"></div>
</div>

<div id="clipShelfBack" class="clipShelfBack" role="dialog" aria-modal="true" aria-label="A/B 视频片段库" hidden>
  <section class="clipShelf">
    <header class="clipShelfHead"><div><h2>片段库</h2></div><div class="clipShelfHeadActions"><button id="clipShelfNew" type="button" title="保存当前 A-B 区间" aria-label="保存当前 A-B 区间">＋</button><button id="clipShelfClose" type="button" title="关闭">×</button></div></header>
    <div class="clipShelfToolbar" hidden><input id="clipShelfSearch" type="search" placeholder="搜索片段"><label><input id="clipShelfOnly" type="checkbox">仅当前</label><label hidden><input id="clipShelfFavOnly" type="checkbox">收藏</label></div>
    <main id="clipShelfList" class="clipShelfList"></main>
    <form id="clipShelfForm" class="clipShelfForm" hidden><div id="clipShelfFormTip" style="color:#aebacc;font-size:12px"></div>
      <div class="clipShelfFormFields"><label>片段名称<input id="clipShelfName" required maxlength="100" placeholder="例如：经典表情循环"></label><label>A 起点（秒）<input id="clipShelfA" required inputmode="decimal" placeholder="0:02.500"></label><label>B 终点（秒）<input id="clipShelfB" required inputmode="decimal" placeholder="0:04.800"></label><label style="display:none;align-items:center"><input id="clipShelfFav" type="checkbox"> 收藏</label></div>
      <div class="clipShelfFormActions"><span id="clipShelfToast" class="clipShelfToast"></span><button id="clipShelfCancelEdit" type="button">取消</button><button id="clipShelfSubmit" class="primary" type="submit">保存片段</button></div>
    </form>
  </section>
</div>
<div id="multiDock" class="multiDock"></div>

<button id="miniSyncStart" class="miniSyncStart" type="button" title="全部多开视频从 0 秒同时播放" aria-label="全部多开视频从 0 秒同时播放">0 ▶</button>

<button id="miniVisibilityToggle" class="miniVisibilityToggle" type="button" title="暂时隐藏多开窗口" aria-label="暂时隐藏多开窗口">
  <svg class="eyeOn" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6"></path>
    <circle cx="12" cy="12" r="2.6"></circle>
  </svg>
  <svg class="eyeOff" viewBox="0 0 24 24" aria-hidden="true" style="display:none">
    <path d="M3 3l18 18"></path>
    <path d="M10.6 6.2A10.5 10.5 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.2 2.9"></path>
    <path d="M6.2 6.4C3.8 8.1 2.5 12 2.5 12s3.5 6 9.5 6c1.7 0 3.2-.5 4.5-1.2"></path>
  </svg>
</button>

<script>
// 工作台级快捷键；不劫持播放器、弹窗中的方向键或媒体按键。
document.addEventListener('keydown', event => {
  const target=event.target;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k') {
    if (document.querySelector('.feedOverlay.open, .assetView.open, .shotStudioBack, .clipShelfBack:not([hidden])')) return;
    event.preventDefault(); document.querySelector('#search').focus(); document.querySelector('#search').select();
  } else if (event.key==='/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
    !target.closest('input, textarea, select, [contenteditable="true"]') &&
    !document.querySelector('.feedOverlay.open, .assetView.open, .shotStudioBack, .clipShelfBack:not([hidden])')) {
    event.preventDefault(); document.querySelector('#search').focus();
  }
});
let allItems = [];
let allFolders = [];
// 媒体目录导航：首次进入视频默认「原媒体目录」；保留每类媒体上次浏览位置。
// 仅保存界面偏好，不写入媒体库 data.json，也不影响 hash 文件名。
const MEDIA_FOLDER_DEFAULTS = {video:'root', image:'all', audio:'all'};
function safeMediaFolderValue(value) {
  if (value === 'root' || value === 'all' || value === 'data') return value;
  return typeof value === 'string' && value.startsWith('data/') && value.slice(5).split('/').every(part => /^(?:[a-f0-9]{32}|1001|1002)$/i.test(part)) ? value : null;
}
// Folder choice and active media tab are transient UI state, never remembered across reloads.
try { localStorage.removeItem('douyin-media-folders-v1'); sessionStorage.removeItem('douyin-media-current-tab-v1'); } catch (_) {}
const mediaFolderPositions = {...MEDIA_FOLDER_DEFAULTS};
let libraryMode = 'video';
let activeFolder = MEDIA_FOLDER_DEFAULTS.video;
function mediaFolderExists(dir) {
  return dir === 'all' || dir === 'root' || dir === 'data' ||
    dir === 'data/1001' || dir === 'data/1002' ||
    allFolders.some(folder => folder.relativeDir === dir);
}
function rememberMediaFolder(dir) {
  const value = safeMediaFolderValue(dir);
  if (!value || !mediaFolderExists(value)) return false;
  activeFolder = value;
  mediaFolderPositions[libraryMode] = value;
  return true;
}
function ensureMediaFolderExists() {
  if (mediaFolderExists(activeFolder)) return;
  rememberMediaFolder(MEDIA_FOLDER_DEFAULTS[libraryMode]);
}
function changeMediaCategory(kind) {
  if (!Object.hasOwn(MEDIA_FOLDER_DEFAULTS, kind)) return;
  const switching = kind !== libraryMode;
  libraryMode = kind;
  // 点击「视频」始终快速返回原媒体目录；图片和音频保持上次浏览目录。
  const destination = kind === 'video'
    ? 'root'
    : (mediaFolderPositions[kind] || MEDIA_FOLDER_DEFAULTS[kind]);
  if (switching || kind === 'video') {
    if (!rememberMediaFolder(destination)) rememberMediaFolder(MEDIA_FOLDER_DEFAULTS[kind]);
  } else {
    ensureMediaFolderExists();
  }
}
let fileSortAscending = true;
const filenameCollator = new Intl.Collator('zh-CN', {numeric:true, sensitivity:'base'});
let imageViewerList = [];
let imageViewerIndex = 0;
let photoSelectMode = false;
let photoSelectedKeys = new Set();
let mediaSelectMode = false;
let unifiedFavoriteOnly = false;
const mediaSelectedKeys = photoSelectedKeys;
let unifiedRenameKey = null;
let unifiedLastSelectedKey = null;
let unifiedSuppressClickUntil = 0;
let unifiedToastTimer = null;
let photoOriginalRatio = false;
let photoObserver = null;
let photoTileSize = (typeof window !== 'undefined' && window.matchMedia('(max-width:700px)').matches) ? 105 : 150;
let photoViewerZoomed = false;
let photoViewerTouchStart = null;
let photoViewerScale=1, photoViewerPanX=0, photoViewerPanY=0;
function applyPhotoTransform(){
  const img=document.getElementById('assetViewImg');
  if(!img)return;
  img.style.transform='translate3d('+photoViewerPanX+'px,'+photoViewerPanY+'px,0) scale('+photoViewerScale+')';
  img.style.cursor=photoViewerScale>1?'grab':'zoom-in';
  photoViewerZoomed=photoViewerScale>1;
}
function setPhotoScale(scale,cx,cy){
  const surface=document.querySelector('.photoImageSurface');if(!surface)return;
  const rect=surface.getBoundingClientRect();
  const centerX=rect.left+rect.width/2,centerY=rect.top+rect.height/2;
  const newScale=Math.min(8,Math.max(1,scale));
  const factor=newScale/photoViewerScale;
  if(newScale===1){photoViewerPanX=0;photoViewerPanY=0;}
  else if(Number.isFinite(cx)&&Number.isFinite(cy)){
    photoViewerPanX=(cx-centerX)-(cx-centerX-photoViewerPanX)*factor;
    photoViewerPanY=(cy-centerY)-(cy-centerY-photoViewerPanY)*factor;
  }
  photoViewerScale=newScale;applyPhotoTransform();
}

let selectedCreator = '';
let creatorOpen = false;
let sortMode = 'rating';
let sortDirection = 'desc';
let lastStamp = '';


// VOLUME_PREF_START
// 全局视频音量偏好：默认 10%。用户在任意视频上调整后，
// 会持久化到浏览器本地，并立即同步到当前页面的其他视频。
// 只记音量值，不记 muted 状态，避免误点静音后永久静音。
const DEFAULT_VIDEO_VOLUME = 0.10;
const VIDEO_VOLUME_STORAGE_KEY = 'douyin-video-volume';

function normalizeRememberedVolume(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return DEFAULT_VIDEO_VOLUME;
  }

  return Math.max(
    0,
    Math.min(1, number)
  );
}

function readRememberedVolume() {
  try {
    const raw =
      localStorage.getItem(
        VIDEO_VOLUME_STORAGE_KEY
      );

    if (
      raw === null ||
      raw === ''
    ) {
      return DEFAULT_VIDEO_VOLUME;
    }

    return normalizeRememberedVolume(
      raw
    );
  } catch {
    return DEFAULT_VIDEO_VOLUME;
  }
}

let rememberedVideoVolume =
  readRememberedVolume();

function saveRememberedVolume(value) {
  rememberedVideoVolume =
    normalizeRememberedVolume(
      value
    );

  try {
    localStorage.setItem(
      VIDEO_VOLUME_STORAGE_KEY,
      String(rememberedVideoVolume)
    );
  } catch {}

  return rememberedVideoVolume;
}

function applyRememberedVolume(video) {
  if (!video) {
    return;
  }

  const current =
    Number(video.volume);

  if (
    !Number.isFinite(current) ||
    Math.abs(
      current -
      rememberedVideoVolume
    ) > 0.0001
  ) {
    try {
      video.volume =
        rememberedVideoVolume;
    } catch {}
  }
}

function hasIndependentVolume(video) {
  return Boolean(
    video &&
    video.dataset &&
    video.dataset.independentVolume === '1'
  );
}

function syncRememberedVolume(
  sourceVideo
) {
  document
    .querySelectorAll('video')
    .forEach(
      video => {
        if (
          video !== sourceVideo &&
          !hasIndependentVolume(video)
        ) {
          applyRememberedVolume(
            video
          );
        }
      }
    );
}

function installRememberedVolume(video) {
  if (!video) {
    return;
  }

  // 每次视频重新进入使用状态时，都重新套用当前全局音量。
  applyRememberedVolume(video);

  if (
    video.dataset.volumeMemoryInstalled ===
      '1'
  ) {
    return;
  }

  video.dataset.volumeMemoryInstalled =
    '1';

  video.addEventListener(
    'volumechange',
    () => {
      // 多开窗口使用独立音量：只改变当前 video，
      // 不覆盖全局记忆，也不影响其他普通/多开视频。
      if (
        hasIndependentVolume(
          video
        )
      ) {
        return;
      }

      const next =
        normalizeRememberedVolume(
          video.volume
        );

      // 我们给其他普通视频同步音量时也会触发 volumechange。
      // 值已经一致就直接退出，避免事件互相递归。
      if (
        Math.abs(
          next -
          rememberedVideoVolume
        ) <= 0.0001
      ) {
        return;
      }

      saveRememberedVolume(
        next
      );

      syncRememberedVolume(
        video
      );
    }
  );
}
// VOLUME_PREF_END

const esc = value =>
  String(value ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');

function formatTime(sec) {
  sec = Number(sec);

  if (!Number.isFinite(sec)) {
    return '';
  }

  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);

  return h
    ? h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0')
    : m + ':' + String(s).padStart(2,'0');
}

function feedRatingMarkup(item) {
  const rating =
    Number(item.rating || 0);

  const stars =
    [1,2,3,4,5]
      .map(n => {
        const fill =
          Math.max(
            0,
            Math.min(
              100,
              (rating - (n - 1)) * 100
            )
          );

        return (
          '<button class="ratingStar" type="button" aria-label="评分 ' + n + '">' +
            '<span class="ratingStarBase">★</span>' +
            '<span class="ratingStarFill" style="width:' + fill + '%">★</span>' +
          '</button>'
        );
      })
      .join('');

  return (
    '<div class="stars feedRating" data-key="' +
      esc(item.key) +
      '" data-rating="' +
      rating +
      '" title="拖动或点击评分">' +
      stars +
      '<span class="ratingValue">' +
        rating.toFixed(1) +
      '</span>' +
    '</div>'
  );
}

// 仅生成新视频，不改动原视频或缓存里的原有记录。
const portraitPendingKeys = new Set();

// 水平取景范围用 0..1 表示：0=最左，0.5=正中，1=最右。
// 在 Canvas 中持续绘制源视频帧，所见即所得地选择整个视频的固定裁剪位置。
function choosePortraitCrop(item, previewTime) {
  return new Promise(resolve => {
    let finished = false;
    let cropX = 0.5;
    let previewReady = false;
    let imageWidth = 1;
    let imageHeight = 1;
    let cropWidth = 1;
    let cropHeight = 1;
    let dragging = false;
    let grabDelta = 0;
    let frameHandle = null;
    let frameHandleKind = '';
    let initializedGeometry = false;

    const backdrop = document.createElement('div');
    backdrop.className = 'portraitDialogBack';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', '选择竖屏裁剪范围');
    backdrop.innerHTML =
      '<div class="portraitDialog">' +
        '<div class="portraitDialogTop"><div>' +
          '<h3>选择 9:16 竖屏画面</h3>' +
          '<p>视频可播放、暂停或拖动进度；左右移动白框选择保留范围。整段视频使用同一个取景位置，不拉伸原片。</p>' +
        '</div><button class="portraitClose" type="button" aria-label="关闭">×</button></div>' +
        '<div class="portraitStage"><div class="portraitFrame">' +
          '<canvas aria-label="动态视频裁剪预览"></canvas>' +
          '<div class="portraitSelection"></div>' +
        '</div></div>' +
        '<div class="portraitPlayerBar">' +
          '<button class="portraitPlayback" type="button" disabled>▶ 播放</button>' +
          '<input class="portraitTimeline" type="range" min="0" max="100" step="0.05" value="0" disabled aria-label="视频播放进度">' +
          '<span class="portraitClock">0:00 / 0:00</span>' +
          '<button class="portraitSound" type="button" aria-label="开启预览声音" title="开启预览声音">静音</button>' +
        '</div>' +
        '<div class="portraitScaleBox"><label for="portraitHorizontal">水平取景</label>' +
          '<input id="portraitHorizontal" type="range" min="0" max="100" step="0.1" value="50" disabled aria-label="水平裁剪位置">' +
          '<span class="portraitCropValue">50%</span></div>' +
        '<div class="portraitDialogBottom"><span class="portraitDialogHelp">正在加载视频预览…</span>' +
          '<div class="portraitDialogActions"><button class="portraitCancel" type="button">取消</button>' +
          '<button class="portraitSubmit" type="button" disabled>生成竖屏视频</button></div></div>' +
      '</div>';
    document.body.appendChild(backdrop);

    const frame = backdrop.querySelector('.portraitFrame');
    const canvas = backdrop.querySelector('canvas');
    const highlight = backdrop.querySelector('.portraitSelection');
    const slider = backdrop.querySelector('#portraitHorizontal');
    const value = backdrop.querySelector('.portraitCropValue');
    const help = backdrop.querySelector('.portraitDialogHelp');
    const submit = backdrop.querySelector('.portraitSubmit');
    const playButton = backdrop.querySelector('.portraitPlayback');
    const timeline = backdrop.querySelector('.portraitTimeline');
    const clock = backdrop.querySelector('.portraitClock');
    const soundButton = backdrop.querySelector('.portraitSound');
    const stage = backdrop.querySelector('.portraitStage');
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true; // 后台原视频也可能带声音，避免自动播放时突发音量。
    video.playsInline = true;

    function updateBox() {
      if (!previewReady || finished) return;
      const aspect = imageWidth / imageHeight;
      const maxW = Math.min(900, Math.max(1, stage.clientWidth - 16));
      const maxH = Math.max(100, window.innerHeight * 0.48);
      const w = Math.max(1, Math.min(maxW, maxH * aspect));
      const h = w / aspect;
      frame.style.width = w + 'px';
      frame.style.height = h + 'px';
      const percentW = cropWidth / imageWidth * 100;
      const percentH = cropHeight / imageHeight * 100;
      highlight.style.width = percentW + '%';
      highlight.style.height = percentH + '%';
      highlight.style.left = (100 - percentW) * cropX + '%';
      highlight.style.top = (100 - percentH) / 2 + '%';
      slider.value = String(cropX * 100);
      value.textContent = Math.round(cropX * 100) + '%';
    }

    function setCropX(next) {
      cropX = Math.max(0, Math.min(1, Math.round(Number(next) * 1000) / 1000));
      updateBox();
    }

    function stopFrames() {
      if (frameHandle === null) return;
      if (frameHandleKind === 'video' && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(frameHandle);
      } else if (frameHandleKind === 'raf') {
        window.cancelAnimationFrame(frameHandle);
      }
      frameHandle = null;
    }

    function finish(result) {
      if (finished) return;
      finished = true;
      window.removeEventListener('resize', updateBox);
      document.removeEventListener('keydown', onKeyboard, true);
      stopFrames();
      video.pause();
      video.removeAttribute('src');
      video.load();
      backdrop.remove();
      resolve(result);
    }

    function onKeyboard(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(null);
      } else if (event.code === 'Space' && event.target.tagName !== 'INPUT' && event.target.tagName !== 'BUTTON') {
        event.preventDefault();
        event.stopImmediatePropagation();
        togglePlayback();
      }
    }
    document.addEventListener('keydown', onKeyboard, true);
    window.addEventListener('resize', updateBox);
    backdrop.querySelector('.portraitClose').addEventListener('click', () => finish(null));
    backdrop.querySelector('.portraitCancel').addEventListener('click', () => finish(null));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) finish(null); });
    submit.addEventListener('click', () => { if (previewReady) finish(cropX); });
    slider.addEventListener('input', () => setCropX(Number(slider.value) / 100));

    // 拖动白框，预览帧仍持续更新，无需暂停视频。
    frame.addEventListener('pointerdown', event => {
      if (!previewReady || cropWidth >= imageWidth - 0.001) return;
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const rect = frame.getBoundingClientRect();
      const shownWidth = rect.width * cropWidth / imageWidth;
      const currentLeft = rect.width * (1 - cropWidth / imageWidth) * cropX;
      const pointerX = event.clientX - rect.left;
      grabDelta = pointerX >= currentLeft && pointerX <= currentLeft + shownWidth
        ? pointerX - currentLeft : shownWidth / 2;
      dragging = true;
      frame.setPointerCapture(event.pointerId);
      frame.style.cursor = 'grabbing';
      event.preventDefault();
      const maxLeft = rect.width - shownWidth;
      if (maxLeft > 0) setCropX((pointerX - grabDelta) / maxLeft);
    });
    frame.addEventListener('pointermove', event => {
      if (!dragging) return;
      const rect = frame.getBoundingClientRect();
      const shownWidth = rect.width * cropWidth / imageWidth;
      const maxLeft = rect.width - shownWidth;
      if (maxLeft > 0) setCropX((event.clientX - rect.left - grabDelta) / maxLeft);
    });
    function stopDrag() { dragging = false; frame.style.cursor = ''; }
    frame.addEventListener('pointerup', stopDrag);
    frame.addEventListener('pointercancel', stopDrag);
    frame.addEventListener('lostpointercapture', stopDrag);

    function updateProgress() {
      if (finished) return;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      timeline.disabled = duration <= 0;
      if (duration > 0) timeline.max = String(duration);
      timeline.value = String(Math.min(duration || 0, current));
      clock.textContent = formatTime(current) + ' / ' + formatTime(duration);
    }

    function updatePlayButton() {
      playButton.textContent = video.paused ? (video.ended ? '↻ 重播' : '▶ 播放') : 'Ⅱ 暂停';
    }

    function togglePlayback() {
      if (!previewReady) return;
      if (video.paused || video.ended) {
        if (video.ended) video.currentTime = 0;
        video.play().catch(() => {
          help.textContent = '浏览器阻止了自动播放，请点击播放或检查视频格式。';
        });
      } else {
        video.pause();
        updatePlayButton();
      }
    }

    playButton.addEventListener('click', togglePlayback);
    timeline.addEventListener('input', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration <= 0) return;
      video.currentTime = Math.min(duration, Math.max(0, Number(timeline.value)));
      updateProgress();
    });
    soundButton.addEventListener('click', () => {
      video.muted = !video.muted;
      soundButton.textContent = video.muted ? '静音' : '有声';
      soundButton.title = video.muted ? '开启预览声音' : '关闭预览声音';
      soundButton.setAttribute('aria-label', soundButton.title);
    });

    // Canvas 负责旋转与叠框：保留原图等比显示，编码端同样先旋转再裁剪。
    function drawVideoFrame() {
      if (finished || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      const rotation = Number(item.rotation || 0);
      const turned = rotation === 90 || rotation === 270;
      const rawW = video.videoWidth;
      const rawH = video.videoHeight;
      const width = turned ? rawH : rawW;
      const height = turned ? rawW : rawH;
      if (!initializedGeometry || width !== imageWidth || height !== imageHeight) {
        imageWidth = width;
        imageHeight = height;
        const downscale = Math.min(1, 1200 / width, 900 / height);
        canvas.width = Math.max(1, Math.round(width * downscale));
        canvas.height = Math.max(1, Math.round(height * downscale));
        cropWidth = Math.min(width, height * 9 / 16);
        cropHeight = Math.min(height, width * 16 / 9);
        initializedGeometry = true;
        previewReady = true;
        slider.disabled = cropWidth >= imageWidth - 0.001;
        submit.disabled = false;
        playButton.disabled = false;
        help.textContent = slider.disabled
          ? '该画面宽度已完全保留，无法再左右移动。'
          : '边播放边拖动白框，或暂停、跳进度确认主体始终在白框内。';
        updateBox();
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (rotation === 90) {
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
      } else if (rotation === 180) {
        ctx.translate(canvas.width, canvas.height);
        ctx.rotate(Math.PI);
      } else if (rotation === 270) {
        ctx.translate(0, canvas.height);
        ctx.rotate(-Math.PI / 2);
      }
      ctx.drawImage(video, 0, 0,
        turned ? canvas.height : canvas.width,
        turned ? canvas.width : canvas.height);
      ctx.restore();
    }

    function scheduleFrames() {
      if (finished || video.paused || video.ended || frameHandle !== null) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        frameHandleKind = 'video';
        frameHandle = video.requestVideoFrameCallback(() => {
          frameHandle = null;
          drawVideoFrame();
          scheduleFrames();
        });
      } else {
        frameHandleKind = 'raf';
        frameHandle = window.requestAnimationFrame(() => {
          frameHandle = null;
          drawVideoFrame();
          scheduleFrames();
        });
      }
    }

    video.addEventListener('play', () => { updatePlayButton(); scheduleFrames(); });
    video.addEventListener('pause', () => { stopFrames(); updatePlayButton(); drawVideoFrame(); });
    video.addEventListener('ended', () => { stopFrames(); updatePlayButton(); updateProgress(); });
    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('seeked', () => { drawVideoFrame(); updateProgress(); scheduleFrames(); });
    video.addEventListener('error', () => {
      if (finished) return;
      help.textContent = '浏览器无法解码该视频，因此无法动态预览裁剪范围。';
    });
    video.addEventListener('loadedmetadata', updateProgress);
    video.addEventListener('loadeddata', async () => {
      if (finished) return;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const time = Math.max(0, Math.min(Number(previewTime) || 0, Math.max(0, duration - 0.2)));
      if (time > 0.05) {
        try { video.currentTime = time; } catch {}
      }
      drawVideoFrame();
      updateProgress();
      // 静音自动播放避免浏览器拦截；即使原片暂停也可以直接观察动态取景。
      try { await video.play(); }
      catch {
        if (!finished) help.textContent = '点击「播放」开始动态预览。';
      }
    }, {once:true});
    video.src = item.mediaUrl;
    video.load();
  });
}

// v6.20 - unobtrusive transcoding status, works while POST remains pending.
const jfRunningJobs=new Map();
function jfStartMediaProgress(label){
  const raw=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  let panel=document.querySelector('#jfMediaJobHUD');
  if(!panel){
    panel=document.createElement('div');panel.id='jfMediaJobHUD';
    panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');
    panel.innerHTML='<div class="jfJobLine"><span class="jfJobName"></span><span class="jfJobPercent">处理中…</span></div><div class="jfJobTrack"><i></i></div>';
    document.body.appendChild(panel);
  }
  panel.hidden=false;
  panel.querySelector('.jfJobName').textContent=label;
  const percent=panel.querySelector('.jfJobPercent');
  const bar=panel.querySelector('.jfJobTrack i');
  percent.textContent='准备中…';bar.style.width='0%';
  let closed=false;
  jfRunningJobs.set(raw,true);
  let polling=false;
  const timer=setInterval(async()=>{
    if(closed||polling||document.hidden)return;
    polling=true;
    try{
      const response=await fetch('/api/media-progress?id='+encodeURIComponent(raw),{cache:'no-store'});
      const data=await response.json();
      if(!response.ok || !data.ok)return;
      if(data.percent===null){percent.textContent='处理中…';}
      else{percent.textContent=data.status==='done'?'100%':data.percent+'%';bar.style.width=data.percent+'%';}
    }catch(_){/* A running conversion must not fail because its progress view timed out. */}
    finally{polling=false;}
  },450);
  return {id:raw,done(success){
    closed=true;clearInterval(timer);jfRunningJobs.delete(raw);
    if(!jfRunningJobs.size){
      if(success){percent.textContent='已完成';bar.style.width='100%';}
      else{percent.textContent='已结束';}
      setTimeout(()=>{if(!jfRunningJobs.size)panel.hidden=true;},1250);
    }
  }};
}

async function jfTrackedMediaPost(url,body,label){
  const task=jfStartMediaProgress(label);
  let success=false;
  try {
    const result=await mediaPost(url,{...body,jobId:task.id});
    success=true;
    return result;
  }finally{task.done(success);}
}

async function makePortraitVideo(key, button, sourceVideo) {
  const item = allItems.find(x => x.key === key);
  if (!item || item.kind !== 'video') return;
  if (portraitPendingKeys.has(key)) return;

  portraitPendingKeys.add(key);
  const buttonLabel = button && button.querySelector('.feedToolLabel');
  const oldText = buttonLabel ? buttonLabel.textContent : '';
  if (button) button.disabled = true;
  try {
    // 裁剪时暂停背后原播放器，避免两条声音与画面同时运行；关闭后恢复原状态。
    const sourceWasPlaying = Boolean(sourceVideo && !sourceVideo.paused && !sourceVideo.ended);
    if (sourceWasPlaying) sourceVideo.pause();
    let cropX;
    try {
      cropX = await choosePortraitCrop(item, sourceVideo ? sourceVideo.currentTime : item.coverTime);
    } finally {
      if (sourceWasPlaying && sourceVideo && sourceVideo.isConnected) {
        sourceVideo.play().catch(() => {});
      }
    }
    if (cropX === null) return;
    if (button && button.isConnected) {
      button.classList.add('loading');
      button.setAttribute('aria-busy','true');
      if (buttonLabel) buttonLabel.textContent = '处理中';
    }
    const task=jfStartMediaProgress('生成竖屏视频');
    let response;
    try {response = await fetch('/api/create-portrait', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({key, cropX,jobId:task.id})
    });
    } finally {task.done(Boolean(response && response.ok));}
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || '竖屏生成失败');
    }
    await load();
    alert(result.reused
      ? '这个水平取景位置已生成过竖屏视频，可在列表中找到。'
      : '9:16 竖屏视频已生成并加入媒体库，原视频保留。\\n关闭播放界面即可找到新视频。');
  } catch (error) {
    alert('竖屏生成失败：' + (error.message || error));
  } finally {
    portraitPendingKeys.delete(key);
    if (button && button.isConnected) {
      button.disabled = false;
      button.classList.remove('loading');
      button.removeAttribute('aria-busy');
      if (buttonLabel) buttonLabel.textContent = oldText;
    }
  }
}

const VIDEO_VIEW_PREF = 'justfun-video-view-v1';
let videoViewMode = 'cover';
try { videoViewMode = localStorage.getItem(VIDEO_VIEW_PREF) === 'text' ? 'text' : 'cover'; } catch (_) {}
function videoTextCard(item,stars){
  const key=esc(item.key), title=esc(item.displayName || item.title || '未命名');
  const author=String(item.creator||'').trim();
  const meta=[item.durationText, item.sizeText].filter(Boolean).map(esc).join(' <span class="metaSep">·</span> ');
  return '<article class="card mediaTile videoTextTile'+(mediaSelectedKeys.has(item.key)?' unifiedSelected':'')+'" data-key="'+key+'" data-media-key="'+key+'" data-favorite="'+(item.favorite?'true':'false')+'" tabindex="0" title="双击卡片播放">'+
    '<button type="button" class="mediaTileCheck" data-media-select="'+key+'" aria-label="选择视频">✓</button>'+
    '<div class="videoTextContent">'+
      '<div class="videoTextHeading"><span class="titleText" data-key="'+key+'" title="'+title+'">'+title+'</span><button type="button" class="unifiedMore" data-media-more="'+key+'" aria-label="更多文件操作">⋯</button></div>'+
      (author?'<div class="videoTextAuthor"><span class="creatorText" data-key="'+key+'" title="双击编辑作者：'+esc(author)+'">'+esc(author)+'</span>'+(item.creatorLink?'<a class="creatorLinkBtn" target="_blank" rel="noopener noreferrer" href="'+esc(item.creatorLink)+'" aria-label="作者链接">↗</a>':'')+'</div>':'')+
      '<div class="videoTextMeta">'+meta+'</div>'+
      '<div class="videoTextFoot"><div class="stars" data-key="'+key+'" data-rating="'+Number(item.rating||0)+'">'+stars+'<span class="ratingValue">'+Number(item.rating||0).toFixed(1)+'</span></div>'+
      '<button type="button" class="iconBtn multiBtn videoTextMulti" data-key="'+key+'" title="多开视频" aria-label="多开视频">'+studioIcon('multi')+'</button></div>'+
    '</div></article>';
}
function card(item) {
  const stars = [1,2,3,4,5]
    .map(n => {
      const fill =
        Math.max(
          0,
          Math.min(
            100,
            (Number(item.rating || 0) - (n - 1)) * 100
          )
        );

      return (
        '<button class="ratingStar" type="button">' +
          '<span class="ratingStarBase">★</span>' +
          '<span class="ratingStarFill" style="width:' + fill + '%">★</span>' +
        '</button>'
      );
    })
    .join('');

  if(videoViewMode==='text') return videoTextCard(item,stars);

  // Preserved aspect ratio follows the physical frame orientation, never CSS stretching.
  const dims = String(item.resolution || '').match(/(\\d+)\\s*[×xX]\\s*(\\d+)/);
  let frameW = dims ? Number(dims[1]) : 0;
  let frameH = dims ? Number(dims[2]) : 0;
  const rotation = ((Number(item.rotation || 0) % 360) + 360) % 360;
  if (rotation === 90 || rotation === 270) [frameW,frameH] = [frameH,frameW];
  const orientation = frameW && frameH && frameW >= frameH ? 'landscape' : 'portrait';
  const ratio = frameW && frameH ? Math.max(.52, Math.min(2.35,frameW/frameH)) : (orientation==='landscape'?16/9:9/16);
  return \`
  <article class="card mediaTile jfCoverTile\${mediaSelectedKeys.has(item.key) ? ' unifiedSelected' : ''}" data-key="\${esc(item.key)}" tabindex="0" data-media-key="\${esc(item.key)}" data-orientation="\${orientation}" style="--jf-video-ratio:\${ratio}" data-favorite="\${item.favorite ? 'true' : 'false'}">
    <button type="button" class="mediaTileCheck" data-media-select="\${esc(item.key)}" aria-label="选择媒体">✓</button>
    <div class="coverWrap" data-feed-key="\${esc(item.key)}">
      \${item.cover ? '<img class="cover" loading="lazy" decoding="async" src="' + esc(item.cover) + '">' : '<div class="empty">暂无封面</div>'}
      <div class="badges">
        \${item.durationText ? '<span class="badge">' + esc(item.durationText) + '</span>' : ''}
        \${item.resolution ? '<span class="badge">' + esc(item.resolution) + '</span>' : ''}
      </div>
      <div class="body jfCoverInfo">
        <div class="creatorRow">
          <span class="creatorText" data-key="\${esc(item.key)}" title="双击修改作者">\${esc(item.creator || '未设置创作者')}</span>
          <button class="creatorEditBtn" type="button" data-key="\${esc(item.key)}" title="修改作者" aria-label="修改作者">\${studioIcon('rename')}</button>
          \${item.creatorLink ? '<a class="creatorLinkBtn" href="' + esc(item.creatorLink) + '" target="_blank" rel="noopener noreferrer" title="访问作者链接" aria-label="访问作者链接">↗</a>' : ''}
          <button class="creatorLinkBtn creatorLinkCardEdit" type="button" data-creator="\${esc(item.creator || '')}" title="编辑作者链接" aria-label="编辑作者链接">\${studioIcon('link')}</button>
        </div>
        <span class="titleText" data-key="\${esc(item.key)}" title="双击修改名称">\${esc(item.displayName || item.title || '未命名')}</span>
        <div class="actions">
          <div class="stars" data-key="\${esc(item.key)}" data-rating="\${Number(item.rating || 0)}">\${stars}<span class="ratingValue">\${Number(item.rating || 0).toFixed(1)}</span></div>
          <div class="iconActions">
            <button type="button" class="unifiedMore" data-media-more="\${esc(item.key)}" title="更多文件操作" aria-label="更多文件操作">⋯</button>
            <button class="iconBtn multiBtn" type="button" data-key="\${esc(item.key)}" title="多开" aria-label="多开">\${studioIcon('multi')}</button>
            <button class="iconBtn deleteBtn" type="button" data-key="\${esc(item.key)}" title="删除媒体" aria-label="删除媒体">\${studioIcon('delete')}</button>
          </div>
        </div>
      </div>
    </div>
  </article>\`;
}

async function renameCreatorEverywhere(
  oldName
) {
  const from =
    String(oldName || '').trim();

  if (!from) {
    return;
  }

  const entered =
    prompt(
      '统一修改作者名\\n将「' +
      from +
      '」修改为：',
      from
    );

  if (entered === null) {
    return;
  }

  const to =
    String(entered).trim();

  if (!to) {
    alert('作者名不能为空');
    return;
  }

  if (to === from) {
    return;
  }

  try {
    const response =
      await fetch(
        '/api/update-creator-bulk',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              from,
              to
            })
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        '统一修改失败'
      );
    }

    allItems.forEach(
      item => {
        if (
          String(
            item.creator || ''
          ).trim() === from
        ) {
          item.creator = to;
        }
      }
    );

    if (
      selectedCreator === from
    ) {
      selectedCreator = to;
    }

    renderCreatorTags();
    render();
  } catch (error) {
    alert(
      error.message ||
      '统一修改失败'
    );
  }
}

function normalizeCreatorLink(value) {
  let link = String(value || '').trim();
  if (!link) return '';
  const lower = link.toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    link = 'https://' + link;
  }
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

async function editCreatorLink(creatorName) {
  const creator = String(creatorName || '').trim();
  if (!creator) {
    alert('请先设置作者名');
    return;
  }

  const sample = allItems.find(item => String(item.creator || '').trim() === creator);
  const current = sample ? String(sample.creatorLink || '') : '';
  const entered = prompt('作者链接：\\n留空可删除链接', current);
  if (entered === null) return;

  const raw = String(entered).trim();
  const link = normalizeCreatorLink(raw);
  if (raw && !link) {
    alert('链接格式无效，请输入 http:// 或 https:// 链接');
    return;
  }

  try {
    const response = await fetch('/api/update-creator-link', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ creator, link })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || '保存失败');

    allItems.forEach(item => {
      if (String(item.creator || '').trim() === creator) item.creatorLink = link;
    });
    renderCreatorTags();
    render();
  } catch (error) {
    alert(error.message || '保存失败');
  }
}

function renderCreatorTags() {
  const counts = new Map();

  for (const item of allItems.filter(x => x.kind === 'video')) {
    const creator =
      String(item.creator || '').trim();

    if (!creator) continue;

    counts.set(
      creator,
      (counts.get(creator) || 0) + 1
    );
  }

  if (
    selectedCreator &&
    !counts.has(selectedCreator)
  ) {
    selectedCreator = '';
  }

  const creators =
    [...counts.entries()]
      .sort(
        (a,b) =>
          b[1] - a[1] ||
          a[0].localeCompare(b[0], 'zh-CN')
      );

  document.querySelector('#creatorTags').innerHTML =
    [
      '<button class="creatorTag ' +
        (!selectedCreator ? 'on' : '') +
        '" data-creator="">全部 ' +
        allItems.filter(x=>x.kind==='video').length +
        '</button>',
      ...creators.map(
        ([name,count]) =>
          '<span class="creatorTagGroup">' +
            '<button class="creatorTag ' +
            (selectedCreator === name ? 'on' : '') +
            '" data-creator="' +
            esc(name) +
            '" title="' +
            esc(name) +
            ' · ' +
            count +
            ' 个作品">' +
            esc(name) +
            ' ' +
            count +
            '</button>' +
            '<button class="creatorRename" type="button" data-creator="' +
            esc(name) +
            '" title="统一修改该作者名" aria-label="统一修改 ' +
            esc(name) +
            ' 的作者名">✎</button>' +
            (allItems.some(item => String(item.creator || '').trim() === name && item.creatorLink)
              ? '<a class="creatorLinkEdit" href="' + esc((allItems.find(item => String(item.creator || '').trim() === name && item.creatorLink) || {}).creatorLink || '') + '" target="_blank" rel="noopener noreferrer" title="访问作者链接">↗</a>'
              : '') +
            '<button class="creatorLinkEdit" type="button" data-creator-link-edit="' + esc(name) + '" title="编辑作者链接">🔗</button>' +
          '</span>'
      )
    ].join('');

  document
    .querySelectorAll(
      '.creatorTag'
    )
    .forEach(
      button => {
        button.addEventListener(
          'click',
          () => {
            selectedCreator =
              button.dataset.creator || '';

            renderCreatorTags();
            render();
          }
        );
      }
    );

  document
    .querySelectorAll(
      '.creatorRename'
    )
    .forEach(
      button => {
        button.addEventListener(
          'click',
          event => {
            event.preventDefault();
            event.stopPropagation();

            renameCreatorEverywhere(
              button.dataset.creator || ''
            );
          }
        );
      }
    );

  document.querySelectorAll('[data-creator-link-edit]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      editCreatorLink(button.dataset.creatorLinkEdit || '');
    });
  });

  document.querySelector('#creatorToggle').textContent =
    '创作者' +
    (creators.length
      ? ' · ' + creators.length + '人'
      : '') +
    (creatorOpen ? ' ▴' : ' ▾');
}

// 素材区：目录显示原名；实际目录/文件仍然是 hash。
function folderDisplayName(relativeDir) {
  if (relativeDir === 'root') return '原媒体目录';
  if (relativeDir === 'data') return 'data';
  if (relativeDir === 'data/1001') return '截图与精选帧';
  if (relativeDir === 'data/1002') return '提取的音轨';
  const folder = allFolders.find(x=>x.relativeDir===relativeDir);
  return folder ? folder.originalName : relativeDir;
}

function audioDisplayName(item) {
  return item.displayName || item.originalName || item.title || '未命名音频';
}
function unifiedMediaName(item) {
  if (!item) return '';
  if (item.displayName) return item.displayName;
  if (item.kind === 'video') {
    const base=item.title || item.originalName || '未命名视频';
    const ext=item.originalExt || '';
    return base + (ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? ext : '');
  }
  return item.originalName || item.title || '未命名素材';
}
function naturalFileOrder(a,b) {
  const an = unifiedMediaName(a);
  const bn = unifiedMediaName(b);
  const diff = filenameCollator.compare(an,bn);
  return (fileSortAscending ? 1 : -1) * (diff || a.key.localeCompare(b.key));
}

// 单曲循环默认开启；A-B 循环优先于整曲循环。用户可逐条设置 A/B。
const AUDIO_LOOP_STORAGE_KEY = 'douyin-audio-single-loop';
const AUDIO_SPEED_STORAGE_KEY = 'douyin-audio-playback-speed';
const AUDIO_SPEED_OPTIONS = [0.5,0.75,1,1.25,1.5,1.75,2];
let audioPlaybackRate = 1;
try {
  const savedRate = Number(localStorage.getItem(AUDIO_SPEED_STORAGE_KEY));
  if (AUDIO_SPEED_OPTIONS.includes(savedRate)) audioPlaybackRate = savedRate;
} catch {}
function audioSpeedLabel(rate) { return String(rate)+'×'; }
let audioLoopEnabled = true;
try { audioLoopEnabled = localStorage.getItem(AUDIO_LOOP_STORAGE_KEY) !== 'off'; } catch {}
const audioABStates = new Map();
const audioClipJobs = new Set();
let renderedAudioSignature = '';
let pendingAudioRender = false;
let activeAudioKey = null;
// Session-only layout preference: never tracks which media was played.
let audioDockManuallyMinimized = false;
const BGM_VOLUME_KEY='justfun-bgm-volume';
function storedBgmVolume(){
  try {
    const raw=localStorage.getItem(BGM_VOLUME_KEY);
    return raw===null?1:Math.min(1,Math.max(0,Number(raw)||0));
  }catch{return 1;}
}
// The compact BGM control may be moved away from captions or video tools.
// The position is presentation-only, separated by monitor orientation and never saved in media indexes.
const BGM_MINI_POSITION_KEY='justfun-bgm-mini-position-v1';
let bgmMiniPositions={};
try {
  const saved=JSON.parse(localStorage.getItem(BGM_MINI_POSITION_KEY)||'{}');
  if(saved && typeof saved==='object' && !Array.isArray(saved)) bgmMiniPositions=saved;
} catch {}
function bgmScreenOrientation(){return innerHeight>innerWidth?'portrait':'landscape';}
function bgmMiniClamp(left,bottom){
  const maxLeft=Math.max(8,innerWidth-98),maxBottom=Math.max(8,innerHeight-54);
  return {left:Math.max(8,Math.min(maxLeft,left)),bottom:Math.max(8,Math.min(maxBottom,bottom))};
}
function placeBgmMini(left,bottom){
  const dock=document.querySelector('#audioDock');
  const pos=bgmMiniClamp(left,bottom);
  dock.style.setProperty('--bgm-mini-left',pos.left+'px');
  dock.style.setProperty('--bgm-mini-bottom',pos.bottom+'px');
  return pos;
}
function restoreBgmMiniPosition(){
  const dock=document.querySelector('#audioDock');
  const saved=bgmMiniPositions[bgmScreenOrientation()];
  if(!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y) ||
     saved.x<0 || saved.x>1 || saved.y<0 || saved.y>1){
    dock.style.removeProperty('--bgm-mini-left');
    dock.style.removeProperty('--bgm-mini-bottom');
    return;
  }
  placeBgmMini(saved.x*Math.max(0,innerWidth-98),saved.y*Math.max(0,innerHeight-54));
}
function rememberBgmMiniPosition(left,bottom){
  const pos=placeBgmMini(left,bottom);
  bgmMiniPositions[bgmScreenOrientation()]={
    x:Math.max(0,Math.min(1,pos.left/Math.max(1,innerWidth-98))),
    y:Math.max(0,Math.min(1,pos.bottom/Math.max(1,innerHeight-54)))
  };
  try{localStorage.setItem(BGM_MINI_POSITION_KEY,JSON.stringify(bgmMiniPositions));}catch{}
}
let bgmMiniDrag=null;
let bgmMiniSuppressClick=false;
const bgmDock=document.querySelector('#audioDock');
bgmDock.addEventListener('pointerdown',event=>{
  if(event.button!==0 || !bgmDock.classList.contains('isMinimized') ||
     !event.target.closest('.bgmMiniOpen'))return;
  const rect=bgmDock.getBoundingClientRect();
  bgmMiniDrag={id:event.pointerId,x:event.clientX,y:event.clientY,
    left:rect.left,bottom:innerHeight-rect.bottom,moved:false};
  event.target.setPointerCapture?.(event.pointerId);
});
bgmDock.addEventListener('pointermove',event=>{
  const drag=bgmMiniDrag;
  if(!drag || event.pointerId!==drag.id)return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if(!drag.moved && Math.hypot(dx,dy)<7)return;
  drag.moved=true;
  bgmDock.classList.add('isDragging');
  placeBgmMini(drag.left+dx,drag.bottom-dy);
  event.preventDefault();
});
function finishBgmMiniDrag(event){
  const drag=bgmMiniDrag;
  if(!drag || event.pointerId!==drag.id)return;
  bgmMiniDrag=null;
  bgmDock.classList.remove('isDragging');
  if(drag.moved){
    bgmMiniSuppressClick=event.type==='pointerup';
    const rect=bgmDock.getBoundingClientRect();
    rememberBgmMiniPosition(rect.left,innerHeight-rect.bottom);
  }
}
bgmDock.addEventListener('pointerup',finishBgmMiniDrag);
bgmDock.addEventListener('pointercancel',finishBgmMiniDrag);
window.addEventListener('resize',()=>{if(!bgmMiniDrag)restoreBgmMiniPosition();});
// Audio remains a separate playback lane; video-only arbiter must not pause it.
function setAudioDockMinimized(minimized,manual=false){
  const dock=document.querySelector('#audioDock');
  if(manual) audioDockManuallyMinimized=Boolean(minimized);
  const compact=Boolean(minimized);
  dock.classList.toggle('isMinimized',compact);
  if(compact && !bgmMiniDrag)restoreBgmMiniPosition();
  dock.dataset.minimized=String(compact);
  document.body.classList.toggle('audioDockVisible',!compact && !dock.hidden && libraryMode==='audio');
  document.body.classList.toggle('bgmActive',!dock.hidden);
  const sound=dock.querySelector('.audioTrack audio');
  const button=dock.querySelector('.audioDockMinimize');
  if(button) button.setAttribute('aria-label','最小化播放器');
  const play=dock.querySelector('.bgmMiniPlay');
  if(play && sound){
    play.dataset.playing=String(!sound.paused);
    play.setAttribute('aria-label',sound.paused?'播放背景音乐':'暂停背景音乐');
    play.title=sound.paused?'播放背景音乐':'暂停背景音乐';
  }
  const mute=dock.querySelector('.bgmMiniOpen');
  if(mute) mute.setAttribute('aria-expanded',String(!compact));
}
function syncAudioDockMode(){
  const dock=document.querySelector('#audioDock');
  if(dock.hidden)return;
  setAudioDockMinimized(audioDockManuallyMinimized || libraryMode!=='audio');
}


function audioClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const n=Math.max(0,Number(seconds));
  const h=Math.floor(n/3600),m=Math.floor((n%3600)/60),sec=Math.floor(n%60);
  const prefix=h?h+':'+String(m).padStart(2,'0')+':':m+':';
  return prefix+String(sec).padStart(2,'0')+'.'+String(Math.floor((n%1)*100)).padStart(2,'0');
}
function audioTrackFrom(element) { return element && element.closest('.audioTrack'); }
function audioABState(key) {
  if (!audioABStates.has(key)) audioABStates.set(key,{a:null,b:null,enabled:false});
  return audioABStates.get(key);
}
function audioValidAB(state,duration) {
  return Number.isFinite(state.a) && Number.isFinite(state.b) &&
    state.a>=0 && state.b>state.a+0.05 && (!Number.isFinite(duration) || duration<=0 || state.b<=duration+0.05);
}
function audioUIStamp(items,folders) {
  return JSON.stringify([items.filter(x=>x.kind==='audio').map(x=>[x.key,x.title,x.originalName,x.displayName,x.relativeDir,x.sizeText,x.durationText]),
    folders.map(x=>[x.relativeDir,x.parentDir,x.originalName])]);
}
function syncAudioTrack(audio) {
  const track=audioTrackFrom(audio);
  if (!track) return;
  const state=audioABState(track.dataset.audioKey);
  const duration=Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:0;
  const at=Number.isFinite(audio.currentTime)?audio.currentTime:0;
  const playing=!audio.paused;
  if (audio.playbackRate !== audioPlaybackRate) audio.playbackRate=audioPlaybackRate;
  const play=track.querySelector('.audioPlay');
  play.dataset.playing=String(playing);
  play.title=playing?'暂停':'播放';
  play.setAttribute('aria-label',play.title);
  track.querySelector('.audioTimeCurrent').textContent=audioClock(at);
  track.querySelector('.audioTimeDuration').textContent=duration?audioClock(duration):'--:--';
  const seek=track.querySelector('.audioSeek');
  if (duration) { seek.max=String(duration); seek.disabled=false; }
  else seek.disabled=true;
  if (!seek.dataset.dragging) seek.value=String(Math.min(at,duration||0));
  const percent=duration?Math.min(100,Math.max(0,at/duration*100)):0;
  seek.style.setProperty('--audio-progress',percent+'%');
  for(const point of ['a','b']) {
    const el=track.querySelector('.audioMark'+point.toUpperCase());
    const n=state[point];
    const visible=duration&&Number.isFinite(n);
    el.style.display=visible?'block':'none';
    if(visible) el.style.left=Math.min(100,Math.max(0,n/duration*100))+'%';
    track.querySelector('.audio'+point.toUpperCase()).classList.toggle('on',Number.isFinite(n));
  }
  const valid=audioValidAB(state,duration);
  track.querySelector('.audioABInfo').textContent='A '+(Number.isFinite(state.a)?audioClock(state.a):'未设置')+'  ·  B '+(Number.isFinite(state.b)?audioClock(state.b):'未设置');
  const ab=track.querySelector('.audioABLoop');
  ab.disabled=!valid; ab.classList.toggle('on',valid&&state.enabled);
  ab.setAttribute('aria-pressed',String(Boolean(valid&&state.enabled)));
  ab.title=valid&&state.enabled?'关闭区间循环':'开启区间循环';
  ab.setAttribute('aria-label',ab.title);
  const clip=track.querySelector('.audioClip');
  clip.disabled=!valid||audioClipJobs.has(track.dataset.audioKey);
  clip.classList.toggle('loading',audioClipJobs.has(track.dataset.audioKey));
  clip.querySelector('.audioControlLabel').textContent=audioClipJobs.has(track.dataset.audioKey)?'截取中…':'截取片段';
  audio.loop=audioLoopEnabled && !(valid&&state.enabled);
  const loop=track.querySelector('.audioLoop');
  loop.classList.toggle('on',audioLoopEnabled); loop.setAttribute('aria-pressed',String(audioLoopEnabled));
  loop.title=audioLoopEnabled?'整曲循环已开启':'整曲循环已关闭';
  const speedButton=track.querySelector('.audioSpeed');
  speedButton.querySelector('.audioSpeedValue').textContent=audioSpeedLabel(audioPlaybackRate);
  speedButton.title='播放倍速：当前 '+audioSpeedLabel(audioPlaybackRate);
  track.querySelectorAll('.audioSpeedChoice').forEach(option=>{
    const selected=Number(option.dataset.audioSpeed)===audioPlaybackRate;
    option.classList.toggle('on',selected);
    option.setAttribute('aria-pressed',String(selected));
  });
  const mute=track.querySelector('.audioMute');
  mute.dataset.muted=String(Boolean(audio.muted||audio.volume===0));
  mute.title='音量（点击后竖向调节）';
  const volume=track.querySelector('.audioVolume');
  if (document.activeElement!==volume) volume.value=String(Math.round(audio.volume*100));
  if(track.closest('#audioDock')) syncAudioMiniState(audio);
}
function syncAudioMiniState(audio){
  const mini=audio.closest('#audioDock')?.querySelector('.bgmMiniPlay');
  if(!mini)return;
  mini.dataset.playing=String(!audio.paused);
  mini.setAttribute('aria-label',audio.paused?'播放背景音乐':'暂停背景音乐');
  mini.title=audio.paused?'播放背景音乐':'暂停背景音乐';
}
function resetAllAudioStates() {document.querySelectorAll('#audioDock .audioTrack audio').forEach(syncAudioTrack);}
async function playAudioSafely(audio) {
  const track=audioTrackFrom(audio); if (!track) return;
  const msg=track.querySelector('.audioMessage'); msg.textContent='';
  if (audio.readyState===0 && audio.networkState===HTMLMediaElement.NETWORK_EMPTY) audio.load();
  try {await audio.play();}
  catch(error) {
    // 只有加载被浏览器中断时才重试；格式不支持、源文件损坏不会无限重试。
    if (audio.isConnected && error && error.name==='AbortError') {
      try { await audio.play(); return; } catch(next){error=next;}
    }
    if (!audio.isConnected) return;
    msg.textContent='播放失败：'+(error?.message||'音频无法解码或读取');
    syncAudioTrack(audio);
  }
}

// 唯一驻留的音频播放实例不参与文件列表的重绘，避免切换目录、轮询打断播放。
function audioDockMarkup(item) {
  return '<article class="audioTrack" data-audio-key="'+esc(item.key)+'">'+
      '<div class="audioTrackHeader"><span class="audioArtwork" aria-hidden="true">'+studioIcon('audio')+'</span>'+
      '<div class="audioTrackInfo"><div class="audioTitle" title="'+esc(audioDisplayName(item))+'">'+esc(audioDisplayName(item))+'</div>'+
      '<div class="audioMeta">'+esc(item.sizeText||'音频文件')+'</div></div>'+
      '<div class="audioDockHeaderActions"><button type="button" class="audioDockMinimize" title="最小化 · 保持音乐播放" aria-label="最小化播放器">'+studioIcon('minus')+'</button>'+ 
      '<button type="button" class="audioDockClose" title="停止音乐并关闭" aria-label="停止音乐并关闭">×</button></div></div>'+
      '<div class="audioTimeline">'+
      '<button type="button" class="audioIconBtn audioPlay" data-playing="false" data-audio-action="play" title="播放" aria-label="播放">'+
      '<svg class="audioGlyphPlay" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 5.8 L18.5 12 L8.5 18.2 Z" fill="currentColor"/></svg>'+
      '<svg class="audioGlyphPause" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 6.5 V17.5 M15.5 6.5 V17.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg></button>'+
      '<span class="audioTime audioTimeCurrent">0:00.00</span>'+
      '<div class="audioSeekWrap"><input class="audioSeek" type="range" min="0" max="100" value="0" step="0.01" aria-label="精确播放进度：方向键微调 0.05 秒" disabled>'+
      '<i class="audioMark audioMarkA"></i><i class="audioMark audioMarkB"></i></div>'+
      '<span class="audioTime audioTimeDuration">--:--</span></div>'+
      '<div class="audioTools audioToolsExpanded"><div class="audioABTools">'+
      '<button type="button" class="audioIconBtn audioABBtn audioA" data-audio-action="set-a" title="将当前时间设为 A 点"><span class="audioLetterIcon">A</span><span class="audioControlLabel">设 A</span></button>'+
      '<button type="button" class="audioIconBtn audioABBtn audioB" data-audio-action="set-b" title="将当前时间设为 B 点"><span class="audioLetterIcon">B</span><span class="audioControlLabel">设 B</span></button>'+
      '<button type="button" class="audioIconBtn audioABLoop" data-audio-action="ab" aria-pressed="false" title="开启区间循环" disabled><span class="audioControlIcon">'+studioIcon('repeat')+'</span><span class="audioControlLabel">区间循环</span></button>'+
      '<button type="button" class="audioIconBtn audioClip" data-audio-action="clip" title="截取选定区间并保存为音频" disabled><span class="audioControlIcon">'+studioIcon('scissors')+'</span><span class="audioControlLabel">截取片段</span></button>'+
      '</div><span class="audioABInfo" aria-live="polite">A 未设置 · B 未设置</span>'+
      '<div class="audioRightTools">'+
      '<button type="button" class="audioIconBtn audioLoop'+(audioLoopEnabled?' on':'')+'" data-audio-action="loop" aria-pressed="'+(audioLoopEnabled?'true':'false')+'" title="单曲循环"><span class="audioControlIcon">'+studioIcon('repeat')+'</span><span class="audioControlLabel">单曲循环</span></button>'+
      '<div class="audioSpeedBox"><button type="button" class="audioIconBtn audioSpeed" data-audio-action="speed" aria-haspopup="true" aria-expanded="false" title="选择播放倍速"><span class="audioSpeedValue">'+audioSpeedLabel(audioPlaybackRate)+'</span></button>'+
      '<div class="audioSpeedPopup" role="group" aria-label="音频播放倍速">'+AUDIO_SPEED_OPTIONS.map(rate=>
      '<button type="button" class="audioSpeedChoice'+(rate===audioPlaybackRate?' on':'')+'" data-audio-speed="'+rate+'" aria-pressed="'+(rate===audioPlaybackRate?'true':'false')+'">'+audioSpeedLabel(rate)+'</button>'
      ).join('')+'</div></div>'+
      '<div class="audioVolumeBox"><button type="button" class="audioIconBtn audioMute" data-muted="false" data-audio-action="volume" aria-label="调整音量" title="点击调节音量"><span class="audioControlIcon audioVolumeOn">'+studioIcon('volume')+'</span><span class="audioControlIcon audioVolumeOff">'+studioIcon('mute')+'</span></button>'+
      '<div class="audioVolumePopup"><input class="audioVolume" type="range" min="0" max="100" value="100" step="1" aria-label="音量"></div></div></div></div>'+
      '<div class="audioMessage" role="status" aria-live="polite"></div>'+
      '<audio preload="metadata" playsinline src="'+esc(item.mediaUrl)+'"></audio></article>'+ 
      '<div class="bgmMini" role="group" aria-label="背景音乐控制">'+
      '<button type="button" class="bgmMiniOpen" title="展开背景音乐播放器" aria-label="展开背景音乐播放器" aria-expanded="false">'+studioIcon('audio')+'</button>'+ 
      '<button type="button" class="bgmMiniPlay" data-playing="false" aria-label="播放背景音乐" title="播放背景音乐"><svg viewBox="0 0 24 24" aria-hidden="true" class="bgmIconPause"><path d="M9 6v12M15 6v12"/></svg><svg viewBox="0 0 24 24" aria-hidden="true" class="bgmIconPlay"><path d="m8 5 11 7-11 7Z"/></svg></button></div>';
}
function closeAudioDock() {
  const dock=document.querySelector('#audioDock');
  const audio=dock.querySelector('audio');
  if(audio) {audio.pause();audio.removeAttribute('src');audio.load();}
  dock.hidden=true;
  dock.replaceChildren();
  document.body.classList.remove('audioDockVisible','bgmActive');
  audioDockManuallyMinimized=false;
  activeAudioKey=null;
  document.querySelectorAll('.audioFileTile.isActive').forEach(el=>el.classList.remove('isActive'));
}
function syncActiveAudioTiles() {
  document.querySelectorAll('.audioFileTile').forEach(el=>{
    const isActive=el.dataset.audioFileKey===activeAudioKey;
    el.classList.toggle('isActive',isActive);
    el.setAttribute('aria-pressed',String(isActive));
  });
}
function openAudioDock(key) {
  const item=allItems.find(x=>x.key===key && x.kind==='audio');
  if(!item)return;
  const dock=document.querySelector('#audioDock');
  const old=dock.querySelector('audio');
  if(activeAudioKey===key && old) {
    if(old.paused)playAudioSafely(old);
    syncActiveAudioTiles();
    return;
  }
  const lastVolume=old ? old.volume : 1;
  if(old) old.pause();
  activeAudioKey=key;
  dock.innerHTML=audioDockMarkup(item);
  dock.hidden=false;
  const audio=dock.querySelector('audio');
  audio.volume=old?lastVolume:storedBgmVolume();
  audio.playbackRate=audioPlaybackRate;
  syncAudioTrack(audio);
  syncActiveAudioTiles();
  syncAudioDockMode();
  playAudioSafely(audio);
}

function unifiedFolderTileHTML(dir) {
  const name=folderDisplayName(dir);
  return '<div class="unifiedFolderTile"><button type="button" data-open-folder="'+esc(dir)+'" class="folderEntry" title="打开 '+esc(name)+'">'+
    '<span class="studioFolderIcon" aria-hidden="true">'+studioIcon('folder')+'</span><span class="studioFolderName">'+esc(name)+'</span></button>'+
    (allFolders.some(f=>f.relativeDir===dir)?'<button type="button" class="unifiedFolderMore" data-folder-more="'+esc(dir)+'" aria-label="管理目录 '+esc(name)+'" title="目录操作">⋯</button>':'')+'</div>';
}
// The video library shares the same folder hierarchy as photos and audio.
// 第一次打开视频默认展示原媒体目录；「全部视频」仍可手动切换。
function renderVideoFolders() {
  const nav=document.querySelector('#assetFolders');
  const parts=activeFolder==='root'?[]:activeFolder.split('/');
  let html='<button type="button" data-open-folder="all"'+(activeFolder==='all'?' class="on"':'')+'>全部视频</button>';
  if(activeFolder==='root')html+='<button type="button" class="on">原媒体目录</button>';
  else if(activeFolder!=='all')for(let i=0;i<parts.length;i++){
    const dir=parts.slice(0,i+1).join('/');
    if(dir==='data'||allFolders.some(f=>f.relativeDir===dir)||dir==='data/1001'||dir==='data/1002')
      html+='<button type="button" data-open-folder="'+esc(dir)+'"'+(dir===activeFolder?' class="on"':'')+'>'+esc(folderDisplayName(dir))+'</button>';
  }
  html+='<button type="button" id="unifiedNewAlbum" class="unifiedFolderNew">＋ 新建目录</button>';
  nav.innerHTML=html;
  const candidates=activeFolder==='all'?[{relativeDir:'root'},{relativeDir:'data'}]:
    activeFolder==='data'?[{relativeDir:'data/1001'},{relativeDir:'data/1002'},...allFolders.filter(f=>f.parentDir==='data')]:
    allFolders.filter(f=>f.parentDir===activeFolder);
  const show=candidates.filter(f=>{
    const dir=f.relativeDir;
    return dir==='root'||dir==='data'||allFolders.some(x=>x.relativeDir===dir) ||
      allItems.some(x=>x.kind==='video'&&(dir==='root'?!x.relativeDir:
        x.relativeDir===dir||String(x.relativeDir||'').startsWith(dir+'/')));
  });
  document.querySelector('#folderTiles').innerHTML=show.map(f=>unifiedFolderTileHTML(f.relativeDir)).join('');
  document.querySelector('#folderContext').textContent=
    (activeFolder==='all'?'全部视频':folderDisplayName(activeFolder))+' · '+
    allItems.filter(x=>x.kind==='video'&&(activeFolder==='all'||(x.relativeDir||'root')===activeFolder)).length+
    ' 个视频 · 可以将视频移动到素材目录';
}

function audioRatingHTML(item){
  const v=Number(item.rating||0);
  const stars=[1,2,3,4,5].map(n=>'<button class="ratingStar" type="button" aria-label="评分 '+n+'"><span class="ratingStarBase">★</span><span class="ratingStarFill" style="width:'+Math.max(0,Math.min(100,(v-n+1)*100))+'%">★</span></button>').join('');
  return '<div class="stars audioStars" data-key="'+esc(item.key)+'" data-rating="'+v+'">'+stars+'<span class="ratingValue">'+v.toFixed(1)+'</span></div>';
}
function renderAssets() {
  const query = document.querySelector('#search').value.trim().toLowerCase();
  const folderNames = [{relativeDir:'root',parentDir:'all'},
    {relativeDir:'data',parentDir:'all'},
    {relativeDir:'data/1001',parentDir:'data'},
    {relativeDir:'data/1002',parentDir:'data'},
    ...allFolders.map(x=>({relativeDir:x.relativeDir,parentDir:x.parentDir}))];
  const nav = document.querySelector('#assetFolders');
  let currentLabel = folderDisplayName(activeFolder);
  const folderButtons = [];
  folderButtons.push('<button type="button" data-open-folder="all"'+(activeFolder==='all'?' class="on"':'')+'>全部素材</button>');
  if (activeFolder !== 'all') {
    const parts = activeFolder==='root' ? [] : activeFolder.split('/');
    for(let i=0;i<parts.length;i++){
      const dir = parts.slice(0,i+1).join('/');
      if(dir==='data' || folderNames.some(x=>x.relativeDir===dir)){
        folderButtons.push('<button type="button" data-open-folder="'+esc(dir)+'"'+(dir===activeFolder?' class="on"':'')+'>'+esc(folderDisplayName(dir))+'</button>');
      }
    }
    if(activeFolder==='root') folderButtons.push('<button type="button" class="on">原媒体目录</button>');
  }
  folderButtons.push('<button type="button" id="fileSort" title="按文件名中的数字自然排序">名称 '+(fileSortAscending?'↑':'↓')+'</button>');
  folderButtons.push('<button type="button" id="unifiedNewAlbum" class="unifiedFolderNew" title="新建匿名化目录">＋ 新建目录</button>');
  nav.innerHTML = folderButtons.join('');
  const children = activeFolder==='all'
    ? folderNames.filter(x=>x.parentDir==='all')
    : folderNames.filter(x=>x.parentDir===activeFolder);
  const items = allItems.filter(x=>x.kind===libraryMode)
    .filter(x=>activeFolder==='all' || ((x.relativeDir||'root')===activeFolder))
    .filter(x=>!unifiedFavoriteOnly || x.favorite)
    .filter(x=>!query || ((x.originalName||'')+' '+(x.displayName||'')+' '+(x.title||'')).toLowerCase().includes(query))
    .sort((a,b)=>{
      const av = sortMode==='rating' ? Number(a.rating||0) : Number(a.modifiedTimeMs||0);
      const bv = sortMode==='rating' ? Number(b.rating||0) : Number(b.modifiedTimeMs||0);
      const diff=av-bv;
      return diff ? (sortDirection==='desc'?-diff:diff) : naturalFileOrder(a,b);
    });
  const folders = children.filter(folder => allItems.some(x=>
    x.kind===libraryMode && (!unifiedFavoriteOnly || x.favorite) && ((x.relativeDir||'root')===folder.relativeDir || (x.relativeDir||'root').startsWith(folder.relativeDir+'/'))
  ) || allFolders.some(x=>x.relativeDir===folder.relativeDir || x.parentDir===folder.relativeDir))
    .sort((a,b)=>filenameCollator.compare(folderDisplayName(a.relativeDir),folderDisplayName(b.relativeDir)));
  document.querySelector('#folderContext').textContent =
    (activeFolder==='all'?'全部目录':currentLabel)+' · '+items.length+' 个'+(libraryMode==='image'?'图片':'音频')+
    ' · 文件名按数字自然排序（2、9、10）'+(libraryMode==='audio'?' · 双击文件播放':'');
  const parent = document.querySelector('#grid');
  parent.className = libraryMode==='image' ? 'pictureWall' : 'audioFileGrid';
  const folderHtml = folders.map(f=>unifiedFolderTileHTML(f.relativeDir)).join('');
  document.querySelector('#folderTiles').innerHTML = folderHtml;
  if (libraryMode === 'image') {
    imageViewerList = items;
    document.querySelector('#photoSummary').textContent =
      items.length + ' 张照片 · ' + folders.length + ' 个相簿';
    const imageFolders = folders.map(f => {
      const files = allItems.filter(x => x.kind === 'image' && (!unifiedFavoriteOnly || x.favorite) &&
        ((x.relativeDir||'root')===f.relativeDir || (x.relativeDir||'root').startsWith(f.relativeDir + '/')));
      const previews = files.slice(0,4);
      const art = previews.length ? previews.map(x =>
        '<img loading="lazy" alt="" src="/api/image-thumb/'+esc(x.key)+'">'
      ).join('') : '<span aria-hidden="true">▧</span>';
      return '<div class="unifiedFolderTile"><button type="button" class="photoAlbum" data-open-folder="'+esc(f.relativeDir)+'" title="打开相簿 '+esc(folderDisplayName(f.relativeDir))+'">'+
        '<div class="photoAlbumMosaic" data-count="'+previews.length+'">'+art+'</div><strong class="photoAlbumName">'+esc(folderDisplayName(f.relativeDir))+'</strong>'+
        '<span class="photoAlbumCount">'+files.length+' 张照片</span></button>'+
        (allFolders.some(folder=>folder.relativeDir===f.relativeDir)?'<button type="button" class="unifiedFolderMore" data-folder-more="'+esc(f.relativeDir)+'" title="相簿操作" aria-label="管理相簿 '+esc(folderDisplayName(f.relativeDir))+'">⋯</button>':'')+'</div>';
    });
    document.querySelector('#folderTiles').innerHTML = imageFolders.join('');
    renderPhotoGrid(parent,items,folders);
  } else {
    parent.innerHTML = (items.length?items.map(item=>
      '<article class="audioFileTile mediaTile'+(activeAudioKey===item.key?' isActive':'')+(mediaSelectedKeys.has(item.key)?' unifiedSelected':'')+'" data-media-key="'+esc(item.key)+'" data-favorite="'+(item.favorite?'true':'false')+'" data-audio-file-key="'+esc(item.key)+'" tabindex="0" role="button" aria-pressed="'+(activeAudioKey===item.key?'true':'false')+'" title="双击播放：'+esc(audioDisplayName(item))+'">'+
      '<button type="button" class="mediaTileCheck" data-media-select="'+esc(item.key)+'" aria-label="选择音频">✓</button>'+
      '<div class="audioFileText"><div class="audioFileName">'+esc(audioDisplayName(item))+'</div>'+
      '<div class="audioFileMeta">'+esc(item.durationText || (Number(item.duration)>0 ? audioClock(item.duration) : '--:--'))+'<span class="audioFileSize"> · '+esc(item.sizeText||'')+'</span></div>'+audioRatingHTML(item)+'</div>'+
      '<button type="button" class="unifiedMore" data-media-more="'+esc(item.key)+'" aria-label="更多文件操作">⋯</button>'+
      '<div class="audioFileActions"><button type="button" class="audioFileRename" data-rename-audio="'+esc(item.key)+'" title="重命名（F2）" aria-label="重命名 '+esc(audioDisplayName(item))+'">✎</button>'+
      '<button type="button" class="audioFileDelete" data-delete-asset="'+esc(item.key)+'" title="删除文件" aria-label="删除 '+esc(audioDisplayName(item))+'">×</button></div></article>'
    ).join(''):(folders.length?'':'<div class="empty">暂无音频，拖入 data 目录后会自动入库</div>'));
    // 刷新列表绝不重建播放器；当前文件被外部移除时才关闭。
    if(activeAudioKey && !allItems.some(x=>x.key===activeAudioKey && x.kind==='audio'))closeAudioDock();
  }
  syncUnifiedTiles();
  if (libraryMode === 'audio') {renderedAudioSignature=audioUIStamp(allItems,allFolders);pendingAudioRender=false;}
}

function photoTileHTML(item,index) {
  const label = unifiedMediaName(item);
  return '<button type="button" class="pictureTile mediaTile'+(photoSelectedKeys.has(item.key)?' selected unifiedSelected':'')+'" data-media-key="'+esc(item.key)+'" data-favorite="'+(item.favorite?'true':'false')+'" data-picture-index="'+index+'" title="'+esc(label)+'" aria-label="'+esc(label)+'">'+
    '<img loading="lazy" decoding="async" alt="'+esc(label)+'" src="/api/image-thumb/'+esc(item.key)+'">'+
    '<span class="photoCheck" aria-hidden="true">✓</span><span class="photoTileName">'+esc(label)+'</span><span class="unifiedMore" role="button" tabindex="0" data-media-more="'+esc(item.key)+'" aria-label="更多操作">⋯</span></button>';
}
function renderPhotoGrid(parent,items,folders) {
  if (photoObserver) {photoObserver.disconnect();photoObserver=null;}
  parent.className = 'pictureWall'+(photoSelectMode?' photoSelecting':'')+(photoOriginalRatio?' photoOriginalRatio':'');
  parent.style.setProperty('--photo-cell',photoTileSize+'px');
  const count = Math.min(items.length,120);
  parent.innerHTML = items.length
    ? items.slice(0,count).map((item,i)=>photoTileHTML(item,i)).join('')
    : (folders.length?'':'<div class="empty">暂无图片，拖入 data 目录后自动加入图库</div>');
  let shown=count;
  if (shown<items.length) {
    const marker = document.createElement('div');
    marker.className='photoGridMore';marker.textContent='继续加载照片…';
    parent.appendChild(marker);
    photoObserver = new IntersectionObserver(entries=>{
      if (!entries.some(e=>e.isIntersecting) || shown>=items.length) return;
      const next=Math.min(items.length,shown+120);
      marker.insertAdjacentHTML('beforebegin',items.slice(shown,next).map((item,i)=>photoTileHTML(item,shown+i)).join(''));
      shown=next;
      if (shown>=items.length) {photoObserver.disconnect();photoObserver=null;marker.remove();}
    },{rootMargin:'450px'});
    photoObserver.observe(marker);
  }
  syncPhotoSelectionUI();
}
function syncPhotoSelectionUI() {
  const bar=document.querySelector('#photoSelectionBar');
  bar.hidden=!photoSelectMode;
  document.querySelector('#photoSelect').setAttribute('aria-pressed',String(photoSelectMode));
  document.querySelector('#photoSelect').textContent=photoSelectMode?'完成':'选择';
  syncUnifiedControls();
  document.querySelector('#photoSelectedCount').textContent='已选择 '+photoSelectedKeys.size+' 张';
  document.querySelector('#photoDeleteSelected').disabled=!photoSelectedKeys.size;
  const grid=document.querySelector('#grid');
  grid.classList.toggle('photoSelecting',photoSelectMode);
  grid.querySelectorAll('[data-picture-index]').forEach(el=>{
    const item=imageViewerList[Number(el.dataset.pictureIndex)];
    el.classList.toggle('selected',!!item&&photoSelectedKeys.has(item.key));
    el.classList.toggle('unifiedSelected',!!item&&photoSelectedKeys.has(item.key));
    el.setAttribute('aria-pressed',String(!!item&&photoSelectedKeys.has(item.key)));
  });
}
function setPhotoSelectionMode(active) {
  mediaSelectMode=!!active;photoSelectMode=!!active;photoSelectedKeys.clear();syncPhotoSelectionUI();syncUnifiedControls();
}
let photoRailRenderedList=null;
function photoCurrentItem() {return imageViewerList[imageViewerIndex]||null;}
function photoThumb(item) {return '/api/image-thumb/'+encodeURIComponent(item.key);}
function showImageViewer(index) {
  if (!imageViewerList.length) return;
  const nextImageIndex=(index+imageViewerList.length)%imageViewerList.length;
  if(imageViewerIndex!==nextImageIndex || !document.querySelector("#assetView").classList.contains("open")) jfResetPhotoFilter();
  imageViewerIndex=nextImageIndex;
  const item=photoCurrentItem();
  const viewer=document.querySelector('#assetView');
  const img=document.querySelector('#assetViewImg');
  const surface=document.querySelector('.photoImageSurface');
  const title=unifiedMediaName(item);
  document.querySelector('#assetViewName').textContent=title;
  document.querySelector('#assetViewName').title=title;
  document.querySelector('#photoDetailCount').textContent=(imageViewerIndex+1)+' / '+imageViewerList.length;
  photoViewerZoomed=false;photoViewerScale=1;photoViewerPanX=0;photoViewerPanY=0;applyPhotoTransform();
  document.querySelector('#photoMorePanel').hidden=true;document.querySelector('#photoMoreToggle').setAttribute('aria-expanded','false');
  surface.classList.add('isLoading');
  // onload/onerror 不依赖全量预解码；相邻缩略图先加载，原图按需请求。
  img.onload=()=>surface.classList.remove('isLoading');
  img.onerror=()=>{surface.classList.remove('isLoading');};
  img.src=item.mediaUrl;
  // 不截断缩略目录。图片数量很大时，由浏览器 lazy-loading 按需加载封面；
  // 切换图片只更新选中状态和滚动位置，不重复创建整个缩略条。
  const photoRail=document.getElementById('photoFilmstrip');
  if(photoRailRenderedList!==imageViewerList){
    photoRail.innerHTML=imageViewerList.map((x,i)=>
      '<button type="button" data-film-index="'+i+'" title="'+esc(x.originalName||x.title)+'" aria-label="跳转至第 '+(i+1)+' 张"><img loading="lazy" src="'+photoThumb(x)+'" alt=""></button>'
    ).join('');
    photoRailRenderedList=imageViewerList;
  }
  photoRail.querySelector('.isCurrent')?.classList.remove('isCurrent');
  photoRail.querySelector('[data-film-index="'+imageViewerIndex+'"]')?.classList.add('isCurrent');
  viewer.classList.add('open');viewer.setAttribute('aria-hidden','false');
  document.body.classList.add('photoDetailOpen');
  document.querySelector('#photoFilmstrip .isCurrent')?.scrollIntoView({inline:'nearest',block:'center'});
}
function hideImageViewer() {
  jfResetPhotoFilter();
  document.querySelector('#assetView').classList.remove('open');
  document.querySelector('#assetView').setAttribute('aria-hidden','true');
  document.body.classList.remove('photoDetailOpen');
  document.querySelector('#assetViewImg').removeAttribute('src');
  photoViewerScale=1;photoViewerPanX=0;photoViewerPanY=0;applyPhotoTransform();
}
function togglePhotoZoom() {
 const surface=document.querySelector('.photoImageSurface');
 const r=surface.getBoundingClientRect();
 setPhotoScale(photoViewerScale>1?1:2,r.left+r.width/2,r.top+r.height/2);
}
async function removePhotos(keys) {
  const unique=[...new Set(keys)].filter(key=>allItems.some(x=>x.key===key&&x.kind==='image'));
  if (!unique.length) return;
  if (!confirm('确定永久删除这 '+unique.length+' 张图片吗？此操作无法撤销。')) return;
  try {
    let failures=0;
    // 服务端每批最多处理 500 张；较大的组图分批提交，用户只需确认一次。
    for(let start=0;start<unique.length;start+=500){
      const result=await mediaPost('/api/delete-images',{keys:unique.slice(start,start+500)});
      failures+=(result.failed||[]).length;
    }
    photoSelectedKeys.clear();
    hideImageViewer();
    setPhotoSelectionMode(false);
    await load();
    if(failures) alert('有 '+failures+' 张图片删除失败，请检查文件占用情况。');
  } catch(error){await load();alert('删除图片失败：'+error.message);}
}
// 仅改写 data.json 的显示名称；磁盘文件 hash、原始文件名、媒体 key 均不变。
function beginAudioRename(tile) {
  if (!tile || tile.classList.contains('isRenaming')) return;
  const item = allItems.find(x => x.key === tile.dataset.audioFileKey && x.kind === 'audio');
  if (!item) return;
  const nameElement = tile.querySelector('.audioFileName');
  if (!nameElement) return;
  const current = audioDisplayName(item);
  const ext = String(item.originalExt || '').toLowerCase();
  const base = ext && current.toLowerCase().endsWith(ext) ? current.slice(0,-ext.length) : current;
  const form = document.createElement('div');
  form.className = 'audioRenameEditor';
  const row = document.createElement('div');
  row.className = 'audioRenameRow';
  const input = document.createElement('input');
  input.className = 'audioRenameInput';
  input.type = 'text';
  input.maxLength = 160;
  input.value = base;
  input.setAttribute('aria-label','新的音频名称（不含扩展名）');
  const suffix = document.createElement('span');
  suffix.className = 'audioRenameExt';
  suffix.textContent = ext;
  const save = document.createElement('button');
  save.type = 'button'; save.className = 'audioRenameConfirm'; save.textContent = '保存';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'audioRenameCancel'; cancel.textContent = '取消';
  const hint = document.createElement('div');
  hint.className = 'audioRenameHint'; hint.textContent = '回车保存 · Esc 取消';
  row.append(input,suffix,save,cancel);
  form.append(row,hint);
  tile.classList.add('isRenaming');
  nameElement.replaceWith(form);
  let busy = false, done = false;
  const rollback = () => {
    if (done || busy) return;
    done = true;
    if (form.isConnected) form.replaceWith(nameElement);
    tile.classList.remove('isRenaming');
  };
  const commit = async () => {
    if (busy || done) return;
    const baseName = input.value.trim();
    if (!baseName) {input.focus();input.setCustomValidity('名称不能为空');input.reportValidity();return;}
    input.setCustomValidity('');
    const fullName = baseName + ext;
    if (fullName === current) {rollback();return;}
    busy = true; input.disabled = true; save.disabled = true; cancel.disabled = true;
    save.textContent = '保存中…';
    try {
      const result = await mediaPost('/api/rename-audio',{key:item.key,name:fullName});
      item.displayName = result.displayName;
      done = true;
      // 底部播放实例保持原样，仅更新文字，绝不重新加载 audio。
      if (activeAudioKey === item.key) {
        const title = document.querySelector('#audioDock .audioTitle');
        if (title) {title.textContent = result.displayName; title.title = result.displayName;}
      }
      renderAssets();
    } catch (error) {
      busy = false; input.disabled = false; save.disabled = false; cancel.disabled = false;
      save.textContent = '保存'; alert('重命名失败：'+(error.message||'未知错误'));
      input.focus();
    }
  };
  form.addEventListener('click',event=>event.stopPropagation());
  form.addEventListener('dblclick',event=>event.stopPropagation());
  form.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();rollback();}
    else if(event.key==='Enter'){event.preventDefault();commit();}
  });
  save.addEventListener('click',commit);
  cancel.addEventListener('click',rollback);
  input.addEventListener('input',()=>input.setCustomValidity(''));
  input.focus(); input.select();
}
async function deleteAsset(key) {
  if (!confirm('确定永久删除这个素材文件吗？')) return;
  try {
    const r = await fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
    const result = await r.json();
    if (!r.ok || !result.ok) throw new Error(result.error||'删除失败');
    if(key===activeAudioKey)closeAudioDock();
    await load();
  } catch(error) {alert('删除失败：'+error.message);}
}

async function mediaPost(url, body) {
  const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error||'操作失败');
  return result;
}

// 截图即逐帧辅助：打开即显示当前位置，左右方向键切到真实的前/后帧。
// 不在浏览器里预先生成数百张图片，只有用户点击保存时 FFmpeg 才输出一张原图。
async function performVideoAction(action) {
  const item = getCurrentFeedItem();
  const video = getCurrentFeedVideo();
  if (!item || item.kind !== 'video') return;
  if (action === 'shot') return openShotStudio(item, video);
  if (action !== 'audio') return;
  const button = document.querySelector('#feedAudio');
  if (button.disabled) return;
  button.disabled = true;
  const label = button.querySelector('.feedToolLabel');
  const previous = label ? label.textContent : '';
  button.classList.add('loading');
  button.setAttribute('aria-busy','true');
  if (label) label.textContent = '处理中';
  try {
    await jfTrackedMediaPost('/api/extract-audio', {key:item.key}, '提取音轨');
    await load();
    alert('音轨已保存到音频 → 提取的音轨（包含原视频中的所有声音）。');
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.classList.remove('loading');
    button.removeAttribute('aria-busy');
    if (label) label.textContent = previous;
  }
}

async function openShotStudio(item, sourceVideo) {
  if (document.querySelector('.shotStudioBack')) return;
  if (!sourceVideo) {alert('当前视频未加载');return;}
  const originalTime = Number(sourceVideo.currentTime)||0;
  const shouldResume = !sourceVideo.paused;
  const playingVideos = [...document.querySelectorAll('#feedScroller video.feedVideo')];
  const forbidAutoResume = event => {
    if (event.target?.matches?.('video.feedVideo')) {try {event.target.pause();} catch {}}
  };
  document.addEventListener('play',forbidAutoResume,true);
  playingVideos.forEach(video=>{try{video.pause();}catch{}});

  const layer=document.createElement('div');
  layer.className='shotStudioBack';
  layer.setAttribute('role','dialog');
  layer.setAttribute('aria-modal','true');
  layer.setAttribute('aria-label','逐帧截图');
  layer.innerHTML=
    '<section class="shotStudio">'+
      '<header class="shotTop">'+
        '<div class="shotHeading"><strong>逐帧</strong><small></small></div>'+
        '<div class="shotActions">'+
          '<button type="button" class="shotSave" disabled>保存截图</button>'+
          '<button type="button" class="shotCover" disabled>设为封面</button>'+
          '<button type="button" class="shotClose" aria-label="关闭">×</button>'+
        '</div>'+
      '</header>'+
      '<div class="shotStage"><canvas class="shotSnapshot" aria-hidden="true"></canvas><video class="shotVideo" muted playsinline preload="metadata"></video><div class="shotThumbProgress" hidden></div></div>'+
      '<footer class="shotFoot">'+
        '<div class="shotInfo"><span class="shotIndex">读取帧信息…</span><span class="shotTime">← → 快速切帧</span><span class="shotFeedback" role="status" aria-live="polite"></span></div>'+ 
        '<div class="shotScrubber"><button type="button" class="shotPrev" disabled title="上一帧（←）" aria-label="上一帧">‹</button><input class="shotSeek" type="range" min="0" max="0" step="1" value="0" disabled aria-label="定位到指定帧"><button type="button" class="shotNext" disabled title="下一帧（→）" aria-label="下一帧">›</button></div>'+ 
      '</footer>'+
    '</section>';
  // Portrait clips leave side gutters on a landscape monitor. Put frame controls
  // in that unused gutter rather than covering the subject's lower body.
  if(sourceVideo.videoWidth>0 && sourceVideo.videoHeight>0 && sourceVideo.videoHeight>sourceVideo.videoWidth){
    const modal=layer.querySelector('.shotStudio');
    modal.classList.add('shotPortrait');
    const availableWidth=Math.min(1520,window.innerWidth-36);
    const availableHeight=Math.min(window.innerHeight*.96,1040);
    const mediaWidth=availableHeight*sourceVideo.videoWidth/sourceVideo.videoHeight;
    modal.style.setProperty('--shot-side-width',Math.max(120,Math.min(360,(availableWidth-mediaWidth)/2-36))+'px');
  }
  const preview=layer.querySelector('.shotVideo');
  const snapshot=layer.querySelector('.shotSnapshot');
  const progress=layer.querySelector('.shotThumbProgress');
  const title=layer.querySelector('.shotHeading small');
  const status=layer.querySelector('.shotIndex');
  const timeLabel=layer.querySelector('.shotTime');
  const feedback=layer.querySelector('.shotFeedback');
  const save=layer.querySelector('.shotSave');
  const cover=layer.querySelector('.shotCover');
  const prev=layer.querySelector('.shotPrev');
  const next=layer.querySelector('.shotNext');
  const seek=layer.querySelector('.shotSeek');
  title.textContent=item.title||item.originalName||'视频';
  document.body.appendChild(layer);
  document.body.classList.add('shotStudioOpen');

  // 当前播放器的画面先顶上；之后只绘制 320 像素预览，避免大画布占内存。
  try {
    if (sourceVideo.readyState >= 2 && sourceVideo.videoWidth && sourceVideo.videoHeight) {
      const ratio=Math.min(1,480/Math.max(sourceVideo.videoWidth,sourceVideo.videoHeight));
      snapshot.width=Math.max(1,Math.round(sourceVideo.videoWidth*ratio));
      snapshot.height=Math.max(1,Math.round(sourceVideo.videoHeight*ratio));
      snapshot.getContext('2d').drawImage(sourceVideo,0,0,snapshot.width,snapshot.height);
    } else snapshot.hidden=true;
  } catch {snapshot.hidden=true;}

  let frames=[];
  let index=0;
  let closed=false;
  let busy=false;
  let canPreview=false;
  let duration=Number(item.duration)||Number(sourceVideo.duration)||0;
  let previewId='';
  let previewReady=0;
  let previewDone=false;
  let previewError='';
  let pollTimer=0;
  let refineTimer=0;
  let renderToken=0;
  let refiningToken=-1;
  const thumbImages=new Map();
  const thumbLoading=new Set();
  const maxThumbCache=40;
  const frameTime=()=>Math.max(0,Number(frames[index])||0);
  const preciseTime=()=>Math.min(Math.max(0,duration-0.001),frameTime()+0.0005);
  let estimatedFrameTimes=false;
  let estimatedFps=30;
  const showStatus=message=>{feedback.textContent=message;};
  const fmtShotTime=t=>{
    const ms=Math.max(0,Math.round((Number(t)||0)*1000));
    return Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');
  };
  const update=()=>{
    status.textContent=frames.length?'第 '+(index+1)+' / '+frames.length+' 帧':'读取帧信息…';
    timeLabel.textContent=frames.length?(estimatedFrameTimes?'≈ ':'')+fmtShotTime(frameTime())+' · ← → 快速切帧':'← → 切换 · Esc 关闭';
    prev.disabled=busy||!frames.length||index===0;
    next.disabled=busy||!frames.length||index>=frames.length-1;
    seek.disabled=busy||!frames.length;
    seek.max=String(Math.max(0,frames.length-1));
    seek.value=String(index);
    seek.style.setProperty('--shot-position',frames.length>1 ? (index/(frames.length-1)*100).toFixed(2)+'%' : '0%');
    // 截图、封面直接读取源视频，不依赖缩略图或 HTMLVideo 是否成功解码。
    save.disabled=busy||!frames.length;
    cover.disabled=busy||!frames.length;
  };
  const renderThumb=indexToDraw=>{
    const img=thumbImages.get(indexToDraw);
    if (!img?.complete||!img.naturalWidth) return false;
    // 更新低清画布；原视频始终在下层。只切小图不会触发播放器的每帧 seek。
    snapshot.width=img.naturalWidth;
    snapshot.height=img.naturalHeight;
    snapshot.getContext('2d').drawImage(img,0,0);
    snapshot.hidden=false;
    return true;
  };
  const previewImageAvailable=i=>i>=0&&i<frames.length&&previewId&&(
    i<Math.max(0,previewReady-1)||previewDone
  );
  const requestThumb=i=>{
    if (closed||!previewImageAvailable(i)||thumbImages.has(i)||thumbLoading.has(i)) return;
    thumbLoading.add(i);
    const img=new Image();
    img.onload=()=>{
      thumbLoading.delete(i);
      if(closed)return;
      thumbImages.set(i,img);
      // LRU: 保留当前帧附近一小段，不让整段视频占据大量内存。
      if(thumbImages.size>maxThumbCache){
        const oldest=thumbImages.keys().next().value;
        thumbImages.delete(oldest);
      }
      if(i===index) {
        // 如果高清已经显示，不用低清图重新盖回去。
        if(snapshot.hidden) return;
        renderThumb(i);
        progress.hidden=true;
      }
    };
    img.onerror=()=>{thumbLoading.delete(i);};
    img.src='/api/frame-preview/image/'+previewId+'/'+i;
  };
  const prefetch=()=>{
    if(!frames.length||!previewId)return;
    requestThumb(index);
    for(let offset=1;offset<=5;offset++) {
      requestThumb(index+offset);
      requestThumb(index-offset);
    }
  };
  const updateProgress=()=>{
    if(closed||!frames.length){progress.hidden=true;return;}
    if(!previewDone&&!previewError&&previewReady<frames.length) {
      progress.textContent='正在准备快速预览 '+Math.min(previewReady,frames.length)+' / '+frames.length;
      progress.hidden=false;
    } else progress.hidden=true;
  };
  const refine=token=>{
    if(closed||!frames.length||!canPreview||token!==renderToken)return;
    refiningToken=token;
    try{
      const t=Math.max(0,Math.min(frameTime()+0.0005,Math.max(0,preview.duration-0.001)));
      // 已经在指定帧：无需重复寻址；否则仅在停止按键后 seek 一次。
      if(Math.abs(preview.currentTime-t)<0.0004&&preview.readyState>=2){snapshot.hidden=true;progress.hidden=true;return;}
      preview.currentTime=t;
    }catch(error){showStatus('高清画面定位失败：'+error.message);}
  };
  const scheduleRefine=()=>{
    clearTimeout(refineTimer);
    const token=renderToken;
    refineTimer=setTimeout(()=>refine(token),240);
  };
  const showFrame=()=>{
    if(!frames.length||closed)return;
    renderToken++;
    refiningToken=-1;
    // 无论上一帧是否为高清，都先展示缓存画布，避免旧视频帧闪现。
    snapshot.hidden=false;
    if(renderThumb(index))progress.hidden=true;
    else updateProgress();
    prefetch();
    scheduleRefine();
    update();
  };
  const move=delta=>{
    if(!frames.length||busy||closed)return;
    const nextIndex=Math.max(0,Math.min(frames.length-1,index+delta));
    if(nextIndex===index)return;
    index=nextIndex;
    showStatus('');
    showFrame();
  };
  const close=()=>{
    if(closed||busy)return;
    closed=true;
    clearTimeout(pollTimer);
    clearTimeout(refineTimer);
    thumbImages.clear();
    window.removeEventListener('keydown',onKeyDown,true);
    document.removeEventListener('play',forbidAutoResume,true);
    preview.pause();preview.removeAttribute('src');preview.load();
    layer.remove();document.body.classList.remove('shotStudioOpen');
    if(shouldResume&&sourceVideo.isConnected)sourceVideo.play().catch(()=>{});
  };
  const onKeyDown=event=>{
    if(closed||!['Escape','ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.key==='Escape')close();
    else move(event.key==='ArrowLeft'?-1:1);
  };
  window.addEventListener('keydown',onKeyDown,true);
  layer.querySelector('.shotClose').addEventListener('click',close);
  layer.addEventListener('click',event=>{if(event.target===layer)close();});
  prev.addEventListener('click',()=>move(-1));
  next.addEventListener('click',()=>move(1));
  seek.addEventListener('input',()=>{
    if(busy||closed||!frames.length)return;
    const target=Math.max(0,Math.min(frames.length-1,Math.round(Number(seek.value)||0)));
    if(target!==index){index=target;showStatus('');showFrame();}
  });
  preview.addEventListener('play',()=>preview.pause());
  preview.addEventListener('loadedmetadata',()=>{
    if(closed)return;
    duration=Number(preview.duration)||duration;
    canPreview=true;
    scheduleRefine();
  });
  preview.addEventListener('seeked',()=>{
    if(closed||refiningToken!==renderToken||!frames.length)return;
    if(Math.abs(preview.currentTime-frameTime())<0.008){
      snapshot.hidden=true;
      progress.hidden=true;
    }
  });
  preview.addEventListener('error',()=>{
    if(!closed)showStatus('高清解码不可用，仍可通过缩略图选帧并保存原图');
  });
  const pollPreview=async()=>{
    if(closed||!previewId||previewDone||previewError)return;
    try{
      const result=await fetch('/api/frame-preview/status?key='+encodeURIComponent(item.key),{cache:'no-store'}).then(r=>r.json());
      if(closed||!result.ok||result.id!==previewId)return;
      const previousReady=previewReady;
      previewReady=result.ready;
      previewDone=result.done;
      previewError=result.error||'';
      if(estimatedFrameTimes&&previewDone&&previewReady>0&&previewReady!==frames.length){
        const previousIndex=index;
        frames=Array.from({length:previewReady},(_,i)=>i/estimatedFps);
        index=Math.min(previousIndex,frames.length-1);
        showFrame();
      }
      if(previewReady!==previousReady||previewDone){
        prefetch();
        if(!snapshot.hidden&&!thumbImages.has(index))requestThumb(index);
      }
      updateProgress();
      if(previewError)showStatus('低清预览生成失败，已回退到原视频定位：'+previewError.slice(0,80));
    }catch{}
    finally{if(!closed&&!previewDone&&!previewError)pollTimer=setTimeout(pollPreview,180);}
  };
  const apply=async action=>{
    if(!frames.length||busy||closed)return;
    busy=true;update();
    const chosen=index;
    try{
      const result=await mediaPost(action==='save'?'/api/screenshot':'/api/set-cover',{
        key:item.key,time:preciseTime(),precise:true,
        ...(estimatedFrameTimes?{frameIndex:chosen}:{}),
      });
      if(action==='save')showStatus('✓ 第 '+(chosen+1)+' 帧已保存（原始分辨率），可以继续选图');
      else {
        showStatus('✓ 第 '+(chosen+1)+' 帧已设为封面（原始分辨率）');
        item.coverTime=result.time;item.cover=result.cover+'?v='+Date.now();
      }
      await load();
    }catch(error){showStatus('操作失败：'+error.message);}
    finally{busy=false;update();}
  };
  save.addEventListener('click',()=>apply('save'));
  cover.addEventListener('click',()=>apply('cover'));
  preview.src=item.videoUrl||item.mediaUrl;
  preview.load();
  try {
    const response=await mediaPost('/api/frame-times',{key:item.key,duration});
    if(closed)return;
    frames=response.times;
    estimatedFrameTimes=!!response.estimated;
    estimatedFps=Number(response.fps)||30;
    if(!frames.length)throw new Error('视频没有可用画面');
    if(estimatedFrameTimes)showStatus(response.warning||'使用估算时间，保存仍按原视频帧序号提取。');
    duration=response.duration||duration;
    let left=0,right=frames.length;
    while(left<right){const mid=(left+right)>>1;if(frames[mid]<originalTime)left=mid+1;else right=mid;}
    index=Math.max(0,Math.min(frames.length-1,left));
    if(index&&(left===frames.length||Math.abs(frames[index-1]-originalTime)<Math.abs(frames[index]-originalTime)))index--;
    showFrame();
    // 后台一次解码视频生成 320px 缩略图；逐帧切换不再反复启动 FFmpeg。
    mediaPost('/api/frame-preview/start',{key:item.key}).then(result=>{
      if(closed)return;
      previewId=result.id;
      previewReady=result.ready;
      previewDone=result.done;
      previewError=result.error||'';
      prefetch();updateProgress();
      if(!previewDone&&!previewError)pollPreview();
    }).catch(error=>{if(!closed)showStatus('低清缓存不可用，已回退至原视频预览：'+error.message);});
  }catch(error){
    if(!closed){status.textContent='无法读取帧';showStatus(error.message);update();}
  }
}

/* 影格 Studio v6.1: 纯本地媒体列表。不采集任何观看或收听历史。 */
try { localStorage.removeItem('yingge-studio-recent-v1'); } catch (_) {}
function renderStudioEntrance() {
  const room=document.getElementById('studioEntrance');
  if(!room)return;
  room.innerHTML='';
  room.hidden=true;
  document.body.classList.remove('studioAtEntrance');
}
let studioChromeIdleTimer=0;
function wakeStudioFeedChrome(){
  const overlay=document.querySelector('#feedOverlay');
  if(!overlay?.classList.contains('open'))return;
  clearTimeout(studioChromeIdleTimer);
  overlay.classList.remove('chromeIdle');
  studioChromeIdleTimer=setTimeout(()=>{
    if(overlay.classList.contains('open')&&!overlay.classList.contains('toolsOpen')&&!overlay.classList.contains('infoVisible')&&!overlay.classList.contains('railOpen'))overlay.classList.add('chromeIdle');
  },3000);
}
document.getElementById('feedOverlay').addEventListener('pointermove',wakeStudioFeedChrome,{passive:true});
function resetStudioFeedPanels(){
  const overlay=document.querySelector('#feedOverlay');if(!overlay)return;
  clearTimeout(studioChromeIdleTimer);
  overlay.classList.remove('chromeIdle');
  overlay.classList.remove('toolsOpen','railOpen','infoVisible');
  document.getElementById('studioRatingDock')?.replaceChildren();
  document.getElementById('studioRatingDock').hidden=true;
  [['feedToolsToggle','aria-expanded'],['feedRailToggle','aria-pressed'],['feedRatingToggle','aria-pressed']].forEach(([id,attr])=>document.querySelector('#'+id)?.setAttribute(attr,'false'));
}
function centerStudioFilmstrip() {
  const root=document.getElementById('feedFilmstrip');
  const current=root?.querySelector('.feedFilmTile.current');
  if(!current || !root?.classList) return;
  root.scrollTop=Math.max(0,current.offsetTop-root.offsetTop-(root.clientHeight-current.offsetHeight)/2);
}
function renderFeedFilmstrip(){
  const root=document.getElementById('feedFilmstrip');if(!root)return;
  const overlay=document.getElementById('feedOverlay');
  // No thumbnail DOM or cover requests until the owner actually opens the rail.
  if(!overlay?.classList.contains('railOpen'))return;
  const sections=feedSections();
  const signature=sections.map(section=>section.dataset.key).join('|');
  sections.forEach(section=>section.classList.toggle('studioCurrent',section.dataset.key===currentFeedKey));
  if(root._studioSequence!==signature){
    // Full sequence, built only when its contents change (not every scroll event).
    const byKey=new Map(allItems.map(item=>[item.key,item]));
    root.innerHTML=sections.map(section=>{
      const item=byKey.get(section.dataset.key);
      if(!item)return '';
      const name=esc(unifiedMediaName(item));
      return '<button type="button" class="feedFilmTile" data-feed-jump="'+esc(item.key)+'" title="'+name+'" aria-label="切换到 '+name+'">'+(item.cover?'<img loading="lazy" decoding="async" alt="" src="'+esc(item.cover)+'">':studioIcon('play'))+'</button>';
    }).join('');
    root._studioSequence=signature;
  }
  const previous=root.querySelector('.feedFilmTile.current');
  if(previous?.dataset.feedJump===currentFeedKey)return;
  previous?.classList.remove('current');
  const current=Array.from(root.querySelectorAll('.feedFilmTile')).find(node=>node.dataset.feedJump===currentFeedKey);
  current?.classList.add('current');
  requestAnimationFrame(centerStudioFilmstrip);
}
function renderStudioRatingDock(){
  const dock=document.getElementById('studioRatingDock');
  const overlay=document.getElementById('feedOverlay');
  if(!dock || !overlay)return;
  if(!overlay.classList.contains('infoVisible') || !overlay.classList.contains('open')){
    dock.hidden=true; dock.replaceChildren(); return;
  }
  const item=allItems.find(i=>i.key===currentFeedKey);
  if(!item || item.kind!=='video'){
    dock.hidden=true;dock.replaceChildren();return;
  }
  dock.innerHTML=feedRatingMarkup(item);
  dock.hidden=false;
}
const studioRatingDock=document.getElementById('studioRatingDock');
studioRatingDock.addEventListener('pointerdown',event=>{
  const stars=event.target.closest('.feedRating');
  if(!stars)return;
  event.stopPropagation();startRating(event,stars);
});
studioRatingDock.addEventListener('pointermove',moveRating);
studioRatingDock.addEventListener('pointerup',endRating);
studioRatingDock.addEventListener('pointercancel',endRating);
function setStudioFeedPanel(kind,force){
  const overlay=document.querySelector('#feedOverlay');if(!overlay?.classList.contains('open'))return;
  const map={tools:['toolsOpen','feedToolsToggle','aria-expanded'],rail:['railOpen','feedRailToggle','aria-pressed'],info:['infoVisible','feedRatingToggle','aria-pressed']};
  const cfg=map[kind];if(!cfg)return;
  const on=typeof force==='boolean'?force:!overlay.classList.contains(cfg[0]);
  overlay.classList.toggle(cfg[0],on);
  if(on){
    jfCloseFilter('video');
    for(const [other,config] of Object.entries(map)){
      if(other===kind)continue;
      overlay.classList.remove(config[0]);
      document.getElementById(config[1]).setAttribute(config[2],'false');
    }
    if(kind!=='rail'){
      const root=document.getElementById('feedFilmstrip');
      root.replaceChildren();root._studioSequence='';
    }
  }
  renderStudioRatingDock();
  document.getElementById(cfg[1]).setAttribute(cfg[2],String(on));
  if(on&&kind==='tools'){overlay.classList.remove('railOpen');document.querySelector('#feedRailToggle').setAttribute('aria-pressed','false');const rail=document.getElementById('feedFilmstrip');rail.replaceChildren();rail._studioSequence='';}
  if(!on&&kind==='rail'){const root=document.getElementById('feedFilmstrip');root.replaceChildren();root._studioSequence='';}
  if(on&&kind==='rail'){renderFeedFilmstrip();requestAnimationFrame(centerStudioFilmstrip);}
  wakeStudioFeedChrome();
}
function jumpStudioFeed(key){
  const section=feedSections().find(x=>x.dataset.key===key);if(!section)return;
  section.scrollIntoView({block:'start',behavior:'instant'});
  resetFeedVideoSession(key);
  currentFeedKey=key;hydrateFeedWindow(feedSectionIndex(section));pauseInactiveFeedVideos(section);
  updateFeedABUi();resetFeedDeleteButton();renderFeedFilmstrip();renderStudioRatingDock();
}
document.getElementById('feedToolsToggle').addEventListener('click',()=>setStudioFeedPanel('tools'));
document.getElementById('feedRailToggle').addEventListener('click',()=>setStudioFeedPanel('rail'));
document.getElementById('feedRatingToggle').addEventListener('click',()=>setStudioFeedPanel('info'));
document.getElementById('feedFilmstrip').addEventListener('click',event=>{const b=event.target.closest('[data-feed-jump]');if(b)jumpStudioFeed(b.dataset.feedJump);});
document.getElementById('feedScroller').addEventListener('pointerdown',event=>{
  if(event.target.closest('button,input,.feedRating,video'))return;
  const overlay=document.querySelector('#feedOverlay');
  if(overlay.classList.contains('toolsOpen'))setStudioFeedPanel('tools',false);
},true);
document.addEventListener('keydown',event=>{
  const overlay=document.querySelector('#feedOverlay');if(!overlay.classList.contains('open'))return;
  if(event.target.closest('input,textarea,select,[contenteditable]'))return;
  if(event.key.toLowerCase()==='t'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();setStudioFeedPanel('tools');}
  if(event.key.toLowerCase()==='r'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();setStudioFeedPanel('info');}
  if(event.key.toLowerCase()==='l'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();setStudioFeedPanel('rail');}
  if(event.key==='Escape'&&overlay.classList.contains('toolsOpen')){setStudioFeedPanel('tools',false);event.preventDefault();event.stopImmediatePropagation();}
},true);

// Only a visual preference is stored locally. No played-file keys, timestamps or history.
let studioHideVideoNames = true;
try { studioHideVideoNames = localStorage.getItem('yingge-hide-video-names') !== 'false'; } catch {}
const studioNameToggle = document.getElementById('studioNameToggle');
function syncStudioNamePreference() {
  document.body.classList.toggle('studioHideVideoNames',studioHideVideoNames && libraryMode==='video');
  studioNameToggle.hidden=libraryMode!=='video';
  studioNameToggle.setAttribute('aria-pressed',String(studioHideVideoNames));
  studioNameToggle.title=studioHideVideoNames?'显示文件名':'隐藏文件名';
}
studioNameToggle.addEventListener('click',()=>{
  studioHideVideoNames=!studioHideVideoNames;
  try { localStorage.setItem('yingge-hide-video-names',String(studioHideVideoNames)); } catch {}
  syncStudioNamePreference();
});
/* v6.19: sorted, justified poster rows instead of column-flow masonry. */
let jfPosterRelayoutFrame=0;
function layoutJustifiedPosters(){
  const grid=document.getElementById('grid');
  if(!grid || !grid.classList.contains('grid') || grid.classList.contains('videoTextGrid') || libraryMode!=='video')return;
  const cards=Array.from(grid.querySelectorAll('.jfCoverTile'));
  if(!cards.length)return;
  const style=getComputedStyle(grid);
  const available=Math.max(240,grid.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0));
  const narrow=window.innerWidth<700;
  const gap=narrow?8:11;
  const target=narrow?250:285;
  const minimumReadableWidth=narrow?136:150;
  const rows=[];
  let pending=[];
  let sum=0;
  for(let i=0;i<cards.length;i++){
    const card=cards[i];
    const raw=Number(card.style.getPropertyValue('--jf-video-ratio'));
    const ratio=Number.isFinite(raw)&&raw>0?Math.max(.52,Math.min(2.35,raw)):.5625;
    // Never add one more wide item if that would force the whole row
    // below the smallest usable poster height and overflow the viewport.
    const projected=(available-pending.length*gap)/(sum+ratio);
    const cramped=(pending.some(function(item){return item.ratio*projected<minimumReadableWidth;}) || ratio*projected<minimumReadableWidth);
    if(pending.length && cramped){rows.push({items:pending,full:true});pending=[];sum=0;}
    pending.push({card:card,ratio:ratio});sum+=ratio;
    if((sum*target+(pending.length-1)*gap)>=available){rows.push({items:pending,full:true});pending=[];sum=0;}
  }
  if(pending.length)rows.push({items:pending,full:false});
  const fragment=document.createDocumentFragment();
  rows.forEach(function(rowData){
    const row=document.createElement('div');row.className='jfPosterRow';
    const items=rowData.items;
    const weight=items.reduce((total,item)=>total+item.ratio,0);
    const space=Math.max(120,available-(items.length-1)*gap);
    // Stretch completed rows; do not blow up a sparse final row.
    const desired=rowData.full?space/weight:Math.min(target,space/weight);
    const height=Math.min(390,Math.max(90,desired));
    items.forEach(function(item){
      item.card.style.setProperty('--jf-slot-w',(item.ratio*height).toFixed(2)+'px');
      row.appendChild(item.card);
    });
    fragment.appendChild(row);
  });
  grid.replaceChildren(fragment);
}
window.addEventListener('resize',function(){
  if(jfPosterRelayoutFrame)cancelAnimationFrame(jfPosterRelayoutFrame);
  jfPosterRelayoutFrame=requestAnimationFrame(function(){jfPosterRelayoutFrame=0;layoutJustifiedPosters();});
},{passive:true});
function render() {
  syncStudioNamePreference();
  document.querySelector('#studioModeTitle').textContent = ({video:'视频工作台',image:'图片图库',audio:'音频工作台'})[libraryMode] || '媒体工作台';
  document.body.dataset.studioMode = libraryMode;
  syncUnifiedControls();
  document.querySelectorAll('[data-media-kind]').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.mediaKind === libraryMode);
    btn.setAttribute('aria-selected', String(btn.dataset.mediaKind === libraryMode));
  });
  const isVideo = libraryMode === 'video';
  document.querySelector('#photoToolbar').hidden = libraryMode !== 'image';
  document.querySelector('#creatorToggle').style.display = isVideo ? '' : 'none';
  document.querySelector('#creatorPanel').style.display = isVideo ? '' : 'none';
  document.querySelector('#sortRatingBtn').style.display = libraryMode === 'image' ? 'none' : '';
  document.querySelector('#sortMtimeBtn').style.display = libraryMode === 'image' ? 'none' : '';
  const videoToggle=document.getElementById('videoViewToggle');
  videoToggle.hidden=!isVideo;
  videoToggle.setAttribute('aria-pressed',String(videoViewMode==='text'));
  videoToggle.title=videoViewMode==='text'?'切换为封面视图':'切换为纯文字视图';
  videoToggle.innerHTML=videoViewMode==='text'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m5 16 5-5 4 4 3-3 4 4"/><circle cx="16" cy="9" r="1"/></svg>';
  document.querySelector('#assetFolders').style.display = 'flex';
  document.querySelector('#folderTiles').style.display = 'flex';
  document.querySelector('#folderContext').style.display = 'block';
  if (!isVideo) {renderStudioEntrance();renderAssets();return;}
  renderVideoFolders();
  document.querySelector('#grid').className = 'grid' + (videoViewMode==='text' ? ' videoTextGrid' : '');
  const q =
    document
      .querySelector('#search')
      .value
      .trim()
      .toLowerCase();

  let items =
    allItems.filter(
      item => {
        if (item.kind !== 'video') return false;
        if(activeFolder!=='all'&&(item.relativeDir||'root')!==activeFolder)return false;
        if (unifiedFavoriteOnly && !item.favorite) return false;
        const text =
          [
            item.creator,
            item.title,
            item.displayName
          ]
            .join(' ')
            .toLowerCase();

        return (
          (!q || text.includes(q)) &&
          (
            !selectedCreator ||
            item.creator ===
              selectedCreator
          )
        );
      }
    );

  items.sort(
    (a,b) => {
      const aValue =
        sortMode === 'mtime'
          ? Number(a.modifiedTimeMs || 0)
          : Number(a.rating || 0);

      const bValue =
        sortMode === 'mtime'
          ? Number(b.modifiedTimeMs || 0)
          : Number(b.rating || 0);

      const diff =
        aValue - bValue;

      if (diff !== 0) {
        return sortDirection === 'desc'
          ? -diff
          : diff;
      }

      // 同值时保持稳定、可预测的中文名称顺序。
      return (
        (a.creator || '') +
        (a.title || '')
      ).localeCompare(
        (b.creator || '') +
        (b.title || ''),
        'zh-CN'
      );
    }
  );

  currentRenderedItems =
    items;

  document.querySelector('#grid').innerHTML =
    items.length
      ? items.map(card).join('')
      : '<div class="empty">没有匹配的媒体</div>';
  if(videoViewMode!=='text')layoutJustifiedPosters();
  syncUnifiedTiles();
  renderStudioEntrance();
}

let catalogRequestInFlight = false;
async function load() {
  if (catalogRequestInFlight) return;
  catalogRequestInFlight = true;
  try {
    const r = await fetch('/api/data', {
      cache: 'no-store',
      headers: lastStamp ? {'If-None-Match': '"' + lastStamp + '"'} : {}
    });
    // 服务器媒体库未变：不下载和解析整份 JSON，也不重绘列表。
    if (r.status === 304) return;
    if (!r.ok) throw new Error('媒体索引请求失败');
    const data = await r.json();

    allItems = data.items || [];
    allFolders = data.folders || [];
    // 外部移动或删除了旧目录时，回退到可用入口，避免刷新后空白。
    ensureMediaFolderExists();

    document.querySelector('#status').textContent =
      data.scanStatus === 'ready'
        ? '共 ' +
          allItems.filter(x=>x.kind===libraryMode).length +
          ' 个'+({video:'视频',image:'图片',audio:'音频'}[libraryMode]||'媒体')+' · 自动监控新增媒体'
        : (
            data.scanMessage ||
            '扫描中…'
          );

    const stamp =
      data.updatedAt || '';

    if (
      stamp !==
      lastStamp
    ) {
      lastStamp =
        stamp;

      const editing =
        Boolean(
          document.querySelector(
            '.inlineInput, .audioRenameInput'
          )
        );

      const draggingCover =
        document.activeElement &&
        document.activeElement.classList &&
        document.activeElement.classList.contains(
          'coverRange'
        );

      if (
        !editing &&
        !draggingCover
      ) {
        const feedOpen =
          document
            .querySelector(
              '#feedOverlay'
            )
            .classList.contains(
              'open'
            );

        if (feedOpen) {
          pendingGridRender = true;
        } else {
          // 索引时间戳更新不等于音频列表变化：避免重建正在加载/播放的 audio DOM。
          const audioUnchanged=libraryMode==='audio' &&
            document.querySelector('#grid').classList.contains('audioFileGrid') &&
            renderedAudioSignature===audioUIStamp(allItems,allFolders);
          if (!audioUnchanged) {
            // 索引导入新素材时别打断正在播放的音频；暂停后再刷新卡片。
            const audioBusy=libraryMode==='audio' &&
              (audioClipJobs.size>0 || [...document.querySelectorAll('#audioDock .audioTrack audio')].some(x=>!x.paused));
            // Audio stays mounted in fixed dock: cards can safely refresh while it is playing.
            void audioBusy;
            renderCreatorTags();
            render();
          }
          pendingGridRender = false;
        }
      }
    }
  } catch {} finally {
    catalogRequestInFlight = false;
  }
}

function beginTextEdit(
  element,
  field
) {
  const key =
    element.dataset.key;

  const item =
    allItems.find(
      x => x.key === key
    );

  if (!item) return;

  const input =
    document.createElement(
      'input'
    );

  input.className =
    'inlineInput';

  input.value =
    String(
      item[field] || ''
    );

  element.replaceWith(
    input
  );

  input.focus();
  input.select();

  let finished = false;

  async function finish(save) {
    if (finished) return;

    finished = true;

    const value =
      input.value.trim();

    if (save) {
      try {
        const r =
          await fetch(
            '/api/update-text',
            {
              method:'POST',
              headers:{
                'Content-Type':
                  'application/json'
              },
              body:
                JSON.stringify({
                  key,
                  field,
                  value
                })
            }
          );

        const data =
          await r.json();

        if (
          !r.ok ||
          !data.ok
        ) {
          throw new Error(
            data.error ||
            '保存失败'
          );
        }

        item[field] =
          value;
      } catch (error) {
        alert(
          error.message ||
          '保存失败'
        );
      }
    }

    renderCreatorTags();
    render();
  }

  input.addEventListener(
    'keydown',
    event => {
      if (
        event.key ===
        'Enter'
      ) {
        event.preventDefault();
        finish(true);
      } else if (
        event.key ===
        'Escape'
      ) {
        event.preventDefault();
        finish(false);
      }
    }
  );

  input.addEventListener(
    'blur',
    () =>
      finish(true)
  );
}

const ratingGesture = {
  active: false,
  container: null,
  key: '',
  preview: 0
};

function ratingFromPointer(
  container,
  clientX
) {
  const stars =
    [...container.querySelectorAll(
      '.ratingStar'
    )];

  if (!stars.length) {
    return 0;
  }

  const firstRect =
    stars[0]
      .getBoundingClientRect();

  // 拖到第一颗星左边即视为“清除评分”。
  // Pointer Capture 开启后，即使鼠标已经拖出评分区域，
  // 仍然能持续收到 pointermove。
  if (
    clientX <=
    firstRect.left
  ) {
    return 0;
  }

  for (
    let i = 0;
    i < stars.length;
    i++
  ) {
    const rect =
      stars[i]
        .getBoundingClientRect();

    if (
      clientX <=
      rect.right
    ) {
      return (
        i +
        (
          clientX <
          rect.left +
          rect.width / 2
            ? 0.5
            : 1
        )
      );
    }
  }

  return 5;
}

function paintRating(
  container,
  rating
) {
  rating =
    Math.max(
      0,
      Math.min(
        5,
        Math.round(
          Number(rating || 0) * 2
        ) / 2
      )
    );

  const stars =
    [...container.querySelectorAll(
      '.ratingStar'
    )];

  stars.forEach(
    (star,index) => {
      const fill =
        Math.max(
          0,
          Math.min(
            100,
            (rating - index) * 100
          )
        );

      star
        .querySelector(
          '.ratingStarFill'
        )
        .style.width =
          fill + '%';

      star.classList.toggle(
        'hot',
        rating > index &&
        rating <= index + 1
      );
    }
  );

  const value =
    container.querySelector(
      '.ratingValue'
    );

  if (value) {
    value.textContent =
      rating.toFixed(1);
  }
}

function startRating(
  event,
  container
) {
  if (
    event.button !== undefined &&
    event.button !== 0
  ) {
    return;
  }

  event.preventDefault();

  ratingGesture.active = true;
  ratingGesture.container = container;
  ratingGesture.key = container.dataset.key;
  ratingGesture.preview =
    ratingFromPointer(
      container,
      event.clientX
    );

  container.classList.add(
    'ratingActive'
  );

  try {
    container.setPointerCapture(
      event.pointerId
    );
  } catch {}

  paintRating(
    container,
    ratingGesture.preview
  );
}

function moveRating(event) {
  if (
    !ratingGesture.active ||
    !ratingGesture.container
  ) {
    return;
  }

  const rating =
    ratingFromPointer(
      ratingGesture.container,
      event.clientX
    );

  if (
    rating ===
    ratingGesture.preview
  ) {
    return;
  }

  ratingGesture.preview =
    rating;

  paintRating(
    ratingGesture.container,
    rating
  );
}

async function endRating() {
  if (
    !ratingGesture.active ||
    !ratingGesture.container
  ) {
    return;
  }

  const container =
    ratingGesture.container;

  const key =
    ratingGesture.key;

  const rating =
    ratingGesture.preview;

  ratingGesture.active =
    false;

  ratingGesture.container =
    null;

  container.classList.remove(
    'ratingActive'
  );

  try {
    const response =
      await fetch(
        '/api/update-rating',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              key,
              rating
            })
        }
      );

    if (response.ok) {
      const item =
        allItems.find(
          value =>
            value.key === key
        );

      if (item) {
        item.rating =
          rating;
      }

      document
        .querySelectorAll(
          '.stars'
        )
        .forEach(
          stars => {
            if (
              stars.dataset.key !==
                key
            ) {
              return;
            }

            stars.dataset.rating =
              String(rating);

            paintRating(
              stars,
              rating
            );
          }
        );
    }
  } catch {}
}

const coverStates = new Map();

function queueCover(input) {
  const key =
    input.dataset.key;

  const time =
    Number(
      input.value
    );

  let state =
    coverStates.get(
      key
    );

  if (!state) {
    state = {
      inFlight: false,
      pending: null,
      input: null,
      timer: null
    };

    coverStates.set(
      key,
      state
    );
  }

  state.pending =
    time;

  state.input =
    input;

  clearTimeout(
    state.timer
  );

  state.timer =
    setTimeout(
      () =>
        flushCover(
          key
        ),
      state.inFlight
        ? 80
        : 130
    );
}

async function flushCover(key) {
  const state =
    coverStates.get(
      key
    );

  if (
    !state ||
    state.inFlight ||
    state.pending === null
  ) {
    return;
  }

  const time =
    state.pending;

  const input =
    state.input;

  state.pending =
    null;

  state.inFlight =
    true;

  const seek =
    input &&
    input.closest(
      '.coverSeek'
    );

  if (seek) {
    seek.classList.add(
      'loading'
    );
  }

  try {
    const r =
      await fetch(
        '/api/set-cover',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              key,
              time
            })
        }
      );

    const data =
      await r.json();

    if (
      r.ok &&
      data.ok
    ) {
      const card =
        input &&
        input.closest(
          '.card'
        );

      const image =
        card &&
        card.querySelector(
          '.cover'
        );

      if (image) {
        image.src =
          data.cover +
          '?v=' +
          Date.now();
      }
    }
  } finally {
    state.inFlight =
      false;

    if (seek) {
      seek.classList.remove(
        'loading'
      );
    }

    if (
      state.pending !==
      null
    ) {
      setTimeout(
        () =>
          flushCover(
            key
          ),
        70
      );
    }
  }
}

const deleteTimers =
  new Map();

function armDelete(button) {
  const key =
    button.dataset.key;

  if (
    button.classList.contains(
      'armed'
    )
  ) {
    deleteMovie(
      key,
      button
    );
    return;
  }

  button.classList.add(
    'armed'
  );

  button.title =
    '再次点击确认删除当前媒体';
  button.setAttribute('aria-label',button.title);
  const label = button.querySelector('.feedToolLabel');
  if (label) label.textContent = '确认删除';

  clearTimeout(
    deleteTimers.get(
      key
    )
  );

  deleteTimers.set(
    key,
    setTimeout(
      () => {
        button.classList.remove(
          'armed'
        );

        button.title =
          '删除媒体';

        deleteTimers.delete(
          key
        );
      },
      3000
    )
  );
}

async function deleteMovie(
  key,
  button
) {
  button.disabled = true;

  try {
    const r =
      await fetch(
        '/api/delete',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              key
            })
        }
      );

    const data =
      await r.json();

    if (
      !r.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        '删除失败'
      );
    }

    const card =
      button.closest(
        '.card'
      );

    if (card) {
      card.classList.add(
        'deleting'
      );

      setTimeout(
        () => {
          allItems =
            allItems.filter(
              item =>
                item.key !==
                key
            );

          renderCreatorTags();
          render();
        },
        320
      );
    }
  } catch (error) {
    button.disabled = false;
    button.classList.remove(
      'armed'
    );

    alert(
      error.message ||
      '删除失败'
    );
  }
}


let feedDeleteTimer =
  null;

function resetFeedDeleteButton() {
  clearTimeout(
    feedDeleteTimer
  );

  feedDeleteTimer =
    null;

  const button =
    document.querySelector(
      '#feedDelete'
    );

  if (!button) {
    return;
  }

  button.classList.remove(
    'armed'
  );

  button.disabled =
    false;

  button.title =
    '删除当前媒体（需要二次确认）';
  button.setAttribute('aria-label',button.title);
  const label = button.querySelector('.feedToolLabel');
  if (label) label.textContent = '删除';
}

function armFeedDelete() {
  const button =
    document.querySelector(
      '#feedDelete'
    );

  if (
    !button ||
    !currentFeedKey
  ) {
    return;
  }

  if (
    button.classList.contains(
      'armed'
    )
  ) {
    deleteCurrentFeedMovie(
      button
    );

    return;
  }

  button.classList.add(
    'armed'
  );

  button.title =
    '再次点击确认永久删除';

  clearTimeout(
    feedDeleteTimer
  );

  feedDeleteTimer =
    setTimeout(
      resetFeedDeleteButton,
      3000
    );
}

async function deleteCurrentFeedMovie(
  button
) {
  const key =
    currentFeedKey;

  const source =
    currentRenderedItems.length
      ? currentRenderedItems
      : allItems;

  const index =
    source.findIndex(
      item =>
        item.key === key
    );

  const nextItem =
    index >= 0
      ? (
          source[index + 1] ||
          source[index - 1] ||
          null
        )
      : null;

  button.disabled =
    true;

  try {
    const response =
      await fetch(
        '/api/delete',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              key
            })
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        '删除失败'
      );
    }

    allItems =
      allItems.filter(
        item =>
          item.key !==
            key
      );

    currentRenderedItems =
      currentRenderedItems
        .filter(
          item =>
            item.key !==
              key
        );

    pendingGridRender =
      true;

    resetFeedDeleteButton();

    if (
      nextItem &&
      nextItem.key !==
        key
    ) {
      openFeed(
        nextItem.key
      );
    } else {
      closeFeed();
    }
  } catch (error) {
    resetFeedDeleteButton();

    alert(
      error.message ||
      '删除失败'
    );
  }
}

let currentRenderedItems = [];
let feedObserver = null;
let currentFeedKey = '';
let pendingGridRender = false;

const TOUCH_MEDIA_DEVICE =
  Boolean(
    window.matchMedia &&
    window.matchMedia(
      '(pointer: coarse)'
    ).matches
  ) ||
  /iPad|iPhone|iPod|Android|Mobile/i
    .test(
      navigator.userAgent || ''
    );

// 为当前和相邻各 1 条视频预加载媒体数据，至多三个，其他条目及时释放。
const FEED_PRELOAD_RADIUS = 1;

const DATA_POLL_INTERVAL =
  TOUCH_MEDIA_DEVICE
    ? 6000
    : 2500;

let nativeFullscreenVideo = null;
let nativeFullscreenKey = '';
let nativeFullscreenOrigin = null;

function captureNativeFullscreenOrigin(video) {
  if (
    !video ||
    (
      nativeFullscreenOrigin &&
      nativeFullscreenOrigin.video === video
    )
  ) {
    return;
  }

  const section =
    video.closest(
      '.feedItem'
    );

  const sectionKey =
    section &&
    section.dataset.key
      ? section.dataset.key
      : '';

  nativeFullscreenOrigin = {
    video,
    sectionKey,
    itemKey:
      video.dataset.itemKey ||
      sectionKey,
    fullscreenKey:
      video.dataset.fullscreenKey ||
      sectionKey,
    rotation:
      video.dataset.rotation ||
      (
        section &&
        section.dataset.rotation
      ) ||
      '0',
    loaded:
      video.dataset.loaded ||
      '0',
    poster:
      video.getAttribute(
        'poster'
      ) ||
      '',
    currentTime:
      Number(
        video.currentTime || 0
      )
  };
}

function restoreNativeFullscreenHost() {
  const origin =
    nativeFullscreenOrigin;

  nativeFullscreenOrigin =
    null;

  if (
    !origin ||
    !origin.video ||
    origin.video.isConnected === false
  ) {
    return;
  }

  const video =
    origin.video;

  try {
    video.pause();
  } catch {}

  video.dataset.itemKey =
    origin.itemKey ||
    origin.sectionKey;

  video.dataset.fullscreenKey =
    origin.fullscreenKey ||
    origin.sectionKey;

  video.dataset.rotation =
    String(
      normalizeRotation(
        origin.rotation || 0
      )
    );

  video.classList.remove(
    'nativeSwitching'
  );

  if (origin.poster) {
    video.setAttribute(
      'poster',
      origin.poster
    );
  } else {
    video.removeAttribute(
      'poster'
    );
  }

  const source =
    video.dataset.src ||
    '';

  if (
    origin.loaded === '1' &&
    source
  ) {
    video.src =
      source;

    video.dataset.loaded =
      '1';

    try {
      video.load();
    } catch {}

    if (
      currentFeedKey ===
        origin.sectionKey &&
      Number.isFinite(
        origin.currentTime
      )
    ) {
      try {
        video.currentTime =
          origin.currentTime;
      } catch {}
    }
  } else {
    video.removeAttribute(
      'src'
    );

    video.dataset.loaded =
      '0';

    try {
      video.load();
    } catch {}
  }

  applyRotationToVideo(
    video,
    origin.rotation || 0
  );
}

function fullscreenVideoElement() {
  const element =
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    null;

  if (
    element &&
    element.matches &&
    element.matches(
      'video.feedVideo'
    )
  ) {
    return element;
  }

  return null;
}

function feedSourceItems() {
  return currentRenderedItems.length
    ? currentRenderedItems
    : allItems;
}

function adjacentVideoItem(
  key,
  direction
) {
  const source =
    feedSourceItems();

  const videos =
    source.filter(
      item =>
        item.kind ===
        'video'
    );

  if (!videos.length) {
    return null;
  }

  let index =
    videos.findIndex(
      item =>
        item.key ===
        key
    );

  if (index < 0) {
    index = 0;
  }

  const next =
    index +
    direction;

  if (
    next < 0 ||
    next >= videos.length
  ) {
    return null;
  }

  return videos[next];
}

function syncFeedBehind(
  key
) {
  const scroller =
    document.querySelector(
      '#feedScroller'
    );

  if (!scroller) {
    return;
  }

  const section =
    [...scroller.querySelectorAll(
      '.feedItem'
    )]
      .find(
        node =>
          node.dataset.key ===
          key
      );

  if (!section) {
    return;
  }

  const index =
    feedSectionIndex(
      section
    );

  if (index >= 0) {
    hydrateFeedWindow(
      index
    );
  }

  section.scrollIntoView({
    behavior:'auto',
    block:'start'
  });
}

function waitForFreshFullscreenFrame(video) {
  return new Promise(
    resolve => {
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;

        requestAnimationFrame(
          () =>
            requestAnimationFrame(
              resolve
            )
        );
      };

      if (
        video.readyState >= 2
      ) {
        finish();
      } else {
        video.addEventListener(
          'loadeddata',
          finish,
          { once:true }
        );
      }

      setTimeout(
        finish,
        1200
      );
    }
  );
}

async function paintNativeFullscreenBlack(video, nextPoster) {
  video.classList.add('nativeSwitching');
  // During native fullscreen source replacement, keep a ready cover instead of
  // intentionally blanking the entire fullscreen element for two frames.
  if (nextPoster) video.setAttribute('poster',nextPoster);
  else video.removeAttribute('poster');
}

let nativeFullscreenSwitching = false;

async function stepNativeFullscreen(
  direction
) {
  // 原生 fullscreen 使用单个 video 异步换源，禁止上一条尚未
  // 解码完成时再次换源，避免相互覆盖和多条跳跃。
  if (nativeFullscreenSwitching) {
    return true;
  }

  const video =
    fullscreenVideoElement() ||
    nativeFullscreenVideo;

  if (
    !video ||
    video.isConnected === false
  ) {
    return false;
  }

  captureNativeFullscreenOrigin(
    video
  );

  const currentKey =
    nativeFullscreenKey ||
    (
      video.closest(
        '.feedItem'
      ) &&
      video.closest(
        '.feedItem'
      ).dataset.key
    ) ||
    currentFeedKey;

  const next =
    adjacentVideoItem(
      currentKey,
      direction
    );

  if (!next) {
    return true;
  }

  nativeFullscreenSwitching = true;
  try {
  nativeFullscreenVideo =
    video;
  // Silence all background videos before any awaits / source changes.
  silenceOtherFeedVideos(video);

  resetFeedVideoSession(next.key);

  nativeFullscreenKey =
    next.key;

  currentFeedKey =
    next.key;

  updateFeedABUi();

  await paintNativeFullscreenBlack(video,next.cover || '');

  video.pause();

  video.loop =
    true;

  video.dataset.itemKey =
    next.key;

  video.dataset.rotation =
    String(
      normalizeRotation(
        next.rotation || 0
      )
    );

  video.src =
    next.mediaUrl;

  video.dataset.fullscreenKey =
    next.key;

  video.load();

  applyRotationToVideo(
    video,
    next.rotation || 0
  );

  syncFeedBehind(
    next.key
  );
  // syncFeedBehind hydrates/scrolls another section and triggers its observer.
  // It must not result in a second playing <video> beneath fullscreen.
  silenceOtherFeedVideos(video);

  try {
    await video.play();
  } catch {}

  await waitForFreshFullscreenFrame(
    video
  );
  silenceOtherFeedVideos(video);

  video.classList.remove(
    'nativeSwitching'
  );

  return true;
  } finally {
    nativeFullscreenSwitching = false;
    video.classList.remove('nativeSwitching');
  }
}

function rememberFullscreenState() {
  const video =
    fullscreenVideoElement();

  if (!video) {
    restoreNativeFullscreenHost();

    nativeFullscreenVideo =
      null;

    nativeFullscreenKey =
      '';

    if (currentFeedKey) {
      syncFeedBehind(
        currentFeedKey
      );
    }
    // The restored old fullscreen host is paused. Activate only the video
    // belonging to the selected new section; never revive both tracks.
    const currentSection=[...document.querySelectorAll('#feedScroller .feedItem')]
      .find(section=>section.dataset.key===currentFeedKey);
    pauseInactiveFeedVideos(currentSection);

    return;
  }

  captureNativeFullscreenOrigin(
    video
  );

  // 原生全屏切换媒体时，旧 poster 会被浏览器短暂重新绘制。
  // 进入全屏后先移除，退出时由 restoreNativeFullscreenHost 恢复。
  video.removeAttribute(
    'poster'
  );

  nativeFullscreenVideo =
    video;

  const section =
    video.closest(
      '.feedItem'
    );

  nativeFullscreenKey =
    video.dataset.fullscreenKey ||
    (
      section &&
      section.dataset.key
    ) ||
    currentFeedKey;

  currentFeedKey =
    nativeFullscreenKey ||
    currentFeedKey;
}


const fullscreenDrag = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  triggered: false,
  ignore: false
};

function resetFullscreenDrag() {
  fullscreenDrag.active = false;
  fullscreenDrag.pointerId = null;
  fullscreenDrag.startX = 0;
  fullscreenDrag.startY = 0;
  fullscreenDrag.triggered = false;
  fullscreenDrag.ignore = false;
}

function shouldIgnoreFullscreenDragStart(video, event) {
  if (!video) {
    return true;
  }

  const rect =
    video.getBoundingClientRect();

  // 保留底部原生 controls 区域，不抢占进度条/音量拖拽。
  return (
    rect.bottom -
    event.clientY <
    76
  );
}

document.addEventListener(
  'pointerdown',
  event => {
    const video =
      fullscreenVideoElement();

    if (!video) {
      return;
    }

    const magnifier =
      focusZoomStates.get(
        video
      );

    if (
      magnifier &&
      magnifier.enabled
    ) {
      return;
    }

    if (
      event.button !== undefined &&
      event.button !== 0
    ) {
      return;
    }

    fullscreenDrag.active = true;
    fullscreenDrag.pointerId = event.pointerId;
    fullscreenDrag.startX = event.clientX;
    fullscreenDrag.startY = event.clientY;
    fullscreenDrag.triggered = false;
    fullscreenDrag.ignore =
      shouldIgnoreFullscreenDragStart(
        video,
        event
      );

    if (
      !fullscreenDrag.ignore
    ) {
      try {
        video.setPointerCapture(
          event.pointerId
        );
      } catch {}
    }
  },
  {
    capture:true
  }
);

document.addEventListener(
  'pointermove',
  event => {
    if (
      !fullscreenDrag.active ||
      fullscreenDrag.ignore ||
      fullscreenDrag.triggered ||
      event.pointerId !==
        fullscreenDrag.pointerId
    ) {
      return;
    }

    const video =
      fullscreenVideoElement();

    if (!video) {
      resetFullscreenDrag();
      return;
    }

    const dx =
      event.clientX -
      fullscreenDrag.startX;

    const dy =
      event.clientY -
      fullscreenDrag.startY;

    const vertical =
      Math.abs(dy);

    const horizontal =
      Math.abs(dx);

    if (
      vertical < 70 ||
      vertical <
        horizontal * 1.25
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    fullscreenDrag.triggered = true;

    // 向上拖：下一条；向下拖：上一条。
    stepNativeFullscreen(
      dy < 0
        ? 1
        : -1
    );
  },
  {
    passive:false,
    capture:true
  }
);

document.addEventListener(
  'pointerup',
  event => {
    if (
      event.pointerId ===
      fullscreenDrag.pointerId
    ) {
      resetFullscreenDrag();
    }
  },
  {
    capture:true
  }
);

document.addEventListener(
  'pointercancel',
  event => {
    if (
      event.pointerId ===
      fullscreenDrag.pointerId
    ) {
      resetFullscreenDrag();
    }
  },
  {
    capture:true
  }
);


function normalizeRotation(value) {
  value = Number(value) || 0;
  value = ((value % 360) + 360) % 360;
  return [0,90,180,270].includes(value) ? value : 0;
}

function rotationTransform(
  video,
  rotation
) {
  if (!video) {
    return;
  }

  rotation =
    normalizeRotation(
      rotation
    );

  const parent =
    video.parentElement;

  if (!parent) {
    return;
  }

  const parentWidth =
    parent.clientWidth;

  const parentHeight =
    parent.clientHeight;

  if (
    !parentWidth ||
    !parentHeight
  ) {
    return;
  }

  const rotated =
    rotation === 90 ||
    rotation === 270;

  // 普通播放不再根据视频原始分辨率算第二层 scale。
  //
  // 0 / 180:
  //   video box = 容器本身
  //
  // 90 / 270:
  //   先把 video box 的宽高交换，再 rotate。
  //
  // 因此 Feed 的普通竖屏视频始终拥有完整 100vh 播放区域，
  // object-fit: contain 只负责在这个区域里保持视频比例。
  video.style.width =
    (
      rotated
        ? parentHeight
        : parentWidth
    ) +
    'px';

  video.style.height =
    (
      rotated
        ? parentWidth
        : parentHeight
    ) +
    'px';

  video.style.maxWidth =
    'none';

  video.style.maxHeight =
    'none';

  video.style.flex =
    '0 0 auto';

  video.style.objectFit =
    'contain';

  video.style.transformOrigin =
    'center center';

  video.style.transform =
    'rotate(' +
    rotation +
    'deg)';
}

const videoResizeObservers =
  new WeakMap();

function applyRotationToVideo(video, rotation) {
  if (!video) {
    return;
  }

  video.classList.add(
    'rotatableVideo'
  );

  video.dataset.rotation =
    String(
      normalizeRotation(
        rotation
      )
    );

  const apply =
    () => {
      if (
        !video.isConnected
      ) {
        return;
      }

      const focusState =
        typeof focusZoomStates !==
          'undefined'
          ? focusZoomStates.get(
              video
            )
          : null;

      if (
        focusState &&
        focusState.enabled
      ) {
        applyFocusTransform(
          video
        );
      } else {
        rotationTransform(
          video,
          video.dataset.rotation
        );
      }
    };

  if (
    video.readyState >= 1
  ) {
    apply();
  }

  video.addEventListener(
    'loadedmetadata',
    apply,
    {
      once:true
    }
  );

  const oldObserver =
    videoResizeObservers.get(
      video
    );

  if (oldObserver) {
    try {
      oldObserver.disconnect();
    } catch {}
  }

  if (
    typeof ResizeObserver !==
      'undefined'
  ) {
    const target =
      video.parentElement;

    if (target) {
      const observer =
        new ResizeObserver(
          () => {
            requestAnimationFrame(
              apply
            );
          }
        );

      observer.observe(
        target
      );

      videoResizeObservers.set(
        video,
        observer
      );
    }
  }
}

function applyRotationsIn(root) {
  const scope = root || document;

  scope
    .querySelectorAll('video[data-rotation]')
    .forEach(video =>
      applyRotationToVideo(
        video,
        Number(video.dataset.rotation || 0)
      )
    );
}

async function setItemRotation(key, rotation) {
  rotation = normalizeRotation(rotation);

  const item = allItems.find(x => x.key === key);
  if (!item) return null;

  try {
    const r = await fetch('/api/update-rotation', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({key,rotation})
    });

    const data = await r.json();

    if (!r.ok || !data.ok) {
      throw new Error(data.error || '保存旋转角度失败');
    }

    item.rotation = data.rotation;
    return data.rotation;
  } catch (error) {
    alert(error.message || '保存旋转角度失败');
    return null;
  }
}

async function rotateItem(key) {
  const item = allItems.find(x => x.key === key);

  if (!item || item.kind !== 'video') {
    return;
  }

  const next =
    (normalizeRotation(item.rotation) + 90) % 360;

  const saved =
    await setItemRotation(key, next);

  if (saved === null) {
    return;
  }

  document
    .querySelectorAll(
      'video[data-item-key="' +
      CSS.escape(key) +
      '"]'
    )
    .forEach(video =>
      applyRotationToVideo(video, saved)
    );

  render();
}


// 截取视频默认使用播放器内的 A-B 跳转循环，而不是等待原生 loop 的 ended 重启。
// 老版本生成的片段根据内部命名规则识别，避免要求用户重新截取历史视频。
function isGeneratedABClip(item) {
  return Boolean(item && item.kind === 'video' && (
    item.seamlessClipLoop === true ||
    (typeof item.title === 'string' && / · 片段 [0-9]+:[0-9]/.test(item.title))
  ));
}

function prepareClipLoopState(video, item, state) {
  if (!video || !state || !isGeneratedABClip(item) || state.manual) return;
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0.07) return;
  // 留少量结束缓冲：尽可能在 ended 之前回到首帧。
  const lead = Math.min(0.09, duration * 0.12);
  state.a = 0;
  state.b = duration - lead;
  state.enabled = true;
  state.auto = true;
  video.loop = false;
  video.preload = 'auto';
}

// rVFC 按视频帧检查；不支持时以动画帧轮询，timeupdate/ended 兜底。
// 不复制视频、不预先生成图片，保持音画轨同步和原有播放器结构。
function installResponsiveVideoLoop(video, readState) {
  if (!video || video.dataset.responsiveLoopInstalled === '1') return;
  video.dataset.responsiveLoopInstalled = '1';
  let pending = false;
  const inspect = () => {
    if (video.paused || video.seeking || video.readyState < 2) return;
    const state = readState();
    if (!state || !state.enabled || !validABState(state)) return;
    const margin = state.auto ? 0.008 : 0;
    if (video.currentTime >= state.b - margin) {
      video.currentTime = state.a;
    }
  };
  const checkFrame = () => {
    pending = false;
    inspect();
    if (!video.paused) schedule();
  };
  const schedule = () => {
    if (pending || video.paused) return;
    pending = true;
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(checkFrame);
    } else {
      requestAnimationFrame(checkFrame);
    }
  };
  video.addEventListener('play', schedule);
  video.addEventListener('timeupdate', inspect);
  video.addEventListener('seeked', schedule);
  video.addEventListener('ended', () => {
    const state = readState();
    if (!state || !state.enabled || !validABState(state)) return;
    video.currentTime = state.a;
    video.play().catch(() => {});
  });
  if (!video.paused) schedule();
}

const feedABStates =
  new Map();
let ghostPlayback=null;
let ghostPreparing=false;
let ghostRequestGeneration=0;

// Video-only session state must not follow a different media item.
// Keep the user's global volume (and mute setting) untouched.
function resetFeedVideoSession(nextKey, force=false) {
  if(!force && nextKey===currentFeedKey) return false;
  ++ghostRequestGeneration; // invalidate an outstanding FFmpeg request
  ghostPreparing=false;
  stopGhostPlayback(false); // synchronously restore the original media URL
  feedABStates.clear();
  jfResetVideoFilter();
  document.querySelectorAll('#feedScroller video.feedVideo').forEach(video=>{
    const focus=focusZoomStates.get(video);
    if(focus){
      setFocusZoomEnabled(video,false);
      focus.zoom=1; focus.x=0; focus.y=0;
      focusZoomStates.delete(video);
    }
    video.playbackRate=1;
    video.loop=true;
  });
  exitImmersiveChrome();
  return true;
}

function getFeedABState(key) {
  if (
    !feedABStates.has(
      key
    )
  ) {
    feedABStates.set(
      key,
      {
        a: NaN,
        b: NaN,
        enabled: false
      }
    );
  }

  return feedABStates.get(
    key
  );
}

function getCurrentFeedItem() {
  return allItems.find(
    item =>
      item.key ===
      currentFeedKey
  ) || null;
}

function getCurrentFeedVideo() {
  if (!currentFeedKey) {
    return null;
  }

  const scroller =
    document.querySelector(
      '#feedScroller'
    );

  if (!scroller) {
    return null;
  }

  const section =
    [...scroller.querySelectorAll(
      '.feedItem'
    )]
      .find(
        node =>
          node.dataset.key ===
          currentFeedKey
      );

  if (!section) {
    return null;
  }

  return section.querySelector(
    'video.feedVideo'
  );
}

function syncFeedABQuickActions() {
  const dock=document.getElementById('feedABQuickActions');
  if(!dock)return;
  const item=getCurrentFeedItem();
  const overlay=document.getElementById('feedOverlay');
  const state=item && item.kind==='video' ? feedABStates.get(item.key) : null;
  const visible=Boolean(overlay?.classList.contains('open') && state?.enabled && validABState(state));
  dock.hidden=!visible;
  dock.setAttribute('aria-hidden',String(!visible));
}

function updateFeedABUi() {
  const ghostButton=document.querySelector('#feedGhostLoop');
  if(ghostButton){
    const active=Boolean(ghostPlayback && ghostPlayback.key===currentFeedKey);
    ghostButton.classList.toggle('active',active);
    ghostButton.setAttribute('aria-pressed',String(active));
    ghostButton.textContent=ghostPreparing ? '生成中…' : '鬼畜';
    ghostButton.disabled=ghostPreparing;
  }
  const item =
    getCurrentFeedItem();

  const aButton =
    document.querySelector(
      '#feedSetA'
    );

  const bButton =
    document.querySelector(
      '#feedSetB'
    );

  const loopButton =
    document.querySelector(
      '#feedABLoop'
    );

  const clipButton =
    document.querySelector(
      '#feedClip'
    );
  const portraitButton = document.querySelector('#feedPortrait');
  const clipShelfButton = document.querySelector('#feedClipShelf');

  const magnifyButton =
    document.querySelector(
      '#feedMagnify'
    );

  const currentVideo =
    getCurrentFeedVideo();

  if (magnifyButton) {
    const state =
      currentVideo
        ? focusZoomStates.get(
            currentVideo
          )
        : null;

    const enabled =
      Boolean(
        state &&
        state.enabled
      );

    magnifyButton.classList.toggle(
      'active',
      enabled
    );

    magnifyButton.title =
      enabled
        ? '关闭宽屏聚焦'
        : '宽屏聚焦';
    magnifyButton.setAttribute('aria-pressed',String(enabled));
    magnifyButton.setAttribute('aria-label',magnifyButton.title);
  }

  const videoMode =
    item &&
    item.kind ===
      'video';

  for (
    const button of [
      aButton,
      bButton,
      loopButton,
      clipButton,
      portraitButton,
      clipShelfButton,
      document.querySelector('#feedScreenshot'),
      document.querySelector('#feedAudio')
    ]
  ) {
    if (!button) {
      continue;
    }

    button.disabled =
      !videoMode;

    button.style.opacity =
      videoMode
        ? ''
        : '.35';
  }

  if (!videoMode) {
    syncFeedABQuickActions();
    if (aButton) {
      aButton.dataset.pointTime = '';
      aButton.classList.remove(
        'set'
      );
    }

    if (bButton) {
      bButton.dataset.pointTime = '';
      bButton.classList.remove(
        'set'
      );
    }

    if (loopButton) {
      loopButton.classList.remove(
        'active'
      );
      loopButton.setAttribute('aria-pressed','false');
    }

    return;
  }

  const state =
    getFeedABState(
      item.key
    );

  if (aButton) {
    aButton.classList.toggle(
      'set',
      Number.isFinite(
        state.a
      )
    );

    aButton.dataset.pointTime = Number.isFinite(state.a) ? formatMiniTime(state.a) : '';

    aButton.title =
      Number.isFinite(
        state.a
      )
        ? 'A = ' +
          formatMiniTime(
            state.a
          ) +
          '；点击重新设置'
        : '将当前时间设为 A';
    aButton.setAttribute('aria-label',aButton.title);
  }

  if (bButton) {
    bButton.classList.toggle(
      'set',
      Number.isFinite(
        state.b
      )
    );

    bButton.dataset.pointTime = Number.isFinite(state.b) ? formatMiniTime(state.b) : '';

    bButton.title =
      Number.isFinite(
        state.b
      )
        ? 'B = ' +
          formatMiniTime(
            state.b
          ) +
          '；点击重新设置'
        : '将当前时间设为 B';
    bButton.setAttribute('aria-label',bButton.title);
  }

  if (loopButton) {
    loopButton.classList.toggle(
      'active',
      Boolean(
        state.enabled
      )
    );

    loopButton.title =
      state.enabled
        ? '关闭 A-B 区间循环'
        : '开启 A-B 区间循环';
    loopButton.setAttribute('aria-label',loopButton.title);
    loopButton.setAttribute('aria-pressed',String(Boolean(state.enabled)));
  }
  syncFeedABQuickActions();
}

function installFeedABVideo(video, key) {
  if (!video || video.dataset.abInstalled === '1') return;
  video.dataset.abInstalled = '1';
  // 全屏上下切换会复用同一个 video，不能把监听器绑定到最初的媒体 key。
  const activeKey = () => video.dataset.itemKey || key;
  const resolveState = () => getFeedABState(activeKey());
  const configure = () => {
    const mediaKey = activeKey();
    const item = allItems.find(entry => entry.key === mediaKey);
    const state = resolveState();
    if(video.dataset.ghostMode==='1'){video.loop=true;return;}
    video.loop = !(state.enabled && validABState(state));
    if (mediaKey === currentFeedKey) updateFeedABUi();
  };
  video.addEventListener('loadedmetadata', configure);
  video.addEventListener('durationchange', configure);
  installResponsiveVideoLoop(video, () => video.dataset.ghostMode==='1' ? null : resolveState());
  if (video.readyState >= 1) configure();
}

function installAllFeedABVideos() {
  document
    .querySelectorAll(
      '#feedScroller video.feedVideo'
    )
    .forEach(
      video => {
        const key =
          video.dataset.itemKey;

        if (key) {
          installFeedABVideo(
            video,
            key
          );
        }
      }
    );
}

async function clipCurrentFeedAB() {
  const item =
    getCurrentFeedItem();

  const video =
    getCurrentFeedVideo();

  if (
    !item ||
    item.kind !== 'video' ||
    !video
  ) {
    return;
  }

  const state =
    getFeedABState(
      item.key
    );

  if (
    !validABState(
      state
    )
  ) {
    alert(
      '请先设置有效的 A、B 时间点，且 B 必须晚于 A。'
    );

    return;
  }

  const button =
    document.querySelector(
      '#feedClip'
    );

  if (
    !button ||
    button.classList.contains(
      'loading'
    )
  ) {
    return;
  }

  button.classList.add(
    'loading'
  );
  button.setAttribute('aria-busy','true');
  const runningLabel = button.querySelector('.feedToolLabel');
  if (runningLabel) runningLabel.textContent = '截取中';

  button.disabled =
    true;

  button.title =
    '正在截取视频…';

  try {
    const task=jfStartMediaProgress('截取视频片段');
    let r;
    try {r =
      await fetch(
        '/api/clip',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              key:
                item.key,
              start:
                state.a,
              end:
                state.b,
              jobId:task.id
            })
        }
      );
    } finally {task.done(Boolean(r && r.ok));}

    const data =
      await r.json();

    if (
      !r.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        '截取失败'
      );
    }

    if (
      data.item &&
      !allItems.some(
        x =>
          x.key ===
          data.item.key
      )
    ) {
      allItems.push(
        data.item
      );
    }

    button.classList.remove(
      'loading'
    );
    button.removeAttribute('aria-busy');

    button.classList.add(
      'done'
    );

    const label = button.querySelector('.feedToolLabel');
    if (label) label.textContent = '已截取';

    button.title =
      '已生成新视频';

    renderCreatorTags();
    render();

    setTimeout(
      () => {
        button.classList.remove(
          'done'
        );

        if (label) label.textContent = '截取视频';

        button.title =
          '截取 A-B 为新视频';

        button.disabled =
          false;
      },
      1200
    );
  } catch (error) {
    button.classList.remove(
      'loading'
    );
    button.removeAttribute('aria-busy');

    button.disabled =
      false;

    const label = button.querySelector('.feedToolLabel');
    if (label) label.textContent = '截取视频';

    button.title =
      '截取 A-B 为新视频';

    alert(
      error.message ||
      '截取失败'
    );
  }
}


const isStandaloneWebApp =
  Boolean(
    window.matchMedia &&
    window.matchMedia(
      '(display-mode: standalone)'
    ).matches
  ) ||
  Boolean(
    window.matchMedia &&
    window.matchMedia(
      '(display-mode: fullscreen)'
    ).matches
  ) ||
  Boolean(
    navigator.standalone
  );

if (isStandaloneWebApp) {
  document.documentElement
    .classList.add(
      'standaloneWebApp'
    );
}

let audioCoexistenceSupported =
  false;

let audioCoexistenceEnabled =
  false;

const audioInterruptedVideos =
  new Set();

const audioKnownPlayingVideos =
  new Set();

function enableAudioCoexistence() {
  try {
    if (
      !(
        'audioSession' in
        navigator
      ) ||
      !navigator.audioSession
    ) {
      audioCoexistenceSupported =
        false;

      return false;
    }

    navigator.audioSession.type =
      'ambient';

    audioCoexistenceSupported =
      true;

    audioCoexistenceEnabled =
      navigator.audioSession.type ===
        'ambient';

    return audioCoexistenceEnabled;
  } catch {
    audioCoexistenceSupported =
      false;

    audioCoexistenceEnabled =
      false;

    return false;
  }
}

function restoreAudioCoexistence() {
  if (
    !audioCoexistenceSupported
  ) {
    enableAudioCoexistence();
    return;
  }

  try {
    if (
      navigator.audioSession.type !==
        'ambient'
    ) {
      navigator.audioSession.type =
        'ambient';
    }

    audioCoexistenceEnabled =
      true;
  } catch {}
}

function rememberVideoPlaying(video) {
  if (!video) {
    return;
  }

  audioKnownPlayingVideos.add(
    video
  );
}

function rememberVideoPaused(video) {
  if (!video) {
    return;
  }

  try {
    if (
      audioCoexistenceSupported &&
      navigator.audioSession &&
      navigator.audioSession.state ===
        'interrupted'
    ) {
      audioInterruptedVideos.add(
        video
      );

      return;
    }
  } catch {}

  audioKnownPlayingVideos.delete(
    video
  );
}

enableAudioCoexistence();

document.addEventListener(
  'play',
  event => {
    const video =
      event.target;

    if (
      !video ||
      video.tagName !==
        'VIDEO'
    ) {
      return;
    }

    rememberVideoPlaying(
      video
    );

    restoreAudioCoexistence();
  },
  true
);

document.addEventListener(
  'pause',
  event => {
    const video =
      event.target;

    if (
      !video ||
      video.tagName !==
        'VIDEO'
    ) {
      return;
    }

    rememberVideoPaused(
      video
    );
  },
  true
);

document.addEventListener(
  'visibilitychange',
  () => {
    if (!document.hidden) {
      restoreAudioCoexistence();
    }
  }
);

window.addEventListener(
  'pageshow',
  restoreAudioCoexistence
);

if (
  'audioSession' in navigator &&
  navigator.audioSession &&
  typeof navigator.audioSession
    .addEventListener ===
    'function'
) {
  navigator.audioSession.addEventListener(
    'statechange',
    () => {
      const state =
        navigator.audioSession.state;

      if (
        state ===
          'interrupted'
      ) {
        for (
          const video of
          audioKnownPlayingVideos
        ) {
          if (
            video &&
            video.isConnected
          ) {
            audioInterruptedVideos.add(
              video
            );
          }
        }

        return;
      }

      if (
        state === 'active' ||
        state === 'inactive'
      ) {
        restoreAudioCoexistence();

        for (
          const video of
          [...audioInterruptedVideos]
        ) {
          audioInterruptedVideos.delete(
            video
          );

          if (
            video &&
            video.isConnected &&
            video.paused &&
            !video.ended
          ) {
            video
              .play()
              .catch(
                () => {}
              );
          }
        }
      }
    }
  );
}

const focusZoomStates =
  new WeakMap();

function focusViewportSize(video) {
  const nativeFullscreen =
    (
      document.fullscreenElement ===
        video ||
      document.webkitFullscreenElement ===
        video
    );

  if (nativeFullscreen) {
    return {
      width:
        window.innerWidth,
      height:
        window.innerHeight
    };
  }

  const host =
    video.parentElement;

  return {
    width:
      host
        ? host.clientWidth
        : 0,
    height:
      host
        ? host.clientHeight
        : 0
  };
}

function ensureFocusHost(video) {
  const host =
    video.parentElement;

  if (!host) {
    return null;
  }

  host.classList.add(
    'videoFocusHost'
  );

  return host;
}

function getFocusState(video) {
  let state =
    focusZoomStates.get(
      video
    );

  if (state) {
    return state;
  }

  state = {
    enabled:false,
    zoom:1,
    x:0,
    y:0,
    dragging:false,
    pointerId:null,
    startX:0,
    startY:0,
    startOffsetX:0,
    startOffsetY:0,
    touchPointers:
      new Map(),
    pinchStartDistance:0,
    pinchStartZoom:1
  };

  focusZoomStates.set(
    video,
    state
  );

  return state;
}

function focusVisualSize(video) {
  const rotation =
    normalizeRotation(
      video.dataset.rotation ||
      0
    );

  const rotated =
    rotation === 90 ||
    rotation === 270;

  return {
    width:
      rotated
        ? video.videoHeight
        : video.videoWidth,
    height:
      rotated
        ? video.videoWidth
        : video.videoHeight,
    rotation
  };
}

function focusMinimumScale(video) {
  if (
    !video.videoWidth ||
    !video.videoHeight
  ) {
    return 1;
  }

  const viewport =
    focusViewportSize(
      video
    );

  const visual =
    focusVisualSize(
      video
    );

  if (
    !viewport.width ||
    !viewport.height ||
    !visual.width ||
    !visual.height
  ) {
    return 1;
  }

  // 先计算普通播放 contain 时的实际缩放比例。
  //
  // “宽屏聚焦”的最低倍率不是直接 cover 到 100vw，
  // 而是普通播放尺寸的 2 倍。
  //
  // 例如正常竖屏视频显示宽度约 500px：
  // 开启聚焦后最低宽度约 1000px。
  const containScale =
    Math.min(
      viewport.width /
        visual.width,
      viewport.height /
        visual.height
    );

  return containScale * 2;
}

function focusPanLimits(
  video,
  scale
) {
  const viewport =
    focusViewportSize(
      video
    );

  const visual =
    focusVisualSize(
      video
    );

  return {
    x:
      Math.max(
        0,
        (
          visual.width *
          scale -
          viewport.width
        ) /
        2
      ),
    y:
      Math.max(
        0,
        (
          visual.height *
          scale -
          viewport.height
        ) /
        2
      )
  };
}

function applyFocusTransform(video) {
  if (
    !video ||
    !video.videoWidth ||
    !video.videoHeight
  ) {
    return;
  }

  const state =
    getFocusState(
      video
    );

  if (
    !state.enabled
  ) {
    rotationTransform(
      video,
      video.dataset.rotation ||
      0
    );

    return;
  }

  const visual =
    focusVisualSize(
      video
    );

  const scale =
    focusMinimumScale(
      video
    ) *
    state.zoom;

  const limits =
    focusPanLimits(
      video,
      scale
    );

  state.x =
    Math.max(
      -limits.x,
      Math.min(
        limits.x,
        state.x
      )
    );

  state.y =
    Math.max(
      -limits.y,
      Math.min(
        limits.y,
        state.y
      )
    );

  // 只做统一 scale + 位移 + rotate，不做非等比拉伸。
  video.style.width =
    video.videoWidth +
    'px';

  video.style.height =
    video.videoHeight +
    'px';

  video.style.maxWidth =
    'none';

  video.style.maxHeight =
    'none';

  video.style.flex =
    '0 0 auto';

  video.style.objectFit =
    'contain';

  video.style.transformOrigin =
    'center center';

  video.style.transform =
    'translate(' +
    state.x +
    'px,' +
    state.y +
    'px) rotate(' +
    visual.rotation +
    'deg) scale(' +
    scale +
    ')';
}


let immersiveHideTimer =
  null;

function currentFeedFocusEnabled() {
  const video =
    getCurrentFeedVideo();

  if (!video) {
    return false;
  }

  const state =
    focusZoomStates.get(
      video
    );

  return Boolean(
    state &&
    state.enabled
  );
}

function showImmersiveChrome() {
  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  if (!overlay) {
    return;
  }

  overlay.classList.remove(
    'chromeHidden'
  );

  overlay.classList.remove(
    'cursorHidden'
  );
}

function hideImmersiveChrome() {
  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  if (
    !overlay ||
    !overlay.classList.contains(
      'open'
    ) ||
    !currentFeedFocusEnabled()
  ) {
    return;
  }

  overlay.classList.add(
    'chromeHidden'
  );

  overlay.classList.add(
    'cursorHidden'
  );
}

function scheduleImmersiveChromeHide() {
  clearTimeout(
    immersiveHideTimer
  );

  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  if (
    !overlay ||
    !overlay.classList.contains(
      'open'
    ) ||
    !currentFeedFocusEnabled()
  ) {
    if (overlay) {
      overlay.classList.remove(
        'focusImmersive'
      );

      overlay.classList.remove(
        'chromeHidden'
      );

      overlay.classList.remove(
        'cursorHidden'
      );
    }

    return;
  }

  overlay.classList.add(
    'focusImmersive'
  );

  showImmersiveChrome();

  immersiveHideTimer =
    setTimeout(
      hideImmersiveChrome,
      3000
    );
}

function exitImmersiveChrome() {
  clearTimeout(
    immersiveHideTimer
  );

  immersiveHideTimer =
    null;

  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  if (!overlay) {
    return;
  }

  overlay.classList.remove(
    'focusImmersive'
  );

  overlay.classList.remove(
    'chromeHidden'
  );

  overlay.classList.remove(
    'cursorHidden'
  );
}

function setFocusZoomEnabled(
  video,
  enabled
) {
  if (!video) {
    return false;
  }

  installFocusZoom(
    video
  );

  const state =
    getFocusState(
      video
    );

  state.enabled =
    Boolean(
      enabled
    );

  const host =
    ensureFocusHost(
      video
    );

  if (host) {
    host.classList.toggle(
      'focusOn',
      state.enabled
    );
  }

  video.classList.toggle(
    'videoFocusMode',
    state.enabled
  );

  if (
    state.enabled
  ) {
    state.zoom =
      Math.max(
        1,
        Number(
          state.zoom ||
          1
        )
      );

    if (
      !Number.isFinite(
        state.x
      )
    ) {
      state.x = 0;
    }

    if (
      !Number.isFinite(
        state.y
      )
    ) {
      state.y = 0;
    }
  } else {
    state.dragging =
      false;

    state.pointerId =
      null;

    state.touchPointers.clear();

    state.pinchStartDistance =
      0;

    video.classList.remove(
      'dragging'
    );
  }

  requestAnimationFrame(
    () =>
      applyFocusTransform(
        video
      )
  );

  // Feed 当前视频开启宽屏聚焦时进入沉浸模式。
  if (
    video.classList.contains(
      'feedVideo'
    ) &&
    video.dataset.itemKey ===
      currentFeedKey
  ) {
    if (state.enabled) {
      scheduleImmersiveChromeHide();
    } else {
      exitImmersiveChrome();
    }
  }

  return state.enabled;
}

function toggleFocusZoom(video) {
  if (!video) {
    return false;
  }

  const state =
    getFocusState(
      video
    );

  return setFocusZoomEnabled(
    video,
    !state.enabled
  );
}

function installFocusZoom(video) {
  if (
    !video ||
    video.dataset.focusZoomInstalled ===
      '1'
  ) {
    return;
  }

  video.dataset.focusZoomInstalled =
    '1';

  ensureFocusHost(
    video
  );

  const state =
    getFocusState(
      video
    );

  video.addEventListener(
    'loadedmetadata',
    () => {
      if (
        state.enabled
      ) {
        requestAnimationFrame(
          () =>
            applyFocusTransform(
              video
            )
        );
      }
    }
  );

  video.addEventListener(
    'pointerdown',
    event => {
      if (
        !state.enabled
      ) {
        return;
      }

      if (
        event.pointerType !==
          'touch' &&
        event.button !== undefined &&
        event.button !== 0
      ) {
        return;
      }

      const rect =
        video.getBoundingClientRect();

      // 底部 controls 区域继续交给原生播放器。
      if (
        rect.bottom -
        event.clientY <
        76
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (
        event.pointerType ===
          'touch'
      ) {
        state.touchPointers.set(
          event.pointerId,
          {
            x:event.clientX,
            y:event.clientY
          }
        );

        try {
          video.setPointerCapture(
            event.pointerId
          );
        } catch {}

        if (
          state.touchPointers.size >=
            2
        ) {
          const points =
            [...state.touchPointers.values()];

          const dx =
            points[0].x -
            points[1].x;

          const dy =
            points[0].y -
            points[1].y;

          state.pinchStartDistance =
            Math.max(
              1,
              Math.hypot(
                dx,
                dy
              )
            );

          state.pinchStartZoom =
            state.zoom;

          state.dragging =
            false;

          state.pointerId =
            null;

          video.classList.remove(
            'dragging'
          );

          return;
        }
      }

      state.dragging =
        true;

      state.pointerId =
        event.pointerId;

      state.startX =
        event.clientX;

      state.startY =
        event.clientY;

      state.startOffsetX =
        state.x;

      state.startOffsetY =
        state.y;

      video.classList.add(
        'dragging'
      );

      try {
        video.setPointerCapture(
          event.pointerId
        );
      } catch {}
    }
  );

  video.addEventListener(
    'pointermove',
    event => {
      if (
        !state.enabled
      ) {
        return;
      }

      if (
        event.pointerType ===
          'touch' &&
        state.touchPointers.has(
          event.pointerId
        )
      ) {
        state.touchPointers.set(
          event.pointerId,
          {
            x:event.clientX,
            y:event.clientY
          }
        );
      }

      if (
        event.pointerType ===
          'touch' &&
        state.touchPointers.size >=
          2
      ) {
        event.preventDefault();
        event.stopPropagation();

        const points =
          [...state.touchPointers.values()];

        const dx =
          points[0].x -
          points[1].x;

        const dy =
          points[0].y -
          points[1].y;

        const distance =
          Math.max(
            1,
            Math.hypot(
              dx,
              dy
            )
          );

        if (
          state.pinchStartDistance >
            0
        ) {
          state.zoom =
            Math.max(
              1,
              Math.min(
                4,
                state.pinchStartZoom *
                (
                  distance /
                  state.pinchStartDistance
                )
              )
            );

          applyFocusTransform(
            video
          );
        }

        return;
      }

      if (
        !state.dragging ||
        event.pointerId !==
          state.pointerId
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      state.x =
        state.startOffsetX +
        event.clientX -
        state.startX;

      state.y =
        state.startOffsetY +
        event.clientY -
        state.startY;

      applyFocusTransform(
        video
      );
    }
  );

  const stop =
    event => {
      if (
        event &&
        event.pointerType ===
          'touch'
      ) {
        state.touchPointers.delete(
          event.pointerId
        );

        if (
          state.touchPointers.size <
            2
        ) {
          state.pinchStartDistance =
            0;
        }
      }

      if (
        state.dragging &&
        (
          !event ||
          event.pointerId ===
            state.pointerId
        )
      ) {
        state.dragging =
          false;

        state.pointerId =
          null;

        video.classList.remove(
          'dragging'
        );
      }

      // 双指缩放结束后若仍剩一根手指，
      // 允许继续无缝单指拖动画面。
      if (
        event &&
        event.pointerType ===
          'touch' &&
        state.touchPointers.size ===
          1
      ) {
        const entry =
          state.touchPointers
            .entries()
            .next()
            .value;

        if (entry) {
          const remainingId =
            entry[0];

          const point =
            entry[1];

          state.dragging =
            true;

          state.pointerId =
            remainingId;

          state.startX =
            point.x;

          state.startY =
            point.y;

          state.startOffsetX =
            state.x;

          state.startOffsetY =
            state.y;

          video.classList.add(
            'dragging'
          );
        }
      }
    };

  video.addEventListener(
    'pointerup',
    stop
  );

  video.addEventListener(
    'pointercancel',
    stop
  );

  video.addEventListener(
    'wheel',
    event => {
      if (
        !state.enabled
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      state.zoom =
        Math.max(
          1,
          Math.min(
            4,
            state.zoom +
            (
              event.deltaY < 0
                ? 0.12
                : -0.12
            )
          )
        );

      applyFocusTransform(
        video
      );
    },
    {
      passive:false
    }
  );
}

function installFocusZoomIn(root) {
  const scope =
    root ||
    document;

  scope
    .querySelectorAll(
      'video'
    )
    .forEach(
      installFocusZoom
    );
}


function feedSections() {
  const scroller =
    document.querySelector(
      '#feedScroller'
    );

  if (!scroller) {
    return [];
  }

  return [
    ...scroller.querySelectorAll(
      '.feedItem'
    )
  ];
}

function feedSectionIndex(section) {
  if (!section) {
    return -1;
  }

  const value =
    Number(
      section.dataset.index
    );

  return Number.isFinite(value)
    ? value
    : -1;
}

function disconnectFeedVideoObserver(video) {
  if (
    !video ||
    typeof videoResizeObservers ===
      'undefined'
  ) {
    return;
  }

  const observer =
    videoResizeObservers.get(video);

  if (observer) {
    try {
      observer.disconnect();
    } catch {}

    try {
      videoResizeObservers.delete(video);
    } catch {}
  }
}

function setupFeedVideo(video, section) {
  if (!video || !section) {
    return;
  }

  installRememberedVolume(
    video
  );

  const key = section.dataset.key;

  if (
    video.dataset.feedSetup !== '1'
  ) {
    video.dataset.feedSetup = '1';

    installFeedABVideo(video, key);
    installFocusZoom(video);
  }

  const activeFullscreen =
    fullscreenVideoElement();

  if (video !== activeFullscreen) {
    video.dataset.itemKey = key;
    video.dataset.fullscreenKey = key;
    video.dataset.rotation =
      section.dataset.rotation || '0';
  }

  applyRotationToVideo(
    video,
    Number(video.dataset.rotation || 0)
  );
}

function loadFeedVideo(video, section, active) {
  if (!video || !section) {
    return;
  }

  setupFeedVideo(video, section);
  if (video.dataset.ghostMode==='1') return;

  const activeFullscreen =
    fullscreenVideoElement();

  const fullscreenKey =
    video.dataset.fullscreenKey ||
    '';

  // 原生全屏切换时，同一个 video 会临时承载其他媒体。
  // 后台 Feed 预加载不能再按宿主卡片的 data-src 把它覆盖回去。
  if (
    video === activeFullscreen &&
    fullscreenKey &&
    fullscreenKey !==
      section.dataset.key
  ) {
    video.preload =
      'auto';

    return;
  }

  const src = video.dataset.src;
  if (!src) {
    return;
  }

  const alreadyLoaded =
    video.dataset.loaded === '1' &&
    video.getAttribute('src') === src;

  // Adjacent players may buffer in background, but must never auto-play.
  video.preload = 'auto';

  if (!alreadyLoaded) {
    video.src = src;
    video.dataset.loaded = '1';

    try {
      video.load();
    } catch {}
  }
}

function unloadFeedVideo(video) {
  if (!video) {
    return;
  }

  const activeFullscreen =
    fullscreenVideoElement();

  if (
    video === activeFullscreen ||
    (
      nativeFullscreenVideo === video &&
      activeFullscreen
    )
  ) {
    return;
  }

  if (
    video.dataset.loaded !== '1' &&
    !video.hasAttribute('src')
  ) {
    disconnectFeedVideoObserver(video);
    return;
  }

  try {
    video.pause();
  } catch {}

  disconnectFeedVideoObserver(video);
  video.preload = 'none';
  video.dataset.loaded = '0';
  video.removeAttribute('src');

  try {
    video.load();
  } catch {}
}

function hydrateFeedWindow(centerIndex) {
  const sections = feedSections();

  if (
    centerIndex < 0 ||
    !sections.length
  ) {
    return;
  }

  for (
    let index = 0;
    index < sections.length;
    index++
  ) {
    const section = sections[index];
    const video =
      section.querySelector(
        'video.feedVideo'
      );

    if (!video) {
      continue;
    }

    const distance =
      Math.abs(index - centerIndex);

    if (
      distance <= FEED_PRELOAD_RADIUS
    ) {
      loadFeedVideo(
        video,
        section,
        index === centerIndex
      );
    } else {
      unloadFeedVideo(video);
    }
  }
}

// Playback arbiter: the native fullscreen video is the *only* audible Feed
// player while fullscreen is active.  The scroll Feed still contains video
// elements for navigation/preload; those must never start a second soundtrack.
function feedAudibleVideo() {
  const scroller=document.getElementById('feedScroller');
  if (!scroller || !document.getElementById('feedOverlay')?.classList.contains('open')) return null;
  const fullscreen=fullscreenVideoElement();
  if (fullscreen && scroller.contains(fullscreen)) return fullscreen;
  const active=[...scroller.querySelectorAll('.feedItem')]
    .find(section=>section.dataset.key===currentFeedKey);
  return active?.querySelector('video.feedVideo')||null;
}
function silenceOtherFeedVideos(keep=null) {
  document.querySelectorAll('#feedScroller video.feedVideo').forEach(video=>{
    if (video!==keep) { try { video.pause(); } catch {} }
  });
}
// A delayed play() promise, loadedmetadata callback or IntersectionObserver
// can try to restart an old video *after* a fullscreen switch. Cancel it at
// the media event boundary too; never let two Feed videos continue playing.
document.addEventListener('play',event=>{
  const video=event.target;
  if (!video?.matches?.('#feedScroller video.feedVideo')) return;
  const expected=feedAudibleVideo();
  if (document.querySelector('.shotStudioBack') || video!==expected) {
    try { video.pause(); } catch {}
    return;
  }
  silenceOtherFeedVideos(video);
},true);

function pauseInactiveFeedVideos(activeSection) {
  if (document.querySelector('.shotStudioBack')) {
    silenceOtherFeedVideos();
    return;
  }
  const scroller=document.getElementById('feedScroller');
  if (!scroller) return;
  const fullscreen=fullscreenVideoElement();
  // Important: the video hosting native fullscreen might belong to the OLD
  // section while its src is switched to a NEW key. Never start the video's
  // new background card just because it became intersecting or got hydrated.
  if (fullscreen) {
    silenceOtherFeedVideos(fullscreen);
    return;
  }
  const expected=feedAudibleVideo();
  silenceOtherFeedVideos(expected);
  if (expected && expected.dataset.loaded==='1' && expected.paused &&
      !document.querySelector('.shotStudioBack')) {
    expected.play().catch(()=>{});
  }
}

function openFeed(key) {
  resetFeedVideoSession(key,true);
  resetFeedWheelGesture();
  const source =
    currentRenderedItems.length
      ? currentRenderedItems
      : allItems;

  if (!source.length) {
    return;
  }

  currentFeedKey = key;
  

  const scroller =
    document.querySelector(
      '#feedScroller'
    );

  scroller.innerHTML =
    source
      .map(
        (item, index) => {
          const media =
            item.kind === 'image'
              ? '<img class="feedMedia feedImage" loading="lazy" decoding="async" src="' +
                esc(item.mediaUrl) +
                '" alt="' +
                esc(item.title || item.creator || '图片') +
                '">'
              : '<div class="videoStage">' +
                '<video class="feedMedia feedVideo" controls playsinline loop preload="none" data-loaded="0" data-src="' +
                esc(item.mediaUrl) +
                '" data-item-key="' +
                esc(item.key) +
                '" data-fullscreen-key="' +
                esc(item.key) +
                '" data-rotation="' +
                esc(String(Number(item.rotation || 0))) +
                '"' +
                (
                  item.cover
                    ? ' poster="' +
                      esc(item.cover) +
                      '"'
                    : ''
                ) +
                '></video>' +
                '</div>';

          return (
            '<section class="feedItem" data-index="' +
            index +
            '" data-key="' +
            esc(item.key) +
            '" data-rotation="' +
            esc(String(Number(item.rotation || 0))) +
            '">' +
              media +
              '<div class="feedDetails">' +
                '<div class="feedInfo">' +
                  '<div class="feedCreator">' +
                    esc(item.creator || '未设置创作者') +
                  '</div>' +
                  '<div class="feedTitle">' +
                    esc(item.title || '未命名') +
                  '</div>' +
                '</div>' +
                (
                  item.kind === 'video'
                    ? feedRatingMarkup(item)
                    : ''
                ) +
              '</div>' +
            '</section>'
          );
        }
      )
      .join('');

  const sections = feedSections();

  let startIndex =
    sections.findIndex(
      section =>
        section.dataset.key === key
    );

  if (startIndex < 0) {
    startIndex = 0;

    if (sections[0]) {
      currentFeedKey =
        sections[0].dataset.key;
    }
  }

  hydrateFeedWindow(startIndex);
  updateFeedABUi();
  resetFeedDeleteButton();

  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  overlay.classList.add('open');
  resetStudioFeedPanels();
  renderFeedFilmstrip();
  wakeStudioFeedChrome();
  overlay.setAttribute(
    'aria-hidden',
    'false'
  );

  if (currentFeedFocusEnabled()) {
    scheduleImmersiveChromeHide();
  } else {
    exitImmersiveChrome();
  }

  if (feedObserver) {
    feedObserver.disconnect();
  }

  feedObserver =
    new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (
            !entry.isIntersecting ||
            entry.intersectionRatio < 0.65
          ) {
            continue;
          }

          const section = entry.target;
          const index =
            feedSectionIndex(section);

          hydrateFeedWindow(index);

          if (!fullscreenVideoElement()) {
            resetFeedVideoSession(section.dataset.key);
            currentFeedKey =
              section.dataset.key;
            
            renderFeedFilmstrip();
            renderStudioRatingDock();

            updateFeedABUi();
            resetFeedDeleteButton();

            if (currentFeedFocusEnabled()) {
              scheduleImmersiveChromeHide();
            } else {
              exitImmersiveChrome();
            }
          }

          pauseInactiveFeedVideos(section);
        }
      },
      {
        root: scroller,
        threshold: [0.65]
      }
    );

  sections.forEach(
    section =>
      feedObserver.observe(section)
  );

  requestAnimationFrame(
    () => {
      const target = sections[startIndex];

      if (target) {
        target.scrollIntoView({
          block:'start'
        });

        const video =
          target.querySelector(
            'video.feedVideo'
          );

        if (video) {
          video.play().catch(() => {});
        }
      }
    }
  );
}

function scrollGridToFeedKey(
  key
) {
  if (!key) {
    return;
  }

  requestAnimationFrame(
    () => {
      requestAnimationFrame(
        () => {
          const card =
            [...document.querySelectorAll(
              '#grid .card'
            )]
              .find(
                node =>
                  node.dataset.key ===
                  key
              );

          if (!card) {
            return;
          }

          card.scrollIntoView({
            behavior:'auto',
            block:'center',
            inline:'nearest'
          });
        }
      );
    }
  );
}

function closeFeed() {
  resetFeedVideoSession("",true);
  resetFeedWheelGesture();
  const closingKey =
    currentFeedKey;

  resetFeedDeleteButton();
  exitImmersiveChrome();

  nativeFullscreenVideo =
    null;

  nativeFullscreenKey =
    '';

  const overlay =
    document.querySelector(
      '#feedOverlay'
    );

  overlay.classList.remove(
    'open'
  );
  resetStudioFeedPanels();

  overlay.setAttribute(
    'aria-hidden',
    'true'
  );

  if (feedObserver) {
    feedObserver.disconnect();
    feedObserver = null;
  }

  document
    .querySelectorAll(
      '#feedScroller video'
    )
    .forEach(
      video => {
        try {
          video.pause();
        } catch {}

        disconnectFeedVideoObserver(
          video
        );

        video.removeAttribute(
          'src'
        );

        video.preload = 'none';

        try {
          video.load();
        } catch {}
      }
    );

  document.querySelector(
    '#feedScroller'
  ).innerHTML = '';

  if (pendingGridRender) {
    renderCreatorTags();
    render();
    pendingGridRender = false;
  }

  // Return to the library without collecting viewing history.
  renderStudioEntrance();
  scrollGridToFeedKey(
    closingKey
  );
  currentFeedKey="";
}

function stepFeed(direction) {
  const scroller =
    document.querySelector(
      '#feedScroller'
    );

  const items =
    [...scroller.querySelectorAll(
      '.feedItem'
    )];

  if (!items.length) {
    return;
  }

  let index =
    items.findIndex(
      item =>
        item.dataset.key ===
        currentFeedKey
    );

  if (index < 0) {
    index = 0;
  }

  index =
    Math.max(
      0,
      Math.min(
        items.length - 1,
        index + direction
      )
    );

  if (
    items[index].dataset.key === currentFeedKey &&
    Math.abs(scroller.scrollTop - items[index].offsetTop) < 2
  ) {
    return;
  }

  // 先固定当前索引，再跳转画面。不能等待 IntersectionObserver 回调，
  // 否则输入事件在动画期间会使用旧索引并连续跨条目。
  resetFeedVideoSession(items[index].dataset.key);
  currentFeedKey = items[index].dataset.key;
  hydrateFeedWindow(index);
  scroller.scrollTo({
    top: items[index].offsetTop,
    behavior:'instant'
  });
  updateFeedABUi();
  resetFeedDeleteButton();
  pauseInactiveFeedVideos(items[index]);

  if (currentFeedFocusEnabled()) {
    scheduleImmersiveChromeHide();
  }
}

let miniWindowSeed = 0;
let miniZIndex = 1200;

function bringMiniToFront(box) {
  miniZIndex++;
  box.style.zIndex =
    String(miniZIndex);
}

function clampMiniPosition(box, left, top) {
  const width =
    box.offsetWidth || 320;

  const height =
    box.offsetHeight || 360;

  const maxLeft =
    Math.max(
      0,
      window.innerWidth -
      Math.min(
        width,
        window.innerWidth
      )
    );

  const maxTop =
    Math.max(
      0,
      window.innerHeight -
      Math.min(
        height,
        window.innerHeight
      )
    );

  return {
    left:
      Math.max(
        0,
        Math.min(
          maxLeft,
          left
        )
      ),
    top:
      Math.max(
        0,
        Math.min(
          maxTop,
          top
        )
      )
  };
}

function installMiniDrag(box, handle) {
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  handle.addEventListener(
    'pointerdown',
    event => {
      if (
        event.button !== undefined &&
        event.button !== 0
      ) {
        return;
      }

      if (
        event.target.closest(
          'button'
        )
      ) {
        return;
      }

      dragging = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startLeft =
        parseFloat(
          box.style.left || '0'
        );
      startTop =
        parseFloat(
          box.style.top || '0'
        );

      bringMiniToFront(box);

      try {
        handle.setPointerCapture(
          pointerId
        );
      } catch {}

      event.preventDefault();
    }
  );

  handle.addEventListener(
    'pointermove',
    event => {
      if (
        !dragging ||
        event.pointerId !==
          pointerId
      ) {
        return;
      }

      const next =
        clampMiniPosition(
          box,
          startLeft +
          event.clientX -
          startX,
          startTop +
          event.clientY -
          startY
        );

      box.style.left =
        next.left + 'px';

      box.style.top =
        next.top + 'px';
    }
  );

  const stop =
    event => {
      if (
        !dragging ||
        (
          event &&
          event.pointerId !==
            pointerId
        )
      ) {
        return;
      }

      dragging = false;
      pointerId = null;
    };

  handle.addEventListener(
    'pointerup',
    stop
  );

  handle.addEventListener(
    'pointercancel',
    stop
  );
}

function installMiniResize(box, handle) {
  let resizing = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  handle.addEventListener(
    'pointerdown',
    event => {
      if (
        event.button !== undefined &&
        event.button !== 0
      ) {
        return;
      }

      resizing = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startWidth = box.offsetWidth;
      startHeight = box.offsetHeight;

      bringMiniToFront(box);

      try {
        handle.setPointerCapture(
          pointerId
        );
      } catch {}

      event.preventDefault();
      event.stopPropagation();
    }
  );

  handle.addEventListener(
    'pointermove',
    event => {
      if (
        !resizing ||
        event.pointerId !==
          pointerId
      ) {
        return;
      }

      const left =
        parseFloat(
          box.style.left || '0'
        );

      const top =
        parseFloat(
          box.style.top || '0'
        );

      const maxWidth =
        Math.max(
          220,
          window.innerWidth -
          left
        );

      const width =
        Math.max(
          220,
          Math.min(
            maxWidth,
            startWidth +
            event.clientX -
            startX
          )
        );

      const height =
        Math.max(
          180,
          startHeight +
          event.clientY -
          startY
        );

      box.style.width =
        width + 'px';

      box.style.height =
        height + 'px';

      const video =
        box.querySelector(
          'video'
        );

      if (video) {
        const focusState =
          focusZoomStates.get(
            video
          );

        if (
          focusState &&
          focusState.enabled
        ) {
          applyFocusTransform(
            video
          );
        } else {
          rotationTransform(
            video,
            video.dataset.rotation || 0
          );
        }
      }
    }
  );

  const stop =
    event => {
      if (
        !resizing ||
        (
          event &&
          event.pointerId !==
            pointerId
        )
      ) {
        return;
      }

      resizing = false;
      pointerId = null;
    };

  handle.addEventListener(
    'pointerup',
    stop
  );

  handle.addEventListener(
    'pointercancel',
    stop
  );
}


window.addEventListener(
  'resize',
  () => {
    document
      .querySelectorAll(
        '.miniPlayer video[data-rotation]'
      )
      .forEach(
        video => {
          const focusState =
            focusZoomStates.get(
              video
            );

          if (
            focusState &&
            focusState.enabled
          ) {
            applyFocusTransform(
              video
            );
          } else {
            rotationTransform(
              video,
              video.dataset.rotation || 0
            );
          }
        }
      );
  }
);


function updateMiniVisibilityToggle() {
  const dock =
    document.querySelector(
      '#multiDock'
    );

  const button =
    document.querySelector(
      '#miniVisibilityToggle'
    );

  const syncButton =
    document.querySelector(
      '#miniSyncStart'
    );

  if (
    !dock ||
    !button
  ) {
    return;
  }

  const count =
    dock.querySelectorAll(
      '.miniPlayer'
    ).length;

  const videoCount =
    dock.querySelectorAll(
      '.miniPlayer video'
    ).length;

  button.classList.toggle(
    'show',
    count > 0
  );

  if (syncButton) {
    syncButton.classList.toggle(
      'show',
      videoCount > 0
    );

    syncButton.title =
      videoCount > 1
        ? '全部 ' + videoCount + ' 个多开视频从 0 秒同时播放'
        : '多开视频从 0 秒重新播放';

    syncButton.setAttribute(
      'aria-label',
      syncButton.title
    );
  }

  if (
    count === 0
  ) {
    dock.classList.remove(
      'hiddenWindows'
    );
  }

  const hidden =
    dock.classList.contains(
      'hiddenWindows'
    );

  const eyeOn =
    button.querySelector(
      '.eyeOn'
    );

  const eyeOff =
    button.querySelector(
      '.eyeOff'
    );

  if (eyeOn) {
    eyeOn.style.display =
      hidden
        ? 'none'
        : '';
  }

  if (eyeOff) {
    eyeOff.style.display =
      hidden
        ? ''
        : 'none';
  }

  button.title =
    hidden
      ? '显示多开窗口'
      : '暂时隐藏多开窗口';

  button.setAttribute(
    'aria-label',
    button.title
  );
}

function toggleMiniWindowsVisibility() {
  const dock =
    document.querySelector(
      '#multiDock'
    );

  if (!dock) {
    return;
  }

  dock.classList.toggle(
    'hiddenWindows'
  );

  updateMiniVisibilityToggle();
}

function restartAllMiniVideos() {
  const videos =
    [
      ...document.querySelectorAll(
        '#multiDock .miniPlayer video'
      )
    ];

  if (!videos.length) {
    return;
  }

  for (const video of videos) {
    try {
      video.currentTime = 0;
    } catch {}
  }

  // 同一次用户点击里统一调用 play，尽可能让各窗口同时起跑。
  for (const video of videos) {
    try {
      const promise =
        video.play();

      if (
        promise &&
        typeof promise.catch ===
          'function'
      ) {
        promise.catch(
          () => {}
        );
      }
    } catch {}
  }
}


function formatMiniTime(seconds) {
  seconds =
    Number(seconds);

  if (
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return '--:--';
  }

  const m =
    Math.floor(
      seconds / 60
    );

  const s =
    Math.floor(
      seconds % 60
    );

  const tenth =
    Math.floor(
      (seconds % 1) * 10
    );

  return (
    m +
    ':' +
    String(s)
      .padStart(2,'0') +
    '.' +
    tenth
  );
}

function validABState(state) {
  return (
    state &&
    Number.isFinite(
      state.a
    ) &&
    Number.isFinite(
      state.b
    ) &&
    state.a >= 0 &&
    state.b >
      state.a +
      0.05
  );
}

function updateMiniABUi(
  box,
  state
) {
  const aButton =
    box.querySelector(
      '.miniSetA'
    );

  const bButton =
    box.querySelector(
      '.miniSetB'
    );

  const loopButton =
    box.querySelector(
      '.miniABLoop'
    );

  if (aButton) {
    aButton.classList.toggle(
      'set',
      Number.isFinite(
        state.a
      )
    );

    aButton.textContent = 'A';

    aButton.title =
      Number.isFinite(
        state.a
      )
        ? 'A = ' +
          formatMiniTime(
            state.a
          ) +
          '；点击重新设置'
        : '将当前时间设为 A';
  }

  if (bButton) {
    bButton.classList.toggle(
      'set',
      Number.isFinite(
        state.b
      )
    );

    bButton.textContent = 'B';

    bButton.title =
      Number.isFinite(
        state.b
      )
        ? 'B = ' +
          formatMiniTime(
            state.b
          ) +
          '；点击重新设置'
        : '将当前时间设为 B';
  }

  if (loopButton) {
    loopButton.classList.toggle(
      'active',
      Boolean(
        state.enabled
      )
    );

    loopButton.title =
      state.enabled
        ? '关闭 A-B 循环'
        : '开启 A-B 循环';
  }
}

function installMiniAB(
  box,
  item,
  video
) {
  if (
    !video ||
    item.kind !==
      'video'
  ) {
    return;
  }

  const state = {
    a: NaN,
    b: NaN,
    enabled: false
  };

  const aButton =
    box.querySelector(
      '.miniSetA'
    );

  const bButton =
    box.querySelector(
      '.miniSetB'
    );

  const loopButton =
    box.querySelector(
      '.miniABLoop'
    );

  const clipButton =
    box.querySelector(
      '.miniClipBtn'
    );
  const saveClipButton=box.querySelector('.miniSaveAB');
  if(saveClipButton) saveClipButton.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    openClipShelf({sourceKey:item.key, state, video});
  });

  if (aButton) {
    aButton.addEventListener(
      'click',
      event => {
        event.stopPropagation();

        if (state.auto) { state.b = NaN; state.enabled = false; video.loop = true; }
        state.manual = true;
        state.auto = false;
        state.a =
          Number(
            video.currentTime || 0
          );

        if (
          Number.isFinite(
            state.b
          ) &&
          state.b <=
            state.a
        ) {
          state.b =
            NaN;

          state.enabled =
            false;

          video.loop =
            true;
        }

        updateMiniABUi(
          box,
          state
        );
      }
    );
  }

  if (bButton) {
    bButton.addEventListener(
      'click',
      event => {
        event.stopPropagation();

        state.manual = true;
        state.auto = false;
        state.b =
          Number(
            video.currentTime || 0
          );

        if (
          Number.isFinite(
            state.a
          ) &&
          state.b <=
            state.a
        ) {
          state.enabled =
            false;

          video.loop =
            true;
        }

        updateMiniABUi(
          box,
          state
        );
      }
    );
  }

  if (loopButton) {
    loopButton.addEventListener(
      'click',
      event => {
        event.stopPropagation();

        if (
          !validABState(
            state
          )
        ) {
          alert(
            '请先设置有效的 A、B 时间点，且 B 必须晚于 A。'
          );

          return;
        }

        state.manual = true;
        state.auto = false;
        state.enabled =
          !state.enabled;

        // 普通情况下仍然保持全视频 loop；
        // A-B 开启时由 timeupdate 自己循环。
        video.loop =
          !state.enabled;

        if (state.enabled) {
          if (
            video.currentTime <
              state.a ||
            video.currentTime >=
              state.b
          ) {
            video.currentTime =
              state.a;
          }

          video
            .play()
            .catch(
              () => {}
            );
        }

        updateMiniABUi(
          box,
          state
        );
      }
    );
  }

  const configureClip = () => {
    video.loop = !(state.enabled && validABState(state));
    updateMiniABUi(box, state);
  };
  video.addEventListener('loadedmetadata', configureClip);
  video.addEventListener('durationchange', configureClip);
  installResponsiveVideoLoop(video, () => state);
  if (video.readyState >= 1) configureClip();

  if (clipButton) {
    clipButton.addEventListener(
      'click',
      async event => {
        event.stopPropagation();

        if (
          clipButton.classList.contains(
            'loading'
          )
        ) {
          return;
        }

        if (
          !validABState(
            state
          )
        ) {
          alert(
            '请先设置有效的 A、B 时间点，且 B 必须晚于 A。'
          );

          return;
        }

        clipButton.classList.add(
          'loading'
        );

        clipButton.disabled =
          true;

        clipButton.title =
          '正在截取视频…';

        try {
          const task=jfStartMediaProgress('截取视频片段');
          let r;
          try {r =
            await fetch(
              '/api/clip',
              {
                method:'POST',
                headers:{
                  'Content-Type':
                    'application/json'
                },
                body:
                  JSON.stringify({
                    key:
                      item.key,
                    start:
                      state.a,
                      end:
                      state.b,
                    jobId:task.id
                  })
              }
            );
          } finally {task.done(Boolean(r && r.ok));}

          const data =
            await r.json();

          if (
            !r.ok ||
            !data.ok
          ) {
            throw new Error(
              data.error ||
              '截取失败'
            );
          }

          if (data.item) {
            allItems.push(
              data.item
            );

            renderCreatorTags();
            render();
          }

          clipButton.classList.remove(
            'loading'
          );

          clipButton.classList.add(
            'done'
          );

          clipButton.textContent =
            '✓';

          clipButton.title =
            '已生成新视频';

          setTimeout(
            () => {
              clipButton.classList.remove(
                'done'
              );

              clipButton.innerHTML = studioIcon('scissors');

              clipButton.title =
                '截取 A-B 为新视频';

              clipButton.disabled =
                false;
            },
            1200
          );
        } catch (error) {
          clipButton.classList.remove(
            'loading'
          );

          clipButton.disabled =
            false;

          clipButton.innerHTML = studioIcon('scissors');

          clipButton.title =
            '截取 A-B 为新视频';

          alert(
            error.message ||
            '截取失败'
          );
        }
      }
    );
  }

  updateMiniABUi(
    box,
    state
  );
}

function openMulti(key) {
  const item =
    allItems.find(
      x => x.key === key
    );

  if (!item) {
    return;
  }

  const id =
    'mini-' +
    item.key;

  const existing =
    document.getElementById(
      id
    );

  if (existing) {
    bringMiniToFront(
      existing
    );

    return;
  }

  const box =
    document.createElement(
      'div'
    );

  box.id = id;
  box.className = 'miniPlayer';

  miniWindowSeed++;

  const offset =
    (miniWindowSeed - 1) %
    7;

  // Top-left cascade keeps the resize corner reachable away from the screen edge.
  const startLeft = Math.min(Math.max(12, innerWidth - 340), 20 + offset * 30);
  const startTop = Math.min(Math.max(12, innerHeight - 360), 96 + offset * 28);

  box.style.left =
    startLeft + 'px';

  box.style.top =
    startTop + 'px';

  bringMiniToFront(box);

  const media =
    item.kind === 'image'
      ? '<img src="' +
        esc(item.mediaUrl) +
        '" alt="' +
        esc(item.title || '图片') +
        '">'
      : '<video controls playsinline autoplay loop preload="metadata" data-item-key="' +
        esc(item.key) +
        '" data-rotation="' +
        esc(String(Number(item.rotation || 0))) +
        '" src="' +
        esc(item.mediaUrl) +
        '"></video>';

  box.innerHTML =
    '<div class="miniHead">' +
      '<span class="miniLabel">' +
        esc(item.title || '未命名') +
      '</span>' +
      (
        item.kind === 'video'
          ? '<button class="miniToolsToggle" type="button" title="更多操作" aria-label="更多操作" aria-expanded="false">···</button><div class="miniAdvanced">' + '<button class="miniABBtn miniSetA" type="button" title="将当前时间设为 A">A</button>' +
            '<button class="miniABBtn miniSetB" type="button" title="将当前时间设为 B">B</button>' +
            '<button class="miniABBtn miniABLoop" type="button" title="开启 A-B 循环">'+studioIcon('repeat')+'</button>' +
            '<button class="miniABBtn miniSaveAB" type="button" title="保存或管理 A/B 片段">'+studioIcon('clips')+'</button>' +
            '<button class="miniClipBtn" type="button" title="截取 A-B 为新视频">'+studioIcon('scissors')+'</button>' +
            '<button class="miniPortrait" type="button" title="选择 9:16 横向裁剪范围，新增竖屏视频">'+studioIcon('portrait')+'</button>' +
            '<button class="miniMagnify" type="button" title="宽屏聚焦">'+studioIcon('magnify')+'</button>' +
            '<button class="miniRotate" type="button" title="旋转视频">'+studioIcon('rotate')+'</button></div>'
          : ''
      ) +
      '<button class="miniClose" type="button" title="关闭">×</button>' +
    '</div>' +
    '<div class="miniMediaWrap">' +
      media +
      '<div class="miniResize" title="拖拽调整大小"></div>' +
    '</div>';

  const head =
    box.querySelector(
      '.miniHead'
    );

  const resize =
    box.querySelector(
      '.miniResize'
    );

  const miniToggle = box.querySelector('.miniToolsToggle');
  if (miniToggle) miniToggle.addEventListener('click', event => {
    event.stopPropagation();
    const open=box.classList.toggle('miniToolsOpen');
    miniToggle.setAttribute('aria-expanded',String(open));
  });
  installMiniDrag(
    box,
    head
  );

  installMiniResize(
    box,
    resize
  );

  const miniVideo =
    box.querySelector(
      'video'
    );

  if (miniVideo) {
    // 多开视频只在创建时继承一次当前记忆音量；
    // 后续音量调整完全独立，不参与全局同步。
    miniVideo.dataset.independentVolume =
      '1';

    installRememberedVolume(
      miniVideo
    );

    applyRotationToVideo(
      miniVideo,
      item.rotation || 0
    );
  }

  installMiniAB(
    box,
    item,
    miniVideo
  );

  if (miniVideo) {
    installFocusZoom(
      miniVideo
    );
  }

  const miniPortrait = box.querySelector('.miniPortrait');
  if (miniPortrait) {
    miniPortrait.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      makePortraitVideo(item.key, miniPortrait, miniVideo);
    });
  }

  const miniMagnify =
    box.querySelector(
      '.miniMagnify'
    );

  if (miniMagnify) {
    miniMagnify.addEventListener(
      'click',
      event => {
        event.preventDefault();
        event.stopPropagation();

        const enabled =
          toggleFocusZoom(
            miniVideo
          );

        miniMagnify.classList.toggle(
          'active',
          enabled
        );

        miniMagnify.title =
          enabled
            ? '关闭宽屏聚焦'
            : '宽屏聚焦';
      }
    );
  }

  const miniRotate =
    box.querySelector(
      '.miniRotate'
    );

  if (miniRotate) {
    miniRotate.addEventListener(
      'click',
      async event => {
        event.preventDefault();
        event.stopPropagation();

        const next =
          (
            normalizeRotation(
              item.rotation
            ) +
            90
          ) %
          360;

        const saved =
          await setItemRotation(
            item.key,
            next
          );

        if (
          saved === null
        ) {
          return;
        }

        item.rotation =
          saved;

        if (miniVideo) {
          applyRotationToVideo(
            miniVideo,
            saved
          );

          requestAnimationFrame(
            () =>
              rotationTransform(
                miniVideo,
                saved
              )
          );
        }

        miniRotate.title =
          '旋转视频 ' +
          saved +
          '°';

        render();
      }
    );
  }

  box.addEventListener(
    'pointerdown',
    () =>
      bringMiniToFront(
        box
      )
  );

  box
    .querySelector(
      '.miniClose'
    )
    .addEventListener(
      'click',
      event => {
        event.stopPropagation();

        const video =
          box.querySelector(
            'video'
          );

        if (video) {
          video.pause();
        }

        box.remove();

        updateMiniVisibilityToggle();
      }
    );

  document
    .querySelector(
      '#multiDock'
    )
    .appendChild(
      box
    );

  updateMiniVisibilityToggle();
}


// Common media interactions: one menu / selection / rename flow across all three libraries.
function unifiedToast(message) {
  const toast=document.querySelector('#unifiedToast');
  toast.textContent=String(message);toast.hidden=false;
  clearTimeout(unifiedToastTimer);
  unifiedToastTimer=setTimeout(()=>{toast.hidden=true;},2600);
}
function unifiedVisibleItems() {
  if(libraryMode==='video')return currentRenderedItems.filter(x=>x.kind==='video');
  if(libraryMode==='image')return imageViewerList;
  return [...document.querySelectorAll('#grid .audioFileTile[data-media-key]')]
    .map(el=>allItems.find(x=>x.key===el.dataset.mediaKey)).filter(Boolean);
}
function syncUnifiedControls() {
  const btn=document.querySelector('#unifiedSelectTop');if(!btn)return;
  const fav=document.querySelector('#unifiedFavoriteFilter');fav.setAttribute('aria-pressed',String(unifiedFavoriteOnly));
  fav.querySelector('.studioFavoriteLabel').textContent=unifiedFavoriteOnly?'仅看收藏':'收藏';
  document.body.classList.toggle('unifiedSelecting',mediaSelectMode);
  btn.setAttribute('aria-pressed',String(mediaSelectMode));
  btn.textContent=mediaSelectMode?'完成选择':'选择';
  const bar=document.querySelector('#unifiedBatchBar');bar.hidden=!mediaSelectMode;
  const count=mediaSelectedKeys.size;
  document.querySelector('#unifiedCount').textContent='已选 '+count+' 项';
  document.querySelector('#unifiedExport').disabled=count!==1;
  document.querySelector('#unifiedDelete').disabled=count===0;
  document.querySelector('#unifiedFavorite').disabled=count===0;
  document.querySelector('#unifiedMove').disabled=count===0;
  const items=[...mediaSelectedKeys].map(k=>allItems.find(x=>x.key===k)).filter(Boolean);
  document.querySelector('#unifiedFavorite').textContent=items.length&&items.every(x=>x.favorite)?'★ 取消收藏':'☆ 收藏';
  document.querySelector('#unifiedSelectAll').textContent='全选当前列表';
}
function syncUnifiedTiles() {
  document.querySelectorAll('#grid [data-media-key]').forEach(el=>{
    const key=el.dataset.mediaKey;
    el.draggable=true;
    el.classList.toggle('unifiedSelected',mediaSelectedKeys.has(key));
    el.classList.toggle('selected',mediaSelectedKeys.has(key)&&libraryMode==='image');
    const check=el.querySelector('.mediaTileCheck');
    if(check)check.setAttribute('aria-pressed',String(mediaSelectedKeys.has(key)));
  });
  syncUnifiedControls();
}
function setUnifiedSelectMode(active) {
  hideUnifiedContext();
  mediaSelectMode=!!active;
  photoSelectMode=!!active && libraryMode==='image';
  mediaSelectedKeys.clear();unifiedLastSelectedKey=null;
  if(libraryMode==='image')syncPhotoSelectionUI();
  syncUnifiedControls();
  syncUnifiedTiles();
}
function toggleUnifiedSelection(key,shift=false) {
  if(!mediaSelectMode)setUnifiedSelectMode(true);
  const list=unifiedVisibleItems().map(x=>x.key);
  if(shift&&unifiedLastSelectedKey&&list.includes(key)&&list.includes(unifiedLastSelectedKey)) {
    const from=list.indexOf(unifiedLastSelectedKey),to=list.indexOf(key);
    for(const k of list.slice(Math.min(from,to),Math.max(from,to)+1))mediaSelectedKeys.add(k);
  } else if(mediaSelectedKeys.has(key))mediaSelectedKeys.delete(key);
  else mediaSelectedKeys.add(key);
  unifiedLastSelectedKey=key;
  syncUnifiedTiles();
}
// 影格 Studio 统一线性图标：与播放器工具栏同为 24px 视口、1.75px 描边。
function studioIcon(name) {
  const paths={
    multi:'<rect x="5" y="5" width="11" height="11" rx="2"/><path d="M9 9h10v10H9"/>',
    portrait:'<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    clips:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    link:'<path d="M10 14a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1 1M14 10a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1-1"/>',
    magnify:'<circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 5 5"/>',
    rotate:'<path d="M20 8v-5l-4 4a8 8 0 1 0 4 6"/>',
    play:'<path d="m8 5 11 7-11 7z"/>',
    minus:'<path d="M5 12h14"/>',
    image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 4 3 3-4 4 6"/>',
    audio:'<path d="M10 18V5l10-2v13"/><ellipse cx="7" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
    rename:'<path d="m4 16 12-12 4 4L8 20H4zM13 7l4 4"/>',
    favorite:'<path d="m12 2 3 6.4 7 .9-5.1 4.9 1.2 7L12 18l-6.1 3.2 1.2-7L2 9.3l7-.9z"/>',
    export:'<path d="M12 3v13m-5-5 5 5 5-5M4 18v3h16v-3"/>',
    move:'<path d="M4 5h8l2 3h6v12H4zM10 14h7m-3-3 3 3-3 3"/>',
    select:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
    delete:'<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    folder:'<path d="M3 6h7l2 2h9v11H3z"/>',
    repeat:'<path d="M3 8V5h12a5 5 0 0 1 5 5v1m-3-3 3 3 3-3M21 16v3H9a5 5 0 0 1-5-5v-1m3 3-3-3-3 3"/>',
    scissors:'<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="m8 8 12 12M8 16 20 4"/>',
    volume:'<path d="M4 9v6h4l5 4V5L8 9zM17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
    mute:'<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6m0-6-5 6"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.select)+'</svg>';
}
function studioMenuItem(action,label,icon,extraAttr) {
  return '<button type="button" role="menuitem" '+extraAttr+' class="studioMenuRow'+(action==='delete'?' danger':'')+'"><span class="studioMenuIcon">'+studioIcon(icon)+'</span><span class="studioMenuLabel">'+esc(label)+'</span></button>';
}
function hideUnifiedContext() {const menu=document.querySelector('#unifiedContext');if(menu)menu.hidden=true;}
function showUnifiedContext(key,x,y) {
  const item=allItems.find(v=>v.key===key);
  if(!item)return;
  const menu=document.querySelector('#unifiedContext');
  menu.dataset.key=key;
  // 视频双击即播；图片与音频保留各自的查看/播放入口，避免顺带削减其它媒体类型的操作。
  const buttons=[
    ...(item.kind==='image'?[['open','查看图片','image']]:[]),
    ['rename','重命名','rename'],
    ['move','移动到目录','move'],['delete','删除','delete']
  ];
  menu.innerHTML='<div class="contextHeading" title="'+esc(unifiedMediaName(item))+'">'+esc(unifiedMediaName(item))+'</div>'+ 
    buttons.map(([action,label,icon])=>studioMenuItem(action,label,icon,'data-context-action="'+action+'"')).join('');
  menu.hidden=false;
  const width=menu.offsetWidth||210,height=menu.offsetHeight||225;
  menu.style.left=Math.max(8,Math.min(x,window.innerWidth-width-8))+'px';
  menu.style.top=Math.max(8,Math.min(y,window.innerHeight-height-8))+'px';
  menu.querySelector('button')?.focus({preventScroll:true});
}
function hideUnifiedRename() {document.querySelector('#unifiedRenameBack').hidden=true;unifiedRenameKey=null;}

// Directory management: move existing hash-named files without rewriting their bytes.
let unifiedMoveKeys=[];
function unifiedFolderOptions() {
  const folders=[{relativeDir:'root',name:'原媒体目录'},{relativeDir:'data',name:'data'},...allFolders.filter(x=>x.relativeDir.startsWith('data/') && x.state!=='pending').map(x=>({relativeDir:x.relativeDir,name:unifiedFolderPath(x.relativeDir)}))];
  return folders.sort((a,b)=>a.relativeDir==='data'?-1:b.relativeDir==='data'?1:a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
}
function unifiedFolderPath(dir) {
  if(dir==='root')return '原媒体目录';
  const parts=String(dir).split('/');
  return parts.map((part,index)=>index===0?'data':folderDisplayName(parts.slice(0,index+1).join('/'))).join(' / ');
}
function openUnifiedMove(keys) {
  const valid=[...new Set(keys)].filter(k=>allItems.some(x=>x.key===k));
  if(!valid.length)return;
  if(valid.length>300){unifiedToast('一次最多移动 300 个文件，请分批选择');return;}
  hideUnifiedContext();unifiedMoveKeys=valid;
  const targets=unifiedFolderOptions();
  const select=document.querySelector('#unifiedMoveTarget');
  select.innerHTML=targets.map(x=>'<option value="'+esc(x.relativeDir)+'">'+esc(x.name)+'</option>').join('');
  if(targets.some(x=>x.relativeDir===activeFolder))select.value=activeFolder;
  document.querySelector('#unifiedMoveSummary').textContent='移动 '+valid.length+' 个文件到指定目录。文件会移动，名称保持不变。';
  document.querySelector('#unifiedMoveBack').hidden=false;
  select.focus();
}
function closeUnifiedMove(){document.querySelector('#unifiedMoveBack').hidden=true;unifiedMoveKeys=[];}
async function unifiedCommitMove(keys,target){
  if(!keys.length)return;
  const response=await mediaPost('/api/media-move',{keys,target});
  if(activeAudioKey&&keys.includes(activeAudioKey)){/* media URL is stable; leave player mounted */}
  closeUnifiedMove();setUnifiedSelectMode(false);
  lastStamp='';await load();
  unifiedToast(response.moved+' 个文件已移动至 '+unifiedFolderPath(target));
}
let unifiedAlbumRenameDir='';
function openUnifiedAlbum(){
  unifiedAlbumRenameDir='';
  document.querySelector('#unifiedAlbumHeading').textContent='新建相簿 / 文件夹';
  document.querySelector('#unifiedAlbumHelp').textContent='媒体目录名称与当前管理模式一致。';
  document.querySelector('#unifiedAlbumParentLabel').hidden=false;
  document.querySelector('#unifiedAlbumParent').required=true;
  document.querySelector('#unifiedAlbumSubmit').textContent='新建';
  const options=unifiedFolderOptions().filter(x=>x.relativeDir!=='root');
  const select=document.querySelector('#unifiedAlbumParent');
  select.innerHTML=options.map(x=>'<option value="'+esc(x.relativeDir)+'">'+esc(x.name)+'</option>').join('');
  if(options.some(x=>x.relativeDir===activeFolder))select.value=activeFolder;
  document.querySelector('#unifiedAlbumBack').hidden=false;
  const input=document.querySelector('#unifiedAlbumName');input.value='';input.focus();
}
function openUnifiedAlbumRename(dir){
  const folder=allFolders.find(f=>f.relativeDir===dir);
  if(!folder)return;
  hideUnifiedContext();
  unifiedAlbumRenameDir=dir;
  document.querySelector('#unifiedAlbumHeading').textContent='重命名文件夹';
  document.querySelector('#unifiedAlbumHelp').textContent='修改目录名称。';
  document.querySelector('#unifiedAlbumParentLabel').hidden=true;
  document.querySelector('#unifiedAlbumParent').required=false;
  document.querySelector('#unifiedAlbumSubmit').textContent='保存';
  const input=document.querySelector('#unifiedAlbumName');input.value=folder.originalName;
  document.querySelector('#unifiedAlbumBack').hidden=false;input.focus();input.select();
}
function closeUnifiedAlbum(){document.querySelector('#unifiedAlbumBack').hidden=true;unifiedAlbumRenameDir='';}
document.querySelector('#unifiedMoveCancel').onclick=closeUnifiedMove;
document.querySelector('#unifiedMoveBack').addEventListener('click',e=>{if(e.target.id==='unifiedMoveBack')closeUnifiedMove();});
document.querySelector('#unifiedMoveForm').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;
  try{await unifiedCommitMove(unifiedMoveKeys,document.querySelector('#unifiedMoveTarget').value);}
  catch(error){alert('移动失败：'+(error.message||error));}
  finally{button.disabled=false;}
});
document.querySelector('#unifiedAlbumCancel').onclick=closeUnifiedAlbum;
document.querySelector('#unifiedAlbumBack').addEventListener('click',e=>{if(e.target.id==='unifiedAlbumBack')closeUnifiedAlbum();});
document.querySelector('#unifiedAlbumForm').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.currentTarget.querySelector('[type=submit]');button.disabled=true;
  try{
    const rename=unifiedAlbumRenameDir;
    const result=rename
      ? await mediaPost('/api/folder-rename',{relativeDir:rename,name:document.querySelector('#unifiedAlbumName').value.trim()})
      : await mediaPost('/api/folder-create',{parent:document.querySelector('#unifiedAlbumParent').value,name:document.querySelector('#unifiedAlbumName').value.trim()});
    closeUnifiedAlbum();lastStamp='';await load();if(!rename)rememberMediaFolder(result.relativeDir);render();
    unifiedToast((rename?'已重命名：':'已创建：')+result.originalName);
  }catch(error){alert('创建目录失败：'+(error.message||error));}
  finally{button.disabled=false;}
});
// Dragging selected files onto album tiles or breadcrumb buttons triggers one batch move.
let unifiedDragKeys=[];
document.querySelector('#grid').addEventListener('dragstart',event=>{
  if(event.target.closest('button,input,[data-media-more]')&&!event.target.closest('.pictureTile'))return;
  const tile=event.target.closest('[data-media-key]');if(!tile)return;
  const key=tile.dataset.mediaKey;
  unifiedDragKeys=mediaSelectMode&&mediaSelectedKeys.has(key)?[...mediaSelectedKeys]:[key];
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain','douyin-media:'+unifiedDragKeys.join(','));
  document.body.classList.add('unifiedDragging');
});
document.querySelector('#grid').addEventListener('dragend',()=>{
  unifiedDragKeys=[];document.body.classList.remove('unifiedDragging');
  document.querySelectorAll('.unifiedDropTarget').forEach(el=>el.classList.remove('unifiedDropTarget'));
});
for(const selector of ['#folderTiles','#assetFolders']){
  const root=document.querySelector(selector);
  root.addEventListener('dragover',event=>{
    const target=event.target.closest('[data-open-folder]');
    if(!target||!unifiedDragKeys.length||!unifiedFolderOptions().some(x=>x.relativeDir===target.dataset.openFolder))return;
    event.preventDefault();event.dataTransfer.dropEffect='move';target.classList.add('unifiedDropTarget');
  });
  root.addEventListener('dragleave',event=>{
    const target=event.target.closest('[data-open-folder]');if(target)target.classList.remove('unifiedDropTarget');
  });
  root.addEventListener('drop',async event=>{
    const target=event.target.closest('[data-open-folder]');
    if(!target||!unifiedDragKeys.length)return;
    event.preventDefault();event.stopPropagation();
    const keys=unifiedDragKeys.slice(),dest=target.dataset.openFolder;
    unifiedDragKeys=[];document.body.classList.remove('unifiedDragging');
    document.querySelectorAll('.unifiedDropTarget').forEach(el=>el.classList.remove('unifiedDropTarget'));
    if(!unifiedFolderOptions().some(x=>x.relativeDir===dest))return;
    if(keys.every(k=>(allItems.find(x=>x.key===k)?.relativeDir||'root')===dest)){unifiedToast('文件已经在当前目录');return;}
    if(!confirm('将 '+keys.length+' 个文件移动到「'+unifiedFolderPath(dest)+'」？'))return;
    try{await unifiedCommitMove(keys,dest);}catch(error){alert('移动失败：'+(error.message||error));}
  });
}

function openUnifiedRename(key) {
  const item=allItems.find(x=>x.key===key);if(!item)return;
  hideUnifiedContext();
  unifiedRenameKey=key;
  const ext=String(item.originalExt||'');
  const current=unifiedMediaName(item);
  document.querySelector('#unifiedRenameInput').value=ext&&current.toLowerCase().endsWith(ext.toLowerCase())?current.slice(0,-ext.length):current;
  document.querySelector('#unifiedRenameExt').textContent=ext;
  document.querySelector('#unifiedRenameBack').hidden=false;
  document.querySelector('#unifiedRenameHeading').textContent='重命名'+({video:'视频',image:'图片',audio:'音频'}[item.kind]||'文件');
  const input=document.querySelector('#unifiedRenameInput');input.focus();input.select();
}
async function updateUnifiedFavorite(keys,favorite) {
  if(!keys.length)return;
  try {
    for(let i=0;i<keys.length;i+=500)await mediaPost('/api/media-favorite',{keys:keys.slice(i,i+500),favorite});
    const set=new Set(keys);allItems.forEach(x=>{if(set.has(x.key))x.favorite=favorite;});
    // Only the list is rebuilt; persistent audio playback stays in #audioDock.
    render();unifiedToast(favorite?'已收藏':'已取消收藏');
  }catch(error){alert('收藏失败：'+(error.message||error));}
}
function exportUnifiedMedia(key) {
  const item=allItems.find(x=>x.key===key);if(!item)return;
  const a=document.createElement('a');a.href=item.mediaUrl;
  a.download=unifiedMediaName(item);document.body.appendChild(a);a.click();a.remove();
  unifiedToast('已请求导出：'+unifiedMediaName(item));
}
async function deleteUnifiedMedia(keys) {
  const list=[...new Set(keys)].filter(key=>allItems.some(x=>x.key===key));
  if(!list.length)return;
  if(!confirm('永久删除选中的 '+list.length+' 个文件？\\n文件将直接删除，不进入回收站。'))return;
  try{
    let deleted=0,failures=0;
    for(let i=0;i<list.length;i+=300){
      const result=await mediaPost('/api/media-delete-batch',{keys:list.slice(i,i+300)});
      deleted+=result.deleted||0;failures+=(result.failed||[]).length;
    }
    if(activeAudioKey&&list.includes(activeAudioKey))closeAudioDock();
    if(libraryMode==='image'&&document.querySelector('#assetView').classList.contains('open'))hideImageViewer();
    mediaSelectedKeys.clear();setUnifiedSelectMode(false);
    lastStamp='';await load();
    unifiedToast(deleted+' 个文件已删除'+(failures?'，'+failures+' 个失败':''));
  }catch(error){lastStamp='';await load();alert('删除失败：'+(error.message||error));}
}
async function unifiedContextAction(action,key) {
  hideUnifiedContext();
  const item=allItems.find(x=>x.key===key);if(!item)return;
  if(action==='open'){
    if(item.kind==='video')openFeed(key);
    else if(item.kind==='audio')openAudioDock(key);
    else if(item.kind==='image'){
      if(libraryMode!=='image')return;
      const index=imageViewerList.findIndex(x=>x.key===key);if(index>=0)showImageViewer(index);
    }
    return;
  }
  if(action==='rename'){openUnifiedRename(key);return;}
  if(action==='move'){openUnifiedMove([key]);return;}
  if(action==='favorite'){await updateUnifiedFavorite([key],!item.favorite);return;}
  if(action==='export'){exportUnifiedMedia(key);return;}
  if(action==='select'){setUnifiedSelectMode(true);toggleUnifiedSelection(key);return;}
  if(action==='delete'){await deleteUnifiedMedia([key]);return;}
}

// Capture-level delegation: prevent the video feed, photo viewer or audio playback from opening
// when the user is selecting files. Ignore browser-native editing inputs and controls.
document.querySelector('#grid').addEventListener('click',event=>{
  if(Date.now()<unifiedSuppressClickUntil){event.preventDefault();event.stopImmediatePropagation();return;}
  const more=event.target.closest('[data-media-more]');
  if(more) {
    event.preventDefault();event.stopImmediatePropagation();
    const r=more.getBoundingClientRect();showUnifiedContext(more.dataset.mediaMore,r.left,r.bottom+6);return;
  }
  if(!mediaSelectMode&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey)return;
  const tile=event.target.closest('[data-media-key]');if(!tile)return;
  event.preventDefault();event.stopImmediatePropagation();
  toggleUnifiedSelection(tile.dataset.mediaKey,event.shiftKey);
},true);
document.querySelector('#grid').addEventListener('dblclick',event=>{
  if(!mediaSelectMode)return;
  const tile=event.target.closest('[data-media-key]');if(tile){event.preventDefault();event.stopImmediatePropagation();}
},true);
document.querySelector('#grid').addEventListener('pointerdown',event=>{
  if(!mediaSelectMode)return;
  if(event.target.closest('[data-media-key]')){event.stopImmediatePropagation();}
},true);
document.querySelector('#grid').addEventListener('contextmenu',event=>{
  const tile=event.target.closest('[data-media-key]');if(!tile)return;
  event.preventDefault();showUnifiedContext(tile.dataset.mediaKey,event.clientX,event.clientY);
});
let unifiedLongPress=null;
document.querySelector('#grid').addEventListener('pointerdown',event=>{
  if(event.pointerType==='mouse'||mediaSelectMode)return;
  const tile=event.target.closest('[data-media-key]');if(!tile||event.target.closest('button,input,[data-media-more]'))return;
  const x=event.clientX,y=event.clientY;
  unifiedLongPress={x,y,timer:setTimeout(()=>{
    unifiedLongPress=null;unifiedSuppressClickUntil=Date.now()+550;showUnifiedContext(tile.dataset.mediaKey,x,y);
  },650)};
});
document.querySelector('#grid').addEventListener('pointermove',event=>{
  if(unifiedLongPress&&(Math.abs(event.clientX-unifiedLongPress.x)>12||Math.abs(event.clientY-unifiedLongPress.y)>12)){
    clearTimeout(unifiedLongPress.timer);unifiedLongPress=null;
  }
});
for(const name of ['pointerup','pointercancel','pointerleave'])
  document.querySelector('#grid').addEventListener(name,()=>{
    if(unifiedLongPress){clearTimeout(unifiedLongPress.timer);unifiedLongPress=null;}
  });
document.querySelector('#unifiedContext').addEventListener('click',event=>{
  const folderAction=event.target.closest('[data-folder-context-action]');
  if(folderAction){
    const dir=document.querySelector('#unifiedContext').dataset.folderDir;hideUnifiedContext();
    if(folderAction.dataset.folderContextAction==='rename')openUnifiedAlbumRename(dir);
    else {rememberMediaFolder(dir);setUnifiedSelectMode(false);render();}
    return;
  }
  const action=event.target.closest('[data-context-action]');if(action)unifiedContextAction(action.dataset.contextAction,document.querySelector('#unifiedContext').dataset.key);
});
document.querySelector('#unifiedSelectTop').onclick=()=>setUnifiedSelectMode(!mediaSelectMode);
document.querySelector('#unifiedFavoriteFilter').onclick=()=>{unifiedFavoriteOnly=!unifiedFavoriteOnly;setUnifiedSelectMode(false);render();};
document.querySelector('#unifiedFinish').onclick=()=>setUnifiedSelectMode(false);
document.querySelector('#unifiedSelectAll').onclick=()=>{
  unifiedVisibleItems().forEach(item=>mediaSelectedKeys.add(item.key));syncUnifiedTiles();
};
document.querySelector('#unifiedFavorite').onclick=()=>{
  const items=[...mediaSelectedKeys].map(k=>allItems.find(x=>x.key===k)).filter(Boolean);
  updateUnifiedFavorite(items.map(x=>x.key),!items.every(x=>x.favorite));
};
document.querySelector('#unifiedExport').onclick=()=>{
  if(mediaSelectedKeys.size===1)exportUnifiedMedia([...mediaSelectedKeys][0]);
};
document.querySelector('#unifiedDelete').onclick=()=>deleteUnifiedMedia([...mediaSelectedKeys]);
document.querySelector('#unifiedMove').onclick=()=>openUnifiedMove([...mediaSelectedKeys]);
document.querySelector('#unifiedRenameCancel').onclick=hideUnifiedRename;
document.querySelector('#unifiedRenameBack').addEventListener('click',event=>{
  if(event.target.id==='unifiedRenameBack')hideUnifiedRename();
});
document.querySelector('#unifiedRenameForm').addEventListener('submit',async event=>{
  event.preventDefault();const key=unifiedRenameKey;if(!key)return;
  const input=document.querySelector('#unifiedRenameInput');
  const button=event.target.querySelector('[type=submit]');
  const base=input.value.trim();if(!base){input.focus();return;}
  const ext=document.querySelector('#unifiedRenameExt').textContent;
  let full=base;
  if(ext&&!full.toLowerCase().endsWith(ext.toLowerCase()))full+=ext;
  button.disabled=true;
  try{
    const out=await mediaPost('/api/media-rename',{key,name:full});
    const item=allItems.find(x=>x.key===key);if(item)item.displayName=out.displayName;
    const current=activeAudioKey===key?document.querySelector('#audioDock .audioTitle'):null;
    if(current){current.textContent=full;current.title=full;}
    hideUnifiedRename();render();unifiedToast('已重命名');
  }catch(error){alert('重命名失败：'+(error.message||error));input.focus();}
  finally{button.disabled=false;}
});
document.addEventListener('pointerdown',event=>{
  if(!event.target.closest('#unifiedContext,[data-media-more]'))hideUnifiedContext();
});
document.addEventListener('keydown',event=>{
  const tag=event.target?.tagName;
  const editable=event.target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(tag);
  if(event.key==='Escape'){
    if(!document.querySelector('#unifiedMoveBack').hidden){closeUnifiedMove();event.preventDefault();return;}
    if(!document.querySelector('#unifiedAlbumBack').hidden){closeUnifiedAlbum();event.preventDefault();return;}
    if(!document.querySelector('#unifiedRenameBack').hidden){hideUnifiedRename();event.preventDefault();return;}
    if(!document.querySelector('#unifiedContext').hidden){hideUnifiedContext();event.preventDefault();return;}
    if(mediaSelectMode){setUnifiedSelectMode(false);event.preventDefault();return;}
  }
  if(editable||event.altKey)return;
  if(event.metaKey && !(mediaSelectMode&&event.key.toLowerCase()==='a'))return;
  if(event.key==='F2'){
    const folder=document.activeElement?.closest?.('#folderTiles [data-open-folder]');
    if(folder&&allFolders.some(f=>f.relativeDir===folder.dataset.openFolder)){event.preventDefault();openUnifiedAlbumRename(folder.dataset.openFolder);return;}
    const focused=document.activeElement?.closest?.('[data-media-key]');
    const key=focused?.dataset.mediaKey||(mediaSelectedKeys.size===1?[...mediaSelectedKeys][0]:null);
    if(key){event.preventDefault();event.stopImmediatePropagation();openUnifiedRename(key);}return;
  }
  if(mediaSelectMode && (event.key==='Enter'||event.key===' ') &&
     document.activeElement?.closest?.('#grid [data-media-key]')) {
    event.preventDefault();event.stopImmediatePropagation();
    toggleUnifiedSelection(document.activeElement.closest('[data-media-key]').dataset.mediaKey,event.shiftKey);return;
  }
  if(mediaSelectMode&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){
    event.preventDefault();unifiedVisibleItems().forEach(x=>mediaSelectedKeys.add(x.key));syncUnifiedTiles();return;
  }
  if(mediaSelectMode&&(event.key==='Delete'||event.key==='Backspace')&&mediaSelectedKeys.size){
    event.preventDefault();deleteUnifiedMedia([...mediaSelectedKeys]);
  }
},true);

document.querySelectorAll('[data-media-kind]').forEach(button=>{
  button.addEventListener('click',()=>{
    changeMediaCategory(button.dataset.mediaKind);
    syncAudioDockMode();
    mediaSelectMode=false;photoSelectMode=false;photoSelectedKeys.clear();hideUnifiedContext();
    document.querySelector('#search').value='';
    render();
    document.querySelector('#status').textContent=allItems.filter(x=>x.kind===libraryMode).length+' 个'+
      ({video:'视频',image:'图片',audio:'音频'}[libraryMode]||'媒体')+' · 媒体管理';
  });
});
function showUnifiedFolderContext(dir,x,y){
  const folder=allFolders.find(f=>f.relativeDir===dir);
  if(!folder)return;
  const menu=document.querySelector('#unifiedContext');
  menu.dataset.folderDir=dir;delete menu.dataset.key;
  menu.innerHTML='<div class="contextHeading">'+esc(folder.originalName)+'</div>'+ 
    studioMenuItem('open','打开文件夹','folder','data-folder-context-action="open"')+ 
    studioMenuItem('rename','重命名文件夹','rename','data-folder-context-action="rename"');
  menu.hidden=false;
  const width=menu.offsetWidth||210,height=menu.offsetHeight||120;
  menu.style.left=Math.max(8,Math.min(x,window.innerWidth-width-8))+'px';
  menu.style.top=Math.max(8,Math.min(y,window.innerHeight-height-8))+'px';
  menu.querySelector('button')?.focus({preventScroll:true});
}
document.querySelector('#folderTiles').addEventListener('contextmenu',event=>{
  const folder=event.target.closest('[data-open-folder]')||event.target.closest('[data-folder-more]');
  if(!folder)return;
  const dir=folder.dataset.openFolder||folder.dataset.folderMore;
  if(!allFolders.some(f=>f.relativeDir===dir))return;
  event.preventDefault();showUnifiedFolderContext(dir,event.clientX,event.clientY);
});
// Touch devices: long-press a folder to open the same management menu as ⋯ / right click.
let unifiedFolderLongPress=null;
const folderTileRoot=document.querySelector('#folderTiles');
folderTileRoot.addEventListener('pointerdown',event=>{
  if(event.pointerType==='mouse'||event.target.closest('[data-folder-more]'))return;
  const tile=event.target.closest('[data-open-folder]');if(!tile)return;
  const dir=tile.dataset.openFolder;
  if(!allFolders.some(f=>f.relativeDir===dir))return;
  const x=event.clientX,y=event.clientY;
  unifiedFolderLongPress={x,y,timer:setTimeout(()=>{
    unifiedFolderLongPress=null;unifiedSuppressClickUntil=Date.now()+650;
    showUnifiedFolderContext(dir,x,y);
  },630)};
});
folderTileRoot.addEventListener('pointermove',event=>{
  if(unifiedFolderLongPress&&(Math.abs(event.clientX-unifiedFolderLongPress.x)>12||Math.abs(event.clientY-unifiedFolderLongPress.y)>12)){
    clearTimeout(unifiedFolderLongPress.timer);unifiedFolderLongPress=null;
  }
});
for(const eventName of ['pointerup','pointercancel','pointerleave'])
  folderTileRoot.addEventListener(eventName,()=>{
    if(unifiedFolderLongPress){clearTimeout(unifiedFolderLongPress.timer);unifiedFolderLongPress=null;}
  });
folderTileRoot.addEventListener('click',event=>{
  if(Date.now()<unifiedSuppressClickUntil){event.preventDefault();event.stopImmediatePropagation();return;}
  const more=event.target.closest('[data-folder-more]');
  if(more){const r=more.getBoundingClientRect();showUnifiedFolderContext(more.dataset.folderMore,r.left,r.bottom+6);return;}
  const folder=event.target.closest('[data-open-folder]');
  if(folder){rememberMediaFolder(folder.dataset.openFolder);setUnifiedSelectMode(false);render();}
});
document.querySelector('#assetFolders').addEventListener('click',event=>{
  const folder=event.target.closest('[data-open-folder]');
  if(folder){rememberMediaFolder(folder.dataset.openFolder);setUnifiedSelectMode(false);render();return;}
  if(event.target.id==='unifiedNewAlbum'){openUnifiedAlbum();return;}
  if(event.target.id==='fileSort'){fileSortAscending=!fileSortAscending;render();}
});
document.querySelector('#photoSelect').onclick=()=>setPhotoSelectionMode(!photoSelectMode);
document.querySelector('#photoCancelSelect').onclick=()=>setPhotoSelectionMode(false);
document.querySelector('#photoSelectAll').onclick=()=>{
  imageViewerList.forEach(x=>photoSelectedKeys.add(x.key));syncPhotoSelectionUI();
};
document.querySelector('#photoDeleteSelected').onclick=()=>removePhotos([...photoSelectedKeys]);
document.querySelector('#photoRatio').onclick=()=>{
  photoOriginalRatio=!photoOriginalRatio;
  document.querySelector('#photoRatio .studioRatioLabel').textContent=photoOriginalRatio?'原比例':'方格';
  document.querySelector('#grid').classList.toggle('photoOriginalRatio',photoOriginalRatio);
};
try {const remembered=Number(localStorage.getItem('douyin-photo-cell-size'));if(remembered>=90&&remembered<=250)photoTileSize=remembered;}catch{}
document.querySelector('#photoCellSize').value=String(photoTileSize);
document.querySelector('#photoCellSize').oninput=e=>{
  photoTileSize=Number(e.target.value);
  document.querySelector('#grid').style.setProperty('--photo-cell',photoTileSize+'px');
  try{localStorage.setItem('douyin-photo-cell-size',String(photoTileSize));}catch{}
};
document.querySelector('#assetClose').onclick=hideImageViewer;
document.querySelector('#assetPrev').onclick=()=>showImageViewer(imageViewerIndex-1);
document.querySelector('#assetNext').onclick=()=>showImageViewer(imageViewerIndex+1);
document.querySelector('#photoZoomButton').onclick=togglePhotoZoom;
document.querySelector('#photoRailToggle').onclick=()=>{
  const viewer=document.getElementById('assetView');
  viewer.classList.toggle('photoRailHidden');
  const visible=!viewer.classList.contains('photoRailHidden');
  document.getElementById('photoRailToggle').setAttribute('aria-pressed',String(visible));
  document.getElementById('photoRailToggle').setAttribute('aria-label',visible?'收起图片列表':'展开图片列表');
};
document.querySelector('#photoMoreToggle').onclick=()=>{
 jfCloseFilter('photo');
 const panel=document.getElementById('photoMorePanel');panel.hidden=!panel.hidden;
 document.getElementById('photoMoreToggle').setAttribute('aria-expanded',String(!panel.hidden));
};
document.querySelector('#photoFilmstrip').addEventListener('click',e=>{
  const tile=e.target.closest('[data-film-index]');
  if(tile)showImageViewer(Number(tile.dataset.filmIndex));
});
document.querySelector('#photoDeleteOne').onclick=()=>{
  const item=photoCurrentItem();if(item)removePhotos([item.key]);
};
const detailStage=document.querySelector('#photoDetailStage');
const photoSurface=detailStage.querySelector('.photoImageSurface');
photoSurface.addEventListener('wheel',e=>{
  e.preventDefault();
  const factor=e.deltaY<0?1.16:1/1.16;
  setPhotoScale(photoViewerScale*factor,e.clientX,e.clientY);
},{passive:false});
photoSurface.addEventListener('dblclick',e=>{e.preventDefault();togglePhotoZoom();});
photoSurface.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  photoViewerTouchStart={x:e.clientX,y:e.clientY,px:photoViewerPanX,py:photoViewerPanY,drag:photoViewerScale>1};
  if(photoViewerScale>1){photoSurface.setPointerCapture(e.pointerId);e.preventDefault();}
});
photoSurface.addEventListener('pointermove',e=>{
 const start=photoViewerTouchStart;
 if(!start||!start.drag)return;
 photoViewerPanX=start.px+e.clientX-start.x;photoViewerPanY=start.py+e.clientY-start.y;
 applyPhotoTransform();
});
photoSurface.addEventListener('pointerup',e=>{
 const start=photoViewerTouchStart;photoViewerTouchStart=null;
 if(!start||start.drag)return;
 const dx=e.clientX-start.x,dy=e.clientY-start.y;
 if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.4)showImageViewer(imageViewerIndex+(dx<0?1:-1));
});
photoSurface.addEventListener('pointercancel',()=>{photoViewerTouchStart=null;});
document.addEventListener('keydown',e=>{
  if(!document.querySelector('#assetView').classList.contains('open')) return;
  if(e.key==='Escape'){
    const activeFilter=document.querySelector('.jfFilterPanel[data-jf-mode="photo"]');
    if(activeFilter&&!activeFilter.hidden)jfCloseFilter('photo');
    else hideImageViewer();
    e.preventDefault();e.stopImmediatePropagation();}
  if(e.key==='ArrowLeft'){showImageViewer(imageViewerIndex-1);e.preventDefault();e.stopImmediatePropagation();}
  if(e.key==='ArrowRight'){showImageViewer(imageViewerIndex+1);e.preventDefault();e.stopImmediatePropagation();}
  if(e.key.toLowerCase()==='i'&&!e.repeat){document.getElementById('photoRailToggle').click();e.preventDefault();e.stopImmediatePropagation();}
  if(e.key==='0'){setPhotoScale(1);e.preventDefault();e.stopImmediatePropagation();}
},true);

const grid =
  document.querySelector(
    '#grid'
  );
const audioControlsRoot = document.querySelector('#audioDock');

// 双击文件列表打开底部常驻播放器；键盘回车也能播放。
grid.addEventListener('dblclick',event=>{
  if(libraryMode==='video' && videoViewMode==='text'){
    const tile=event.target.closest('#grid .videoTextTile[data-key]');
    if(tile && !event.target.closest('button,a,input,textarea,[contenteditable],.stars') && !mediaSelectMode){
      event.preventDefault();event.stopImmediatePropagation();
      openFeed(tile.dataset.key);return;
    }
  }
  if(libraryMode!=='audio'||event.target.closest('[data-delete-asset], [data-rename-audio], .audioRenameEditor'))return;
  const tile=event.target.closest('[data-audio-file-key]');
  if(tile&&!tile.classList.contains('isRenaming'))openAudioDock(tile.dataset.audioFileKey);
});
grid.addEventListener('click',event=>{
  const button=event.target.closest('[data-rename-audio]');
  if (!button || libraryMode!=='audio') return;
  event.stopPropagation();
  beginAudioRename(button.closest('[data-audio-file-key]'));
});
grid.addEventListener('keydown',event=>{
  if(libraryMode!=='audio'||!['Enter',' ','F2'].includes(event.key))return;
  const tile=event.target.closest('[data-audio-file-key]');
  if(!tile||event.target.closest('button,input,.audioRenameEditor')||tile.classList.contains('isRenaming'))return;
  event.preventDefault();
  if(event.key==='F2')beginAudioRename(tile);
  else openAudioDock(tile.dataset.audioFileKey);
});
document.querySelector('#audioDock').addEventListener('click',event=>{
  if(bgmMiniSuppressClick){bgmMiniSuppressClick=false;event.preventDefault();return;}
  const dock=document.querySelector('#audioDock');
  if(event.target.closest('.audioDockClose')){closeAudioDock();return;}
  if(event.target.closest('.audioDockMinimize')){setAudioDockMinimized(true,true);return;}
  if(event.target.closest('.bgmMiniOpen')){setAudioDockMinimized(false,true);return;}
  if(event.target.closest('.bgmMiniPlay')){
    const audio=dock.querySelector('.audioTrack audio');
    if(!audio)return;
    if(audio.paused)playAudioSafely(audio);else audio.pause();
    return;
  }
});

// 音频事件委托：播放、精准跳转、A/B 定点、循环及区间截取。
async function clipAudioTrack(track,audio) {
  const key=track.dataset.audioKey, state=audioABState(key);
  if (!audioValidAB(state,audio.duration)||audioClipJobs.has(key)) return;
  audioClipJobs.add(key); syncAudioTrack(audio);
  const msg=track.querySelector('.audioMessage');
  msg.textContent='正在截取 '+audioClock(state.a)+' – '+audioClock(state.b)+' …';
  try {
    const task=jfStartMediaProgress('截取音频');
    let response;
    try {response=await fetch('/api/clip-audio',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({key,start:state.a,end:state.b,jobId:task.id})});}
    finally {task.done(Boolean(response && response.ok));}
    const result=await response.json();
    if(!response.ok||!result.ok) throw new Error(result.error||'截取失败');
    msg.textContent='已保存到「音频 → 提取的音轨」；原文件保持不变';
    // 载入新素材清单，但不打断仍在播放的 audio DOM。
    await load();
  } catch(error) {msg.textContent='截取失败：'+(error?.message||'未知错误');}
  finally {
    audioClipJobs.delete(key);
    if(track.isConnected)syncAudioTrack(audio);
    // 暂停状态下延迟展示新文件，让“保存成功”提示可见；播放中则等待暂停再刷新。
    if(pendingAudioRender) setTimeout(()=>{
      if(libraryMode==='audio' && pendingAudioRender && audioClipJobs.size===0 &&
        ![...document.querySelectorAll('#audioDock .audioTrack audio')].some(x=>!x.paused)) {
        renderCreatorTags();render();
      }
    },1400);
  }
}
audioControlsRoot.addEventListener('click',event=>{
  const button=event.target.closest('[data-audio-action]'); if(!button)return;
  const track=audioTrackFrom(button),audio=track&&track.querySelector('audio'); if(!audio)return;
  const action=button.dataset.audioAction, state=audioABState(track.dataset.audioKey);
  if(action==='tools'){
    const open=track.classList.toggle('audioToolsExpanded');
    button.setAttribute('aria-pressed',String(open));
    button.title=open?'收起音频工具':'更多音频工具';
    return;
  }
  if (action==='play') {
    if (!audio.paused) {audio.pause();return;}
    document.querySelectorAll('#audioDock .audioTrack audio').forEach(other=>{
      if(other!==audio && !other.paused) other.pause();
    });
    playAudioSafely(audio);return;
  }
  if (action==='speed') {
    const box=track.querySelector('.audioSpeedBox');
    const wasOpen=box.classList.contains('open');
    document.querySelectorAll('.audioSpeedBox.open').forEach(x=>{
      x.classList.remove('open');x.querySelector('.audioSpeed').setAttribute('aria-expanded','false');
    });
    document.querySelectorAll('.audioVolumeBox.open').forEach(x=>x.classList.remove('open'));
    box.classList.toggle('open',!wasOpen);
    button.setAttribute('aria-expanded',String(!wasOpen));
    return;
  }
  if (action==='volume') {
    document.querySelectorAll('.audioSpeedBox.open').forEach(x=>{
      x.classList.remove('open');x.querySelector('.audioSpeed').setAttribute('aria-expanded','false');
    });
    const box=track.querySelector('.audioVolumeBox');
    const wasOpen=box.classList.contains('open');
    document.querySelectorAll('.audioVolumeBox.open').forEach(x=>x.classList.remove('open'));
    box.classList.toggle('open',!wasOpen);return;
  }
  if (action==='loop') {
    audioLoopEnabled=!audioLoopEnabled;
    try{localStorage.setItem(AUDIO_LOOP_STORAGE_KEY,audioLoopEnabled?'on':'off');}catch{}
    resetAllAudioStates();return;
  }
  if (action==='set-a'||action==='set-b') {
    const at=Math.max(0,Number.isFinite(audio.currentTime)?audio.currentTime:0);
    if(action==='set-a')state.a=at; else state.b=at;
    if(!audioValidAB(state,audio.duration))state.enabled=false;
    track.querySelector('.audioMessage').textContent='';syncAudioTrack(audio);return;
  }
  if (action==='ab') {
    if(!audioValidAB(state,audio.duration))return;
    state.enabled=!state.enabled;
    syncAudioTrack(audio);
    if(state.enabled && (audio.currentTime<state.a||audio.currentTime>=state.b)) audio.currentTime=state.a;
    return;
  }
  if(action==='clip'){clipAudioTrack(track,audio);return;}
});
// 原生 audio 的倍速播放，整站统一倍速且跨重启保存。不改变文件或音轨。
audioControlsRoot.addEventListener('click',event=>{
  const choice=event.target.closest('[data-audio-speed]');
  if(!choice)return;
  const rate=Number(choice.dataset.audioSpeed);
  if(!AUDIO_SPEED_OPTIONS.includes(rate))return;
  audioPlaybackRate=rate;
  try {localStorage.setItem(AUDIO_SPEED_STORAGE_KEY,String(rate));} catch {}
  resetAllAudioStates();
  const box=choice.closest('.audioSpeedBox');
  box.classList.remove('open');
  box.querySelector('.audioSpeed').setAttribute('aria-expanded','false');
});
// 点击弹窗以外关闭竖向音量条、倍速菜单（不打断播放）。
document.addEventListener('pointerdown',event=>{
  if(!event.target.closest('.audioVolumeBox')) document.querySelectorAll('.audioVolumeBox.open').forEach(x=>x.classList.remove('open'));
  if(!event.target.closest('.audioSpeedBox')) document.querySelectorAll('.audioSpeedBox.open').forEach(x=>{
    x.classList.remove('open');x.querySelector('.audioSpeed').setAttribute('aria-expanded','false');
  });
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  document.querySelectorAll('.audioSpeedBox.open').forEach(x=>{
    x.classList.remove('open');x.querySelector('.audioSpeed').setAttribute('aria-expanded','false');
  });
});
audioControlsRoot.addEventListener('input',event=>{
  const input=event.target;
  const track=audioTrackFrom(input),audio=track&&track.querySelector('audio');if(!audio)return;
  if(input.classList.contains('audioSeek')) {
    if(Number.isFinite(audio.duration)&&audio.duration>0) {
      audio.currentTime=Math.min(audio.duration,Math.max(0,Number(input.value)));
      input.style.setProperty('--audio-progress',(audio.currentTime/audio.duration*100)+'%');
      track.querySelector('.audioTimeCurrent').textContent=audioClock(audio.currentTime);
    }
  }
  if(input.classList.contains('audioVolume')) {
    audio.volume=Number(input.value)/100;audio.muted=false;
    try{localStorage.setItem(BGM_VOLUME_KEY,String(audio.volume));}catch{}
    syncAudioTrack(audio);
  }
});
audioControlsRoot.addEventListener('pointerdown',event=>{if(event.target.classList.contains('audioSeek'))event.target.dataset.dragging='1';});
for(const name of ['pointerup','pointercancel','change']) {
  audioControlsRoot.addEventListener(name,event=>{
    if(event.target.classList.contains('audioSeek')){
      delete event.target.dataset.dragging;
      const audio=audioTrackFrom(event.target)?.querySelector('audio');
      if(audio)syncAudioTrack(audio);
    }
  });
}
// 对短片段 A/B 使用 40ms 精度监视；timeupdate 为备用，页面后台播放仍允许循环。
setInterval(()=>{
  document.querySelectorAll('#audioDock .audioTrack audio').forEach(audio=>{
    if(audio.paused||!Number.isFinite(audio.duration))return;
    const state=audioABState(audioTrackFrom(audio).dataset.audioKey);
    if(state.enabled && audioValidAB(state,audio.duration) && audio.currentTime>=state.b-0.018){
      audio.currentTime=state.a;
    }
  });
},40);

// 浏览器原生 range 键盘步进 0.01s，这里提高为更易用的 0.05s；Shift+方向键 1s。
audioControlsRoot.addEventListener('keydown',event=>{
  if(!event.target.classList.contains('audioSeek')||!['ArrowLeft','ArrowRight'].includes(event.key))return;
  const audio=audioTrackFrom(event.target)?.querySelector('audio');
  if(!audio||!Number.isFinite(audio.duration))return;
  event.preventDefault();
  const step=event.shiftKey?1:0.05;
  audio.currentTime=Math.max(0,Math.min(audio.duration,audio.currentTime+(event.key==='ArrowRight'?step:-step)));
  syncAudioTrack(audio);
});
// media events do not bubble: capture required.
for(const eventName of ['loadedmetadata','durationchange','timeupdate','play','pause','ended','volumechange','error','waiting']) {
  audioControlsRoot.addEventListener(eventName,event=>{
    const audio=event.target;
    if(!(audio instanceof HTMLAudioElement)||!audio.closest('.audioTrack'))return;
    const track=audioTrackFrom(audio),state=audioABState(track.dataset.audioKey);
    if(eventName==='play') {
      document.querySelectorAll('#audioDock .audioTrack audio').forEach(other=>{
        if(other!==audio&&!other.paused)other.pause();
      });
    }
    if(eventName==='timeupdate' && state.enabled && audioValidAB(state,audio.duration) &&
      audio.currentTime>=state.b-0.025) {
      audio.currentTime=state.a;
    }
    if(eventName==='ended' && state.enabled && audioValidAB(state,audio.duration)) {
      audio.currentTime=state.a;playAudioSafely(audio);
    }
    if(eventName==='error') {
      track.querySelector('.audioMessage').textContent='无法加载此音频：请确认文件完整，且浏览器支持对应编码';
    }
    syncAudioTrack(audio);
    if ((eventName==='pause'||eventName==='ended') && pendingAudioRender) {
      setTimeout(()=>{
        if(libraryMode==='audio' && pendingAudioRender && audioClipJobs.size===0 &&
          ![...document.querySelectorAll('#audioDock .audioTrack audio')].some(x=>!x.paused)) {
          renderCreatorTags();render();
        }
      },200);
    }
  },true);
}

// v6.21: cover preview after 1s of deliberate hover. Never touch the actual
// feed video's src, playback rate, volume, or active video guard.
let jfHoverTimer=null,jfHoverItem=null,jfHoverVideo=null,jfHoverToken=0;
function jfStopHoverPreview(){
  clearTimeout(jfHoverTimer);jfHoverTimer=null;jfHoverToken++;
  if(jfHoverItem)jfHoverItem.classList.remove('previewLoading');
  if(jfHoverVideo){try{jfHoverVideo.pause();jfHoverVideo.removeAttribute('src');jfHoverVideo.load();}catch{} jfHoverVideo.remove();}
  jfHoverItem=null;jfHoverVideo=null;
}
grid.addEventListener('pointerover',event=>{
  if(event.pointerType==='touch' || libraryMode!=='video' || videoViewMode!=='cover' || document.querySelector('.feedOverlay.open'))return;
  const cover=event.target.closest('#grid .jfCoverTile .coverWrap[data-feed-key]');
  if(!cover || cover===jfHoverItem)return;
  jfStopHoverPreview();
  const key=cover.dataset.feedKey,item=allItems.find(x=>x.key===key);
  if(!item || !item.mediaUrl)return;
  const token=jfHoverToken;jfHoverItem=cover;
  jfHoverTimer=setTimeout(async()=>{
    if(token!==jfHoverToken || !cover.isConnected || !cover.matches(':hover') || libraryMode!=='video' || document.querySelector('.feedOverlay.open'))return;
    const video=document.createElement('video');
    video.className='jfHoverPreview';video.muted=true;video.defaultMuted=true;
    video.setAttribute('muted','');video.playsInline=true;video.setAttribute('playsinline','');
    video.preload='auto';video.controls=false;video.loop=true;video.disablePictureInPicture=true;
    jfHoverVideo=video;cover.classList.add('previewLoading');
    const playFromCover=async()=>{
      if(token!==jfHoverToken || !cover.isConnected)return;
      try{await video.play();}
      catch{if(token===jfHoverToken)jfStopHoverPreview();}
    };
    video.addEventListener('loadedmetadata',()=>{
      if(token!==jfHoverToken)return;
      const end=Number.isFinite(video.duration)?Math.max(0,video.duration-.25):0;
      const at=Math.max(0,Math.min(Number(item.coverTime)||0,end));
      if(at>0.1){
        video.addEventListener('seeked',playFromCover,{once:true});
        try{video.currentTime=at;}catch{playFromCover();}
      } else playFromCover();
    },{once:true});
    video.addEventListener('playing',()=>cover.classList.remove('previewLoading'),{once:true});
    video.addEventListener('error',()=>jfStopHoverPreview(),{once:true});
    cover.insertBefore(video,cover.querySelector('.badges'));
    video.src=item.mediaUrl;
    video.load();
  },1000);
});
grid.addEventListener('pointerout',event=>{
  const cover=event.target.closest('#grid .jfCoverTile .coverWrap');
  if(cover && cover===jfHoverItem && !cover.contains(event.relatedTarget))jfStopHoverPreview();
});
new MutationObserver(()=>{if(jfHoverItem && !jfHoverItem.isConnected)jfStopHoverPreview();}).observe(grid,{childList:true});
window.addEventListener('blur',jfStopHoverPreview);
document.addEventListener('visibilitychange',()=>{if(document.hidden)jfStopHoverPreview();});
// capture every possible main-player entry: no preview remains playing behind it.
grid.addEventListener('click',e=>{if(e.target.closest('[data-feed-key]'))jfStopHoverPreview();},true);
grid.addEventListener(
  'click',
  event => {
    if (libraryMode !== 'video') {
      const folder = event.target.closest('[data-open-folder]');
      if (folder) {rememberMediaFolder(folder.dataset.openFolder);setUnifiedSelectMode(false);render();return;}
      const image = event.target.closest('[data-picture-index]');
      if(image){
        const index=Number(image.dataset.pictureIndex);
        if(libraryMode==='image'&&photoSelectMode){
          const item=imageViewerList[index];
          if(item){toggleUnifiedSelection(item.key);syncPhotoSelectionUI();}
        }else{showImageViewer(index);}
        return;
      }
      const del = event.target.closest('[data-delete-asset]');
      if(del){deleteAsset(del.dataset.deleteAsset);return;}
      return;
    }
    const creatorLinkEdit = event.target.closest('.creatorLinkCardEdit');
    if (creatorLinkEdit) {
      event.preventDefault();
      event.stopPropagation();
      editCreatorLink(creatorLinkEdit.dataset.creator || '');
      return;
    }

    const creatorEdit =
      event.target.closest(
        '.creatorEditBtn'
      );

    if (creatorEdit) {
      event.preventDefault();
      event.stopPropagation();

      const card =
        creatorEdit.closest(
          '.card'
        );

      const creator =
        card &&
        card.querySelector(
          '.creatorText'
        );

      if (creator) {
        beginTextEdit(
          creator,
          'creator'
        );
      }

      return;
    }

    const cover =
      event.target.closest(
        '.coverWrap[data-feed-key]'
      );

    if (!cover) {
      return;
    }
    // v6.18: the cover also contains interactive metadata, which must not open playback.
    if (event.target.closest('.jfCoverInfo .stars, .jfCoverInfo .iconActions, .jfCoverInfo .creatorRow, .jfCoverInfo .titleText, button, a, input, [contenteditable]')) return;

    openFeed(
      cover.dataset.feedKey
    );
  }
);

grid.addEventListener(
  'dblclick',
  event => {
    const creator =
      event.target.closest(
        '.creatorText'
      );

    if (creator) {
      beginTextEdit(
        creator,
        'creator'
      );
      return;
    }

    const title =
      event.target.closest(
        '.titleText'
      );

      if (title) openUnifiedRename(title.dataset.key);
  }
);

grid.addEventListener(
  'pointerdown',
  event => {
    const stars =
      event.target.closest(
        '.stars'
      );

    if (stars) {
      startRating(
        event,
        stars
      );
      return;
    }

    const magnifyBtn =
      event.target.closest(
        '.magnifyBtn'
      );

    if (magnifyBtn) {
      event.preventDefault();
      event.stopPropagation();

      const key =
        magnifyBtn.dataset.key;

      openFeed(
        key
      );

      setTimeout(
        () => {
          const video =
            getCurrentFeedVideo();

          if (!video) {
            return;
          }

          const enabled =
            setFocusZoomEnabled(
              video,
              true
            );

          const feedButton =
            document.querySelector(
              '#feedMagnify'
            );

          if (feedButton) {
            feedButton.classList.toggle(
              'active',
              enabled
            );

            feedButton.title =
              enabled
                ? '关闭宽屏聚焦'
                : '宽屏聚焦';
          }
        },
        60
      );

      return;
    }

    const rotateBtn =
      event.target.closest(
        '.rotateBtn'
      );

    if (rotateBtn) {
      event.preventDefault();
      event.stopPropagation();

      rotateItem(
        rotateBtn.dataset.key
      );

      return;
    }

    const multiBtn =
      event.target.closest(
        '.multiBtn'
      );

    if (multiBtn) {
      event.preventDefault();
      event.stopPropagation();

      openMulti(
        multiBtn.dataset.key
      );

      return;
    }

    const deleteBtn =
      event.target.closest(
        '.deleteBtn'
      );

    if (deleteBtn) {
      event.preventDefault();
      armDelete(
        deleteBtn
      );
    }
  }
);

grid.addEventListener(
  'pointermove',
  moveRating
);

grid.addEventListener(
  'pointerup',
  endRating
);

grid.addEventListener(
  'input',
  event => {
    const range =
      event.target.closest(
        '.coverRange'
      );

    if (!range) {
      return;
    }

    const seek =
      range.closest(
        '.coverSeek'
      );

    const label =
      seek &&
      seek.querySelector(
        '.coverTime'
      );

    if (label) {
      label.textContent =
        formatTime(
          Number(
            range.value
          )
        );
    }

    queueCover(
      range
    );
  }
);

document
  .querySelector(
    '#search'
  )
  .addEventListener(
    'input',
    render
  );

document
  .querySelector(
    '#creatorToggle'
  )
  .addEventListener(
    'click',
    () => {
      creatorOpen =
        !creatorOpen;

      document
        .querySelector(
          '#creatorPanel'
        )
        .classList.toggle(
          'collapsed',
          !creatorOpen
        );

      renderCreatorTags();
    }
  );

function updateSortButtons() {
  const ratingButton =
    document.querySelector(
      '#sortRatingBtn'
    );

  const mtimeButton =
    document.querySelector(
      '#sortMtimeBtn'
    );

  const arrow =
    sortDirection === 'desc'
      ? '↓'
      : '↑';

  ratingButton.classList.toggle(
    'active',
    sortMode === 'rating'
  );

  mtimeButton.classList.toggle(
    'active',
    sortMode === 'mtime'
  );

  ratingButton.textContent =
    '评分 ' +
    (sortMode === 'rating'
      ? arrow
      : '');

  mtimeButton.textContent =
    '修改时间 ' +
    (sortMode === 'mtime'
      ? arrow
      : '');
}

function selectSortMode(mode) {
  if (sortMode === mode) {
    sortDirection =
      sortDirection === 'desc'
        ? 'asc'
        : 'desc';
  } else {
    sortMode = mode;
    // 切换排序字段时默认把评分最高 / 文件最新的放前面。
    sortDirection = 'desc';
  }

  updateSortButtons();
  render();
}

document
  .querySelector(
    '#sortRatingBtn'
  )
  .addEventListener(
    'click',
    () => {
      selectSortMode(
        'rating'
      );
    }
  );

document
  .querySelector(
    '#sortMtimeBtn'
  )
  .addEventListener(
    'click',
    () => {
      selectSortMode(
        'mtime'
      );
    }
  );

const feedScrollerElement =
  document.querySelector(
    '#feedScroller'
  );

if (feedScrollerElement) {
  feedScrollerElement.addEventListener(
    'pointerdown',
    event => {
      if (
        fullscreenVideoElement()
      ) {
        return;
      }

      const stars =
        event.target.closest(
          '.feedRating'
        );

      if (!stars) {
        return;
      }

      event.stopPropagation();

      startRating(
        event,
        stars
      );
    }
  );

  feedScrollerElement.addEventListener(
    'pointermove',
    moveRating
  );

  feedScrollerElement.addEventListener(
    'pointerup',
    endRating
  );
}

// 普通 Feed 的触屏滑动只在抬手时切换一次，不交由浏览器惯性滚动。
const feedTouchGesture = { pointerId:null, x:0, y:0 };
const feedTouchScroller = document.querySelector('#feedScroller');
if (feedTouchScroller) {
  feedTouchScroller.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (fullscreenVideoElement() || document.querySelector('.shotStudioBack, .portraitDialogBack')) return;
    if (event.target.closest('button, input, select, textarea, .feedRating')) return;
    const video = event.target.closest('video');
    if (video && (video.getBoundingClientRect().bottom - event.clientY) < 90) return;
    if (video && focusZoomStates.get(video)?.enabled) return;
    feedTouchGesture.pointerId = event.pointerId;
    feedTouchGesture.x = event.clientX;
    feedTouchGesture.y = event.clientY;
  }, { passive:true });
  feedTouchScroller.addEventListener('pointerup', event => {
    if (feedTouchGesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - feedTouchGesture.x;
    const dy = event.clientY - feedTouchGesture.y;
    feedTouchGesture.pointerId = null;
    if (Math.abs(dy) < 65 || Math.abs(dy) < Math.abs(dx) * 1.25) return;
    stepFeed(dy < 0 ? 1 : -1);
  });
  feedTouchScroller.addEventListener('pointercancel', () => {
    feedTouchGesture.pointerId = null;
  });
}

const feedOverlayElement =
  document.querySelector(
    '#feedOverlay'
  );

if (feedOverlayElement) {
  const wakeImmersiveChrome =
    () => {
      if (
        !currentFeedFocusEnabled()
      ) {
        return;
      }

      showImmersiveChrome();

      scheduleImmersiveChromeHide();
    };

  feedOverlayElement.addEventListener(
    'pointermove',
    wakeImmersiveChrome,
    {
      passive:true
    }
  );

  feedOverlayElement.addEventListener(
    'pointerdown',
    wakeImmersiveChrome,
    {
      passive:true
    }
  );

  feedOverlayElement.addEventListener(
    'wheel',
    () => {
      if (
        currentFeedFocusEnabled()
      ) {
        showImmersiveChrome();

        scheduleImmersiveChromeHide();
      }
    },
    {
      passive:true
    }
  );
}

document
  .querySelector(
    '#feedClose'
  )
  .addEventListener(
    'click',
    closeFeed
  );

document
  .querySelector(
    '#feedSetA'
  )
  .addEventListener(
    'click',
    () => {
      const item =
        getCurrentFeedItem();

      const video =
        getCurrentFeedVideo();

      if (
        !item ||
        item.kind !== 'video' ||
        !video
      ) {
        return;
      }

      const state =
        getFeedABState(
          item.key
        );

      if (state.auto) { state.b = NaN; state.enabled = false; video.loop = true; }
      state.manual = true;
      state.auto = false;
      state.a =
        Number(
          video.currentTime || 0
        );

      if (
        Number.isFinite(
          state.b
        ) &&
        state.b <=
          state.a
      ) {
        state.b =
          NaN;

        state.enabled =
          false;

        video.loop =
          true;
      }

      updateFeedABUi();
    }
  );

document
  .querySelector(
    '#feedSetB'
  )
  .addEventListener(
    'click',
    () => {
      const item =
        getCurrentFeedItem();

      const video =
        getCurrentFeedVideo();

      if (
        !item ||
        item.kind !== 'video' ||
        !video
      ) {
        return;
      }

      const state =
        getFeedABState(
          item.key
        );

      state.manual = true;
      state.auto = false;
      state.b =
        Number(
          video.currentTime || 0
        );

      if (
        Number.isFinite(
          state.a
        ) &&
        state.b <=
          state.a
      ) {
        state.enabled =
          false;

        video.loop =
          true;
      }

      updateFeedABUi();
    }
  );


async function toggleGhostPlayback() {
  const item=getCurrentFeedItem(),video=getCurrentFeedVideo();
  if(!item || item.kind!=='video' || !video || ghostPreparing)return;
  if(ghostPlayback && ghostPlayback.key===item.key){stopGhostPlayback(true);return;}
  if(ghostPlayback)stopGhostPlayback(true);
  const ab=getFeedABState(item.key);
  const total=Number(item.duration||video.duration||0);
  const segment=validABState(ab)?{a:ab.a,b:ab.b}:{a:0,b:total};
  if(!segment.b || segment.b-segment.a>20.01){alert('鬼畜循环仅支持 20 秒以内的视频或 A/B 区间，请先标记较短的 A/B 片段。');return;}
  const requestGeneration=++ghostRequestGeneration;
  ghostPreparing=true;updateFeedABUi();
  try{
    const result=await fetch('/api/ghost-loop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:item.key,...segment})}).then(r=>r.json());
    if(requestGeneration!==ghostRequestGeneration || currentFeedKey!==item.key ||
       !video.isConnected || !document.querySelector('#feedOverlay').classList.contains('open'))return;
    if(!result.ok)throw new Error(result.error||'生成失败');
    const playing=!video.paused;
    const originalSrc=item.mediaUrl;
    // Ghost video already contains normal-direction audio in both halves.
    ab.enabled=false;
    video.pause();
    video.dataset.ghostMode='1';
    video.src=result.url;
    video.loop=true;
    video.load();
    ghostPlayback={key:item.key,video,originalSrc,a:segment.a,b:segment.b};
    if(playing)await video.play();
  }catch(error){if(requestGeneration===ghostRequestGeneration)alert('鬼畜循环不可用：'+error.message);}
  finally{if(requestGeneration===ghostRequestGeneration){ghostPreparing=false;updateFeedABUi();}}
}
function stopGhostPlayback(restore) {
  const old=ghostPlayback;
  ghostPlayback=null;
  if(!old)return;
  const video=old.video;
  if(!video)return;
  if(!restore){
    video.pause();
    delete video.dataset.ghostMode;
    video.src=old.originalSrc;
    video.loop=true;
    video.dataset.loaded='1';
    video.load();
    return;
  }
  const playing=!video.paused;
  const length=old.b-old.a;
  const pos=Number(video.currentTime)||0;
  const phase=length>0?pos%(2*length):0;
  const desired=phase<=length?old.a+phase:old.b-(phase-length);
  video.pause();
  delete video.dataset.ghostMode;
  video.src=old.originalSrc;
  video.loop=true;
  video.load();
  video.addEventListener('loadedmetadata',function once(){
    video.removeEventListener('loadedmetadata',once);
    try{video.currentTime=Math.max(0,Math.min(desired,video.duration||desired));}catch{}
    if(playing && currentFeedKey===old.key)video.play().catch(()=>{});
  });
  updateFeedABUi();
}
document.querySelector('#feedGhostLoop').addEventListener('click',toggleGhostPlayback);
// Any other editing action leaves ghost mode to keep original-file time coordinates correct.
document.querySelector('#feedToolPanel')?.addEventListener('click',event=>{
  if(ghostPlayback && event.target.closest('button')?.id!=='feedGhostLoop'){
    stopGhostPlayback(true);
    event.preventDefault();
    event.stopImmediatePropagation();
    if(typeof unifiedToast==='function')unifiedToast('已退出鬼畜模式，请再次操作');
  }
},true);

document
  .querySelector(
    '#feedABLoop'
  )
  .addEventListener(
    'click',
    () => {
      const item =
        getCurrentFeedItem();

      const video =
        getCurrentFeedVideo();

      if (
        !item ||
        item.kind !== 'video' ||
        !video
      ) {
        return;
      }

      const state =
        getFeedABState(
          item.key
        );

      if (
        !validABState(
          state
        )
      ) {
        alert(
          '请先设置有效的 A、B 时间点，且 B 必须晚于 A。'
        );

        return;
      }

      state.manual = true;
      state.auto = false;
      state.enabled =
        !state.enabled;

      video.loop =
        !state.enabled;

      if (state.enabled) {
        if (
          video.currentTime <
            state.a ||
          video.currentTime >=
            state.b
        ) {
          video.currentTime =
            state.a;
        }

        video
          .play()
          .catch(
            () => {}
          );
      }

      updateFeedABUi();
    }
  );

document.getElementById('feedABQuickActions').addEventListener('click', event=>{
  if(!event.target.closest('button') || !ghostPlayback)return;
  stopGhostPlayback(true);
  event.preventDefault();
  event.stopImmediatePropagation();
  if(typeof unifiedToast==='function')unifiedToast('已退出鬼畜模式，请再次操作');
},true);
document
  .querySelector(
    '#feedClip'
  )
  .addEventListener(
    'click',
    clipCurrentFeedAB
  );

// 虚拟片段库管理：操作记录不做 FFmpeg 任务，只有“导出 MP4”调用转换。
let clipShelfRecords=[];
let clipShelfContext=null;
let clipShelfDraft=null;
let clipShelfPlayingBefore=null;
let clipShelfRequestBusy=false;
function clipTime(seconds) {
  const val=Math.max(0,Number(seconds)||0);
  const m=Math.floor(val/60);
  return m+':'+String(Math.floor(val%60)).padStart(2,'0')+'.'+String(Math.round((val%1)*1000)).padStart(3,'0');
}
function clipReadTime(value) {
  const parts=String(value||'').trim().split(':');
  if(parts.length>3||parts.some(x=>!x.trim()||!/^\\d+(?:\\.\\d+)?$/.test(x.trim())))return NaN;
  let result=0;
  for(const part of parts)result=result*60+Number(part);
  return result;
}
function clipShelfVisible(){const el=document.querySelector('#clipShelfBack');return el&&!el.hidden;}
async function clipShelfFetch(){
  const r=await fetch('/api/clips',{cache:'no-store'});
  const data=await r.json();
  if(!r.ok||!data.ok)throw new Error(data.error||'加载片段失败');
  clipShelfRecords=Array.isArray(data.clips)?data.clips:[];
}
async function clipShelfPost(body,url='/api/clips') {
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();
  if(!r.ok||!data.ok)throw new Error(data.error||'片段操作失败');
  return data;
}
function clipShelfToast(message,error=false){
 const node=document.querySelector('#clipShelfToast');if(!node)return;
 node.textContent=message;node.style.color=error?'#ffafb7':'#b8e6c2';
}
function clipShelfRender(){
  const root=document.querySelector('#clipShelfList');if(!root)return;
  const query=document.querySelector('#clipShelfSearch').value.trim().toLowerCase();
  const only=document.querySelector('#clipShelfOnly').checked;
  const favOnly=document.querySelector('#clipShelfFavOnly').checked;
  const current=clipShelfContext&&clipShelfContext.sourceKey;
  const entries=clipShelfRecords.filter(clip=>(!only||clip.sourceKey===current)&&(!favOnly||clip.favorite)&&(!query||(clip.name+' '+clip.sourceTitle).toLowerCase().includes(query)))
    .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  root.innerHTML=entries.length?entries.map(clip=>{
    const duration=(clip.b-clip.a).toFixed(2);
    const source=allItems.find(item=>item.key===clip.sourceKey);
    const poster=source&&source.cover?source.cover:'';
    const posterHTML='<div class="clipShelfPoster" aria-hidden="true">'+(poster?'<img loading="lazy" alt="" src="'+esc(poster)+'">':'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>')+'</div>';
    return '<article class="clipShelfRow'+(clip.sourceAvailable?'':' missing')+'" data-clip-id="'+esc(clip.id)+'">'+
      posterHTML+'<div><div class="clipShelfRowTitle">'+esc(clip.name)+'</div>'+ 
      '<div class="clipShelfRowInfo" title="'+esc(clip.sourceTitle)+'">'+esc(clipTime(clip.a))+' — '+esc(clipTime(clip.b))+' <span class="clipShelfDuration">· '+duration+'s</span>'+(clip.sourceAvailable?'':' · 源文件丢失')+'</div></div>'+ 
      '<div class="clipShelfRowActions">'+
      '<button data-clip-action="export" title="保存为独立 MP4"'+(clip.sourceAvailable?'':' disabled')+'>保存</button>'+
      '<button data-clip-action="delete" class="warn">删除</button></div></article>';
  }).join(''):'<div class="clipShelfEmpty">没有匹配的片段。播放视频并设置 A/B 点后，可以保存到这里。</div>';
  const addBtn=document.querySelector('#clipShelfNew');
  if(addBtn)addBtn.disabled=!(current&&clipShelfContext&&validABState(clipShelfContext.state));
}
function clipShelfBeginForm(clip) {
  if(clip) {
    clipShelfDraft={mode:'edit',id:clip.id,sourceKey:clip.sourceKey};
  } else {
    const ctx=clipShelfContext;
    if(!ctx||!validABState(ctx.state)){alert('请先在视频播放器设置 A、B 时间点。');return;}
    clipShelfDraft={mode:'create',sourceKey:ctx.sourceKey};
  }
  const source=allItems.find(x=>x.key===clipShelfDraft.sourceKey);
  document.querySelector('#clipShelfFormTip').textContent=(clip?'编辑已保存的片段：':'新建片段（不会生成视频文件）：')+(source?source.title:(clip?clip.sourceTitle:'当前视频'));
  document.querySelector('#clipShelfName').value=clip?clip.name:((source&&source.title)||'视频')+' · '+clipTime(clipShelfContext.state.a)+'–'+clipTime(clipShelfContext.state.b);
  document.querySelector('#clipShelfA').value=clip?clipTime(clip.a):clipTime(clipShelfContext.state.a);
  document.querySelector('#clipShelfB').value=clip?clipTime(clip.b):clipTime(clipShelfContext.state.b);
  document.querySelector('#clipShelfFav').checked=!!(clip&&clip.favorite);
  clipShelfToast('');
  document.querySelector('#clipShelfForm').hidden=false;
  document.querySelector('#clipShelfName').focus();
  document.querySelector('#clipShelfForm').scrollIntoView({block:'nearest'});
}
function clipShelfCancelForm(){clipShelfDraft=null;document.querySelector('#clipShelfForm').hidden=true;clipShelfToast('');}
async function openClipShelf(context=null){
  clipShelfContext=context||null;
  clipShelfCancelForm();
  const back=document.querySelector('#clipShelfBack');
  back.hidden=false;
  document.querySelector('#clipShelfSearch').value='';
  document.querySelector('#clipShelfOnly').checked=false;
  document.querySelector('#clipShelfFavOnly').checked=false;
  clipShelfPlayingBefore=context&&context.video&&!context.video.paused?context.video:null;
  if(clipShelfPlayingBefore)clipShelfPlayingBefore.pause();
  try{await clipShelfFetch();clipShelfRender();}catch(error){clipShelfToast(error.message,true);document.querySelector('#clipShelfList').textContent=error.message;}
}
function closeClipShelf(resume=true){
  if(!clipShelfVisible())return;
  document.querySelector('#clipShelfBack').hidden=true;
  clipShelfCancelForm();
  if(resume&&clipShelfPlayingBefore&&clipShelfPlayingBefore.isConnected)clipShelfPlayingBefore.play().catch(()=>{});
  clipShelfPlayingBefore=null;
  clipShelfContext=null;
}
function clipShelfPlay(clip){
  if(!clip.sourceAvailable)return;
  closeClipShelf(false);
  if(document.querySelector('#feedOverlay').classList.contains('open'))closeFeed();
  if (libraryMode !== 'video') changeMediaCategory('video');
  // 当前可能按搜索词筛选，确保片段所属源文件总能被定位。
  currentRenderedItems=allItems.filter(x=>x.kind==='video');
  openFeed(clip.sourceKey);
  const state=getFeedABState(clip.sourceKey);
  state.a=Number(clip.a);state.b=Number(clip.b);state.enabled=true;
  state.auto=false;state.manual=true;
  updateFeedABUi();
  const video=getCurrentFeedVideo();
  if(video){
    let applied=false;
    const seek=()=>{
      if(applied)return;
      applied=true;
      try{video.currentTime=clip.a;}catch{}
      video.loop=false;
      video.play().catch(()=>{});
      updateFeedABUi();
    };
    if(video.readyState>=1)seek();else video.addEventListener('loadedmetadata',seek,{once:true});
  }
}
async function clipShelfDispatch(event){
  const button=event.target.closest('button[data-clip-action]');if(!button||clipShelfRequestBusy)return;
  const row=button.closest('[data-clip-id]');
  const clip=clipShelfRecords.find(x=>x.id===row.dataset.clipId);if(!clip)return;
  const action=button.dataset.clipAction;
  if(action==='play'){clipShelfPlay(clip);return;}
  if(action==='edit'){clipShelfBeginForm(clip);return;}
  if(action==='delete'&&!confirm('只删除片段「'+clip.name+'」的记录？原视频及已导出的 MP4 均保留。'))return;
  clipShelfRequestBusy=true;button.disabled=true;
  try{
    if(action==='export'){
      const task=jfStartMediaProgress('导出片段');
      let result;
      try {result=await clipShelfPost({id:clip.id,jobId:task.id},'/api/clips/export');}
      finally {task.done(Boolean(result));}
      if(result.item&&!allItems.some(x=>x.key===result.item.key))allItems.push(result.item);
      renderCreatorTags();render();
      unifiedToast('片段已保存');
      button.textContent='已保存';
      setTimeout(()=>{if(button.isConnected)button.textContent='保存';},1600);
    }else {
      await clipShelfPost(action==='favorite'?{action:'update',id:clip.id,favorite:!clip.favorite}:{action:'delete',id:clip.id});
      await clipShelfFetch();clipShelfRender();
    }
  }catch(error){alert(error.message||'操作失败');}finally{clipShelfRequestBusy=false;button.disabled=false;}
}
function initClipShelf(){
  document.querySelector('#clipShelfTop').addEventListener('click',()=>openClipShelf());
  document.querySelector('#feedClipShelf').addEventListener('click',()=>{
    const item=getCurrentFeedItem();if(!item||item.kind!=='video')return;
    openClipShelf({sourceKey:item.key,state:getFeedABState(item.key),video:getCurrentFeedVideo()});
  });
  document.querySelector('#clipShelfList').addEventListener('dblclick',event=>{
    if(event.target.closest('button,input,a'))return;
    const row=event.target.closest('[data-clip-id]');
    const clip=row&&clipShelfRecords.find(x=>x.id===row.dataset.clipId);
    if(clip&&clip.sourceAvailable)clipShelfPlay(clip);
  });
  document.querySelector('#clipShelfClose').addEventListener('click',()=>closeClipShelf());
  document.querySelector('#clipShelfBack').addEventListener('click',e=>{if(e.target.id==='clipShelfBack')closeClipShelf();});
  document.querySelector('#clipShelfSearch').addEventListener('input',clipShelfRender);
  document.querySelector('#clipShelfOnly').addEventListener('change',clipShelfRender);
  document.querySelector('#clipShelfFavOnly').addEventListener('change',clipShelfRender);
  document.querySelector('#clipShelfNew').addEventListener('click',()=>clipShelfBeginForm(null));
  document.querySelector('#clipShelfCancelEdit').addEventListener('click',clipShelfCancelForm);
  document.querySelector('#clipShelfList').addEventListener('click',clipShelfDispatch);
  document.querySelector('#clipShelfForm').addEventListener('submit',async event=>{
    event.preventDefault();if(!clipShelfDraft||clipShelfRequestBusy)return;
    const a=clipReadTime(document.querySelector('#clipShelfA').value);
    const b=clipReadTime(document.querySelector('#clipShelfB').value);
    const name=document.querySelector('#clipShelfName').value.trim();
    if(!Number.isFinite(a)||!Number.isFinite(b)||b-a<.06){clipShelfToast('请检查 A、B 时间，B 必须晚于 A。',true);return;}
    clipShelfRequestBusy=true;
    const submit=document.querySelector('#clipShelfSubmit');submit.disabled=true;
    try{
      const body=clipShelfDraft.mode==='create'?{action:'create',sourceKey:clipShelfDraft.sourceKey,name,a,b,favorite:document.querySelector('#clipShelfFav').checked}:
        {action:'update',id:clipShelfDraft.id,name,a,b,favorite:document.querySelector('#clipShelfFav').checked};
      await clipShelfPost(body);
      await clipShelfFetch();
      clipShelfCancelForm();clipShelfRender();
    }catch(error){clipShelfToast(error.message||'保存失败',true);}finally{clipShelfRequestBusy=false;submit.disabled=false;}
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&clipShelfVisible()){event.stopImmediatePropagation();event.preventDefault();closeClipShelf();}
  },true);
}
initClipShelf();

document.querySelector('#feedScreenshot').addEventListener('click',()=>performVideoAction('shot'));
document.querySelector('#feedAudio').addEventListener('click',()=>performVideoAction('audio'));

document.querySelector('#feedPortrait').addEventListener('click', () => {
  if (currentFeedKey) {
    makePortraitVideo(currentFeedKey, document.querySelector('#feedPortrait'), getCurrentFeedVideo());
  }
});

document
  .querySelector(
    '#feedMagnify'
  )
  .addEventListener(
    'click',
    () => {
      const video =
        getCurrentFeedVideo();

      const button =
        document.querySelector(
          '#feedMagnify'
        );

      if (
        !video ||
        !button
      ) {
        return;
      }

      const enabled =
        toggleFocusZoom(
          video
        );

      button.classList.toggle(
        'active',
        enabled
      );

      button.title =
        enabled
          ? '关闭宽屏聚焦'
          : '宽屏聚焦';
      button.setAttribute('aria-pressed',String(enabled));
      button.setAttribute('aria-label',button.title);
    }
  );

document
  .querySelector(
    '#feedDelete'
  )
  .addEventListener(
    'click',
    armFeedDelete
  );

document
  .querySelector(
    '#feedRotate'
  )
  .addEventListener(
    'click',
    () => {
      if (!currentFeedKey) {
        return;
      }

      const item =
        allItems.find(
          x => x.key === currentFeedKey
        );

      if (!item || item.kind !== 'video') {
        return;
      }

      rotateItem(currentFeedKey);
    }
  );

document
  .querySelector(
    '#feedMulti'
  )
  .addEventListener(
    'click',
    () => {
      if (
        currentFeedKey
      ) {
        openMulti(
          currentFeedKey
        );
      }
    }
  );

// 以滚轮/触控板「整次手势」为单位限跳，而不是固定 430ms 后解锁。
// 惯性尾部通常持续多个事件；每收到一个事件都重新计时，
// 直到真的停下来才允许下一次切换。
const FEED_WHEEL_IDLE_MS = 340;
const FEED_WHEEL_MIN_DELTA = 30;
let feedWheelGestureTriggered = false;
let feedWheelGestureDistance = 0;
let feedWheelUnlockTimer = null;

function resetFeedWheelGesture() {
  clearTimeout(feedWheelUnlockTimer);
  feedWheelUnlockTimer = null;
  feedWheelGestureTriggered = false;
  feedWheelGestureDistance = 0;
}

function navigateByWheel(event) {
  // 包括小于 8px 的惯性尾部也要拦截，不能回退给浏览器原生滚动。
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();

  if (!document.querySelector('#feedOverlay').classList.contains('open')) {
    return;
  }
  if (document.querySelector('.shotStudioBack, .portraitDialogBack')) {
    return;
  }

  const wasIdle = feedWheelUnlockTimer === null;
  clearTimeout(feedWheelUnlockTimer);
  feedWheelUnlockTimer = setTimeout(resetFeedWheelGesture, FEED_WHEEL_IDLE_MS);
  if (wasIdle) {
    feedWheelGestureTriggered = false;
    feedWheelGestureDistance = 0;
  }
  if (feedWheelGestureTriggered) return;

  // 触控板使用像素滚动；传统鼠标滚轮可以使用行/页单位。
  const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
  const dy = Number(event.deltaY || 0) * factor;
  const dx = Number(event.deltaX || 0) * factor;
  if (Math.abs(dx) > Math.abs(dy) * 1.3) return;
  feedWheelGestureDistance += dy;
  if (Math.abs(feedWheelGestureDistance) < FEED_WHEEL_MIN_DELTA) return;

  feedWheelGestureTriggered = true;
  const direction = feedWheelGestureDistance > 0 ? 1 : -1;
  if (fullscreenVideoElement()) {
    stepNativeFullscreen(direction);
  } else {
    stepFeed(direction);
  }
}

document
  .querySelector(
    '#feedScroller'
  )
  .addEventListener(
    'wheel',
    event => {
      // 原生 video fullscreen 时由 document capture 监听处理，
      // 防止底层 Feed 再收到一次相同滚轮事件。
      if (
        fullscreenVideoElement()
      ) {
        return;
      }

      navigateByWheel(
        event
      );
    },
    {
      passive:false
    }
  );

// 原生 video fullscreen 会把 video 放到浏览器顶层。
// 用 capture 监听，确保滚轮作用于“当前全屏 video”，
// 而不是滚动被它遮住的 Feed。
document.addEventListener(
  'wheel',
  event => {
    const video =
      fullscreenVideoElement();

    if (!video) {
      return;
    }

    const magnifier =
      focusZoomStates.get(
        video
      );

    if (
      magnifier &&
      magnifier.enabled
    ) {
      return;
    }

    navigateByWheel(
      event
    );
  },
  {
    passive:false,
    capture:true
  }
);

document.addEventListener(
  'fullscreenchange',
  rememberFullscreenState
);

document.addEventListener(
  'webkitfullscreenchange',
  rememberFullscreenState
);


document.addEventListener(
  'keydown',
  event => {
    if (
      !document
        .querySelector(
          '#feedOverlay'
        )
        .classList.contains(
          'open'
        )
    ) {
      return;
    }

    const target =
      event.target;

    if (
      target &&
      (
        target.tagName ===
          'INPUT' ||
        target.tagName ===
          'TEXTAREA'
      )
    ) {
      return;
    }

    if (
      event.repeat &&
      ['ArrowDown','ArrowUp','PageDown','PageUp'].includes(event.key)
    ) {
      event.preventDefault();
      return;
    }

    if (
      event.key ===
        'ArrowDown' ||
      event.key ===
        'PageDown'
    ) {
      event.preventDefault();

      if (
        fullscreenVideoElement()
      ) {
        stepNativeFullscreen(
          1
        );
      } else {
        stepFeed(
          1
        );
      }
    } else if (
      event.key ===
        'ArrowUp' ||
      event.key ===
        'PageUp'
    ) {
      event.preventDefault();

      if (
        fullscreenVideoElement()
      ) {
        stepNativeFullscreen(
          -1
        );
      } else {
        stepFeed(
          -1
        );
      }
    } else if (
      event.key ===
        'Escape'
    ) {
      // 原生全屏时浏览器自己先处理 Esc 退出 fullscreen。
      // 非原生全屏状态下才关闭 Feed。
      if (
        !fullscreenVideoElement()
      ) {
        closeFeed();
      }
    }
  }
);

document
  .querySelector(
    '#miniSyncStart'
  )
  .addEventListener(
    'click',
    restartAllMiniVideos
  );

document
  .querySelector(
    '#miniVisibilityToggle'
  )
  .addEventListener(
    'click',
    toggleMiniWindowsVisibility
  );

updateMiniVisibilityToggle();


// Just Fun v6.7 — conservative real-time color grading; no face segmentation, no file changes.
const jfFilterState={video:{preset:'none',strength:65},photo:{preset:'none',strength:65}};
const jfFilterCurves={
  clear:{brightness:1.055,contrast:1.04,saturate:1.08,sepia:.015,hue:-1},
  cream:{brightness:1.035,contrast:.96,saturate:1.09,sepia:.10,hue:-3},
  night:{brightness:1.17,contrast:1.11,saturate:1.14,sepia:.02,hue:-1},
  bold:{brightness:1.005,contrast:1.25,saturate:1.36,sepia:.06,hue:-2},
  flame:{brightness:1.02,contrast:1.18,saturate:1.35,sepia:.2,hue:-8},
  honey:{brightness:1.025,contrast:1.17,saturate:1.27,sepia:.25,hue:-5},
  vivid:{brightness:1.015,contrast:1.22,saturate:1.56,sepia:.035,hue:0}
};

// Dynamic, luminance-sampled character rendering, not a green tint overlay.
// Each frame samples the *actual* current video/image pixels (no external model).
const jfMatrixRuntime={video:null,photo:null};
function jfStopMatrix(mode){
 const job=jfMatrixRuntime[mode];if(!job)return;
 job.running=false;
 if(job.frame)cancelAnimationFrame(job.frame);
 job.canvas.remove();jfMatrixRuntime[mode]=null;
}
function jfStartMatrix(mode){
 let source=mode==='video'?getCurrentFeedVideo():document.getElementById('assetViewImg');
 let host=mode==='video'?source?.closest('.videoStage'):document.querySelector('#assetView .photoImageSurface');
 if(!source||!host||jfFilterState[mode].preset!=='matrix'){jfStopMatrix(mode);return;}
 const current=jfMatrixRuntime[mode];
 if(current&&current.source===source&&current.host===host)return;
 jfStopMatrix(mode);
 const canvas=document.createElement('canvas');canvas.className='jfFilterMatrixCanvas';canvas.setAttribute('aria-hidden','true');
 const computed=getComputedStyle(host);if(computed.position==='static')host.style.position='relative';
 host.append(canvas);
 const sample=document.createElement('canvas');const sx=sample.getContext('2d',{willReadFrequently:true});
 const ctx=canvas.getContext('2d',{alpha:false});
 if(!ctx||!sx){canvas.remove();return;}
 const job={running:true,canvas,source,host,frame:0,last:0};jfMatrixRuntime[mode]=job;
 const render=stamp=>{
  if(!job.running)return;
  job.frame=requestAnimationFrame(render);
  if(stamp-job.last<120)return;job.last=stamp;
  if(jfFilterState[mode].preset!=='matrix' || (mode==='video'&&source!==getCurrentFeedVideo())){jfStopMatrix(mode);return;}
  const w=host.clientWidth,h=host.clientHeight;
  const ready=mode==='video'?source.readyState>=2:source.complete&&source.naturalWidth>0;
  const sw=mode==='video'?source.videoWidth:source.naturalWidth,sh=mode==='video'?source.videoHeight:source.naturalHeight;
  if(!ready||!sw||!sh||w<2||h<2)return;
  // Compute object-fit:contain output rectangle, including picture zoom and drag.
  const hostRect=host.getBoundingClientRect(),srcRect=source.getBoundingClientRect();
  let x=0,y=0,dw=0,dh=0;
  if(mode==='video'){
   const videoW=srcRect.width||w, videoH=srcRect.height||h;
   const scale=Math.min(videoW/sw,videoH/sh);
   dw=sw*scale;dh=sh*scale;x=srcRect.left-hostRect.left+(videoW-dw)/2;y=srcRect.top-hostRect.top+(videoH-dh)/2;
  } else {
   const fit=Math.min(srcRect.width/sw,srcRect.height/sh);
   dw=sw*fit;dh=sh*fit;x=srcRect.left-hostRect.left+(srcRect.width-dw)/2;y=srcRect.top-hostRect.top+(srcRect.height-dh)/2;
  }
  const ratio=Math.min(window.devicePixelRatio||1,1.5);
  const cw=Math.max(1,Math.round(w*ratio)),ch=Math.max(1,Math.round(h*ratio));
  if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
  ctx.save();ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
  ctx.fillStyle='rgba(0,4,2,.96)';ctx.fillRect(x,y,dw,dh);
  // Cells stay small enough to reveal facial structure but remain real digits.
  const cellW=Math.max(7,Math.min(12,dw/84));const cellH=cellW*1.26;
  const cols=Math.max(1,Math.ceil(dw/cellW)),rows=Math.max(1,Math.ceil(dh/cellH));
  if(sample.width!==cols||sample.height!==rows){sample.width=cols;sample.height=rows;}
  let pixels;
  try{sx.drawImage(source,0,0,cols,rows);pixels=sx.getImageData(0,0,cols,rows).data;}
  catch(e){ // Cross-origin/decoder restrictions: stop cleanly, never break playback.
    jfStopMatrix(mode);ctx.restore();return;
  }
  ctx.font='bold '+(cellH*.86)+'px monospace';ctx.textBaseline='top';
  const phase=Math.floor(stamp/115);
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
   const off=(row*cols+col)*4;
   const r=pixels[off],g=pixels[off+1],b=pixels[off+2];
   const lum=(r*.26+g*.62+b*.12)/255;
   const edge=col>0?Math.abs(lum-(pixels[off-4]*.26+pixels[off-3]*.62+pixels[off-2]*.12)/255):0;
   // Reconstruct faces/contours from luminance and contrast, not random rain alone.
   const intensity=Math.min(1,Math.pow(lum,.75)*.92+edge*1.45);
   const stream=(col*17+phase-row*3)%29===0? .2:0;
   const alpha=Math.max(.055,Math.min(1,intensity*.96+stream));
   const green=Math.round(135+intensity*120);const red=Math.round(14+intensity*58);
   ctx.fillStyle='rgba('+red+','+green+','+Math.round(55+intensity*88)+','+alpha.toFixed(3)+')';
   const digit=((row*71+col*37+Math.floor(phase/3))%7)<3?'0':'1';
   ctx.fillText(digit,x+col*cellW,y+row*cellH);
  }
  ctx.restore();
 };
 job.frame=requestAnimationFrame(render);
}

function jfFilterCSS(mode){
 const state=jfFilterState[mode];
 const target=jfFilterCurves[state.preset];
 if(!target||state.strength===0)return 'none';
 const ratio=state.strength/100;
 const interp=(value,neutral)=>Number((neutral+(value-neutral)*ratio).toFixed(4));
 return 'brightness('+interp(target.brightness,1)+') contrast('+interp(target.contrast,1)+') saturate('+interp(target.saturate,1)+') sepia('+interp(target.sepia,0)+') hue-rotate('+Number((target.hue*ratio).toFixed(2))+'deg)';
}
let jfLastFilteredVideo=null;
function jfApplyFilter(mode){
 const css=jfFilterCSS(mode);
 if(jfFilterState[mode].preset==='matrix'){
  jfStartMatrix(mode);
 }else jfStopMatrix(mode);
 if(mode==='photo'){
   const img=document.querySelector('#assetViewImg');if(img)img.style.setProperty('filter',css,'important');
 }else{
   const video=getCurrentFeedVideo();
   // Switching or dragging the strength slider never traverses the entire feed DOM.
   if(jfLastFilteredVideo&&jfLastFilteredVideo!==video)jfLastFilteredVideo.style.removeProperty('filter');
   if(video){video.style.setProperty('filter',css,'important');jfLastFilteredVideo=video;}
   else jfLastFilteredVideo=null;
 }
 const panel=document.querySelector('.jfFilterPanel[data-jf-mode="'+mode+'"]');
 if(!panel)return;
 panel.dataset.jfActivePreset=jfFilterState[mode].preset;
 panel.querySelectorAll('[data-jf-preset]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.jfPreset===jfFilterState[mode].preset)));
 const slider=panel.querySelector('[data-jf-strength]');
 slider.value=String(jfFilterState[mode].strength);
 slider.disabled=jfFilterState[mode].preset==='none';
 panel.querySelector('[data-jf-value]').textContent=String(jfFilterState[mode].strength)+'%';
}
function jfCloseFilter(mode){
 const panel=document.querySelector('.jfFilterPanel[data-jf-mode="'+mode+'"]');
 if(panel)panel.hidden=true;
}
function jfResetVideoFilter(){
 jfStopMatrix('video');
 jfFilterState.video={preset:'none',strength:65};
 jfCloseFilter('video');jfApplyFilter('video');
}
function jfResetPhotoFilter(){
 jfStopMatrix('photo');
 jfFilterState.photo={preset:'none',strength:65};
 jfCloseFilter('photo');jfApplyFilter('photo');
}
function jfToggleFilter(mode){
 const panel=document.querySelector('.jfFilterPanel[data-jf-mode="'+mode+'"]');
 if(!panel)return;
 const visible=panel.hidden;panel.hidden=!visible;
 if(mode==='video' && visible && document.querySelector('#feedOverlay')?.classList.contains('toolsOpen'))setStudioFeedPanel('tools',false);
 if(mode==='photo' && visible){document.getElementById('photoMorePanel').hidden=true;document.getElementById('photoMoreToggle').setAttribute('aria-expanded','false');}
 jfApplyFilter(mode);
}
document.querySelector('#feedFilter').addEventListener('click',()=>jfToggleFilter('video'));
document.querySelector('#photoFilterToggle').addEventListener('click',()=>jfToggleFilter('photo'));
document.querySelectorAll('.jfFilterPanel').forEach(panel=>{
 const mode=panel.dataset.jfMode;
 panel.addEventListener('pointerdown',e=>e.stopPropagation());
 panel.querySelector('.jfFilterClose').addEventListener('click',()=>jfCloseFilter(mode));
 panel.addEventListener('click',e=>{
  const btn=e.target.closest('[data-jf-preset]');if(!btn)return;
  jfFilterState[mode].preset=btn.dataset.jfPreset;jfApplyFilter(mode);
 });
 panel.querySelector('[data-jf-strength]').addEventListener('input',e=>{
  jfFilterState[mode].strength=Math.max(0,Math.min(100,Number(e.target.value)||0));jfApplyFilter(mode);
 });
});


/* v6.16: scroll-aware header, contextual media rail, persisted list density. */
const studioViewToggle=document.getElementById('videoViewToggle');
studioViewToggle.addEventListener('click',()=>{
  videoViewMode=videoViewMode==='cover'?'text':'cover';
  try {localStorage.setItem(VIDEO_VIEW_PREF,videoViewMode);} catch (_) {}
  if(libraryMode==='video')render();
});
const studioRailToggle=document.getElementById('studioRailToggle');
const studioMediaRail=document.getElementById('studioMediaRail');
function railOverlap(a,b){return a.left<b.right+6&&a.right+6>b.left&&a.top<b.bottom+6&&a.bottom+6>b.top;}
function studioPositionRail(){
  const music=document.getElementById('audioDock');
  music?.style.removeProperty('--jf-rail-music-shift');
  studioRailToggle.style.removeProperty('--rail-toggle-left');
  studioMediaRail.style.removeProperty('--rail-left');
  if(!music || music.hidden || !music.classList.contains('isMinimized'))return;
  const base=innerWidth<=700?11:18;
  // Open rail always stays anchored bottom-left. Only the tiny music bubble moves,
  // without rewriting its persisted drag position or changing width/height.
  const m=music.getBoundingClientRect();
  if(studioMediaRail.classList.contains('railOpen')){
    const w=studioMediaRail.offsetWidth,h=studioMediaRail.offsetHeight;
    const bottom=innerWidth<=700?69:78;
    const rail={left:base,right:base+w,top:innerHeight-bottom-h,bottom:innerHeight-bottom};
    const delta=Math.min(Math.max(0,innerWidth-m.right-8),rail.right-m.left+12);
    if(railOverlap(rail,m) && delta>0)music.style.setProperty('--jf-rail-music-shift',delta+'px');
    else if(railOverlap(rail,m))studioMediaRail.style.setProperty('--rail-left',Math.max(base,innerWidth-w-9)+'px');
  }
  const shifted=music.getBoundingClientRect(),btn=studioRailToggle.getBoundingClientRect();
  if(railOverlap(btn,shifted))studioRailToggle.style.setProperty('--rail-toggle-left',Math.min(innerWidth-55,Math.max(base,shifted.right+12))+'px');
}
function studioSetRail(open){
  studioMediaRail.classList.toggle('railOpen',open);
  studioRailToggle.setAttribute('aria-expanded',String(open));
  studioRailToggle.setAttribute('aria-label',open?'收起媒体导航':'展开媒体导航');
  studioRailToggle.title=open?'收起媒体导航':'展开媒体导航';
  requestAnimationFrame(studioPositionRail);
}
studioRailToggle.addEventListener('click',()=>studioSetRail(!studioMediaRail.classList.contains('railOpen')));
studioMediaRail.addEventListener('click',event=>{if(event.target.closest('[data-media-kind]'))studioSetRail(false);});
document.addEventListener('pointerdown',event=>{
  if(studioMediaRail.classList.contains('railOpen')&&!studioMediaRail.contains(event.target)&&!studioRailToggle.contains(event.target))studioSetRail(false);
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&studioMediaRail.classList.contains('railOpen'))studioSetRail(false);});
window.addEventListener('resize',()=>requestAnimationFrame(studioPositionRail),{passive:true});
const railMusicObserver=new MutationObserver(()=>requestAnimationFrame(studioPositionRail));
railMusicObserver.observe(document.getElementById('audioDock'),{attributes:true,attributeFilter:['class','hidden','style']});
let lastHeaderScroll=window.scrollY,headerTick=false;
window.addEventListener('scroll',()=>{
  if(headerTick)return;headerTick=true;
  requestAnimationFrame(()=>{
    headerTick=false;
    const now=Math.max(0,window.scrollY),delta=now-lastHeaderScroll;
    lastHeaderScroll=now;
    const header=document.querySelector('body>.studioHeader');
    if(now<header.offsetHeight+20 || header.contains(document.activeElement) || document.body.classList.contains('unifiedSelecting'))header.classList.remove('studioHeaderCollapsed');
    else if(delta>7)header.classList.add('studioHeaderCollapsed');
    else if(delta<-7)header.classList.remove('studioHeaderCollapsed');
  });
},{passive:true});
requestAnimationFrame(studioPositionRail);

load();

setInterval(
  load,
  DATA_POLL_INTERVAL
);
</script>
</body>
</html>`;
}

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
      const {progressId,progressDuration,...spawnOptions}=options;
      // out_time is a processed presentation timestamp, not bytes written.
      const ffmpegArgs=progressId && mediaProgressJobs.has(progressId) && command==='ffmpeg'
        ? [...args.slice(0,-1),'-progress','pipe:2','-nostats',args[args.length-1]]
        : args;
      const child = spawn(command,ffmpegArgs,{windowsHide:true,...spawnOptions});
      let progressBuffer='';

      let stderr =
        '';

      if (child.stderr) {
        child.stderr.on(
          'data',
          chunk => {
            const output=chunk.toString();
            stderr += output;
            if(progressId && progressDuration>0){
              progressBuffer+=output;
              const lines=progressBuffer.split(String.fromCharCode(10));
              progressBuffer=lines.pop() || '';
              for(const line of lines){
                if(!line.startsWith('out_time='))continue;
                const parts=line.slice(9).trim().split(':').map(Number);
                if(parts.length===3 && parts.every(Number.isFinite)){
                  updateMediaProgress(progressId,progressDuration,parts[0]*3600+parts[1]*60+parts[2]);
                }
              }
              if(progressBuffer.length>8192)progressBuffer='';
            }
          }
        );
      }

      child.on(
        'error',
        reject
      );

      child.on(
        'close',
        code => {
          if (code === 0) {
            resolve({
              code,
              stderr
            });
          } else {
            reject(
              new Error(
                stderr.trim() ||
                `${command} 退出码 ${code}`
              )
            );
          }
        }
      );
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
    probeVideo(
      finalPath
    )
  );

  if (
    !NO_SCREENSHOT &&
    newItem.duration
  ) {
    writeCover(
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

// 截图逐帧选择直接定位视频，旧版拆帧缓存会在启动时清理。
const FRAME_TEMP_ROOT = path.join(CACHE_DIR, '.frame-previews');
// 逐帧截图：仅缓存低清 JPEG，正式截图和封面始终从原视频提取。
// 文件夹按源文件 hash+修改签名隔离，避免旧缩略图错配；保留最近 3 组以加速下次进入。
const framePreviewJobs = new Map();
const FRAME_PREVIEW_KEEP = 3;
function previewJobForKey(key) {
  const item = requiredVideo(key);
  const st = fs.statSync(managedPath(item));
  const signature = `${st.size}-${st.mtimeMs}`;
  const id = crypto.createHash('sha256').update(`${key}|${signature}`).digest('hex').slice(0,24);
  return {item, id, signature, dir:path.join(FRAME_TEMP_ROOT,id)};
}
function countPreviewFrames(dir) {
  try {return fs.readdirSync(dir).filter(name=>/^f\d{6}\.jpg$/.test(name)).length;}
  catch {return 0;}
}
function previewPublicStatus(job) {
  return {
    id:job.id,ready:countPreviewFrames(job.dir),done:!!job.done,
    total:job.total || 0,error:job.error || ''
  };
}
function pruneFramePreviewCache() {
  try {
    const active = new Set([...framePreviewJobs.values()].filter(job=>job.running).map(job=>job.id));
    const dirs = fs.readdirSync(FRAME_TEMP_ROOT,{withFileTypes:true})
      .filter(entry=>entry.isDirectory() && /^[a-f0-9]{24}$/.test(entry.name))
      .map(entry=>({name:entry.name,stat:fs.statSync(path.join(FRAME_TEMP_ROOT,entry.name))}))
      .sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
    for (const entry of dirs.slice(FRAME_PREVIEW_KEEP)) {
      if (!active.has(entry.name)) {
        try {fs.rmSync(path.join(FRAME_TEMP_ROOT,entry.name),{recursive:true,force:true});} catch {}
      }
    }
  } catch {}
}
async function startFramePreview(key) {
  if (!HAS_FFMPEG) throw new Error('低清逐帧预览需要 FFmpeg');
  const entry = previewJobForKey(key);
  const cached = framePreviewJobs.get(key);
  // 缓存被 LRU 淘汰或上次生成失败后，重新进入时必须允许再生成。
  if (cached && cached.id === entry.id && (cached.running || (cached.done && countPreviewFrames(cached.dir)>0))) return previewPublicStatus(cached);
  if (cached && cached.running) { // 不删除仍在生成的缓存；新文件会使用新的签名目录。
    try {cached.child?.kill();} catch {}
  }
  fs.mkdirSync(FRAME_TEMP_ROOT,{recursive:true});
  let done = false;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(entry.dir,'complete.json'),'utf8'));
    done = meta.signature === entry.signature && meta.done === true && countPreviewFrames(entry.dir)>0;
  } catch {}
  if (!done) fs.rmSync(entry.dir,{recursive:true,force:true});
  fs.mkdirSync(entry.dir,{recursive:true});
  const info = await getVideoFrameTimes(key);
  const job = {...entry,total:info.times.length,done,running:!done,error:'',child:null};
  framePreviewJobs.set(key,job);
  try {fs.utimesSync(job.dir,new Date(),new Date());} catch {}
  if (done) return previewPublicStatus(job);
  const output = path.join(job.dir,'f%06d.jpg');
  const args = ['-hide_banner','-loglevel','error','-nostdin','-threads','2',
    '-i',managedPath(job.item),'-map','0:v:0','-an','-sn','-dn',
    '-vf','scale=320:320:force_original_aspect_ratio=decrease:flags=fast_bilinear',
    '-fps_mode','passthrough','-q:v','8','-start_number','0','-y',output];
  const child = spawn('ffmpeg',args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
  job.child=child;
  let stderr='';
  child.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-600);});
  const finish = error => {
    if (!job.running) return;
    job.running=false;
    job.error=error || '';
    job.done=!job.error;
    if (job.done) {
      try {fs.writeFileSync(path.join(job.dir,'complete.json'),JSON.stringify({signature:job.signature,done:true,total:countPreviewFrames(job.dir)}));} catch {}
    }
    pruneFramePreviewCache();
  };
  child.on('error',error=>finish(error.message));
  child.on('close',code=>finish(code===0?'':('低清预览生成失败：'+(stderr.trim() || code))));
  return previewPublicStatus(job);
}
function framePreviewStatus(key) {
  const current = previewJobForKey(key);
  const job = framePreviewJobs.get(key);
  if (!job || job.id !== current.id) return {id:'',ready:0,done:false,total:0,error:'未启动'};
  return previewPublicStatus(job);
}
const mediaJobs = new Set();

// 逐帧时间表：优先解析视频 packet PTS（不解码逐帧帧信息），避免同步 ffprobe 卡住整个服务。
// 某些文件/磁盘响应极慢时按帧率降级；此时截图与封面以原视频的帧序号提取，避免估算时刻错帧。
const frameTimestampCache = new Map();
const frameTimestampPending = new Map();
const FRAME_PROBE_LIMIT_MS = 8000;
function runFrameProbe(args, timeout = FRAME_PROBE_LIMIT_MS, maxBytes = 12 * 1024 * 1024) {
  return new Promise(resolve => {
    let child;
    try { child = spawn('ffprobe',args,{windowsHide:true,stdio:['ignore','pipe','pipe']}); }
    catch(error) { resolve({ok:false,reason:error.message,stdout:''}); return; }
    let stdout='', stderr='', bytes=0, settled=false, timedOut=false;
    const finish = (ok,reason) => {
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      resolve({ok,reason:reason||'',stdout});
    };
    const timer = setTimeout(()=>{
      timedOut=true;
      try {child.kill();}catch{}
      finish(false,'读取超时');
    },timeout);
    child.stdout?.on('data',data=>{
      if(settled)return;
      bytes+=data.length;
      if(bytes>maxBytes){
        try{child.kill();}catch{}
        finish(false,'帧数过多');
      } else stdout+=data.toString();
    });
    child.stderr?.on('data',data=>{stderr=(stderr+data.toString()).slice(-500);});
    child.on('error',error=>finish(false,error.message));
    child.on('close',code=>finish(!timedOut&&code===0,stderr.trim()||String(code)));
  });
}
function readRate(rate) {
  const match=String(rate||'').match(/^(\d+)(?:\/(\d+))?$/);
  if(!match)return 0;
  const n=Number(match[1]),d=Number(match[2]||1);
  const value=n/d;
  return Number.isFinite(value)&&value>=1&&value<=240?value:0;
}
function fallbackFrameInfo(item, detail, reason, durationHint) {
  let stream={};let format={};
  try {const value=JSON.parse(detail||'{}');stream=value.streams?.[0]||{};format=value.format||{};}catch{}
  const duration=[Number(item.duration),Number(durationHint),Number(stream.duration),Number(format.duration)]
    .find(x=>Number.isFinite(x)&&x>0) || 0;
  const fps=readRate(stream.avg_frame_rate)||readRate(stream.r_frame_rate)||30;
  const reportedCount=Number(stream.nb_frames);
  const count=Number.isSafeInteger(reportedCount)&&reportedCount>0&&reportedCount<=120000
    ?reportedCount:Math.min(120000,Math.max(1,Math.ceil(duration*fps)));
  const times=Array.from({length:count},(_,i)=>Number((i/fps).toFixed(6)));
  return {times,duration:duration||times[count-1]||0,fps,estimated:true,
    warning:'精确帧时间读取较慢，已切换到帧率估算。截图和封面仍按选中帧序号提取原图。',
    reason:String(reason||'').slice(0,140)};
}
async function getVideoFrameTimes(key, durationHint=0) {
  const item = requiredVideo(key);
  if (!HAS_FFPROBE) throw new Error('逐帧截图需要安装 FFprobe（随 FFmpeg 提供）');
  const stat = fs.statSync(managedPath(item));
  const signature=stat.size+'-'+stat.mtimeMs;
  const cached=frameTimestampCache.get(key);
  // 降级结果只短期缓存，磁盘响应恢复后仍有机会重新取得精确 PTS。
  if(cached&&cached.signature===signature&&(!cached.info.estimated||Date.now()-cached.createdAt<30000))return cached.info;
  const pending=frameTimestampPending.get(key);
  if(pending&&pending.signature===signature)return pending.promise;
  const promise=(async()=>{
    const file=managedPath(item);
    // show_packets 不对每一帧做解码，通常远快于 show_frames。
    const packets=await runFrameProbe([
      '-v','error','-select_streams','v:0','-show_packets',
      '-show_entries','packet=pts_time','-of','csv=p=0',file
    ]);
    let info=null;
    if(packets.ok){
      const times=[...new Set(packets.stdout.split(/\r?\n/)
        .filter(line=>line.trim())
        .map(line=>Number(line.trim().split(',')[0]))
        .filter(n=>Number.isFinite(n)&&n>=0))].sort((a,b)=>a-b);
      if(times.length)info={times,duration:Number(item.duration)||Number(durationHint)||times[times.length-1],estimated:false};
    }
    if(!info){
      const meta=await runFrameProbe([
        '-v','error','-select_streams','v:0','-show_entries',
        'stream=avg_frame_rate,r_frame_rate,nb_frames,duration:format=duration',
        '-of','json',file
      ],4000,128*1024);
      info=fallbackFrameInfo(item,meta.ok?meta.stdout:'',packets.reason||'视频时间戳读取失败',durationHint);
    }
    frameTimestampCache.set(key,{signature,info,createdAt:Date.now()});
    if(frameTimestampCache.size>8)frameTimestampCache.delete(frameTimestampCache.keys().next().value);
    return info;
  })();
  frameTimestampPending.set(key,{signature,promise});
  try {return await promise;}
  finally {if(frameTimestampPending.get(key)?.promise===promise)frameTimestampPending.delete(key);}
}

async function captureFrame(key, time, frameIndex=null) {
  const item = requiredVideo(key);
  time = Number(time);
  if (!Number.isFinite(time) || time < 0 || (item.duration > 0 && time > item.duration + .5)) {
    throw new Error('截图时间无效');
  }
  fs.mkdirSync(CACHE_DIR, {recursive:true});
  const tmp = path.join(CACHE_DIR, '.shot-' + crypto.randomBytes(12).toString('hex') + '.jpg');
  try {
    const indexed=Number.isSafeInteger(frameIndex)&&frameIndex>=0&&frameIndex<=120000;
    await runCommand('ffmpeg', indexed ? [
      '-hide_banner','-loglevel','error','-nostdin','-y',
      '-i',managedPath(item),'-vf',`select=eq(n\\,${frameIndex})`,
      '-vsync','0','-frames:v','1','-q:v','2',tmp
    ] : [
      '-hide_banner','-loglevel','error','-nostdin','-y',
      '-i',managedPath(item),'-ss',String(time),'-frames:v','1','-q:v','2',tmp
    ], {stdio:['ignore','ignore','pipe']});
    return addGeneratedMedia(tmp,'.jpg','data/'+FRAME_SUBDIR,
      (item.title||'视频')+' - 截图-'+time.toFixed(3)+'.jpg',item,{screenshotTime:time});
  } finally { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {} }
}

// 音频 A-B 精准重编码：以 m4a 保存到现有匿名化音频素材目录。
const audioClipLocks=new Set();
async function createAudioClip(key,start,end,progressId=null) {
  const item=catalog.items.find(x=>x.key===key&&x.state==='ready'&&itemMediaKind(x)==='audio');
  if(!item||!fs.existsSync(managedPath(item))) throw new Error('音频文件不存在');
  if(!HAS_FFMPEG) throw new Error('截取音频需要 FFmpeg');
  start=Number(start);end=Number(end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<=0.05)throw new Error('A-B 区间无效');
  if(end-start>12*3600)throw new Error('截取区间超过 12 小时');
  if(audioClipLocks.has(key))throw new Error('这条音频正在截取中');
  audioClipLocks.add(key);
  const tmp=path.join(CACHE_DIR,'.audio-clip-'+crypto.randomBytes(12).toString('hex')+'.m4a');
  try {
    await runCommand('ffmpeg',[
      '-hide_banner','-loglevel','error','-nostdin','-y',
      '-ss',String(start),'-i',managedPath(item),'-t',String(end-start),
      '-map','0:a:0','-vn','-c:a','aac','-b:a','192k','-movflags','+faststart',tmp
    ],{stdio:['ignore','ignore','pipe'],progressId,progressDuration:end-start});
    const basename=path.basename(item.originalName||item.title||'音频',item.originalExt||'');
    return addGeneratedMedia(tmp,'.m4a','data/'+AUDIO_SUBDIR,
      basename+' - 片段 '+start.toFixed(2)+'-'+end.toFixed(2)+'.m4a',item,
      {audioSourceKey:key,audioClipStart:start,audioClipEnd:end});
  } finally {
    audioClipLocks.delete(key);
    try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}
  }
}

async function extractAudio(key,progressId=null) {
  const item = requiredVideo(key);
  if (mediaJobs.has('audio:' + key)) throw new Error('正在提取音轨');
  mediaJobs.add('audio:' + key);
  const tmp = path.join(CACHE_DIR, '.audio-'+crypto.randomBytes(12).toString('hex')+'.m4a');
  try {
    await runCommand('ffmpeg', [
      '-hide_banner','-loglevel','error','-nostdin','-y',
      '-i',managedPath(item),'-map','0:a:0','-vn','-c:a','aac','-b:a','192k',tmp
    ], {stdio:['ignore','ignore','pipe'],progressId,progressDuration:Number(item.duration)||0});
    return addGeneratedMedia(tmp,'.m4a','data/'+AUDIO_SUBDIR,
      (item.title||'视频')+' - 音轨.m4a',item,{audioSourceKey:key});
  } finally {
    mediaJobs.delete('audio:' + key);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  }
}

// 9:16 生成任务按源视频去重，避免按钮重复点击同时写入多份文件。
const portraitJobs = new Set();

async function createPortraitFromItem(item, cropX = 0.5, progressId=null) {
  if (!HAS_FFMPEG) {
    throw new Error('需要安装 FFmpeg 并将 ffmpeg 加入 PATH');
  }
  if (!item || itemMediaKind(item) !== 'video') {
    throw new Error('只有视频可以生成竖屏版本');
  }
  const source = managedPath(item);
  if (!fs.existsSync(source)) {
    throw new Error('原视频不存在');
  }

  // crop 只裁切像素，从不 scale 或拉伸。
  // 水平位置 0=左、0.5=中、1=右；偶数边界兼容 yuv420p。
  // 窄视频如需裁剪高度，仍保持垂直居中。
  const transforms = {
    90: 'transpose=clock',
    180: 'hflip,vflip',
    270: 'transpose=cclock'
  };
  const filterParts = [];
  const extraRotation = Number(item.rotation || 0);
  if (transforms[extraRotation]) filterParts.push(transforms[extraRotation]);
  filterParts.push(
    'crop=trunc(min(iw\\,ih*9/16)/2+0.5)*2:' +
    'trunc(min(ih\\,iw*16/9)/2+0.5)*2:' +
    'trunc((iw-ow)*' + cropX.toFixed(3) + '/2)*2:(ih-oh)/2'
  );

  const tempPath = path.join(
    CACHE_DIR,
    '.portrait-' + crypto.randomBytes(12).toString('hex') + '.mp4'
  );
  let finalPath = '';
  let newItem = null;
  try {
    // 不采用 stream copy：裁剪必须重新编码。优先 H.264；缺少 libx264 时回退 MPEG-4。
    const baseArgs = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', source,
      '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
      '-vf', filterParts.join(','),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-metadata:s:v:0', 'rotate=0',
      '-movflags', '+faststart', '-f', 'mp4'
    ];
    try {
      await runCommand('ffmpeg', [
        ...baseArgs, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', tempPath
      ], {stdio: ['ignore', 'ignore', 'pipe'],progressId,progressDuration:Number(item.duration)||0});
    } catch (error) {
      if (!/unknown encoder ['"]?libx264|encoder.*libx264.*not found/i.test(String(error.message))) {
        throw error;
      }
      try { fs.unlinkSync(tempPath); } catch {}
      await runCommand('ffmpeg', [
        ...baseArgs, '-c:v', 'mpeg4', '-q:v', '3', tempPath
      ], {stdio: ['ignore', 'ignore', 'pipe'],progressId,progressDuration:Number(item.duration)||0});
    }

    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size <= 0) {
      throw new Error('FFmpeg 未能生成有效的竖屏视频');
    }
    const stat = fs.statSync(tempPath);
    let managedName = '';
    do {
      managedName = HASH_ENABLED ? makeManagedName((item.originalName || item.title || item.key) + '-9x16', stat)
        : uniqueVisibleName(targetDir, safeOriginalFilename((item.title || '视频').replace(/[\\\/:*?"<>|]/g,'_') + '-9x16.mp4'));
    } while (
      fs.existsSync(path.join(targetDir, managedName)) ||
      catalog.items.some(x => x.managedName === managedName)
    );

    finalPath = path.join(targetDir, managedName);
    fs.renameSync(tempPath, finalPath);
    const newStat = fs.statSync(finalPath);
    const title = (item.title || '视频') + ' · 竖屏 9:16 · 横向' + Math.round(cropX * 100) + '%';
    newItem = {
      key: hashKey(HASH_ENABLED ? managedName : 'root/'+managedName),
      managedName,
      originalName: (item.creator ? item.creator + ' - ' : '') + title + '.mp4',
      originalExt: '.mp4',
      kind: 'video',
      mime: 'video/mp4',
      creator: item.creator || '',
      title,
      rating: Number(item.rating || 0),
      rotation: 0,
      portraitSourceKey: item.key,
      portraitAspect: '9:16',
      portraitCropX: cropX,
      cover: '', coverTime: 0,
      duration: 0, durationText: '',
      width: 0, height: 0, resolution: '', codec: '',
      size: newStat.size,
      sizeText: formatBytes(newStat.size),
      importedAt: new Date().toISOString(),
      modifiedTimeMs: Number(newStat.mtimeMs) || 0,
      modifiedAt: new Date(newStat.mtimeMs).toISOString(),
      fingerprint: `${newStat.size}-${Math.floor(newStat.mtimeMs)}`,
      state: 'ready'
    };
    Object.assign(newItem, probeVideo(finalPath));
    if (!NO_SCREENSHOT && newItem.duration) {
      writeCover(newItem, newItem.duration * 0.35);
    }
    catalog.items.push(newItem);
    try {
      saveCatalog();
    } catch (error) {
      catalog.items = catalog.items.filter(x => x !== newItem);
      removeCover(newItem);
      throw error;
    }
    return newItem;
  } catch (error) {
    // 失败时不留下半个新媒体；源视频始终不受影响。
    if (finalPath && fs.existsSync(finalPath)) {
      try { fs.unlinkSync(finalPath); } catch {}
    }
    throw error;
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }
}

let compiledHomeHTML = null;
function startServer() {
  const server =
    http.createServer(
      async (
        req,
        res
      ) => {
        try {
          const url =
            new URL(
              req.url,
              `http://127.0.0.1:${PORT}`
            );

          if (url.pathname === '/favicon.ico') {
             res.writeHead(200, {'Content-Type':'image/x-icon', 'Content-Length':APP_FAVICON_ICO.length, 'Cache-Control':'private, max-age=300'});
             if (req.method === 'HEAD') res.end();
             else res.end(APP_FAVICON_ICO);
             return;
           }

           if (
            url.pathname ===
              '/manifest.webmanifest'
          ) {
            const body =
              manifestJson();

            res.writeHead(
              200,
              {
                'Content-Type':
                  'application/manifest+json; charset=utf-8',
                'Content-Length':
                  Buffer.byteLength(
                    body
                  ),
                'Cache-Control':
                  'no-cache'
              }
            );

            res.end(
              body
            );

            return;
          }

          if (
            url.pathname === '/'
          ) {
            const html = compiledHomeHTML || (compiledHomeHTML = htmlPage());

            res.writeHead(
              200,
              {
                'Content-Type':
                  'text/html; charset=utf-8'
              }
            );

            res.end(
              html
            );

            return;
          }

          if(url.pathname==='/api/media-progress' && req.method==='GET'){
            const id=url.searchParams.get('id');
            if(!validProgressId(id)){sendJson(res,{ok:false,error:'任务编号无效'},400);return;}
            const job=mediaProgressJobs.get(id);
            if(!job){sendJson(res,{ok:false,error:'任务不存在'},404);return;}
            sendJson(res,{ok:true,status:job.status,percent:job.percent,label:job.label});
            return;
          }
          if(url.pathname.startsWith('/api/image-thumb/') && req.method==='GET') {
            const key=url.pathname.slice('/api/image-thumb/'.length);
            if(!/^[a-f0-9]{16}$/.test(key)){res.writeHead(400);res.end();return;}
            await servePhotoThumbnail(req,res,key);
            return;
          }
          if(url.pathname==='/api/delete-images' && req.method==='POST') {
            const body=await parseBody(req);
            const keys=body && body.keys;
            if(!Array.isArray(keys)||keys.length<1||keys.length>500||keys.some(x=>typeof x!=='string'||!/^[a-f0-9]{16}$/.test(x))){
              sendJson(res,{ok:false,error:'图片数量或格式无效（最多 500 张）'},400);return;
            }
            const unique=[...new Set(keys)];
            const found=unique.map(key=>catalog.items.find(x=>x.key===key&&x.state==='ready'&&itemMediaKind(x)==='image'));
            if(found.some(x=>!x)){sendJson(res,{ok:false,error:'部分图片已不存在，请刷新图库'},409);return;}
            const failed=[],deleted=[];
            for(const item of found){
              try{
                fs.unlinkSync(managedPath(item));
                removeCover(item);
                try{fs.unlinkSync(path.join(PHOTO_THUMB_DIR,item.key));}catch{}
                deleted.push(item.key);
              }catch(error){failed.push({key:item.key,error:error.message});}
            }
            if(deleted.length){
              const deletedSet=new Set(deleted);
              catalog.items=catalog.items.filter(x=>!deletedSet.has(x.key));
              saveCatalog();
            }
            sendJson(res,{ok:true,deleted:deleted.length,failed});return;
          }
          if (url.pathname === '/api/ghost-loop' && req.method==='POST') {
            try {
              const body=await parseBody(req);
              const details=ghostMediaDetails(String(body.key||''),body.a,body.b);
              if(!ghostLoopJobs.has(details.id)) ghostLoopJobs.set(details.id,makeGhostLoop(details).finally(()=>ghostLoopJobs.delete(details.id)));
              await ghostLoopJobs.get(details.id);
              sendJson(res,{ok:true,url:'/api/ghost-loop/'+details.id+'.mp4',length:details.end-details.start});
            } catch(error) {sendJson(res,{ok:false,error:error.message||'生成失败'},400);}
            return;
          }
          if (url.pathname.startsWith('/api/ghost-loop/') && req.method==='GET') {
            const name=url.pathname.slice('/api/ghost-loop/'.length);
            if(!/^[a-f0-9]{40}\.mp4$/.test(name)) {res.writeHead(400);res.end();return;}
            const file=path.join(GHOST_DIR,name);
            if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
            streamMedia(req,res,{mime:'video/mp4'},file);
            return;
          }
          if (url.pathname === '/api/clips' && req.method === 'GET') {
            sendJson(res,{ok:true,clips:catalog.clips.map(publicClip)});
            return;
          }
          if (url.pathname === '/api/clips' && req.method === 'POST') {
            try {
              const body = await parseBody(req);
              const clip = mutateClip(body || {});
              sendJson(res,{ok:true,clip});
            } catch(error) {
              sendJson(res,{ok:false,error:error.message || '片段操作失败'},400);
            }
            return;
          }
          if (url.pathname === '/api/clips/export' && req.method === 'POST') {
            try {
              const body = await parseBody(req);
              const clip = catalog.clips.find(c => c.id === String(body.id || ''));
              if (!clip) {sendJson(res,{ok:false,error:'片段不存在'},404);return;}
              const source = clipSource(clip.sourceKey);
              beginMediaProgress(body.jobId,'导出片段');
              const created = await createClipFromItem(source,clip.a,clip.b,body.jobId);
              finishMediaProgress(body.jobId);
              // 导出文件是独立媒体，删除虚拟片段不会影响它。
              sendJson(res,{ok:true,item:itemPublic(created)});
            } catch(error) {sendJson(res,{ok:false,error:error.message || '导出失败'},400);}
            return;
          }
          if (
            url.pathname ===
            '/api/data'
          ) {
            // 媒体库内容未更新时，304 直接返回；避免全量 JSON 序列化
            // 以及扫描每个封面文件的同步 I/O。
            const catalogETag = '"' + (catalog.updatedAt || 'initial') + '"';
            if (req.headers['if-none-match'] === catalogETag) {
              res.writeHead(304, {'ETag': catalogETag, 'Cache-Control': 'no-store'});
              res.end();
              return;
            }
            res.setHeader('ETag', catalogETag);
            sendJson(
              res,
              {
                updatedAt:
                  catalog.updatedAt,
                scanStatus:
                  catalog.scanStatus,
                scanMessage:
                  catalog.scanMessage,
                folders: catalog.folders.filter(f => f.state === 'ready').map(f => ({
                  relativeDir:f.relativeDir, parentDir:f.parentDir, originalName:f.originalName
                })),
                items:
                  catalog.items
                    .filter(
                      item =>
                        item.state ===
                        'ready'
                    )
                    .map(
                      itemPublic
                    )
              }
            );

            return;
          }

          if (url.pathname === '/api/frame-preview/start' && req.method === 'POST') {
            const body = await parseBody(req);
            try {sendJson(res,{ok:true,...await startFramePreview(body.key)});}
            catch(error) {sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if (url.pathname === '/api/frame-preview/status' && req.method === 'GET') {
            try {sendJson(res,{ok:true,...framePreviewStatus(url.searchParams.get('key'))});}
            catch(error) {sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if (url.pathname.startsWith('/api/frame-preview/image/') && req.method === 'GET') {
            const parts = url.pathname.slice('/api/frame-preview/image/'.length).split('/');
            const id=parts[0];
            const number=parts[1];
            if (!/^[a-f0-9]{24}$/.test(id||'') || !/^\d{1,6}$/.test(number||'')) {
              res.writeHead(400);res.end();return;
            }
            const idx=Number(number);
            const job=[...framePreviewJobs.values()].find(x=>x.id===id);
            if (!job || idx<0 || idx>=job.total) {res.writeHead(404);res.end();return;}
            const file=path.join(job.dir,'f'+String(idx).padStart(6,'0')+'.jpg');
            try {
              const st=fs.statSync(file);
              if (!st.isFile() || st.size<32) throw new Error('not ready');
              res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':st.size,'Cache-Control':'private, max-age=86400'});
              fs.createReadStream(file).pipe(res);
            } catch {res.writeHead(404,{'Cache-Control':'no-store'});res.end();}
            return;
          }
          if (url.pathname === '/api/frame-times' && req.method === 'POST') {
            const body = await parseBody(req);
            try {sendJson(res,{ok:true,...await getVideoFrameTimes(body.key,body.duration)});}
            catch(error) {sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if (url.pathname === '/api/screenshot' && req.method === 'POST') {
            const body = await parseBody(req);
            try {const item=await captureFrame(body.key,body.time,body.frameIndex);sendJson(res,{ok:true,key:item.key});}
            catch(error) {sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if (url.pathname === '/api/clip-audio' && req.method === 'POST') {
            const body=await parseBody(req);
            beginMediaProgress(body.jobId,'截取音频');
            try {
              const item=await createAudioClip(body.key,body.start,body.end,body.jobId);
              finishMediaProgress(body.jobId);
              sendJson(res,{ok:true,item:itemPublic(item)});
            } catch(error) {finishMediaProgress(body.jobId,error);sendJson(res,{ok:false,error:error.message||'音频截取失败'},400);}
            return;
          }
          if (url.pathname === '/api/extract-audio' && req.method === 'POST') {
            const body = await parseBody(req);
            beginMediaProgress(body.jobId,'提取音轨');
            try {const item=await extractAudio(body.key,body.jobId);finishMediaProgress(body.jobId);sendJson(res,{ok:true,key:item.key});}
            catch(error) {finishMediaProgress(body.jobId,error);sendJson(res,{ok:false,error:error.message},400);}
            return;
          }

          // Directory operations remain under the current media root and use catalog-backed hashed paths.
          if (url.pathname === '/api/folder-create' && req.method === 'POST') {
            const body=await parseBody(req);
            const parent=body.parent, name=typeof body.name==='string'?cleanText(body.name):'';
            if(typeof parent!=='string'||!name||Array.from(name).length>100||/[\\/<>:"|?*]/.test(name)||name==='.'||name==='..'){
              sendJson(res,{ok:false,error:'目录名称不合法'},400);return;
            }
            const validParent=parent==='data'||catalog.folders.some(f=>f.relativeDir===parent && f.state==='ready');
            if(!validParent || String(parent).split('/').length>=12){sendJson(res,{ok:false,error:'只能在已有素材目录内创建'},400);return;}
            if(catalog.folders.some(f=>f.parentDir===parent&&f.originalName===name&&f.state==='ready')){
              sendJson(res,{ok:false,error:'当前目录已经存在同名文件夹'},409);return;
            }
            let relativeDir='',full='';
            try {
              const hash=HASH_ENABLED ? randomFolderHash(parent) : name;
              relativeDir=parent+'/'+hash;
              full=path.join(targetDir,safeMediaRelativeDir(relativeDir));
              if(fs.existsSync(full))throw new Error('目录已存在');
              fs.mkdirSync(full);
              const folder={relativeDir,parentDir:parent,originalName:name,state:'ready'};
              catalog.folders.push(folder);
              try{saveCatalog();}catch(e){catalog.folders.pop();fs.rmdirSync(full);throw e;}
              sendJson(res,{ok:true,relativeDir,originalName:name});
            }catch(error){sendJson(res,{ok:false,error:'无法创建目录：'+error.message},500);}
            return;
          }
          if (url.pathname === '/api/folder-rename' && req.method === 'POST') {
            const body=await parseBody(req);
            const dir=body&&body.relativeDir;
            const name=body&&typeof body.name==='string'?cleanText(body.name):'';
            const folder=catalog.folders.find(f=>f.relativeDir===dir&&f.state==='ready');
            if(!folder){sendJson(res,{ok:false,error:'文件夹不存在或不支持改名'},404);return;}
            if(!name||Array.from(name).length>100||/[\\/<>:"|?*]/.test(name)||name==='.'||name==='..'){
              sendJson(res,{ok:false,error:'目录名称不合法'},400);return;
            }
            if(catalog.folders.some(f=>f!==folder&&f.parentDir===folder.parentDir&&f.originalName===name&&f.state==='ready')){
              sendJson(res,{ok:false,error:'上级目录已存在同名文件夹'},409);return;
            }
            const old=folder.originalName;
            if (!HASH_ENABLED) {
              try {
                const oldAbs=path.join(targetDir,safeMediaRelativeDir(dir));
                const next=folder.parentDir+'/'+name;
                const newAbs=path.join(targetDir,safeMediaRelativeDir(next));
                if(fs.existsSync(newAbs))throw new Error('目标目录已存在');
                fs.renameSync(oldAbs,newAbs);
                const beforeFolders=JSON.stringify(catalog.folders),beforeItems=catalog.items.map(x=>x.relativeDir);
                for(const f of catalog.folders){
                  if(f.relativeDir===dir || f.relativeDir.startsWith(dir+'/'))f.relativeDir=next+f.relativeDir.slice(dir.length);
                  if(f.parentDir===dir || f.parentDir.startsWith(dir+'/'))f.parentDir=next+f.parentDir.slice(dir.length);
                }
                for(const x of catalog.items){if(x.relativeDir===dir || (x.relativeDir||'').startsWith(dir+'/'))x.relativeDir=next+x.relativeDir.slice(dir.length);}
                folder.originalName=name;
                try{saveCatalog();}
                catch(e){catalog.folders=JSON.parse(beforeFolders);catalog.items.forEach((x,i)=>x.relativeDir=beforeItems[i]);fs.renameSync(newAbs,oldAbs);throw e;}
                sendJson(res,{ok:true,relativeDir:next,originalName:name});
              }catch(e){sendJson(res,{ok:false,error:e.message},500);}
              return;
            }
            folder.originalName=name;
            try{saveCatalog();}catch(error){folder.originalName=old;sendJson(res,{ok:false,error:error.message},500);return;}
            sendJson(res,{ok:true,relativeDir:dir,originalName:name});return;
          }
          if (url.pathname === '/api/media-move' && req.method === 'POST') {
            const body=await parseBody(req);
            const keys=body.keys,target=body.target;
            if(!Array.isArray(keys)||keys.length<1||keys.length>300||
               keys.some(k=>typeof k!=='string'||!/^[a-f0-9]{16}$/.test(k))||new Set(keys).size!==keys.length||
               typeof target!=='string'||!(target==='root'||target==='data'||catalog.folders.some(f=>f.relativeDir===target&&f.state==='ready'))){
              sendJson(res,{ok:false,error:'目标目录或选中文件无效'},400);return;
            }
            const items=keys.map(k=>catalog.items.find(x=>x.key===k && x.state==='ready'));
            if(items.some(x=>!x)){sendJson(res,{ok:false,error:'存在无效素材，刷新后重试'},409);return;}
            let changes=[];
            try {
              const targetRelative=target==='root'?'':target;
              const destDir=path.join(targetDir,safeMediaRelativeDir(targetRelative));
              if(!fs.lstatSync(destDir).isDirectory()||fs.lstatSync(destDir).isSymbolicLink())throw new Error('目标不是受管理的普通文件夹');
              const toMove=items.filter(x=>(x.relativeDir||'')!==targetRelative);
              for(const item of toMove){
                const from=managedPath(item), to=path.join(destDir,item.managedName);
                if(!fs.statSync(from).isFile()||fs.existsSync(to))throw new Error('源文件不存在或目标文件已存在');
                changes.push({item,from,to,oldDir:item.relativeDir||''});
              }
              let moved=[];
              try {
                for(const change of changes){fs.renameSync(change.from,change.to);moved.push(change);}
                for(const change of changes)change.item.relativeDir=targetRelative;
                if(changes.length)saveCatalog();
              }catch(error){
                for(const change of changes)change.item.relativeDir=change.oldDir;
                for(const change of moved.reverse())try{fs.renameSync(change.to,change.from);}catch(rollback){error.message+='；回滚失败：'+rollback.message;}
                throw error;
              }
              sendJson(res,{ok:true,moved:changes.length});
            }catch(error){sendJson(res,{ok:false,error:'移动失败：'+error.message},500);}
            return;
          }

          // Shared file operations for video / image / audio. Hash paths never change on rename.
          if (url.pathname === '/api/media-rename' && req.method === 'POST') {
            const body = await parseBody(req);
            const item = catalog.items.find(x => x.key === body.key && x.state === 'ready');
            if (!item) {sendJson(res,{ok:false,error:'媒体不存在'},404);return;}
            if (typeof body.name !== 'string') {sendJson(res,{ok:false,error:'名称必须是文本'},400);return;}
            const name = cleanText(body.name);
            if (!name || Array.from(name).length > 180 || /[\\/<>:"|?*]/.test(name) || name==='.' || name==='..') {
              sendJson(res,{ok:false,error:'名称不能为空、超过 180 字，或包含路径符号'},400);return;
            }
            const old = item.displayName;
            if (!HASH_ENABLED) {
              try {
                const oldAbs=managedPath(item),oldManaged=item.managedName,oldOriginal=item.originalName;
                const next=safeOriginalFilename(name + (item.originalExt||path.extname(oldManaged)));
                const nextAbs=path.join(path.dirname(oldAbs),next);
                if(oldAbs!==nextAbs && fs.existsSync(nextAbs))throw new Error('同名文件已存在');
                if(oldAbs!==nextAbs)fs.renameSync(oldAbs,nextAbs);
                item.managedName=next;item.originalName=next;item.displayName=name;
                try{saveCatalog();}catch(e){item.managedName=oldManaged;item.originalName=oldOriginal;item.displayName=old;if(oldAbs!==nextAbs)fs.renameSync(nextAbs,oldAbs);throw e;}
                sendJson(res,{ok:true,displayName:name});
              }catch(e){sendJson(res,{ok:false,error:e.message},500);}
              return;
            }
            item.displayName = name;
            try {saveCatalog();} catch(error) {
              item.displayName = old;sendJson(res,{ok:false,error:error.message},500);return;
            }
            sendJson(res,{ok:true,displayName:name});return;
          }
          if (url.pathname === '/api/media-favorite' && req.method === 'POST') {
            const body = await parseBody(req);
            const keys = body && body.keys;
            if (!Array.isArray(keys) || keys.length<1 || keys.length>500 ||
                keys.some(k=>typeof k!=='string'||!/^[a-f0-9]{16}$/.test(k)) || typeof body.favorite!=='boolean') {
              sendJson(res,{ok:false,error:'收藏操作参数无效'},400);return;
            }
            const keySet = new Set(keys);
            const targets = catalog.items.filter(x=>keySet.has(x.key)&&x.state==='ready');
            if (targets.length!==keySet.size) {sendJson(res,{ok:false,error:'有媒体已不存在，请刷新'},409);return;}
            const before=targets.map(x=>x.favorite);
            targets.forEach(x=>x.favorite=body.favorite);
            try {saveCatalog();} catch(error) {
              targets.forEach((x,i)=>x.favorite=before[i]);sendJson(res,{ok:false,error:error.message},500);return;
            }
            sendJson(res,{ok:true,updated:targets.length});return;
          }
          if (url.pathname === '/api/media-delete-batch' && req.method === 'POST') {
            const body = await parseBody(req);
            const keys=body && body.keys;
            if (!Array.isArray(keys)||keys.length<1||keys.length>500||
                keys.some(k=>typeof k!=='string'||!/^[a-f0-9]{16}$/.test(k))) {
              sendJson(res,{ok:false,error:'一次最多删除 500 个有效媒体'},400);return;
            }
            const keySet=new Set(keys);
            const found=catalog.items.filter(x=>keySet.has(x.key)&&x.state==='ready');
            if (found.length!==keySet.size) {sendJson(res,{ok:false,error:'部分媒体已不存在，请刷新'},409);return;}
            const deleted=[], failed=[];
            for (const item of found) {
              try {
                const file=managedPath(item);
                if (fs.existsSync(file)) fs.unlinkSync(file);
                removeCover(item);
                if (itemMediaKind(item)==='image') {
                  try{fs.unlinkSync(path.join(PHOTO_THUMB_DIR,item.key));}catch{}
                }
                deleted.push(item.key);
              } catch(error) { failed.push({key:item.key,error:error.message}); }
            }
            if (deleted.length) {
              const gone=new Set(deleted);
              catalog.items=catalog.items.filter(x=>!gone.has(x.key));
              saveCatalog();
            }
            sendJson(res,{ok:true,deleted:deleted.length,failed});return;
          }
          if (url.pathname === '/api/rename-audio' && req.method === 'POST') {
            const body = await parseBody(req);
            const item = catalog.items.find(x => x.key === body.key && x.state === 'ready');
            if (!item || itemMediaKind(item) !== 'audio') {
              sendJson(res,{ok:false,error:'音频不存在'},404);
              return;
            }
            if (typeof body.name !== 'string') {
              sendJson(res,{ok:false,error:'名称格式无效'},400);
              return;
            }
            const name = cleanText(body.name);
            if (!name || Array.from(name).length > 180 || /[\\/<>:"|?*]/.test(name) || name === '.' || name === '..') {
              sendJson(res,{ok:false,error:'名称不能为空、超过 180 字，或包含不允许的字符'},400);
              return;
            }
            const previous = item.displayName;
            if (!HASH_ENABLED) {
              try {
                const oldAbs=managedPath(item),oldManaged=item.managedName,oldOriginal=item.originalName;
                const next=safeOriginalFilename(name+(item.originalExt||path.extname(oldManaged)));
                const nextAbs=path.join(path.dirname(oldAbs),next);
                if(oldAbs!==nextAbs && fs.existsSync(nextAbs))throw new Error('目标文件已存在');
                if(oldAbs!==nextAbs)fs.renameSync(oldAbs,nextAbs);
                item.managedName=next;item.originalName=next;item.displayName=name;
                try{saveCatalog();}catch(e){item.managedName=oldManaged;item.originalName=oldOriginal;item.displayName=previous;if(oldAbs!==nextAbs)fs.renameSync(nextAbs,oldAbs);throw e;}
                sendJson(res,{ok:true,displayName:name});
              }catch(e){sendJson(res,{ok:false,error:e.message},500);}
              return;
            }
            item.displayName = name;
            try {saveCatalog();}
            catch (error) {
              item.displayName = previous;
              sendJson(res,{ok:false,error:'保存名称失败：'+error.message},500);
              return;
            }
            sendJson(res,{ok:true,displayName:name});
            return;
          }

          if (
            url.pathname ===
              '/api/update-text' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  body.key
              );

            if (!item) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'媒体不存在'
                },
                404
              );
              return;
            }

            if (
              body.field !==
                'creator' &&
              body.field !==
                'title'
            ) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'不支持的字段'
                },
                400
              );
              return;
            }

            item[
              body.field
            ] =
              cleanText(
                body.value
              );

            saveCatalog();

            sendJson(
              res,
              {
                ok:true
              }
            );

            return;
          }

          if (
            url.pathname ===
              '/api/update-creator-bulk' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const from =
              cleanText(
                body.from
              );

            const to =
              cleanText(
                body.to
              );

            if (
              !from ||
              !to
            ) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'作者名不能为空'
                },
                400
              );
              return;
            }

            let changed = 0;

            if (from !== to) {
              for (
                const item of
                catalog.items
              ) {
                if (
                  cleanText(
                    item.creator
                  ) === from
                ) {
                  item.creator = to;
                  changed++;
                }
              }
            }

            if (changed) {
              catalog.creatorLinks = catalog.creatorLinks && typeof catalog.creatorLinks === 'object'
                ? catalog.creatorLinks
                : {};
              if (catalog.creatorLinks[from] && !catalog.creatorLinks[to]) {
                catalog.creatorLinks[to] = catalog.creatorLinks[from];
              }
              if (from !== to) delete catalog.creatorLinks[from];
              saveCatalog();
            }

            sendJson(
              res,
              {
                ok:true,
                changed
              }
            );

            return;
          }

          if (
            url.pathname ===
              '/api/update-creator-link' &&
            req.method ===
              'POST'
          ) {
            const body = await parseBody(req);
            const creator = cleanText(body.creator);
            const link = String(body.link || '').trim();

            if (!creator) {
              sendJson(res, {ok:false,error:'作者名不能为空'}, 400);
              return;
            }
            if (link && !/^https?:\/\//i.test(link)) {
              sendJson(res, {ok:false,error:'链接格式无效'}, 400);
              return;
            }

            catalog.creatorLinks = catalog.creatorLinks && typeof catalog.creatorLinks === 'object'
              ? catalog.creatorLinks
              : {};
            if (link) catalog.creatorLinks[creator] = link;
            else delete catalog.creatorLinks[creator];
            saveCatalog();
            sendJson(res, {ok:true,link});
            return;
          }

          if (
            url.pathname === '/api/create-portrait' &&
            req.method === 'POST'
          ) {
            const body = await parseBody(req);
            const item = catalog.items.find(x => x.key === body.key);
            if (!item) {
              sendJson(res, {ok:false,error:'视频不存在'}, 404);
              return;
            }
            if (itemMediaKind(item) !== 'video') {
              sendJson(res, {ok:false,error:'仅支持视频'}, 400);
              return;
            }
            const rawCropX = body.cropX === undefined ? 0.5 : Number(body.cropX);
            if (!Number.isFinite(rawCropX) || rawCropX < 0 || rawCropX > 1) {
              sendJson(res, {ok:false,error:'水平裁剪位置无效'}, 400);
              return;
            }
            // 取 0.1% 精度；旧版居中裁剪数据默认视为 50%。
            const cropX = Math.round(rawCropX * 1000) / 1000;
            const existing = catalog.items.find(x =>
              x.portraitSourceKey === item.key &&
              Math.abs((Number.isFinite(Number(x.portraitCropX)) && x.portraitCropX !== undefined
                ? Number(x.portraitCropX) : 0.5) - cropX) < 0.0005 &&
              x.state === 'ready' &&
              fs.existsSync(managedPath(x))
            );
            if (existing) {
              sendJson(res, {ok:true,reused:true,item:itemPublic(existing)});
              return;
            }
            if (portraitJobs.has(item.key)) {
              sendJson(res, {ok:false,error:'此视频正在生成竖屏版，请勿重复提交'}, 409);
              return;
            }
            portraitJobs.add(item.key);
            beginMediaProgress(body.jobId,'生成竖屏视频');
            try {
              const created = await createPortraitFromItem(item, cropX,body.jobId);
              finishMediaProgress(body.jobId);
              sendJson(res, {ok:true,reused:false,item:itemPublic(created)});
            } catch (error) {
              finishMediaProgress(body.jobId,error);
              sendJson(res, {ok:false,error:error.message || '转换失败'}, 500);
            } finally {
              portraitJobs.delete(item.key);
            }
            return;
          }

          if (
            url.pathname ===
              '/api/clip' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  body.key
              );

            if (!item) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'媒体不存在'
                },
                404
              );
              return;
            }

            beginMediaProgress(body.jobId,'截取视频片段');
            try {
              const newItem =
                await createClipFromItem(
                  item,
                  body.start,
                  body.end,
                  body.jobId
                );
              finishMediaProgress(body.jobId);

              sendJson(
                res,
                {
                  ok:true,
                  item:
                    itemPublic(
                      newItem
                    )
                }
              );
            } catch (error) {
              finishMediaProgress(body.jobId,error);
              sendJson(
                res,
                {
                  ok:false,
                  error:
                    error.message
                },
                500
              );
            }

            return;
          }

          if (
            url.pathname ===
              '/api/update-rotation' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  body.key
              );

            if (!item) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'媒体不存在'
                },
                404
              );
              return;
            }

            if (
              itemMediaKind(
                item
              ) !==
              'video'
            ) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'只有视频支持旋转'
                },
                400
              );
              return;
            }

            const rotation =
              Number(
                body.rotation
              );

            if (
              ![0,90,180,270]
                .includes(
                  rotation
                )
            ) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'旋转角度无效'
                },
                400
              );
              return;
            }

            item.rotation =
              rotation;

            saveCatalog();

            sendJson(
              res,
              {
                ok:true,
                rotation:
                  item.rotation
              }
            );

            return;
          }

          if (
            url.pathname ===
              '/api/update-rating' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  body.key
              );

            if (!item) {
              sendJson(
                res,
                {
                  ok:false
                },
                404
              );
              return;
            }

            const rating =
              Number(
                body.rating
              );

            item.rating =
              Math.max(
                0,
                Math.min(
                  5,
                  Number.isFinite(
                    rating
                  )
                    ? Math.round(
                        rating * 2
                      ) / 2
                    : 0
                )
              );

            saveCatalog();

            sendJson(
              res,
              {
                ok:true
              }
            );

            return;
          }

          if (
            url.pathname ===
              '/api/set-cover' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  body.key
              );

            if (!item) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'媒体不存在'
                },
                404
              );
              return;
            }

            const result =
              writeCover(
                item,
                Number(body.time),
                body.precise === true,
                body.frameIndex
              );

            if (!result) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'生成封面失败'
                },
                500
              );
              return;
            }

            saveCatalog();

            sendJson(
              res,
              {
                ok:true,
                cover:
                  '/asset/' +
                  encodeURIComponent(
                    item.cover
                  ),
                time:
                  item.coverTime
              }
            );

            return;
          }

          if (
            url.pathname ===
              '/api/delete' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const index =
              catalog.items.findIndex(
                x =>
                  x.key ===
                  body.key
              );

            if (index < 0) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'媒体不存在'
                },
                404
              );
              return;
            }

            const item =
              catalog.items[
                index
              ];

            try {
              const file =
                managedPath(
                  item
                );

              if (
                fs.existsSync(
                  file
                )
              ) {
                fs.unlinkSync(
                  file
                );
              }

              removeCover(
                item
              );

              catalog.items.splice(
                index,
                1
              );

              saveCatalog();

              logStep(
                `已删除媒体：${item.creator || '未设置创作者'} · ${item.title}`
              );

              sendJson(
                res,
                {
                  ok:true
                }
              );
            } catch (error) {
              sendJson(
                res,
                {
                  ok:false,
                  error:
                    error.message
                },
                500
              );
            }

            return;
          }

          if (
            url.pathname.startsWith(
              '/asset/'
            )
          ) {
            const rel =
              decodeURIComponent(
                url.pathname.slice(
                  '/asset/'.length
                )
              );

            const full =
              path.resolve(
                ASSET_DIR,
                rel
              );

            const root =
              path.resolve(
                ASSET_DIR
              ) + path.sep;

            if (
              !full.startsWith(
                root
              ) ||
              !fs.existsSync(
                full
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
                full
              );

            res.writeHead(
              200,
              {
                'Content-Type':
                  'image/jpeg',
                'Content-Length':
                  stat.size,
                'Cache-Control':
                  'public, max-age=86400'
              }
            );

            fs.createReadStream(
              full
            ).pipe(
              res
            );

            return;
          }

          if (
            url.pathname.startsWith(
              '/media/'
            )
          ) {
            const key =
              url.pathname.slice(
                '/media/'.length
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  key &&
                  x.state ===
                  'ready'
              );

            if (!item) {
              res.writeHead(
                404
              );
              res.end();
              return;
            }

            streamMedia(
              req,
              res,
              item
            );

            return;
          }

          res.writeHead(
            404
          );
          res.end();
        } catch (error) {
          res.writeHead(
            500
          );
          res.end(
            error.message
          );
        }
      }
    );

  server.listen(
    PORT,
    HOST,
    () => {
      const url =
        `http://127.0.0.1:${PORT}/`;

      openUrl(
        url
      );
    }
  );

  server.on(
    'error',
    error => {
      if (
        error.code ===
        'EADDRINUSE'
      ) {
        console.error(
          `端口被占用：${PORT}`
        );
      } else {
        console.error(
          '服务异常'
        );
      }
    }
  );
}

function openUrl(url) {
  try {
    if (
      process.platform ===
      'win32'
    ) {
      spawn(
        'cmd',
        [
          '/c',
          'start',
          '',
          url
        ],
        {
          detached:true,
          stdio:'ignore',
          windowsHide:true
        }
      ).unref();
    } else if (
      process.platform ===
      'darwin'
    ) {
      spawn(
        'open',
        [url],
        {
          detached:true,
          stdio:'ignore'
        }
      ).unref();
    } else {
      spawn(
        'xdg-open',
        [url],
        {
          detached:true,
          stdio:'ignore'
        }
      ).unref();
    }
  } catch {}
}

let watcher = null;
let dataWatcher = null;
let watchTimer = null;
let safetyTimer = null;

function scheduleRescan(
  message
) {
  clearTimeout(
    watchTimer
  );

  watchTimer =
    setTimeout(
      () => {
        scanAll(
          message
        ).catch(
          error => {
            logStep(
              `自动更新失败：${error.message}`
            );
          }
        );
      },
      1200
    );
}

function startAutoWatch() {
  try {
    dataWatcher = fs.watch(DATA_DIR, {persistent:true, recursive:process.platform === 'win32'}, (eventType, name) => {
      // 文件夹批量粘贴后尽快索引，macOS/Linux 的深层目录仍由定时扫描兜底。
      scheduleRescan('新增素材目录…');
    });
    dataWatcher.on('error', () => {});
  } catch {}
  try {
    watcher =
      fs.watch(
        targetDir,
        {
          persistent:true
        },
        (
          eventType,
          fileName
        ) => {
          const name =
            String(
              fileName || ''
            );

          // 缓存目录自身变化不触发再次扫描。
          if (
            name ===
              path.basename(
                CACHE_DIR
              ) ||
            name.startsWith(
              path.basename(
                CACHE_DIR
              ) +
              path.sep
            )
          ) {
            return;
          }

          // 新视频通常带扩展名；已有 hash 文件删除/变化也允许触发 reconcile。
          if (
            name &&
            path.extname(
              name
            ) &&
            !MEDIA_EXTENSIONS.has(
              path
                .extname(name)
                .toLowerCase()
            )
          ) {
            return;
          }

          logStep(
            `目录变化：${eventType}${name ? ` · ${name}` : ''}`
          );

          scheduleRescan(
            '检测到目录变化，自动更新…'
          );
        }
      );

    watcher.on(
      'error',
      error => {
        logStep(
          `实时目录监控异常：${error.message}`
        );
      }
    );

    logStep(
      '实时监控：已启用 fs.watch'
    );
  } catch (error) {
    logStep(
      `实时监控启动失败：${error.message}`
    );
  }

  // Windows 的 fs.watch 偶尔会漏事件，因此每 15 秒兜底扫描。
  safetyTimer =
    setInterval(
      () => {
        scanAll(
          '15 秒兜底扫描…'
        ).catch(
          () => {}
        );
      },
      15000
    );

  if (
    safetyTimer &&
    typeof safetyTimer.unref ===
      'function'
  ) {
    safetyTimer.unref();
  }

  logStep(
    '兜底扫描：每 15 秒检查一次新增媒体'
  );
}

async function main() {
  if (BACKUPS_MODE) {
    printExternalBackups();
    return;
  }

  if (
    !fs.existsSync(
      targetDir
    ) ||
    !fs.statSync(
      targetDir
    ).isDirectory()
  ) {
    console.error(
      '目录不可用'
    );

    process.exit(1);
  }

  if (RESTORE_MODE) {
    const restored =
      await restoreFromExternalBackup(
        restoreBackupPath
      );

    if (!restored) {
      process.exitCode = 1;
      return;
    }
  }

  if (catalogLoadError) {
    console.error(
      catalogLoadError.message ||
      '缓存异常，已停止启动以保护历史数据'
    );

    process.exitCode =
      1;

    return;
  }

  // 如果主 data.json 损坏/丢失而使用了 .bak，先恢复主文件，
  // 后续扫描仍然基于历史 catalog，而不是空库。
  if (catalogLoadedFromBackup) {
    try {
      fs.mkdirSync(
        CACHE_DIR,
        { recursive:true }
      );

      const restored =
        DATA_FILE +
        '.restore-' +
        process.pid;

      fs.writeFileSync(
        restored,
        JSON.stringify(
          catalog,
          null,
          2
        ),
        'utf8'
      );

      if (fs.existsSync(DATA_FILE)) {
        fs.unlinkSync(DATA_FILE);
      }

      fs.renameSync(
        restored,
        DATA_FILE
      );
    } catch (error) {
      console.error(
        '缓存备份恢复失败，已停止启动'
      );

      process.exitCode =
        1;

      return;
    }
  }

    logStep(
    '已选择媒体目录'
  );

  persistLibrarySettings();

  const unlockedPassword = PWD_ENABLED ? await unlockLibrary() : null;

  if (PWD_ENABLED && !unlockedPassword) {
    if (nonTtyLineReader) nonTtyLineReader.close();
    process.exitCode = 2;
    return;
  }

  ensureDirs();
  ensureAiUsageNotice();

  try {
    ensureCatalogLibraryId();

    if (PWD_ENABLED) createEncryptedRunBackup(unlockedPassword);
  } catch (error) {
    console.error(
      '安全备份失败，已停止启动'
    );

    process.exitCode = 1;
    return;
  }


  logStep(
    `缓存：${CACHE_DIR}`
  );

  logStep(
    `ffprobe：${HAS_FFPROBE ? '已找到' : '未找到'}`
  );

  logStep(
    `ffmpeg：${HAS_FFMPEG ? '已找到' : '未找到'}`
  );

  recoverPendingImports();

  // v1.1.6：旧版缓存可能没有 kind 字段，启动时自动补齐 video / image。
  migrateLegacyItemKinds();

  // 旧缓存没有文件修改时间字段时，直接从真实媒体文件补齐。
  syncFileModificationTimes();

  // v1.1.1：把旧版本已经生成的 .jpg/.png 封面也改成无扩展名 hash。
  migrateLegacyCoverFiles();

  // 保留已完成的低清逐帧缓存，加速下次进入；未完成的任务会按需重新生成。
  pruneFramePreviewCache();
  fs.mkdirSync(DATA_DIR,{recursive:true});
  startServer();
  startAutoWatch();
  setTimeout(()=>sweepAudioDurations().catch(()=>{}),5000).unref?.();
  setInterval(()=>sweepAudioDurations().catch(()=>{}),300000).unref?.();

  setTimeout(
    () => {
      scanAll(
        '启动扫描…'
      ).catch(
        error => {
          void error;
        }
      );
    },
    250
  );
}

function shutdown() {
  try {
    if (watcher) watcher.close();
    if (dataWatcher) dataWatcher.close();
  } catch {}

  try {
    if (safetyTimer) {
      clearInterval(
        safetyTimer
      );
    }
  } catch {}

  process.exit(0);
}

process.on(
  'SIGINT',
  shutdown
);

process.on(
  'SIGTERM',
  shutdown
);

main().catch(
  error => {
    void error;

    console.error(
      '启动失败'
    );

    process.exitCode =
      1;
  }
);
