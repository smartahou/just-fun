#!/usr/bin/env python3
"""v6.51: precise repeat-text citations, durable reading prefs, no data-loss on failed save.
All media live in an isolated temporary folder, no access to the user's library.
"""
import pathlib,tempfile,json,urllib.request,urllib.error,urllib.parse,hashlib,time
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
checks=0
def ck(msg,assertion):
 global checks
 assert assertion,msg
 checks+=1
 print('PASS',msg,flush=True)
def api(base,path,data=None):
 payload=json.dumps(data).encode('utf-8') if data is not None else None
 req=urllib.request.Request(base+path,data=payload,method='POST' if data is not None else 'GET',headers={'Content-Type':'application/json'} if data is not None else {})
 try:
  with urllib.request.urlopen(req,timeout=12) as r:return r.status,json.loads(r.read())
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v651-') as folder:
 root=pathlib.Path(folder);lib=root/'中文媒体目录';lib.mkdir()
 (lib/'书库').mkdir()
 phrase='重复短句。'
 text='\n'+phrase*180+'\n感悟：读书使人自由。\n'
 book=lib/'书库'/'精准引用.txt';book.write_text(text,encoding='utf8')
 initial=hashlib.sha256(book.read_bytes()).hexdigest()
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,root/'home')
  base=f'http://127.0.0.1:{port}'
  status,books=api(base,'/api/books?refresh=1');ck('Existing root scans book without extra directory',status==200 and books['total']==1)
  book_id=books['books'][0]['id']
  status,w=api(base,'/api/reading/workspace');ck('Legacy workspace defaults retained',status==200 and w['preferences']=={'font':18,'theme':'dark'})
  status,bad=api(base,'/api/reading/workspace',{'action':'preferences','preferences':{'font':100,'theme':'paper'},'revision':0})
  ck('Invalid reader font rejected by API',status==400)
  status,bad=api(base,'/api/reading/workspace',{'action':'note','revision':0,'note':{'id':'a'*24,'title':'bad','anchorStart':-1}})
  ck('Invalid citation byte/character offset rejected',status==400)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1320,'height':860});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def route(proxy):
    r=proxy.request;u=urllib.parse.urlsplit(r.url)
    if u.path.startswith('/api/books') or u.path.startswith('/api/reading'):
     req=urllib.request.Request(base+u.path+('?' + u.query if u.query else ''),data=r.post_data.encode() if r.method=='POST' else None,method=r.method,headers={'Content-Type':'application/json'} if r.method=='POST' else {})
     try:
      with urllib.request.urlopen(req,timeout=15) as resp:st=resp.status;body=resp.read();ctype=resp.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:st=e.code;body=e.read();ctype='application/json'
     proxy.fulfill(status=st,body=body,headers={'Content-Type':ctype})
    else: proxy.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',route)
   html=urlopen(base+'/')[2].decode()
   page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.wait_for_timeout(250)
   page.locator('#studioRailToggle').click()
   page.locator('[data-media-kind="books"]').click()
   page.locator('.jfBookTile').first.wait_for()
   page.locator('.jfBookTile').first.click()
   page.wait_for_function("jfDeskBook && jfReadText.textContent.includes('重复短句')")
   ck('Real Chromium displays source chapter',page.locator('#jfReadText').is_visible())
   page.locator('#jfReadLarger').click();page.locator('#jfReadTheme').click()
   page.wait_for_function("jfDeskWorkspace.preferences?.theme==='paper' && jfDeskWorkspace.preferences?.font===20")
   ck('Reader preference persisted through real Node API',page.locator('#jfReader').evaluate("el=>el.classList.contains('paper')") and page.locator('#jfReadText').evaluate("el=>el.style.fontSize==='20px'"))
   offset=1+len(phrase)*3 # Fourth occurrence (first newline before repeated text)
   page.evaluate('''arg=>{const n=document.querySelector('#jfReadText').firstChild;const r=document.createRange();r.setStart(n,arg.offset);r.setEnd(n,arg.offset+arg.len);const sel=getSelection();sel.removeAllRanges();sel.addRange(r)}''',{'offset':offset,'len':len(phrase)})
   page.locator('#jfReadExcerpt').click()
   page.locator('#jfPdfQuoteChooser').wait_for();page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.notes.some(n=>n.quotes?.some(q=>q.text==="重复短句。"))')
   page.locator('#jfReadNotes').click()
   note=page.evaluate('jfDeskWorkspace.notes.find(n=>n.quotes?.some(q=>q.text==="重复短句。"))')
   ck('Selected repeated phrase persists precise text offset',note['quotes'][0]['anchorStart']==offset and note['quotes'][0]['bookId']==book_id)
   page.locator('.jfDeskQuote button').first.click()
   page.locator('#jfReadText mark').wait_for(timeout=12000)
   highlight_before=page.locator('#jfReadText').evaluate("el=>el.firstChild.textContent.length")
   ck('Jump highlights fourth occurrence not first',highlight_before==offset)
   page.locator('#jfReadNotes').click()
   page.locator('.jfDeskNoteItem').first.click()
   page.evaluate('''()=>{window.__readingApiOriginal=jfDeskApi;jfDeskApi=async(...args)=>{
     if(args[0]==='workspace'&&args[1]==='POST'&&args[2]?.action==='note')throw Error('模拟磁盘写入失败');
     return window.__readingApiOriginal(...args)
   }}''')
   page.locator('#jfDeskNoteBody').fill('不能丢失的未保存内容')
   page.locator('#jfReadBack').click()
   page.wait_for_timeout(500)
   ck('Failed note write blocks exit from reader',page.locator('#jfReader').is_visible() and page.locator('#jfDeskNotes').is_visible() and page.locator('#jfDeskNoteBody').input_value()=='不能丢失的未保存内容')
   page.evaluate("document.querySelector('[data-media-kind=\"video\"]').click()")
   page.wait_for_timeout(400)
   ck('Failed note write also blocks mode switching',page.evaluate("document.body.classList.contains('jfBooksMode')") and page.locator('#jfDeskNoteBody').input_value()=='不能丢失的未保存内容')
   page.evaluate('()=>{jfDeskApi=window.__readingApiOriginal;}')
   page.evaluate("document.querySelector('[data-media-kind=\"video\"]').click()")
   page.wait_for_function("!document.body.classList.contains('jfBooksMode')",timeout=12000)
   ck('Successful retry permits navigation',not page.locator('#jfReader').is_visible())
   status,ws=api(base,'/api/reading/workspace')
   ck('Retried note content durably saved',status==200 and any(n['content']=='不能丢失的未保存内容' for n in ws['notes']))
   ck('Reader settings survive exit',ws['preferences']=={'font':20,'theme':'paper'})
   page.evaluate("document.querySelector('[data-media-kind=\"books\"]').click()")
   page.locator('.jfBookTile').first.wait_for();page.locator('.jfBookTile').first.click()
   page.wait_for_function("jfDeskBook && jfReadText.textContent.includes('重复短句')")
   ck('Reader preferences restored after reopening',page.locator('#jfReader').evaluate("el=>el.classList.contains('paper')") and page.locator('#jfReadText').evaluate("el=>el.style.fontSize==='20px'"))
   page.locator('#jfReadNotes').click()
   page.locator('.jfDeskNoteItem').first.click()
   page.on('dialog',lambda d:d.accept())
   page.evaluate('''()=>{window.__readingApiOriginal=jfDeskApi;jfDeskApi=async(...args)=>{
     if(args[0]==='workspace'&&args[1]==='POST'&&args[2]?.action==='note')throw Error('模拟删除前保存失败');
     return window.__readingApiOriginal(...args)
   }}''')
   page.locator('#jfDeskNoteBody').fill('删除失败时也不能丢的修改')
   page.locator('#jfDeskDeleteNote').click()
   page.wait_for_timeout(230)
   ck('Failed pre-delete save blocks note deletion',page.evaluate('jfDeskDirty') and page.locator('#jfDeskNoteBody').input_value()=='删除失败时也不能丢的修改' and page.locator('.jfDeskNoteItem').count()==1)
   page.evaluate('()=>{jfDeskApi=window.__readingApiOriginal;}')
   page.locator('.jfDeskNoteItem').first.click()
   page.wait_for_function('!jfDeskDirty')
   page.evaluate('''()=>{window.__readingApiOriginal=jfDeskApi;jfDeskApi=async(...args)=>{
     if(args[0]==='workspace'&&args[1]==='POST'&&args[2]?.action==='note')await new Promise(done=>setTimeout(done,900));
     return window.__readingApiOriginal(...args)
   }}''')
   page.locator('#jfDeskNoteBody').fill('异步保存第一版')
   page.locator('#jfReadBack').click()
   page.wait_for_timeout(120)
   ck('Exit waits for in-flight note write',page.locator('#jfReader').is_visible() and page.locator('#jfDeskNotes').is_visible())
   page.locator('#jfDeskNoteBody').fill('异步保存第二版')
   page.wait_for_function('jfReader.hidden',timeout=12000)
   status,ws=api(base,'/api/reading/workspace')
   ck('Changes typed during save survive closing',status==200 and any(n['content']=='异步保存第二版' for n in ws['notes']))
   page.evaluate('()=>{jfDeskApi=window.__readingApiOriginal;}')
   ck('No uncaught browser JS errors',not errors)
   browser.close()
  ck('Original source book unchanged',hashlib.sha256(book.read_bytes()).hexdigest()==initial)
 finally:
  if proc:stop(proc,lg)
print(f'v6.51 PASS {checks}/{checks}',flush=True)
