'use strict';
// v7.12: preflight has zero write capability; transaction rehearsal uses temp dirs only.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/server/46c-reading-migration-preflight.js'),'utf8');
const imageSource=fs.readFileSync(path.join(root,'src/server/46a-reading-image-identity.js'),'utf8');
const vaultSource=fs.readFileSync(path.join(root,'src/server/15-metadata-vault.js'),'utf8');
const asPlain=x=>JSON.parse(JSON.stringify(x));
const error=(status,message)=>Object.assign(new Error(message),{status});
function jpeg(seed){
 const bytes=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),crypto.createHash('sha256').update(seed).digest(),Buffer.alloc(85,35),Buffer.from([0xff,0xd9])]);
 return {bytes,uri:'data:image/jpeg;base64,'+bytes.toString('base64'),sha:crypto.createHash('sha256').update(bytes).digest('hex')};
}
const a=jpeg('alpha'),b=jpeg('beta');
const main={version:1,revision:9,progress:{},marks:[],notes:[
 {id:'a'.repeat(24),quotes:[{type:'image',image:a.uri,chapter:2,pages:[{image:a.uri,chapter:2},{image:b.uri,chapter:3}]}]},
 {id:'b'.repeat(24),quotes:[{type:'image',image:a.uri,chapter:0}]}]};
const report={ok:true,issues:[],workspaceVersion:1,revision:9,notes:2,marks:0,backup:{present:true,valid:true}};
const env={crypto,Buffer,jfReaderError:error,fs:{existsSync:()=>true,writeFileSync:()=>{throw Error('read-only violation');}},
 JF_READING_DATA:'/isolated/workspace.json',jfReadingIntegrity:()=>report,jfReadingLoad:()=>main};
const planner=vm.runInNewContext(imageSource+'\n'+source+'\n({manifest:jfReadingMigrationManifest,preview:jfReadingMigrationPreflight})',env,{timeout:3000});
const pre=JSON.stringify(main),m=planner.manifest(main);
assert.equal(JSON.stringify(main),pre);assert(Object.isFrozen(m));assert(Object.isFrozen(m.files));
assert.equal(m.embeddedCount,3);assert.equal(m.uniqueCount,2);assert.equal(m.duplicateReferences,1);
assert.equal(m.embeddedBytes,a.bytes.length*2+b.bytes.length);
assert.equal(m.uniqueBytes,a.bytes.length+b.bytes.length);
assert.deepEqual([...m.files].map(x=>x.imageRef).sort(),[a.sha,b.sha].sort());
for(const entry of m.files){assert(/^[a-f0-9]{64}$/.test(entry.imageRef));assert.equal(entry.relativePath,`objects/${entry.imageRef.slice(0,2)}/${entry.imageRef}.jpg`);}
const prev=asPlain(planner.preview());assert.equal(prev.ok,true);assert.equal(prev.migrationEnabled,false);
assert.equal(prev.dryRun,true);assert.equal(prev.snapshotRequired,false);
assert(!JSON.stringify(prev).includes(a.sha),'preflight must not expose image identity or user content');
assert.equal(JSON.stringify(main),pre);
env.jfReadingIntegrity=()=>({...report,ok:false,issues:['invalid_or_newer_backup'],backup:{valid:false}});
// This vm function resolves the context binding dynamically.
assert.equal(asPlain(planner.preview()).ok,false);
assert.equal(asPlain(planner.preview()).snapshotRequired,true);
env.jfReadingIntegrity=()=>report;
for(const corrupt of [null,{version:2,revision:9,notes:[]},{version:1,revision:0,notes:[{quotes:'bad'}]},{version:1,revision:0,notes:[{quotes:[{type:'image',image:'invalid'}]}]}])
 assert.throws(()=>planner.manifest(corrupt));
// Verify that an authenticated backup is bound to the backup *path*, never movable raw.
const failures=['before_snapshot','after_snapshot','before_commit','after_commit'];
let checked=0;
for(const password of [false,true])for(const stage of failures){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jf-v712-txn-'));
 try{
  const cache=path.join(temp,'cache'),dir=path.join(cache,'reading');fs.mkdirSync(dir,{recursive:true});
  const primary=path.join(dir,'workspace.json'),backup=primary+'.bak';
  const context={Buffer,fs,path,crypto,CACHE_DIR:cache,PWD_ENABLED:password,
    VAULT_SALT_FILE:path.join(cache,'vault.json'),DATA_FILE:path.join(cache,'data.json'),
    DATA_BACKUP_FILE:path.join(cache,'data.json.bak')};
  const vault=vm.runInNewContext(vaultSource+'\n({vaultUnlock,vaultReadBytes,vaultWriteBytes,vaultDecrypt})',context);
  if(password)vault.vaultUnlock('fixture-password-not-from-user');
  const before=Buffer.from(JSON.stringify(main));
  const updated=Buffer.from(JSON.stringify({...main,revision:10}));
  vault.vaultWriteBytes(primary,before);
  assert(vault.vaultReadBytes(primary).equals(before));
  let hit='';
  try{
   if(stage==='before_snapshot')throw Error('fault: before_snapshot');
   vault.vaultWriteBytes(backup,vault.vaultReadBytes(primary));
   assert(vault.vaultReadBytes(backup).equals(before));
   if(password){
    assert.throws(()=>vault.vaultDecrypt(primary,fs.readFileSync(backup)),/认证失败/);
    assert.throws(()=>vault.vaultDecrypt(backup,fs.readFileSync(primary)),/认证失败/);
    assert.notEqual(fs.readFileSync(backup).toString(),before.toString());
   }
   if(stage==='after_snapshot')throw Error('fault: after_snapshot');
   if(stage==='before_commit')throw Error('fault: before_commit');
   vault.vaultWriteBytes(primary,updated);
   if(stage==='after_commit')throw Error('fault: after_commit');
  }catch(e){hit=e.message;}
  assert.equal(hit,'fault: '+stage);
  if(stage==='after_commit'){
   assert(vault.vaultReadBytes(primary).equals(updated));
   // Never rename or copy backup ciphertext to primary: re-encrypt using target AAD.
   vault.vaultWriteBytes(primary,vault.vaultReadBytes(backup));
  }
  assert(vault.vaultReadBytes(primary).equals(before));
  if(stage!=='before_snapshot')assert(vault.vaultReadBytes(backup).equals(before));
  checked++;
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
const route=fs.readFileSync(path.join(root,'src/server/60-http-router.js'),'utf8');
assert(route.includes("url.pathname==='/api/reading/migration-preflight' && req.method==='GET'"));
assert(!route.includes("url.pathname==='/api/reading/migration-preflight' && req.method==='POST'"));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build.manifest.json')));
assert(manifest.server.indexOf('src/server/46c-reading-migration-preflight.js')>manifest.server.indexOf('src/server/46b-reading-relations-audit.js'));
console.log(`PASS v7.12: pure read-only manifest, dedup, path-safe SHA mapping, ${checked} fault rehearsals (plaintext + path-bound AES-GCM), source unchanged`);
