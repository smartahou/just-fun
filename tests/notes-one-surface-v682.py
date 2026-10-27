#!/usr/bin/env python3
"""Single contenteditable note surface + embedded block deletion + Markdown/rich fidelity."""
import tempfile,pathlib,urllib.request,urllib.parse,urllib.error,hashlib
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
n=0
def ck(name,v):
 global n
 if not v: raise AssertionError(name)
 n+=1; print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v682-') as d:
 base=pathlib.Path(d);lib=base/'media';lib.mkdir()
 (lib/'书籍.txt').write_text('原文参考。'*120,encoding='utf8')
 expected=hashlib.sha256((lib/'书籍.txt').read_bytes()).hexdigest();proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,base/'home');origin='http://127.0.0.1:'+str(port)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1440,'height':900},accept_downloads=True)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url)
    if u.path.startswith('/api/'):
     body=req.post_data.encode() if req.method=='POST' and req.post_data else None
     r=urllib.request.Request(origin+u.path+('?'+u.query if u.query else ''),data=body,method=req.method,headers={'Content-Type':'application/json'} if body else {})
     try:
      with urllib.request.urlopen(r,timeout=40) as response:status=response.status;data=response.read();mime=response.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:status=e.code;data=e.read();mime=e.headers.get('Content-Type','application/json')
     route.fulfill(status=status,body=data,headers={'Content-Type':mime})
    else:route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=25000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click()
   ck('Notes container starts near left edge',page.evaluate("()=>document.getElementById('jfDeskNotes').getBoundingClientRect().x <= 2"))
   ck('Notes title matches Gallery computed typography',page.evaluate("()=>{const t=getComputedStyle(document.querySelector('#jfDeskNotes .jfDeskNotesHead h3')),g=getComputedStyle(document.querySelector('.photoToolbarHead strong'));return t.fontSize===g.fontSize && t.fontWeight===g.fontWeight;}"))
   page.locator('#jfDeskNewNote').click()
   page.locator('#jfDeskNoteTitle').fill('统一编辑器验收')
   edit=page.locator('#jfDeskExcerpt')
   ck('Exactly one visible editable note surface',page.evaluate("()=>document.querySelectorAll('#jfDeskNoteCanvas [contenteditable=true]').length===1 && document.querySelector('#jfDeskNoteBody').getBoundingClientRect().height===0"))
   edit.click();page.keyboard.type('第一段正文，自动换行测试。')
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='统一编辑器验收' && n.content.includes('第一段正文'))",timeout=16000)
   ck('One surface persists prose',page.evaluate("jfDeskWorkspace.notes.some(n=>n.content.includes('第一段正文'))"))
   # Seed a valid saved excerpt via the public mutation route.
   page.evaluate('''async()=>{const book=jfBooks[0],old=jfDeskWorkspace.notes.find(n=>n.title==='统一编辑器验收');
      await jfDeskMutate({action:'note',note:{...old,quotes:[{bookId:book.id,chapter:0,type:'text',text:'历史引文内容'}],blocks:[{kind:'text',text:'第一段正文，自动换行测试。'},{kind:'quote',index:0},{kind:'text',text:''}]}});
      await jfDeskSelectNote(old.id);}''')
   ck('Quote is an embedded noneditable node',page.evaluate("()=>{const card=document.querySelector('#jfDeskExcerpt .jfDeskFlowQuote');return card?.getAttribute('contenteditable')==='false'&&card?.parentElement?.id==='jfDeskExcerpt';}"))
   ck('No per-paragraph textarea visible',page.locator('#jfDeskNoteCanvas .jfDeskInlineNoteText').count()==0)
   ck('One blank prose block follows quote',page.evaluate("()=>{const c=document.querySelector('.jfDeskFlowQuote');return c?.nextElementSibling?.classList.contains('jfNoteTextChunk')&&!(c.nextElementSibling.innerText||'').trim();}"))
   tail=page.locator('#jfDeskExcerpt .jfNoteTextChunk').last
   tail.click();page.keyboard.type('后来写的体会。')
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='统一编辑器验收'&&n.content.includes('后来写的体会'))",timeout=16000)
   ck('Body and excerpt and continuation saved in order',page.evaluate("()=>jfDeskWorkspace.notes.find(n=>n.title==='统一编辑器验收').blocks.map(b=>b.kind).join(',')==='text,quote,text'"))
   page.locator('#jfNoteRichMode').click();ck('Rich mode preserves quote block',page.locator('.jfDeskFlowQuote').count()==1)
   page.locator('#jfNoteMdMode').click();ck('Markdown mode preserves quote block',page.locator('.jfDeskFlowQuote').count()==1)
   with page.expect_download() as info: page.locator('#jfNoteExportMd').click()
   report=base/'readme.md';info.value.save_as(report)
   ck('Export retains inline quote and prose',all(x in report.read_text() for x in ['第一段正文','历史引文内容','后来写的体会']))
   # Backspace from empty prose after quote arms it; twice removes it.
   page.evaluate('''()=>{const chunk=document.querySelector('#jfDeskExcerpt .jfNoteTextChunk:last-child');chunk.textContent='';const r=document.createRange();r.selectNodeContents(chunk);r.collapse(true);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);chunk.parentElement.focus();}''')
   page.keyboard.press('Backspace')
   ck('First Backspace arms selection',page.locator('.jfDeskQuoteDeleteArmed').count()==1 and page.locator('.jfDeskFlowQuote').count()==1)
   ck('Deletion focus visible',page.evaluate("()=>getComputedStyle(document.querySelector('.jfDeskQuoteDeleteArmed')).boxShadow!=='none'"))
   page.keyboard.press('Backspace')
   ck('Second Backspace removes quote',page.locator('.jfDeskFlowQuote').count()==0)
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='统一编辑器验收'&&n.quotes.length===0)",timeout=16000)
   ck('Deleted reference removed from persisted note',page.evaluate("()=>{const n=jfDeskWorkspace.notes.find(n=>n.title==='统一编辑器验收');return n.quotes.length===0&&!n.blocks.some(b=>b.kind==='quote');}"))
   page.locator('#jfDeskNoteTitle').click();page.locator('#jfNoteMdMode').click()
   page.evaluate("(value)=>{const c=document.querySelector('#jfDeskExcerpt .jfNoteTextChunk');c.textContent=value;c.dispatchEvent(new InputEvent('input',{bubbles:true}));}", '## 章节标题\n\n正文 **加粗** 与 *斜体*。\n<script>bad()</script>')
   page.wait_for_function("jfDeskWorkspace.notes.some(n=>n.title==='统一编辑器验收'&&n.content.includes('章节标题'))",timeout=16000)
   page.locator('#jfNotePreview').click()
   ck('Markdown preview renders heading and bold',page.locator('#jfDeskExcerpt .jfNoteTextChunk h2').count()==1 and page.locator('#jfDeskExcerpt .jfNoteTextChunk strong').count()==1)
   ck('Preview escapes unsafe HTML',page.locator('#jfDeskExcerpt script').count()==0 and page.locator('#jfDeskExcerpt').inner_text().find('<script>')>=0)
   page.locator('#jfNotePreview').click()
   ck('Leaving preview restores raw Markdown',page.evaluate("()=>document.querySelector('#jfDeskExcerpt .jfNoteTextChunk').textContent.includes('**加粗**')"))
   page.locator('#jfNoteRichMode').click()
   ck('Rich mode shares same editable surface',page.locator('#jfDeskExcerpt[contenteditable=true] .jfNoteTextChunk h2').count()==1)
   page.locator('#jfNoteMdMode').click()
   ck('Rich to Markdown retains content',page.locator('#jfDeskExcerpt').inner_text().find('章节标题')>=0)
   ck('No unhandled browser errors',not errors)
   page.screenshot(path='/mnt/data/jf-v682-notes-proof.png')
   browser.close()
  ck('Original text unchanged',hashlib.sha256((lib/'书籍.txt').read_bytes()).hexdigest()==expected)
 finally:
  if proc:stop(proc,lg)
print('TOTAL',n,flush=True)
