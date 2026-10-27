#!/usr/bin/env python3
"""Offline isolated API, startup and data-compatibility regression tests.
Never accepts user library paths: test libraries always created in a fresh temp dir.
Uses only the Python standard library and locally installed Node/FFmpeg.
"""
import base64, copy, hashlib, json, os, pathlib, shutil, socket, subprocess, sys, tempfile, time, urllib.error, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
BUILD=ROOT/'dist/douyin.js'
BASE=ROOT/'tests/reference/v6.21.douyin.js'
TIMEOUT=55
RESULTS=[]
def record(name,passed,detail=''):
    RESULTS.append(dict(test=name,result='PASS' if passed else 'FAIL',detail=detail))
    print(('PASS' if passed else 'FAIL'),name,detail,flush=True)
    if not passed: raise AssertionError(name+' '+detail)
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def free_port():
    s=socket.socket();s.bind(('127.0.0.1',0)); port=s.getsockname()[1];s.close();return port
def urlopen(url,headers=None,timeout=5,method='GET'):
    req=urllib.request.Request(url,headers=headers or {},method=method)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:return r.status,dict(r.headers),r.read()
    except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read()
def make_fixture(path):
    assert 'jf-architecture-test-' in str(path),str(path)
    path.mkdir(parents=True)
    sub=path/'中文 素材';sub.mkdir(exist_ok=True)
    files=[
      ['ffmpeg','-loglevel','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=160x284:rate=8:duration=3','-an','-c:v','mpeg4','-q:v','5',str(path/'测试视频 1.mp4')],
      ['ffmpeg','-loglevel','error','-nostdin','-y','-f','lavfi','-i','sine=frequency=440:duration=4','-c:a','libmp3lame','-q:a','4',str(path/'测试音频 2.mp3')],
      ['ffmpeg','-loglevel','error','-nostdin','-y','-f','lavfi','-i','color=c=royalblue:s=320x240:d=0.1','-frames:v','1',str(path/'测试图片 3.png')]
    ]
    for args in files:subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True,timeout=20)
    return {str(p.relative_to(path)):sha(p) for p in path.rglob('*') if p.is_file()}
def launch(script,lib,home,flags=(),password=None):
    assert 'jf-architecture-test-' in str(lib), str(lib)
    home.mkdir(parents=True,exist_ok=True)
    port=free_port(); log=open(home/'server.log','ab',buffering=0)
    env=dict(os.environ,HOME=str(home),USERPROFILE=str(home))
    cmd=['node',str(script),'--port='+str(port),'--no-screenshot',*flags]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,env=env,cwd=str(home),start_new_session=True)
    data=str(lib)+'\n';
    if password is not None: data+=password+'\n'+password+'\n'
    try:
        proc.stdin.write(data.encode());proc.stdin.flush();proc.stdin.close()
    except BrokenPipeError:pass
    deadline=time.monotonic()+TIMEOUT
    while time.monotonic()<deadline:
        if proc.poll() is not None:
            txt=(home/'server.log').read_text(errors='replace')
            raise RuntimeError('Server exited early: '+txt[-1200:])
        try:
            st,headers,body=urlopen('http://127.0.0.1:'+str(port)+'/manifest.webmanifest',timeout=1)
            if st==200: return proc,port,log
        except Exception:pass
        time.sleep(.2)
    raise TimeoutError('Startup exceeded '+str(TIMEOUT)+'s: '+(home/'server.log').read_text(errors='replace')[-1000:])
def stop(proc,log):
    if proc is None:return
    proc.terminate()
    try:proc.wait(timeout=4)
    except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=3)
    log.close()
def media_entries(payload):
    if isinstance(payload,list): return payload
    if not isinstance(payload,dict):return []
    for k in ['items','media','videos','data','files']:
        v=payload.get(k)
        if isinstance(v,list):return v
        if isinstance(v,dict):
            for key in ['items','media']:
                if isinstance(v.get(key),list):return v[key]
    return []
def api_wait(port):
    deadline=time.monotonic()+35;last={}
    while time.monotonic()<deadline:
        st,head,body=urlopen('http://127.0.0.1:'+str(port)+'/api/data',timeout=5)
        if st==200:
            try:
                last=json.loads(body)
                if len(media_entries(last))>=3:return last
            except json.JSONDecodeError:pass
        time.sleep(.5)
    raise AssertionError('Expected three scanned entries, got '+str(list(last.keys()) if isinstance(last,dict) else last)[:300])
