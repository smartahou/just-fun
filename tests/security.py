#!/usr/bin/env python3
"""Destructive login-failure testing ONLY in automatically created temp fixtures."""
import json,os,pathlib,subprocess,sys,tempfile,time
from isolated import ROOT, make_fixture, launch, stop, api_wait,sha

def contents(path):return sorted(str(p.relative_to(path)) for p in path.rglob('*') if p.is_file())

def fail_login(script,lib,home):
    assert 'jf-architecture-test-'  in str(lib)
    home.mkdir(exist_ok=True)
    env=dict(os.environ,HOME=str(home),USERPROFILE=str(home))
    # One line for hidden directory + three incorrect passwords.
    try:
        proc=subprocess.run(['node',str(script),'--port=0'],input=(str(lib)+'\nbad\nbad\nbad\n').encode(),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,cwd=home,timeout=18)
    except subprocess.TimeoutExpired:
        raise AssertionError('Wrong-password process stayed alive >18s')
    return proc.returncode,proc.stdout.decode(errors='replace')

def main():
    result=[]
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-' ) as s:
      root=pathlib.Path(s)
      for mode in [('password-only',['--pwd'],False),('hash-and-password',['--hash','--pwd'],True)]:
        name,flags,erase=mode
        lib=root/name
        files=make_fixture(lib)
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',lib,root/(name+'-home'),flags=flags,password='correct')
            api_wait(port)
        finally:stop(proc,log)
        before=contents(lib)
        code,txt=fail_login(ROOT/'dist/douyin.js',lib,root/(name+'-bad-home'))
        after=contents(lib)
        if erase:
            success=code!=0 and not any(p in after for p in before) and not after
        else:
            success=code!=0 and before==after and all(sha(lib/p)==files[p] for p in files)
        result.append({'name':name,'pass':success,'exit_code':code,'files_before':len(before),'files_after':len(after)})
        print('PASS' if success else 'FAIL',name,'exit=',code,'before=',len(before),'after=',len(after),flush=True)
        if not success:print('log tail',txt[-250:]);raise AssertionError(name)
    (ROOT/'dist/security-test-report.json').write_text(json.dumps({'passed':len(result),'total':len(result),'tests':result},indent=2)+'\n')
if __name__=='__main__':
    try:main()
    except Exception as e:print('FAILED',repr(e),file=sys.stderr);sys.exit(1)
