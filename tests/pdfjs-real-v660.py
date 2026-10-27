#!/usr/bin/env python3
"""REAL Mozilla PDF.js 6.4.299 + actual Worker/Canvas/text layer, isolated book.
No fake vendor objects; browser navigation is unavailable in this sandbox so real
PDF.js/Worker code is served from Just Fun and imported as blob URLs for the test.
The production code imports the identical bytes at the actual same-origin route.
"""
import sys,hashlib,tempfile,pathlib,base64,json,urllib.parse
from playwright.sync_api import sync_playwright
import fitz
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from isolated import ROOT,launch,stop,urlopen
C=[]
def ck(name,ok):
 assert ok,name
 C.append(name);print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-pdfjs-real-') as td:
 t=pathlib.Path(td);lib=t/'library';lib.mkdir()
 pdf=fitz.open()
 for i in range(342):
  page=pdf.new_page(width=460,height=610)
  page.insert_text((45,115),f'JUST FUN PDF.JS REAL PAGE {i+1}',fontsize=20)
  page.insert_text((45,170),f'This is a selectable excerpt from book page {i+1}.',fontsize=14)
 pdf.save(lib/'Long Book.pdf');pdf.close()
 sha=hashlib.sha256((lib/'Long Book.pdf').read_bytes()).hexdigest()
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,t/'home');root=f'http://127.0.0.1:{port}'
  status,head,mod=urlopen(root+'/api/jf-pdf/pdf.min.mjs',timeout=30)
  ck('real pdf.min.mjs served as JavaScript',status==200 and len(mod)>300000 and 'javascript' in head.get('Content-Type',''))
  status,head,worker=urlopen(root+'/api/jf-pdf/pdf.worker.min.mjs',timeout=30)
  ck('real matching Worker served as JavaScript',status==200 and len(worker)>1000000 and 'javascript' in head.get('Content-Type',''))
  vendor=ROOT/'node_modules/pdfjs-dist/build'
  ck('served vendor binaries byte-for-byte',hashlib.sha256(mod).digest()==hashlib.sha256((vendor/'pdf.min.mjs').read_bytes()).digest() and hashlib.sha256(worker).digest()==hashlib.sha256((vendor/'pdf.worker.min.mjs').read_bytes()).digest())
  status,_,body=urlopen(root+'/api/books?refresh=1');book=json.loads(body)['books'][0]
  ck('342-page book scanned from one working directory',status==200 and book['ext']=='PDF')
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1200,'height':920});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.set_content('<html><body><div id="pdf"></div></body></html>')
   out=page.evaluate('''async ({mod,worker,book})=>{
     let created=0;const OriginalWorker=window.Worker;
     window.Worker=class extends OriginalWorker{constructor(...args){created++;super(...args);}};
     if(!Map.prototype.getOrInsertComputed)Map.prototype.getOrInsertComputed=function(k,f){if(this.has(k))return this.get(k);const v=f(k);this.set(k,v);return v;};
     if(!Map.prototype.getOrInsert)Map.prototype.getOrInsert=function(k,v){if(this.has(k))return this.get(k);this.set(k,v);return v;};
     const main=URL.createObjectURL(new Blob([mod],{type:'text/javascript'}));
     const wk=URL.createObjectURL(new Blob([worker],{type:'text/javascript'}));
     const lib=await import(main);lib.GlobalWorkerOptions.workerSrc=wk;
     const task=lib.getDocument({data:Uint8Array.from(atob(book),c=>c.charCodeAt(0)),isEvalSupported:false});
     const doc=await task.promise;
     const first=await doc.getPage(1),last=await doc.getPage(342);
     const vp=first.getViewport({scale:1});const canvas=document.createElement('canvas');
     canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);document.querySelector('#pdf').append(canvas);
     await first.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
     const content=await first.getTextContent();const tl=document.createElement('div');document.querySelector('#pdf').append(tl);
     tl.className='textLayer';tl.style.setProperty('--scale-factor','1');tl.style.setProperty('--total-scale-factor','1');
     await new lib.TextLayer({textContentSource:content,container:tl,viewport:vp}).render();
     const color=Array.from(canvas.getContext('2d').getImageData(45,100,20,35).data);
     const lastText=(await last.getTextContent()).items.map(x=>x.str).join(' ');
     const range=document.createRange();range.selectNodeContents(tl);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
     const selected=selection.toString();selection.removeAllRanges();
     const result={version:lib.version,count:doc.numPages,workers:created,firstText:content.items.map(x=>x.str).join(' '),lastText,selected,spans:tl.querySelectorAll('span').length,hasPixels:color.some((n,i)=>i%4!==3&&n<240)};
     await task.destroy();URL.revokeObjectURL(main);URL.revokeObjectURL(wk);return result;
   }''',{'mod':mod.decode('utf-8'),'worker':worker.decode('utf-8'),'book':base64.b64encode((lib/'Long Book.pdf').read_bytes()).decode()})
   print('REAL ENGINE RESULTS',out,flush=True)
   ck('real PDF.js version exactly 6.4.299',out['version']=='6.4.299')
   ck('real 342-page PDF parsed',out['count']==342)
   ck('real browser Worker spawned',out['workers']>=1)
   ck('Canvas page rendered real ink',out['hasPixels'])
   ck('first and last page text accurate', 'PAGE 1' in out['firstText'] and 'PAGE 342' in out['lastText'])
   ck('TextLayer selectable and populated',out['spans']>=1 and 'selectable excerpt' in out['selected'])
   ck('no browser script errors',not errors)
   browser.close()
  ck('source book untouched',sha==hashlib.sha256((lib/'Long Book.pdf').read_bytes()).hexdigest())
 finally:
  if proc:stop(proc,lg)
print('TOTAL',len(C),flush=True)
