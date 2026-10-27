// v7.13: Workspace v2 *read-only* object decoder. Not wired to production
// Workspace loading yet: conversion is deliberately gated on transaction tests.
// A client-provided path is never accepted; only SHA-256 controls object location.
const JF_READING_V2_REF=/^[a-f0-9]{64}$/;
const JF_READING_V2_MAX_STORED=256*1024;
function jfReadingV2ObjectPath(imageRef){
  if(typeof imageRef!=='string'||!JF_READING_V2_REF.test(imageRef))
    throw jfReaderError(409,'图片对象编号不合法');
  return path.join(JF_READING_DIR,'objects',imageRef.slice(0,2),imageRef+'.jpg');
}
function jfReadingV2ReadImage(imageRef){
  const target=jfReadingV2ObjectPath(imageRef);
  // Check every parent component, not just the leaf: no symlinked object stores.
  for(const folder of [JF_READING_DIR,path.join(JF_READING_DIR,'objects'),path.dirname(target)]){
    let st;
    try{st=fs.lstatSync(folder);}catch{throw jfReaderError(409,'图片对象目录缺失');}
    if(st.isSymbolicLink()||!st.isDirectory())throw jfReaderError(409,'图片对象目录类型异常');
  }
  let st;
  try{st=fs.lstatSync(target);}catch{throw jfReaderError(409,'图片对象缺失');}
  if(st.isSymbolicLink()||!st.isFile()||st.size>JF_READING_V2_MAX_STORED)
    throw jfReaderError(409,'图片对象文件类型或大小异常');
  let bytes;
  try{bytes=PWD_ENABLED?vaultReadBytes(target):fs.readFileSync(target);}
  catch{throw jfReaderError(409,'图片对象认证或读取失败');}
  if(bytes.length<96||bytes.length>176250||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||
     crypto.createHash('sha256').update(bytes).digest('hex')!==imageRef)
    throw jfReaderError(409,'图片对象内容校验失败');
  return JF_READING_IMAGE_PREFIX+bytes.toString('base64');
}
function jfReadingV2HydrateWorkspace(stored){
  if(!stored||stored.version!==2||!Number.isSafeInteger(stored.revision)||
     !stored.progress||typeof stored.progress!=='object'||!Array.isArray(stored.notes)||!Array.isArray(stored.marks))
    throw jfReaderError(409,'Workspace v2 结构不合法');
  // Caller receives a v1-compatible data copy; input never mutates.
  const output=structuredClone(stored);
  for(const note of output.notes){
    if(!note||typeof note!=='object'||(note.quotes!==undefined&&!Array.isArray(note.quotes)))
      throw jfReaderError(409,'Workspace v2 笔记结构不合法');
    if(note.quotes===undefined)continue;
    for(const quote of note.quotes){
      if(!quote||quote.type!=='image')continue;
      const hydrate=page=>{
        if(!page||typeof page!=='object')throw jfReaderError(409,'Workspace v2 图片页结构不合法');
        if(Object.hasOwn(page,'imageRef')){
          if(Object.hasOwn(page,'image'))throw jfReaderError(409,'图片对象存在冲突引用');
          page.image=jfReadingV2ReadImage(page.imageRef);
          delete page.imageRef;
        }else jfReadingImageIdentity(page.image); // historical JPEG, strict magic + bounds
      };
      if(Array.isArray(quote.pages)&&quote.pages.length){
        const firstRef=quote.pages[0]?.imageRef;
        if(Object.hasOwn(quote,'imageRef') && quote.imageRef!==firstRef)
          throw jfReaderError(409,'跨页图片对象引用不一致');
        if(Object.hasOwn(quote,'image'))throw jfReaderError(409,'跨页图片对象含有冲突内容');
        quote.pages.forEach(hydrate);
        // A merged legacy excerpt mirrors pages[0] in quote.image.
        delete quote.imageRef;
        quote.image=quote.pages[0].image;
      }else hydrate(quote);
    }
  }
  output.version=1;
  return output;
}
