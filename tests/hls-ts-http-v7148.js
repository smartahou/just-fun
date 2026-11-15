#!/usr/bin/env node
'use strict';
// Real FFprobe validation of a MPEG-TS container wrongly named .m3u8.
// Disposable fixtures and local-only HTTP; never reads personal media.
const assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path'),os=require('node:os'),http=require('node:http');
const crypto=require('node:crypto'),vm=require('node:vm');
const {spawn,spawnSync}=require('node:child_process');
const moduleSource=fs.readFileSync(path.join(__dirname,'../src/server/35-hls-playlists.js'),'utf8');
if(spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status!==0||
   spawnSync('ffprobe',['-version'],{stdio:'ignore'}).status!==0){
  console.log('SKIP: FFmpeg/FFprobe unavailable');process.exit(0);
}
function probe(url){
  return new Promise((resolve,reject)=>{
    const child=spawn('ffprobe',['-v','error','-show_entries',
      'format=duration','-of','default=noprint_wrappers=1',url],{
      stdio:['ignore','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
    child.stdout.on('data',x=>stdout+=x.toString());
    child.stderr.on('data',x=>stderr+=x.toString());
    child.on('error',reject);
    child.on('close',code=>{
      clearTimeout(timer);
      if(code!==0)reject(Error('ffprobe failed: '+stderr));
      else resolve(stdout);
    });
  });
}
async function run(hash){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jf-disguised-ts-'));
  let server;
  try{
    const original=path.join(dir,'video.m3u8');
    const made=spawnSync('ffmpeg',['-hide_banner','-loglevel','error',
      '-nostdin','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24',
      '-t','9','-c:v','libx264','-preset','ultrafast','-b:v','3M',
      '-f','mpegts',original],{encoding:'utf8',timeout:60000});
    assert.equal(made.status,0,made.stderr);
    const managed=hash?'a'.repeat(32):'video.m3u8';
    if(hash)fs.renameSync(original,path.join(dir,managed));
    const item={key:'1234567890abcdef',originalName:'video.m3u8',
      originalExt:'.m3u8',managedName:managed,relativeDir:'',state:'ready',
      duration:9};
    const ctx={fs,path,crypto,Buffer,catalog:{items:[item],folders:[]},
      targetDir:dir,HASH_ENABLED:hash,saveCatalog:()=>{},
      MIME_BY_EXT:{'.ts':'video/mp2t'},safeMediaRelativeDir:x=>x,
      safeManagedName:x=>/^[a-f0-9]{32}$/.test(x),
      managedPath:x=>path.join(dir,x.managedName),
      streamMedia:(req,res,media,filename)=>{
        const size=fs.statSync(filename).size;
        const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
        if(range){
          const a=Number(range[1]),b=range[2]?Number(range[2]):size-1;
          res.writeHead(206,{'Content-Type':media.mime,'Content-Length':b-a+1,
            'Content-Range':'bytes '+a+'-'+b+'/'+size,'Accept-Ranges':'bytes'});
          fs.createReadStream(filename,{start:a,end:b}).pipe(res);
        }else{
          res.writeHead(200,{'Content-Type':media.mime,'Content-Length':size,
            'Accept-Ranges':'bytes'});
          fs.createReadStream(filename).pipe(res);
        }
      }};
    vm.createContext(ctx);vm.runInContext(moduleSource,ctx);
    await ctx.jfHlsScan();
    assert.equal(item.hlsDetectedFormat,'mpegts');
    assert(ctx.jfHlsReady(item));
    server=http.createServer((req,res)=>{
      const target=new URL(req.url,'http://127.0.0.1').pathname;
      if(target==='/media/'+item.key){
        ctx.jfHlsServe(req,res,item);return;
      }
      const m=/^\/api\/hls\/([a-f0-9]{16})\/([a-f0-9]{32})\.ts$/.exec(target);
      if(m&&m[1]===item.key){
        ctx.jfHlsServe(req,res,item,m[2],'.ts');return;
      }
      res.writeHead(404);res.end();
    });
    await new Promise((resolve,reject)=>{
      server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
    });
    const url='http://127.0.0.1:'+server.address().port+'/media/'+item.key;
    const result=await probe(url);
    assert.match(result,/duration=/);
    const duration=Number(result.trim().split('=')[1]);
    assert(duration>7&&duration<11,'playback is a valid 9-second TS stream');
    console.log('PASS local MPEG-TS virtual HLS, '+(hash?'Hash':'original'));
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
(async()=>{await run(false);await run(true);})().catch(error=>{
  console.error(error.stack||error);process.exitCode=1;
});
