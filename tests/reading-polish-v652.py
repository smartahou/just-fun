#!/usr/bin/env python3
"""v6.52 isolated EPUB3 TOC, progress shelf, page navigation and source immutability."""
import tempfile, pathlib, hashlib, json, zipfile, urllib.request, urllib.parse, urllib.error
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
checks=0
def ck(msg,ok):
 global checks
 assert ok,msg
 checks+=1
 print('PASS',msg,flush=True)
def api(base,path,post=None):
 req=urllib.request.Request(base+path,data=json.dumps(post).encode() if post is not None else None,headers={'Content-Type':'application/json'} if post is not None else {})
 try:
  with urllib.request.urlopen(req,timeout=15) as resp:return resp.status,json.loads(resp.read())
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v652-') as t:
 root=pathlib.Path(t);lib=root/'书籍和媒体';lib.mkdir();book=lib/'文学作品.epub'
 with zipfile.ZipFile(book,'w',zipfile.ZIP_DEFLATED) as z:
  z.writestr('mimetype','application/epub+zip')
  z.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>')
  z.writestr('OPS/content.opf','<package><manifest><item id="nav" href="toc.xhtml" properties="nav"/><item id="intro" href="c1.xhtml"/><item id="chapter" href="c2.xhtml"/></manifest><spine><itemref idref="intro"/><itemref idref="chapter"/></spine></package>')
  z.writestr('OPS/toc.xhtml','<html><body><nav><ol><li><a href="c1.xhtml#p1">序章：山海之间</a></li><li><a href="c2.xhtml">第二章 &amp; 夜航</a></li></ol></nav><script>alert(1)</script></body></html>')
  z.writestr('OPS/c1.xhtml','<html><body><h1>序章</h1><p>'+('此时此刻，光阴流转。'*850)+'</p></body></html>')
  z.writestr('OPS/c2.xhtml','<html><body><h1>夜航</h1><p>继续前行。</p></body></html>')
 before=hashlib.sha256(book.read_bytes()).hexdigest()
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,root/'home')
  base=f'http://127.0.0.1:{port}'
  st,b=api(base,'/api/books?refresh=1');ck('Current working directory discovers EPUB',st==200 and len(b['books'])==1)
  ident=b['books'][0]['id'];st,o=api(base,'/api/reading/outline?id='+ident)
  ck('EPUB3 nav.xhtml title resolved',st==200 and o['chapters'][0]['title']=='序章：山海之间')
  ck('EPUB3 escaped chapter name resolved',o['chapters'][1]['title']=='第二章 & 夜航')
  st,x=api(base,'/api/reading/workspace',{'action':'progress','revision':0,'bookId':ident,'chapter':0,'ratio':.5,'total':0})
  ck('Reject invalid chapter total safely',st==400)
  st,x=api(base,'/api/reading/workspace',{'action':'progress','revision':0,'bookId':ident,'chapter':0,'ratio':.5,'total':2})
  ck('Store validated progress total',st==200 and x['progress'][ident]['total']==2)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1350,'height':850});errors=[]
   page.on('pageerror',lambda err:errors.append(str(err)))
   def route(proxy):
    req=proxy.request;u=urllib.parse.urlsplit(req.url)
    if u.path.startswith('/api/books') or u.path.startswith('/api/reading'):
     rq=urllib.request.Request(base+u.path+('?' + u.query if u.query else ''),data=req.post_data.encode() if req.method=='POST' else None,method=req.method,headers={'Content-Type':'application/json'} if req.method=='POST' else {})
     try:
      with urllib.request.urlopen(rq,timeout=15) as rr:status=rr.status;body=rr.read()
     except urllib.error.HTTPError as e:status=e.code;body=e.read()
     proxy.fulfill(status=status,body=body,headers={'Content-Type':'application/json'})
    else: proxy.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',route)
   html=urlopen(base+'/')[2].decode();page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded')
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind="books"]').click()
   page.wait_for_function('jfBooks.length===1 && jfDeskWorkspace.progress[jfBooks[0].id]')
   ck('Bookshelf displays continuation label',page.locator('.jfBookReadingLabel').inner_text()=='25% · 继续阅读')
   ck('Bookshelf progress fill accurate',page.locator('.jfBookReadingTrack>span').evaluate("el=>el.style.width==='25%'") )
   page.locator('.jfBookTile').click()
   ck('Clicking a book opens reader directly',page.locator('#jfReader').is_visible() and not page.locator('#jfBookDetail').is_visible())
   page.wait_for_function('jfDeskBook && jfReadText.textContent.includes("此时此刻")')
   ck('EPUB TOC visible in actual reader',page.locator('#jfReadChapters').locator('option').first.inner_text()=='序章：山海之间')
   ck('Reader progress rail present',page.locator('#jfReadProgressFill').count()==1)
   beforetop=page.locator('#jfReadCenter').evaluate('el=>el.scrollTop')
   page.locator('#jfReadText').focus();page.keyboard.press('PageDown');page.wait_for_timeout(450)
   aftertop=page.locator('#jfReadCenter').evaluate('el=>el.scrollTop')
   ck('PageDown advances actual reader scroll',aftertop>beforetop+90)
   page.keyboard.press('Home');page.wait_for_timeout(140)
   ck('Home returns to chapter start',page.locator('#jfReadCenter').evaluate('el=>el.scrollTop')==0)
   page.keyboard.press('End');page.wait_for_timeout(160)
   ck('End moves to chapter end',page.locator('#jfReadCenter').evaluate('el=>el.scrollTop')>aftertop)
   ck('Reading progress rail reflects movement',float(page.locator('#jfReadProgressFill').evaluate('el=>parseFloat(el.style.width)'))>0)
   page.locator('#jfReadNext').click();page.wait_for_function('jfDeskChapter===1 && jfReadText.textContent.includes("继续前行")')
   ck('Chapter transition preserves real EPUB titles',page.locator('#jfReadChapters').input_value()=='1')
   page.locator('#jfReadBack').click();page.wait_for_function('jfReader.hidden')
   ck('Exit updates bookshelf progress',page.locator('.jfBookReadingLabel').inner_text().startswith('50%'))
   ck('No uncaught browser exception',not errors)
   # Static screenshot is used for our own visual inspection, not distributed to user.
   page.screenshot(path='/mnt/data/justfun_v652/bookshelf-v652.png',full_page=False)
   browser.close()
  st,x=api(base,'/api/reading/workspace')
  ck('Closing persists accurate chapter count',st==200 and x['progress'][ident]['total']==2 and x['progress'][ident]['chapter']==1)
  ck('Original EPUB not modified',hashlib.sha256(book.read_bytes()).hexdigest()==before)
 finally:
  if proc:stop(proc,lg)
print(f'v6.52 PASS {checks}/{checks}',flush=True)
