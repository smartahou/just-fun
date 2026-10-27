// Just Fun v6.97 · Books share the current library and its optional --hash mode.
// Hash name map is vault-protected where password mode is enabled.
const JF_BOOK_EXTENSIONS=new Set(['.pdf','.epub','.txt','.md','.markdown']);
const JF_BOOK_SKIP_DIRS=new Set(['.douyin-nav-cache','.git','.svn','node_modules','__MACOSX','PaxHeader','PaxHeaders']);
let jfBookScanCache={at:0,value:null,pending:null};
const JF_BOOK_NAME_INDEX=path.join(CACHE_DIR,'reading','book-names.json');
function jfBookNamesRead(){
  if(!fs.existsSync(JF_BOOK_NAME_INDEX))return {};
  const data=vaultReadJson(JF_BOOK_NAME_INDEX);
  if(!data||data.version!==1||!data.names||typeof data.names!=='object'||Array.isArray(data.names))throw jfReaderError(409,'书籍 Hash 索引损坏，已停止读写防止原名丢失');
  return data.names;
}
function jfBookNamesSave(names){
  fs.mkdirSync(path.dirname(JF_BOOK_NAME_INDEX),{recursive:true});
  vaultWriteJson(JF_BOOK_NAME_INDEX,{version:1,names});
}
async function jfBookRenameForHash(absolute,rel,entry,stat,names){
  const ext=path.extname(entry.name).toLowerCase();
  if(!HASH_ENABLED||!JF_BOOK_EXTENSIONS.has(ext))return {absolute,rel,name:entry.name};
  let hash,target,targetRel;
  do{
    hash=crypto.randomBytes(16).toString('hex');
    target=path.join(path.dirname(absolute),hash);
    targetRel=rel.slice(0,-entry.name.length)+hash;
  }while(fs.existsSync(target)||Object.prototype.hasOwnProperty.call(names,targetRel));
  const oldName=entry.name;
  const stableId=crypto.createHash('sha256').update(rel).digest('hex').slice(0,16);
  names[targetRel]={name:oldName,id:stableId};
  jfBookNamesSave(names); // write-ahead: original name can always be recovered after crash
  try{await fs.promises.rename(absolute,target);}catch(error){
    delete names[targetRel];jfBookNamesSave(names);throw error;
  }
  return {absolute:target,rel:targetRel,name:oldName};
}
async function jfBookDelete(id){
  const {info,file}=await jfBookFindById(id);
  const st=await fs.promises.lstat(file);
  if(!st.isFile()||st.isSymbolicLink())throw jfReaderError(403,'不是合法书籍文件');
  // jfBookFindById checks root containment, identity, mtime and size.
  await fs.promises.unlink(file);
  if(HASH_ENABLED){
    const names=jfBookNamesRead();
    const rel=(info.relativeDir==='root'?'':info.relativeDir+'/')+path.basename(file);
    if(names[rel]){delete names[rel];jfBookNamesSave(names);}
  }
  jfBookScanCache.value=null;jfBookScanCache.at=0;
  return {ok:true,deleted:info.id};
}
async function jfListBooks(force=false){
  if(!force && jfBookScanCache.value && Date.now()-jfBookScanCache.at<15000)return jfBookScanCache.value;
  if(jfBookScanCache.pending)return jfBookScanCache.pending;
  jfBookScanCache.pending=(async()=>{
    const books=[],stack=[{absolute:targetDir,relative:'',depth:0}];
    const bookNames=HASH_ENABLED?jfBookNamesRead():{};
    let visited=0,skipped=0,truncated=false;
    // Fixed budgets avoid blocking the player on pathological / externally mounted trees.
    while(stack.length){
      const dir=stack.pop();
      let entries;
      try{entries=await fs.promises.readdir(dir.absolute,{withFileTypes:true});}
      catch(error){if(dir.depth===0)throw error;skipped++;continue;}
      entries.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
      const sidecarNames=new Map(entries.filter(e=>e.isFile()).map(e=>[e.name.toLowerCase(),e.name]));
      for(const entry of entries){
        if(++visited>50000 || books.length>=10000){truncated=true;stack.length=0;break;}
        if(isArchiveSidecar(entry.name) || entry.name.startsWith('.'))continue;
        const rel=dir.relative?dir.relative+'/'+entry.name:entry.name;
        const absolute=path.join(dir.absolute,entry.name);
        // Dirent.isDirectory / isFile both false for symlinks; no symlink traversal.
        if(entry.isDirectory()){
          if(dir.depth<16 && !JF_BOOK_SKIP_DIRS.has(entry.name) &&
              !(dir.relative==='data' && /^(?:1001|1002)$/.test(entry.name)))
            stack.push({absolute,relative:rel,depth:dir.depth+1});
          else skipped++;
          continue;
        }
        if(!entry.isFile())continue;
        const known=HASH_ENABLED?bookNames[rel]:null;
        const original=known?.name||entry.name;
        const ext=path.extname(original).toLowerCase();
        if(!JF_BOOK_EXTENSIONS.has(ext))continue;
        let stat;
        try{stat=await fs.promises.lstat(absolute);}catch{skipped++;continue;}
        if(!stat.isFile())continue;
        let actual={absolute,rel,name:original};
        if(HASH_ENABLED&&!known){
          try{actual=await jfBookRenameForHash(absolute,rel,entry,stat,bookNames);}
          catch(e){skipped++;continue;}
        }
        const stem=original.slice(0,-ext.length);
        const coverName=['.jpg','.jpeg','.png','.webp'].map(e=>sidecarNames.get((stem+e).toLowerCase())).find(Boolean)||null;
        books.push({
          id:known?.id||crypto.createHash('sha256').update(rel).digest('hex').slice(0,16),
          name:actual.name,title:stem,
          managedName:path.basename(actual.absolute),
          ext:ext.slice(1).toUpperCase(),relativeDir:dir.relative||'root',
          size:stat.size,modified:Math.floor(stat.mtimeMs),coverName
        });
      }
    }
    books.sort((a,b)=>a.title.localeCompare(b.title,'zh-CN',{numeric:true,sensitivity:'base'}));
    const result={ok:true,books,total:books.length,truncated,skipped};
    jfBookScanCache.at=Date.now();jfBookScanCache.value=result;
    return result;
  })();
  try{return await jfBookScanCache.pending;}
  finally{jfBookScanCache.pending=null;}
}

