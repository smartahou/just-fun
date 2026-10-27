// PDF.js is embedded at BUILD TIME. End-users need only douyin.js (no npm, no CDN).
// The build replaces the marker with a base64-encoded JSON map containing the
// version-matched browser module, Worker, CMaps, and standard fonts.
const JF_PDFJS_VENDOR = JSON.parse(Buffer.from('__JUSTFUN_PDFJS_ASSETS__','base64').toString('utf8'));
const JF_PDFJS_CACHE = new Map();
function jfPdfJsServeAsset(req,res,rel){
  if(req.method!=='GET' && req.method!=='HEAD'){
    res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;
  }
  // A direct map lookup avoids all path traversal (including encoded / and ..).
  if(!Object.prototype.hasOwnProperty.call(JF_PDFJS_VENDOR,rel)){
    res.writeHead(404,{'Cache-Control':'no-store'});res.end();return;
  }
  let buf=JF_PDFJS_CACHE.get(rel);
  if(!buf){buf=Buffer.from(JF_PDFJS_VENDOR[rel],'base64');
    if(JF_PDFJS_CACHE.size>=8)JF_PDFJS_CACHE.delete(JF_PDFJS_CACHE.keys().next().value);
    JF_PDFJS_CACHE.set(rel,buf);
  }
  const type=rel.endsWith('.mjs')?'text/javascript; charset=utf-8':'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Content-Length':buf.length,
    'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff',
    'Cross-Origin-Resource-Policy':'same-origin'});
  if(req.method==='HEAD')res.end();else res.end(buf);
}
