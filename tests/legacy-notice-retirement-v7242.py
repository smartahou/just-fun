#!/usr/bin/env python3
"""Retire obsolete generated AI notice without touching private media or edited files."""
from pathlib import Path
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
SECURITY=(ROOT/'src/server/10-security-and-settings.js').read_text(encoding='utf8')
CATALOG=(ROOT/'src/server/20-catalog-and-backup.js').read_text(encoding='utf8')
LIFECYCLE=(ROOT/'src/server/70-watch-and-lifecycle.js').read_text(encoding='utf8')

checks=[
 ('Do not regenerate notice', 'const AI_USAGE_NOTICE =' not in SECURITY and 'function ensureAiUsageNotice()' not in SECURITY),
 ('No seeded catalog notice', 'aiUsageNotice: AI_USAGE_NOTICE' not in CATALOG),
 ('Loaded catalog removes old field', 'delete catalog.aiUsageNotice;' in CATALOG),
 ('Notice removed before future catalog writes', CATALOG.count('delete catalog.aiUsageNotice;')==2),
 ('Startup retires generated notice', 'retireLegacyGeneratedNotice();' in LIFECYCLE),
 ('Other access and vault protections remain', 'const ERASE_AFTER_THREE=HASH_ENABLED && PWD_ENABLED;' in SECURITY),
]
for name,ok in checks:
    assert ok,name
    print('PASS',name,flush=True)

js=r'''
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),os=require('node:os'),assert=require('node:assert/strict');
const root=process.argv[1];
const text=fs.readFileSync(path.join(root,'src/server/10-security-and-settings.js'),'utf8');
const a=text.indexOf('const LEGACY_GENERATED_NOTICE_DIGESTS = new Set([');
const b=text.indexOf('const SECURITY_FILE',a);
assert(a>=0&&b>a,'need exact retirement helper');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jf-notice-v7242-'));
const filename=path.join(temp,'AI_USAGE_NOTICE.txt');
let count=0;
function test(name,fn){fn();count++;console.log('PASS',name);}
const sandbox={fs,path,crypto,CACHE_DIR:temp,console:{warn:()=>{}}};
vm.runInNewContext(text.slice(a,b)+'\nthis.retire=retireLegacyGeneratedNotice;',sandbox);
const retire=sandbox.retire;
const stock=fs.readFileSync(path.join(root,'tests/reference/v6.21.douyin.js'),'utf8');
const legacyMatch=stock.match(/const AI_USAGE_NOTICE = \[[\s\S]*?\]\.join\('\\n'\);/);
assert(legacyMatch,'historic fixture is needed for known old notice');
const legacy={};vm.runInNewContext(legacyMatch[0]+'\nthis.value=AI_USAGE_NOTICE;',legacy);
const old=legacy.value+'\n';
const newNotice=[
 '用户私人数据使用说明 / Private user data notice',
 'Just Fun 项目源码的许可以仓库 LICENSE 为准。源码开源不代表用户私人媒体、书籍、笔记、缓存索引、元数据、密码或 API Key 获得公开授权。',
 '未经数据权利人同意，请勿收集、传播或向 AI 等外部服务发送他人的私人资料。',
 '用户自行决定是否将自己的内容用于 AI 分析；本说明并非加密或访问控制。'
].join('\n')+'\n';
try {
  test('Absent generated notice stays absent',()=>{retire();assert.equal(fs.existsSync(filename),false);});
  test('Original v6.21 generated notice removed',()=>{fs.writeFileSync(filename,old);retire();assert.equal(fs.existsSync(filename),false);});
  test('Updated v7.24.1 generated notice removed',()=>{fs.writeFileSync(filename,newNotice);retire();assert.equal(fs.existsSync(filename),false);});
  test('User-edited notice is preserved',()=>{const own=old+'my custom annotation';fs.writeFileSync(filename,own);retire();assert.equal(fs.readFileSync(filename,'utf8'),own);});
  test('Unrelated local file not touched',()=>{const file=path.join(temp,'user-private.json');fs.writeFileSync(file,'{"my":"content"}');retire();assert.equal(fs.readFileSync(file,'utf8'),'{"my":"content"}');});
  test('Oversize notice-like file is preserved',()=>{fs.writeFileSync(filename,newNotice+'x'.repeat(3000));retire();assert(fs.existsSync(filename));});
  test('Symbolic link never followed or removed',()=>{
    const user=path.join(temp,'user.md');fs.writeFileSync(user,old);fs.rmSync(filename);
    try { fs.symlinkSync(user,filename); } catch(e) { if(e.code==='EPERM'||e.code==='EACCES') { console.log('SKIP symbolic-link restriction on this OS'); return; } throw e; }
    retire();assert(fs.lstatSync(filename).isSymbolicLink());assert.equal(fs.readFileSync(user,'utf8'),old);
  });
  test('Repeated cleanup does not recreate any file',()=>{fs.rmSync(filename);retire();retire();assert(!fs.existsSync(filename));});
  console.log('RUNTIME TOTAL',count,'PASS');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
'''
p=subprocess.run(['node','-e',js,str(ROOT)],capture_output=True,text=True,timeout=20)
if p.returncode:
    print(p.stdout,p.stderr,flush=True)
    raise SystemExit(p.returncode)
print(p.stdout,end='',flush=True)
print('TOTAL',len(checks)+8,'PASS',flush=True)
