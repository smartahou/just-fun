// v7.07: frozen SHA-256 identities for legacy v1 JPEG data URIs. No disk writes.
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/server/46a-reading-image-identity.js'),'utf8');
const context={crypto,Buffer,jfReaderError:(code,message)=>Object.assign(new Error(message),{status:code})};
const assets=vm.runInNewContext(source+';({identity:jfReadingImageIdentity,inventory:jfReadingImageInventory})',context,{timeout:2000});
function jpeg(i){const buf=Buffer.concat([Buffer.from([255,216,255,224]),crypto.createHash('sha256').update(String(i)).digest(),Buffer.alloc(80,i%256),Buffer.from([255,217])]);return {buf,uri:'data:image/jpeg;base64,'+buf.toString('base64')};}
let count=0;
const a=jpeg(1),b=jpeg(2);for(let i=0;i<400;i++){
  const j=jpeg(i);const d=assets.identity(j.uri);
  assert(Object.isFrozen(d));assert.equal(d.imageRef,crypto.createHash('sha256').update(j.buf).digest('hex'));
  assert.equal(d.bytes,j.buf.length);assert.equal(d.format,'jpeg');count++;
}
const note={quotes:[{type:'image',image:a.uri},{type:'image',image:b.uri,pages:[{image:b.uri},{image:a.uri}]},{type:'image',image:a.uri}]};
const workspace={version:1,notes:[note,{quotes:[{type:'text',text:'ignored'}]}]};
const snapshot=JSON.stringify(workspace);
const tally=assets.inventory(workspace);
assert.equal(tally.embeddedCount,4);assert.equal(tally.uniqueCount,2);
assert.equal(tally.embeddedBytes,a.buf.length*2+b.buf.length*2);
assert.equal(tally.uniqueBytes,a.buf.length+b.buf.length);
assert.equal(JSON.stringify(workspace),snapshot);assert(Object.isFrozen(tally));
for(const bad of ['','data:image/png;base64,abc',a.uri.replace('jpeg','png'),'data:image/jpeg;base64,'+'A'.repeat(200),null]){
  assert.throws(()=>assets.identity(bad));
}
const server=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
assert(server.includes('jfReadingImageIdentity(image);'));
assert(server.includes('jfReadingImageIdentity(page.image);'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build.manifest.json'),'utf8'));
assert(manifest.server.indexOf('src/server/46a-reading-image-identity.js')>manifest.server.indexOf('src/server/46-reading-and-notes.js'));
console.log('PASS v7.07 image identity: '+count+' stable SHA/JPEG cases, duplicate accounting, invalid inputs, immutable report, v1 storage unchanged.');
