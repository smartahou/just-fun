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
  return text.replace(needle, replacement);
};

function build() {
  const style = manifest.styles.map(read).join('');
  const browser = manifest.scripts.map(read).join('');
  // Build must fail before writing dist if any client script is invalid.
  new vm.Script(browser, {filename:'bundled-browser.js'});
  const layout = read(manifest.html);
  const styleTag = '<style>\n<!-- JUSTFUN_CSS -->\n</style>';
  const scriptTag = '<script>\n/* JUSTFUN_JS */\n</script>';
  let html = replaceOnce(layout, styleTag, '<style>'+style+'</style>');
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
    sourceBytes:Buffer.byteLength(source), sourceSha256:hash(source),
    htmlBytes:Buffer.byteLength(html), htmlSha256:hash(html),
    browserBytes:Buffer.byteLength(browser), browserSha256:hash(browser),
    cssBytes:Buffer.byteLength(style), cssSha256:hash(style),
    files:manifest.server.length+manifest.styles.length+manifest.scripts.length+2,
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
