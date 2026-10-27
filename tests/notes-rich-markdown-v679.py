#!/usr/bin/env python3
"""v6.79: real Chromium notes rich/Markdown, safe preview, exports and persistence."""
import pathlib,tempfile,urllib.request,urllib.parse,urllib.error,json,hashlib,os
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
checks=0
def ck(label,ok):
 global checks
 if not ok:raise AssertionError(label)
 checks+=1;print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v679-') as d:
 tmp=pathlib.Path(d);lib=tmp/'library';lib.mkdir();(lib/'甲.txt').write_text('原著文字\n'*100,encoding='utf8')
 orig=hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest();proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,tmp/'home');base='http://127.0.0.1:'+str(port)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':1440,'height':900},accept_downloads=True)
   page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def route(proxy):
    r=proxy.request;u=urllib.parse.urlsplit(r.url)
    if u.path.startswith('/api/'):
     rq=urllib.request.Request(base+u.path+('?'+u.query if u.query else ''),data=r.post_data.encode() if r.method=='POST' else None,method=r.method,headers={'Content-Type':'application/json'} if r.method=='POST' else {})
     try:
      with urllib.request.urlopen(rq,timeout=25) as res:status=res.status;body=res.read();ctype=res.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:status=e.code;body=e.read();ctype=e.headers.get('Content-Type','application/json')
     proxy.fulfill(status=status,body=body,headers={'Content-Type':ctype})
    else:proxy.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',route)
   html=urlopen(base+'/')[2].decode()
   page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=25000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click()
   page.locator('#jfDeskNewNote').click();title=page.locator('#jfDeskNoteTitle');title.wait_for(state='visible')
   title.click();ck('Note title accepts a real pointer click',page.evaluate('document.activeElement?.id')=='jfDeskNoteTitle')
   ck('Notes header leaves title hit area unobstructed',page.evaluate('''() => {const e=document.querySelector('#jfDeskNoteTitle'),r=e.getBoundingClientRect();return e===document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);}'''))
   title.fill('书房 · 标题测试')
   page.locator('#jfDeskNoteBody').fill('## 重要标题\n\n一段 **加粗** 和 *斜体*。\n\n- 条目一\n- 条目二\n\n<script>window.exploited=true</script>\n\n[危险](javascript:alert(1))')
   page.wait_for_function("document.querySelector('#jfDeskSaveState').textContent==='已保存'",timeout=20000)
   ck('Markdown stored with original raw HTML text intact',page.evaluate("jfDeskWorkspace.notes.some(n=>n.title==='书房 · 标题测试'&&n.content.includes('<script>')&&n.format==='md')"))
   page.locator('#jfNotePreview').click();ck('Preview renders heading and emphasis',page.locator('.jfNotePreviewField h2').first.inner_text()=='重要标题' and page.locator('.jfNotePreviewField strong').count()==1)
   ck('Preview sanitizes raw HTML and unsafe links',not page.evaluate('window.exploited===true') and page.locator('.jfNotePreviewField script').count()==0 and page.locator('.jfNotePreviewField a').count()==0)
   page.locator('#jfNotePreview').click();page.locator('#jfNoteRichMode').click()
   rich=page.locator('.jfNoteRichField').first
   ck('Rich mode renders original paragraph structure',rich.locator('h2').count()==1 and rich.locator('ul li').count()==2)
   ck('Rich mode stays editable',rich.get_attribute('contenteditable')=='true')
   page.locator('#jfNoteMdMode').click()
   ck('Untouched Markdown roundtrip preserves original source exactly',page.locator('#jfDeskNoteBody').input_value().startswith('## 重要标题\n\n一段 **加粗**'))
   page.locator('#jfNoteRichMode').click()
   rich=page.locator('.jfNoteRichField').first
   rich.locator('h2').first.click();rich.locator('h2').first.press('End');rich.locator('h2').first.type('· 修订')
   page.locator('#jfNoteMdMode').click();ck('Rich edits convert into Markdown on switch', '修订' in page.locator('#jfDeskNoteBody').input_value())
   page.wait_for_function("document.querySelector('#jfDeskSaveState').textContent==='已保存'",timeout=16000)
   ck('Selected editor mode persists',page.evaluate("jfDeskWorkspace.notes.find(n=>n.title==='书房 · 标题测试')?.format==='md'"))
   with page.expect_download() as download_info: page.locator('#jfNoteExportMd').click()
   md=download_info.value;mdpath=tmp/'out.md';md.save_as(mdpath)
   ck('Markdown export has title and converted edits',md.suggested_filename.endswith('.md') and '修订' in mdpath.read_text() and '书房 · 标题测试' in mdpath.read_text())
   with page.expect_download() as download_info:page.locator('#jfNoteExportHtml').click()
   exported=download_info.value;htm=tmp/'out.html';exported.save_as(htm)
   ck('HTML export includes structural heading and safe escaping',exported.suggested_filename.endswith('.html') and '<h2>' in htm.read_text() and '&lt;script&gt;' in htm.read_text() and '<script>window.exploited' not in htm.read_text())
   page.locator('.jfDeskNoteItem').first.click();page.wait_for_timeout(200)
   ck('Reopened note retains title/content',page.locator('#jfDeskNoteTitle').input_value()=='书房 · 标题测试' and '修订' in page.locator('#jfDeskNoteBody').input_value())
   ck('No unhandled page exceptions',not errors)
   page.screenshot(path='/mnt/data/justfun_edit/notes-v679-ui.png',full_page=True)
   browser.close()
  ck('Source books remain byte-for-byte unchanged',hashlib.sha256((lib/'甲.txt').read_bytes()).hexdigest()==orig)
 finally:
  if proc:stop(proc,lg)
print('TOTAL',checks,flush=True)
