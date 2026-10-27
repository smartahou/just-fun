#!/usr/bin/env python3
"""v6.99: real TXT smart visual reflow + source-preserving reading API."""
import pathlib,tempfile,hashlib,urllib.request,urllib.parse,urllib.error,json
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen
count=0

def ck(name,ok):
 global count
 assert ok,name
 count+=1;print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v699-') as folder:
 root=pathlib.Path(folder);lib=root/'books';lib.mkdir()
 a='夜色逐渐覆盖了这座城市，街道上的行人依旧匆匆忙忙地走着，没有人注意到远方的天空中出现了一道微弱的光芒'
 b='那道光沿着地平线缓缓移动，最终消失在山脊之后，仿佛从未出现过一样，只留下一丝几乎无法察觉的余晖'
 fixture=a+'\n'+b+'\n\n　　第二段开始，保留作者自己的缩进。\n这句话没有完成，\n下句应该接在后面。\n\n第三章 新的旅程\n这是新章的第一行。'
 p=lib/'长行断开的书.txt';p.write_text(fixture,encoding='utf-8');original=hashlib.sha256(p.read_bytes()).hexdigest()
 proc=lg=None
 try:
  proc,port,lg=launch(ROOT/'dist/douyin.js',lib,root/'home');origin=f'http://127.0.0.1:{port}'
  status,_,data=urlopen(origin+'/api/books?refresh=1');books=json.loads(data)['books']; ck('Bookshelf finds source TXT',status==200 and len(books)==1)
  bid=books[0]['id'];status,_,data=urlopen(origin+f'/api/reading/chapter?id={bid}&chapter=0');raw=json.loads(data)['text']
  ck('Raw chapter API retains exact original newline bytes',raw==fixture)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1320,'height':900});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def proxy(route):
    req=route.request;url=urllib.parse.urlsplit(req.url)
    body=req.post_data_buffer if req.method=='POST' else None
    hdr={'Content-Type':'application/json'} if body else {}
    r=urllib.request.Request(origin+url.path+('?' +url.query if url.query else ''),data=body,headers=hdr,method=req.method)
    try:
     with urllib.request.urlopen(r,timeout=18) as res:status=res.status;raw_data=res.read();mime=res.headers.get('Content-Type','application/octet-stream')
    except urllib.error.HTTPError as e:status=e.code;raw_data=e.read();mime=e.headers.get('Content-Type','application/json')
    route.fulfill(status=status,body=raw_data,headers={'Content-Type':mime})
   page.route('http://justfun.test/**',proxy)
   html=urlopen(origin+'/')[2].decode().replace('<head>','<head><base href="http://justfun.test/">',1)
   page.set_content(html,wait_until='domcontentloaded',timeout=25000)
   page.evaluate('(id)=>jfDeskOpenReader(id,0)',bid)
   page.wait_for_function('jfDeskBook&&jfReadText.textContent.includes("夜色")',timeout=15000)
   displayed=page.locator('#jfReadText').inner_text()
   ck('False hard newline becomes normal paragraph flow',a+b in displayed)
   ck('Blank line remains explicit paragraph boundary',b+'\n\n　　第二段' in displayed)
   ck('Short trailing comma line merges into continuation','这句话没有完成，下句应该接在后面。' in displayed)
   ck('Chapter heading keeps a hard break','第三章 新的旅程\n这是' in displayed)
   ck('Raw source remains in memory for legacy quote mapping',page.evaluate('jfReadRawText')==fixture)
   ck('Original raw index maps to reflowed display index',page.evaluate('(s)=>jfReadRawToDisplay[s]===jfReadText.textContent.indexOf("那道光")',len(a)+1))
   sample=page.evaluate('''()=>({poem:jfTxtSmartReflow('春眠不觉晓，\\n处处闻啼鸟。\\n夜来风雨声，\\n花落知多少。').text,
       prose:jfTxtSmartReflow('第一句结束。\\n第二句也结束。').text,
       indent:jfTxtSmartReflow('段内长句未完成，\\n　　这是新自然段。').text,
       latin:jfTxtSmartReflow('hello\\nworld').text})''')
   ck('Short poem lines stay separate',sample['poem'].count('\n')==3)
   ck('Independent complete short sentences stay separate',sample['prose']=='第一句结束。\n第二句也结束。')
   ck('Indented paragraph starts remain distinct',sample['indent'].count('\n')==1)
   ck('English hard wraps avoid accidental word concatenation',sample['latin']=='hello world')
   # Existing excerpt paragraph anchor offsets should map to displayed offsets.
   off=fixture.index(b)
   actual=page.evaluate('(i)=>jfReadRawToDisplay[i]',off)
   ck('Legacy anchor maps to reflowed text position',displayed[actual:actual+3]==b[:3])
   ck('No unhandled browser exceptions',not errors)
   browser.close()
  ck('TXT source on disk unchanged',hashlib.sha256(p.read_bytes()).hexdigest()==original)
 finally:
  if proc:stop(proc,lg)
print(f'v6.99 TXT smart-wrap PASS {count}/{count}',flush=True)
