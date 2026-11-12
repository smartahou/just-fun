#!/usr/bin/env node
'use strict';
// v7.128 network guard regression: default loopback, opt-in private LAN and
// exact Host/Origin. Pure VM test: no private user files or open TCP ports.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const bootstrap=fs.readFileSync(path.join(root,'src/server/00-bootstrap.js'),'utf8');
const asr=fs.readFileSync(path.join(root,'src/media/50-ai-transcription.js'),'utf8');
const router=fs.readFileSync(path.join(root,'src/server/60-http-router.js'),'utf8');
const packageJson=require('../package.json');
assert(Number(packageJson.version.split('.')[1])>=128);
function isolate(args){
  const start=bootstrap.indexOf('function jfLanIPv4Parts(');
  const end=bootstrap.indexOf('// A visible, native cooked terminal line',start);
  assert(start>=0&&end>start,'LAN bootstrap helper boundaries');
  const code=bootstrap.slice(start,end);
  const ctx={args,os:{networkInterfaces:()=>({
    'Wi-Fi':[{family:'IPv4',address:'192.168.1.23',
       netmask:'255.255.255.0',internal:false}],
    'VPN':[{family:'IPv4',address:'10.20.0.5',
       netmask:'255.255.255.0',internal:false}],
    'Public':[{family:'IPv4',address:'203.0.113.10',
       netmask:'255.255.255.0',internal:false}],
    'Loopback':[{family:'IPv4',address:'127.0.0.1',
       netmask:'255.0.0.0',internal:true}]
  })},console,process:{exit:()=>{throw Error('no network interface');}},Object,Number,String};
  return vm.runInNewContext(code+
    '\n({HOST,JF_LAN_ENABLED,JF_LAN_INTERFACES,jfLanRequestAllowed})',ctx);
}
const off=isolate([]);
assert.equal(off.HOST,'127.0.0.1');
assert.equal(off.JF_LAN_ENABLED,false);
const on=isolate(['--lan']);
assert.equal(on.HOST,'0.0.0.0');
assert.equal(on.JF_LAN_INTERFACES.length,2);
const req=(remote,host,origin)=>({
  socket:{remoteAddress:remote},headers:{host,...(origin?{origin}:{})}
});
assert.equal(on.jfLanRequestAllowed(req('192.168.1.88','192.168.1.23:3865'),3865),true);
assert.equal(on.jfLanRequestAllowed(req('::ffff:192.168.1.88','192.168.1.23:3865'),3865),true);
assert.equal(on.jfLanRequestAllowed(req('127.0.0.1','127.0.0.1:3865'),3865),true);
assert.equal(on.jfLanRequestAllowed(req('192.168.2.88','192.168.1.23:3865'),3865),false);
assert.equal(on.jfLanRequestAllowed(req('8.8.8.8','192.168.1.23:3865'),3865),false);
assert.equal(on.jfLanRequestAllowed(req('192.168.1.88','evil.example:3865'),3865),false);
assert.equal(on.jfLanRequestAllowed(req('192.168.1.88','192.168.1.99:3865'),3865),false);
assert.equal(on.jfLanRequestAllowed(req('192.168.1.88','192.168.1.23:9999'),3865),false);
const begin=asr.indexOf('function jfAsrCheckOrigin(req){');
const stop=asr.indexOf('async function jfAsrJsonFetch(',begin);
assert(begin>=0&&stop>begin);
function originGuard(lan){
  const cfg={JF_LAN_ENABLED:lan.JF_LAN_ENABLED,
    JF_LAN_INTERFACES:lan.JF_LAN_INTERFACES,URL,Error};
  return vm.runInNewContext(asr.slice(begin,stop)+'\njfAsrCheckOrigin',cfg);
}
const check=originGuard(on);
check(req('192.168.1.88','192.168.1.23:3865','http://192.168.1.23:3865'));
assert.throws(()=>check(req('192.168.1.88','192.168.1.23:3865','http://evil.example:3865')));
assert.throws(()=>check(req('192.168.1.88','192.168.1.23:3865','https://192.168.1.23:3865')));
assert.throws(()=>check(req('192.168.1.88','192.168.1.23:3865','http://192.168.1.23:3888')));
assert.throws(()=>originGuard(off)(req('127.0.0.1','192.168.1.23:3865','http://192.168.1.23:3865')));
assert(router.includes('jfLanRequestAllowed(req,server.address()?.port||PORT)'), 'guard is first for every URL');
assert(router.includes('server.listen(nextPort,HOST)'), 'all fallback ports honor bind address');
assert(fs.readFileSync(path.join(root,'局域网启动.cmd'),'utf8').includes('start --lan'), 'Windows LAN launcher');
const normalLauncher=fs.readFileSync(path.join(root,'启动.cmd'),'utf8');
assert(normalLauncher.includes('Choose 1 or 2')&&
  normalLauncher.includes('start --lan')&&normalLauncher.includes('start %*')&&
  normalLauncher.includes('goto lan')&&normalLauncher.includes('goto finish'),
  'ASCII Windows launcher offers explicit iPad LAN opt-in without parsed blocks');
const gitAttributes=fs.readFileSync(path.join(root,'.gitattributes'),'utf8');
assert(/^\*\.cmd -text$/m.test(gitAttributes),
  'batch files must be byte-exact: CRLF stored in Git cannot be re-normalized');
for(const cmdFile of ['启动.cmd','局域网启动.cmd']){
  const cmd=fs.readFileSync(path.join(root,cmdFile),'utf8');
  assert(cmd.includes('\r\n')&&!cmd.replace(/\r\n/g,'').includes('\n'),
    'Windows launcher must contain committed CRLF without bare LF');
  assert(!/[\u0080-\uffff]/.test(cmd),'launcher must contain ASCII-only command text');
}
assert(router.includes('iPad mini Safari 访问以下局域网地址')&&
  router.includes('上方端口是实际监听端口')&&
  router.includes('当前是【仅本机模式】'),
  'startup must distinguish a usable LAN address from loopback');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
assert(css.includes('v7.128 · iPad mini portrait')&&css.includes('orientation:portrait'));
console.log('PASS v7.128: loopback default, LAN CIDR and DNS Host checks, same-origin, Windows launcher and iPad mini portrait');
