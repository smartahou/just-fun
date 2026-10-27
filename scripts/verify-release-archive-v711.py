#!/usr/bin/env python3
"""Verify two final release archives, rebuilding the full source without network.
Does not touch a user library or modify either archive.
Usage: python scripts/verify-release-archive-v711.py SOURCE.zip INDEX.zip
"""
import argparse,hashlib,json,pathlib,subprocess,sys,tempfile,zipfile,stat,ast


def sha(data):return hashlib.sha256(data).hexdigest()

def clean_name(name):
    p=pathlib.PurePosixPath(name)
    return bool(name) and not p.is_absolute() and '..' not in p.parts and '\\' not in name

def inspect_zip(p):
    with zipfile.ZipFile(p) as z:
        entries=z.infolist()
        if not entries:raise ValueError(f'Empty ZIP: {p}')
        if len({x.filename for x in entries})!=len(entries):raise ValueError('Duplicate ZIP entries')
        for x in entries:
            if not clean_name(x.filename):raise ValueError('Unsafe ZIP entry: '+x.filename)
            if stat.S_IFMT((x.external_attr >> 16)&0xffff)==stat.S_IFLNK:
                raise ValueError('Symlink in ZIP: '+x.filename)
        return [x.filename for x in entries if not x.is_dir()]

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source_zip',type=pathlib.Path)
    ap.add_argument('user_zip',type=pathlib.Path)
    a=ap.parse_args()
    source_names=inspect_zip(a.source_zip)
    user_names=inspect_zip(a.user_zip)
    if user_names!=['index.js']:raise ValueError(f'User ZIP must contain only index.js: {user_names}')
    with zipfile.ZipFile(a.user_zip) as z:user_bytes=z.read('index.js')
    with tempfile.TemporaryDirectory(prefix='jf-release-clean-') as d:
        base=pathlib.Path(d)
        with zipfile.ZipFile(a.source_zip) as z:z.extractall(base)
        candidates=[p for p in base.iterdir() if p.is_dir()]
        if len(candidates)!=1:raise ValueError('Archive must have exactly one project root')
        root=candidates[0]
        for required in ('build.manifest.json','scripts/build.js','tests/release-gate-v703.py',
                         'dist/release-gate-v703/full-report.json','node_modules/pdfjs-dist/package.json'):
            if not (root/required).is_file():raise ValueError('Source ZIP missing: '+required)
        if any('.douyin-' in name or name.endswith(('.tmp','.bak')) for name in source_names):
            raise ValueError('Private library/test temp file in source ZIP')
        report=json.loads((root/'dist/release-gate-v703/full-report.json').read_text())
        if report.get('mode')!='full' or report.get('status')!='passed':
            raise ValueError('Release gate has not passed')
        cases=report.get('cases',{})
        if len(cases)<50 or not all(isinstance(c,dict) and c.get('passed') and
                                   c.get('exitCode')==0 and not c.get('timedOut') and
                                   c.get('buildSha256')==report['buildSha256']
                                   for c in cases.values()):
            raise ValueError('Incomplete or mismatched case evidence')
        h=hashlib.sha256()
        for p in sorted((root/'tests').rglob('*')):
            if p.is_file() and p.suffix in ('.py','.js'):
                h.update(str(p.relative_to(root)).encode()+b'\0');h.update(p.read_bytes())
        if h.hexdigest()!=report['testsSha256']:raise ValueError('Test source fingerprint mismatch')
        built=subprocess.run(['node','scripts/build.js'],cwd=root,stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=50)
        if built.returncode:raise RuntimeError('Clean offline build failed: '+built.stderr.decode('utf8','replace')[-1400:])
        clean_bytes=(root/'dist/douyin.js').read_bytes()
        if clean_bytes!=user_bytes or sha(clean_bytes)!=report['buildSha256']:
            raise ValueError('Clean offline build SHA differs from user ZIP / test evidence')
        syntax=subprocess.run(['node','--check',str(root/'dist/douyin.js')],
                              stdin=subprocess.DEVNULL,capture_output=True,timeout=20)
        if syntax.returncode:raise ValueError('User JS does not pass node --check')
        print(json.dumps({'passed':True,'sourceZipSha256':sha(a.source_zip.read_bytes()),
          'userZipSha256':sha(a.user_zip.read_bytes()),'indexSha256':sha(clean_bytes),
          'gateCases':len(cases),'testFingerprintVerified':True,'offlineBuildVerified':True,
          'indexOnly':True,'sourceFiles':len(source_names),'doesNotInspectUserLibrary':True},indent=2))
    return 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:print('RELEASE ARCHIVE VERIFY FAILED:',repr(exc),file=sys.stderr);sys.exit(1)