// Optional, read-only cover resolution. No source book or sidecar is ever changed.
// The bundled JS works on Windows without extra installation; first-page PDF raster
// is available only if the host already provides the Poppler pdftoppm executable.
// Fallback when Windows has no Poppler: extract a large JPEG image embedded near
// the beginning of the PDF, which covers many scanned-first-page documents.
// This is deliberately NOT a PDF renderer: compressed vector/JPX documents
// still require the real rendering engine. Never read an unbounded PDF into RAM.
async function jfPdfEmbeddedCover(file){
  const fh=await fs.promises.open(file,'r');
  try{
    const stat=await fh.stat();
    const size=Math.min(stat.size,8*1024*1024);
    if(size<200)return null;
    const raw=Buffer.allocUnsafe(size);
    const {bytesRead}=await fh.read(raw,0,size,0);
    const pdf=raw.subarray(0,bytesRead);
    if(pdf.subarray(0,5).toString('latin1')!=='%PDF-')return null;
    const txt=pdf.toString('latin1');
    const image=/\/Subtype\s*\/Image\b/g;
    let m,checked=0;
    while((m=image.exec(txt)) && ++checked<30){
      const obj=txt.lastIndexOf('obj',m.index);
      const dictEnd=txt.indexOf('stream',m.index);
      if(obj<0||m.index-obj>2048||dictEnd<0||dictEnd-m.index>2000)continue;
      const dict=txt.slice(obj,dictEnd);
      if(!/\/Filter\s*(?:\[\s*)?\/DCTDecode\b/.test(dict))continue;
      const w=Number((dict.match(/\/Width\s+(\d+)/)||[])[1]);
      const h=Number((dict.match(/\/Height\s+(\d+)/)||[])[1]);
      if(!w||!h||w<240||h<320||w*h>120000000)continue;
      const start=dictEnd+6+(txt[dictEnd+6]==='\r'?1:0)+(txt[dictEnd+6]==='\n'||txt[dictEnd+7]==='\n'?1:0);
      const jpegStart=pdf.indexOf(Buffer.from([0xff,0xd8,0xff]),start);
      if(jpegStart<start||jpegStart-start>4)continue;
      const jpegEnd=pdf.indexOf(Buffer.from([0xff,0xd9]),jpegStart+16);
      if(jpegEnd<0||jpegEnd-jpegStart>3*1024*1024)continue;
      const tail=txt.indexOf('endstream',jpegEnd);
      if(tail<0||tail-jpegEnd>20)continue;
      return Buffer.from(pdf.subarray(jpegStart,jpegEnd+2));
    }
    return null;
  }finally{await fh.close();}
}
const jfBookCoverCache=new Map();
let jfBookCoverJobs=0;
async function jfBookCover(req,res,id){
  const {info,file,stat}=await jfBookFindById(id);
  if(info.coverName){
    const image=path.join(path.dirname(file),info.coverName);
    const st=await fs.promises.lstat(image).catch(()=>null);
    const ext=path.extname(image).toLowerCase();
    if(st?.isFile() && st.size>0 && st.size<=8000000 && ['.jpg','.jpeg','.png','.webp'].includes(ext)){
      const mime={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[ext];
      res.writeHead(200,{'Content-Type':mime,'Content-Length':st.size,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
      fs.createReadStream(image).on('error',()=>res.destroy()).pipe(res);return;
    }
  }
  if(info.ext!=='PDF'||stat.size===0||stat.size>100*1024*1024){res.writeHead(204);res.end();return;}
  const key=info.id+':'+stat.size+':'+stat.mtimeMs;
  if(jfBookCoverCache.has(key)){
    const b=jfBookCoverCache.get(key);res.writeHead(200,{'Content-Type':b.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':'image/png','Content-Length':b.length,'Cache-Control':'private, no-store'});res.end(b);return;
  }
  // Bounded subprocesses and buffers: never block video playback or cache on disk.
  if(jfBookCoverJobs>=2){res.writeHead(503,{'Retry-After':'2'});res.end();return;}
  jfBookCoverJobs++;
  try{
    // Do not launch a missing Poppler process before the built-in Windows renderer.
    // Share native raster frames with the reader and its adjacent-page requests.
    if(process.platform==='win32'){
      const native=await jfPdfRenderShared(file,[info.id,stat.size,stat.mtimeMs,1,440].join(':'),1,440).catch(()=>null);
      if(native){
        jfBookCoverCache.set(key,native);if(jfBookCoverCache.size>30)jfBookCoverCache.delete(jfBookCoverCache.keys().next().value);
        res.writeHead(200,{'Content-Type':'image/png','Content-Length':native.length,'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff','X-Just-Fun-Cover':'native-page'});res.end(native);return;
      }
      // The scan-JPEG fallback is cheaper than another Windows renderer launch.
      const embedded=await jfPdfEmbeddedCover(file).catch(()=>null);
      if(embedded){
        jfBookCoverCache.set(key,embedded);if(jfBookCoverCache.size>20)jfBookCoverCache.delete(jfBookCoverCache.keys().next().value);
        res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':embedded.length,'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff','X-Just-Fun-Cover':'embedded-image'});res.end(embedded);return;
      }
      res.writeHead(204,{'Cache-Control':'private,no-store'});res.end();return;
    }
    const result=await new Promise((resolve,reject)=>{
      const child=spawn('pdftoppm',['-f','1','-l','1','-singlefile','-scale-to','440','-png',file],{windowsHide:true,stdio:['ignore','pipe','ignore']});
      let done=false;const chunks=[];let length=0;
      const timeout=setTimeout(()=>{child.kill();fail(new Error('PDF thumbnail renderer timeout'));},8000);
      const fail=e=>{if(!done){done=true;clearTimeout(timeout);reject(e);}};
      child.once('error',fail);
      child.stdout.on('data',b=>{length+=b.length;if(length>4*1024*1024){child.kill();fail(new Error('thumbnail too large'));}else chunks.push(b);});
      child.once('close',code=>{if(done)return;done=true;clearTimeout(timeout);const png=Buffer.concat(chunks);if(code===0&&png.length>100&&png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))resolve(png);else reject(new Error('unsupported PDF thumbnail'));});
    });
    jfBookCoverCache.set(key,result);if(jfBookCoverCache.size>30)jfBookCoverCache.delete(jfBookCoverCache.keys().next().value);
    res.writeHead(200,{'Content-Type':'image/png','Content-Length':result.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(result);
  }catch(e){
    // On Windows render actual page one with the built-in Windows.Data.Pdf system renderer.
    const native=(process.platform==='win32'?await jfPdfRaster(file,1,440).catch(()=>null):null);
    if(native){
      jfBookCoverCache.set(key,native);if(jfBookCoverCache.size>30)jfBookCoverCache.delete(jfBookCoverCache.keys().next().value);
      res.writeHead(200,{'Content-Type':'image/png','Content-Length':native.length,'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff','X-Just-Fun-Cover':'native-page'});res.end(native);return;
    }
    const embedded=await jfPdfEmbeddedCover(file).catch(()=>null);
    if(embedded){
      jfBookCoverCache.set(key,embedded);
      if(jfBookCoverCache.size>20)jfBookCoverCache.delete(jfBookCoverCache.keys().next().value);
      res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':embedded.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Just-Fun-Cover':'embedded-image'});
      res.end(embedded);
    }else{res.writeHead(204,{'Cache-Control':'private, no-store'});res.end();}
  }
  finally{jfBookCoverJobs--;}

}
