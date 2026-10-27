#!/usr/bin/env python3
"""Capacity and persistence invariants of v7.10 non-Hash catalog batch import.
All paths live under a temporary jf-architecture-test- prefix.
Hash rename-journal behavior must stay unchanged.
"""
import ast,base64,hashlib,json,os,pathlib,re,subprocess,sys,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from isolated import launch,stop,urlopen,media_entries,record

# The exact benchmark fixture, read as an inert source literal; never import its
# benchmark module (which starts live servers at import time).
text=(ROOT/'scripts/benchmark-library-v709.py').read_text(encoding='utf8')
match=re.search(r'JPEG=base64\.b64decode\(([^\n]+)\)',text)
assert match,'Missing local JPEG fixture'
JPEG=base64.b64decode(ast.literal_eval(match.group(1)))
assert JPEG[:3]==b'\xff\xd8\xff'

def fill(root,first,count):
    for i in range(first,first+count):
        (root/f'中文图片-{i:05}.jpg').write_bytes(JPEG)

def poll_items(port,wanted,deadline=14):
    end=time.monotonic()+deadline
    while time.monotonic()<end:
        code,head,raw=urlopen('http://127.0.0.1:'+str(port)+'/api/data',timeout=6)
        if code==200:
            items=media_entries(json.loads(raw))
            if len(items)==wanted:return items
        time.sleep(.1)
    raise AssertionError(f'Expected {wanted} media items at port {port}')

def launch_with_counter(script,lib,home,counter,flags=()):
    preload=home.parent/'instrument.cjs'
    preload.write_text('''const fs=require('fs'); const real=fs.writeFileSync;
fs.writeFileSync=function(filename,...rest){
 if(String(filename).includes('data.json.tmp-')){
   fs.appendFileSync(process.env.JF_TEST_CATALOG_WRITES,'.');
 }
 return real.call(this,filename,...rest);
};
''',encoding='utf8')
    before=os.environ.get('NODE_OPTIONS'); prior=os.environ.get('JF_TEST_CATALOG_WRITES')
    os.environ['NODE_OPTIONS']='--require='+str(preload)
    os.environ['JF_TEST_CATALOG_WRITES']=str(counter)
    try:return launch(script,lib,home,flags=flags)
    finally:
        if before is None:os.environ.pop('NODE_OPTIONS',None)
        else:os.environ['NODE_OPTIONS']=before
        if prior is None:os.environ.pop('JF_TEST_CATALOG_WRITES',None)
        else:os.environ['JF_TEST_CATALOG_WRITES']=prior

def main():
    assert (ROOT/'dist/douyin.js').is_file()
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-catalog-v710-') as td:
        root=pathlib.Path(td);media=root/'media';media.mkdir();home=root/'home';counter=root/'writes.txt'
        fill(media,0,500)
        original={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in media.glob('*.jpg')}
        proc=log=None
        try:
            proc,port,log=launch_with_counter(ROOT/'dist/douyin.js',media,home,counter)
            items=poll_items(port,500)
            record('v7.10 first 500 imported once each',len({x['originalName'] for x in items})==500)
            record('v7.10 one batched catalog write at initial import',0<counter.read_text().count('.')<=5,f'writes={counter.read_text().count(".")}')
        finally:stop(proc,log)
        config=json.loads((media/'.douyin-nav-cache/library-settings.json').read_text())
        record('v7.10 default original-name mode',config['hashEnabled'] is False)
        record('v7.10 initial files were not renamed',all((media/n).exists() for n in original))
        fill(media,500,250);counter.unlink();proc=log=None
        try:
            proc,port,log=launch_with_counter(ROOT/'dist/douyin.js',media,root/'home-restart',counter)
            items=poll_items(port,750)
            record('v7.10 restart preserves catalog and adds 250 new',len(items)==750 and len({x['key'] for x in items})==750)
            record('v7.10 restart saves new entries as batch',0<counter.read_text().count('.')<=5,f'writes={counter.read_text().count(".")}')
        finally:stop(proc,log)
        record('v7.10 no original-media mutations',all(hashlib.sha256((media/n).read_bytes()).hexdigest()==h for n,h in original.items()))
        counter.unlink();proc=log=None
        try:
            proc,port,log=launch_with_counter(ROOT/'dist/douyin.js',media,root/'home-again',counter)
            items=poll_items(port,750)
            record('v7.10 second restart has no duplicate records',len(items)==len({x['originalName'] for x in items})==750)
        finally:stop(proc,log)
        # Retain per-file journaling and physical hashed storage only when
        # initializing a distinct --hash library.
        hashed=root/'hashed';hashed.mkdir();fill(hashed,0,3);proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',hashed,root/'hash-home',flags=('--hash',))
            items=poll_items(port,3)
            record('v7.10 hash files keep human-readable originals only as metadata',all(not (hashed/x['originalName']).exists() for x in items))
            record('v7.10 hash pending journal entries resolve to ready',all(x['key'] and x['mediaUrl'] for x in items))
        finally:stop(proc,log)
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',hashed,root/'hash-restart')
            items=poll_items(port,3)
            record('v7.10 hashed records survive restart',len(items)==3)
        finally:stop(proc,log)
        print('CATALOG-BATCH-V710 PASSED',flush=True)

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('CATALOG-BATCH-V710 FAILED',repr(exc),file=sys.stderr);raise
