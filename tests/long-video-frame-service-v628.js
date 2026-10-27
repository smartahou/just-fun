// Isolated long-film frame model test. No media files touched.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const {EventEmitter}=require('events');
const source=fs.readFileSync(path.join(__dirname,'../src/media/10-frames.js'),'utf8');
const tracks=[];
let jobs=0;
const item={key:'test-long',duration:10560,title:'模拟讲座',kind:'video'};
function spawn(command,args){
  jobs++;
  assert.equal(command,'ffprobe','long video must not launch thumbnail FFmpeg');
  tracks.push(args.join(' '));
  const child=new EventEmitter(); child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
  process.nextTick(()=>{
    child.stdout.emit('data',Buffer.from(JSON.stringify({streams:[{r_frame_rate:'30/1',avg_frame_rate:'30/1',nb_frames:'316800',duration:'10560'}],format:{duration:'10560'}})));
    child.emit('close',0);
  });
  return child;
}
const c={path,fs:{statSync:()=>({size:123,mtimeMs:1000}),promises:{rm:async()=>{}}},
  CACHE_DIR:'/tmp/jf-v628-virtual-no-file',HAS_FFPROBE:true,HAS_FFMPEG:true,
  requiredVideo:()=>item,managedPath:()=>'/virtual/mock-movie.mp4',
  crypto:require('crypto'),spawn,Map,Set,Number,Date,JSON,Array,Math,
  setTimeout,clearTimeout,console,activeMediaChildren:new Set()};
vm.createContext(c);
vm.runInContext(source+'\n;globalThis.__test={getVideoFrameTimes,startFramePreview,fallbackFrameInfo};',c);
(async()=>{
 const r=await c.__test.getVideoFrameTimes('test-long');
 assert.equal(r.count,316800);assert.equal(r.compact,true);assert.equal(r.times.length,0);
 assert.equal(r.duration,10560);assert.equal(r.fps,30);assert.equal(r.estimated,true);
 assert.equal(jobs,1);assert(tracks.every(x=>!x.includes('show_packets')));
 const status=await c.__test.startFramePreview('test-long');
 assert.equal(status.total,316800);assert.equal(status.ready,0);
 assert.match(status.error,/长视频已跳过/);assert.equal(jobs,1);
 // Actual fps differs from 30: never clip at old cap.
 const fpsVariant=c.__test.fallbackFrameInfo({duration:10560},JSON.stringify({streams:[{avg_frame_rate:'30000/1001'}]}),'test',10560);
 assert(fpsVariant.count>300000&&fpsVariant.count<320000);assert.equal(fpsVariant.times.length,0);
 // Short clip: retain inline precision estimate when packet probe unavailable.
 const short=c.__test.fallbackFrameInfo({duration:2},JSON.stringify({streams:[{avg_frame_rate:'25/1',nb_frames:'50'}]}),'test',2);
 assert.equal(short.count,50);assert.equal(short.times.length,50);assert.equal(short.compact,false);
 // Bad nb_frames metadata must not truncate long durations.
 const wrong=c.__test.fallbackFrameInfo({duration:10560},JSON.stringify({streams:[{avg_frame_rate:'30/1',nb_frames:'120000'}]}),'test',10560);
 assert.equal(wrong.count,316800);
 console.log('PASS 8 virtual long-frame model checks');
})().catch(e=>{console.error(e);process.exit(1)});
