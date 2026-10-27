// Windows DPAPI contract tests using a PowerShell process stand-in; no real secrets or cloud traffic.
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),vm=require('vm');
const {EventEmitter}=require('events');
const assert=require('node:assert/strict');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jf-dpapi-v641-'));
const fakeKey='sk-TESTONLY04XXXXXXXXXXXXXXXXXXXXXXXXXX';
let stageFailure='',calls=[],count=0;
function check(message,condition){assert.ok(condition,message);console.log('PASS '+message);count++;}
function mockSpawn(exe,args,opts){
  assert.equal(exe,'powershell.exe');
  assert.equal(opts.windowsHide,true);
  assert.equal(args[2],'-EncodedCommand');
  const script=Buffer.from(args[3],'base64').toString('utf16le');
  check('PowerShell 5.1 explicitly loads System.Security',script.includes('Add-Type -AssemblyName System.Security'));
  check('DPAPI uses current-user protection',script.includes('DataProtectionScope]::CurrentUser'));
  check('Reads UTF-8 stdin stream without console encoding setter',script.includes('OpenStandardInput()')&&!script.includes('InputEncoding='));
  check('Secret never appears in PowerShell command or args',!script.includes(fakeKey)&&!JSON.stringify(args).includes(fakeKey));
  const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.stdin=new EventEmitter();
  p.stdin.end=(value,encoding)=>{
    assert.equal(encoding,'utf8');
    calls.push({value,script});
    setImmediate(()=>{
      if(stageFailure){p.stderr.emit('data',Buffer.from('JF_DPAPI_'+stageFailure));p.emit('close',17);return;}
      if(script.includes('::Protect(')){
        p.stdout.emit('data',Buffer.from(Buffer.from('MOCK_CIPHER:'+value).toString('base64')));
      }else if(script.includes('::Unprotect(')){
        const result=Buffer.from(value,'base64').toString('utf8');
        p.stdout.emit('data',Buffer.from(result.startsWith('MOCK_CIPHER:')?result.slice(12):''));
      }else{throw Error('Unexpected DPAPI script');}
      p.emit('close',0);
    });
  };
  p.kill=()=>p.emit('close',-1);
  return p;
}
const source=fs.readFileSync(path.join(__dirname,'..','src','media','50-ai-transcription.js'),'utf8');
const context={fs,path,os,crypto,require,process:{platform:'win32',env:{APPDATA:tmp}},Buffer,spawn:mockSpawn,setTimeout,clearTimeout,AI_LEARNING_DIR:tmp,URL,URLSearchParams};
vm.createContext(context);vm.runInContext(source,context);
const run=script=>vm.runInContext(script,context);
(async()=>{
  check('No preexisting credential',run('jfAsrKeyCache')===null);
  await run(`jfAsrSetKey('${fakeKey}')`);
  const config=path.join(tmp,'JustFun','qwen-credentials.json');
  const stored=fs.readFileSync(config,'utf8');
  check('Windows stores DPAPI ciphertext not plaintext',JSON.parse(stored).storage==='dpapi'&&!stored.includes(fakeKey));
  check('Local secrets stored with restrictive file mode',fs.statSync(config).mode%512===0o600);
  run('jfAsrKeyCache=null');
  check('DPAPI decrypt works after simulated application restart',(await run('jfAsrGetKey()'))===fakeKey);
  stageFailure='assembly';
  await assert.rejects(run("jfAsrSetKey('sk-TESTONLY05XXXXXXXXXXXXXXX')"),/无法加载 Windows 加密组件/);
  count++;console.log('PASS Assembly load failure gives actionable error');
  check('Failed encryption does not overwrite stored credential',fs.readFileSync(config,'utf8')===stored);
  stageFailure='crypt';
  await assert.rejects(run("jfAsrSetKey('sk-TESTONLY05XXXXXXXXXXXXXXX')"),/当前 Windows 用户无法执行凭据加密/);
  count++;console.log('PASS DPAPI permission failure gives safe diagnostic');
  check('Failure messages do not disclose secrets',!fs.readFileSync(config,'utf8').includes(fakeKey));
  stageFailure='';
  await run('jfAsrDeleteKey()');
  check('Credential deletion removes file',!fs.existsSync(config));
  console.log('TOTAL '+count+' PASS');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(tmp,{recursive:true,force:true}));
