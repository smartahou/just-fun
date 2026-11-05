#!/usr/bin/env node
'use strict';
// v7.71 · Optical photo plate layout, margin-sensitive edge mask, typography QA.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const extract=(start,end)=>{
  const a=js.indexOf(start),b=js.indexOf(end,a+start.length);
  assert(a>=0&&b>a,'missing code between '+start+' and '+end);
  return js.slice(a,b);
};
const plate=extract('function jfDeskIsPlateOnlyPage(','function jfDeskPagedRender(direction){');
const detector=extract('function jfDeskPalePlateEdges(','const jfDeskPlateDone=new WeakSet();');
const f=vm.runInNewContext(plate+detector+'\n({plate:jfDeskIsPlateOnlyPage,edge:jfDeskPalePlateEdges})',{
  jfDeskIsCaption:n=>n.tagName==='P'&&/^[（(]/.test(n.textContent||'')
});
const image=(label='')=>({tagName:'FIGURE',textContent:label,
  querySelectorAll(q){return q==='img'?[{}]:[]},
  querySelector(q){return q==='figcaption'?{textContent:label}:null}});
const p=t=>({tagName:'P',textContent:t,querySelectorAll(){return []}});
const asPage=(...nodes)=>nodes.map(node=>({node,chapter:2,offset:0}));
assert.equal(f.plate(asPage(image('历史照片（明信片）'))),true,'figure with caption');
assert.equal(f.plate(asPage(image())),true,'image-only page');
assert.equal(f.plate(asPage(image(),p('（明信片）'))),true,'standalone caption');
assert.equal(f.plate(asPage(image(),p('真正的历史长段落不应被居中排版。'))),false,'image with narrative');
assert.equal(f.plate(asPage(p('正常正文'))),false,'text alone is not a plate');
assert.equal(f.plate(asPage(image(),image())),false,'two images are not a lone photograph');
assert.equal(f.plate([]),false,'blank sheet stays blank');
function pixels(bottomDark=false,allDark=false){
  const w=120,h=120,pix=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=(y*w+x)*4;
    const pale=!allDark&&(x<10||x>=w-10||y<10||y>=h-10);
    const darkBand=bottomDark&&y>=h-12;
    const light=pale&&!darkBand;
    pix[k]=light?235:65;pix[k+1]=light?230:59;pix[k+2]=light?213:51;pix[k+3]=255;
  }
  return f.edge(pix,w,h);
}
assert.equal(pixels(), 'xy','light outer photo margins may soften on four sides');
assert.equal(pixels(true),'x','an original dark caption band is NEVER bottom-feathered');
assert.equal(pixels(false,true),'','dark full-bleed photos are left alone');
assert.equal(f.edge(new Uint8ClampedArray(20*20*4),20,20),'','tiny image does not get masked');
assert(js.includes("jfDeskPrintDiagnostics()"),'font QA diagnostic is accessible');
assert(js.includes("window.JFReaderPrintDiagnostics=jfDeskPrintDiagnostics"),'font QA console hook');
assert(js.includes('layoutMetricsMatch:parity'),'computed font geometry compared across rendered/measure boxes');
assert(js.includes('rasterDiffersFromGenericFallback'),'candidate font raster hints available');
assert(js.includes("jfDeskIsPlateOnlyPage(pageA)")&&js.includes("jfDeskIsPlateOnlyPage(pageB)"),'both leaves classified');
assert(css.includes(".jfSheet.jf-plate-only .jfSheetBody{"),'photo-only centre styling isolated');
assert(css.includes('justify-content:safe center'),'centred only if content fits');
assert(css.includes("img[data-jf-plate-edge='x']")&&css.includes("img[data-jf-plate-edge='y']")&&css.includes("img[data-jf-plate-edge='xy']"),'orientation-specific masks');
assert(!css.includes("img:not([data-jf-plate='done'])"),'blind photo mask removed');
assert(js.includes("const edge=jfDeskPalePlateEdges(px,c.width,c.height)"),'edge mask uses observed pixels');
assert(js.includes("if(edge)img.dataset.jfPlateEdge=edge"),'only observed pale rims get masks');
assert(js.includes("jfMeasureHost.className='jfPageMeasure jfSheetBody'"),'printed text still shares one measured layout');
assert(js.includes('jfDeskPageForAnchor(jfDeskPages,number'),'bookmarks and pagination remain intact');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,'7.71.0');
console.log('v7.71 PASS: font QA, photo-only classification, safe pale-edge detection, no pagination data changes');
