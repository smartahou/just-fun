#!/usr/bin/env python3
"""Offline local Git remote and workspace end-to-end; synthetic project, no real media."""
import hashlib, json, os, pathlib, shutil, subprocess, tempfile, sys
BASE=pathlib.Path(__file__).resolve().parents[1]
CHECKS=[]
def check(name,okay):
    if not okay:raise AssertionError(name)
    CHECKS.append(name);print('PASS',name,flush=True)
def run(args,cwd=None,ok=True,env=None):
    r=subprocess.run(args,cwd=cwd,env=env,capture_output=True,text=True,timeout=120)
    if ok and r.returncode:raise AssertionError(f'{args} exit={r.returncode}\n{r.stdout[-1300:]}\n{r.stderr[-1300:]}')
    return r

def git(cwd,*args,ok=True):return run(['git',*args],cwd,ok=ok)
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()

def main():
  with tempfile.TemporaryDirectory(prefix='jf-deployment-v723-') as td:
    td=pathlib.Path(td);bare=td/'bare.git';local=td/'local';author=td/'author'
    git(None,'init','--bare','--initial-branch=main',str(bare))
    # Initial seed is a clean Git snapshot of the currently loaded repo. Used only in a sandbox.
    git(BASE,'push',str(bare),'main:main')
    git(None,'clone',str(bare),str(local))
    git(None,'clone',str(bare),str(author))
    for folder in [local,author]:
      git(folder,'config','user.email','test@justfun.invalid')
      git(folder,'config','user.name','Just Fun test')
    check('GitHub-like private repository clone',git(local,'rev-parse','--abbrev-ref','HEAD').stdout.strip()=='main')
    local_vendor=local/'node_modules'
    local_vendor.mkdir()
    (local_vendor/'pdfjs-dist').symlink_to(BASE/'node_modules'/'pdfjs-dist',target_is_directory=True)
    # Candidate comes from the remote commit, not the user's working tree.
    p=run(['node','scripts/local-deploy-v723.js','prepare'],local)
    state=json.loads((local/'.justfun-runtime'/'current.json').read_text())
    check('First install builds a standalone executable',sha(local/'.justfun-runtime'/'current.js')==state['sha256'])
    check('First install is from exact Git HEAD',state['commit']==git(local,'rev-parse','HEAD').stdout.strip())
    r=run(['node','scripts/local-deploy-v723.js','start','--doctor'],local)
    check('Verified installed application starts', '"readOnly": true' in r.stdout or '"readOnly":true' in r.stdout)
    sentinel=td/'private-library-sentinel';sentinel.write_bytes(b'PRIVATE-FIXTURE-DO-NOT-TOUCH')
    manifest=author/'package.json'
    before_version=json.loads(manifest.read_text())['version']
    version_parts=before_version.split('.')
    assert len(version_parts)==3 and all(part.isdigit() for part in version_parts)
    upgraded_version='.'.join([*version_parts[:2],str(int(version_parts[2])+1)])
    manifest.write_text(manifest.read_text().replace('"version": "'+before_version+'"','"version": "'+upgraded_version+'"'))
    git(author,'add','package.json');git(author,'commit','-m','test: version update');git(author,'push','origin','main')
    run(['node','scripts/local-deploy-v723.js','update'],local)
    next_state=json.loads((local/'.justfun-runtime'/'current.json').read_text())
    check('Remote fast-forward builds and publishes',next_state['version']==upgraded_version and next_state['commit']==git(local,'rev-parse','HEAD').stdout.strip())
    check('Previous known-good is retained',sha(local/'.justfun-runtime'/'previous.js')==state['sha256'])
    run(['node','scripts/local-deploy-v723.js','rollback'],local)
    rolled=json.loads((local/'.justfun-runtime'/'current.json').read_text())
    check('One-click rollback restores previous executable',rolled['commit']==state['commit'] and sha(local/'.justfun-runtime'/'current.js')==state['sha256'])
    run(['node','scripts/local-deploy-v723.js','update'],local)
    check('User can reapply latest after rollback',json.loads((local/'.justfun-runtime'/'current.json').read_text())['commit']==next_state['commit'])
    # Inject a source build error; candidate must fail before HEAD/runtime switch.
    doc=author/'build.manifest.json';backup=doc.read_text();doc.write_text(backup.replace('src/client/index.html','src/client/index.not-found.html'))
    git(author,'add','build.manifest.json');git(author,'commit','-m','test: broken manifest');git(author,'push','origin','main')
    old=git(local,'rev-parse','HEAD').stdout.strip();oldhash=sha(local/'.justfun-runtime'/'current.js')
    failed=run(['node','scripts/local-deploy-v723.js','update'],local,ok=False)
    check('Invalid candidate is rejected',failed.returncode!=0)
    check('Failed update keeps prior Git HEAD',git(local,'rev-parse','HEAD').stdout.strip()==old)
    check('Failed update keeps previous executable intact',sha(local/'.justfun-runtime'/'current.js')==oldhash)
    check('Isolated private-media sentinel not touched',sentinel.read_bytes()==b'PRIVATE-FIXTURE-DO-NOT-TOUCH')
    doc.write_text(backup);git(author,'add','build.manifest.json');git(author,'commit','-m','test: repair manifest');git(author,'push','origin','main')
    run(['node','scripts/local-deploy-v723.js','update'],local)
    check('Repair after failed update succeeds',git(local,'rev-parse','HEAD').stdout.strip()==git(author,'rev-parse','HEAD').stdout.strip())
    # An existing user's edited source must never be overwritten.
    (local/'src'/'client'/'index.html').write_text('local uncommitted change')
    blocked=run(['node','scripts/local-deploy-v723.js','update'],local,ok=False)
    check('Dirty local Git files block update',blocked.returncode!=0 and '未提交' in blocked.stderr)
    # An interrupted deployment can be restored from known-good metadata.
    (local/'.justfun-runtime'/'current.js').write_bytes(b'tampered/incomplete-runtime')
    run(['node','scripts/local-deploy-v723.js','status'],local)
    good=json.loads((local/'.justfun-runtime'/'current.json').read_text())
    check('Interrupted executable is recovered by hash',sha(local/'.justfun-runtime'/'current.js')==good['sha256'])
    for f in ['启动.cmd','更新.cmd','回退.cmd']:
      check('Windows launcher present: '+f,(BASE/f).exists())
  print(json.dumps({'passed':len(CHECKS),'failed':0},ensure_ascii=False))
if __name__=='__main__':main()
