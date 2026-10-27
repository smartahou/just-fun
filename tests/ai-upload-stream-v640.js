'use strict';
// Large-file mocked HTTPS multipart check. No outbound calls, no customer credentials.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),vm=require('vm'),assert=require('node:assert/strict');
const {Writable}=require('node:stream'),{EventEmitter}=require('node:events');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jf-stream-'));const file=path.join(temp,'课程音轨.mp3');
const limit=42*1024*1024;fs.writeFileSync(file,'ID3');fs.truncateSync(file,limit); // sparse 42 MiB > old 32 MiB ceiling
const calls=[];
const mockHttps={request(url,options,callback){
  let bytes=0,largest=0,headers=options.headers;
  const request=new Writable({write(chunk,enc,next){bytes+=chunk.length;largest=Math.max(largest,chunk.length);next();}});
  request.setTimeout=()=>{};
  request.on('finish',()=>{
    const response=new EventEmitter();response.statusCode=200;calls.push({url,bytes,largest,headers});
    callback(response);process.nextTick(()=>response.emit('end'));
  });
  return request;
}};
const src=fs.readFileSync(path.join(__dirname,'../src/media/50-ai-transcription.js'),'utf8');
const context={MIME_BY_EXT:{".mp3":"audio/mpeg"},fs,path,os,crypto,require:(name)=>name==='https'?mockHttps:require(name),Buffer,URL,URLSearchParams,setTimeout,clearTimeout,process};
vm.createContext(context);vm.runInContext(src,context);
(async()=>{
  await vm.runInContext('jfAsrMultipartUpload',context)('https://oss-cn-beijing.aliyuncs.com/',{key:'test/stream.mp3',policy:'safe'},file,'stream.mp3');
  assert.equal(calls.length,1);assert.equal(calls[0].headers['Content-Length'],calls[0].bytes);
  assert(calls[0].bytes>limit && calls[0].bytes<limit+4000);
  assert(calls[0].largest<=256*1024,'streaming must not buffer full file');
  assert(!('Authorization' in calls[0].headers),'OSS upload must never receive bearer key');
  console.log('PASS large 42 MiB upload streamed in <=256 KiB chunks');
  console.log('PASS Content-Length is exact');
  console.log('PASS provider bearer token never reaches OSS');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
