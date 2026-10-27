'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=x=>fs.readFileSync(path.join(root,'src/server',x),'utf8');
const sources=['15-metadata-vault.js','46a-reading-image-identity.js','46d-reading-v2-readonly.js','46f-reading-v2-sandbox-transaction.js'].map(read).join('\n');
const err=(status,message)=>Object.assign(new Error(message),{status});
const jpeg=label=>Buffer.concat([Buffer.from([255,216,255,224]),crypto.createHash('sha256').update(label).digest(),Buffer.alloc(70,88),Buffer.from([255,217])]);
const a=jpeg('first'),b=jpeg('second'),uri=bytes=>'data:image/jpeg;base64,'+bytes.toString('base64');
const v1={version:1,revision:9,progress:{},marks:[],notes:[
  {id:'a'.repeat(24),quotes:[{type:'image',chapter:1,image:uri(a)},{type:'image',image:uri(a)},
    {type:'image',chapter:2,image:uri(a),pages:[{chapter:2,image:uri(a)},{chapter:3,image:uri(b)}]}]},
  {id:'b'.repeat(24),quotes:[{type:'text',text:'isolated data must survive'}]}]};
const faultStages=['before_objects','after_first_object','after_objects','before_backup','after_backup','before_commit','after_commit','after_verification'];
let checked=0;
const scenario=(encrypted,fault)=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'jf-v716-tx-'));
 try{
  const cache=path.join(base,'cache'),reading=path.join(base,'reading');
  fs.mkdirSync(reading);
  const main=path.join(reading,'workspace.json'),bak=main+'.bak',original=Buffer.from(JSON.stringify(v1));
  const env={Buffer,fs,path,os,crypto,structuredClone,JF_READING_DIR:reading,JF_READING_DATA:main,JF_READING_BACKUP:bak,
    JF_READING_JSON_SAFE_BYTES:46*1024*1024,JF_READING_IMAGE_PREFIX:'data:image/jpeg;base64,',
    PWD_ENABLED:encrypted,CACHE_DIR:base,VAULT_SALT_FILE:path.join(base,'vault.json'),DATA_FILE:path.join(base,'data.json'),DATA_BACKUP_FILE:path.join(base,'data.json.bak'),jfReaderError:err};
  const x=vm.runInNewContext(sources+'\n({unlock:vaultUnlock,write:vaultWriteBytes,read:vaultReadBytes,plan:jfReadingV2Plan,commit:jfReadingV2SandboxCommit,hydrate:jfReadingV2HydrateWorkspace,obj:jfReadingV2ObjectPath})',env,{timeout:20000});
  if(encrypted)x.unlock('temporary-isolated-secret');
  x.write(main,original,{durable:true});
  const before=JSON.stringify(v1),plan=x.plan(v1);
  assert.equal(plan.next.version,2);assert.equal(plan.objects.size,2);assert.equal(JSON.stringify(v1),before);
  const version=()=>JSON.parse(x.read(main).toString('utf8')).version;
  if(fault){
    assert.throws(()=>x.commit(v1,{failAt:fault}),/注入事务故障/);
    assert.equal(version(),1,`old main survives ${fault}`);
    assert(x.read(main).equals(original),`exact plaintext survives ${fault}`);
    if(fs.existsSync(bak))assert(x.read(bak).equals(original));
  }else{
    const out=x.commit(v1);assert.equal(out.committed,true);assert.equal(out.objects,2);
    assert.equal(version(),2);assert(x.read(bak).equals(original));
    const next=JSON.parse(x.read(main));
    const hydrated=x.hydrate(next);
    // Key insertion order is not semantic: deep structural equality matters.
    assert.deepEqual(JSON.parse(JSON.stringify(hydrated)),v1);
    for(const ref of plan.objects.keys()){
      const raw=fs.readFileSync(x.obj(ref));
      if(encrypted)assert(!raw.includes(Buffer.from([255,216,255,224])));
    }
    assert.equal(fs.readdirSync(path.join(reading,'objects')).length,2);
  }
  assert(fs.readdirSync(reading).every(x=>!x.includes('.tmp-')));
  checked++;
 }finally{fs.rmSync(base,{recursive:true,force:true});}
};
for(const secured of [false,true])for(const stage of [...faultStages,null])scenario(secured,stage);
// Existing corrupted or symlinked objects must never be overwritten or followed.
for(const encrypted of [false,true])for(const mode of ['corrupt-object','symlink-object','symlink-prefix']){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'jf-v716-tx-'));
 try{
  const reading=path.join(base,'reading');fs.mkdirSync(reading);
  const main=path.join(reading,'workspace.json'),bak=main+'.bak',original=Buffer.from(JSON.stringify(v1));
  const env={Buffer,fs,path,os,crypto,structuredClone,JF_READING_DIR:reading,JF_READING_DATA:main,JF_READING_BACKUP:bak,
    JF_READING_JSON_SAFE_BYTES:46*1024*1024,JF_READING_IMAGE_PREFIX:'data:image/jpeg;base64,',
    PWD_ENABLED:encrypted,CACHE_DIR:base,VAULT_SALT_FILE:path.join(base,'vault.json'),DATA_FILE:path.join(base,'data.json'),DATA_BACKUP_FILE:path.join(base,'data.json.bak'),jfReaderError:err};
  const x=vm.runInNewContext(sources+'\n({unlock:vaultUnlock,write:vaultWriteBytes,read:vaultReadBytes,plan:jfReadingV2Plan,commit:jfReadingV2SandboxCommit,obj:jfReadingV2ObjectPath})',env);
  if(encrypted)x.unlock('isolated-pass');x.write(main,original);
  const ref=[...x.plan(v1).objects.keys()][0],location=x.obj(ref);
  const objects=path.join(reading,'objects'),folder=path.dirname(location);
  const outside=path.join(base,'outside');fs.mkdirSync(outside);
  if(mode==='symlink-prefix'){
   fs.symlinkSync(outside,objects);
  }else{
   fs.mkdirSync(folder,{recursive:true});
   if(mode==='symlink-object')fs.symlinkSync(path.join(base,'outside-file'),location);
   else fs.writeFileSync(location,Buffer.from('corrupted object; do not replace'));
  }
  const before=mode==='corrupt-object'?fs.readFileSync(location):null;
  assert.throws(()=>x.commit(v1),/目录|校验|认证|缺失|异常/);
  assert(x.read(main).equals(original));assert(!fs.existsSync(bak));
  if(before)assert(fs.readFileSync(location).equals(before));
  checked++;
 }finally{fs.rmSync(base,{recursive:true,force:true});}
}
// Malformed and inconsistent input must fail before disk I/O.
const probe=fs.mkdtempSync(path.join(os.tmpdir(),'jf-v716-tx-'));
try{
 const cache=probe,reading=path.join(probe,'reading');fs.mkdirSync(reading);
 const env={Buffer,fs,path,os,crypto,structuredClone,JF_READING_DIR:reading,JF_READING_DATA:path.join(reading,'workspace.json'),JF_READING_BACKUP:path.join(reading,'workspace.json.bak'),JF_READING_JSON_SAFE_BYTES:46*1024*1024,JF_READING_IMAGE_PREFIX:'data:image/jpeg;base64,',PWD_ENABLED:false,CACHE_DIR:probe,jfReaderError:err};
 const x=vm.runInNewContext(sources+'\n({plan:jfReadingV2Plan,commit:jfReadingV2SandboxCommit})',env);
 for(const invalid of [{...v1,version:2},{...v1,notes:[{quotes:[{type:'image',image:uri(a),pages:[{image:uri(b)}]}]}]},{...v1,notes:[{quotes:[{type:'image',image:'x'}]}]}])assert.throws(()=>x.plan(invalid));
 assert.throws(()=>x.commit(v1),/初始状态/);
 checked++;
}finally{fs.rmSync(probe,{recursive:true,force:true});}
// Verify there is no production route. This implementation is an opt-in-free internal
// experimental transaction and cannot migrate user data.
const router=fs.readFileSync(path.join(root,'src/server/60-http-router.js'),'utf8');
assert(!router.includes('/api/reading/migration-commit'));assert(!router.includes('/api/reading/v2-write'));
console.log(`PASS v7.16 isolated v2 transaction: ${checked} scenarios; no production migration`);
