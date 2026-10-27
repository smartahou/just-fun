#!/usr/bin/env python3
"""Isolated work/study tree and compatibility conversion regression.
Never accepts a user path: all source material is manufactured in tempfile.
"""
import hashlib,json,os,pathlib,subprocess,tempfile,time,urllib.request
from isolated import ROOT, launch,stop, urlopen

CHECKS=[]
def check(label,condition,detail=''):
    CHECKS.append({'name':label,'pass':bool(condition),'detail':detail})
    print(('PASS' if condition else 'FAIL'),label,detail,flush=True)
    if not condition: raise AssertionError(label+': '+detail)
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def post(port,route,data):
    req=urllib.request.Request(f'http://127.0.0.1:{port}{route}',data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
    return urlopen(req.full_url,headers={'Content-Type':'application/json'},timeout=40,method='POST') if False else request_post(req)
def request_post(req):
    import urllib.error
    try:
        with urllib.request.urlopen(req,timeout=50) as r:return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
def wait(port,at_least):
    deadline=time.monotonic()+40
    while time.monotonic()<deadline:
        st,_,b=urlopen(f'http://127.0.0.1:{port}/api/data',timeout=4)
        if st==200:
            data=json.loads(b)
            if data.get('scanStatus')=='ready' and len(data.get('items',[]))>=at_least:return data
        time.sleep(.35)
    raise TimeoutError('Source scan never completed')
def ff(out,**kwargs):
    subprocess.run(out,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=35)
def movie(p,codec,container):
    ff(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=12:duration=2',
      '-an','-c:v',codec,*(['-pix_fmt','yuv420p'] if codec=='libx264' else []),str(p)])
