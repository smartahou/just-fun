#!/usr/bin/env python3
"""v7.10 isolated thousand *distinct* synthetic JPEG excerpts.
No user files, no extra runtime dependency; the 1px JPEG's COM segment has
an index to make each JPEG valid and cryptographically unique.
"""
import ast,base64,hashlib,json,pathlib,sys,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from isolated import launch,stop,urlopen
src=(ROOT/'scripts/benchmark-library-v709.py').read_text(encoding='utf8')
line=next(s for s in src.splitlines() if s.startswith('JPEG=base64.b64decode('))
original=base64.b64decode(ast.literal_eval(line.split('(',1)[1][:-1]))
assert original[:3]==b'\xff\xd8\xff'
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-unique-excerpts-v710-') as temp:
    base=pathlib.Path(temp);media=base/'media';media.mkdir()
    workspace=media/'.douyin-nav-cache'/'reading';workspace.mkdir(parents=True)
    (workspace.parent/'library-settings.json').write_text(json.dumps({'version':1,'hashEnabled':False,'passwordEnabled':False,'createdAt':'synthetic'}))
    notes=[]; hashes=set()
    for i in range(1000):
        # JPEG comment is inserted immediately after SOI, preserving validity.
        jpg=original[:2]+b'\xff\xfe\x00\x06'+i.to_bytes(4,'big')+original[2:]
        hashes.add(hashlib.sha256(jpg).hexdigest())
        image='data:image/jpeg;base64,'+base64.b64encode(jpg).decode('ascii')
        notes.append({'id':f'{i:024x}','title':'合成摘录','content':'',
                      'quotes':[{'type':'image','bookId':'a'*16,'chapter':0,'image':image,'text':'','anchorStart':None}]})
    assert len(hashes)==1000
    marks=[{'bookId':'a'*16,'chapter':0,'type':'text','text':'合成','anchorStart':i*4,'length':2} for i in range(100)]
    content=json.dumps({'version':1,'revision':2,'progress':{},'notes':notes,'marks':marks,'lastExcerptNoteId':None},ensure_ascii=False)
    file=workspace/'workspace.json';file.write_text(content,encoding='utf8')
    before=hashlib.sha256(file.read_bytes()).hexdigest()
    proc=log=None
    try:
        proc,port,log=launch(ROOT/'dist/douyin.js',media,base/'home')
        prefix=f'http://127.0.0.1:{port}'
        t=time.monotonic();code,_,raw=urlopen(prefix+'/api/reading/integrity',timeout=30)
        secs=round(time.monotonic()-t,4);status=json.loads(raw)
        t=time.monotonic();code2,_,raw2=urlopen(prefix+'/api/reading/workspace',timeout=30)
        get_secs=round(time.monotonic()-t,4);public=json.loads(raw2)
        outcome={'distinctJpegSha256':len(hashes),'notes':len(notes),'fileBytes':file.stat().st_size,
             'integritySeconds':secs,'publicReadSeconds':get_secs,
             'integrityOk':code==200 and status.get('ok') is True,
             'distinctReported':status.get('images',{}).get('uniqueCount'),
             'embeddedReported':status.get('images',{}).get('embeddedCount'),
             'roundTripOk':code2==200 and len(public.get('notes',[]))==1000,
             'unchanged':hashlib.sha256(file.read_bytes()).hexdigest()==before,
             'environment':'isolated Linux 1000 valid 1px JPEGs with distinct metadata; not real scans/images/Windows'}
        assert outcome['integrityOk'] and outcome['roundTripOk'] and outcome['unchanged'],outcome
        assert outcome['distinctReported']==outcome['embeddedReported']==1000,outcome
        print(json.dumps(outcome,ensure_ascii=False,indent=2))
        (ROOT/'dist'/'benchmark-workspace-unique-v710.json').write_text(json.dumps(outcome,ensure_ascii=False,indent=2)+'\n')
    finally:stop(proc,log)
