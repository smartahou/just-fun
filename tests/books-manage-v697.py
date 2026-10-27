#!/usr/bin/env python3
import pathlib,tempfile,hashlib,json,urllib.request,urllib.error,urllib.parse,time,sys
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
checks=0
def ck(label,condition):
 global checks
 if not condition:raise AssertionError(label)
 checks+=1;print('PASS',label,flush=True)
def get(base,path):
 status,_,body=urlopen(base+path)
 return status,json.loads(body)
def post(base,path,data,origin=None):
 headers={'Content-Type':'application/json'}
 if origin:headers['Origin']=origin
 q=urllib.request.Request(base+path,data=json.dumps(data).encode(),headers=headers,method='POST')
 try:
  with urllib.request.urlopen(q,timeout=12) as f:return f.status,json.load(f)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v697-') as temp:
 tmp=pathlib.Path(temp); lib=tmp/'library';lib.mkdir();
 for name,content in [('诗集.txt','长风破浪会有时\n直挂云帆济沧海\n'*80),('复习.md','# 今日复习\n阅读一章\n')]:
  (lib/name).write_text(content,encoding='utf-8')
 original={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in lib.iterdir() if p.is_file()}
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home',flags=('--hash',));base=f'http://127.0.0.1:{port}'
  _,data=get(base,'/api/books?refresh=1');ck('Hash library discovers both original book titles',set(b['name'] for b in data['books'])==set(original))
  ids={b['name']:b['id'] for b in data['books']}
  ck('Physical book filenames hashed without extension',not any((lib/n).exists() for n in original) and all(len(b['managedName'])==32 and b['managedName'].isalnum() for b in data['books']))
  ck('Physical bytes identical to original',set(original.values())=={hashlib.sha256((lib/b['managedName']).read_bytes()).hexdigest() for b in data['books']})
  _,chapter=get(base,'/api/reading/chapter?id='+ids['诗集.txt']+'&chapter=0');ck('Hashed TXT readable',chapter.get('ok') and '长风破浪' in chapter.get('text',''))
  st,res=post(base,'/api/reading/workspace',{'action':'preferences','preferences':{'font':20,'theme':'paper','side':10,'family':'kai'},'revision':0})
  ck('Reader margin and font persisted by API',st==200 and res['preferences']['family']=='kai' and res['preferences']['side']==10)
  st,res=post(base,'/api/books/delete',{'id':ids['复习.md']},'https://evil.example');ck('Cross origin book delete blocked',st==403)
  ck('Rejected deletion keeps book',get(base,'/api/books')[1]['total']==2)
  st,res=post(base,'/api/books/delete',{'id':ids['复习.md']});ck('Book deletion succeeds',st==200 and res.get('deleted')==ids['复习.md'])
  _,data=get(base,'/api/books?refresh=1');ck('Deleting one book leaves the other',len(data['books'])==1 and data['books'][0]['name']=='诗集.txt')
  (lib/'新书.txt').write_text('专门测试书架删除',encoding='utf8')
  get(base,'/api/books?refresh=1')
  # UI test from actual server document
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1300,'height':830})
   errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
   def proxy(route):
    u=urllib.parse.urlsplit(route.request.url)
    if u.path.startswith('/api/'):
     request=urllib.request.Request(base+u.path+('?'+u.query if u.query else ''),data=route.request.post_data_buffer if route.request.method=='POST' else None,method=route.request.method,headers={'Content-Type':'application/json'} if route.request.method=='POST' else {})
     try:
      with urllib.request.urlopen(request,timeout=12) as r: status=r.status;body=r.read();typ=r.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:status=e.code;body=e.read();typ=e.headers.get('Content-Type','application/json')
     route.fulfill(status=status,body=body,headers={'Content-Type':typ})
    else:route.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
   page.route('http://justfun.test/**',proxy)
   html=urlopen(base+'/')[2].decode()
   page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
   page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click()
   page.locator('.jfBookTile').first.click()
   page.wait_for_function('!document.getElementById("jfReader").hidden',timeout=12000)
   page.locator('#jfReadTypographyToggle').click()
   ck('Reader font selector and margin slider visible',page.locator('#jfReadFamily').is_visible() and page.locator('#jfReadSide').is_visible())
   cs=page.locator('#jfReadText').evaluate('e=>({left:getComputedStyle(e).paddingLeft,family:getComputedStyle(e).fontFamily})')
   ck('Saved reader margin and font applied',cs['left']=='10px' and ('KaiTi' in cs['family'] or 'Kaiti' in cs['family']))
   page.locator('#jfReadSide').evaluate("el=>{el.value='28';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}")
   page.wait_for_timeout(300)
   ck('Margin slider changes visual padding',page.locator('#jfReadText').evaluate("e=>getComputedStyle(e).paddingLeft")=='28px')
   page.locator('#jfReadBack').click()
   page.wait_for_function('document.getElementById("jfReader").hidden',timeout=12000)
   tile=page.locator('.jfBookTileWrap').filter(has_text='新书')
   tile.hover()
   page.on('dialog',lambda dialog:dialog.accept())
   tile.locator('.jfBookTileRemove').click()
   page.wait_for_function("!jfBooks.some(b=>b.title==='新书')",timeout=12000)
   ck('Book tile delete action removes exactly selected book',not (lib/'新书.txt').exists() and bool(list(lib.glob('*'))))
   ck('No unhandled page errors',not errs)
   browser.close()
 finally:
  if proc:stop(proc,log)
 # restart exact same hash-mode library, ids must remain stable
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',lib,tmp/'home');base=f'http://127.0.0.1:{port}'
  _,books=get(base,'/api/books?refresh=1')
  ck('Restart preserves original name and stable book id',len(books['books'])==1 and books['books'][0]['name']=='诗集.txt' and books['books'][0]['id']==ids['诗集.txt'])
  _,prefs=get(base,'/api/reading/workspace');ck('Preference persisted across restart',prefs['preferences']['side']==28 and prefs['preferences']['family']=='kai')
 finally:
  if proc:stop(proc,log)
print('TOTAL',checks)
