#!/usr/bin/env python3
"""Chromium partial-delete feedback and failed-item re-selection in disposable UI."""
from isolated import ROOT,launch,stop,make_fixture
from playwright.sync_api import sync_playwright
import tempfile,pathlib,urllib.request,urllib.error,urllib.parse
N=0
def check(k,v,d=''):
 global N
 if not v:raise AssertionError(k+' '+str(d))
 N+=1;print('PASS',k,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-delete-ui-v726-') as t:
 b=pathlib.Path(t);lib=b/'media';make_fixture(lib)
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,b/'home')
  html=urllib.request.urlopen(f'http://127.0.0.1:{port}/').read().decode().replace('<head>','<head><base href="http://justfun.test/">',1)
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1280,'height':800});alerts=[];errors=[]
   page.on('dialog',lambda dlg:(alerts.append((dlg.type,dlg.message)),dlg.accept()))
   page.on('pageerror',lambda e:errors.append(str(e)))
   def route_handler(route):
    u=urllib.parse.urlsplit(route.request.url)
    h={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}
    if route.request.method=='OPTIONS':route.fulfill(status=204,headers=h,body='');return
    q=urllib.request.Request(f'http://127.0.0.1:{port}'+u.path+('?' + u.query if u.query else ''),
     data=route.request.post_data_buffer if route.request.method=='POST' else None,method=route.request.method)
    try:
     with urllib.request.urlopen(q,timeout=10) as res:st=res.status;data=res.read();ty=res.headers.get('Content-Type','application/json')
    except urllib.error.HTTPError as e:st=e.code;data=e.read();ty='application/json'
    route.fulfill(status=st,body=data,headers={**h,'Content-Type':ty})
   page.route('http://justfun.test/**',route_handler)
   page.set_content(html,wait_until='domcontentloaded',timeout=30000)
   page.wait_for_function('typeof deleteUnifiedMedia===\'function\'',timeout=15000)
   result=page.evaluate('''async()=>{
     const key='a'.repeat(16);
     allItems=[{key,kind:'video',title:'待删除视频.mp4',originalName:'待删除视频.mp4'}];
     libraryMode='video';setUnifiedSelectMode(true);mediaSelectedKeys.add(key);syncUnifiedTiles();
     load=async()=>{};
     mediaPost=async()=>({ok:true,deleted:0,failed:[{key,error:'EPERM: 文件正在使用'}]});
     await deleteUnifiedMedia([key]);
     return {selectMode:mediaSelectMode,keys:[...mediaSelectedKeys]};
   }''')
   check('Failed deletion stays in selection mode',result['selectMode'] and result['keys']==['a'*16],result)
   check('Detailed failure shown to user',any('EPERM' in d[1] and '失败 1' in d[1] for d in alerts),alerts)
   result=page.evaluate('''async()=>{
     mediaPost=async()=>({ok:true,deleted:1,failed:[]});
     await deleteUnifiedMedia(['a'.repeat(16)]);
     return {selectMode:mediaSelectMode,keys:[...mediaSelectedKeys]};
   }''')
   check('Successful retry exits selection',not result['selectMode'] and not result['keys'],result)
   check('No browser errors',not errors,errors)
   browser.close()
 finally:stop(proc,lg)
print('TOTAL',N,'PASS',flush=True)
