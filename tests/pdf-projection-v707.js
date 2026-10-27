// v7.07: parity with original v7.06 PDF render/mark/anchor arithmetic.
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),src=fs.readFileSync(path.join(root,'src/client/scripts/98c-pdf-projection.js'),'utf8');
const geo=vm.runInNewContext(src+';jfPdfProjection',{}, {timeout:2000});
assert(Object.isFrozen(geo));
let state=0x75ace213;const next=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
let samples=0;
for(let i=0;i<1000;i++){
  const x=next()*.75,y=next()*.75,w=Math.max(.001,next()*(1-x)),h=Math.max(.001,next()*(1-y));
  const area=[x,y,w,h],viewportWidth=180+next()*2300,viewportHeight=260+next()*2800;
  const strips=Array.from({length:1+i%5},()=>[x+next()*w*.4,y+next()*h*.4,w*.1,h*.1]);
  const freeze=JSON.stringify([area,strips]);
  const actual=JSON.parse(JSON.stringify(geo.cropRects(area,strips,viewportWidth,viewportHeight)));
  const expected=strips.map(s=>({x:(s[0]-x)*viewportWidth,y:(s[1]-y)*viewportHeight,w:s[2]*viewportWidth,h:s[3]*viewportHeight}));
  assert.deepEqual(actual,expected);
  assert.deepEqual(JSON.parse(JSON.stringify(geo.markStyle(area))),{left:area[0]*100+'%',top:area[1]*100+'%',width:area[2]*100+'%',height:area[3]*100+'%'});
  const box={top:-400+next()*1200,height:100+next()*1600},ratio=next();
  assert.equal(geo.zoomPosition(box,ratio),box.top+box.height*ratio);
  assert.equal(JSON.stringify([area,strips]),freeze,'inputs must not be mutated');
  samples++;
}
const ui=fs.readFileSync(path.join(root,'src/client/scripts/99a-pdfjs.js'),'utf8');
for(const op of ['cropRects','markStyle','zoomPosition'])assert(ui.includes('jfPdfProjection.'+op+'('),op+' not wired');
assert(ui.includes('jfPdfProjection.cropRects(mark.area,segments,viewport.width,viewport.height)'), 'the persisted-mark JPEG path must use mark.area, not an unbound area');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build.manifest.json'),'utf8'));
assert(manifest.scripts.indexOf('src/client/scripts/98c-pdf-projection.js')>manifest.scripts.indexOf('src/client/scripts/98b-pdf-geometry.js'));
assert(manifest.scripts.indexOf('src/client/scripts/98c-pdf-projection.js')<manifest.scripts.indexOf('src/client/scripts/99a-pdfjs.js'));
console.log('PASS v7.07 PDF projection: '+samples+' old-algorithm parity cases; viewport/crop/mark/zoom preserved.');
