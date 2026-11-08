#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const block=css.slice(css.lastIndexOf('/* v7.102 · The revised WebP photographs'),css.indexOf('/* v7.92 ·'));
assert(block.includes('border-radius:0!important'),'real photo alpha must own corners');
assert(!/clamp\(1[78]px,2/.test(block),'legacy large UI-like page corners must be absent');
const manifest=require('../assets/paper-spreads/manifest.json');
assert.equal(manifest.version,'3.2-subtle-natural-corners');
assert.equal(manifest.assets.length,16);
assert(manifest.assets.every(x=>x.corner_revision&&x.original_sha256));
assert(manifest.assets.every(x=>x.v7102_sha256),'v7.102 reference preserved');
console.log('PASS v7.103: subtle photo alpha corners, 8 matched pairs, no UI-radius');
