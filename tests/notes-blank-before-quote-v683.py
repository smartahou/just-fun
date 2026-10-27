#!/usr/bin/env python3
"""Real browser regression: blank lines must not delete adjacent excerpt cards."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib,json
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
n=0
def ck(name,val):
 global n
 if not val: raise AssertionError(name)
 n+=1;print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v683-') as d:
 base=pathlib.Path(d);lib=base/'media';lib.mkdir();(lib/'书籍.txt').write_text('原文参考。'*120,encoding='utf-8')
 expected=hashlib.sha256((lib/'书籍.txt').read_bytes()).hexdigest();proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,base/'home');origin='http://127.0.0.1:'+str(port)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':900})
   errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url);body=req.post_data.encode() if req.method=='POST' and req.post_data else None
    r=urllib.request.Request(origin+u.path+('?' +u.query if u.query else ''),data=body,method=req.method,headers={'Content-Type':'application/json'} if body else {})
    try:
     with urllib.request.urlopen(r,timeout=40) as response:status=response.status;data=response.read();mime=response.headers.get('Content-Type','application/json')
    except urllib.error.HTTPError as e:status=e.code;data=e.read();mime=e.headers.get('Content-Type','application/json')
    route.fulfill(status=status,body=data,headers={'Content-Type':mime})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=25000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click();page.locator('#jfDeskNewNote').click();page.locator('#jfDeskNoteTitle').fill('回车与摘录边界')
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='回车与摘录边界')",timeout=15000)
   async_seed='''async(v)=>{const book=jfBooks[0],old=jfDeskWorkspace.notes.find(n=>n.title==='回车与摘录边界');await jfDeskMutate({action:'note',note:{...old,quotes:[{bookId:book.id,chapter:0,type:'text',text:'这段摘录不能被误删'}],blocks:[{kind:'text',text:v},{kind:'quote',index:0},{kind:'text',text:''}]}});await jfDeskSelectNote(old.id);}'''
   def snapshot():return page.evaluate('''()=>{const root=document.querySelector('#jfDeskExcerpt');return {html:root.innerHTML,blocks:jfDeskEditorBlocks(),armed:!!root.querySelector('.jfDeskQuoteDeleteArmed'),quote:!!root.querySelector('.jfDeskFlowQuote'),selection:{node:getSelection()?.anchorNode?.parentElement?.className,offset:getSelection()?.anchorOffset}}}''')
   def caret_end():
    return page.evaluate('''()=>{const root=document.getElementById('jfDeskExcerpt'),chunk=root.querySelector('.jfNoteTextChunk');root.focus();const range=document.createRange();range.selectNodeContents(chunk);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);}''')
   def caret_before_quote():
    return page.evaluate('''()=>{const root=document.getElementById('jfDeskExcerpt'),card=root.querySelector('.jfDeskFlowQuote');root.focus();const range=document.createRange();range.setStartBefore(card);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);}''')
   for case in ['第一段正文\n\n','第一段正文\n']:
    page.evaluate(async_seed,case);caret_end();before=snapshot();print('BEFORE',repr(case),json.dumps(before,ensure_ascii=False)[:500],flush=True)
    page.keyboard.press('Backspace');after=snapshot();print('AFTER BACKSPACE',repr(case),json.dumps(after,ensure_ascii=False)[:500],flush=True)
    ck('Backspace keeps quote for text ending '+repr(case),after['quote'] and not after['armed'])
    ck('Backspace removes exactly one line break before quote '+repr(case),after['blocks'][0]['text']==case[:-1])
   page.evaluate(async_seed,'第一段正文\n\n');caret_before_quote();before=snapshot();print('BEFORE QUOTE RANGE',json.dumps(before,ensure_ascii=False)[:300],flush=True)
   page.keyboard.press('Backspace');after=snapshot();print('AFTER QUOTE RANGE',json.dumps(after,ensure_ascii=False)[:500],flush=True)
   ck('Backspace before quote does not delete it',after['quote'] and not after['armed'])
   ck('Backward deletion at root boundary edits preceding prose',len(after['blocks'][0]['text'])<len(before['blocks'][0]['text']))
   page.evaluate(async_seed,'第一段正文\n\n');caret_end();page.keyboard.press('Delete');after=snapshot();print('AFTER FORWARD DELETE',json.dumps(after,ensure_ascii=False)[:500],flush=True)
   ck('Forward-delete from blank line never deletes quote directly',after['quote'])
   ck('Forward-delete arms quote visibly',after['armed'])
   ck('No uncaught JS errors',not errs)
   browser.close()
  ck('Original book untouched',hashlib.sha256((lib/'书籍.txt').read_bytes()).hexdigest()==expected)
 finally:
  if proc:stop(proc,lg)
print('TOTAL',n,flush=True)
