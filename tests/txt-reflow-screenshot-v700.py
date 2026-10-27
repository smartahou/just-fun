#!/usr/bin/env python3
"""v7.00 regression: mixed TXT hard wraps, empty row noise, reversible screenshot mask."""
import tempfile,pathlib,hashlib,json,urllib.request,urllib.error,urllib.parse
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0
def ck(name,val):
 global count
 assert val,name
 count+=1;print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v700-') as d:
 root=pathlib.Path(d);media=root/'books';media.mkdir()
 prose=[
 '这是我写下的第一段话，为了模拟从某些阅读软件导出来的文本，每行都带有固定的换行和一段连续的话语',
 '接下来一行实际上还是同一个自然段，这里继续讨论为什么这种版面不应该有满屏幕不必要的空白内容',
 '这行的文字也是上一段的一部分，直到最后的句号才有必要真正换到下一个自然段。',
 '　　第二段应该从此处重新开始，之前的空白是源文件排版习惯，而不是一个又一个独立的自然段',
 '这里继续叙述第二个自然段的内容，如果排版跟之前一样又强制每行切割那就很难看很难阅读',
 '再往后这段文字也应该自动填充阅读区域而不是全部挤在左侧，甚至会把空白显示得特别夸张。'
 ]
 fixture='\n\n'.join(prose)+'\n第三章 新的篇章\n新的章节开始。'
 p=media/'示例书.txt';p.write_text(fixture,encoding='utf8');original_sha=hashlib.sha256(p.read_bytes()).hexdigest()
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',media,root/'home');origin=f'http://127.0.0.1:{port}'
  status,_,raw=urlopen(origin+'/api/books?refresh=1');books=json.loads(raw)['books'];ck('TXT book indexed',status==200 and bool(books));bookid=books[0]['id']
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1600,'height':940});errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
   def proxy(route):
    req=route.request;u=urllib.parse.urlsplit(req.url);data=req.post_data_buffer if req.method=='POST' else None
    h={'Content-Type':'application/json'} if data else {}
    r=urllib.request.Request(origin+u.path+('?' +u.query if u.query else ''),data=data,method=req.method,headers=h)
    try:
     with urllib.request.urlopen(r,timeout=30) as res:code=res.status;body=res.read();ctype=res.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e:code=e.code;body=e.read();ctype=e.headers.get('Content-Type','application/json')
    route.fulfill(status=code,body=body,headers={'Content-Type':ctype})
   page.route('http://justfun.test/**',proxy)
   page.set_content(urlopen(origin+'/')[2].decode('utf8').replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=25000)
   page.evaluate('(id)=>jfDeskOpenReader(id,0)',bookid)
   page.wait_for_function('jfDeskBook&&jfReadText.textContent.includes("这是我")',timeout=15000)
   displayed=page.locator('#jfReadText').inner_text()
   ck('Single blank source row does not break every long line',prose[0]+prose[1]+prose[2] in displayed)
   ck('Author-indented paragraph preserved',prose[2]+'\n'+prose[3] in displayed)
   ck('Third paragraph soft-wrap joined',prose[3]+prose[4]+prose[5] in displayed)
   ck('Chapter header remains separate','\n第三章 新的篇章\n新的章节开始。' in displayed)
   calc=page.evaluate('''()=>{const s=getComputedStyle(jfReadText);const r=jfReadText.getBoundingClientRect();return {lineHeight:parseFloat(s.lineHeight),fontSize:parseFloat(s.fontSize),whiteSpace:s.whiteSpace,width:r.width,side:parseFloat(s.paddingLeft)}}''')
   ck('TXT uses compact natural flow and fills reader width',calc['whiteSpace']=='pre-line' and calc['lineHeight']/calc['fontSize']<1.85 and calc['width']>1100)
   before=page.evaluate('jfReadRawText');beforeDisplay=page.evaluate('jfReadVisualText')
   page.locator('#jfReadMask').click()
   masked=page.locator('#jfReadText').inner_text()
   ck('Mask obfuscates Han but keeps same length',len(masked)==len(beforeDisplay) and '这是我' not in masked)
   ck('Mask preserves source and only alters screen',page.evaluate('jfReadRawText')==before and page.evaluate('jfReadVisualText')==beforeDisplay)
   ck('Excerpt disabled while screenshot mask active',page.locator('#jfReadExcerpt').is_disabled())
   page.screenshot(path='/mnt/data/jf-v700-masked-txt.png')
   page.locator('#jfReadMask').click()
   ck('One-click reversal restores exact display',page.locator('#jfReadText').inner_text()==beforeDisplay)
   ck('Excerpt restored after leaving mask',page.locator('#jfReadExcerpt').is_enabled())
   ck('Legacy offset mapping preserved for wrapped row',page.evaluate('(n)=>jfReadRawToDisplay[n]',fixture.index(prose[1]))==beforeDisplay.index(prose[1]))
   ck('No uncaught page errors',not errors)
   browser.close()
  ck('Source bytes unchanged',hashlib.sha256(p.read_bytes()).hexdigest()==original_sha)
 finally:
  if proc:stop(proc,lg)
print('TOTAL',count)
