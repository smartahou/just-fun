#!/usr/bin/env node
'use strict';
// v7.148: mislabelled .m3u8 must be sniffed, not parsed as a giant text file.
// No real media files touched. Temporary fixtures are removed after testing.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/server/35-hls-playlists.js'),'utf8');
async function test(format,hash){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jf-hls-sniff-'));
  try{
    const managed=hash?'a'.repeat(32):'video.m3u8';
    const full=path.join(dir,managed);
    if(format==='mp4'){
      const bytes=Buffer.alloc(2048);bytes.writeUInt32BE(24,0);
      bytes.write('ftyp',4,'ascii');bytes.write('isom',8,'ascii');
      fs.writeFileSync(full,bytes);
    }else if(format==='webm'){
      const bytes=Buffer.alloc(2048);Buffer.from([0x1a,0x45,0xdf,0xa3]).copy(bytes);bytes.write('webm',32,'ascii');fs.writeFileSync(full,bytes);
    }else if(format==='mpegts'){
      const bytes=Buffer.alloc(188*500);
      for(let n=0;n<500;n++)bytes[n*188]=0x47;
      fs.writeFileSync(full,bytes);
    }else if(format==='unknown'){
      fs.writeFileSync(full,Buffer.from('not-an-hls-playlist'));
    }else{
      fs.writeFileSync(full,'#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST\n');
      fs.writeFileSync(path.join(dir,'segment.ts'),'transport');
    }
    const item={key:'1234567890abcdef',originalExt:'.m3u8',
      originalName:'video.m3u8',managedName:managed,relativeDir:'',
      state:'ready',duration:format==='mpegts'?16:0};
    let saves=0,seenMime='';
    const ctx={fs,path,crypto,Buffer,catalog:{items:[item],folders:[]},
      targetDir:dir,HASH_ENABLED:hash,MIME_BY_EXT:{'.ts':'video/mp2t'},
      safeManagedName:name=>/^[a-f0-9]{32}$/.test(name),
      safeMediaRelativeDir:x=>x,
      managedPath:entry=>path.join(dir,entry.managedName),
      saveCatalog:()=>saves++,
      streamMedia:(_req,res,media)=>{seenMime=media.mime;res.writeHead(200);res.end();}};
    vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'35-hls-playlists.js'});
    await ctx.jfHlsScan();
    assert.equal(item.hlsDetectedFormat,format==='unknown'?'unknown':
      format==='playlist'?'playlist':format);
    assert.equal(ctx.jfHlsReady(item),format!=='unknown');
    if(format==='unknown'){
      assert.match(item.hlsError,/不是标准 HLS/);
      assert.equal(saves>0,true);
    }else if(format==='mp4'||format==='webm'){
      const res={status:0,writeHead(status){this.status=status;},end(){}};
      await ctx.jfHlsServe({method:'GET'},res,item);
      assert.equal(res.status,200);
      assert.equal(seenMime,format==='mp4'?'video/mp4':'video/webm');
      assert.equal(ctx.jfHlsDetectedMime(item),seenMime);
    }else if(format==='mpegts'){
      const res={status:0,body:'',headers:{},
        writeHead(status,headers){this.status=status;this.headers=headers;},
        end(body){this.body=body;}};
      await ctx.jfHlsServe({method:'GET'},res,item);
      assert.equal(res.status,200);
      assert.match(res.body,/#EXT-X-BYTERANGE:/);
      assert.match(res.body,/\/api\/hls\/1234567890abcdef\/[a-f0-9]{32}\.ts/);
      const id=vm.runInContext('jfHlsTsVirtualId',ctx)(item);
      await ctx.jfHlsServe({method:'GET'},res,item,id,'.ts');
      assert.equal(seenMime,'video/mp2t');
    }else{
      assert.equal(item.hlsAssets.length,1);
    }
    const previous=saves;
    await ctx.jfHlsScan();
    assert.equal(saves,previous,'stable signature/index not rewritten');
    console.log('PASS '+format+' '+(hash?'Hash':'original'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{
  for(const type of ['playlist','mp4','webm','mpegts','unknown']){
    await test(type,false);await test(type,true);
  }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
