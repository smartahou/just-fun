'use strict';
// Real FFmpeg integration with disposable generated audio only.
const fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('assert/strict');
const {execFileSync,execFile}=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'src/media/20-audio-and-transcoding.js'),'utf8');
const extractModule=src.slice(0,src.indexOf('// 9:16'));
const run=(args)=>execFileSync('ffmpeg',args,{stdio:['ignore','pipe','pipe'],timeout:30000});
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jf-v725-audio-'));
  const catalog={items:[]},mediaJobs=new Set(),output=[];
  let checks=0;
  function check(label,fn){fn();checks++;console.log('PASS',label);}
  const context={fs,path,os,crypto,require,Buffer,Promise,console,mediaJobs,
    HAS_FFPROBE:true,HAS_FFMPEG:true,catalog,CACHE_DIR:temp,AUDIO_SUBDIR:'1002',
    itemMediaKind:x=>x.kind,managedPath:x=>x.path,
    requiredVideo:key=>catalog.items.find(x=>x.key===key),
    runCommand:(_,args)=>new Promise((ok,fail)=>execFile('ffmpeg',args,{timeout:30000},
      err=>err?fail(err):ok())),
    addGeneratedMedia:(file,ext,folder,name,item,extras)=>{
      const dest=path.join(temp,'out-'+item.key+ext);
      assert(fs.statSync(file).size>0);fs.renameSync(file,dest);
      const result={key:'out-'+item.key,ext,folder,path:dest,...extras};
      output.push(result);return result;
    }
  };
  vm.createContext(context);vm.runInContext(extractModule,context);
  try{
    for(const [codec,encoder,container,extension,method] of [
      ['aac',['-c:a','aac','-b:a','256k'],'mp4','.m4a','copy'],
      ['mp3',['-c:a','libmp3lame','-b:a','192k'],'mkv','.mp3','copy'],
      ['flac',['-c:a','flac'],'mkv','.flac','copy'],
      ['opus',['-c:a','libopus'],'mkv','.opus','copy'],
      ['ac3',['-c:a','ac3','-b:a','192k'],'mkv','.flac','flac']
    ]){
      const video=path.join(temp,codec+'.'+container);
      run(['-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi',
        '-i','sine=frequency=900:duration=1.2',...encoder,video]);
      const before=hash(video);
      catalog.items.push({key:codec,kind:'video',title:'synthetic '+codec,path:video,duration:1.2});
      const result=await vm.runInContext('extractAudio('+JSON.stringify(codec)+')',context);
      check(codec+' mode',()=>{assert.equal(result.method,method);assert.equal(result.codec,codec);
        assert.equal(result.outputCodec,method==='copy'?codec:'flac');});
      check(codec+' format',()=>assert.equal(result.item.ext,extension));
      check(codec+' source unchanged',()=>assert.equal(hash(video),before));
      check(codec+' no running job',()=>assert.equal(mediaJobs.size,0));
      check(codec+' managed audio folder',()=>assert.equal(result.item.folder,'data/1002'));
    }
    const silent=path.join(temp,'silent.mp4');
    run(['-v','error','-y','-f','lavfi','-i','color=s=64x64:r=1:d=1',
      '-c:v','mpeg4','-an',silent]);
    catalog.items.push({key:'silent',kind:'video',title:'silent',path:silent});
    let noTrack=false;const count=output.length;
    try{await vm.runInContext("extractAudio('silent')",context);}catch(e){
      noTrack=/音频流/.test(e.message);
    }
    check('Silent video rejected without generated audio',()=>{
      assert(noTrack);assert.equal(output.length,count);assert.equal(mediaJobs.size,0);
    });
    console.log('TOTAL',checks,'PASS');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
