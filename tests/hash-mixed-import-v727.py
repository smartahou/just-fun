#!/usr/bin/env python3
"""Regress explicit Hash imports in mixed workspaces, isolated from user data."""
from pathlib import Path
import hashlib,json,re,subprocess,sys,tempfile,time
from isolated import ROOT,launch,stop,urlopen

NEW=ROOT/'dist/douyin.js'
SHA=re.compile(r'^[a-f0-9]{32}$')
checks=0

def check(title,ok):
    global checks
    assert ok,title
    checks+=1
    print('PASS',title,flush=True)

def video(path):
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi',
       '-i','color=c=blue:s=64x64:r=2:d=1','-c:v','mpeg4',str(path)],
       check=True,capture_output=True,timeout=20)

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def ready(port,count):
    for _ in range(100):
        st,headers,body=urlopen(f'http://127.0.0.1:{port}/api/data',timeout=5)
        data=json.loads(body)
        if st==200 and data.get('scanStatus')=='ready' and len(data.get('items',[]))>=count:return data
        time.sleep(.2)
    raise AssertionError('Scan did not finish')

def start(script,lib,home,flags=(),count=1,password=None):
    proc=log=None
    try:
        proc,port,log=launch(script,lib,home,flags=flags,password=password)
        return proc,log,port,ready(port,count)
    except:
        stop(proc,log);raise

