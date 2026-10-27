#!/usr/bin/env python3
"""Reproducible Just Fun release packager. Tests are run separately with tests/run-all.py.
No personal media: only internal source and reviewed artifacts are packed.
"""
import hashlib,json,pathlib,subprocess,tempfile,zipfile,datetime,time,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path('/mnt/data')
VERSION='v6.56'
LABEL='PDF书页阅读与封面引擎试用版'

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def run(args,cwd):
    subprocess.run(args,cwd=cwd,check=True,timeout=90,stdout=subprocess.PIPE,stderr=subprocess.PIPE)

def test_fingerprint(root):
    h=hashlib.sha256()
    for p in sorted((root/'tests').rglob('*')):
        if p.is_file() and p.suffix in ('.py','.js'):
            h.update(p.relative_to(root).as_posix().encode('utf8')+b'\0')
            h.update(p.read_bytes())
    return h.hexdigest()

REQUIRED=['isolated','security','workspace','browser','browser-preview','startup-port-unicode',
          'browser-frames-v625','recovery-v626','keyboard-seek-v627','keyboard-seek-v630',
          'long-video-frames-v628','long-real-server-v628','delete-drive-v629',
          'annotations-v631','annotations-ui-v632','annotations-ui-v633',
          'annotation-alignment-v634','annotations-v635','ux-v636',
          'ai-audio-preparation-v637','ai-learning-v638','ai-transcription-v639','ai-transcript-ux-v642',
          'ai-transcript-ranges-v643','ai-transcript-ux-v643','live-photo-v644','live-photo-gestures-v645','photo-crop-v646','photo-crop-zoom-v647','metadata-vault-v648']

def verify_regression(report,root,compiled):
    if not isinstance(report,dict):
        raise SystemExit('回归报告结构无效：拒绝发布')
    cases=report.get('tests',[])
    build=report.get('build')
    if (not isinstance(cases,list) or not isinstance(build,dict)
        or not all(isinstance(x,dict) for x in cases)):
        raise SystemExit('回归报告结构无效：拒绝发布')
    if (not report.get('passed') or not build.get('passed')
        or report.get('buildSha256')!=sha(compiled)
        or report.get('testsSha256')!=test_fingerprint(root)
        or len(cases)!=len(REQUIRED)
        or set(x.get('name') for x in cases)!=set(REQUIRED)
        or not all(x.get('passed') is True and x.get('exitCode')==0 for x in cases)):
        raise SystemExit('回归报告不完整、未通过或与当前源码及测试版本不一致：拒绝发布')


