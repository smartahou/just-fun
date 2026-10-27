// v7.07: content-derived immutable identity for legacy embedded JPEG excerpts.
// This stage computes identities only: NO external objects or migrations are written.
const JF_READING_IMAGE_PREFIX='data:image/jpeg;base64,';
function jfReadingImageIdentity(uri){
  if(typeof uri!=='string'||!uri.startsWith(JF_READING_IMAGE_PREFIX)||
      uri.length<150||uri.length>235000||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(uri))
    throw jfReaderError(413,'图片摘录格式或尺寸无效');
  const bytes=Buffer.from(uri.slice(JF_READING_IMAGE_PREFIX.length),'base64');
  if(bytes.length<3||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)
    throw jfReaderError(413,'图片摘录格式或尺寸无效');
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  return Object.freeze({imageRef:sha256,bytes:bytes.length,format:'jpeg'});
}
function jfReadingImageInventory(workspace){
  if(!workspace||!Array.isArray(workspace.notes))throw jfReaderError(409,'阅读数据格式损坏，拒绝覆盖');
  const refs=new Map();let embedded=0,decodedBytes=0;
  for(const note of workspace.notes){
    if(!Array.isArray(note.quotes))continue;
    for(const quote of note.quotes){
      if(quote?.type!=='image')continue;
      const pages=Array.isArray(quote.pages)&&quote.pages.length?quote.pages:[quote];
      for(const page of pages){
        const result=jfReadingImageIdentity(page.image);embedded++;decodedBytes+=result.bytes;
        refs.set(result.imageRef,result.bytes);
      }
    }
  }
  return Object.freeze({version:1,embeddedCount:embedded,uniqueCount:refs.size,
    embeddedBytes:decodedBytes,uniqueBytes:[...refs.values()].reduce((a,b)=>a+b,0),
    imageRefs:Object.freeze([...refs.keys()].sort())});
}
