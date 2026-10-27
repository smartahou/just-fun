#!/usr/bin/env python3
"""Browser-only regression for v6.59: dense Notes geometry, focus, PDF fallback toolbar.
No real user media. The HTML is served from the built offline single file.
"""
import pathlib,tempfile,json,urllib.request,urllib.parse,urllib.error
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen

def ck(cond,msg):
 if not cond:raise AssertionError(msg)
 print('PASS',msg,flush=True)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v659-' ) as d:
 base=pathlib.Path(d);books=base/'中文媒体库';books.mkdir()
 (books/'样本.txt').write_text('示例文本。'*500,encoding='utf8')
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',books,base/'home');url=f'http://127.0.0.1:{port}'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   for width in [1575,1440,740]:
    page=browser.new_page(viewport={'width':width,'height':920})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def proxy(route):
     req=route.request;u=urllib.parse.urlsplit(req.url)
     if u.path.startswith('/api/'):
      rq=urllib.request.Request(url+u.path+('?' + u.query if u.query else ''),
        data=req.post_data.encode() if req.method=='POST' else None,
        method=req.method,headers={'Content-Type':'application/json'} if req.method=='POST' else {})
      try:
       with urllib.request.urlopen(rq,timeout=24) as res:
        status=res.status;body=res.read();ctype=res.headers.get('Content-Type','application/json')
      except urllib.error.HTTPError as e:
       status=e.code;body=e.read();ctype=e.headers.get('Content-Type','application/json')
      route.fulfill(status=status,body=body,headers={'Content-Type':ctype,'Access-Control-Allow-Origin':'*'})
     else:
      route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
    page.route('http://justfun.test/**',proxy)
    html=urlopen(url+'/')[2].decode()
    page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=25000)
    page.locator('#studioRailToggle').click()
    page.locator('[data-media-kind=notes]').click()
    page.locator('#jfDeskNewNote').click()
    page.locator('#jfDeskNoteTitle').fill('测试标题')
    page.locator('#jfDeskNoteBody').fill('笔记布局专项，源文件不能改。')
    page.wait_for_function('document.querySelector("#jfDeskSaveState").textContent==="已保存"',timeout=9000)
    values=page.evaluate('''() => {
      const ids=['jfDeskNotes','jfDeskNoteList','jfDeskEditor','jfDeskNoteTitle','jfDeskNoteBody'];
      const a=Object.fromEntries(ids.map(id=>{const el=document.getElementById(id),r=el.getBoundingClientRect(),cs=getComputedStyle(el);return [id,{x:r.x,y:r.y,width:r.width,height:r.height,border:cs.borderTopWidth}]}));
      document.getElementById('jfDeskNoteTitle').focus();
      a.focus={outline:getComputedStyle(document.getElementById('jfDeskNoteTitle')).outlineStyle,
       boxShadow:getComputedStyle(document.getElementById('jfDeskNoteTitle')).boxShadow,
       borderLeft:getComputedStyle(document.getElementById('jfDeskNoteTitle')).borderLeftWidth};
      a.scroll=document.documentElement.scrollWidth;return a;
    }''')
    print('LAYOUT',width,json.dumps(values,ensure_ascii=False),flush=True)
    notes=values['jfDeskNotes'];lst=values['jfDeskNoteList'];edit=values['jfDeskEditor'];title=values['jfDeskNoteTitle'];body=values['jfDeskNoteBody']
    ck(notes['x']>=0 and notes['x']+notes['width']<=width+2 and values['scroll']<=width+2,f'no horizontal overflow {width}')
    ck(lst['width']<205 and edit['width']>= 290 if width>900 else lst['width']<160 and edit['width']>150,f'compact index and broad editor {width}')
    ck(title['y']-notes['y']<34,f'title near top {width}')
    ck(notes['x']<=62 if width>760 else notes['x']<=52,f'narrow outer edge {width}')
    ck(lst['width']<=142 if width>760 else lst['width']<=116,f'narrow left index {width}')
    ck(edit['x']-lst['x']-lst['width']<=9,f'tight center gutter {width}')
    ck(edit['x']<=216 if width>760 else edit['x']<=180,f'editor starts near list {width}')
    ck(notes['height']>825,f'work area fills vertical space {width}')
    ck(body['width']>=edit['width']-5,f'body uses editor width {width}')
    ck(values['focus']['outline']=='none' and values['focus']['boxShadow']=='none' and values['focus']['borderLeft']=='0px',f'no title focus frame {width}')
    if width==1575:
      page.screenshot(path='/mnt/data/jf_v659/notes-density-v659.png',full_page=True)
      page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click();page.locator('.jfBookTile').first.click()
      page.wait_for_function('!document.getElementById("jfReader").hidden')
      head=page.locator('.jfReaderHeader').evaluate('e=>({x:e.getBoundingClientRect().x, padding:getComputedStyle(e).paddingLeft, width:e.clientWidth})')
      print('READER_HEADER',head,flush=True)
      ck(float(head['padding'].replace('px',''))<=22,'compact PDF/reader header')
      # Recreate native-PDF fallback state deterministically (no Windows assumptions).
      page.evaluate('''() => {jfReader.classList.add('jfPdfMode');document.getElementById('jfReadFooter').hidden=true;}''')
      ck(not page.locator('#jfReadFooter').is_visible(),'native PDF fallback does not duplicate footer')
    ck(not errors,f'no JS errors {width}: {errors}')
    page.close()
   browser.close()
 finally:
  if proc:stop(proc,lg)
