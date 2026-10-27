// v6.38 — Local-only AI study notes. Never reads arbitrary user paths or source media.
// Persistent notes are separate from the media catalog, under the selected library's cache.
const AI_LEARNING_DIR=path.join(CACHE_DIR,'ai-learning');
const AI_LEARNING_MAX_BYTES=750*1024;
const AI_LEARNING_MAX_ROWS=2400;
function aiLearningItem(key){
  if(typeof key!=='string'||!/^[0-9a-f]{16}$/.test(key))throw Error('无效媒体编号');
  const item=catalog.items.find(x=>x.key===key&&x.state==='ready'&&['audio','video'].includes(itemMediaKind(x)));
  if(!item)throw Error('该音视频已经不存在，请刷新媒体库');
  return item;
}
function aiLearningFile(key){return path.join(AI_LEARNING_DIR,key+'.json');}
function aiLearningCleanText(value,length=5000){
  if(typeof value!=='string')throw Error('笔记文字格式无效');
  const result=value.replace(/\u0000/g,'').trim();
  if(result.length>length)throw Error('笔记文字过长');
  return result;
}
function aiLearningDuration(item){
  const value=Number(item.duration);return Number.isFinite(value)&&value>0?value*1000:null;
}
async function aiLearningDurationAsync(item){
  const known=aiLearningDuration(item);
  if(known)return known;
  // A freshly indexed media item may not yet have an asynchronously probed duration.
  // Never accept unbounded absolute timecodes when this metadata is missing.
  return (await aiAudioProbe(managedPath(item)))*1000;
}
function aiLearningValidate(source,kind,item,duration){
  if(!source||typeof source!=='object'||Array.isArray(source)||source.version!==1)throw Error(kind+' 格式不正确，要求 version=1');
  if(source.sourceKey!==undefined&&source.sourceKey!==item.key)throw Error(kind+' 不属于当前媒体，请确认导入的文件');
  if(source.durationMs!==undefined && (!Number.isSafeInteger(source.durationMs)||source.durationMs<0||duration&&Math.abs(source.durationMs-duration)>30000))throw Error(kind+' 的媒体总时长与当前文件不符');
  const field=kind==='notes'?'segments':'chapters';
  const rows=source[field];
  if(!Array.isArray(rows)||!rows.length||rows.length>AI_LEARNING_MAX_ROWS)throw Error(kind+' 的条目数无效');
  let prior=-1;
  const normalized=rows.map((row,index)=>{
    if(!row||typeof row!=='object'||Array.isArray(row))throw Error('第 '+(index+1)+' 条格式无效');
    const a=row.startMs,b=row.endMs;
    if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<=a||b>24*3600*1000||duration&&b>duration+1500)throw Error('第 '+(index+1)+' 条时间超过媒体范围');
    if(a<prior)throw Error('时间码必须按开始时间排序');prior=a;
    if(kind==='notes')return {startMs:a,endMs:b,title:aiLearningCleanText(row.title,180),note:aiLearningCleanText(row.note,6000),quote:typeof row.quote==='string'?aiLearningCleanText(row.quote,1000):''};
    function textList(x){if(x===undefined)return [];if(!Array.isArray(x)||x.length>40)return null;return x.map(v=>aiLearningCleanText(v,1000));}
    const points=textList(row.speakerPoints),analysis=textList(row.analysis);
    if(points===null||analysis===null)throw Error('章节观点必须是字符串数组');
    return {startMs:a,endMs:b,title:aiLearningCleanText(row.title,180),speakerPoints:points,analysis};
  });
  const output={version:1,sourceKey:item.key,durationMs:duration?Math.round(duration):null};output[field]=normalized;
  return output;
}
function aiLearningRead(key){
  const f=aiLearningFile(key);
  try{
    const stat=fs.statSync(f);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>AI_LEARNING_MAX_BYTES*1.5+4096)throw Error('笔记缓存文件异常');
    const data=vaultReadJson(f);
    if(data.version!==1||data.sourceKey!==key)throw Error('笔记缓存来源不匹配');
    return data;
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function aiLearningWrite(key,changes,origin){
  const item=aiLearningItem(key);
  const duration=await aiLearningDurationAsync(item);
  const current=aiLearningRead(key)||{version:1,sourceKey:key,notes:null,outline:null};
  const next={...current,version:1,sourceKey:key};
  const origins={notes:current.origins?.notes||(current.notes&&current.origin==='manual'?'manual':null),
    outline:current.origins?.outline||(current.outline&&current.origin==='manual'?'manual':null)};
  let accepted=0,skipped=0;
  for(const kind of ['notes','outline'])if(Object.hasOwn(changes,kind)&&changes[kind]!==null){
    // Even a skipped candidate must pass identity/time validation.
    const parsed=aiLearningValidate(changes[kind],kind,item,duration);
    if(origin==='download'&&origins[kind]==='manual'&&current[kind]){skipped++;continue;}
    if(JSON.stringify(current[kind])===JSON.stringify(parsed)){skipped++;continue;}
    next[kind]=parsed;origins[kind]=origin==='download'?'download':'manual';accepted++;
  }
  if(!accepted&&!skipped)throw Error('没有可以导入的笔记或大纲');
  if(!accepted)return {notes:current.notes?.segments.length||0,outline:current.outline?.chapters.length||0,
    updatedAt:current.updatedAt||null,skipped:true};
  next.origins=origins;
  next.updatedAt=new Date().toISOString();next.origin=origin==='download'?'download':'manual';
  const body=JSON.stringify(next);
  if(Buffer.byteLength(body,'utf8')>AI_LEARNING_MAX_BYTES)throw Error('笔记太大，请缩短内容');
  fs.mkdirSync(AI_LEARNING_DIR,{recursive:true});
  const dst=aiLearningFile(key),temp=dst+'.tmp-'+crypto.randomBytes(6).toString('hex');
  vaultWriteBytes(dst,body);
  return {notes:next.notes?.segments.length||0,outline:next.outline?.chapters.length||0,updatedAt:next.updatedAt};
}
function aiLearningCandidateName(name){return /^(notes|outline)(?: \(\d{1,3}\))?\.json$/i.test(name);}
// Only fixed trusted download locations; no path is taken from an HTTP request.
// Background discovery requires both generated JSON files to identify the sourceKey.
async function aiLearningFindDownload(key){
  const item=aiLearningItem(key),duration=await aiLearningDurationAsync(item);
  const roots=[path.join(os.homedir(),'Downloads')];
  const exportsRoot=AI_AUDIO_EXPORT_ROOT;
  try{
    const dirs=fs.readdirSync(exportsRoot,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.isSymbolicLink()).slice(-120);
    for(const dir of dirs){
      const sub=path.join(exportsRoot,dir.name),manifest=path.join(sub,'segments.json');
      try{const stat=fs.lstatSync(manifest);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>50000)continue;
        const meta=JSON.parse(fs.readFileSync(manifest,'utf8'));if(meta.sourceKey===key)roots.push(sub);
      }catch{}
    }
  }catch{}
  const options={notes:[],outline:[]};
  const oldest=Date.now()-7*24*3600*1000;
  for(const root of roots){
    let entries;try{entries=fs.readdirSync(root,{withFileTypes:true}).slice(0,500);}catch{continue;}
    for(const e of entries){
      if(!e.isFile()||e.isSymbolicLink()||!aiLearningCandidateName(e.name))continue;
      const kind=e.name.toLowerCase().startsWith('notes')?'notes':'outline',file=path.join(root,e.name);
      try{
        const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>AI_LEARNING_MAX_BYTES*1.5+4096||stat.size<20||stat.mtimeMs<oldest)continue;
        const raw=fs.readFileSync(file,'utf8').replace(/^\ufeff/,'');const doc=JSON.parse(raw);
        // Do not infer identity from a filename; refuse unrelated downloads.
        if(doc.sourceKey!==key)continue;
        const validated=aiLearningValidate(doc,kind,item,duration);
        options[kind].push({document:validated,mtimeMs:stat.mtimeMs,name:e.name});
      }catch{}
    }
  }
  const selected={};for(const kind of ['notes','outline']){
    options[kind].sort((a,b)=>b.mtimeMs-a.mtimeMs);
    if(options[kind][0])selected[kind]=options[kind][0].document;
  }
  return {changes:selected,found:Object.keys(selected)};
}
