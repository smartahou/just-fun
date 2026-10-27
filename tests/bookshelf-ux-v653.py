#!/usr/bin/env python3
"""v6.53: read-only books, unified toolbar, direct-open, independent notes and optional real PDF first page.
Temporary fixtures only; no external network and no system-dependency install.
"""
import pathlib, tempfile, hashlib, json, urllib.request, urllib.parse, urllib.error, shutil
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen

def pdf(path):
  text=b'BT /F1 26 Tf 40 345 Td (REAL PDF COVER) Tj ET'
  objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 430] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(text)).encode()+b' >>\nstream\n'+text+b'\nendstream']
  result=b'%PDF-1.4\n';offsets=[0]
  for i,obj in enumerate(objects,1):offsets.append(len(result));result+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
  xref=len(result);result+=f'xref\n0 {len(offsets)}\n'.encode()+b'0000000000 65535 f \n'
  for o in offsets[1:]:result+=f'{o:010d} 00000 n \n'.encode()
  result+=f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode();path.write_bytes(result)

checks=[]
def ck(n,condition):
  assert condition,n
  print('PASS',n,flush=True);checks.append(n)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v653-') as work:
  base=pathlib.Path(work);lib=base/'中文工作目录';lib.mkdir();folder=lib/'阅读';folder.mkdir()
  pdf(folder/'书籍.pdf');(folder/'小说.txt').write_text('文本真实章节，'+'下一页。'*3000,encoding='utf8')
  (folder/'书籍.jpg').write_bytes(b'not a genuine image')  # test does not accept this as a valid cover; deleted before browser checks
  (folder/'书籍.jpg').unlink()
  original={str(p.relative_to(lib)):hashlib.sha256(p.read_bytes()).hexdigest() for p in lib.rglob('*') if p.is_file()}
  proc=lg=None
  try:
    proc,port,lg=launch(ROOT/'dist/douyin.js',lib,base/'home');url=f'http://127.0.0.1:{port}'
    code,_,result=urlopen(url+'/api/books?refresh=1');data=json.loads(result)
    ck('same existing media root, two books',code==200 and data['total']==2)
    pdf_id=next(x['id'] for x in data['books'] if x['ext']=='PDF')
    code,headers,result=urlopen(url+'/api/books/cover?id='+pdf_id)
    if shutil.which('pdftoppm'):ck('real first PDF page rasterized in memory',code==200 and result.startswith(b'\x89PNG\r\n\x1a\n'))
    else:ck('rasterizer absence safely returns no thumbnail',code==204)
    ck('cover endpoint refuses traversal id',urlopen(url+'/api/books/cover?id=../../a')[0] in (400,404))
    with sync_playwright() as pw:
      browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
      page=browser.new_page(viewport={'width':1440,'height':880});errors=[]
      page.on('pageerror',lambda e:errors.append(str(e)))
      def proxy(route):
        r=route.request;u=urllib.parse.urlsplit(r.url)
        if u.path.startswith('/api/books') or u.path.startswith('/api/reading'):
          rq=urllib.request.Request(url+u.path+('?' + u.query if u.query else ''),data=r.post_data.encode() if r.method=='POST' else None,method=r.method,headers={'Content-Type':'application/json'} if r.method=='POST' else {})
          try:
            with urllib.request.urlopen(rq,timeout=20) as rr:code=rr.status;body=rr.read();ctype=rr.headers.get('Content-Type','application/json')
          except urllib.error.HTTPError as e:code=e.code;body=e.read();ctype=e.headers.get('Content-Type','application/json')
          route.fulfill(status=code,body=body,headers={'Content-Type':ctype,'Access-Control-Allow-Origin':'*'})
        else:route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
      page.route('http://justfun.test/**',proxy)
      html=urlopen(url+'/')[2].decode();page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
      page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click()
      page.locator('.jfBookTile').first.wait_for(timeout=12000)
      ck('shared header search, no book masthead',page.locator('.studioSearchWrap #jfBooksSearch').is_visible() and page.locator('.jfBooksHead').count()==0)
      ck('single search in header',page.locator('.studioSearchWrap').is_visible() and not page.locator('#search').is_visible())
      ck('no duplicate metadata rows under covers',page.locator('.jfBookTileInfo').count()==0 and page.locator('.jfBookTileTitle').first.evaluate('el=>getComputedStyle(el).webkitLineClamp')=='2')
      page.locator('#jfBooksSearch').fill('小说');ck('header filters books',page.locator('.jfBookTile').count()==1)
      page.locator('#jfBooksSearch').fill('');page.locator('.jfBookTile').filter(has_text='小说').click()
      ck('single click goes directly to reader',page.locator('#jfReader').is_visible() and page.locator('#jfBookDetail').is_hidden())
      ck('consistent svg back icon',page.locator('#jfReadBack svg').count()==1)
      page.locator('#jfReadBack').click();page.wait_for_function('jfReader.hidden')
      ck('back returns bookshelf',page.locator('#jfBooksWorkspace').is_visible())
      page.locator('.jfBookTile').filter(has_text='书籍').click();page.wait_for_function('jfDeskOutline && jfDeskOutline.nativePdf')
      ck('PDF shows only working controls',not page.locator('#jfReadLarger').is_visible() and page.locator('#jfReadNotes').is_visible() and page.locator('#jfReadBack').is_visible())
      page.locator('#jfReadBack').click();page.wait_for_function('jfReader.hidden')
      page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click()
      ck('independent notes navigation and wide workspace',page.evaluate('document.body.classList.contains("jfNotesMode")') and page.locator('#jfDeskNotes').is_visible() and page.locator('#jfBooksWorkspace').is_hidden())
      page.locator('#jfDeskNewNote').click();page.wait_for_function('jfDeskActiveNote!==null')
      page.locator('#jfDeskNoteTitle').fill('独立笔记测试');page.locator('#jfDeskNoteBody').fill('书房笔记测试内容');page.wait_for_timeout(1100)
      ck('standalone note autosaves',page.locator('#jfDeskSaveState').inner_text()=='已保存')
      page.locator('#jfBooksSearch').fill('独立笔记');ck('shared header filters notes',page.locator('.jfDeskNoteItem').count()==1)
      page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click()
      ck('return to books hides notes canvas',page.locator('#jfBooksWorkspace').is_visible() and not page.locator('#jfDeskNotes').is_visible())
      ck('no uncaught browser exceptions',not errors)
      browser.close()
    ck('all original books unchanged',all(hashlib.sha256((lib/p).read_bytes()).hexdigest()==digest for p,digest in original.items()))
  finally:
    if proc:stop(proc,lg)
print('PASS TOTAL',len(checks),flush=True)
