/*
 * Just Fun - MIT-licensed source code. See LICENSE.
 * 开源授权仅涉及项目有权许可的源码，不涉及用户自己的私人媒体、书籍、笔记、
 * 缓存索引、元数据、密码和 API Key；使用这些个人数据仍须获得数据权利人同意。
 * Open-source code licensing does not license individual users' private data.
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

// TAR PAX extended headers and macOS AppleDouble artifacts sometimes have
// misleading .mp3/.mp4 names. They are metadata, never playable media.
function isArchiveSidecar(name){
  // Generated video audio companion must retain its physical filename and not
  // appear as an independent catalog media item (or be hash-renamed).
  if(/\.justfun-audio-[a-f0-9]{16}-[a-f0-9]{10}\.mp3$/i.test(String(name||'')))return true;
  const part=String(name||'');
  return /^PaxHeader(?:s(?:\.[^/\\]+)?)?$/i.test(part) ||
    /^__MACOSX$/i.test(part) || /^\._/.test(part) || /^\.DS_Store$/i.test(part);
}
// A few unpackers materialize PAX records as tiny fake *.mp3 files even
// outside a PaxHeader directory. Only reject a recognizable PAX header,
// never filter legitimate short recordings based on size alone.
function isPaxHeaderPayload(file,stat){
  if(!stat||stat.size<=0||stat.size>8192)return false;
  let fd;
  try{
    fd=fs.openSync(file,'r');
    const bytes=Buffer.alloc(Math.min(256,stat.size));
    const n=fs.readSync(fd,bytes,0,bytes.length,0);
    return /^\d{1,6} (?:path|linkpath|mtime|atime|ctime|uid|gid|SCHILY\.[^\s=]+|LIBARCHIVE\.[^\s=]+)=/.test(bytes.toString('utf8',0,n));
  }catch{return false;}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
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

  if(item.livePhoto===true && VIDEO_EXTENSIONS.has(String(item.originalExt||'').toLowerCase()))return 'image';
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
// Safe, read-only preflight: never request or inspect a real media library.
const DOCTOR_MODE = args.includes('--doctor');
// Preferred port only; the listener selects a free local port if it is occupied.
const specifiedPort=getArgValue('--port');
// Preserve legacy --port=0 meaning "use the default" (used by older scripts).
const PORT=specifiedPort && specifiedPort!=='0' ? Number(specifiedPort) : 3865;
if(!Number.isInteger(PORT) || PORT<1 || PORT>65535){
  console.error('端口号必须是 1 到 65535 的整数');
  process.exit(2);
}
// 安全策略：服务只监听本机回环地址，禁止局域网设备访问。
// 即使传入 --host 参数也不会改变监听地址。
const HOST = '127.0.0.1';

// A visible, native cooked terminal line enables Windows Chinese IME, selection,
// paste and backspace.  Password entry still uses its separate hidden reader.
// Read only one byte at a time so a pipe can supply later password responses.
function readLibraryDirectory(question='请输入媒体目录（可见、支持粘贴）：') {
  process.stdout.write(question);
  const tty=Boolean(process.stdin.isTTY);
  const wasRaw=Boolean(tty && process.stdin.isRaw);
  const bytes=[];
  const byte=Buffer.allocUnsafe(1);
  try {
    // The OS line editor must see the keys, especially Chinese IME composition.
    if(tty && wasRaw && process.stdin.setRawMode)process.stdin.setRawMode(false);
    while(true){
      let n;
      try{n=fs.readSync(0,byte,0,1,null);}
      catch(e){if(e.code==='EAGAIN'||e.code==='EINTR')continue;throw e;}
      if(!n)break;
      const c=byte[0];
      if(c===10 || (tty && c===13))break;
      if(c===13)continue; // Consume piped CRLF as one line ending.
      if(!tty && (c===127||c===8)){
        // Piped input has no terminal line editing. Erase one UTF-8 code point.
        if(bytes.length){bytes.pop();while(bytes.length && (bytes[bytes.length-1]&0xc0)===0x80)bytes.pop();}
        continue;
      }
      if(c<32 && c!==9)continue;
      if(bytes.length>=16384)throw new Error('输入过长');
      bytes.push(c);
    }
  }finally{
    if(tty && wasRaw && process.stdin.setRawMode)process.stdin.setRawMode(true);
    // Interactive consoles echo their own newline; pipes don't.
    if(!tty)process.stdout.write('\n');
  }
  const raw=Buffer.from(bytes);
  let result;
  try { result=new TextDecoder('utf-8',{fatal:true}).decode(raw); }
  catch(error){
    // Some legacy Windows consoles/pipes still supply CP936 (GBK) path bytes.
    if(process.platform!=='win32')throw new Error('输入的目录不是有效的 UTF-8 路径');
    result=new TextDecoder('gb18030',{fatal:true}).decode(raw);
  }
  result=result.trim().replace(/^['"]|['"]$/g,'');
  if(!result)throw new Error('未输入有效媒体目录');
  return path.resolve(result);
}

const LEGACY_BACKUP_LIST = BACKUPS_MODE;
const REQUEST_HASH = args.includes('--hash');
const REQUEST_PWD = args.includes('--pwd');
const allowed = new Set(['--hash','--pwd','--no-screenshot','--refresh','--backups','--restore','--doctor']);
for(let i=0;i<args.length;i++) {
  const a=args[i];
  if(a==='--port' || a==='--host'){i++;continue;}
  if(!allowed.has(a) && !a.startsWith('--port=') && !a.startsWith('--host=')) {
    console.error('不再接受命令行媒体路径；请运行 node douyin [--hash] [--pwd]，然后输入目录。');
    process.exit(2);
  }
}
// --backups retains the legacy backup listing without requesting a directory.
const targetDir = (LEGACY_BACKUP_LIST || DOCTOR_MODE) ? process.cwd() : readLibraryDirectory();
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