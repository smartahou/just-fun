#!/usr/bin/env node
'use strict';
// Real HTTP/HLS/FFprobe/FFmpeg smoke test using generated files ONLY.
// No user library access. ffmpeg/ffprobe are optional for the repository.
const assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const http=require('node:http'),vm=require('node:vm');
const {spawnSync,spawn}=require('node:child_process');
const moduleSource=fs.readFileSync(
  path.join(__dirname,'../src/server/35-hls-playlists.js'),'utf8');
const exec=(program,args,timeout=30000)=>spawnSync(program,args,{
  encoding:'utf8',timeout,windowsHide:true,maxBuffer:4*1024*1024
});
function execAsync(program,args,timeout=30000){
  return new Promise(resolve=>{
    let stdout='',stderr='',settled=false;
    const done=status=>{
      if(settled)return;
      settled=true;clearTimeout(timer);resolve({status,stdout,stderr});
    };
    const child=spawn(program,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{child.kill('SIGKILL');done(-1);},timeout);
    child.stdout.on('data',buf=>{
      stdout+=buf.toString();
      if(stdout.length>4*1024*1024)child.kill('SIGKILL');
    });
    child.stderr.on('data',buf=>{
      stderr+=buf.toString();
      if(stderr.length>4*1024*1024)child.kill('SIGKILL');
    });
    child.on('error',error=>{stderr+=' '+error.message;done(-1);});
    child.on('close',code=>done(code));
  });
}
if(exec('ffmpeg',['-version']).status!==0||exec('ffprobe',['-version']).status!==0){
  console.log('SKIP: FFmpeg and FFprobe are needed for HLS decode/cover smoke test');
  process.exit(0);
}
async function exercise(hash){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jf-real-hls-'));
  const library=path.join(temp,'library');fs.mkdirSync(library);
  let server;
  try{
    const source=path.join(library,'sample.m3u8');
    const made=exec('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',
      '-f','lavfi','-i','testsrc2=size=320x180:rate=12',
      '-t','2.5','-c:v','libx264','-preset','ultrafast',
      '-f','hls','-hls_time','1','-hls_list_size','0',
      '-hls_segment_filename',path.join(library,'sample%03d.ts'),source],40000);
    if(made.status!==0)throw Error('test HLS generation failed: '+made.stderr);
    const filename=hash?'a'.repeat(32):'sample.m3u8';
    if(hash)fs.renameSync(source,path.join(library,filename));
    const item={key:'1234567890abcdef',originalExt:'.m3u8',originalName:'sample.m3u8',
      managedName:filename,relativeDir:'',kind:'video',state:'ready'};
    const catalog={items:[item],folders:[]};
    const ctx={fs,path,crypto,Buffer,targetDir:library,HASH_ENABLED:hash,catalog,
      MIME_BY_EXT:{'.ts':'video/mp2t','.m3u8':'application/vnd.apple.mpegurl'},
      safeMediaRelativeDir:d=>d||'',
      safeManagedName:name=>/^[a-f0-9]{32}$/.test(name),
      managedPath:x=>path.join(library,x.managedName),
      saveCatalog:()=>{},
      streamMedia:(req,res,media,filepath)=>{
        const stat=fs.statSync(filepath),size=stat.size;
        const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
        if(range){
          const first=Number(range[1]),last=range[2]?Math.min(Number(range[2]),size-1):size-1;
          res.writeHead(206,{'Content-Type':media.mime,'Content-Range':
            'bytes '+first+'-'+last+'/'+size,'Content-Length':last-first+1,
            'Accept-Ranges':'bytes'});
          fs.createReadStream(filepath,{start:first,end:last}).pipe(res);
        }else{
          res.writeHead(200,{'Content-Type':media.mime,'Content-Length':size,
            'Accept-Ranges':'bytes'});
          fs.createReadStream(filepath).pipe(res);
        }
      }
    };
    vm.createContext(ctx);
    vm.runInContext(moduleSource,ctx,{filename:'35-hls-playlists.js'});
    await ctx.jfHlsScan();
    assert.equal(item.hlsError,undefined,'all HLS resources must resolve');
    assert(ctx.jfHlsReady(item));
    assert(item.hlsAssets.length>=1);
    if(hash){
      assert.match(item.managedName,/^[a-f0-9]{32}$/);
      assert(item.hlsAssets.every(a=>/^[a-f0-9]{32}$/.test(
        path.basename(a.stored))),'all segments must be anonymously stored');
    }
    server=http.createServer((req,res)=>{
      const pathname=new URL(req.url,'http://127.0.0.1').pathname;
      if(pathname==='/media/'+item.key){
        ctx.jfHlsServe(req,res,item);return;
      }
      const match=/^\/api\/hls\/([a-f0-9]{16})\/([a-f0-9]{32})(\.[a-z0-9]{1,10})?$/.exec(pathname);
      if(match&&match[1]===item.key){
        ctx.jfHlsServe(req,res,item,match[2],match[3]||'');return;
      }
      res.writeHead(404);res.end();
    });
    await new Promise((resolve,reject)=>{
      server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
    });
    const url='http://127.0.0.1:'+server.address().port+'/media/'+item.key;
    const fetched=await fetch(url);
    const manifest=await fetched.text();
    assert.equal(fetched.status,200);
    assert(manifest.includes('.ts'),'HLS HTTP segment URL has type suffix');
    assert(!manifest.includes('sample000.ts'),'physical source name not leaked');
    // A synchronous child would deadlock: FFprobe awaits HTTP from THIS
    // Node process. Keep the event loop serving the HLS fixtures.
    const decoded=await execAsync('ffprobe',['-v','error','-print_format','json',
      '-show_format','-show_streams',url],30000);
    assert.equal(decoded.status,0,'ffprobe: '+decoded.stderr);
    const info=JSON.parse(decoded.stdout);
    assert(Number(info.format?.duration)>0,'HLS duration available');
    assert(info.streams?.some(stream=>stream.codec_type==='video'&&stream.width===320));
    const cover=path.join(temp,'cover.jpg');
    const thumbnail=await execAsync('ffmpeg',['-hide_banner','-loglevel','error',
      '-nostdin','-y','-ss','0.5','-i',url,'-frames:v','1',
      '-vf','scale=720:-2','-q:v','4',cover],30000);
    assert.equal(thumbnail.status,0,'ffmpeg cover: '+thumbnail.stderr);
    assert(fs.statSync(cover).size>1000,'actual JPEG cover generated');
    console.log('PASS HLS real decode + cover ('+(hash?'Hash':'original')+')');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
(async()=>{await exercise(false);await exercise(true);})().catch(error=>{
  console.error(error.stack||error.message);process.exitCode=1;
});