def main():
  with tempfile.TemporaryDirectory(prefix='jf-architecture-test-workspace-') as tmp:
    home=pathlib.Path(tmp)
    lib=home/'工作学习资料';lecture=lib/'佛学'/'南怀瑾'/'讲座';music=lib/'佛学'/'南怀瑾'/'录音';photos=lib/'佛学'/'南怀瑾'/'照片'
    for folder in [lecture,music,photos,lib/'无媒体文档'] : folder.mkdir(parents=True,exist_ok=True)
    original_video=lecture/'第01讲 H264.mkv';movie(original_video,'libx264','mkv')
    root_video=lib/'根目录.mp4';movie(root_video,'libx264','mp4')
    old_video=lecture/'第02讲 旧编码.avi';movie(old_video,'mpeg4','avi')
    audio=music/'第01讲.mp3'
    ff(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=360:duration=2','-c:a','libmp3lame',str(audio)])
    image=photos/'佛学图片.png'
    ff(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:size=64x64:duration=0.1','-frames:v','1',str(image)])
    archive=lecture/'讲座文档.tar.gz';archive.write_bytes(b'non media - do not touch')
    note=lib/'无媒体文档'/'作业.docx';note.write_bytes(b'document')
    try:(lecture/'symlink-escape.mkv').symlink_to(original_video)
    except (OSError,NotImplementedError):pass
    physical=[p for p in lib.rglob('*') if p.is_file() and not p.is_symlink()]
    originals={str(p.relative_to(lib)):sha(p) for p in physical}
    server=log=None
    try:
      server,port,log=launch(ROOT/'dist/douyin.js',lib,home/'fixture-home')
      data=wait(port,5)
      items=data['items'];byname={x['originalName']:x for x in items}
      check('Deep media recognized',all(n in byname for n in ['第01讲 H264.mkv','第02讲 旧编码.avi','第01讲.mp3','佛学图片.png','根目录.mp4']))
      check('Non-media ignored',all(n not in byname for n in ['讲座文档.tar.gz','作业.docx','symlink-escape.mkv']))
      check('Accurate video/audio/image classification',{x['kind'] for x in items}=={'video','audio','image'})
      check('Deep folder hierarchy indexed',all(z in [x['relativeDir'] for x in data['folders']] for z in ['source','source/佛学','source/佛学/南怀瑾','source/佛学/南怀瑾/讲座','source/佛学/南怀瑾/录音']))
      check('Workspace entries read-only',all(x['readOnly'] for x in items))
      check('Mixed-workspace root video never renamed',byname['根目录.mp4']['relativeDir']=='' and byname['根目录.mp4']['readOnly'] and root_video.exists())
      check('No source file changed by initial scan',all(sha(lib/p)==h for p,h in originals.items()))
      source=byname['第01讲 H264.mkv']; old=byname['第02讲 旧编码.avi']
      compat=json.loads(urlopen(f'http://127.0.0.1:{port}/api/video-compat?key={source["key"]}')[2])
      check('H264 MKV recommends lossless remux',compat['suggest']=='copy' and compat['videoCodec']=='h264')
      compat2=json.loads(urlopen(f'http://127.0.0.1:{port}/api/video-compat?key={old["key"]}')[2])
      check('Legacy MPEG4 codec recommends re-encode',compat2['suggest']=='encode')
      for route,payload in [('/api/media-move',{'keys':[source['key']],'target':'data'}),('/api/media-rename',{'key':source['key'],'name':'changed'}),
                            ('/api/folder-rename',{'relativeDir':'source/佛学','name':'changed'})]:
          status,response=post(port,route,payload)
          check('Source rename/move still blocked '+route,status==403 and response['ok'] is False)
      st,r=post(port,'/api/video-transcode',{'key':source['key'],'mode':'auto','jobId':'a'*32})
      check('Stream copy successful',st==200 and r.get('method')=='copy',str(r.get('error','')))
      st2,r2=post(port,'/api/video-transcode',{'key':old['key'],'mode':'auto','jobId':'b'*32})
      check('Re-encode successful',st2==200 and r2.get('method')=='encode',str(r2.get('error','')))
      data=wait(port,7)
      check('Two copies in managed data directory',sum(x.get('relativeDir')=='data' for x in data['items'])==2)
      for record in [r,r2]:
          output=record['item'];status,_,buf=urlopen(f'http://127.0.0.1:{port}{output["mediaUrl"]}',headers={'Range':'bytes=0-127'})
          check('Generated MP4 supports HTTP Range',status==206 and len(buf)==128)
      for id in ['a'*32,'b'*32]:
          progress=json.loads(urlopen(f'http://127.0.0.1:{port}/api/media-progress?id={id}')[2])
          check('Progress job finished '+id[0],progress['status']=='done' and progress['percent']==100)
      check('Media sources AND documents unchanged after conversions',all(sha(lib/p)==h for p,h in originals.items()))
      check('Non-media documents still on disk',archive.read_bytes()==b'non media - do not touch' and note.read_bytes()==b'document')
    finally:stop(server,log)
    # Hash+password is an explicit user choice, not an inferred "work" directory.
    # Only test startup in disposable isolated fixtures; three failures still erase.
    mixed=home/'测试混合目录';(mixed/'学习').mkdir(parents=True)
    doc=mixed/'学习'/'普通书籍.txt';doc.write_text('供自己阅读的书籍',encoding='utf8')
    unrelated=mixed/'学习'/'任意文件.docx';unrelated.write_bytes(b'test-only document')
    doc_hash=sha(doc);other_hash=sha(unrelated)
    p_mix=l_mix=None
    try:
      p_mix,pmix,l_mix=launch(ROOT/'dist/douyin.js',mixed,home/'mixed-auth-home',flags=('--hash','--pwd'),password='testpass')
      check('Opt-in Hash+password permits nested books and other documents',p_mix.poll() is None)
      check('Opt-in startup leaves unrelated files unchanged',sha(unrelated)==other_hash)
      books=json.loads(urlopen(f'http://127.0.0.1:{pmix}/api/books')[2])
      check('Nested TXT books remain discoverable in Hash+password mode',bool(books.get('books')))
    finally:stop(p_mix,l_mix)

    # Browser-level navigation and context action: fresh fixture, same temp only.
    try:
      from playwright.sync_api import sync_playwright
      proc,l=None,None
      proc,port,l=launch(ROOT/'dist/douyin.js',lib,home/'fixture-home2')
      wait(port,7)
      with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1366,'height':850})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        payload=wait(port,7)
        html=urlopen(f'http://127.0.0.1:{port}/')[2].decode()
        page.evaluate('''(payload)=>{
          window.fetch=async()=>({ok:true,status:200,json:async()=>payload,text:async()=>JSON.stringify(payload)});
        }''',payload)
        page.set_content(html,wait_until='load',timeout=15000)
        page.wait_for_selector('#folderTiles [data-open-folder="source"]',timeout=15000)
        check('Workspace folder reachable from root',page.locator('[data-open-folder="source"]').count()>0)
        for pathvalue in ['source','source/佛学','source/佛学/南怀瑾','source/佛学/南怀瑾/讲座']:
          page.locator('#folderTiles [data-open-folder="'+pathvalue+'"]').first.click()
          page.wait_for_timeout(100)
        check('Video cards in deep directory',page.locator('#grid [data-media-key]').count()>=2)
        btn=page.locator('#grid [data-media-more]').first;btn.click()
        check('Video compatibility menu visible',page.get_by_text('兼容性检测 / 转码').count()>0)
        check('Source delete action available',page.locator('#unifiedContext [data-context-action="delete"]').count()==1)
        page.set_viewport_size({'width':900,'height':1460});page.screenshot(path=str(ROOT/'dist/browser-shots/workspace-portrait.png'))
        check('No browser errors',not errors,str(errors))
        browser.close()
    finally:stop(proc,l)
  result={'total':len(CHECKS),'passed':sum(c['pass'] for c in CHECKS),'checks':CHECKS}
  (ROOT/'dist/workspace-test-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
  print('WORKSPACE TESTS',result['passed'],'/',result['total'])
if __name__=='__main__':
  main()
