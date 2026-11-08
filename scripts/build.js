'use strict';
// Just Fun offline bundler: Node built-ins only. No npm install or network.
// Source files are joined in the explicit order recorded in build.manifest.json.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const child = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build.manifest.json'), 'utf8'));
// Normalize Git's optional Windows CRLF checkout on textual source inputs only.
// This preserves the byte-identical LF release artifact across operating systems.
// Never normalize binary assets or the third-party PDF.js distribution.
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const hash = t => crypto.createHash('sha256').update(t).digest('hex');
const replaceOnce = (text, needle, replacement) => {
  if (text.split(needle).length !== 2) throw Error('Missing/duplicate build marker: '+needle);
  // A function replacement is required: third-party bundles legitimately contain
  // "$&" and "$'" sequences, which String.replace would otherwise expand into the
  // matched marker and corrupt the emitted script.
  return text.replace(needle, () => replacement);
};

// Third-party browser libraries are real npm dependencies now: esbuild bundles
// src/client/vendor.js into one IIFE that exposes window.JF. The legacy modules
// still concatenate in shared scope, so their ordering guarantees are unchanged.
function bundleVendor() {
  let esbuild;
  try { esbuild = require('esbuild'); }
  catch { throw Error('Missing esbuild: run npm install before building'); }
  const entry = path.join(root, manifest.vendor || 'src/client/vendor.js');
  if (!fs.existsSync(entry)) throw Error('Missing vendor entry: ' + manifest.vendor);
  const result = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: ['chrome110'],
    minify: false,
    write: false,
    legalComments: 'none',
    logLevel: 'silent'
  });
  const out = result.outputFiles && result.outputFiles[0];
  if (!out) throw Error('esbuild produced no vendor bundle');
  return out.text;
}

