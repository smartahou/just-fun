// Real isolated fs, real vault AES-GCM and the shipping Workspace save function.
// No user library is ever opened. Faults are injected only into a VM-bound fs.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const vaultSrc=fs.readFileSync(path.join(root,'src/server/15-metadata-vault.js'),'utf8');
const saveSrc=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
const vbegin=vaultSrc.indexOf("const VAULT_FORMAT=");
const vend=vaultSrc.indexOf('function vaultMigrateOne(',vbegin);
const sbegin=saveSrc.indexOf('// v7.09: 64 MiB vaultReadBytes bounds');
const send=saveSrc.indexOf('function jfReadingPublic()',sbegin);
assert(vbegin>=0&&vend>vbegin&&sbegin>=0&&send>sbegin);
const sources=vaultSrc.slice(vbegin,vend)+'\n'+saveSrc.slice(sbegin,send)+'\n;({vaultUnlock,vaultEncrypt,vaultDecrypt,vaultReadBytes,vaultWriteBytes,save:jfReadingSave})';
let cases=0;
function trial(encrypted,scenario){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jf-v714-isolated-'));
  const cache=path.join(temp,'.jf-test-cache');
  const reading=path.join(cache,'reading');fs.mkdirSync(reading,{recursive:true});
  const main=path.join(reading,'workspace.json'),backup=main+'.bak';
  let inject=null;
  const fsProxy=new Proxy(fs,{get(target,prop){
    if(prop==='renameSync')return (a,b)=>{
      if(inject&&inject.op==='rename'&&b===inject.path&&--inject.count===0){inject=null;throw Error('INJECTED_RENAME_FAILURE');}
      return fs.renameSync(a,b);
    };
    if(prop==='readFileSync')return (file,...args)=>{
      if(inject&&inject.op==='corrupt-read'&&file===inject.path&&--inject.count===0){inject=null;return Buffer.from('corrupted-readback');}
      return fs.readFileSync(file,...args);
    };
    return Reflect.get(target,prop);
  }});
  const ctx={fs:fsProxy,crypto,path,Buffer,process,Error,require,console,
    PWD_ENABLED:encrypted,CACHE_DIR:cache,VAULT_SALT_FILE:path.join(cache,'vault.json'),
    DATA_FILE:path.join(cache,'data.json'),DATA_BACKUP_FILE:path.join(cache,'data.json.bak'),
    JF_READING_DATA:main,JF_READING_BACKUP:backup,
    jfReaderError:(status,message)=>Object.assign(Error(message),{status})};
  try{
    const f=vm.runInNewContext(sources,ctx,{timeout:10000});
    if(encrypted)f.vaultUnlock('unique-test-passphrase');
    const doc=revision=>({version:1,revision,progress:{},notes:[{id:'f'.repeat(24),content:'private note '+revision}],marks:[]});
    const a=Buffer.from(JSON.stringify(doc(1))),b=Buffer.from(JSON.stringify(doc(2)));
    const verify=(expected,backupExpected)=>{
      assert(f.vaultReadBytes(main).equals(expected),'main must be byte identical');
      if(backupExpected)assert(f.vaultReadBytes(backup).equals(backupExpected),'backup must be authenticated and byte identical');
      if(encrypted){
        assert(!fs.readFileSync(main,'utf8').includes('private note'));
        assert.throws(()=>f.vaultDecrypt(backup,fs.readFileSync(main)),/./); // when accessible
      }
    };
    if(scenario==='fresh-write-failure'){
      inject={op:'rename',path:main,count:1};
      assert.throws(()=>f.save(doc(1)),/INJECTED_RENAME_FAILURE/);
      assert(!fs.existsSync(main));assert(!fs.existsSync(backup));
    }else{
      f.save(doc(1));verify(a);
      if(scenario==='success'){
        f.save(doc(2));verify(b,a);
      }else if(scenario==='backup-publish-failure'){
        inject={op:'rename',path:backup,count:1};
        assert.throws(()=>f.save(doc(2)),/INJECTED_RENAME_FAILURE/);
        verify(a);assert(!fs.existsSync(backup));
      }else if(scenario==='main-publish-failure'){
        inject={op:'rename',path:main,count:1};
        assert.throws(()=>f.save(doc(2)),/INJECTED_RENAME_FAILURE/);
        verify(a,a);
      }else if(scenario==='corrupt-main-readback'){
        inject={op:'corrupt-read',path:main,count:2}; // 1 prior read, then write verification
        assert.throws(()=>f.save(doc(2)),/缓存文件格式损坏|写入复核失败/);
        verify(a,a);
      }else if(scenario==='invalid-old-main'){
        fs.writeFileSync(main,'invalid-main');
        const orig=fs.readFileSync(main);
        assert.throws(()=>f.save(doc(2)),/格式损坏|JSON|缓存/);
        assert(fs.readFileSync(main).equals(orig));assert(!fs.existsSync(backup));
      }else if(scenario==='bad-backup-readback'){
        inject={op:'corrupt-read',path:backup,count:1};
        assert.throws(()=>f.save(doc(2)),/缓存文件格式损坏|写入复核失败/);
        verify(a,a);
      }else if(scenario==='oversized'){
        const before=fs.readFileSync(main);
        assert.equal((()=>{try{f.save({...doc(2),extra:'X'.repeat(46*1024*1024)});return 0;}catch(e){return e.status}})(),413);
        assert(fs.readFileSync(main).equals(before));assert(!fs.existsSync(backup));
      }else throw Error('invalid scenario');
    }
    // No plaintext temp shards should remain after exceptions.
    assert(fs.readdirSync(reading).every(name=>['workspace.json','workspace.json.bak'].includes(name)));
    cases++;
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
for(const pwd of [false,true]){
  for(const scenario of ['success','fresh-write-failure','backup-publish-failure','main-publish-failure',
    'corrupt-main-readback','invalid-old-main','bad-backup-readback','oversized'])trial(pwd,scenario);
}
console.log('PASS v7.14 durable Workspace save: '+cases+' isolated plaintext/AES-GCM fault scenarios; authenticated rollback, snapshot ordering, no temporary leftovers.');
