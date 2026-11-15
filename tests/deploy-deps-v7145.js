#!/usr/bin/env node
'use strict';
// v7.144.1: no npm calls, worktree mutation or access to personal media.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const deploy=read('scripts/local-deploy-v723.js');
const build=read('scripts/build.js');
const manifest=JSON.parse(read('package.json'));
const lock=JSON.parse(read('package-lock.json'));
new Function(deploy);
new Function(build);
assert.equal(manifest.dependencies['hls.js'],'1.6.15');
assert.equal(lock.packages['node_modules/hls.js'].version,'1.6.15');
assert.equal(manifest.version,lock.version);
assert(deploy.includes('function vendorOk(nodeModules,stage)'));
assert(deploy.includes("['node_modules/'+name]") ||
  deploy.includes("['node_modules/'+name]"),'compare dependencies against candidate lockfile');
assert(deploy.includes("const modules=ensureVendor(stage);"),
  'install/check dependencies after candidate checkout');
assert(!deploy.includes('  ensureVendor();\n  let stage=null'),
  'do not check only the old checkout before staging');
assert(deploy.includes("const lockKey=hash(path.join(stage,'package-lock.json'))"),
  'cache keyed by candidate lock');
assert(deploy.includes("const args=['ci','--no-audit','--no-fund','--prefer-offline']"),
  'reproducible npm ci for candidate lock');
assert(deploy.includes("fs.symlinkSync(modules,path.join(stage,'node_modules')"),
  'isolate dependency changes from the original node_modules junction');
assert(build.includes('nodePaths:vendorHlsNodePaths()'),
  'bootstrapping must work under the old launcher, not only after update');
assert(build.includes("path.join(root,'.jf-build-deps')")&&
  build.includes("path.join(temporary,'package.json')")&&
  build.includes("'--no-save','--package-lock=false','--ignore-scripts'"),
  'standalone npm fallback must not walk into checkout');
assert(read('.gitignore').includes('.jf-build-deps/'));
console.log('PASS: candidate dependency preflight, clean HLS bootstrap and lock integrity contracts');
