#!/usr/bin/env python3
"""Book scans on slow disks coalesce; old responses cannot mutate closed views."""
import pathlib,tempfile,urllib.parse,urllib.request,urllib.error,hashlib
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,make_fixture,urlopen

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-books-poll-v717-') as td:
 base=pathlib.Path(td);media=base/'media';original=make_fixture(media)
 proc=log=None
 try:
  proc,port,log=launch(ROOT/'dist/douyin.js',media,base/'home')
  origin=f'http://127.0.0.1:{port}'
  html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page();page.set_default_timeout(12000)
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    u=urllib.parse.urlsplit(route.request.url)
    if u.path.startswith('/api/'):
     req=urllib.request.Request(origin+u.path+('?' + u.query if u.query else ''),data=route.request.post_data_buffer if route.request.method=='POST' else None,method=route.request.method,headers={'Content-Type':route.request.headers.get('content-type','application/json')})
     try:
      with urllib.request.urlopen(req,timeout=30) as rsp:st=rsp.status;data=rsp.read();mime=rsp.headers.get('Content-Type','application/json')
     except urllib.error.HTTPError as e:st=e.code;data=e.read();mime=e.headers.get('Content-Type','application/json')
     route.fulfill(status=st,body=data,headers={'Content-Type':mime})
    else: route.fulfill(status=404,body='')
   page.route('http://justfun.test/**',proxy)
   page.set_content(html,wait_until='domcontentloaded',timeout=30000)
   page.wait_for_function('allItems.some(x=>x.kind===\'image\')',timeout=18000)
   page.evaluate('()=>document.querySelector(`[data-media-kind="books"]`).click()')
   page.wait_for_function('!jfBooksLoading',timeout=18000)
   outcome=page.evaluate('''async()=>{
    const old=window.fetch;let active=0,maxActive=0,total=0;
    window.fetch=async (...args)=>{
      if(!String(args[0]).startsWith('/api/books'))return old(...args);
      ++active;++total;maxActive=Math.max(maxActive,active);
      await new Promise(resolve=>setTimeout(resolve,190));
      --active;
      return new Response(JSON.stringify({ok:true,books:[],total:0,skipped:0,truncated:false}),{status:200,headers:{'Content-Type':'application/json'}});
    };
    try{
      // Repeated 20-second polls arriving before an earlier request finishes.
      await Promise.all(Array.from({length:14},()=>jfBooksLoad(false)));
      if(maxActive!==1||total!==1||jfBooksLoading)throw Error('Overlapping requests: '+JSON.stringify({maxActive,total}));
      // Explicit refresh while loading must be replayed exactly once.
      const first=jfBooksLoad(false);
      await new Promise(resolve=>setTimeout(resolve,35));
      await Promise.all([jfBooksLoad(true),jfBooksLoad(true),jfBooksLoad(false),first]);
      for(let i=0;i<50&&jfBooksLoading;i++)await new Promise(resolve=>setTimeout(resolve,20));
      if(maxActive!==1||total!==3||jfBooksLoading)throw Error('Explicit refresh lost/duplicated '+JSON.stringify({maxActive,total}));
      // A stale response cannot re-open Books after leaving it.
      const last=jfBooksLoad(false);
      await new Promise(resolve=>setTimeout(resolve,30));
      document.querySelector(`[data-media-kind="video"]`).click();
      await last;
      if(document.body.classList.contains('jfBooksMode')||!document.getElementById('jfBooksWorkspace').hidden)throw Error('Closed Books reappeared');
      return {maxActive,total,closed:!document.body.classList.contains('jfBooksMode')};
    }finally{window.fetch=old;}
   }''')
   assert outcome['maxActive']==1 and outcome['total']==4 and outcome['closed'],outcome
   assert not errors,errors
   print('PASS Book scan coalescing, force-refresh, stale-close handling',outcome,flush=True)
   browser.close()
  assert all(hashlib.sha256((media/name).read_bytes()).hexdigest()==v for name,v in original.items()), 'Media mutated'
 finally:stop(proc,log)
print('BOOKS POLL COALESCE V717 PASS',flush=True)
