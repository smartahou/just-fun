#!/usr/bin/env python3
"""v7.12 final packaging: fail closed, immutable source zip, one-file consumer zip.
No network, no user media, no test runtime caches in source archive.
"""
import hashlib, json, pathlib, shutil, subprocess, sys, tempfile, time, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path('/mnt/data')
VERSION='v7.12'
NAME='Workspace事务预检与安全演练'
PREFIX=f'JustFun-{VERSION}-完整工程/'
ARTIFACT=ROOT/'dist/douyin.js'

def sha(b):return hashlib.sha256(b).hexdigest()
def command(*args,cwd=ROOT,timeout=50):
    p=subprocess.run(list(args),cwd=cwd,capture_output=True,text=True,timeout=timeout)
    if p.returncode:raise RuntimeError('failed '+str(args)+': '+(p.stdout+p.stderr)[-2000:])
    return p.stdout

def main():
    start=time.monotonic()
    command(sys.executable,'tests/release-gate-v703.py','--verify')
    report=json.loads((ROOT/'dist/release-gate-v703/full-report.json').read_text())
    if report.get('mode')!='full' or report.get('status')!='passed' or len(report.get('cases',{}))!=48:
        raise RuntimeError('Need complete 48-case full release gate')
    output=json.loads(command('node','scripts/build.js'))
    artifact=ARTIFACT.read_bytes()
    if sha(artifact)!=report['buildSha256'] or output['sourceSha256']!=sha(artifact):
        raise RuntimeError('Source hash differs from full regression evidence')
    manifest=json.loads((ROOT/'build.manifest.json').read_text())
    include={'build.manifest.json','README.md','ARCHITECTURE.md'}
    for f in ROOT.glob('*.md'):include.add(f.relative_to(ROOT).as_posix())
    for rel in manifest['server']+manifest['styles']+manifest['scripts']+[manifest['html']]+manifest['assets']:
        include.add(rel)
    for root in ('scripts','tests','node_modules/pdfjs-dist'):
        for f in (ROOT/root).rglob('*'):
            if f.is_file() and not f.is_symlink() and '__pycache__' not in f.parts:
                if root=='tests' and f.suffix not in ('.py','.js','.md','.json'):
                    continue
                include.add(f.relative_to(ROOT).as_posix())
    include.update(('dist/douyin.js','dist/build-report.json','dist/release-gate-v703/full-report.json'))
    # Preserve both independent full runs and synthetic benchmark evidence.
    for evidence_dir in ['release-evidence-v710','release-evidence-v711']:
        for f in (ROOT/'dist'/evidence_dir).glob('*'):
            if f.is_file() and f.suffix in ('.log','.json'):
                include.add(f.relative_to(ROOT).as_posix())
    # Each case's log must remain independently inspectable after an interrupted chat.
    for f in (ROOT/'dist/release-gate-v703/logs').glob('*.log'):
        if f.is_file():include.add(f.relative_to(ROOT).as_posix())
    missing=[rel for rel in include if not (ROOT/rel).is_file()]
    if missing:raise RuntimeError('Source archiver missing '+str(missing[:10]))
    # No files under .douyin-data-backup, runtime credentials, or test snapshots.
    assert all('/.douyin-' not in ('/'+x) and '/__pycache__/' not in x for x in include)
    src=OUT/f'JustFun-{VERSION}-{NAME}-模块化工程源码版.zip'
    user=OUT/f'JustFun-{VERSION}-{NAME}-index.js单文件替换包.zip'
    src_tmp=src.with_suffix('.zip.tmp');user_tmp=user.with_suffix('.zip.tmp')
    for target in (src_tmp,user_tmp):target.unlink(missing_ok=True)
    try:
        with zipfile.ZipFile(src_tmp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for rel in sorted(include):z.write(ROOT/rel,PREFIX+rel)
        with zipfile.ZipFile(user_tmp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            z.writestr('index.js',artifact)
        with zipfile.ZipFile(src_tmp) as source,zipfile.ZipFile(user_tmp) as direct:
            if source.testzip() or direct.testzip() or direct.namelist()!=['index.js']:
                raise RuntimeError('Zip integrity failed')
            if source.read(PREFIX+'dist/douyin.js')!=artifact or direct.read('index.js')!=artifact:
                raise RuntimeError('Release source/artifact mismatch')
            with tempfile.TemporaryDirectory(prefix='jf-v712-source-rebuild-') as td:
                source.extractall(td)
                tree=pathlib.Path(td)/PREFIX
                command('node','scripts/build.js',cwd=tree,timeout=65)
                if (tree/'dist/douyin.js').read_bytes()!=artifact:
                    raise RuntimeError('Offline extracted source ZIP rebuild mismatch')
                command(sys.executable,'tests/release-gate-v703.py','--verify',cwd=tree,timeout=30)
                command(sys.executable,'scripts/verify-release-archive-v711.py','--help',cwd=tree,timeout=15)
        src_tmp.replace(src);user_tmp.replace(user)
    finally:
        for p in (src_tmp,user_tmp):p.unlink(missing_ok=True)
    result={'version':VERSION,'sourceZip':str(src),'indexZip':str(user),
            'indexJsSha256':sha(artifact),'sourceZipSha256':sha(src.read_bytes()),
            'indexZipSha256':sha(user.read_bytes()),'indexBytes':len(artifact),
            'sourceZipBytes':src.stat().st_size,'indexZipBytes':user.stat().st_size,
            'filesInSource':len(include),'testCases':len(report['cases']),
            'testSeconds':report.get('sumSuiteSeconds'),'packSeconds':round(time.monotonic()-start,3),
            'sourceZipOfflineRebuildPassed':True,'userZipContains':['index.js']}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    (OUT/f'JustFun-{VERSION}-pack-evidence.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':
    try:main()
    except Exception as e:print('PACK FAILED:',str(e),file=sys.stderr);raise SystemExit(1)
