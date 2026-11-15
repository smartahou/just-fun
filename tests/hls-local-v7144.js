#!/usr/bin/env node
'use strict';
// v7.144: isolated local HLS/hash regression. Never touches the user's library.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const os=require('node:os'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/server/35-hls-playlists.js'),'utf8');
const mime={'.ts':'video/mp2t','.m3u8':'application/vnd.apple.mpegurl'};
function fixture(hash){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'justfun-hls-'));
  const folder=path.join(root,'nested');fs.mkdirSync(folder);
  const playlist='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000\nnested/low.m3u8\n';
  const child='#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../secret.key"\n#EXT-X-MAP:URI="../init.mp4"\n#EXTINF:4,\nlow.ts\n#EXT-X-ENDLIST\n';
  const name=hash?'a'.repeat(32):'movie.m3u8';
  fs.writeFileSync(path.join(root,name),playlist);
  fs.writeFileSync(path.join(folder,'low.m3u8'),child);
  fs.writeFileSync(path.join(root,'secret.key'),'0123456789abcdef');
  fs.writeFileSync(path.join(root,'init.mp4'),'init');
  const tsName=hash?'b'.repeat(32):'low.ts';
  fs.writeFileSync(path.join(folder,tsName),'transport-stream-payload');
  const main={key:'1234567890abcdef',managedName:name,originalName:'movie.m3u8',
    originalExt:'.m3u8',state:'ready',relativeDir:'',kind:'video'};
  const segment={key:'fedcba0987654321',managedName:tsName,originalName:'low.ts',
    originalExt:'.ts',state:'ready',relativeDir:'source/nested',kind:'video'};
  const catalog={items:[main,segment],folders:[]};
  let writes=0;
  const ctx={fs,path,crypto,targetDir:root,HASH_ENABLED:hash,catalog,MIME_BY_EXT:mime,
    safeMediaRelativeDir:d=>d.startsWith('source/')?d.slice(7):d==='source'?'':d,
    safeManagedName:n=>/^[a-f0-9]{32}$/.test(n),
    managedPath:item=>path.join(root,item.relativeDir.startsWith('source/')?
      item.relativeDir.slice(7):'',item.managedName),
    saveCatalog:()=>{writes++;},
    streamMedia:(req,res,item,file)=>{
      res.writeHead(200,{'Content-Type':item.mime});
      res.end(fs.readFileSync(file));
    }};
  vm.createContext(ctx);
  vm.runInContext(source,ctx,{filename:'35-hls-playlists.js'});
  const dispose=()=>fs.rmSync(root,{recursive:true,force:true});
  return {ctx,root,main,segment,get writes(){return writes;},dispose};
}
function response(){
  return {status:0,headers:{},body:null,
    writeHead(status,headers={}){this.status=status;this.headers=headers;},
    end(data){this.body=data;}};
}
for(const hash of [false,true]){
  const f=fixture(hash);
  try{
    f.ctx.jfHlsScan();
    assert.equal(f.main.hlsError,undefined,'valid playlists scanned');
    assert.equal(f.main.hlsAssets.length,4,'child playlist, segment, init and key');
    assert(vm.runInContext('jfHlsChildKeys',f.ctx).has(f.segment.key),
      'TS segment suppressed as independent video');
    for(const asset of f.main.hlsAssets){
      assert.equal(asset.state,'ready');
      const actual=path.join(f.root,...asset.stored.split('/'));
      assert(fs.existsSync(actual),'manifest resource reachable');
      assert(asset.id.match(/^[a-f0-9]{32}$/),'anonymous resource id');
      if(hash)assert.match(path.basename(actual),/^[a-f0-9]{32}$/,'all HLS components anonymized');
      else assert.equal(asset.stored,asset.original,'original names kept with Hash off');
    }
    const parent=response();
    f.ctx.jfHlsServe({method:'GET'},parent,f.main,'');
    assert.equal(parent.status,200);
    assert.match(parent.headers['Content-Type'],/mpegurl/);
    const child=f.main.hlsAssets.find(a=>a.ext==='.m3u8');
    assert(parent.body.includes('/api/hls/'+f.main.key+'/'+child.id));
    assert(!parent.body.includes('nested/low.m3u8'),'source URI rewritten');
    const nested=response();
    f.ctx.jfHlsServe({method:'GET'},nested,f.main,child.id);
    assert.equal(nested.status,200);
    for(const asset of f.main.hlsAssets.filter(a=>a.ext!=='.m3u8')){
      assert(nested.body.includes('/api/hls/'+f.main.key+'/'+asset.id),
        'nested references rewritten: '+asset.original);
    }
    const ts=f.main.hlsAssets.find(a=>a.ext==='.ts'),segmentResponse=response();
    f.ctx.jfHlsServe({method:'GET'},segmentResponse,f.main,ts.id);
    assert.equal(segmentResponse.body.toString(),'transport-stream-payload');
    assert.equal(segmentResponse.headers['Content-Type'],'video/mp2t');
    const writes=f.writes;
    f.ctx.jfHlsScan();
    assert.equal(f.main.hlsAssets.length,4);
    assert.equal(f.writes,writes,'unchanged tree does not rewrite catalog');
    // A crash after physical rename but before final index save must recover.
    ts.state='pending';
    f.ctx.jfHlsScan();
    assert.equal(ts.state,'ready');
    assert.throws(()=>f.ctx.jfHlsRelative('../escape.ts'),/越界|超出/);
    assert.throws(()=>f.ctx.jfHlsRelative('https://example.org/live.ts'),/本地/);
    assert.throws(()=>f.ctx.jfHlsRelative('..\\escape.ts'),/本地/);
    console.log('HLS '+(hash?'Hash':'original')+' fixture PASS');
  }finally{f.dispose();}
}
