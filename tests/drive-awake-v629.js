// Isolated instrumentation: test real module's scheduling and read path without
// touching any user or test files. No filesystem write is possible.
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync(path.join(__dirname,'../src/server/70-watch-and-lifecycle.js'),'utf8');
const section=code.slice(code.indexOf('// USB drives can enter firmware/bridge standby'),code.indexOf('function scheduleRescan('));
assert.ok(section.includes('async function touchDriveReadOnly'));
const make=(disabled=false,withItems=true)=>{
 let timerMs=0,callback,opened=[],reads=[],dirs=[],fail=false;
 const context={
   args:disabled?['--no-drive-awake']:[],
   catalog:{items:withItems?[{state:'ready',size:90000000,key:'x'}]:[]},
   managedPath:()=>'/fake/媒体.mp4',targetDir:'/fake',Buffer,
   logStep:()=>{},
   fs:{promises:{
      open:async(f,flags)=>{opened.push([f,flags]);if(fail)throw Error('drive offline');return {
        stat:async()=>({isFile:()=>true,size:90000000}),
        read:async(buffer,offset,length,position)=>{reads.push({offset,length,position});return {bytesRead:length};},
        close:async()=>{}
      }},
      readdir:async(dir)=>{dirs.push(dir);}
   }},
   setInterval:(cb,ms)=>{timerMs=ms;callback=cb;return {unref:()=>{}}}
 };
 vm.createContext(context);vm.runInContext(section,context);
 return {context,info:()=>({timerMs,callback,opened,reads,dirs}),setFail:()=>{fail=true;}};
};
(async()=>{
 const a=make();vm.runInContext('startDriveAwake()',a.context);
 assert.strictEqual(a.info().timerMs,45000);
 await vm.runInContext('touchDriveReadOnly()',a.context);
 await vm.runInContext('touchDriveReadOnly()',a.context);
 assert.deepStrictEqual(a.info().opened.map(x=>x[1]),['r','r']);
 assert.strictEqual(a.info().reads.length,2);
 assert.ok(a.info().reads.every(x=>x.length===4096));
 assert.notStrictEqual(a.info().reads[0].position,a.info().reads[1].position);
 console.log('PASS 45-second read-only timer; no writes; rotating read offsets');
 const b=make(true);vm.runInContext('startDriveAwake()',b.context);
 assert.strictEqual(b.info().timerMs,0);
 console.log('PASS disable flag stops timer');
 const c=make(false,false);await vm.runInContext('touchDriveReadOnly()',c.context);
 assert.deepStrictEqual(c.info().dirs,['/fake']);
 console.log('PASS empty library falls back to directory read');
 const d=make();d.setFail();await vm.runInContext('touchDriveReadOnly()',d.context);
 assert.ok(d.info().dirs.length===1);
 console.log('PASS inaccessible media recovers without throwing or writing');
})().catch(e=>{console.error(e);process.exit(1)});
