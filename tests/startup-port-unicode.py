#!/usr/bin/env python3
"""v6.24 isolated UTF-8/GBK-style directory paths and localhost port fallback tests.
Never accepts real user paths; all media and metadata live in TemporaryDirectory.
"""
import json,os,pathlib,re,socket,subprocess,tempfile,time,urllib.request,pty,select
from isolated import ROOT,stop,urlopen

results=[]
def check(name,ok,info=''):
    results.append({'name':name,'pass':bool(ok),'detail':str(info)[:180]})
    print(('PASS' if ok else 'FAIL'),name,info,flush=True)
    if not ok:raise AssertionError(name+': '+str(info))
def post(port,route,data):
    import urllib.error
    req=urllib.request.Request(f'http://127.0.0.1:{port}{route}',data=json.dumps(data,ensure_ascii=False).encode('utf8'),headers={'Content-Type':'application/json; charset=utf-8'})
    try:
        with urllib.request.urlopen(req,timeout=8) as resp:return resp.status,json.load(resp)
    except urllib.error.HTTPError as ex:return ex.code,json.load(ex)
def read_data(port):
    return json.loads(urlopen(f'http://127.0.0.1:{port}/api/data',timeout=8)[2])
def wait_listen(proc,log,timeout=40):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if proc.poll() is not None:raise AssertionError('process exited: '+log.read_text(errors='replace')[-700:])
        txt=log.read_text(errors='replace')
        m=re.search(r'Just Fun 已启动：http://127\.0\.0\.1:(\d+)/',txt)
        if m:
            port=int(m.group(1))
            try:
                if urlopen(f'http://127.0.0.1:{port}/manifest.webmanifest',timeout=1)[0]==200:return port,txt
            except (OSError,TimeoutError):pass
        time.sleep(.12)
    raise AssertionError('timeout startup: '+log.read_text(errors='replace')[-800:])
def start(root,lib,home,port,flags=()):
    home.mkdir(parents=True,exist_ok=True)
    logpath=home/'run.log'
    log=open(logpath,'wb',buffering=0)
    env={**os.environ,'HOME':str(home),'USERPROFILE':str(home)}
    proc=subprocess.Popen(['node',str(ROOT/'dist/douyin.js'),f'--port={port}','--no-screenshot',*flags],stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,cwd=home,env=env)
    proc.stdin.write((str(lib)+'\n').encode('utf8'));proc.stdin.flush();proc.stdin.close()
    try:return proc,wait_listen(proc,logpath),log
    except:
        proc.terminate();proc.wait(timeout=5);log.close();raise