def run():
    subprocess.run(['node',str(ROOT/'scripts/build.js')],stdout=subprocess.DEVNULL,check=True)
    record('Offline build + browser JS syntax', BUILD.is_file())
    assert BASE.is_file(),'Missing bundled v6.21 reference'
    build_report=json.loads((ROOT/'dist/build-report.json').read_text())
    record('Intentional v6.22 HTML update is built',not build_report['baselinePageIdentical'] and build_report['htmlBytes']>0)
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-') as temp:
      temp=pathlib.Path(temp)
      old_lib=temp/'old';new_lib=temp/'new'
      orig=make_fixture(old_lib);make_fixture(new_lib)
      old_home=temp/'oldhome'; new_home=temp/'newhome'
      po=pn=None;lo=ln=None
      try:
        po,p_old,lo=launch(BASE,old_lib,old_home)
        pn,p_new,ln=launch(BUILD,new_lib,new_home)
        old=api_wait(p_old);new=api_wait(p_new)
        def shape(x):
          items=media_entries(x)
          return sorted((v.get('kind'),v.get('originalName'),v.get('originalExt')) for v in items)
        record('Before/after library scan behavior',shape(old)==shape(new),str(shape(new)))
        manifest_old=urlopen('http://127.0.0.1:'+str(p_old)+'/manifest.webmanifest')
        manifest_new=urlopen('http://127.0.0.1:'+str(p_new)+'/manifest.webmanifest')
        record('Manifest endpoint parity',manifest_old[2]==manifest_new[2])
        favicon_old=urlopen('http://127.0.0.1:'+str(p_old)+'/favicon.ico')
        favicon_new=urlopen('http://127.0.0.1:'+str(p_new)+'/favicon.ico')
        record('Favicon byte-for-byte parity',favicon_old[2]==favicon_new[2] and favicon_new[0]==200)
        page_old=urlopen('http://127.0.0.1:'+str(p_old)+'/')
        page_new=urlopen('http://127.0.0.1:'+str(p_new)+'/')
        record('Served HTML contains updated splash and first-frame preview',page_old[2]!=page_new[2] and b'jfAppSplash' in page_new[2] and b'jfPreviewVisible' in page_new[2],f'{len(page_new[2])} bytes')
        record('Default mode keeps real filenames',all((old_lib/n).is_file() and (new_lib/n).is_file() for n in orig))
        old_cfg=json.loads((old_lib/'.douyin-nav-cache/library-settings.json').read_text())
        new_cfg=json.loads((new_lib/'.douyin-nav-cache/library-settings.json').read_text())
        record('Default hash/pwd settings parity',old_cfg['hashEnabled']==new_cfg['hashEnabled']==False and old_cfg['passwordEnabled']==new_cfg['passwordEnabled']==False)
        record('Original media content untouched',all(sha(old_lib/n)==orig[n] and sha(new_lib/n)==orig[n] for n in orig))
        # Validate HTTP Range over the real video endpoints
        video=[x for x in media_entries(new) if x.get('kind')=='video'][0]
        video_keys=[video.get(k) for k in ['url','mediaUrl','src','streamUrl'] if isinstance(video.get(k),str)]
        if video_keys:
            u=video_keys[0]; u=u if u.startswith('http') else 'http://127.0.0.1:'+str(p_new)+u
            st,headers,body=urlopen(u,{'Range':'bytes=0-31'})
            record('HTTP Range 206',st==206 and len(body)==32)
        else:
            record('Media URL shape available',False,str(video.keys()))
      finally:
        stop(po,lo);stop(pn,ln)
      # Startup behavior: flags are first-initialization-only.
      p=lg=None
      try:
        p,_,lg=launch(BUILD,new_lib,new_home,flags=('--hash','--pwd'))
        cfg=json.loads((new_lib/'.douyin-nav-cache/library-settings.json').read_text())
        record('Existing library ignores new CLI switches',not cfg['hashEnabled'] and not cfg['passwordEnabled'])
      finally:stop(p,lg)
      for flags,expected in [([], (False,False)),(['--hash'],(True,False)),(['--pwd'],(False,True)),(['--hash','--pwd'],(True,True))]:
        name='new-mode-'+''.join(x.strip('-') for x in flags) if flags else 'new-mode-none'
        lib=temp/name; make_fixture(lib);home=temp/(name+'home');p=lg=None
        try:
            p,port,lg=launch(BUILD,lib,home,flags=flags,password='correcttest' if '--pwd' in flags else None)
            cfg=json.loads((lib/'.douyin-nav-cache/library-settings.json').read_text())
            record('Initialize '+('/'.join(flags) or 'no flags'),(cfg['hashEnabled'],cfg['passwordEnabled'])==expected)
            api_wait(port)
            physical=list(lib.glob('*.mp4'))
            if '--hash' in flags:
                # file renamed; original names preserved by indexed metadata
                record('Hash renamed original filename',not (lib/'测试视频 1.mp4').exists() or any('managed' in x.name for x in physical))
            else:
                record('Non-Hash keeps original media names', (lib/'测试视频 1.mp4').exists())
        finally:stop(p,lg)
      # Built artifact must run when physically moved away from source project.
      stand=temp/'standalone';stand.mkdir();shutil.copyfile(BUILD,stand/'douyin.js')
      lib=temp/'independent-lib';make_fixture(lib);p=lg=None
      try:
        p,port,lg=launch(stand/'douyin.js',lib,temp/'independent-home')
        record('Detached single-file startup',len(media_entries(api_wait(port)))>=3)
      finally:stop(p,lg)
    return RESULTS
if __name__=='__main__':
    try:
        tests=run()
        report={'passed':sum(x['result']=='PASS' for x in tests),'total':len(tests),'tests':tests}
        (ROOT/'dist'/'api-test-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print('RESULT',report['passed'],'/',report['total'])
    except Exception as e:
        print('FAILED:',repr(e),file=sys.stderr)
        sys.exit(1)