def main():
    start=time.monotonic()
    run(['node','scripts/build.js'],ROOT)
    compiled=ROOT/'dist/douyin.js'
    run(['node','--check',str(compiled)],ROOT)
    report_path=ROOT/'dist/full-regression-report.json'
    if not report_path.is_file():
        raise SystemExit('缺少完整回归报告，请先运行 tests/run-all.py：拒绝发布')
    try:
        report=json.loads(report_path.read_text(encoding='utf8'))
    except (OSError,ValueError) as exc:
        raise SystemExit('回归报告不可读取或格式错误：拒绝发布') from exc
    verify_regression(report,ROOT,compiled)
    # Source files all come from the whitelist; no caches, test fixtures, screenshots, or temporary passwords.
    manifest=json.loads((ROOT/'build.manifest.json').read_text())
    sources=['build.manifest.json','README.md','ARCHITECTURE.md','assets/favicon.ico',
             'scripts/build.js','scripts/release.py',*manifest['server'],manifest['html'],
             *manifest['styles'],*manifest['scripts'],
             *[str(f.relative_to(ROOT)) for f in sorted((ROOT/'tests').rglob('*')) if f.is_file() and f.suffix in ('.py','.js','.md')],
             'tests/reference/v6.21.douyin.js',
             '使用说明-v6.38.md','升级说明-v6.38.md','测试摘要-v6.38.md','迭代工时记录-v6.38.md','README-v6.37-AI音频上传准备.md','交接审计-v6.38.1.md','审计复核-v6.38.2.md','升级说明-v6.39.md','升级说明-v6.40.md','测试摘要-v6.40.md','升级说明-v6.41.md','测试摘要-v6.41.md','升级说明-v6.42.md','测试摘要-v6.42.md','升级说明-v6.44.md','测试摘要-v6.44.md','升级说明-v6.45.md','测试摘要-v6.45.md','升级说明-v6.46.md','测试摘要-v6.46.md','升级说明-v6.47.md','测试摘要-v6.47.md','升级说明-v6.48.md','测试摘要-v6.48.md','升级说明-v6.50.md','测试摘要-v6.50.md','升级说明-v6.51.md','测试摘要-v6.51.md','升级说明-v6.52.md','测试摘要-v6.52.md','升级说明-v6.54.md','测试摘要-v6.54.md','升级说明-v6.56.md','测试摘要-v6.56.md',
             'dist/douyin.js','dist/build-report.json','dist/full-regression-report.json',
             *[str(f.relative_to(ROOT)) for f in sorted((ROOT/'dist/test-logs').glob('suite-*.json'))],
             *[str(f.relative_to(ROOT)) for f in sorted((ROOT/'dist/test-logs').glob('batch-*.json'))],
             *[str(f.relative_to(ROOT)) for f in sorted((ROOT/'dist/test-logs').glob('*.log'))]]
    # Historical handoff documents are optional in newer canonical archives.
    # Current release documents remain mandatory.
    sources=[x for x in dict.fromkeys(sources) if (ROOT/x).is_file()]
    for rel in ('升级说明-v6.56.md','测试摘要-v6.56.md'):
        if not (ROOT/rel).is_file():raise SystemExit('Missing release source: '+rel)
    for rel in sources:
        if not (ROOT/rel).is_file():raise SystemExit('Missing release source: '+rel)

    with tempfile.TemporaryDirectory(prefix='justfun-v640-clean-') as tmp:
        clean=pathlib.Path(tmp)/'clean';clean.mkdir()
        for rel in sources:
            if rel.startswith('dist/') or rel in ('测试摘要-v6.38.md','迭代工时记录-v6.38.md'):continue
            dest=clean/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((ROOT/rel).read_bytes())
        run(['node','scripts/build.js'],clean)
        rebuilt=clean/'dist/douyin.js'
        if sha(rebuilt)!=sha(compiled):raise SystemExit('Clean build SHA-256 mismatch')

        sourcezip=OUT/f'JustFun-{VERSION}-{LABEL}-模块化工程源码版.zip'
        dailyzip=OUT/f'JustFun-{VERSION}-{LABEL}-单文件版.zip'
        for target,members,prefix in [
            (sourcezip,sources,f'JustFun-{VERSION}-工程源码/'),
            (dailyzip,['dist/douyin.js'],'')]:
            with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
                for rel in members:
                    z.write(ROOT/rel,prefix+('douyin.js' if rel=='dist/douyin.js' and not prefix else rel))
            with zipfile.ZipFile(target) as z:
                bad=z.testzip()
                if bad:raise SystemExit('ZIP CRC mismatch '+str(bad))
        with zipfile.ZipFile(sourcezip) as z:
            artifact=z.read(f'JustFun-{VERSION}-工程源码/dist/douyin.js')
        with zipfile.ZipFile(dailyzip) as z:
            daily=z.read('douyin.js')
        if artifact!=daily or hashlib.sha256(daily).hexdigest()!=sha(rebuilt):raise SystemExit('Release ZIPs differ')
        print(json.dumps({'version':VERSION,'sourceZip':str(sourcezip),'dailyZip':str(dailyzip),
            'standaloneSha256':sha(rebuilt),'sourceZipSha256':sha(sourcezip),
            'dailyZipSha256':sha(dailyzip),'size':len(daily),'packagingWallSeconds':round(time.monotonic()-start,3),
            'regressionSuiteSeconds':report.get('sumSuiteSeconds'), 'executionMode':report.get('mode')},ensure_ascii=False,indent=2))

if __name__ == "__main__":
    main()
