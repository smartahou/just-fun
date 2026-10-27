// Isolated offline contract tests; no actual Qwen request or user credential is used.
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),vm=require('vm');
const assert=require('assert/strict');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jf-asr-mock-'));
const cache=path.join(tmp,'cache'),exportDir=path.join(tmp,'export');fs.mkdirSync(cache,{recursive:true});fs.mkdirSync(exportDir,{recursive:true});
const part='完整课程.mp3';fs.writeFileSync(path.join(exportDir,part),Buffer.from('ID3'+'.'.repeat(8000)));
const id='0123456789abcdef',parts=[{file:part,startSeconds:0,endSeconds:9,bytes:8003}];

const calls=[];
function mk(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});}
const fetch=async(url,opts={})=>{
  calls.push({url,headers:opts.headers||{},method:opts.method||'GET'});
  if(url.includes('/api/v1/uploads?'))return mk({data:{upload_host:'https://audio.oss-cn-beijing.aliyuncs.com',upload_dir:'test/mock',oss_access_key_id:'test',signature:'test',policy:'test',x_oss_object_acl:'private',x_oss_forbid_overwrite:'true'}});

  if(url.endsWith('/api/v1/services/audio/asr/transcription')){
    const body=JSON.parse(opts.body);
    assert.equal(body.model,'qwen-audio-3.1-asr-flash-filetrans');assert.equal(body.parameters.keep_dialect,true);
    assert.equal(body.parameters.vocabulary['周易参同契'],3);
    assert.equal(opts.headers['X-DashScope-Async'],'enable');
    return mk({output:{task_id:'server-task-id-001'}});
  }
  if(url.endsWith('/api/v1/tasks/server-task-id-001'))return mk({output:{task_status:'SUCCEEDED',results:[{subtask_status:'SUCCEEDED',transcription_url:'https://results.oss-cn-beijing.aliyuncs.com/mock.json'}]}});
  if(url.endsWith('/mock.json'))return mk({transcripts:[{sentences:[{begin_time:500,end_time:1300,text:'周易参同契'},{begin_time:2000,end_time:3200,text:'江浙方言测试'}]}]});
  throw Error('unexpected mock request '+url);
};
const context={fs,path,os,crypto,require,process:{platform:'linux',env:{APPDATA:tmp},pid:process.pid},fetch,FormData,Blob,Buffer,URL,URLSearchParams,AbortSignal,setTimeout,clearTimeout,spawn:()=>{throw Error('unexpected powershell')},
  vaultReadJson:file=>JSON.parse(fs.readFileSync(file,'utf8')),
  vaultReadBytes:file=>fs.readFileSync(file),
  vaultWriteBytes:(file,data)=>fs.writeFileSync(file,data),
  vaultWriteJson:(file,data)=>fs.writeFileSync(file,JSON.stringify(data)),
  AI_LEARNING_DIR:cache,aiAudioJobs:new Map([['exportid',{status:'done',directory:exportDir,filePath:path.join(exportDir,part),sourceKey:id,sourceFingerprint:'8003-42',parts}]]),
  MIME_BY_EXT:{'.mp3':'audio/mpeg'},managedPath:()=>path.join(exportDir,'source.mp3'),
  aiLearningItem:key=>{if(key!==id)throw Error('wrong key');return {key}},catalog:{items:[{key:id,state:'ready'}]},
};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','src','media','50-ai-transcription.js'),'utf8'),context);
const run=code=>vm.runInContext(code,context);
vm.runInContext('jfAsrMultipartUpload=async (host,fields,file,name)=>{if(!host.startsWith(\"https://audio.oss-cn-beijing.aliyuncs.com\"))throw Error(\"Unexpected upload host\");if(!file.endsWith(\".mp3\"))throw Error(\"Wrong uploaded type\");};',context);
(async()=>{
  let count=0;function check(label,fn){fn();count++;process.stdout.write('PASS '+label+'\n');}
  check('Initially no persisted credential',()=>assert.equal(run('jfAsrKeyCache'),null));
  await assert.rejects(run("jfAsrSetKey('insecure')"));count++;
  await run("jfAsrSetKey('sk-TESTONLY01XXXXXXXXXXXXXXXXXXXX')");
  check('Saved key in user config not media cache',()=>assert.equal(fs.existsSync(path.join(tmp,'JustFun','qwen-credentials.json')),true));
  check('Stored user credential has 0600 permissions',()=>assert.equal(fs.statSync(path.join(tmp,'JustFun','qwen-credentials.json')).mode&0o777,0o600));
  run('jfAsrKeyCache=null');check('Credential reload operation available',()=>assert.equal(typeof run('jfAsrGetKey'), 'function'));
  assert.equal(await run('jfAsrGetKey()'),'sk-TESTONLY01XXXXXXXXXXXXXXXXXXXX');count++;
  fs.writeFileSync(path.join(exportDir,'source.mp3'),Buffer.from('ID3'+'.'.repeat(8000)));
  fs.utimesSync(path.join(exportDir,'source.mp3'),0.042,0.042);
  context.aiAudioJobs.get('exportid').sourceFingerprint='8003-'+Math.floor(fs.statSync(path.join(exportDir,'source.mp3')).mtimeMs);
  const response=await run(`jfAsrStart('${id}','exportid','周易参同契')`);check('Async transcription started',()=>assert.equal(response.status,'running'));
  for(let j=0;j<100;j++){if(run(`jfAsrJobPublic('${response.id}')`).status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  const job=run(`jfAsrJobPublic('${response.id}')`);check('Mock asynchronous task completed',()=>assert.equal(job.status,'done'));
  const doc=JSON.parse(fs.readFileSync(path.join(cache,id+'.transcript.json'),'utf8'));
  check('Cloud task checkpoint removed after success',()=>assert(!fs.existsSync(path.join(cache,id+'.asr-task.json'))));
  check('Segment transcription matches actual mocked response',()=>assert.equal(doc.segments[0].text,'周易参同契'));
  check('Times preserved without invented offsets',()=>assert.deepEqual(doc.segments.map(x=>x.startMs),[500,2000]));
  check('Draft not falsely approved',()=>assert.equal(doc.confirmed,false));
  await assert.rejects(run(`jfAsrStart('${id}','exportid','')`),/已有识别稿/);count++;
  const edited=await run(`jfAsrSaveTranscript('${id}',[{startMs:500,endMs:1300,text:'人工修订'},{startMs:2000,endMs:3200,text:'江浙方言测试'}],${doc.revision},false)`);
  check('Revision increments after manual edit',()=>assert.equal(edited.revision,doc.revision+1));
  await assert.rejects(run(`jfAsrSaveTranscript('${id}',[],1,true)`),/其他窗口更新/);count++;
  const confirmed=await run(`jfAsrSaveTranscript('${id}',[{startMs:500,endMs:1300,text:'人工修订'},{startMs:2000,endMs:3200,text:'江浙方言测试'}],${edited.revision},true)`);
  check('Approval explicitly requires user action',()=>assert.equal(confirmed.confirmed,true));
  await assert.rejects(run(`jfAsrSaveTranscript('${id}',[{startMs:7000,endMs:12000,text:'bad'}],${confirmed.revision},false)`),/时间无效/);count++;
  assert.throws(()=>run(`jfAsrAllowedCloudUrl('http://127.0.0.1/admin')`),/不可信/);count++;
  check('API endpoint belongs to matching key provider',()=>assert.equal(calls[0].url.startsWith('https://maas.qianwenaiapi.com/'),true));
  check('Key not sent to temporary OSS or result URL',()=>assert(calls.filter(c=>c.url.includes('oss-cn')).every(c=>!c.headers.Authorization)));
  // Simulate restart during a one-hour cloud job. The task checkpoint must
  // avoid a second paid upload/submission and only resume polling.
  fs.rmSync(path.join(cache,id+'.transcript.json'));
  const sourceStat=fs.statSync(path.join(exportDir,'source.mp3'));
  const fingerprint=crypto.createHash('sha256').update(id+':'+context.aiAudioJobs.get('exportid').sourceFingerprint+':'+parts[0].bytes+':'+fs.statSync(path.join(exportDir,part)).mtimeMs).digest('hex');
  fs.writeFileSync(path.join(cache,id+'.asr-task.json'),JSON.stringify({version:1,sourceKey:id,taskId:'server-task-id-001',audioFingerprint:fingerprint}));
  const submissions=calls.filter(c=>c.url.endsWith('/transcription')).length;
  const recovery=await run(`jfAsrStart('${id}','exportid','')`);
  for(let j=0;j<100;j++){if(run(`jfAsrJobPublic('${recovery.id}')`).status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  check('Recovered cloud task without duplicate submit',()=>assert.equal(calls.filter(c=>c.url.endsWith('/transcription')).length,submissions));
  check('Recovered task created transcript',()=>assert(fs.existsSync(path.join(cache,id+'.transcript.json'))));
  const original=JSON.parse(fs.readFileSync(path.join(cache,id+'.transcript.json'),'utf8'));
  assert.equal(original.confirmed,false);
  const regenerated=await run(`jfAsrStart('${id}','exportid','周易参同契',true)`);
  for(let j=0;j<100;j++){if(run(`jfAsrJobPublic('${regenerated.id}')`).status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  check('Opt-in regeneration after transcript exists',()=>assert.equal(run(`jfAsrJobPublic('${regenerated.id}')`).status,'done'));
  check('Previous draft backed up before replacement',()=>assert.equal(JSON.parse(fs.readFileSync(path.join(cache,id+'.transcript-previous.json'),'utf8')).sourceKey,id));
  check('Regeneration increments revision',()=>assert.equal(JSON.parse(fs.readFileSync(path.join(cache,id+'.transcript.json'),'utf8')).revision,original.revision+1));
  await run('jfAsrDeleteKey()');check('Credential removable',()=>assert(!fs.existsSync(path.join(tmp,'JustFun','qwen-credentials.json'))));
  check('No original media edits',()=>assert.equal(fs.statSync(path.join(exportDir,part)).size,8003));
  console.log('TOTAL',count,'PASS');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(tmp,{recursive:true,force:true}));