def managed(lib):return [x for x in lib.iterdir() if x.is_file() and SHA.fullmatch(x.name)]

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-hash-mixed-v727-') as td:
    base=Path(td)
    # A. Fresh mixed library, explicit opt-in Hash, root media plus nested source.
    lib=base/'mixed';lib.mkdir()
    docs=lib/'学习资料';docs.mkdir();doc=docs/'原始文档.docx';doc.write_bytes(b'private study document')
    nested=docs/'nested.mp4';video(nested);nested_sha=sha(nested)
    original=lib/'fresh.mp4';video(original);original_sha=sha(original)
    proc,log,port,data=start(NEW,lib,base/'home-a',('--hash',),2)
    try:
        cfg=json.loads((lib/'.douyin-nav-cache/library-settings.json').read_text())
        check('Persisted Hash opt-in',cfg['hashEnabled'] is True)
        check('Mixed root imported under anonymous managed name',len(managed(lib))==1 and not original.exists())
        check('Hashed bytes unchanged',sha(managed(lib)[0])==original_sha)
        byname={x['originalName']:x for x in data['items']}
        check('Root media retains friendly original name',byname['fresh.mp4']['relativeDir']=='')
        check('New Hash media is managed, not read-only',byname['fresh.mp4'].get('readOnly') is not True)
        check('Nested media shares the library Hash rule',byname['nested.mp4'].get('readOnly') is not True and not nested.exists() and len(managed(docs))==1 and sha(managed(docs)[0])==nested_sha)
        check('Document and nested media bytes unchanged',doc.read_bytes()==b'private study document' and sha(managed(docs)[0])==nested_sha)
        # Live fs.watch/safety rescan while the application remains running.
        live=lib/'live-added.mp4';video(live);live_sha=sha(live)
        for _ in range(100):
            st,headers,payload=urlopen(f'http://127.0.0.1:{port}/api/data',timeout=5)
            live_data=json.loads(payload)
            if any(x['originalName']=='live-added.mp4' for x in live_data['items']):break
            time.sleep(.2)
        check('Live folder watcher hashes newly added video',not live.exists() and any(sha(x)==live_sha for x in managed(lib)))
        check('Live import preserves original display name',any(x['originalName']=='live-added.mp4' for x in live_data['items']))
    finally:stop(proc,log)
    # A new video added after first run must also be hashed at next scan/start.
    second=lib/'second.mp4';video(second);second_hash=sha(second)
    proc,log,port,data=start(NEW,lib,base/'home-a',count=4)
    try:
        check('Restart continues explicit Hash mode',len(managed(lib))==3 and not second.exists())
        check('Newly added video exact content preserved',second_hash in [sha(x) for x in managed(lib)])
        check('No duplicate catalogue entries on next scan',len([x for x in data['items'] if x['originalName']=='fresh.mp4'])==1)
    finally:stop(proc,log)
    # B. Old v7.26 original-name imports now adopt Hash safely with stable keys.
    legacy=base/'legacy';legacy.mkdir(); (legacy/'documents').mkdir()
    (legacy/'documents'/'study.txt').write_text('keep it',encoding='utf8')
    previous=legacy/'old-original.mp4';video(previous);old_sha=sha(previous)
    # Initialize a genuine opt-in Hash library first; then emulate a valid
    # v7.26 mixed-workspace catalogue entry for an original-name root file.
    previous.unlink()
    proc,log,port,data=start(NEW,legacy,base/'home-legacy',('--hash',),count=0)
    try:
        check('New Hash library starts with empty catalogue',not data['items'])
    finally:stop(proc,log)
    video(previous)
    old_sha=sha(previous)
    stat=previous.stat()
    previous_key=hashlib.sha1(('root/'+previous.name).encode()).hexdigest()[:16]
    cache=legacy/'.douyin-nav-cache'
    catalogue=json.loads((cache/'data.json').read_text())
    catalogue['items'].append({
        'key':previous_key,'managedName':previous.name,'originalName':previous.name,
        'originalExt':'.mp4','relativeDir':'','kind':'video','readOnly':True,
        'mime':'video/mp4','creator':'','title':'old-original','rating':0,
        'fingerprint':f'{stat.st_size}-{int(stat.st_mtime_ns / 1000000)}',
        'size':stat.st_size,'modifiedTimeMs':stat.st_mtime_ns/1000000,
        'state':'ready'})
    (cache/'data.json').write_text(json.dumps(catalogue,ensure_ascii=False,indent=2))
    check('Valid v7.26-style original-name record prepared',previous.exists() and len(catalogue['items'])==1)
    newcomer=legacy/'newly-arrived.mp4';video(newcomer);new_sha=sha(newcomer)
    proc,log,port,data=start(NEW,legacy,base/'home-legacy',count=2)
    try:
        byname={x['originalName']:x for x in data['items']}
        for _ in range(100):
            if not previous.exists() and len(managed(legacy))==2:break
            time.sleep(.2)
        check('Legacy original name converted to Hash',not previous.exists() and any(sha(x)==old_sha for x in managed(legacy)))
        check('Legacy catalogue key preserved',byname['old-original.mp4']['key']==previous_key)
        check('Both old and new media hashed',not newcomer.exists() and len(managed(legacy))==2 and any(sha(x)==new_sha for x in managed(legacy)))
        check('No duplicated original catalogue entry',len(data['items'])==2)
        check('Legacy document intact',(legacy/'documents'/'study.txt').read_text()=='keep it')
    finally:stop(proc,log)
    # C. Pure media Hash behavior unchanged when a study folder appears later.
    pure=base/'former-pure';pure.mkdir();first=pure/'previous.mp4';video(first);first_sha=sha(first)
    proc,log,port,data=start(NEW,pure,base/'home-pure',('--hash',))
    try:check('Pure Hash imports media',len(managed(pure))==1 and sha(managed(pure)[0])==first_sha)
    finally:stop(proc,log)
    (pure/'study').mkdir();(pure/'study'/'essay.md').write_text('untouched')
    recent=pure/'recent.mp4';video(recent);recent_sha=sha(recent)
    proc,log,port,data=start(NEW,pure,base/'home-pure',count=2)
    try:
        byname={x['originalName']:x for x in data['items']}
        check('Existing hashed root media stays managed',byname['previous.mp4'].get('readOnly') is not True)
        check('Hash survives subsequent mixed-workspace detection',len(managed(pure))==2 and not recent.exists() and recent_sha in [sha(x) for x in managed(pure)])
        check('Nonmedia content intact',(pure/'study'/'essay.md').read_text()=='untouched')
    finally:stop(proc,log)
    # D. No Hash setting continues to preserve real source filenames.
    plain=base/'nonhash';plain.mkdir();(plain/'study').mkdir();(plain/'study'/'note.txt').write_text('safe')
    one=plain/'plain.mp4';video(one);one_sha=sha(one)
    proc,log,port,data=start(NEW,plain,base/'home-plain',count=1)
    try:
        check('Default non-Hash mixed import retains original',one.exists() and sha(one)==one_sha and not managed(plain))
        check('Default non-Hash is ordinary managed media',data['items'][0].get('readOnly') is not True)
    finally:stop(proc,log)
    # E. Hash + password is independently persisted and still hashes root media.
    protected=base/'mixed-protected';protected.mkdir();(protected/'课件').mkdir()
    private_note=protected/'课件'/'备课笔记.txt';private_note.write_text('private text',encoding='utf8')
    protected_video=protected/'private-video.mp4';video(protected_video);protected_sha=sha(protected_video)
    proc,log,port,data=start(NEW,protected,base/'home-protected',('--hash','--pwd'),password='test-password')
    try:
        cfg=json.loads((protected/'.douyin-nav-cache/library-settings.json').read_text())
        check('Mixed password library persisted Hash+password',cfg['hashEnabled'] and cfg['passwordEnabled'])
        check('Mixed password library hashes root video',len(managed(protected))==1 and not protected_video.exists())
        check('Encrypted-mode media content preserved',sha(managed(protected)[0])==protected_sha)
        check('Encrypted-mode nested note left untouched',private_note.read_text(encoding='utf8')=='private text')
    finally:stop(proc,log)
    proc,log,port,data=start(NEW,protected,base/'home-protected',password='test-password')
    try:
        check('Mixed password library readable after restart',any(i['originalName']=='private-video.mp4' for i in data['items']))
    finally:stop(proc,log)
print('TOTAL',checks,'PASS',flush=True)
