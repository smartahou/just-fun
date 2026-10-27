#!/usr/bin/env python3
"""Isolated synthetic workspace API capacity probe; no actual user files.
Use only disposable directories. This is *not* Windows or 1h real-use validation.
"""
import ast,base64,json,pathlib,re,sys,tempfile,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from isolated import launch,stop,urlopen
fixture=(ROOT/'scripts/benchmark-library-v709.py').read_text()
JPEG=base64.b64decode(ast.literal_eval(re.search(r'JPEG=base64\.b64decode\(([^\n]+)\)',fixture).group(1)))
URI='data:image/jpeg;base64,'+base64.b64encode(JPEG).decode()
cases=[(100,0),(1000,0),(5000,0),(100,1000)]
results=[]
for count,image_count in cases:
  with tempfile.TemporaryDirectory(prefix='jf-architecture-test-workspace-v710-') as td:
    root=pathlib.Path(td);media=root/'media';media.mkdir()
    reading=media/'.douyin-nav-cache'/'reading';reading.mkdir(parents=True)
    (reading.parent/'library-settings.json').write_text(json.dumps({'version':1,'hashEnabled':False,'passwordEnabled':False,'createdAt':'synthetic-test'}))
    marks=[{'type':'text','bookId':'a'*16,'chapter':0,'text':'test','anchorStart':i*5,'length':4} for i in range(count)]
    notes=[{'id':f'{i:024x}','title':'合成阅读笔记','content':'', 'quotes':[{'type':'image','image':URI,'text':'','bookId':'a'*16,'chapter':0,'anchorStart':None}]} for i in range(image_count)]
    data={'version':1,'revision':2,'progress':{},'notes':notes,'marks':marks,'lastExcerptNoteId':None}
    read_file=reading/'workspace.json';read_file.write_text(json.dumps(data,ensure_ascii=False),encoding='utf8')
    original=read_file.read_bytes()
    proc=log=None
    try:
      proc,port,log=launch(ROOT/'dist/douyin.js',media,root/'home')
      base=f'http://127.0.0.1:{port}'
      started=time.monotonic();code,_,raw=urlopen(base+'/api/reading/integrity',timeout=15)
      diag_seconds=round(time.monotonic()-started,4)
      diagnostic=json.loads(raw)
      started=time.monotonic();code2,_,raw2=urlopen(base+'/api/reading/workspace',timeout=15)
      read_seconds=round(time.monotonic()-started,4)
      seen=json.loads(raw2)
      case={'marks':count,'imageNotes':image_count,'inputBytes':len(original),'readOnlyDiagnosticSeconds':diag_seconds,'getWorkspaceSeconds':read_seconds,
            'diagnosticOk':code==200 and diagnostic.get('ok') is True,'roundTripOk':code2==200 and len(seen['marks'])==count and len(seen['notes'])==image_count,
            'originalFileUnchanged':read_file.read_bytes()==original,'uniqueImageRefs':diagnostic.get('images',{}).get('uniqueCount')}
      print('BENCHMARK_WORKSPACE',json.dumps(case,ensure_ascii=False),flush=True)
      assert case['diagnosticOk'] and case['roundTripOk'] and case['originalFileUnchanged'],case
      results.append(case)
    finally:stop(proc,log)
output={'scope':'synthetic isolated Linux workspace read-only API; no real user media or password vault performance claim',
  'cases':results}
(ROOT/'dist/benchmark-workspace-v710.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print('BENCHMARK_SUMMARY',json.dumps(output,ensure_ascii=False),flush=True)
