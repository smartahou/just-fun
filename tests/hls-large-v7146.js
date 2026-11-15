#!/usr/bin/env node
'use strict';
// No real media library is read. A >5 MiB synthetic VOD manifest exercises
// scan, Hash adoption, virtual response and idempotence without huge fixtures.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../src/server/35-hls-playlists.js'),'utf8');
function response(){
  return {status:0,headers:{},body:'',chunks:[],
    writeHead(status,headers){this.status=status;this.headers=headers;},
    write(chunk){this.chunks.push(String(chunk));return true;},
    end(body){if(body)this.chunks.push(String(body));this.body=this.chunks.join('');}};
}
(async()=>{\nfor(const hash of [false,true]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jf-large-hls-'));
  try{
    const original='long-recording.m3u8',managed=hash?'a'.repeat(32):original;
    const repeated='#EXTINF:1.000,Very long local recording\nsegment.ts\n';
    const manifest='#EXTM3U\n#EXT-X-VERSION:3\n'+repeated.repeat(125000)+'#EXT-X-ENDLIST\n';
    assert(Buffer.byteLength(manifest)>5*1024*1024,'fixture must exceed the old limit');
    fs.writeFileSync(path.join(root,managed),manifest);
    fs.writeFileSync(path.join(root,'segment.ts'),'test-segment-bytes');
    const item={key:'0123456789abcdef',originalName:original,managedName:managed,
      relativeDir:'',originalExt:'.m3u8',state:'ready'};
    const ctx={fs,path,crypto,Buffer,targetDir:root,HASH_ENABLED:hash,
      catalog:{items:[item],folders:[]},
      MIME_BY_EXT:{'.ts':'video/mp2t'},safeMediaRelativeDir:x=>x,
      safeManagedName:name=>/^[a-f0-9]{32}$/.test(name),
      managedPath:entry=>path.join(root,entry.managedName),saveCatalog:()=>{},
      streamMedia:()=>{throw Error('not expected')}};
    vm.createContext(ctx);
    vm.runInContext(src,ctx,{filename:'35-hls-playlists.js'});
    await ctx.jfHlsScan();
    assert.equal(item.hlsError,undefined,'long playlist indexed');
    assert.equal(item.hlsAssets.length,1,'repeated segment needs one asset');
    assert.equal(ctx.jfHlsReady(item),true,'ready after large scan');
    const saved=item.hlsAssets[0];
    if(hash)assert.match(path.basename(saved.stored),/^[a-f0-9]{32}$/);
    const responseRoot=response();
    await ctx.jfHlsServe({method:'GET'},responseRoot,item);
    assert.equal(responseRoot.status,200,'large HLS served');
    assert.equal((responseRoot.body.match(/\/api\/hls\//g)||[]).length,125000,
      'all repeated references rewritten');
    assert(!responseRoot.body.includes('segment.ts\n'),'source URI not exposed');
    const runtime=vm.runInContext('jfHlsRuntime',ctx)(item);
    assert.equal(runtime.byId.get(saved.id),saved);
    await ctx.jfHlsScan();
    assert.equal(item.hlsError,undefined,'repeat scan stays healthy');
    assert.equal(item.hlsAssets.length,1,'repeat scan does not duplicate assets');
    // A large, fully ready index should not be linearly scanned per HTTP request.
    const huge={originalExt:'.m3u8',hlsAssets:Array.from({length:60000},(_,i)=>({
      id:String(i).padStart(32,'0'),original:'part'+i+'.ts',
      stored:'part'+i,state:'ready'}))};
    const access=vm.runInContext('jfHlsRuntime',ctx);
    const cachedIndex=access(huge);
    assert.equal(cachedIndex.byId.size,60000);
    assert.strictEqual(access(huge),cachedIndex,'index reuse');
    huge.hlsAssets=[...huge.hlsAssets];
    assert.notStrictEqual(access(huge),cachedIndex,'new data array gets a fresh index');
    console.log('PASS '+(hash?'Hash':'original')+' HLS >5 MiB scan/serve/cache');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
