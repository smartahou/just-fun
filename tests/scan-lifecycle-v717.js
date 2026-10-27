// Dedicated regression for periodic scan storm / media drive-awake safeguards.
const assert=require('assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/server/30-media-library.js'),'utf8');
const start=source.indexOf('let scanRunning = false;');
const end=source.indexOf('// 统一媒体标注。',start);
assert(start>=0&&end>start);
const code=source.slice(start,end);
const sleep=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
 let passes=0,concurrent=0,maxConcurrent=0;
 let releaseFirst;
 const gate=new Promise(resolve=>{releaseFirst=resolve});
 const context={setImmediate,Promise,logStep(){},recoverPendingImports(){},ingestNewFiles(){},ingestDataTree(){},ingestSourceTree(){},reconcileCatalog(){},syncFileModificationTimes(){},
   async enrichCatalog(){passes++;concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);if(passes===1)await gate;concurrent--;}};
 vm.createContext(context);vm.runInContext(code+'\nthis.scanAll=scanAll;this.scanning=()=>scanRunning;',context);
 const first=context.scanAll('initial');
 await sleep();assert(context.scanning());
 await Promise.all(Array.from({length:50},()=>context.scanAll('coalesced')));
 assert.equal(passes,1,'50 simultaneous watcher events should not re-enter scanner');
 releaseFirst();await first;
 assert.equal(passes,2,'Burst must produce exactly one trailing scan');
 assert.equal(maxConcurrent,1,'No overlapping scanners');
 assert.equal(context.scanning(),false,'Scan flag must reset');
 await context.scanAll('idle again');assert.equal(passes,3);
 const lifecycle=fs.readFileSync(path.join(root,'src/server/70-watch-and-lifecycle.js'),'utf8');
 assert.match(lifecycle,/if \(scanRunning\) return;\s*scanAll\(/,'periodic scan should not queue while scanner active');
 assert.match(code,/if \(rescanPending\) await new Promise\(resolve => setImmediate\(resolve\)\)/);
 assert(!lifecycle.includes('catalog.items.filter(x => x.state'), 'Keepalive should avoid rebuilding large ready-item arrays');
 console.log('SCAN LIFECYCLE V717 PASS: 50 watcher events -> 2 serial scans; no extra fallback during active scans');
})().catch(e=>{console.error(e);process.exitCode=1});
