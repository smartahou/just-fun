#!/usr/bin/env python3
"""v6.66: notebook chooser matches visible note list without deleting historical blanks."""
import hashlib,json,pathlib,tempfile,urllib.request,urllib.parse,urllib.error
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0
def ck(msg,cond):
 global count
 if not cond:raise AssertionError(msg)
 count+=1;print('PASS',msg,flush=True)
def api(base,path,body=None):
 headers={'Content-Type':'application/json'} if body is not None else {}
 data=json.dumps(body,ensure_ascii=False).encode() if body is not None else None
 req=urllib.request.Request(base+path,method='POST' if data else 'GET',headers=headers,data=data)
 with urllib.request.urlopen(req,timeout=25) as resp:return json.loads(resp.read())
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v666-') as d:
 tmp=pathlib.Path(d);lib=tmp/'media';lib.mkdir()
 source=lib/'阅读文本.txt';source.write_text('正文开始。这是一条摘录测试。\n'*10,encoding='utf-8')
 old=hashlib.sha256(source.read_bytes()).hexdigest()
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home');base=f'http://127.0.0.1:{port}'
  books=api(base,'/api/books?refresh=1')['books'];bid=next(b['id'] for b in books if b['name']=='阅读文本.txt')
  ws=api(base,'/api/reading/workspace');ck('Workspace begins with no notes',len(ws['notes'])==0)
  records=[('新笔记','',[]),('工作札记','保留的正文',[]),('新笔记','',[]),('摘录本','', [{'text':'已有原文摘录', 'bookId':bid,'chapter':0,'anchorStart':0}]),('新笔记','',[])]
  for i,(title,content,quotes) in enumerate(records):
   note={'id':f'{i+1:024x}','title':title,'content':content,'quotes':quotes,'excerpt':'','bookId':'','chapter':0,'anchorStart':None}
   ws=api(base,'/api/reading/workspace',{'action':'note','revision':ws['revision'],'note':note})
  ck('Five legacy data records seeded, only two meaningful',len(ws['notes'])==5)
  blankids={f'{i+1:024x}' for i in (0,2,4)}
  ws=api(base,'/api/reading/workspace',{'action':'recent-note','id':f'{1:024x}','revision':ws['revision']})
  ck('Hidden historical record can be old default',ws['lastExcerptNoteId']==f'{1:024x}')
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   page=browser.new_page(viewport={'width':1440,'height':900});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    r=route.request;u=urllib.parse.urlsplit(r.url)
    req=urllib.request.Request(base+(u.path or '/')+('?' +u.query if u.query else ''),method=r.method,
        data=r.post_data.encode() if r.method=='POST' and r.post_data else None,
        headers={'Content-Type':'application/json'} if r.method=='POST' else {})
    try:
     with urllib.request.urlopen(req,timeout=30) as resp:status=resp.status;body=resp.read();ct=resp.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e:status=e.code;body=e.read();ct=e.headers.get('Content-Type','application/octet-stream')
    route.fulfill(status=status,body=body,headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(base+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click()
   page.wait_for_function('jfDeskWorkspace.notes?.length===5',timeout=20000)
   page.locator('#jfDeskNotes').wait_for(state='visible')
   ck('Independent notes page shows exactly two notes',page.locator('#jfDeskNoteList .jfDeskNoteItem').count()==2)
   ck('Meaningful note with excerpt and no body stays visible',page.locator('#jfDeskNoteList .jfDeskNoteItem').all_text_contents()[0].find('摘录本')>=0)
   page.evaluate('id=>jfDeskChooseQuote({text:"这是新的摘录",bookId:id,chapter:0,anchorStart:0})',bid)
   ck('Excerpt chooser offers two existing notes and one new option',page.locator('#jfPdfQuoteOptions button').count()==3)
   ck('Existing note titles match workbench order',page.evaluate('''()=>{
    const a=[...document.querySelectorAll('#jfDeskNoteList .jfDeskNoteItem strong')].map(n=>n.textContent);
    const b=[...document.querySelectorAll('#jfPdfQuoteOptions button')].slice(1).map(n=>n.textContent);
    return JSON.stringify(a)===JSON.stringify(b);
   }'''))
   ck('Historical blank new notes absent from excerpt chooser',page.evaluate('''()=>[...document.querySelectorAll('#jfPdfQuoteOptions button')].every(n=>n.textContent!=='新笔记')'''))
   ck('Hidden last-used note falls back to a visible note',page.evaluate('''()=>{
    const v=document.querySelector('#jfPdfQuoteOptions button[aria-pressed="true"]');
    return !!v && v.dataset.noteId!=="000000000000000000000001" && v.dataset.noteId!=="new";
   }'''))
   page.locator('#jfPdfQuoteCancel').click()
   ws=api(base,'/api/reading/workspace');ck('Opening and dismissing chooser never deletes ghosts',len(ws['notes'])==5 and all(any(n['id']==x for n in ws['notes']) for x in blankids))
   # With a valid last-used destination, re-opening must still select it.
   ws=api(base,'/api/reading/workspace',{'action':'recent-note','revision':ws['revision'],'id':f'{2:024x}'})
   page.evaluate('()=>jfDeskLoadWorkspace()');page.wait_for_function(f'jfDeskWorkspace.lastExcerptNoteId==="{2:024x}"')
   page.evaluate('id=>jfDeskChooseQuote({text:"摘录已回到目标笔记",bookId:id,chapter:0,anchorStart:0})',bid)
   ck('Last meaningful target is preselected',page.locator('#jfPdfQuoteOptions button[aria-pressed="true"]').get_attribute('data-note-id')==f'{2:024x}')
   page.locator('#jfPdfQuoteCommit').click()
   page.wait_for_function('jfDeskWorkspace.notes.some(n=>n.title==="工作札记" && n.quotes.some(q=>q.text==="摘录已回到目标笔记"))',timeout=15000)
   ck('Excerpt is committed to selected visible note',page.evaluate('jfDeskWorkspace.notes.find(n=>n.title==="工作札记").quotes.length===1'))
   ck('After new quote neither list includes historical blanks',page.evaluate('''()=>{
    jfDeskRenderNotes(); jfDeskChooseQuote({text:'x',bookId:'0123456789abcdef',chapter:0});
    return document.querySelectorAll('#jfDeskNoteList .jfDeskNoteItem').length===2 &&
      document.querySelectorAll('#jfPdfQuoteOptions button').length===3;
   }'''))
   ck('No browser JS runtime errors',not errors)
   browser.close()
  ws=api(base,'/api/reading/workspace')
  ck('All original note IDs persist',len(ws['notes'])==5 and all(any(n['id']==x for n in ws['notes']) for x in blankids))
  ck('Book content unchanged',hashlib.sha256(source.read_bytes()).hexdigest()==old)
 finally:
  if proc:stop(proc,log)
print('TOTAL',count,flush=True)
