'use strict';
// Read-only v2 compatibility contract; fixtures only. Never invokes a user workspace.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const vaultSource=fs.readFileSync(path.join(root,'src/server/15-metadata-vault.js'),'utf8');
const identitySource=fs.readFileSync(path.join(root,'src/server/46a-reading-image-identity.js'),'utf8');
const readSource=fs.readFileSync(path.join(root,'src/server/46d-reading-v2-readonly.js'),'utf8');
const fail=(code,msg)=>Object.assign(new Error(msg),{status:code});
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS',name);};
const jpeg=(name)=>Buffer.concat([Buffer.from([255,216,255,224]),crypto.createHash('sha256').update(name).digest(),Buffer.alloc(70,33),Buffer.from([255,217])]);
for(const secured of [false,true]){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jf-v713-object-'));
 try{
  const cache=path.join(temp,'cache'),reading=path.join(cache,'reading');fs.mkdirSync(reading,{recursive:true});
  const env={fs,path,crypto,Buffer,structuredClone,CACHE_DIR:cache,JF_READING_DIR:reading,
    PWD_ENABLED:secured,VAULT_SALT_FILE:path.join(cache,'vault.json'),
    DATA_FILE:path.join(cache,'data.json'),DATA_BACKUP_FILE:path.join(cache,'data.json.bak'),jfReaderError:fail};
  const model=vm.runInNewContext(vaultSource+'\n'+identitySource+'\n'+readSource+'\n({read:jfReadingV2ReadImage,path:jfReadingV2ObjectPath,hydrate:jfReadingV2HydrateWorkspace,write:vaultWriteBytes,unlock:vaultUnlock})',env);
  if(secured)model.unlock('isolated-password');
  const a=jpeg('A'),b=jpeg('B');const ref=x=>crypto.createHash('sha256').update(x).digest('hex');
  const uri=x=>'data:image/jpeg;base64,'+x.toString('base64');
  for(const bytes of [a,b]){const location=model.path(ref(bytes));fs.mkdirSync(path.dirname(location),{recursive:true});model.write(location,bytes);}
  const v2={version:2,revision:13,progress:{},marks:[],notes:[{id:'note-a',quotes:[
    {type:'image',imageRef:ref(a)},{type:'image',imageRef:ref(a)},{type:'image',image:uri(b)},
    {type:'image',imageRef:ref(a),pages:[{imageRef:ref(a),chapter:0},{imageRef:ref(b),chapter:1}]}
  ]}]};
  const before=JSON.stringify(v2);const p=model.hydrate(v2);
  check('v2 hydrate and dedup '+secured,()=>{
   assert.equal(p.version,1);assert.equal(p.notes[0].quotes[0].image,uri(a));assert.equal(p.notes[0].quotes[1].image,uri(a));
   assert.equal(p.notes[0].quotes[2].image,uri(b));assert.equal(p.notes[0].quotes[3].pages[1].image,uri(b));
   assert.equal(p.notes[0].quotes[3].image,uri(a));assert.equal(JSON.stringify(v2),before);
   assert(!JSON.stringify(p).includes('imageRef'));
  });
  check('v2 rejects malformed digest & path injection '+secured,()=>{
   for(const bad of ['../private','A'.repeat(64),'a'.repeat(63),'a'.repeat(65),'a'.repeat(62)+'/x','%2e%2e'])
    assert.throws(()=>model.path(bad));
   assert.throws(()=>model.hydrate({...v2,version:4}));
   assert.throws(()=>model.hydrate({...v2,notes:[{quotes:[{type:'image',imageRef:ref(a),image:uri(a)}]}]}));
   assert.throws(()=>model.hydrate({...v2,notes:[{quotes:[{type:'image',imageRef:ref(b),pages:[{imageRef:ref(a)}]}]}]}));
  });
  check('v2 wrong SHA and missing file fail closed '+secured,()=>{
   assert.throws(()=>model.read('f'.repeat(64)),/缺失/);
   const obj=model.path(ref(a)),raw=fs.readFileSync(obj);
   fs.writeFileSync(obj,Buffer.alloc(110,33));assert.throws(()=>model.read(ref(a)));
   fs.writeFileSync(obj,raw);
  });
  check('v2 rejects leaf and directory symlink '+secured,()=>{
   const obj=model.path(ref(a)),saved=obj+'.safe';fs.renameSync(obj,saved);fs.symlinkSync(saved,obj);
   assert.throws(()=>model.read(ref(a)),/文件类型/);fs.unlinkSync(obj);fs.renameSync(saved,obj);
   const dir=path.dirname(obj),renamed=dir+'.safe';fs.renameSync(dir,renamed);fs.symlinkSync(renamed,dir);
   assert.throws(()=>model.read(ref(a)),/目录类型/);fs.unlinkSync(dir);fs.renameSync(renamed,dir);
  });
  check('v2 path AAD forbids swapping encrypted objects '+secured,()=>{
   const objA=model.path(ref(a)),objB=model.path(ref(b)),blob=fs.readFileSync(objB);
   fs.writeFileSync(objA,blob);assert.throws(()=>model.read(ref(a)));
   if(secured) assert.notEqual(blob.toString(),b.toString());
  });
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
const src=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
check('production load remains Workspace v1-only',()=>assert(src.includes('d.version!==1')));
check('no v2 migration or write HTTP endpoints',()=>{
 const route=fs.readFileSync(path.join(root,'src/server/60-http-router.js'),'utf8');
 assert(!route.includes('/api/reading/migration-commit'));
 assert(!route.includes('/api/reading/v2-write'));
});
console.log('V2 READ-ONLY CONTRACT',count,'PASS');
