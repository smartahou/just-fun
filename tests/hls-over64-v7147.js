#!/usr/bin/env node
'use strict';
// v7.147: real >64 MiB text manifests, bounded streaming, no user's media.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/server/35-hls-playlists.js'),'utf8');
async function run(hash){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jf-hls-oversize-'));
  try{
    const original='long.m3u8',filename=hash?'a'.repeat(32):original;
    const playlist=path.join(root,filename);
    const fd=fs.openSync(playlist,'w');
    try{
      fs.writeSync(fd,'#EXTM3U\n#EXT-X-VERSION:3\n');
      const line='# '+('x'.repeat(20*1024))+'\n#EXTINF:4.0,\npart.ts\n';
      for(let i=0;i<3400;i++)fs.writeSync(fd,line);
      fs.writeSync(fd,'#EXT-X-ENDLIST\n');
    }finally{fs.closeSync(fd);}
    assert(fs.statSync(playlist).size>64*1024*1024,'must exceed 64 MiB');
    fs.writeFileSync(path.join(root,'part.ts'),'fixture segment');
    const item={key:'1234567890abcdef',originalName:original,managedName:filename,
      originalExt:'.m3u8',state:'ready',relativeDir:''};
    const catalog={items:[item],folders:[]};
    let writes=0;
    const ctx={fs,path,crypto,Buffer,catalog,targetDir:root,HASH_ENABLED:hash,
      MIME_BY_EXT:{'.ts':'video/mp2t'},safeMediaRelativeDir:x=>x,
      safeManagedName:name=>/^[a-f0-9]{32}$/.test(name),
      managedPath:entry=>path.join(root,entry.managedName),
      saveCatalog:()=>{writes++;},streamMedia:()=>{throw Error('segment unnecessary');}};
    vm.createContext(ctx);
    vm.runInContext(source,ctx,{filename:'35-hls-playlists.js'});
    await ctx.jfHlsScan();
    assert.equal(item.hlsError,undefined,'valid >64 MiB playlist should index');
    assert.equal(item.hlsAssets.length,1);
    assert(ctx.jfHlsReady(item));
    const saved=item.hlsAssets[0];
    if(hash)assert.match(path.basename(saved.stored),/^[a-f0-9]{32}$/);
    const out={status:0,size:0,mapped:0,done:false,
      writeHead(status){this.status=status;},
      write(text){
        this.size+=Buffer.byteLength(text);
        if(text.includes('/api/hls/'+item.key+'/'+saved.id+'.ts'))this.mapped++;
        return true;
      },
      end(){this.done=true;},
      destroyed:false
    };
    await ctx.jfHlsServe({method:'GET'},out,item);
    assert.equal(out.status,200);
    assert(out.done,'stream terminates');
    assert(out.size>64*1024*1024,'streamed rewritten manifest, no truncation');
    assert.equal(out.mapped,3400,'all original segment references rewritten');
    const first=vm.runInContext('jfHlsRuntime',ctx)(item),savedWrites=writes;
    await ctx.jfHlsScan();
    assert.equal(item.hlsError,undefined);
    assert.strictEqual(vm.runInContext('jfHlsRuntime',ctx)(item),first,
      'repeat scan reuses index cache');
    assert.equal(writes,savedWrites,'repeat scan does not rewrite catalog');
    console.log('PASS >64 MiB HLS stream '+(hash?'Hash':'original')+
      ' '+(out.size/1048576).toFixed(1)+' MiB');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
(async()=>{await run(false);await run(true);})().catch(error=>{
  console.error(error.stack||error);process.exitCode=1;
});
