// v6.57 PDF pages: native OS rasterizer behind an isolated, bounded subprocess.
// Offline: Poppler on Linux/macOS when installed; Windows.Data.Pdf via Windows PowerShell 5.1.
// PDF.js from old Shufang was a package dependency and was NOT in the archive.
// Never execute embedded PDF scripts, write into the source folder, or cache plaintext pages on disk.
const jfPdfMemory=new Map();
// v6.57: completed frames have a bounded LRU; concurrent requests for the
// same frame share ONE renderer. This avoids duplicate OS processes when a
// reader and its adjacent-page prefetch meet at the same time.
const jfPdfFlights=new Map();let jfPdfWorking=0;let jfPdfWaiting=0;
const JF_PDF_CACHE_LIMIT=20*1024*1024,JF_PDF_QUEUE_LIMIT=12;
let jfPdfUsedBytes=0;
const jfPdfSlots=[];
function jfPdfCacheGet(key){
  if(!jfPdfMemory.has(key))return null;
  const data=jfPdfMemory.get(key);jfPdfMemory.delete(key);jfPdfMemory.set(key,data);return data;
}
function jfPdfCachePut(key,data){
  if(data.length>JF_PDF_CACHE_LIMIT)return;
  if(jfPdfMemory.has(key)){jfPdfUsedBytes-=jfPdfMemory.get(key).length;jfPdfMemory.delete(key);}
  jfPdfMemory.set(key,data);jfPdfUsedBytes+=data.length;
  while((jfPdfUsedBytes>JF_PDF_CACHE_LIMIT||jfPdfMemory.size>10)&&jfPdfMemory.size){
    const oldest=jfPdfMemory.keys().next().value;
    jfPdfUsedBytes-=jfPdfMemory.get(oldest).length;jfPdfMemory.delete(oldest);
  }
}
function jfPdfAcquire(){
  if(jfPdfWorking<2){jfPdfWorking++;return Promise.resolve();}
  if(jfPdfWaiting>=JF_PDF_QUEUE_LIMIT)jfPdfFail(503,'PDF 渲染排队过多，请稍后重试');
  ++jfPdfWaiting;
  return new Promise(resolve=>jfPdfSlots.push(resolve));
}
function jfPdfRelease(){
  if(jfPdfSlots.length){--jfPdfWaiting;jfPdfSlots.shift()();}
  else --jfPdfWorking;
}
async function jfPdfRenderShared(file,key,page,width){
  const ready=jfPdfCacheGet(key);if(ready)return ready;
  if(jfPdfFlights.has(key))return jfPdfFlights.get(key);
  const task=(async()=>{
    await jfPdfAcquire();
    try{const data=await jfPdfRaster(file,page,width);jfPdfCachePut(key,data);return data;}
    finally{jfPdfRelease();}
  })();
  jfPdfFlights.set(key,task);
  try{return await task;}finally{if(jfPdfFlights.get(key)===task)jfPdfFlights.delete(key);}
}
function jfPdfFail(code,message){const error=new Error(message);error.status=code;throw error;}
function jfPdfSubprocess(bin,args,{timeout=16000,maxBytes=8*1024*1024}={}){
 return new Promise((resolve,reject)=>{
  const proc=spawn(bin,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const output=[],errors=[];let size=0,errsize=0,done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{proc.kill();finish(new Error('PDF 渲染超时'));},timeout);
  proc.once('error',e=>finish(e));
  proc.stdout.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){proc.kill();finish(new Error('PDF 页面超过内存限制'));}else output.push(chunk);});
  proc.stderr.on('data',chunk=>{errsize+=chunk.length;if(errsize<8192)errors.push(chunk);});
  proc.once('close',code=>code===0?finish(null,Buffer.concat(output)):finish(new Error('PDF 渲染器失败：'+Buffer.concat(errors).toString('utf8').slice(0,220))));
 });
}
// Uses OS Windows Runtime, not a third-party installer. Windows path is unverified without actual Windows hardware.
function jfPdfWindowsScript(file,page,width){
  const file64=Buffer.from(file,'utf8').toString('base64');
  const info=page===0;
  return ` $ErrorActionPreference='Stop'
[void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
[void][Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
[void][Windows.Data.Pdf.PdfPageRenderOptions,Windows.Data.Pdf,ContentType=WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Console]::Error.WriteLine('JF_PDF_STAGE:init')
$methods=[System.WindowsRuntimeSystemExtensions].GetMethods()
$generic= $methods | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1} | Select-Object -First 1
function AwaitWin($op,[Type]$type){$t=$generic.MakeGenericMethod($type).Invoke($null,@($op));$t.Wait();return $t.Result}
$file=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${file64}'))
[Console]::Error.WriteLine('JF_PDF_STAGE:open')
$sf=AwaitWin ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file)) ([Windows.Storage.StorageFile])
[Console]::Error.WriteLine('JF_PDF_STAGE:load')
$pdf=AwaitWin ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($sf)) ([Windows.Data.Pdf.PdfDocument])
if(${info?'$true':'$false'}){[Console]::Write([string]$pdf.PageCount);exit 0}
$index=[int]${Math.max(0,page-1)}
if($index -ge $pdf.PageCount){throw '页码超出范围'}
$p=$pdf.GetPage($index)
try{
 [Console]::Error.WriteLine('JF_PDF_STAGE:render')
 $memory=New-Object -TypeName Windows.Storage.Streams.InMemoryRandomAccessStream
 $opts=New-Object -TypeName Windows.Data.Pdf.PdfPageRenderOptions
 $opts.DestinationWidth=[uint32]${Math.max(200,Math.min(2000,width))}
 $task=[System.WindowsRuntimeSystemExtensions]::AsTask($p.RenderToStreamAsync($memory,$opts))
 $task.Wait()
 [Console]::Error.WriteLine('JF_PDF_STAGE:read')
 $memory.Seek([uint64]0)
 # Use the framework stream bridge rather than relying on a second WinRT
 # DataReader.LoadAsync + generic reflection roundtrip.
 $source=[System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($memory)
 $buffer=New-Object System.IO.MemoryStream
 $source.CopyTo($buffer)
 $bytes=$buffer.ToArray()
 if($bytes.Length -lt 100 -or $bytes.Length -gt 8388608){throw 'invalid PDF render bytes'}
 $stdout=[Console]::OpenStandardOutput()
 $stdout.Write($bytes,0,$bytes.Length)
 $stdout.Flush()
}finally{if($source){$source.Dispose()};if($buffer){$buffer.Dispose()};if($memory){$memory.Dispose()};$p.Dispose()}`;
}
async function jfPdfGetInfo(file){
 let pages;
 if(process.platform==='win32'){
  const command=Buffer.from(jfPdfWindowsScript(file,0,0),'utf16le').toString('base64');
  pages=Number((await jfPdfSubprocess('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',command],{timeout:20000,maxBytes:64})).toString('utf8').trim());
 }else{
  const output=(await jfPdfSubprocess('pdfinfo',[file],{timeout:8000,maxBytes:16384})).toString('utf8');
  pages=Number((output.match(/^Pages:\s*(\d+)/m)||[])[1]);
 }
 if(!Number.isSafeInteger(pages)||pages<1||pages>100000)jfPdfFail(422,'PDF 页数无法读取');
 return {pages};
}
async function jfPdfRaster(file,page,width){
 const w=Math.max(240,Math.min(1800,Math.round(Number(width)||950)));
 const n=Number(page);if(!Number.isSafeInteger(n)||n<1||n>100000)jfPdfFail(400,'页码无效');
 let png;
 if(process.platform==='win32'){
  const command=Buffer.from(jfPdfWindowsScript(file,n,w),'utf16le').toString('base64');
  png=await jfPdfSubprocess('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',command],{timeout:24000});
 }else{
  png=await jfPdfSubprocess('pdftoppm',['-f',String(n),'-l',String(n),'-singlefile','-scale-to',String(w),'-png',file],{timeout:20000});
 }
 if(png.length<100||!png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))jfPdfFail(422,'PDF 页面渲染结果无效');
 return png;
}
async function jfPdfPageResponse(req,res,id,page,width){
 const {info,file,stat}=await jfBookFindById(id);
 if(info.ext!=='PDF'||!stat.size)jfPdfFail(415,'只支持 PDF');
 if(stat.size>1024*1024*1024)jfPdfFail(413,'PDF 超过渲染体积上限');
 const n=Number(page),rawWidth=Number(width);
 if(!Number.isSafeInteger(n)||n<1||n>100000)jfPdfFail(400,'页码无效');
 if(!Number.isFinite(rawWidth)||rawWidth<240||rawWidth>1800||!Number.isInteger(rawWidth))jfPdfFail(400,'页面宽度无效');
 const w=rawWidth;
 const key=[info.id,stat.size,stat.mtimeMs,n,w].join(':');
 // The page endpoint is an exact integer API, not a rounding API.
 const data=await jfPdfRenderShared(file,key,n,w);
 res.writeHead(200,{'Content-Type':'image/png','Content-Length':data.length,'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'});
 res.end(data);
}
async function jfPdfInfoResponse(id){
 const {info,file,stat}=await jfBookFindById(id);
 if(info.ext!=='PDF'||!stat.size)jfPdfFail(415,'只支持 PDF');
 const details=await jfPdfGetInfo(file);
 return {ok:true,book:info,pages:details.pages,engine:process.platform==='win32'?'Windows.Data.Pdf':'Poppler'};
}
