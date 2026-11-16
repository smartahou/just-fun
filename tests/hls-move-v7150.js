#!/usr/bin/env node
'use strict';
// v7.150: temporary HLS filesystem fixtures. No access to user's library.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/server/36-hls-move.js'),'utf8');
function fixture(hash=true){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jf-move-hls-'));
  const src=hash?'data/'+('1'.repeat(32)):'data/old';
  const dst=hash?'data/'+('2'.repeat(32)):'data/new';
  const sub=hash?'3'.repeat(32):'segments';
  const folder=src+'/'+sub;
  const names=hash?
    {master:'4'.repeat(32),segment:'5'.repeat(32),nested:'6'.repeat(32),key:'7'.repeat(32)}:
    {master:'movie.m3u8',segment:'part.ts',nested:'part2.ts',key:'secret.key'};
  const full=dir=>path.join(root,...dir.split('/'));
  for(const dir of ['data',src,dst,folder])fs.mkdirSync(full(dir),{recursive:true});
  fs.writeFileSync(path.join(full(src),names.master),
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="secret.key"\n'+
    '#EXTINF:4,\npart.ts\n#EXTINF:4,\nsegments/part2.ts\n#EXT-X-ENDLIST\n');
  fs.writeFileSync(path.join(full(src),names.segment),'part-1');
  fs.writeFileSync(path.join(full(folder),names.nested),'part-2');
  fs.writeFileSync(path.join(full(src),names.key),'secret');
  const master={key:'a'.repeat(16),state:'ready',relativeDir:src,
    originalName:'movie.m3u8',originalExt:'.m3u8',managedName:names.master,
    hlsDetectedFormat:'playlist',readOnly:false,
    hlsAssets:[
      {id:'a'.repeat(32),original:'part.ts',stored:names.segment,ext:'.ts',state:'ready'},
      {id:'b'.repeat(32),original:'segments/part2.ts',stored:sub+'/'+names.nested,ext:'.ts',state:'ready'},
      {id:'c'.repeat(32),original:'secret.key',stored:names.key,ext:'.key',state:'ready'}
    ],
    hlsNestedPlaylists:[],hlsScanFingerprint:'old'};
  const child={key:'b'.repeat(16),state:'ready',relativeDir:folder,
    originalName:'part2.ts',originalExt:'.ts',managedName:names.nested,readOnly:false};
  const catalog={items:[master,child],folders:[
    {relativeDir:src,parentDir:'data',originalName:'old',state:'ready'},
    {relativeDir:dst,parentDir:'data',originalName:'new',state:'ready'},
    {relativeDir:folder,parentDir:src,originalName:'segments',state:'ready'}
  ]};
  const safeMediaRelativeDir=d=>d==='source'?'':d.startsWith('source/')?d.slice(7):d;
  const managedPath=item=>path.join(root,safeMediaRelativeDir(item.relativeDir||''),item.managedName);
  const external={errorOnRename:0,errorOnSave:0,renameCount:0,saveCount:0};
  let committed=null;
  const localFs=Object.assign({},fs,{
    renameSync(from,to){
      external.renameCount++;
      if(external.renameCount===external.errorOnRename)throw Error('injected rename failure');
      return fs.renameSync(from,to);
    }
  });
  const ctx={fs:localFs,path,crypto,catalog,targetDir:root,HASH_ENABLED:hash,
    scanRunning:false,jfHlsChildKeys:new Set([child.key]),
    jfHlsIsPlaylist:item=>String(item.originalExt)==='.m3u8',
    jfHlsDirectVideo:item=>Boolean(['mp4','webm'].includes(item.hlsDetectedFormat)),
    jfHlsBinaryTs:item=>item.hlsDetectedFormat==='mpegts',
    jfHlsReady:item=>!item.hlsError&&Array.isArray(item.hlsAssets)&&
      item.hlsAssets.length>0&&item.hlsAssets.every(a=>a.state==='ready'),
    jfHlsRuntimeCache:new WeakMap(),
    safeMediaRelativeDir,safeOriginalFilename:name=>{
      assert(typeof name==='string'&&name&&name!=='.'&&name!=='..'&&!/[\\/<>:"|?*]/.test(name));
      return name;
    },
    safeManagedName:name=>/^[a-f0-9]{32}$/.test(name),
    makeManagedName:()=>crypto.randomBytes(16).toString('hex'),
    managedPath,
    verifyIndexedMediaSource:managedPath,
    jfHlsStoredPath:(item,stored)=>{
      const origin=path.dirname(managedPath(item));
      const file=path.resolve(origin,...stored.split('/'));
      const rel=path.relative(origin,file);
      assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));
      const stat=fs.lstatSync(file);
      assert(stat.isFile()&&!stat.isSymbolicLink());
      return file;
    },
    saveCatalog:()=>{
      external.saveCount++;
      if(external.saveCount===external.errorOnSave)throw Error('injected catalog failure');
      committed=JSON.stringify(catalog);
    }
  };
  vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'36-hls-move.js'});
  const exists=(dir,name)=>fs.existsSync(path.join(full(dir),name));
  return {root,src,dst,sub,folder,names,master,child,catalog,ctx,external,
    full,exists,get committed(){return committed},dispose:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function verifyMoved(f){
  const {master,child,dst,names,catalog}=f;
  assert.equal(master.relativeDir,dst,'master moved');
  assert(f.exists(dst,names.master),'master physical file moved');
  assert(!f.exists(f.src,names.master),'source master gone');
  assert.equal(child.key,'b'.repeat(16),'indexed child identity retained');
  assert(child.relativeDir.startsWith(dst+'/'),'indexed nested TS moved');
  assert(f.exists(child.relativeDir,child.managedName),'nested TS physically present');
  assert.equal(catalog.pendingHlsMove,undefined,'move journal cleared');
  assert.equal(master.hlsScanFingerprint,undefined,'force fresh manifest scan');
  const folder=catalog.folders.find(x=>x.parentDir===dst&&x.originalName==='segments');
  assert(folder,'logical HLS nested directory mapped');
  for(const asset of master.hlsAssets){
    const file=path.resolve(f.full(dst),...asset.stored.split('/'));
    assert(fs.statSync(file).isFile(),'all HLS assets preserved');
  }
}
(async()=>{
  for(const hash of [false,true]){
    // Success with an indexed child, nested hash directories and key assets.
    const f=fixture(hash);
    try{
      assert.equal(f.ctx.jfMoveHlsGroup([f.master],f.dst),1,
        'one user video should not count three hidden HLS assets');
      verifyMoved(f);
      // Integration with the REAL HLS indexer after a moved Hash package:
      // original URI paths must still resolve, and TS children stay hidden.
      const hlsSource=fs.readFileSync(
        path.join(root,'src/server/35-hls-playlists.js'),'utf8');
      const scanCtx={fs,path,crypto,Buffer,catalog:f.catalog,
        targetDir:f.root,HASH_ENABLED:hash,
        MIME_BY_EXT:{'.ts':'video/mp2t'},
        safeMediaRelativeDir:f.ctx.safeMediaRelativeDir,
        safeManagedName:f.ctx.safeManagedName,
        managedPath:f.ctx.managedPath,
        saveCatalog:()=>{},streamMedia:()=>{}};
      vm.createContext(scanCtx);
      vm.runInContext(hlsSource,scanCtx,{filename:'35-hls-playlists.js'});
      await scanCtx.jfHlsScan();
      assert.equal(f.master.hlsError,undefined,'moved HLS still indexes');
      assert.equal(f.master.hlsAssets.length,3,'no HLS resources lost after rescan');
      assert(scanCtx.jfHlsReady(f.master),'moved playlist still playable');
      assert(vm.runInContext('jfHlsChildKeys',scanCtx).has(f.child.key),
        'indexed .ts child must remain hidden after repeated scans');
    }finally{f.dispose();}
    // Any disk error must restore every moved file and its original metadata.
    const failed=fixture(hash);
    try{
      failed.external.errorOnRename=2;
      assert.throws(()=>failed.ctx.jfMoveHlsGroup([failed.master],failed.dst),
        /injected rename failure/);
      assert(failed.exists(failed.src,failed.names.master));
      assert(failed.exists(failed.src,failed.names.segment));
      assert(failed.exists(failed.folder,failed.names.nested));
      assert.equal(failed.master.relativeDir,failed.src);
      assert.equal(failed.catalog.pendingHlsMove,undefined);
    }finally{failed.dispose();}
    // Catalog-save errors must also roll filesystem moves back.
    const failedSave=fixture(hash);
    try{
      failedSave.external.errorOnSave=2;
      assert.throws(()=>failedSave.ctx.jfMoveHlsGroup([failedSave.master],failedSave.dst),
        /injected catalog failure/);
      assert(failedSave.exists(failedSave.src,failedSave.names.master));
      assert.equal(failedSave.master.relativeDir,failedSave.src);
      assert.equal(failedSave.catalog.pendingHlsMove,undefined);
    }finally{failedSave.dispose();}
    // Moving only a single mislabeled MP4 .m3u8 is safe; it has no assets.
    const disguised=fixture(hash);
    try{
      disguised.master.hlsDetectedFormat='mp4';
      disguised.master.hlsAssets=[];
      assert.equal(disguised.ctx.jfMoveHlsGroup([disguised.master],disguised.dst),1);
      assert(disguised.exists(disguised.dst,disguised.names.master));
      assert(disguised.exists(disguised.src,disguised.names.segment),
        'unrelated files are never moved with a direct video');
    }finally{disguised.dispose();}
    // A different playlist referring to the same physical TS blocks moves.
    const shared=fixture(hash);
    try{
      const other={key:'c'.repeat(16),relativeDir:shared.src,
        state:'ready',originalName:'shared.m3u8',managedName:'shared.m3u8',
        originalExt:'.m3u8',hlsDetectedFormat:'playlist',
        hlsAssets:[{id:'d'.repeat(32),original:'part.ts',
          stored:shared.names.segment,ext:'.ts',state:'ready'}]};
      fs.writeFileSync(path.join(shared.full(shared.src),'shared.m3u8'),'#EXTM3U');
      shared.catalog.items.push(other);
      assert.throws(()=>shared.ctx.jfMoveHlsGroup([shared.master],shared.dst),/共用/);
      assert(shared.exists(shared.src,shared.names.master));
      assert.equal(shared.catalog.pendingHlsMove,undefined);
    }finally{shared.dispose();}
    // An interrupted rename may be restored on next startup, before scanning.
    const crash=fixture(hash);
    try{
      const from=path.join(crash.full(crash.src),crash.names.master);
      const to=path.join(crash.full(crash.dst),crash.names.master);
      crash.catalog.pendingHlsMove={version:1,phase:'moving',
        files:[{from:path.relative(crash.root,from).split(path.sep).join('/'),
          to:path.relative(crash.root,to).split(path.sep).join('/')}],
        directories:[]};
      fs.renameSync(from,to);
      crash.ctx.jfRecoverPendingHlsMove();
      assert(fs.existsSync(from)&&!fs.existsSync(to));
      assert.equal(crash.catalog.pendingHlsMove,undefined);
    }finally{crash.dispose();}
    console.log('PASS HLS media group move/rollback/recovery '+(hash?'Hash':'original'));
  }
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
