// v6.50 Reading desk: one library root, no active EPUB markup, encrypted metadata via v6.48 vault.
// Requires: 00-bootstrap, 10-security, 15-vault, 45-bookshelf. Node built-ins only.
const jfReaderZlib=require('node:zlib');
const JF_READING_DIR=path.join(CACHE_DIR,'reading');
const JF_READING_DATA=path.join(JF_READING_DIR,'workspace.json');
const JF_READING_BACKUP=path.join(JF_READING_DIR,'workspace.json.bak');
function jfReaderError(code,message){const e=Error(message);e.status=code;return e;}
function jfReadingCheckOrigin(req){
  // Local server only. Strict Origin and Fetch-Metadata checks for writes (including absent Origin).
  try{jfAsrCheckOrigin(req);}catch{throw jfReaderError(403,'禁止跨站访问阅读资料');}
  if(req.method!=='GET'&&req.method!=='HEAD'){
    const site=String(req.headers['sec-fetch-site']||'');
    if(site && site!=='same-origin' && site!=='none')throw jfReaderError(403,'来源不受信任');
    if(!/^application\/json(?:;|$)/i.test(String(req.headers['content-type']||'')))throw jfReaderError(415,'仅接受 JSON 请求');
  }
}
async function jfBookFindById(id){
  if(!/^[a-f0-9]{16}$/.test(id))throw jfReaderError(400,'书籍编号无效');
  const listed=await jfListBooks(false);
  const info=listed.books.find(b=>b.id===id);
  if(!info)throw jfReaderError(404,'书籍已移动或不在当前目录');
  const relative=(info.relativeDir==='root'?'':info.relativeDir+'/')+(info.managedName||info.name);
  const file=path.resolve(targetDir,...relative.split('/'));
  const root=await fs.promises.realpath(targetDir);
  let canonical;
  try{canonical=await fs.promises.realpath(file);}catch{throw jfReaderError(404,'书籍文件已不存在');}
  if(!canonical.startsWith(root+path.sep))throw jfReaderError(403,'拒绝目录外文件或符号链接');
  const stat=await fs.promises.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw jfReaderError(403,'非法书籍类型');
  if(stat.size!==info.size||Math.floor(stat.mtimeMs)!==info.modified)throw jfReaderError(409,'书籍已变化，请刷新书架');
  return {info,file,stat};
}
function jfReadingLoad(){
  if(!fs.existsSync(JF_READING_DATA)){
    if(fs.existsSync(JF_READING_BACKUP))throw jfReaderError(409,'笔记主数据缺失，请检查备份，拒绝创建空白文件');
    return {version:1,revision:0,progress:{},notes:[],marks:[],lastExcerptNoteId:null};
  }
  const d=vaultReadJson(JF_READING_DATA);
  if(!d||d.version!==1||!Number.isSafeInteger(d.revision)||!Array.isArray(d.notes)||typeof d.progress!=='object'||!d.progress)
    throw jfReaderError(409,'阅读数据格式损坏，拒绝覆盖');
  return d;
}
// v7.09: 64 MiB vaultReadBytes bounds *stored* ciphertext files. In password
// mode the authenticated JSON envelope expands the original JSON by 4/3.
// A 46 MiB cleartext ceiling leaves >2.5 MiB headroom for the envelope, so
// a successful write cannot create a workspace that vaultReadBytes will reject.
const JF_READING_JSON_SAFE_BYTES=46*1024*1024;
function jfReadingSave(d){
  // v7.14: fail closed on an unverified old main/backup, and verify both
  // published files. All writes remain atomic, authenticated and path-bound.
  const serialized=JSON.stringify(d);
  if(Buffer.byteLength(serialized,'utf8')>JF_READING_JSON_SAFE_BYTES)
    throw jfReaderError(413,'笔记与图片总量已接近安全容量上限；请先精简图片摘录，原文件未被覆盖');
  const next=Buffer.from(serialized,'utf8');
  const same=(file,expected)=>{
    const actual=vaultReadBytes(file);
    if(!actual.equals(expected))throw jfReaderError(500,'阅读资料写入复核失败，已阻止继续提交');
  };
  const hadMain=fs.existsSync(JF_READING_DATA);
  const prior=hadMain?vaultReadBytes(JF_READING_DATA):null;
  if(hadMain){
    // AAD binds backup to its own pathname, even when the main is encrypted.
    vaultWriteBytes(JF_READING_BACKUP,prior,{durable:true});
    same(JF_READING_BACKUP,prior); // Abort before touching main if backup is bad.
  }
  let attemptedMain=false;
  try{
    attemptedMain=true;
    vaultWriteBytes(JF_READING_DATA,next,{durable:true});
    same(JF_READING_DATA,next);
  }catch(error){
    if(attemptedMain&&hadMain){
      // A write may have failed after atomic rename. Restore the *verified*
      // prior bytes with fresh AAD; never rename a backup ciphertext to main.
      try{
        vaultWriteBytes(JF_READING_DATA,prior,{durable:true});
        same(JF_READING_DATA,prior);
      }catch(rollbackError){
        throw jfReaderError(500,'阅读资料保存及恢复均失败；保留现存主文件和备份，请先检查完整性：'+rollbackError.message);
      }
    }
    throw error;
  }
}
function jfReadingPublic(){const d=jfReadingLoad();return {ok:true,revision:d.revision,progress:d.progress,notes:d.notes,marks:d.marks||[],lastExcerptNoteId:d.lastExcerptNoteId||null,preferences:d.preferences||{font:18,theme:'dark',side:22,family:'serif'}};}
// v7.08: explicitly requested, read-only health summary of the active workspace.
// Checks the authenticated backup via its own AAD path. Never auto-restores,
// rekeys, scans the media library, deletes or rewrites a user object.
function jfReadingIntegrity(){
  const data=jfReadingLoad();
  const notes=Array.isArray(data.notes)?data.notes:[],marks=Array.isArray(data.marks)?data.marks:[];
  const seen=new Set(),issues=[];
  for(const note of notes){
    if(!note||typeof note.id!=='string'||!/^[a-f0-9]{24}$/.test(note.id)){issues.push('invalid_note_id');continue;}
    if(seen.has(note.id))issues.push('duplicate_note_id');
    seen.add(note.id);
  }
  for(const mark of marks){
    if(!mark||!['text','area','page'].includes(mark.type)||
       !/^[a-f0-9]{16}$/.test(String(mark.bookId||''))||
       !Number.isSafeInteger(mark.chapter)||mark.chapter<0||mark.chapter>5000){
      issues.push('invalid_mark_reference');
    }
  }
  let images=null;
  try{const count=jfReadingImageInventory(data);images={
    embeddedCount:count.embeddedCount,uniqueCount:count.uniqueCount,
    embeddedBytes:count.embeddedBytes,uniqueBytes:count.uniqueBytes
  };}catch{issues.push('invalid_embedded_image');}
  const relations=jfReadingAuditRelationships(data);
  issues.push(...relations.issues);
  const backup={present:fs.existsSync(JF_READING_BACKUP),valid:null,revision:null};
  if(backup.present){
    try{
      const d=JSON.parse(vaultReadBytes(JF_READING_BACKUP).toString('utf8'));
      if(!d||d.version!==1||!Number.isSafeInteger(d.revision)||!Array.isArray(d.notes)||d.revision>data.revision)
        throw Error('invalid backup schema');
      backup.valid=true;backup.revision=d.revision;
    }catch{backup.valid=false;issues.push('invalid_or_newer_backup');}
  }
  return {ok:issues.length===0,readOnly:true,workspaceVersion:data.version,revision:data.revision,
    notes:notes.length,marks:marks.length,images,backup,relations:{
      quotesChecked:relations.quotesChecked,blocksChecked:relations.blocksChecked,
      pagesChecked:relations.pagesChecked,groupsChecked:relations.groupsChecked},
    issues:[...new Set(issues)].sort(),
    scope:'workspace-and-authenticated-backup-only',
    notChecked:['media-hashes','catalog-hash-map','orphan-objects','windows-dpapi','removable-drive']};
}
function jfReadingAddMark(d,value){
  if(!value||typeof value!=='object')throw jfReaderError(400,'标记无效');
  const bookId=String(value.bookId||''),kind=['area','page'].includes(value.type)?value.type:'text';
  const chapter=value.chapter,anchorStart=value.anchorStart,len=value.length;
  const text=String(value.text||'').slice(0,5000);
  if(!/^[a-f0-9]{16}$/.test(bookId)||!Number.isSafeInteger(chapter)||chapter<0||chapter>5000)
    throw jfReaderError(400,'标记书籍和页码无效');
  const color=value.color===undefined?'blue':jfReadingMarkColor(value.color);
  const record={bookId,chapter,type:kind,...(color==='blue'?{}:{color})};
  if(kind==='text'){
    if(!text||!Number.isSafeInteger(anchorStart)||anchorStart<0||anchorStart>12000000||
      !Number.isSafeInteger(len)||len<1||len>5000)throw jfReaderError(400,'文字标记位置无效');
    Object.assign(record,{text,anchorStart,length:len});
  }else if(kind==='area'){
    const area=value.area;
    if(!Array.isArray(area)||area.length!==4||area.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)||area[2]<=0||area[3]<=0||area[0]+area[2]>1.001||area[1]+area[3]>1.001)
      throw jfReaderError(400,'区域标记范围无效');
    record.area=area;
    if(value.segments!==undefined){
      const strips=value.segments;
      if(!Array.isArray(strips)||strips.length<1||strips.length>40||strips.some(s=>
        !Array.isArray(s)||s.length!==4||s.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)||
        s[2]<=0||s[3]<=0||s[0]<area[0]-.002||s[1]<area[1]-.002||
        s[0]+s[2]>area[0]+area[2]+.002||s[1]+s[3]>area[1]+area[3]+.002))
        throw jfReaderError(400,'多行截图选区无效');
      record.segments=strips;
    }
  }
  if(!Array.isArray(d.marks))d.marks=[];
  const duplicate=d.marks.some(m=>m.bookId===bookId&&m.chapter===chapter&&m.type===kind&&
    (kind==='text'?m.anchorStart===anchorStart&&m.text===text:kind==='page'?true:JSON.stringify(m.area)===JSON.stringify(record.area)));
  if(!duplicate){if(d.marks.length>=10000)throw jfReaderError(413,'标记数量达到上限');d.marks.push(record);}
}
// Mark identity is its immutable source anchor, not a mutable visual color.
// Supports old v1 marks without IDs or colors. No migration is necessary.
const JF_MARK_COLORS=new Set(['blue','mint','amber','rose','violet']);
function jfReadingMarkColor(color){
  if(typeof color!=='string'||!JF_MARK_COLORS.has(color))throw jfReaderError(400,'标记颜色无效');
  return color;
}
function jfReadingMarkIndex(d,identity){
  if(!identity||typeof identity!=='object')throw jfReaderError(400,'标记定位无效');
  const {bookId,chapter,type}=identity;
  if(!/^[a-f0-9]{16}$/.test(String(bookId||''))||!Number.isSafeInteger(chapter)||chapter<0||chapter>5000||!['text','area','page'].includes(type))
    throw jfReaderError(400,'标记定位无效');
  if(type==='text'&&(!Number.isSafeInteger(identity.anchorStart)||identity.anchorStart<0||identity.anchorStart>12000000||typeof identity.text!=='string'||!identity.text||identity.text.length>5000))
    throw jfReaderError(400,'文字标记定位无效');
  if(type==='area'&&(!Array.isArray(identity.area)||identity.area.length!==4||identity.area.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)))
    throw jfReaderError(400,'区域标记定位无效');
  const index=(d.marks||[]).findIndex(m=>m.bookId===bookId&&m.chapter===chapter&&m.type===type&&
    (type==='page'||(type==='text'&&m.anchorStart===identity.anchorStart&&m.text===identity.text)||
     (type==='area'&&JSON.stringify(m.area)===JSON.stringify(identity.area))));
  if(index<0)throw jfReaderError(404,'标记已不存在，请刷新');
  return index;
}
function jfReadingUpdate(body){
  const d=jfReadingLoad();
  if(!Number.isSafeInteger(body.revision)||body.revision!==d.revision)
    throw jfReaderError(409,'资料已被其他页面修改，请重新载入后再保存');
  if(body.action==='progress'){
    const id=String(body.bookId||'');
    if(!/^[a-f0-9]{16}$/.test(id)||!Number.isSafeInteger(body.chapter)||body.chapter<0||body.chapter>5000||
       typeof body.ratio!=='number'||!Number.isFinite(body.ratio)||body.ratio<0||body.ratio>1)
      throw jfReaderError(400,'阅读进度参数无效');
    const total=body.total;
    if(total!==undefined && (!Number.isSafeInteger(total)||total<1||total>5001||body.chapter>=total))
      throw jfReaderError(400,'阅读章节总数无效');
    d.progress[id]={chapter:body.chapter,ratio:body.ratio,updatedAt:Date.now(),...(total===undefined?{}:{total})};
  } else if(body.action==='note'){
    const n=body.note;
    if(!n||typeof n!=='object')throw jfReaderError(400,'笔记数据无效');
    const id=String(n.id||'');
    if(!/^[a-f0-9]{24}$/.test(id))throw jfReaderError(400,'笔记编号无效');
    const title=String(n.title||'').trim().slice(0,160);
    const content=String(n.content||'');
    const excerpt=String(n.excerpt||'');
    if(content.length>100000||excerpt.length>6000||d.notes.length>30000)throw jfReaderError(413,'笔记内容超出限制');
    const bookId=n.bookId===null||n.bookId===undefined?'':String(n.bookId);
    if(bookId&&!/^[a-f0-9]{16}$/.test(bookId))throw jfReaderError(400,'关联书籍编号无效');
    const chapter=Number.isSafeInteger(n.chapter)&&n.chapter>=0&&n.chapter<=5000?n.chapter:0;
    const existing=d.notes.findIndex(x=>x.id===id);
    const anchorStart=n.anchorStart==null?null:n.anchorStart;
    if(anchorStart!==null&&(!Number.isSafeInteger(anchorStart)||anchorStart<0||anchorStart>12000000))
      throw jfReaderError(400,'摘录位置无效');
    // A note has no source of its own. Only explicit quote blocks carry references.
    const quotes=Array.isArray(n.quotes)?n.quotes:[];
    if(quotes.length>40)throw jfReaderError(413,'笔记摘录数量超限');
    const cleanQuotes=quotes.map(q=>{
      if(!q||typeof q!=='object')throw jfReaderError(400,'摘录数据无效');
      const text=String(q.text||'').trim();
      const reference=String(q.bookId||'');
      const position=q.anchorStart==null?null:q.anchorStart;
      const isImage=q.type==='image';
      const image=isImage?String(q.image||''):'';
      // Embedded note excerpts are strictly bounded and travel with the encrypted
      // workspace/backup. Never persist unbounded source PDF page bitmaps.
      if(text.length>6000||(!text&&!isImage)||!/^[a-f0-9]{16}$/.test(reference)||
         !Number.isSafeInteger(q.chapter)||q.chapter<0||q.chapter>5000||
         (position!==null&&(!Number.isSafeInteger(position)||position<0||position>12000000)))
        throw jfReaderError(400,'摘录来源无效');
      if(isImage){
        if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)||image.length>235000||image.length<150||
           Buffer.from(image.slice(23),'base64').subarray(0,3).toString('hex')!=='ffd8ff')
          throw jfReaderError(413,'图片摘录格式或尺寸无效');
        jfReadingImageIdentity(image); // Stable content SHA; persistence stays v1.
      }
      let pages;
      if(isImage&&q.pages!==undefined){
        if(!Array.isArray(q.pages)||q.pages.length<2||q.pages.length>6)
          throw jfReaderError(400,'跨页摘录页数无效');
        pages=q.pages.map((page,i)=>{
          if(!page||!Number.isSafeInteger(page.chapter)||page.chapter<0||page.chapter>5000||
             typeof page.image!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(page.image)||
             page.image.length<150||page.image.length>235000||
             Buffer.from(page.image.slice(23),'base64').subarray(0,3).toString('hex')!=='ffd8ff')
            throw jfReaderError(413,'跨页摘录图片无效');
          jfReadingImageIdentity(page.image);
          return {chapter:page.chapter,image:page.image};
        });
        if(pages[0].chapter!==q.chapter||pages[0].image!==image||
           pages.some((page,i)=>i&&page.chapter<pages[i-1].chapter))
          throw jfReaderError(400,'跨页摘录顺序无效');
      }
      const width=isImage&&Number.isInteger(q.imageWidth)&&q.imageWidth>=20&&q.imageWidth<=100?q.imageWidth:100;
      const align=isImage&&['left','center','right'].includes(q.imageAlign)?q.imageAlign:'left';
      return {...(isImage?{type:'image',image,imageWidth:width,imageAlign:align,...(pages?{pages}:{})}:{}),text,bookId:reference,chapter:q.chapter,anchorStart:position};
    });
    if(cleanQuotes.reduce((sum,q)=>sum+(q.pages?q.pages.reduce((n,p)=>n+p.image.length,0):(q.image?.length||0)),0)>1500000)throw jfReaderError(413,'单篇笔记图片总量超限');
    // v6.75: ordered writing/excerpt flow. Keep legacy content and quote fields
    // for existing notes and readers. Reject malformed references atomically.
    let blocks;
    if(n.blocks!==undefined){
      if(!Array.isArray(n.blocks)||n.blocks.length>90)throw jfReaderError(413,'笔记内容块超限');
      blocks=n.blocks.map(block=>{
        if(!block||typeof block!=='object')throw jfReaderError(400,'笔记内容块无效');
        if(block.kind==='text'&&typeof block.text==='string'&&block.text.length<=100000)return {kind:'text',text:block.text};
        if(block.kind==='quote'&&Number.isSafeInteger(block.index)&&block.index>=0&&block.index<cleanQuotes.length)return {kind:'quote',index:block.index};
        throw jfReaderError(400,'笔记内容块无效');
      });
      if(blocks.filter(b=>b.kind==='text').reduce((sum,b)=>sum+b.text.length,0)>100000||
         new Set(blocks.filter(b=>b.kind==='quote').map(b=>b.index)).size!==cleanQuotes.length||
         blocks.filter(b=>b.kind==='quote').length!==cleanQuotes.length)throw jfReaderError(400,'笔记内容块与摘录不一致');
    }
    const format=n.format===undefined?'md':n.format;
    if(format!=='md'&&format!=='rich')throw jfReaderError(400,'笔记格式无效');
    const item={id,title,content,format,excerpt,bookId,chapter,anchorStart,quotes:cleanQuotes,...(blocks?{blocks}:{}),updatedAt:Date.now(),createdAt:existing<0?Date.now():d.notes[existing].createdAt};
    if(existing<0)d.notes.push(item);else d.notes[existing]=item;
    // Optional atomic source marker: the note and its highlight commit together.
    if(body.alsoMark){jfReadingAddMark(d,body.alsoMark);d.lastExcerptNoteId=id;}
  } else if(body.action==='mark'){
    jfReadingAddMark(d,body.mark);
  } else if(body.action==='merge-marks'){
    // Merge two neighbouring visual units atomically. Source-page coordinates
    // remain independent; groupId merely makes them one logical annotation.
    const left=jfReadingMarkIndex(d,body.mark),right=jfReadingMarkIndex(d,body.neighbor);
    if(left===right)throw jfReaderError(400,'不能与自身合并');
    const a=d.marks[left],b=d.marks[right];
    if(a.type!=='area'||b.type!=='area'||a.bookId!==b.bookId)
      throw jfReaderError(400,'只能合并同一本书的图片区域标记');
    const sorted=d.marks.filter(m=>m.bookId===a.bookId).sort((x,y)=>x.chapter-y.chapter||(x.area?.[1]||0)-(y.area?.[1]||0));
    const units=[],byGroup=new Map();
    for(const mark of sorted){
      if(mark.groupId&&byGroup.has(mark.groupId)){byGroup.get(mark.groupId).push(mark);continue;}
      const unit=[mark];units.push(unit);if(mark.groupId)byGroup.set(mark.groupId,unit);
    }
    const x=units.findIndex(unit=>unit.includes(a)),y=units.findIndex(unit=>unit.includes(b));
    if(Math.abs(x-y)!==1||x<0||y<0)throw jfReaderError(409,'只能合并相邻的标记单元');
    const merged=[...units[x],...units[y]];
    if(merged.length>6)throw jfReaderError(413,'每组最多合并 6 条标记');
    // Keep one stable token for existing groups; no source mark is discarded.
    const id=merged.find(m=>m.groupId)?.groupId||crypto.randomBytes(12).toString('hex');
    const color=merged[0].color;
    for(const mark of merged){mark.groupId=id;if(color)mark.color=color;else delete mark.color;}
  } else if(body.action==='unmerge-marks'){
    const index=jfReadingMarkIndex(d,body.mark);
    const group=d.marks[index].groupId;
    if(!group)throw jfReaderError(409,'标记不是组合单元');
    for(const mark of d.marks)if(mark.groupId===group)delete mark.groupId;
  } else if(body.action==='recolor-mark'){
    const index=jfReadingMarkIndex(d,body.mark);
    const selected=d.marks[index],group=selected.groupId;
    const color=jfReadingMarkColor(body.color);
    for(const mark of d.marks){if(mark!==selected&&(!group||mark.groupId!==group))continue;
      if(color==='blue')delete mark.color;
      else mark.color=color;
    }
  } else if(body.action==='delete-mark'){
    const index=jfReadingMarkIndex(d,body.mark);
    const selected=d.marks[index],group=selected.groupId;
    d.marks=d.marks.filter(mark=>mark!==selected&&(!group||mark.groupId!==group));
  } else if(body.action==='recent-note'){
    const id=String(body.id||'');
    if(!d.notes.some(n=>n.id===id))throw jfReaderError(404,'目标笔记不存在');
    d.lastExcerptNoteId=id;
  } else if(body.action==='preferences'){
    const prefs=body.preferences;
    if(!prefs||typeof prefs!=='object'||!Number.isSafeInteger(prefs.font)||prefs.font<13||prefs.font>28||
       !['dark','paper'].includes(prefs.theme))throw jfReaderError(400,'阅读设置参数无效');
    if(prefs.side!==undefined&&(!Number.isSafeInteger(prefs.side)||prefs.side<6||prefs.side>100))throw jfReaderError(400,'阅读边距无效');
    if(prefs.family!==undefined&&!['serif','sans','kai','mono'].includes(prefs.family))throw jfReaderError(400,'阅读字体无效');
    d.preferences={font:prefs.font,theme:prefs.theme,side:prefs.side===undefined?22:prefs.side,family:prefs.family||'serif'};
  } else if(body.action==='delete-note'){
    const id=String(body.id||'');
    if(!/^[a-f0-9]{24}$/.test(id))throw jfReaderError(400,'笔记编号无效');
    const index=d.notes.findIndex(x=>x.id===id);
    if(index<0)throw jfReaderError(404,'笔记不存在');
    d.notes.splice(index,1);if(d.lastExcerptNoteId===id)d.lastExcerptNoteId=null;
  } else throw jfReaderError(400,'不支持的阅读操作');
  d.revision++;
  jfReadingSave(d);
  return jfReadingPublic();
}
function jfReadingTextDecode(bytes){
  if(bytes.length>=2&&bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if(bytes.length>=2&&bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const utf8=new TextDecoder('utf-8',{fatal:true});
  try{return utf8.decode(bytes).replace(/^\ufeff/,'');}
  catch{return new TextDecoder('gb18030').decode(bytes);}
}
function jfReadingXmlDecode(t){
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',mdash:'—',ndash:'–',hellip:'…',ldquo:'“',rdquo:'”',lsquo:'‘',rsquo:'’'};
  return t.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi,(m,name)=>{
    if(name[0]==='#'){
      const code=name[1]?.toLowerCase()==='x'?parseInt(name.slice(2),16):parseInt(name.slice(1),10);
      return Number.isFinite(code)&&code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'�';
    }
    return named[name.toLowerCase()]??m;
  });
}
function jfReadingHtmlToText(html){
  return jfReadingXmlDecode(html
    .replace(/<!--[^]*?-->/g,'')
    .replace(/<(script|style|svg|math|head|nav)\b[^>]*>[^]*?<\/\1\s*>/gi,'')
    .replace(/<\s*br\b[^>]*\/?\s*>/gi,'\n')
    .replace(/<\/?\s*(?:p|div|li|h[1-6]|blockquote|tr|section|article|title)\b[^>]*>/gi,'\n\n')
    .replace(/<[^>]*>/g,'')
  ).replace(/\r/g,'').replace(/[\t ]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{4,}/g,'\n\n\n').trim();
}
function jfReaderZipIndex(buffer){
  // Safe bounded read of EPUB ZIP's central directory. Never unpack to disk.
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}}
  if(end<0||end+22>buffer.length)throw jfReaderError(422,'EPUB ZIP 目录无效');
  const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),offset=buffer.readUInt32LE(end+16);
  if(count>3000||count===65535||offset===0xffffffff||size>buffer.length||offset+size>buffer.length)throw jfReaderError(422,'EPUB 条目数或目录大小超限');
  const entries=new Map();let cursor=offset;
  for(let i=0;i<count;i++){
    if(cursor+46>buffer.length||buffer.readUInt32LE(cursor)!==0x02014b50)throw jfReaderError(422,'EPUB 索引损坏');
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),packed=buffer.readUInt32LE(cursor+20),unpacked=buffer.readUInt32LE(cursor+24);
    const nameLen=buffer.readUInt16LE(cursor+28),extraLen=buffer.readUInt16LE(cursor+30),commentLen=buffer.readUInt16LE(cursor+32);
    const local=buffer.readUInt32LE(cursor+42);
    if(cursor+46+nameLen+extraLen+commentLen>buffer.length)throw jfReaderError(422,'EPUB ZIP 名称越界');
    const name=buffer.toString('utf8',cursor+46,cursor+46+nameLen);
    if(flags&1||![0,8].includes(method)||unpacked>12*1024*1024||packed>40*1024*1024)
      throw jfReaderError(422,'EPUB 包含不支持的压缩项目');
    if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..'))throw jfReaderError(422,'EPUB 路径无效');
    entries.set(name,{method,packed,unpacked,local});cursor+=46+nameLen+extraLen+commentLen;
  }
  function read(name){
    const entry=entries.get(name);if(!entry)throw jfReaderError(422,'EPUB 缺失内容：'+name.slice(0,80));
    const l=entry.local;
    if(l+30>buffer.length||buffer.readUInt32LE(l)!==0x04034b50)throw jfReaderError(422,'EPUB 数据块错误');
    const begin=l+30+buffer.readUInt16LE(l+26)+buffer.readUInt16LE(l+28);
    if(begin+entry.packed>buffer.length)throw jfReaderError(422,'EPUB 数据越界');
    const raw=buffer.subarray(begin,begin+entry.packed);
    const result=entry.method===8?jfReaderZlib.inflateRawSync(raw,{maxOutputLength:12*1024*1024}):raw;
    if(result.length!==entry.unpacked)throw jfReaderError(422,'EPUB 解压长度错误');
    return result;
  }
  return {entries,read};
}
function jfReadingAttr(tag,key){return new RegExp('(?:^|\\s)'+key+'\\s*=\\s*["\']([^"\']+)["\']','i').exec(tag)?.[1]||'';}
function jfReadingEpub(buf){
  const zip=jfReaderZipIndex(buf);
  const container=jfReadingTextDecode(zip.read('META-INF/container.xml'));
  const opfPath=jfReadingAttr(container.match(/<rootfile\b[^>]*>/i)?.[0]||'','full-path');
  if(!opfPath||!zip.entries.has(opfPath))throw jfReaderError(422,'EPUB 书籍清单缺失');
  const opf=jfReadingTextDecode(zip.read(opfPath));
  const base=require('node:path').posix.dirname(opfPath);
  const manifest=new Map();let navHref='',ncxHref='';
  for(const tag of opf.match(/<item\b[^>]*>/gi)||[]){
    const id=jfReadingAttr(tag,'id'),href=jfReadingAttr(tag,'href');
    if(id&&href)manifest.set(id,href);
    if(/(?:^|\s)nav(?:\s|$)/.test(jfReadingAttr(tag,'properties')))navHref=href;
    if(jfReadingAttr(tag,'media-type')==='application/x-dtbncx+xml')ncxHref=href;
  }
  const chapterTitles=new Map();
  function navPath(href){
    try{
      const p=require('node:path').posix.normalize(require('node:path').posix.join(base,decodeURIComponent(jfReadingXmlDecode(href.split('#')[0]))));
      return p.startsWith('../')||p.startsWith('/')?'':p;
    }catch{return '';}
  }
  // EPUB3 nav.xhtml: read only link text and href. Never execute EPUB HTML or fetch remote content.
  if(navHref){
    const source=navPath(navHref);
    if(zip.entries.has(source))try{
      const html=jfReadingTextDecode(zip.read(source));
      for(const item of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
        const href=jfReadingAttr(item[1],'href');
        const title=jfReadingHtmlToText(item[2]).replace(/\s+/g,' ').trim().slice(0,100);
        if(title&&href){const target=require('node:path').posix.normalize(require('node:path').posix.join(require('node:path').posix.dirname(source),decodeURIComponent(jfReadingXmlDecode(href.split('#')[0]))));
          if(zip.entries.has(target)&&!chapterTitles.has(target))chapterTitles.set(target,title);}
      }
    }catch{} // Malformed optional TOC should never prevent reading the spine.
  }
  // EPUB2 NCX: use navPoint text without running arbitrary book markup.
  if(ncxHref && chapterTitles.size===0){
    const source=navPath(ncxHref);
    if(zip.entries.has(source))try{
      const ncx=jfReadingTextDecode(zip.read(source));
      for(const item of ncx.matchAll(/<navPoint\b[^>]*>([\s\S]*?)<\/navPoint\s*>/gi)){
        const href=jfReadingAttr(item[1].match(/<content\b[^>]*>/i)?.[0]||'','src');
        const label=item[1].match(/<navLabel\b[^>]*>([\s\S]*?)<\/navLabel\s*>/i)?.[1]||'';
        const title=jfReadingHtmlToText(label).replace(/\s+/g,' ').trim().slice(0,100);
        if(title&&href){const target=require('node:path').posix.normalize(require('node:path').posix.join(require('node:path').posix.dirname(source),decodeURIComponent(jfReadingXmlDecode(href.split('#')[0]))));
          if(zip.entries.has(target)&&!chapterTitles.has(target))chapterTitles.set(target,title);}
      }
    }catch{}
  }
  const chapters=[];
  for(const tag of opf.match(/<itemref\b[^>]*>/gi)||[]){
    const ref=jfReadingAttr(tag,'idref'),href=manifest.get(ref);if(!href)continue;
    const canonical=require('node:path').posix.normalize(require('node:path').posix.join(base,decodeURIComponent(href.split('#')[0])));
    if(canonical.startsWith('../')||!zip.entries.has(canonical))continue;
    if(!/\.x?html?$/i.test(canonical))continue;
    chapters.push({file:canonical,title:chapterTitles.get(canonical)||'章节 '+(chapters.length+1)});
    if(chapters.length>=500)break;
  }
  if(!chapters.length)throw jfReaderError(422,'EPUB 未找到可阅读章节');
  return {zip,chapters};
}
async function jfReadingOutline(id){
  const {info,file,stat}=await jfBookFindById(id);
  if(info.ext==='PDF')return {ok:true,book:info,format:'PDF',chapters:[{title:'PDF 文档'}],nativePdf:true};
  if(stat.size>40*1024*1024)throw jfReaderError(413,'此书超过当前离线阅读器大小上限（40MB）');
  if(info.ext==='EPUB'){
    const epub=jfReadingEpub(await fs.promises.readFile(file));
    return {ok:true,book:info,format:'EPUB',chapters:epub.chapters.map(c=>({title:c.title}))};
  }
  if(stat.size>12*1024*1024)throw jfReaderError(413,'文本书籍超过当前 12MB 阅读限制');
  const t=jfReadingTextDecode(await fs.promises.readFile(file));
  const sections=jfReadingSplitText(t);
  return {ok:true,book:info,format:info.ext,chapters:sections.map((_,i)=>({title:'第 '+(i+1)+' 节'}))};
}
function jfReadingSplitText(raw){
  const text=raw.replace(/\r\n?/g,'\n');
  const chapters=[];
  for(let at=0;at<text.length;){
    let end=Math.min(text.length,at+14000);
    if(end<text.length){const cut=text.lastIndexOf('\n',end);if(cut>at+7000)end=cut+1;}
    chapters.push(text.slice(at,end));at=end;
  }
  return chapters.length?chapters:[''];
}
async function jfReadingChapter(id,index){
  const {info,file,stat}=await jfBookFindById(id);
  if(!Number.isSafeInteger(index)||index<0||index>5000)throw jfReaderError(400,'章节编号无效');
  if(info.ext==='PDF')throw jfReaderError(400,'PDF 使用浏览器内置阅读器');
  let text,total;
  if(info.ext==='EPUB'){
    if(stat.size>40*1024*1024)throw jfReaderError(413,'EPUB 文件超出 40MB');
    const epub=jfReadingEpub(await fs.promises.readFile(file));
    total=epub.chapters.length;
    if(index>=total)throw jfReaderError(404,'章节不存在');
    text=jfReadingHtmlToText(jfReadingTextDecode(epub.zip.read(epub.chapters[index].file)));
  }else{
    if(stat.size>12*1024*1024)throw jfReaderError(413,'文本文件超出 12MB');
    const sections=jfReadingSplitText(jfReadingTextDecode(await fs.promises.readFile(file)));
    total=sections.length;if(index>=total)throw jfReaderError(404,'章节不存在');
    text=sections[index];
  }
  return {ok:true,chapter:index,total,text,book:info};
}
async function jfReadingPdf(req,res,id){
  const {info,file,stat}=await jfBookFindById(id);
  if(info.ext!=='PDF')throw jfReaderError(415,'只允许预览 PDF 文件');
  if(!stat.size)throw jfReaderError(422,'PDF 内容为空');
  let start=0,end=stat.size-1,status=200;
  const range=req.headers.range;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});res.end();return;}
    if(match[1]){start=Number(match[1]);end=match[2]?Number(match[2]):end;}
    else{const suffix=Number(match[2]);start=Math.max(0,stat.size-suffix);}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size||start<0){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});res.end();return;}
    end=Math.min(end,stat.size-1);status=206;
  }
  const headers={'Content-Type':'application/pdf','Content-Disposition':'inline','Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN'};
  if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
  res.writeHead(status,headers);
  if(req.method==='HEAD'){res.end();return;}
  fs.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
}
