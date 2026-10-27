#!/usr/bin/env python3
"""v6.29 explicit source-media deletion, safe stale-index handling, drive unit."""
import os, pathlib, tempfile, time, hashlib, subprocess, sys, json
from isolated import ROOT, launch, stop, urlopen
from workspace import post,wait,movie,ff
RESULTS=[]
def check(label,yes):
    RESULTS.append({'name':label,'passed':bool(yes)})
    print(('PASS' if yes else 'FAIL'),label,flush=True)
    if not yes:raise AssertionError(label)
def snapshot(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-deletion-') as temp:
        home=pathlib.Path(temp); lib=home/'真实工作目录';sub=lib/'中文课程'/'第1章';sub.mkdir(parents=True)
        video=sub/'待删视频.mp4';movie(video,'libx264','mp4')
        root=lib/'根目录视频.mp4';movie(root,'libx264','mp4')
        audio=sub/'待删音频.mp3';ff(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=360:duration=1','-c:a','libmp3lame',str(audio)])
        picture=sub/'待删图片.png';ff(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:size=64x64:duration=0.1','-frames:v','1',str(picture)])
        note=sub/'重要文档.docx';note.write_bytes(b'Keep this document intact')
        hidden=lib/'data'/'old_cache.mp4';hidden.parent.mkdir();hidden.write_bytes(b'excluded from work tree')
        note_checksum=snapshot(note)
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',lib,home/'home')
            data=wait(port,4)
            byname={x['originalName']:x for x in data['items']}
            check('Source media indexed',all(k in byname for k in [root.name,video.name,audio.name,picture.name]))
            check('Source media remains in original locations',all(p.exists() for p in (root,video,audio,picture)))
            check('Non-media document excluded',note.name not in byname)
            check('Root video is protected from implicit mutation',byname[root.name]['readOnly'])
            check('Source rename still blocked',post(port,'/api/media-rename',{'key':byname[video.name]['key'],'name':'新名字'})[0]==403)
            check('Source move still blocked',post(port,'/api/media-move',{'keys':[byname[audio.name]['key']],'target':'data'})[0]==403)
            # Force index stale before deletion; no refresh is allowed to race this subcase.
            old_mtime=video.stat().st_mtime
            os.utime(video,(old_mtime+5,old_mtime+5))
            status,response=post(port,'/api/delete',{'key':byname[video.name]['key']})
            check('Changed source rejects stale-index delete',not response.get('ok') and status>=400 and video.exists())
            status,response=post(port,'/api/media-delete-batch',{'keys':[byname[video.name]['key'],byname[audio.name]['key']]})
            check('Batch processes failures separately',status==200 and response['deleted']==1 and len(response['failed'])==1)
            check('Audio file actually deleted; changed video preserved',not audio.exists() and video.exists())
            status,response=post(port,'/api/delete-images',{'keys':[byname[picture.name]['key']]})
            check('Source photo API may delete original photo',status==200 and response['deleted']==1 and not picture.exists())
            status,response=post(port,'/api/delete',{'key':byname[root.name]['key']})
            check('Source root video may be deleted',status==200 and response['ok'] and not root.exists())
            check('Documents and excluded file remain intact',snapshot(note)==note_checksum and hidden.exists())
            # Symlink introduced *after* indexing must not be followed or unlinked.
            video.unlink();video.symlink_to(note)
            status,response=post(port,'/api/delete',{'key':byname[video.name]['key']})
            check('Late symlink swap cannot delete external document',status>=400 and note.exists() and snapshot(note)==note_checksum)
            check('Symlink still present',video.is_symlink())
            data=json.loads(urlopen(f'http://127.0.0.1:{port}/api/data')[2])
            check('Non-media file remains excluded after deletions',note.name not in [x['originalName'] for x in data['items']])
        finally:stop(proc,log)
    vm=subprocess.run(['node',str(ROOT/'tests/drive-awake-v629.js')],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=15)
    print(vm.stdout,flush=True)
    check('Read-only timer test suite',vm.returncode==0)
    (ROOT/'dist/delete-drive-v629-report.json').write_text(json.dumps({'checks':RESULTS,'total':len(RESULTS),'passed':sum(x['passed'] for x in RESULTS)},ensure_ascii=False,indent=2))
    print('DELETE+DRIVE v6.29',sum(x['passed'] for x in RESULTS),'/',len(RESULTS))
if __name__=='__main__':main()