def main():
 with tempfile.TemporaryDirectory(prefix='jf-architecture-test-unicodeport-') as tmp:
    root=pathlib.Path(tmp);lib=root/'中文 学习资料・修行☸';lib.mkdir();(lib/'课程.txt').write_text('test')
    two=lib/'佛学'/'南怀瑾 讲座'/'第一章';two.mkdir(parents=True)
    (two/'第01讲.mp3').write_bytes(b'fake media: indexing only')
    orig=(two/'第01讲.mp3').read_bytes()
    blocker=socket.socket();blocker.bind(('127.0.0.1',0));blocker.listen()
    wanted=blocker.getsockname()[1]; p=l=None
    try:
        p,(port,txt),l=start(root,lib,root/'home1',wanted)
        check('Used a new local port when requested port occupied',port!=wanted and '端口' in txt and '被占用' in txt)
        check('Selected port responds to HTTP',urlopen(f'http://127.0.0.1:{port}/manifest.webmanifest')[0]==200)
        check('Successful listener opens URL only once',txt.count('Just Fun 已启动：')==1)
        check('Requested occupied port remains owned by other service',blocker.getsockname()[1]==wanted)
        check('Listener source stays loopback-only',"const HOST = '127.0.0.1';" in (ROOT/'src/server/00-bootstrap.js').read_text())
        deadline=time.monotonic()+25
        while time.monotonic()<deadline:
            data=read_data(port)
            if any(x.get('originalName')=='第01讲.mp3' for x in data.get('items',[])):break
            time.sleep(.2)
        check('Chinese startup path scans deep source media',any(x.get('originalName')=='第01讲.mp3' for x in data.get('items',[])))
        check('Chinese nested folder levels retained',all(any(f.get('relativeDir')==r for f in data.get('folders',[])) for r in ['source/佛学','source/佛学/南怀瑾 讲座','source/佛学/南怀瑾 讲座/第一章']))
        check('Unrelated documents excluded',not any(x.get('originalName')=='课程.txt' for x in data.get('items',[])))
        code,created=post(port,'/api/folder-create',{'parent':'data','name':'中文目录 甲・序章'})
        check('Create Chinese named managed folder',code==200 and created.get('originalName')=='中文目录 甲・序章',created)
        r=created.get('relativeDir');code,renamed=post(port,'/api/folder-rename',{'relativeDir':r,'name':'佛学学习 第②章'})
        check('Rename Chinese folder',code==200 and renamed.get('originalName')=='佛学学习 第②章',renamed)
        check('No work-study original file changed',(two/'第01讲.mp3').read_bytes()==orig)
        real=pathlib.Path(lib/'data'/'佛学学习 第②章')
        check('No-Hash disk folder keeps Unicode',real.is_dir())
    finally:
        if p:stop(p,l)
        blocker.close()
    # Persist after restart, with explicit port and Chinese path unchanged.
    result=subprocess.run(['node',str(ROOT/'dist/douyin.js'),'--port=-1'],input=(str(lib)+'\n').encode(),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=10)
    check('Invalid port rejected clearly',result.returncode==2 and '端口号必须'.encode() in result.stdout)
    # With two consecutively occupied ports, move on without affecting either listener.
    first=second=None
    for _ in range(50):
        a=socket.socket();a.bind(('127.0.0.1',0));n=a.getsockname()[1]
        try:
            b=socket.socket();b.bind(('127.0.0.1',n+1));a.listen();b.listen();first,second=a,b;break
        except (OSError, OverflowError):
            a.close();b.close()
    if first:
        p=l=None
        try:
            p,(selected,txt),l=start(root,lib,root/'home-consecutive',n)
            check('Skip two occupied ports',selected not in (n,n+1),str(selected))
            check('Conflict messages name both ports',f'端口 {n} 被占用' in txt and f'端口 {n+1} 被占用' in txt)
            check('Next free port actually serves pages',urlopen(f'http://127.0.0.1:{selected}/manifest.webmanifest')[0]==200)
        finally:
            if p:stop(p,l)
            first.close();second.close()
    # When no higher numeric port exists, use the OS ephemeral allocator.
    top=socket.socket()
    try:
        top.bind(('127.0.0.1',65535));top.listen()
    except OSError:
        top.close()
    else:
        p=l=None
        try:
            p,(selected,txt),l=start(root,lib,root/'home-topport',65535)
            check('Maximum occupied port falls back to OS chosen port',selected!=65535 and selected>0)
            check('OS fallback serves real HTTP',urlopen(f'http://127.0.0.1:{selected}/manifest.webmanifest')[0]==200)
        finally:
            if p:stop(p,l)
            top.close()
    # Hash library must preserve real Chinese names in metadata, not force ASCII.
    hashed=root/'中文纯媒体库';hashed.mkdir();(hashed/'课件.mp3').write_bytes(b'file')
    p=l=None
    try:
        p,(port,_),l=start(root,hashed,root/'home-hash',wanted,flags=('--hash',))
        code,r=post(port,'/api/folder-create',{'parent':'data','name':'佛学・中观研究'})
        check('Hash mode accepts Chinese directory name',code==200 and r.get('originalName')=='佛学・中观研究',r)
        code,z=post(port,'/api/folder-rename',{'relativeDir':r['relativeDir'],'name':'禅宗课程合集'})
        check('Hash mode renames Chinese display name',code==200 and z.get('originalName')=='禅宗课程合集',z)
        check('Hash mode keeps physical folder anonymous',bool(re.fullmatch('data/[a-f0-9]{32}',r['relativeDir'])))
        check('Hash folder Unicode persists in API',any(f.get('originalName')=='禅宗课程合集' for f in read_data(port)['folders']))
    finally:
        if p:stop(p,l)
    # PTY test proves Chinese characters appear through the native terminal line editor.
    if os.name!='nt':
        testlib=root/'终端中文 粘贴 例子';testlib.mkdir()
        master,slave=pty.openpty();home=root/'home-pty';home.mkdir()
        log=open(home/'run.log','wb',buffering=0)
        env={**os.environ,'HOME':str(home),'USERPROFILE':str(home)}
        process=subprocess.Popen(['node',str(ROOT/'dist/douyin.js'),'--no-screenshot','--port='+str(wanted)],stdin=slave,stdout=log,stderr=subprocess.STDOUT,cwd=home,env=env)
        os.close(slave)
        try:
            deadline=time.monotonic()+12
            while time.monotonic()<deadline:
                if '请输入媒体目录' in (home/'run.log').read_text(errors='replace'):break
                time.sleep(.1)
            os.write(master,(str(testlib)+'\n').encode('utf8'))
            terminal=b'';deadline=time.monotonic()+3
            while time.monotonic()<deadline:
                ready,_,_=select.select([master],[],[],.2)
                if ready:
                    try:terminal+=os.read(master,4096)
                    except OSError:break
                if 'Just Fun 已启动' in (home/'run.log').read_text(errors='replace'):break
            port,txt=wait_listen(process,home/'run.log',timeout=20)
            check('Chinese paste appears in native terminal',str(testlib).encode('utf8') in terminal,repr(terminal[:220]))
            check('Chinese TTY path starts service',urlopen(f'http://127.0.0.1:{port}/manifest.webmanifest')[0]==200)
        finally:
            process.terminate();process.wait(timeout=5);log.close();os.close(master)
    report={'passed':sum(x['pass'] for x in results),'total':len(results),'tests':results}
    (ROOT/'dist/startup-port-unicode-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('UNICODE PORT',report['passed'],'/',report['total'])

if __name__=='__main__':main()
