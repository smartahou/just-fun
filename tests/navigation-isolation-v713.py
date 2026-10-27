#!/usr/bin/env python3
"""Browser regression: gallery styles/DOM may never leak into Books or Notes.
Real bundled HTML, real image album and local server, temporary media only.
"""
import pathlib,tempfile,urllib.parse,urllib.request,urllib.error,hashlib
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,make_fixture,urlopen

N=0
def check(name,value):
 global N
 assert value, name
 N+=1;print('PASS',name,flush=True)

def run(viewport):
 with tempfile.TemporaryDirectory(prefix='jf-architecture-test-nav-v713-') as td:
  base=pathlib.Path(td);media=base/'media';original=make_fixture(media)
  proc=log=None
  try:
   proc,port,log=launch(ROOT/'dist/douyin.js',media,base/'home')
   origin=f'http://127.0.0.1:{port}'
   html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
   with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport=viewport);page.set_default_timeout(12000)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    def proxy(route):
     u=urllib.parse.urlsplit(route.request.url)
     if u.path.startswith('/api/'):
      data=route.request.post_data_buffer if route.request.method=='POST' else None
      req=urllib.request.Request(origin+u.path+('?' + u.query if u.query else ''),data=data,method=route.request.method,
                                 headers={'Content-Type':route.request.headers.get('content-type','application/json')})
      try:
       with urllib.request.urlopen(req,timeout=30) as rsp:st=rsp.status;body=rsp.read();mime=rsp.headers.get('Content-Type','application/json')
      except urllib.error.HTTPError as e:st=e.code;body=e.read();mime=e.headers.get('Content-Type','application/json')
      route.fulfill(status=st,body=body,headers={'Content-Type':mime})
     else: route.fulfill(status=404,body='')
    page.route('http://justfun.test/**',proxy)
    page.set_content(html,wait_until='domcontentloaded',timeout=30000)
    page.wait_for_function('allItems.some(x=>x.kind===\'image\')',timeout=18000)
    def click(kind):
     page.evaluate('''kind=>document.querySelector('[data-media-kind="'+kind+'"]').click()''',kind)
     page.wait_for_timeout(160)
    def computed():
     return page.evaluate('''()=>{
       const style=id=>getComputedStyle(document.getElementById(id)).display;
       return {tab:document.querySelector('[data-media-kind][aria-selected="true"]')?.dataset.mediaKind,
         body:document.body.className,folder:style('folderTiles'),
         grid:style('grid'),toolbar:style('photoToolbar'),books:style('jfBooksWorkspace'),
         albumVisible:[...document.querySelectorAll('#folderTiles .photoAlbum')].some(x=>x.getClientRects().length>0),
         count:document.querySelectorAll('#folderTiles .photoAlbum').length,
         orphan:document.elementFromPoint(Math.min(innerWidth-10,145),150)?.closest('.photoAlbum')!==null};
     }''')
    click('image');gallery=computed()
    check('Gallery has visible album tiles',gallery['count']>0 and gallery['albumVisible'] and gallery['toolbar']!='none')
    for kind in ['notes','books','notes','books']:
     click(kind);info=computed()
     check(kind+' selected and isolated',info['tab']==kind and 'jfBooksMode' in info['body'] and
       info['folder']=='none' and info['grid']=='none' and info['toolbar']=='none' and
       not info['albumVisible'] and not info['orphan'])
    for kind in ['audio','image','video','image','notes','video']:
     click(kind);info=computed()
     if kind=='image':
      check('Returning to gallery displays only gallery', info['tab']==kind and info['toolbar']!='none' and info['albumVisible'] and info['grid']!='none')
     elif kind=='notes':
      check('Repeated notes isolation',info['tab']==kind and info['folder']=='none' and info['grid']=='none' and info['toolbar']=='none' and not info['albumVisible'])
     else:
      check('Returning to '+kind+' clears gallery',info['tab']==kind and info['toolbar']=='none' and info['grid']!='none' and info['count']==0)
    check('No browser errors',not errors)
    browser.close()
   check('No media file mutation',all(p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==v for name,v in original.items() for p in [media/name]))
  finally:stop(proc,log)
for viewport in ({'width':1440,'height':900},{'width':390,'height':844}):
 print('VIEWPORT',viewport,flush=True);run(viewport)
print('NAVIGATION ISOLATION',N,'PASS',flush=True)
