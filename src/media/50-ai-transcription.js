// v6.39 — Opt-in Qwen long-form speech transcription. Credentials never join media exports.
// Local-only HTTP, model-bound 48h temporary cloud upload, manual transcript approval.
const JF_ASR_MODEL='qwen-audio-3.1-asr-flash-filetrans';
const JF_ASR_BASE='https://maas.qianwenaiapi.com'; // sk-ws keys belong to Qwen AI Platform.
const JF_ASR_CONFIG=path.join(process.env.APPDATA||path.join(os.homedir(),'.config'),'JustFun','qwen-credentials.json');
const JF_ASR_MAX_ROWS=12000,JF_ASR_MAX_FILE=4*1024*1024;
const jfAsrHttps=require('https');
const jfAsrJobs=new Map();
let jfAsrKeyCache=null;
function jfAsrSafeError(e){
  return String(e?.message||e||'调用失败').replace(/sk-(?:ws-)?[A-Za-z0-9._-]{8,}/g,'[密钥已隐藏]').slice(0,320);
}
function jfAsrDpapi(action,text){
  // Windows PowerShell 5.1 does not reliably autoload System.Security from the GAC.
  // Pass all secret material over stdin; neither command line nor diagnostics contain it.
  return new Promise((resolve,reject)=>{
    const shared="$ErrorActionPreference='Stop';$stage='assembly';try{Add-Type -AssemblyName System.Security -ErrorAction Stop;"+
      "$stage='input';$reader=[IO.StreamReader]::new([Console]::OpenStandardInput(),[Text.Encoding]::UTF8);$value=$reader.ReadToEnd();"+
      "$stage='crypt';";
    const operation=action==='protect'
      ? "$bytes=[Text.Encoding]::UTF8.GetBytes($value);$result=[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser));"
      : "$bytes=[Convert]::FromBase64String($value);$result=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser));";
    const cmd=shared+operation+"$stage='output';[Console]::Out.Write($result);exit 0}catch{[Console]::Error.Write('JF_DPAPI_'+$stage);exit 17}";
    let child;
    try{child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(cmd,'utf16le').toString('base64')],{stdio:['pipe','pipe','pipe'],windowsHide:true});}
    catch{reject(Error('无法启动 Windows PowerShell，密钥未保存'));return;}
    let out='',diagnostic='',settled=false;
    const timer=setTimeout(()=>{child.kill();done(Error('Windows 凭据保护超时，请检查 PowerShell 运行环境'));},15000);
    function done(err){if(settled)return;settled=true;clearTimeout(timer);if(err)reject(err);else resolve(out.trim());}
    child.stdout.on('data',b=>{out+=b.toString('utf8');if(out.length>4096){child.kill();done(Error('Windows 凭据响应异常'));}});
    child.stderr.on('data',b=>{if(diagnostic.length<100)diagnostic+=b.toString('utf8').slice(0,100);});
    child.on('error',()=>done(Error('无法启动 Windows PowerShell，密钥未保存')));
    child.on('close',c=>{
      if(c===0){done(null);return;}
      const stage=/JF_DPAPI_(assembly|input|crypt|output)/.exec(diagnostic)?.[1];
      const messages={assembly:'无法加载 Windows 加密组件',input:'无法读取 PowerShell 标准输入',crypt:'当前 Windows 用户无法执行凭据加密或解密',output:'PowerShell 输出不可用'};
      done(Error((messages[stage]||'Windows 凭据保护调用失败')+'，密钥未保存'));
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(text,'utf8');
  });
}
async function jfAsrGetKey(){
  if(jfAsrKeyCache)return jfAsrKeyCache;
  let data;try{data=JSON.parse(await fs.promises.readFile(JF_ASR_CONFIG,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error('本地 API 配置不可读取');}
  if(data.version!==1)throw Error('API 凭据格式不兼容');
  const key=data.storage==='dpapi'?await jfAsrDpapi('unprotect',data.value):data.storage==='user-file'?data.value:null;
  if(!key||!/^sk-(?:ws-)?[A-Za-z0-9._-]{16,256}$/.test(key))throw Error('本地密钥无效，请重新配置');
  jfAsrKeyCache=key;return key;
}
async function jfAsrSetKey(key){
  if(typeof key!=='string'||!/^sk-(?:ws-)?[A-Za-z0-9._-]{16,256}$/.test(key))throw Error('API Key 格式无效');
  const payload=process.platform==='win32'?{version:1,storage:'dpapi',value:await jfAsrDpapi('protect',key)}:{version:1,storage:'user-file',value:key};
  const dir=path.dirname(JF_ASR_CONFIG);await fs.promises.mkdir(dir,{recursive:true,mode:0o700});
  const tmp=JF_ASR_CONFIG+'.tmp-'+crypto.randomBytes(6).toString('hex');
  try{await fs.promises.writeFile(tmp,JSON.stringify(payload),{encoding:'utf8',mode:0o600,flag:'wx'});await fs.promises.rename(tmp,JF_ASR_CONFIG);}
  finally{await fs.promises.rm(tmp,{force:true}).catch(()=>{});}
  jfAsrKeyCache=key;
}
async function jfAsrDeleteKey(){jfAsrKeyCache=null;await fs.promises.rm(JF_ASR_CONFIG,{force:true});}
function jfAsrTranscriptFile(key){aiLearningItem(key);return path.join(AI_LEARNING_DIR,key+'.transcript.json');}
function jfAsrReadTranscript(key){
  const file=jfAsrTranscriptFile(key);
  try{const st=fs.statSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>JF_ASR_MAX_FILE*1.5+4096)throw Error('文字稿文件异常');
    const data=vaultReadJson(file);
    if(data.version!==1||data.sourceKey!==key||!Array.isArray(data.segments))throw Error('文字稿来源异常');return data;
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function jfAsrValidateRows(rows,duration){
  if(!Array.isArray(rows)||!rows.length||rows.length>JF_ASR_MAX_ROWS)throw Error('转写段落数量无效');
  let prev=-1;
  return rows.map((row,i)=>{
    if(!row||typeof row!=='object')throw Error('段落格式无效');
    const startMs=row.startMs,endMs=row.endMs;
    if(!Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)||startMs<0||endMs<=startMs||startMs<prev||endMs>duration+1500)throw Error('第 '+(i+1)+' 段时间无效');
    if(typeof row.text!=='string'||row.text.length>65536)throw Error('第 '+(i+1)+' 段文字无效');
    prev=startMs;return {startMs,endMs,text:row.text.replace(/\u0000/g,'')};
  });
}
// Strict overlap only: [1,3] + [3,5] are neighbors, not a conflict.
// Keep every original utterance in chronological order when an edited range overlaps.
function jfAsrMergeOverlappingRows(rows){
  const sorted=rows.map((row,i)=>({...row,_order:i})).sort((a,b)=>a.startMs-b.startMs||a._order-b._order);
  const merged=[];
  for(const row of sorted){
    const prev=merged[merged.length-1];
    if(prev&&row.startMs<prev.endMs){
      prev.endMs=Math.max(prev.endMs,row.endMs);
      if(row.text)prev.text+=(prev.text?'\n\n':'')+row.text;
      if(prev.text.length>65536)throw Error('合并后的段落文字过长，请缩小时间范围');
    }else merged.push({startMs:row.startMs,endMs:row.endMs,text:row.text});
  }
  return merged;
}
async function jfAsrAtomicWrite(key,data){
  const out=JSON.stringify(data);if(Buffer.byteLength(out)>JF_ASR_MAX_FILE)throw Error('文字稿过大');
  await fs.promises.mkdir(AI_LEARNING_DIR,{recursive:true});
  vaultWriteBytes(jfAsrTranscriptFile(key),out);
}
async function jfAsrSaveTranscript(key,rows,revision,confirm){
  const old=jfAsrReadTranscript(key);if(!old)throw Error('请先完成一次语音识别');
  if(old.complete===false)throw Error('转写尚未完成，请完成或恢复剩余分段后再校订');
  if(!Number.isSafeInteger(revision)||revision!==old.revision)throw Error('文字稿已被其他窗口更新，请刷新后再编辑');
  const normalized=jfAsrMergeOverlappingRows(jfAsrValidateRows(rows,old.durationMs));
  const next={...old,segments:normalized,revision:old.revision+1,confirmed:confirm===true,updatedAt:new Date().toISOString()};
  await jfAsrAtomicWrite(key,next);
  return next;
}
function jfAsrCheckOrigin(req){
  const origin=req.headers.origin;if(!origin)return;
  let parsed;try{parsed=new URL(origin);}catch{throw Error('请求来源无效');}
  if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||parsed.host!==req.headers.host)throw Error('禁止跨站请求');
}
async function jfAsrJsonFetch(url,options={},max=2000000){
  const timer=AbortSignal.timeout(60000);
  const res=await fetch(url,{...options,signal:timer,redirect:'error'});
  if(!res.ok){const detail=(await res.text()).slice(0,600);let message='';try{const j=JSON.parse(detail);message=j.message||j.code||j.error?.message||'';}catch{}
    throw Error('千问请求失败（HTTP '+res.status+'）'+(message?'：'+String(message).slice(0,160):''));}
  const declared=Number(res.headers.get('content-length')||0);if(declared>max)throw Error('服务端结果超过大小限制');
  const value=await res.text();if(Buffer.byteLength(value)>max)throw Error('服务端结果过大');
  try{return JSON.parse(value);}catch{throw Error('服务端未返回有效 JSON');}
}
function jfAsrAllowedCloudUrl(value){
  let u;try{u=new URL(value);}catch{throw Error('云端文件地址无效');}
  if(u.protocol!=='https:'||u.port||!(/(^|\.)(aliyuncs\.com|qianwenaiapi\.com)$/.test(u.hostname)))throw Error('拒绝不可信的云端下载地址');
  return u.href;
}
async function jfAsrMultipartUpload(host,fields,file,name){
  const boundary='----JustFun'+crypto.randomBytes(20).toString('hex');
  const chunks=[];
  for(const [key,value] of Object.entries(fields)){
    chunks.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="'+key+'"\r\n\r\n'+String(value)+'\r\n'));
  }
  const fileHead=Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+name+'"\r\nContent-Type: '+(MIME_BY_EXT[path.extname(name).toLowerCase()]||'application/octet-stream')+'\r\n\r\n');
  const tail=Buffer.from('\r\n--'+boundary+'--\r\n');
  const size=(await fs.promises.stat(file)).size;
  if(size<1||size>2*1024*1024*1024)throw Error('云端限制：单个音频不超过 2GB');
  const length=chunks.reduce((v,b)=>v+b.length,0)+fileHead.length+size+tail.length;
  return new Promise((resolve,reject)=>{
    const req=jfAsrHttps.request(host,{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':length},timeout:20*60*1000},res=>{
      let err='';res.on('data',b=>{if(err.length<1024)err+=b.toString().slice(0,1024);});
      res.on('end',()=>res.statusCode===200||res.statusCode===204?resolve():reject(Error('临时音频上传失败（HTTP '+res.statusCode+'）')));
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('上传音频超时')));req.on('error',reject);
    (async()=>{
      for(const part of chunks)if(!req.write(part))await new Promise(r=>req.once('drain',r));
      if(!req.write(fileHead))await new Promise(r=>req.once('drain',r));
      const stream=fs.createReadStream(file,{highWaterMark:256*1024});
      for await(const block of stream){if(req.destroyed)break;if(!req.write(block))await new Promise(r=>req.once('drain',r));}
      if(!req.destroyed)req.end(tail);
    })().catch(e=>req.destroy(e));
  });
}
async function jfAsrUpload(file,key){
  const params=new URLSearchParams({action:'getPolicy',model:JF_ASR_MODEL});
  const policy=await jfAsrJsonFetch(JF_ASR_BASE+'/api/v1/uploads?'+params,{headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'}},100000);
  const p=policy.data;if(!p||!p.upload_host||!p.upload_dir)throw Error('未获取到有效上传凭证');
  const host=jfAsrAllowedCloudUrl(p.upload_host),ext=path.extname(file).toLowerCase();
  if(!['.mp3','.m4a','.aac','.wav','.flac','.ogg','.opus','.wma'].includes(ext))throw Error('不支持上传此音频格式');
  const name=crypto.randomBytes(12).toString('hex')+ext,objectKey=p.upload_dir+'/'+name;
  await jfAsrMultipartUpload(host,{OSSAccessKeyId:p.oss_access_key_id||'',Signature:p.signature||'',policy:p.policy||'','x-oss-object-acl':p.x_oss_object_acl||'private','x-oss-forbid-overwrite':p.x_oss_forbid_overwrite||'true',key:objectKey,success_action_status:'200'},file,name);
  return 'oss://'+objectKey;
}
async function jfAsrSubmit(ossUrl,key,vocab){
  const vocabulary={};for(const word of String(vocab||'').split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean).slice(0,30))if(word.length<=30)vocabulary[word]=3;
  const params={channel_id:[0],keep_dialect:true,language_hints:['zh']};if(Object.keys(vocabulary).length)params.vocabulary=vocabulary;
  const body={model:JF_ASR_MODEL,input:{file_urls:[ossUrl]},parameters:params};
  const data=await jfAsrJsonFetch(JF_ASR_BASE+'/api/v1/services/audio/asr/transcription',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','X-DashScope-Async':'enable','X-DashScope-OssResourceResolve':'enable'},body:JSON.stringify(body)});
  const id=data.output?.task_id;if(typeof id!=='string'||!/^[-\w]{8,128}$/.test(id))throw Error('没有收到有效转写任务编号');
  return id;
}
async function jfAsrAwait(id,key){
  for(let attempt=0;attempt<900;attempt++){
    const data=await jfAsrJsonFetch(JF_ASR_BASE+'/api/v1/tasks/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+key}});
    const output=data.output||{},status=output.task_status;
    if(status==='FAILED'||status==='CANCELED'){const error=Error('语音识别失败：'+String(output.message||output.code||status).slice(0,140));error.terminal=true;throw error;}
    if(status==='SUCCEEDED'){
      const item=output.results?.[0];if(item?.subtask_status!=='SUCCEEDED'||!item.transcription_url)throw Error('音频子任务失败：'+String(item?.message||item?.code||'结果缺失').slice(0,140));
      return jfAsrJsonFetch(jfAsrAllowedCloudUrl(item.transcription_url),{},10*1024*1024);
    }
    if(!['PENDING','RUNNING','QUEUING',''].includes(status||''))throw Error('未知任务状态：'+String(status).slice(0,50));
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
  throw Error('云端任务仍在处理中；下次点击转写会继续查询，不会重新提交计费任务');
}
function jfAsrParseResult(data,start,end){
  const transcripts=data?.transcripts;if(!Array.isArray(transcripts)||!transcripts.length)throw Error('语音识别结果没有文字轨道');
  const segments=[];for(const transcript of transcripts){
    if(Array.isArray(transcript.sentences)&&transcript.sentences.length){
      for(const sentence of transcript.sentences){const text=String(sentence.text||'').trim();if(!text)continue;
        const a=Number(sentence.begin_time),b=Number(sentence.end_time);if(!Number.isFinite(a)||!Number.isFinite(b))throw Error('语句缺少真实时间戳');
        const ms=Math.round(start+a),to=Math.round(start+b);if(ms<start||to<=ms||to>end+1500)throw Error('服务端时间码超出原媒体范围');
        segments.push({startMs:ms,endMs:Math.min(end,to),text});
      }
    }else if(String(transcript.text||'').trim()){
      // A single block without timestamps is explicitly coarse, never fabricated sentence timing.
      segments.push({startMs:start,endMs:end,text:String(transcript.text).trim()});
    }
  }
  if(!segments.length)throw Error('语音识别结果为空');
  return segments.sort((a,b)=>a.startMs-b.startMs);
}
function jfAsrTaskFile(key){aiLearningItem(key);return path.join(AI_LEARNING_DIR,key+'.asr-task.json');}
async function jfAsrLoadTask(key){
  try{const data=vaultReadJson(jfAsrTaskFile(key));
    if(data?.version!==1||data.sourceKey!==key||typeof data.taskId!=='string'||!/^[-\w]{8,128}$/.test(data.taskId)||typeof data.audioFingerprint!=='string')throw Error('云端任务记录异常');
    return data;
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function jfAsrSaveTask(key,taskId,fingerprint){
  await fs.promises.mkdir(AI_LEARNING_DIR,{recursive:true});
  vaultWriteJson(jfAsrTaskFile(key),{version:1,sourceKey:key,taskId,audioFingerprint:fingerprint,createdAt:new Date().toISOString()});
}
async function jfAsrStart(key,exportId,vocabulary,regenerate=false){
  aiLearningItem(key);
  const credential=await jfAsrGetKey();if(!credential)throw Error('需要先设置 API Key');
  const exported=aiAudioJobs.get(exportId);
  if(!exported||exported.status!=='done'||!exported.filePath||exported.sourceKey!==key)throw Error('请先完成当前媒体的音轨准备');
  const media=catalog.items.find(x=>x.key===key&&x.state==='ready');if(!media)throw Error('音视频不存在');
  const source=managedPath(media),sourceStat=fs.lstatSync(source);
  if(!sourceStat.isFile()||sourceStat.isSymbolicLink()||`${sourceStat.size}-${Math.floor(sourceStat.mtimeMs)}`!==exported.sourceFingerprint)throw Error('源媒体发生变化，请重新准备音轨');
  const file=exported.filePath,part=exported.parts[0];
  if(!part||exported.parts.length!==1||path.dirname(file)!==exported.directory||path.basename(file)!==part.file)throw Error('音轨路径或结构异常');
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size!==part.bytes)throw Error('准备的音轨发生变化，请重新准备');
  const existing=jfAsrReadTranscript(key);
  if(existing&&!regenerate)throw Error('已有识别稿，请直接校订；只有主动选择重新生成才会再次收费');
  const audioFingerprint=crypto.createHash('sha256').update(key+':'+exported.sourceFingerprint+':'+part.bytes+':'+st.mtimeMs).digest('hex');
  const pending=await jfAsrLoadTask(key);
  if(pending&&pending.audioFingerprint!==audioFingerprint)throw Error('已有未完成的云端任务，音轨已变化，请先核对，避免重复计费');
  if([...jfAsrJobs.values()].some(x=>x.status==='running'))throw Error('已有转写任务正在进行');
  const id=crypto.randomBytes(16).toString('hex');
  const durationMs=Math.round(part.endSeconds*1000);
  const job={id,key,status:'running',label:'准备上传完整音轨',current:0,total:1,started:Date.now()};jfAsrJobs.set(id,job);
  (async()=>{
    try{
      let task=pending?.taskId;
      if(!task){
        job.label='上传完整音轨到千问临时存储';
        const url=await jfAsrUpload(file,credential);
        job.label='提交异步识别任务';
        task=await jfAsrSubmit(url,credential,vocabulary);
        await jfAsrSaveTask(key,task,audioFingerprint);
      }
      job.label=pending?'恢复已有云端任务':'云端识别中（整段音频）';
      const result=await jfAsrAwait(task,credential);
      const rows=jfAsrValidateRows(jfAsrParseResult(result,0,durationMs),durationMs);
      // A paid regeneration must not destroy the preceding handwritten corrections.
      // Keep the previous revision in a separate local backup before replacing it.
      const prior=jfAsrReadTranscript(key);
      if(prior){
        const oldFile=jfAsrTranscriptFile(key),backup=path.join(AI_LEARNING_DIR,key+'.transcript-previous.json');
        vaultWriteBytes(backup,vaultReadBytes(oldFile));
      }
      await jfAsrAtomicWrite(key,{version:1,sourceKey:key,durationMs,segments:rows,revision:(prior?.revision||0)+1,confirmed:false,complete:true,completedParts:1,createdAt:prior?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),provider:'qwen',model:JF_ASR_MODEL});
      await fs.promises.rm(jfAsrTaskFile(key),{force:true});
      job.current=1;job.status='done';job.label='完整初稿已保存，请逐句校订';
    }catch(e){if(e.terminal)await fs.promises.rm(jfAsrTaskFile(key),{force:true}).catch(()=>{});job.status='error';job.label=jfAsrSafeError(e);}
  })();
  return {id,status:job.status};
}
function jfAsrJobPublic(id){const j=jfAsrJobs.get(id);if(!j)throw Error('任务不存在');return {ok:true,id:j.id,key:j.key,status:j.status,label:j.label,current:j.current,total:j.total};}
