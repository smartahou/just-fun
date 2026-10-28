#!/usr/bin/env python3
"""v7.23.2: Windows CRLF checkout must produce the same offline JS as LF checkout.
Uses isolated source copies and the pinned vendor directory; never accesses a media library.
"""
import hashlib, json, os, pathlib, shutil, subprocess, tempfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
MANIFEST=json.loads((ROOT/'build.manifest.json').read_text(encoding='utf8'))
TEXTS=list(dict.fromkeys([*MANIFEST['server'],*MANIFEST['styles'],*MANIFEST['scripts'], MANIFEST['html']]))
CHECKS=[]

def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def check(name,ok):
    if not ok:raise AssertionError(name)
    CHECKS.append(name)
    print('PASS',name,flush=True)

def build(root,successful=True):
    p=subprocess.run(['node','scripts/build.js'],cwd=root,capture_output=True,text=True,timeout=90)
    if successful and p.returncode:
        raise AssertionError('Unexpected build failure: '+p.stderr[-1600:])
    return p

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-crlf-v7232-') as tmp:
        temp=pathlib.Path(tmp)
        clean=temp/'lf'; altered=temp/'crlf'
        for root in (clean,altered):
            for file in [*TEXTS,'scripts/build.js','build.manifest.json',*MANIFEST['assets']]:
                src=ROOT/file;dst=root/file
                dst.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(src,dst)
            # Fixture uses locked dependency already provisioned in the test environment.
            (root/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
        build(clean)
        expected=sha(clean/'dist/douyin.js')
        check('Reference LF build reports matching SHA',json.loads((clean/'dist/build-report.json').read_text())['sourceSha256']==expected)
        check('Reference LF build has official embedded resource count',json.loads((clean/'dist/build-report.json').read_text())['pdfjsAssets']==203)
        # Actual Git for Windows core.autocrlf=true behavior: source files become CRLF.
        for file in TEXTS:
            p=altered/file
            data=p.read_bytes()
            p.write_bytes(data.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'))
        check('Windows checkout fixture contains CRLF HTML marker',b'<style>\r\n<!-- JUSTFUN_CSS -->\r\n</style>' in (altered/MANIFEST['html']).read_bytes())
        build(altered)
        check('CRLF checkout produces identical published JS',sha(altered/'dist/douyin.js')==expected)
        check('CRLF checkout produces identical HTML SHA',json.loads((altered/'dist/build-report.json').read_text())['htmlSha256']==json.loads((clean/'dist/build-report.json').read_text())['htmlSha256'])
        # A mixed-ending checkout can result from editing just one HTML/template file.
        for file in TEXTS[::2]:
            p=altered/file
            data=p.read_bytes().replace(b'\r\n',b'\n')
            p.write_bytes(data)
        build(altered)
        check('Mixed LF and CRLF build stays byte-identical',sha(altered/'dist/douyin.js')==expected)
        # Damaged and duplicate placeholders must still be rejected as before.
        layout=altered/MANIFEST['html']
        original=layout.read_bytes()
        replaced=original.replace(b'<!-- JUSTFUN_CSS -->',b'<!-- BAD_MARKER -->')
        check('Marker-corruption fixture is effective',replaced!=original)
        layout.write_bytes(replaced)
        failed=build(altered,successful=False)
        check('Damaged marker still fails build',failed.returncode!=0 and 'Missing/duplicate build marker' in failed.stderr)
        layout.write_bytes(original.replace(b'</html>',b'<style>\r\n<!-- JUSTFUN_CSS -->\r\n</style>\n</html>'))
        failed=build(altered,successful=False)
        check('Duplicated marker still fails build',failed.returncode!=0 and 'Missing/duplicate build marker' in failed.stderr)
        layout.write_bytes(original)
        build(altered)
        check('Recovery after rejection keeps exact JS SHA',sha(altered/'dist/douyin.js')==expected)
        check('Original live project source not modified by CRLF test',sha(ROOT/'scripts/build.js')==sha(clean/'scripts/build.js'))
    print(json.dumps({'passed':len(CHECKS),'failed':0,'referenceSha':expected},ensure_ascii=False))
if __name__=='__main__':main()
