// Read-only integrity report: main workspace, independent authenticated backup,
// legacy JPEG inventory, invalid note IDs / marks, and no filesystem mutations.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
const begin=server.indexOf('function jfReadingIntegrity(){'),end=server.indexOf('function jfReadingAddMark(',begin);
assert(begin>=0&&end>begin);
const helper=fs.readFileSync(path.join(root,'src/server/46a-reading-image-identity.js'),'utf8');
const relationship=fs.readFileSync(path.join(root,'src/server/46b-reading-relations-audit.js'),'utf8');
const ctx={Buffer,crypto,jfReaderError:(status,message)=>Object.assign(new Error(message),{status})};
let main={version:1,revision:9,notes:[{id:'a'.repeat(24),quotes:[]}],marks:[{type:'page',bookId:'b'.repeat(16),chapter:1}]};
let backup=null,exists=false;
ctx.jfReadingLoad=()=>main;
ctx.JF_READING_BACKUP='/isolated/reading/workspace.json.bak';
ctx.fs={existsSync:(p)=>{assert.equal(p,ctx.JF_READING_BACKUP);return exists;},writeFileSync:()=>{throw Error('write in read-only audit');}};
ctx.vaultReadBytes=(p)=>{assert.equal(p,ctx.JF_READING_BACKUP);if(backup===null)throw Error('bad authentication');return Buffer.from(JSON.stringify(backup));};
const obj=vm.runInNewContext(helper+'\n'+relationship+'\n'+server.slice(begin,end)+'\n({integrity:jfReadingIntegrity})',ctx,{timeout:3000});
function plain(x){return JSON.parse(JSON.stringify(x));}
let before=JSON.stringify(main);let result=plain(obj.integrity());
assert.equal(result.ok,true);assert.deepEqual(result.issues,[]);assert.equal(result.backup.present,false);
assert.equal(result.notes,1);assert.equal(result.marks,1);assert.equal(result.images.uniqueCount,0);assert.equal(result.readOnly,true);
assert.equal(JSON.stringify(main),before);
exists=true;backup={version:1,revision:8,notes:[{id:'a'.repeat(24)}]};
result=plain(obj.integrity());assert.equal(result.backup.valid,true);assert.equal(result.backup.revision,8);assert.equal(result.ok,true);
backup={version:1,revision:10,notes:[]};result=plain(obj.integrity());
assert.equal(result.backup.valid,false);assert(result.issues.includes('invalid_or_newer_backup'));assert.equal(result.ok,false);
backup=null;result=plain(obj.integrity());assert.equal(result.backup.valid,false);
exists=false;
main={...main,notes:[...main.notes,{id:'a'.repeat(24),quotes:[]}],marks:[{type:'unexpected',bookId:'no',chapter:-1}]};
result=plain(obj.integrity());assert(result.issues.includes('duplicate_note_id'));assert(result.issues.includes('invalid_mark_reference'));
assert(!result.notChecked.includes('workspace')&&result.notChecked.includes('media-hashes'));
const router=fs.readFileSync(path.join(root,'src/server/60-http-router.js'),'utf8');
assert(router.includes("url.pathname==='/api/reading/integrity' && req.method==='GET'"));
assert(router.includes('sendJson(res,jfReadingIntegrity())'));
assert(server.includes('function jfReadingCheckOrigin(req)'));
console.log('PASS v7.08 read-only integrity: 6 scenarios, encrypted-backup AAD read boundary, no writes, scope disclosed.');
