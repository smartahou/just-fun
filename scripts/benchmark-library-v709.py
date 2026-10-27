#!/usr/bin/env python3
"""Isolated synthetic media-catalog capacity bench. NEVER touches user data.
Cannot establish Windows/mobile-drive/400-page PDF/one-hour playback performance.
"""
import base64,hashlib,json,os,pathlib,sys,tempfile,time,urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from isolated import launch,stop,urlopen,media_entries
# Valid 1x1 JPEG, same payload but distinct filenames and file identities.
JPEG=base64.b64decode('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDLooorsOE//9k=')
results=[]
sizes=[int(x) for x in sys.argv[1:]] if len(sys.argv)>1 else [1000,5000,20000]
for wanted in sizes:
  with tempfile.TemporaryDirectory(prefix='jf-architecture-test-bench-v709-') as td:
    root=pathlib.Path(td);library=root/'media';library.mkdir()
    t0=time.monotonic()
    for i in range(wanted):(library/f'合成-{i:05}.jpg').write_bytes(JPEG)
    create_seconds=round(time.monotonic()-t0,3)
    proc=log=None
    try:
      started=time.monotonic();proc,port,log=launch(ROOT/'dist/douyin.js',library,root/'home')
      initialized=round(time.monotonic()-started,3)
      deadline=time.monotonic()+(120 if wanted<=5000 else 150);observed=0;response_bytes=0;request_errors=0;last_error=None
      while time.monotonic()<deadline:
        try:
          code,headers,raw=urlopen(f'http://127.0.0.1:{port}/api/data',timeout=10)
          if code==200:
            observed=len(media_entries(json.loads(raw)));response_bytes=len(raw)
        except Exception as exc:
          request_errors+=1;last_error=type(exc).__name__+': '+str(exc)[:150]
          print('BENCH WAIT',wanted,'elapsed',round(time.monotonic()-started,1),'errors',request_errors,flush=True)
        if observed>=wanted:break
        time.sleep(.45)
      ready_seconds=round(time.monotonic()-started,3)
      etag=None;code304=-1
      if observed>=wanted:
        try:
          code,headers,raw=urlopen(f'http://127.0.0.1:{port}/api/data',timeout=15)
          etag=headers.get('ETag')
          if etag:code304=urlopen(f'http://127.0.0.1:{port}/api/data',headers={'If-None-Match':etag},timeout=15)[0]
        except Exception as exc:last_error=type(exc).__name__+': '+str(exc)[:150]
      rss_kib=None
      try:
        for line in pathlib.Path(f'/proc/{proc.pid}/status').read_text().splitlines():
          if line.startswith('VmRSS:'):rss_kib=int(line.split()[1]);break
      except (OSError,ValueError):pass
      result={'requested':wanted,'visible':observed,'complete':observed>=wanted,'createSeconds':create_seconds,'bootSeconds':initialized,
        'readySeconds':ready_seconds,'responseBytes':response_bytes,'rssKiB':rss_kib,'etag304':code304==304,
        'requestTimeoutsOrErrors':request_errors,'lastError':last_error}
      print(json.dumps(result,ensure_ascii=False),flush=True);results.append(result)
    finally:
      if proc:stop(proc,log)
output={'scope':'synthetic isolated Linux JPEG directory; not realistic decode or Windows stress','generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'entries':results}
print('BENCHMARK_SUMMARY',json.dumps(output,ensure_ascii=False),flush=True)
(ROOT/'dist/benchmark-library-v709.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
if not all(x['complete'] for x in results):raise SystemExit(1)
