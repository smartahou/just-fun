// Regression: v7.09 byte budget remains enforced before ANY file operation.
// Test the actual jfReadingSave implementation with a simulated authenticated vault.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
const begin=source.indexOf('// v7.09: 64 MiB vaultReadBytes bounds'),end=source.indexOf('function jfReadingPublic()',begin);
assert(begin>=0&&end>begin);
let present=true;const prior=Buffer.from('{"version":1,"revision":4,"notes":[]}');
const records=[];let reads=0;
const stored=new Map([['/safe/workspace.json',prior]]);
const ctx={Buffer,fs:{existsSync:(p)=>p==='/safe/workspace.json'&&present},
  JF_READING_DATA:'/safe/workspace.json',JF_READING_BACKUP:'/safe/workspace.json.bak',
  vaultReadBytes:(p)=>{reads++;if(!stored.has(p))throw Error('missing');return Buffer.from(stored.get(p));},
  vaultWriteBytes:(p,bytes,options)=>{assert.equal(options?.durable,true);records.push({p,bytes:Buffer.from(bytes)});stored.set(p,Buffer.from(bytes));},
  jfReaderError:(status,msg)=>Object.assign(new Error(msg),{status})};
const s=vm.runInNewContext(source.slice(begin,end)+';({save:jfReadingSave,limit:JF_READING_JSON_SAFE_BYTES})',ctx,{timeout:2000});
assert.equal(s.limit,46*1024*1024);
let first={version:1,revision:5,notes:[{id:'a'.repeat(24),text:'中文\nabc'}]};s.save(first);
assert.equal(records.length,2);assert.equal(reads,3);
assert.equal(records[0].p,ctx.JF_READING_BACKUP);assert.deepEqual(records[0].bytes,prior);
assert.equal(records[1].p,ctx.JF_READING_DATA);assert.equal(records[1].bytes.toString('utf8'),JSON.stringify(first));
const saved=records.length;const origReads=reads;
const oversized={version:1,revision:6,notes:[{text:'x'.repeat(46*1024*1024)}]};
let e;try{s.save(oversized);}catch(err){e=err;}
assert(e);assert.equal(e.status,413);assert.equal(records.length,saved,'no backup/main write on rejected save');assert.equal(reads,origReads,'must reject before any read');
assert.deepEqual(prior,Buffer.from('{"version":1,"revision":4,"notes":[]}'));
present=false;records.length=0;s.save({version:1,revision:0,notes:[]});
assert.equal(records.length,1);assert.equal(records[0].p,ctx.JF_READING_DATA);
console.log('PASS v7.09 save budget: limit, encrypted-role backup ordering, verified writes and fail-close unchanged.');