function build() {
  const style = manifest.styles.map(read).join('');
  // These exact original WebPs are bundled into the offline HTML, NOT fetched
  // from the network. Verify every byte against the user's supplied manifest.
  const paper=manifest.paperAssets;
  if(!paper||paper.files?.length!==16)throw Error('Missing 16 paired WebP paper assets in build.manifest.json');
  const paperMeta=JSON.parse(read(paper.manifest));
  if(paperMeta.pairs!==8||paperMeta.images!==16||paperMeta.assets?.length!==16)
    throw Error('Unexpected paper texture manifest');
  // Source masters remain byte-for-byte as approved by the user. The offline
  // runtime embeds visually faithful quality-83 WebP transcodes at the same
  // 960x1440 dimensions; all 16 SHA-256 digests are checked before packaging.
  // These small bundles are static assets. The reader never processes pixels.
  if(!Array.isArray(paper.runtimeBundles)||paper.runtimeBundles.length!==8)
    throw Error('Missing 8 optimized paper runtime bundles');
  const runtime=paper.runtimeBundles.flatMap((rel,g)=>{
    const group=JSON.parse(read(rel));
    if(group.group!==g+1||group.assets?.length!==2)throw Error('Invalid runtime paper group '+rel);
    return group.assets;
  });
  const paperUrls=[];
  const paperAssetHashes=[],paperRuntimeHashes=[];
  let paperRuntimeBytes=0;
  for(let i=0;i<16;i++){
    const rel=paper.files[i],spec=paperMeta.assets[i];
    if(rel!=='assets/paper-spreads/'+spec.file)throw Error('Paper asset ordering mismatch: '+rel);
    const data=fs.readFileSync(path.join(root,rel));
    if(data.length!==spec.bytes||!data.subarray(0,4).equals(Buffer.from('RIFF'))||
       !data.subarray(8,12).equals(Buffer.from('WEBP')))
      throw Error('Invalid paper WebP '+rel);
    const digest=crypto.createHash('sha256').update(data).digest('hex');
    if(digest!==spec.sha256)throw Error('Paper texture SHA-256 mismatch: '+rel);
    const small=runtime[i];
    if(!small||small.file!==spec.file||small.sourceSha256!==digest)
      throw Error('Paper runtime source identity mismatch: '+spec.file);
    const optimized=Buffer.from(small.base64,'base64');
    const optimizedDigest=crypto.createHash('sha256').update(optimized).digest('hex');
    if(optimized.length!==small.bytes||optimizedDigest!==small.runtimeSha256||
       optimized.toString('base64')!==small.base64||
       !optimized.subarray(0,4).equals(Buffer.from('RIFF'))||
       !optimized.subarray(8,12).equals(Buffer.from('WEBP')))
      throw Error('Paper runtime WebP verification failed: '+spec.file);
    paperAssetHashes.push(digest);
    paperRuntimeHashes.push(optimizedDigest);
    paperRuntimeBytes+=optimized.length;
    paperUrls.push('data:image/webp;base64,'+small.base64);
  }
  // v7.88 · user's 11 matched outer-edge states are source-verified on every
  // build, and embedded into offline HTML. No runtime filesystem or server URL.
  const stackFiles=manifest.stackAssets;
  if(!stackFiles||stackFiles.files?.length!==22)throw Error('Expected 22 user paper-stack WebPs');
  const stackMeta=JSON.parse(read(stackFiles.manifest));
  if(stackMeta.canvas?.width!==64||stackMeta.canvas?.height!==1440||
      stackMeta.progress_states?.length!==11)throw Error('Invalid paper-stack state manifest');
  const stackUrls=[],stackAssetHashes=[];
  let stackAssetBytes=0;
  for(let i=0;i<11;i++){
    const state=stackMeta.progress_states[i];
    if(!state||state.percent!==i*10)throw Error('Unordered paper stack state '+i);
    for(const side of ['left','right']){
      const expected='stack-'+String(i*10).padStart(3,'0')+'-'+side+'.webp';
      const rel='assets/paper-stacks/'+expected;
      if(state[side]!==expected||stackFiles.files[i*2+(side==='right'?1:0)]!==rel)
        throw Error('Mismatched paper stack pair '+rel);
      const data=fs.readFileSync(path.join(root,rel));
      if(data.length!==state[side+'_bytes']||data.toString('ascii',0,4)!=='RIFF'||
         data.toString('ascii',8,12)!=='WEBP')throw Error('Invalid paper-stack image '+rel);
      const digest=crypto.createHash('sha256').update(data).digest('hex');
      if(digest!==state[side+'_sha256'])throw Error('Paper-stack SHA mismatch: '+rel);
      // These supplied images are WebP lossless VP8L (not VP8X).
      // Its 4-byte size word begins at offset 21: width and height are
      // packed into two 14-bit fields, with a +1 offset for each.
      if(data.toString('ascii',12,16)!=='VP8L'||data[20]!==0x2f)
        throw Error('Expected RGBA lossless WebP paper-stack source: '+rel);
      const bits=data.readUInt32LE(21);
      if((bits&0x3fff)+1!==64||((bits>>>14)&0x3fff)+1!==1440)
        throw Error('Wrong paper-stack canvas dimensions: '+rel);
      stackAssetHashes.push(digest);
      stackAssetBytes+=data.length;
      stackUrls.push('data:image/webp;base64,'+data.toString('base64'));
    }
  }

  // v7.96: scan-derived thin-folio runtime photographs (original v7.88 sources and v7.90 bundle remain
  // byte-identical in Git for rollback). Strictly verify each original WebP,
  // native dimensions, transparency and checksum BEFORE embedding it offline.
  const photoMeta=JSON.parse(read('assets/paper-stacks/embedded-v797.json'));
  if(photoMeta.canvas?.width!==64||photoMeta.canvas?.height!==1440||
     photoMeta.progress_states?.length!==11)
    throw Error('Invalid photographed fore-edge bundle');
  const photoHashes=[];
  let photoBytes=0;
  for(let i=0;i<11;i++){
    const state=photoMeta.progress_states[i];
    if(!state||state.percent!==i*10)throw Error('Unordered photographed stack state '+i);
    for(const side of ['left','right']){
      const name='stack-'+String(i*10).padStart(3,'0')+'-'+side+'.webp';
      if(state[side]!==name||typeof state[side+'_base64']!=='string')
        throw Error('Wrong photographed stack file: '+i+' '+side);
      const b64=state[side+'_base64'];
      const data=Buffer.from(b64,'base64');
      if(data.toString('base64')!==b64||
         data.length!==state[side+'_bytes']||
         data.toString('ascii',0,4)!=='RIFF'||
         data.toString('ascii',8,12)!=='WEBP'||
         data.toString('ascii',12,16)!=='VP8X'||
         !(data[20]&0x10)||
         data.readUIntLE(24,3)+1!==64||
         data.readUIntLE(27,3)+1!==1440)
        throw Error('Invalid alpha/dimensions for photographed stack '+name);
      const sum=crypto.createHash('sha256').update(data).digest('hex');
      if(sum!==state[side+'_sha256'])
        throw Error('Photographed stack hash mismatch '+name);
      if((i===0&&side==='left')||(i===10&&side==='right')){
        if(data.length>600)throw Error('An empty book-edge endpoint must be transparent: '+name);
      }
      photoHashes.push(sum);
      photoBytes+=data.length;
      stackUrls[i*2+(side==='right'?1:0)]='data:image/webp;base64,'+b64;
    }
  }
  // v7.98 · Offline photographed hardcover boards; preserve all old-paper photos.
  const coverSpec=JSON.parse(read('assets/paper-covers/embedded-v799.json'));
  if(coverSpec.version!=='7.99.0'||coverSpec.canvas?.width!==960||
     coverSpec.canvas?.height!==600||coverSpec.covers?.length!==6||
     coverSpec.border_slice!==32||coverSpec.purpose!=='cover-border-only-transparent-center')
    throw Error('Invalid offline hardcover set');
  const coverUrls=[];
  for(let n=0;n<6;n++){
    const c=coverSpec.covers[n],raw=Buffer.from(c.base64,'base64');
    if(c.filename!=='cover-'+String(n+1).padStart(2,'0')+'.webp'||
       raw.toString('base64')!==c.base64||raw.length!==c.bytes||
       raw.toString('ascii',0,4)!=='RIFF'||raw.toString('ascii',8,12)!=='WEBP'||
       crypto.createHash('sha256').update(raw).digest('hex')!==c.sha256)
      throw Error('Invalid hardcover photo '+n);
    coverUrls.push('data:image/webp;base64,'+c.base64);
  }
  let injected=false,stackInjected=false,coverInjected=false;
  const browser=manifest.scripts.map(p=>{
    const code=read(p);
    if(p==='src/client/scripts/98e-paper-textures.js'){
      injected=true;
      return replaceOnce(code,'__JUSTFUN_PAPER_SPREAD_ASSETS__',JSON.stringify(paperUrls));
    }
    if(p==='src/client/scripts/98e3-paper-stacks.js'){
      stackInjected=true;
      return replaceOnce(code,'__JUSTFUN_PAPER_STACK_ASSETS__',JSON.stringify(stackUrls));
    }
    if(p==='src/client/scripts/98e4-paper-covers.js'){
      coverInjected=true;
      return replaceOnce(code,'__JUSTFUN_PAPER_COVER_ASSETS__',JSON.stringify(coverUrls));
    }
    return code;
  }).join('');
  if(!injected)throw Error('Paper texture module missing from build order');
  if(!stackInjected)throw Error('Paper stack module missing from build order');
  if(!coverInjected)throw Error('Hardcover module missing from build order');
  // Build must fail before writing dist if any client script is invalid.
  new vm.Script(browser, {filename:'bundled-browser.js'});
  const layout = read(manifest.html);
  const vendorSource = bundleVendor();
  new vm.Script(vendorSource, {filename:'bundled-vendor.js'});
  const styleTag = '<style>\n<!-- JUSTFUN_CSS -->\n</style>';
  const vendorTag = '<script>\n/* JUSTFUN_VENDOR */\n</script>';
  const scriptTag = '<script>\n/* JUSTFUN_JS */\n</script>';
  let html = replaceOnce(layout, styleTag, '<style>'+style+'</style>');
  html = replaceOnce(html, vendorTag, '<script>'+vendorSource+'</script>');
  html = replaceOnce(html, scriptTag, '<script>'+browser+'</script>');
  if (!html.startsWith('<!doctype html>') || !html.endsWith('</html>'))
    throw Error('Generated HTML wrapper is invalid');
  if (html.includes('JUSTFUN_CSS') || html.includes('JUSTFUN_JS'))
    throw Error('Build marker leaked into HTML');
  // JSON.stringify is deliberate: unlike a nested template literal it cannot
  // change browser backslashes, backticks, or ${...} template expressions.
  const htmlFunction = '\n\nfunction htmlPage() {\n  return '+JSON.stringify(html)+';\n}\n';
  const favicon = fs.readFileSync(path.join(root, 'assets/favicon.ico')).toString('base64');
  // Reproducible vendor import: run `npm install --no-save --ignore-scripts pdfjs-dist@6.4.299`
  // exactly ONCE in the development directory. No npm dependency at runtime.
  const pdfRoot = path.join(root, 'node_modules', 'pdfjs-dist');
  const pkgPath = path.join(pdfRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) throw Error('Missing pdfjs-dist: run npm install --no-save --ignore-scripts pdfjs-dist@6.4.299');
  const pdfPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pdfPkg.version !== '6.4.299') throw Error('PDF.js version mismatch: expected pdfjs-dist@6.4.299, got '+pdfPkg.version);
  const pdfAssets = {};
  function addAsset(rel, file) {
    const real = path.join(pdfRoot, file);
    if (!fs.statSync(real).isFile()) throw Error('Missing PDF.js asset '+file);
    pdfAssets[rel] = fs.readFileSync(real).toString('base64');
  }
  addAsset('pdf.min.mjs', 'build/pdf.min.mjs');
  addAsset('pdf.worker.min.mjs', 'build/pdf.worker.min.mjs');
  for (const dir of ['cmaps','standard_fonts','wasm','image_decoders']) {
    const parent=path.join(pdfRoot,dir);
    if (!fs.existsSync(parent)) {if(dir==='cmaps'||dir==='standard_fonts')throw Error('Missing PDF.js resource directory '+dir);else continue;}
    for (const filename of fs.readdirSync(parent).sort()) {
      if (filename.startsWith('.') || !fs.statSync(path.join(parent,filename)).isFile()) continue;
      if(!/^[\w.\-]+$/.test(filename)) throw Error('Unexpected PDF.js asset filename');
      addAsset(dir+'/'+filename,dir+'/'+filename);
    }
  }
  const pdfPayload = Buffer.from(JSON.stringify(pdfAssets)).toString('base64');
  const pieces = manifest.server.map(read);
  if (pieces.length !== manifest.server.length) throw Error('Unexpected server module count');
  const faviconIndex=pieces.findIndex(x=>x.includes('__JUSTFUN_FAVICON_BASE64__'));
  if(faviconIndex<0)throw Error('Missing favicon source');
  pieces[faviconIndex] = replaceOnce(pieces[faviconIndex], '__JUSTFUN_FAVICON_BASE64__', favicon);
  const pdfAssetIndex=pieces.findIndex(x=>x.includes('__JUSTFUN_PDFJS_ASSETS__'));
  if(pdfAssetIndex<0)throw Error('Missing PDF.js asset placeholder');
  pieces[pdfAssetIndex]=replaceOnce(pieces[pdfAssetIndex],'__JUSTFUN_PDFJS_ASSETS__',pdfPayload);
  const source = pieces.slice(0,5).join('') + htmlFunction + pieces.slice(5).join('');
  new vm.Script(source, {filename:'dist/douyin.js'});
  const out = path.join(root, manifest.output);
  fs.mkdirSync(path.dirname(out), {recursive:true});
  const temp = out+'.tmp-'+process.pid+'.js';
  fs.writeFileSync(temp, source, 'utf8');
  const check = child.spawnSync(process.execPath, ['--check', temp], {encoding:'utf8', timeout:15000});
  if (check.status !== 0) {
    fs.rmSync(temp, {force:true});
    throw Error('Node syntax check failed: '+(check.stderr||check.error||''));
  }
  fs.renameSync(temp, out);
  const report = {
    output:manifest.output,
    vendorBytes:Buffer.byteLength(vendorSource), vendorSha256:hash(vendorSource),
    sourceBytes:Buffer.byteLength(source), sourceSha256:hash(source),
    htmlBytes:Buffer.byteLength(html), htmlSha256:hash(html),
    browserBytes:Buffer.byteLength(browser), browserSha256:hash(browser),
    cssBytes:Buffer.byteLength(style), cssSha256:hash(style),
    files:manifest.server.length+manifest.styles.length+manifest.scripts.length+2,
    paperTextures:paperUrls.length,paperTextureAssetsSha256:paperAssetHashes,
    paperRuntimeAssetSha256:paperRuntimeHashes,paperRuntimeBytes,
    paperStackStates:stackMeta.progress_states.length,paperStackAssetsSha256:stackAssetHashes,
    paperStackAssetBytes:stackAssetBytes,
    paperStackPhotoStates:photoMeta.progress_states.length,paperStackPhotoSha256:photoHashes,
    paperStackPhotoBytes:photoBytes,
    pdfjsVersion:pdfPkg.version,pdfjsAssets:Object.keys(pdfAssets).length,
    pdfjsModuleSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(pdfRoot,'build/pdf.min.mjs'))).digest('hex'),
    baselinePageIdentical:hash(html)===manifest.baselineRenderedHtmlSha256
  };
  fs.writeFileSync(path.join(root,'dist','build-report.json'), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  return report;
}

if (require.main === module) {
  try { build(); }
  catch(e) { console.error('[BUILD FAILED]',e.stack||e.message); process.exitCode=1; }
}
module.exports={build};
