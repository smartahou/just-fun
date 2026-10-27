const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const vault=fs.readFileSync(path.join(root,'src/server/15-metadata-vault.js'),'utf8');
const recover=fs.readFileSync(path.join(root,'src/server/46e-reading-recovery.js'),'utf8');
const begin=vault.indexOf('const VAULT_FORMAT='),end=vault.indexOf('function vaultMigrateOne(',begin);
assert(begin>=0&&end>begin);
const source=vault.slice(begin,end)+'\n'+recover+'\n;({vaultUnlock,vaultReadBytes,vaultWriteBytes,inspect:jfReadingRecoveryStatus,restore:jfReadingRestoreBackup})';
let passed=0;
function trial(encrypted,scenario){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'jf-v715-recovery-'));
  const cache=path.join(base,'cache'),reading=path.join(cache,'reading');fs.mkdirSync(reading,{recursive:true});
  const main=path.join(reading,'workspace.json'),backup=main+'.bak';
  let inject=false;
  const proxy=new Proxy(fs,{get(target,key){
    if(key==='renameSync')return(a,b)=>{
      if(inject&&b===main){inject=false;throw Error('INJECTED_MAIN_COMMIT');}
      return fs.renameSync(a,b);
    };return Reflect.get(target,key);
  }});
  const ctx={fs:proxy,crypto,path,Buffer,process,Error,require,console,
    PWD_ENABLED:encrypted,CACHE_DIR:cache,VAULT_SALT_FILE:path.join(cache,'vault.json'),
    DATA_FILE:path.join(cache,'data.json'),DATA_BACKUP_FILE:path.join(cache,'data.json.bak'),
    JF_READING_DATA:main,JF_READING_BACKUP:backup,
    jfReaderError:(status,message)=>Object.assign(Error(message),{status})};
  try{
    const f=vm.runInNewContext(source,ctx,{timeout:10000});
    if(encrypted)f.vaultUnlock('recovery-isolated-password');
    const doc=n=>Buffer.from(JSON.stringify({version:1,revision:n,notes:[],marks:[],progress:{},private:'secret-'+n}));
    const a=doc(3),b=doc(4);
    const write=(file,bytes)=>f.vaultWriteBytes(file,bytes,{durable:true});
    const valid=()=>f.inspect();
    if(scenario==='healthy-main'){
      write(main,b);write(backup,a);
      const s=valid();assert.equal(s.main.state,'valid');assert.equal(s.backup.revision,3);
      assert.equal(s.recoverable,false);
      assert.throws(()=>f.restore({action:'restore-backup',confirm:'RESTORE_BACKUP',expectedRevision:3,expectedSha256:s.backup.sha256}),/禁止旧备份覆盖/);
      assert(f.vaultReadBytes(main).equals(b));
    }else if(scenario==='missing-main'){
      write(backup,a);const s=valid();assert.equal(s.main.state,'missing');assert.equal(s.recoverable,true);
      const out=f.restore({action:'restore-backup',confirm:'RESTORE_BACKUP',expectedRevision:3,expectedSha256:s.backup.sha256});
      assert.equal(out.originalPreserved,false);assert.equal(out.mainVerified,true);
      assert(f.vaultReadBytes(main).equals(a));assert(f.vaultReadBytes(backup).equals(a));
    }else if(scenario==='corrupt-main'){
      write(backup,a);write(main,b);
      const orig=Buffer.from('garbled original, do not discard');fs.writeFileSync(main,orig);
      const s=valid();assert.equal(s.main.state,'invalid');assert.equal(s.recoverable,true);
      const out=f.restore({action:'restore-backup',confirm:'RESTORE_BACKUP',expectedRevision:3,expectedSha256:s.backup.sha256});
      assert.equal(out.originalPreserved,true);assert(f.vaultReadBytes(main).equals(a));
      const snapshots=fs.readdirSync(reading).filter(x=>x.includes('.damaged-'));
      assert.equal(snapshots.length,1);assert(fs.readFileSync(path.join(reading,snapshots[0])).equals(orig));
      if(encrypted)assert(!fs.readFileSync(main,'utf8').includes('secret-3'));
    }else if(scenario==='reject-unconfirmed'){
      write(backup,a);const s=valid();
      for(const fields of [{},{confirm:'RESTORE_BACKUP'},{action:'restore-backup'},{action:'restore-backup',confirm:'NO'}])
        assert.throws(()=>f.restore({...fields,expectedRevision:3,expectedSha256:s.backup.sha256}),/明确确认/);
      assert(!fs.existsSync(main));
    }else if(scenario==='reject-stale'){
      write(backup,a);const s=valid();write(backup,b);
      assert.throws(()=>f.restore({action:'restore-backup',confirm:'RESTORE_BACKUP',expectedRevision:3,expectedSha256:s.backup.sha256}),/备份已变化/);
      assert(!fs.existsSync(main));
    }else if(scenario==='corrupt-backup'){
      write(backup,a);fs.writeFileSync(backup,'tampered backup');
      assert.equal(valid().recoverable,false);
      assert.throws(()=>f.restore({action:'restore-backup',confirm:'RESTORE_BACKUP',expectedRevision:3,expectedSha256:'x'}),/没有可认证/);
      assert(!fs.existsSync(main));
    }else if(scenario==='symlink-backup'){
      fs.symlinkSync(path.join(base,'outside'),backup);
      assert.equal(valid().recoverable,false);
      assert.throws(()=>f.restore({action:'restore-backup',confirm:'RESTORE_BACKUP',expectedRevision:3,expectedSha256:'x'}),/没有可认证/);
    }else if(scenario==='dangling-symlink-main'){
      write(backup,a);fs.symlinkSync(path.join(base,'missing-outside'),main);
      assert.equal(valid().main.state,'invalid');
      const s=valid();
      assert.throws(()=>f.restore({action:'restore-backup',confirm:'RESTORE_BACKUP',expectedRevision:3,expectedSha256:s.backup.sha256}),/主文件类型异常/);
      assert(fs.lstatSync(main).isSymbolicLink());
    }else if(scenario==='commit-fault'){
      write(backup,a);fs.writeFileSync(main,'invalid persisted bytes');const before=fs.readFileSync(main);
      const s=valid();inject=true;
      assert.throws(()=>f.restore({action:'restore-backup',confirm:'RESTORE_BACKUP',expectedRevision:3,expectedSha256:s.backup.sha256}),/INJECTED_MAIN_COMMIT/);
      assert(fs.readFileSync(main).equals(before));assert(f.vaultReadBytes(backup).equals(a));
      assert.equal(fs.readdirSync(reading).filter(x=>x.includes('.damaged-')).length,1);
    }else throw Error('Unknown scenario');
    assert(fs.readdirSync(reading).every(x=>!x.includes('.tmp-')));
    passed++;
  }finally{fs.rmSync(base,{recursive:true,force:true});}
}
for(const encrypted of [false,true])for(const s of [
  'healthy-main','missing-main','corrupt-main','reject-unconfirmed','reject-stale',
  'corrupt-backup','symlink-backup','dangling-symlink-main','commit-fault'])trial(encrypted,s);
const router=fs.readFileSync(path.join(root,'src/server/60-http-router.js'),'utf8');
assert(router.includes("url.pathname==='/api/reading/recovery' && req.method==='GET'"));
assert(router.includes("url.pathname==='/api/reading/recovery' && req.method==='POST'"));
assert(router.includes('jfReadingCheckOrigin(req)'));
console.log('PASS v7.15 authenticated recovery: '+passed+' plaintext/AES-GCM scenarios, fail-closed restore, no silent migration.');
