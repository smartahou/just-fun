'use strict';
// Just Fun Windows/local deployment. Do not read or edit any user media library.
// Git history is maintained in GitHub; the installed runtime is separately replaceable.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const app = path.join(root, '.justfun-runtime');
const live = path.join(app, 'current.js');
const metaPath = path.join(app, 'current.json');
const backup = path.join(app, 'previous.js');
const backupMeta = path.join(app, 'previous.json');
const requiredPdfJs = '6.4.299';
const requiredPdfModuleSha = '57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2';
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const isFile = p => fs.existsSync(p) && fs.statSync(p).isFile();
function run(program, args, options = {}) {
  const r = cp.spawnSync(program, args, {cwd:root, encoding:'utf8', timeout:options.timeout||120000, maxBuffer:16*1024*1024, ...options});
  if(r.error || r.status!==0) throw Error(`${program} ${args.join(' ')}\n${r.stderr||r.stdout||r.error||'unknown failure'}`.slice(0,1800));
  return (r.stdout||'').trim();
}
const git = (...args) => run('git',args);
function nodeOk() {
  const [major,minor] = process.versions.node.split('.').map(Number);
  if(!((major===22 && minor>=13) || major>=24))throw Error('需要 Node.js 22.13+ 或 24+（Node 23 不兼容）');
}
function readMeta(p) {try {return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}}
function isValid(js,info) {return !!(info && /^[a-f0-9]{64}$/.test(info.sha256||'') && isFile(js) && hash(js)===info.sha256);}
function writeJsonAtomic(dest,value) {
  const tmp=dest+'.tmp-'+process.pid;
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');
  try {fs.renameSync(tmp,dest);} catch(e){try{fs.rmSync(tmp,{force:true});}catch{}throw e;}
}
function recoverInterrupted() {
  fs.mkdirSync(app,{recursive:true});
  if(isValid(live,readMeta(metaPath)))return true;
  if(isValid(backup,readMeta(backupMeta))) {
    fs.copyFileSync(backup,live);
    writeJsonAtomic(metaPath,readMeta(backupMeta));
    console.log('检测到安装文件不一致，已自动恢复上一有效版本。');
    return true;
  }
  return false;
}
function current() {return recoverInterrupted()?readMeta(metaPath):null;}
function ensureRepo() {
  const actual=fs.realpathSync.native(path.resolve(git('rev-parse','--show-toplevel')));
  const expected=fs.realpathSync.native(root);
  if((process.platform==='win32'?actual.toLowerCase():actual)!==(process.platform==='win32'?expected.toLowerCase():expected))throw Error('请在 GitHub 克隆的 Just Fun 工程根目录使用更新器');
  if(git('branch','--show-current')!=='main')throw Error('更新器仅允许在 main 分支运行');
  if(git('status','--porcelain','--untracked-files=no'))throw Error('存在未提交的源码修改；更新已停止，以防覆盖本地工作');
  if(!git('remote'))throw Error('没有配置 GitHub origin 远程仓库');
}
function vendorOk() {
  try {
    const base=path.join(root,'node_modules','pdfjs-dist');
    const pkg=JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8'));
    return pkg.version===requiredPdfJs && ['build/pdf.min.mjs','build/pdf.worker.min.mjs','cmaps','standard_fonts'].every(x=>fs.existsSync(path.join(base,x))) && hash(path.join(base,'build/pdf.min.mjs'))===requiredPdfModuleSha;
  } catch {return false;}
}
function npmInstallCommand(platform=process.platform,comspec=process.env.ComSpec) {
  const args=['install','--no-save','--package-lock=false','--ignore-scripts','--omit=optional','--no-audit','--no-fund','pdfjs-dist@6.4.299'];
  if(platform==='win32') {
    // Node spawnSync cannot execute .cmd/.bat directly on Windows (EINVAL).
    // The command is deliberately fixed: never interpolate media paths or user input.
    return {program:comspec||'cmd.exe',args:['/d','/s','/c','npm.cmd '+args.join(' ')]};
  }
  return {program:'npm',args};
}
function ensureVendor() {
  if(vendorOk())return;
  console.log('首次准备锁定版本 PDF.js 6.4.299（需要 npm 网络或本机缓存）…');
  const command=npmInstallCommand();
  run(command.program,command.args,{timeout:240000,stdio:'inherit'});
  if(!vendorOk())throw Error('PDF.js 依赖未安装完整，保留原运行版本。');
}
function validateCandidate(stage,commit) {
  const pkg=JSON.parse(fs.readFileSync(path.join(stage,'package.json'),'utf8'));
  if(pkg.devDependencies?.['pdfjs-dist']!==requiredPdfJs)throw Error('PDF.js 锁定版本已变化；需要单独审查依赖升级');
  run(process.execPath,['scripts/build.js'],{cwd:stage,timeout:90000});
  const file=path.join(stage,'dist','douyin.js');
  const report=JSON.parse(fs.readFileSync(path.join(stage,'dist','build-report.json'),'utf8'));
  const sha256=hash(file);
  if(sha256!==report.sourceSha256 || report.pdfjsVersion!==requiredPdfJs || report.pdfjsAssets!==203 || report.pdfjsModuleSha256!==requiredPdfModuleSha)throw Error('候选构建的 SHA / PDF.js 资源校验失败');
  run(process.execPath,['--check',file],{cwd:stage,timeout:20000});
  const diag=JSON.parse(run(process.execPath,[file,'--doctor'],{cwd:stage,timeout:20000}));
  if(diag.mode!=='doctor'||diag.readOnly!==true||diag.mediaDirectoryTouched!==false||diag.nodeCompatible!==true)throw Error('候选只读 --doctor 校验失败');
  return {version:pkg.version,commit,sha256,pdfjsVersion:requiredPdfJs,updatedAt:new Date().toISOString(),file};
}
function publish(candidate) {
  fs.mkdirSync(app,{recursive:true});
  const previous=readMeta(metaPath);
  // Backup only an already verified executable. Do not replace the backup with an invalid one.
  if(isValid(live,previous)){
    fs.copyFileSync(live,backup);
    writeJsonAtomic(backupMeta,previous);
  }
  const temp=path.join(app,'.pending-'+process.pid+'.js');
  fs.copyFileSync(candidate.file,temp);
  if(hash(temp)!==candidate.sha256)throw Error('候选复制过程发生字节不一致');
  try {fs.renameSync(temp,live);} catch(e){fs.rmSync(temp,{force:true});throw e;}
  writeJsonAtomic(metaPath,{version:candidate.version,commit:candidate.commit,sha256:candidate.sha256,pdfjsVersion:candidate.pdfjsVersion,updatedAt:candidate.updatedAt});
}
function update({fetch=true}={}) {
  nodeOk();ensureRepo();const existing=current();
  const before=git('rev-parse','HEAD');
  if(fetch){console.log('检查 GitHub 正式分支…');run('git',['fetch','--no-tags','origin','main'],{stdio:'inherit',timeout:180000});}
  const target=fetch?git('rev-parse','FETCH_HEAD'):before;
  run('git',['merge-base','--is-ancestor',before,target]); // Never use reset/force or discard other commits.
  if(existing?.commit===target && isValid(live,existing)){
    console.log(`已是最新运行版 ${existing.version} (${target.slice(0,8)})`);return existing;
  }
  ensureVendor();
  let stage=null,attached=false;
  try{
    stage=fs.mkdtempSync(path.join(os.tmpdir(),'jf-deploy-'));
    git('worktree','add','--detach',stage,target);attached=true;
    // A junction on Windows; a directory symlink on POSIX. No vendor files are copied to Git.
    fs.symlinkSync(path.join(root,'node_modules'),path.join(stage,'node_modules'),process.platform==='win32'?'junction':'dir');
    console.log(`构建并验证 ${target.slice(0,8)} …`);
    const candidate=validateCandidate(stage,target);
    if(fetch && before!==target) {
      if(git('status','--porcelain','--untracked-files=no'))throw Error('构建期间出现源码修改，拒绝更新');
      git('merge','--ff-only',target);
    }
    publish(candidate);
    console.log(`更新成功：Just Fun ${candidate.version} / ${candidate.sha256.slice(0,16)}…`);
    return candidate;
  }finally{
    if(attached)try{git('worktree','remove','--force',stage);}catch(e){console.error('提示：临时工作树清理失败：'+e.message);}
    if(stage && fs.existsSync(stage))try{fs.rmSync(stage,{recursive:true,force:true});}catch{}
  }
}
function start(args) {
  nodeOk();const info=current();
  if(!info)throw Error('没有经过验证的运行版。请先双击「更新.cmd」完成首次构建。');
  console.log(`Just Fun ${info.version} (${info.commit.slice(0,8)})`);
  const p=cp.spawnSync(process.execPath,[live,...args],{cwd:root,stdio:'inherit'});
  if(p.error)throw p.error;
  process.exitCode=p.status ?? 1;
}
function rollback() {
  nodeOk();fs.mkdirSync(app,{recursive:true});
  const prev=readMeta(backupMeta);if(!isValid(backup,prev))throw Error('没有可验证的上一运行版，无法回退');
  const info=readMeta(metaPath);
  if(isValid(live,info)){
    const oldCopy=fs.readFileSync(live);
    const oldMeta=info;
    fs.copyFileSync(backup,live);writeJsonAtomic(metaPath,prev);
    fs.writeFileSync(backup,oldCopy);writeJsonAtomic(backupMeta,oldMeta);
  }else{fs.copyFileSync(backup,live);writeJsonAtomic(metaPath,prev);}
  console.log(`已切换为 ${prev.version}；仅回退程序，不修改源码或用户数据。`);
}
function main() {
  const [command,...args]=process.argv.slice(2);
  if(command==='start')start(args);
  else if(command==='update')update();
  else if(command==='prepare')update({fetch:false}); // Safe offline setup for test/first launch; only from checked-out HEAD.
  else if(command==='rollback')rollback();
  else if(command==='status'){
    const v=current();console.log(JSON.stringify({ready:!!v,...v},null,2));if(!v)process.exitCode=1;
  } else throw Error('用法：node scripts/local-deploy-v723.js <start|update|prepare|rollback|status>');
}
if(require.main===module){try{main();}catch(e){console.error('[Just Fun]',e.message);process.exitCode=1;}}
module.exports={current,update,rollback,validateCandidate,hash,npmInstallCommand};
