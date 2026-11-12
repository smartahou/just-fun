#!/usr/bin/env node
'use strict';
// v7.126: Manga pages are atomic, preserve source order, and do not force
// measured prose layout. This test runs without browser or external assets.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const comic=fs.readFileSync(path.join(root,'src/client/scripts/98d1-comic-pages.js'),'utf8');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
assert.equal(require('../package.json').version,'7.127.0');
class Element {
  constructor(tag='DIV',text='',natural=0){
    this.tagName=tag.toUpperCase();
    this.directText=text;
    this.children=[];this.dataset={};this.attrs={};
    this.naturalWidth=natural;this.naturalHeight=natural;
    this.className='';
    this.classList={
      contains:name=>this.className.split(' ').includes(name),
      add:name=>{this.className+=' '+name;}
    };
    this.style={setProperty:()=>{}};
  }
  get textContent(){return this.directText+this.children.map(x=>x.textContent).join('');}
  set textContent(value){this.directText=String(value);this.children=[];}
  appendChild(node){this.children.push(node);return node;}
  querySelectorAll(query){
    const tags=query==='img'?['IMG']:
      query.split(',').map(t=>t.toUpperCase());
    const matches=[];
    const visit=node=>{
      for(const ch of node.children){
        if(tags.includes(ch.tagName))matches.push(ch);
        visit(ch);
      }
    };
    visit(this);
    return matches;
  }
  querySelector(query){return this.querySelectorAll(query)[0]||null;}
  getAttribute(key){return this.attrs[key]||'';}
  cloneNode(deep){
    const c=new Element(this.tagName,this.directText,this.naturalWidth);
    c.naturalHeight=this.naturalHeight;
    c.attrs={...this.attrs};c.className=this.className;
    c.dataset={...this.dataset};
    if(deep)for(const child of this.children)c.appendChild(child.cloneNode(true));
    return c;
  }
}
function image(i,px=1000){
  const el=new Element('IMG','',px);el.naturalHeight=Math.round(px*1.45);
  el.attrs.src='/api/reading/epub-asset?id=abcd&src=page'+i+'.jpg';
  return el;
}
function sec(...children){const el=new Element('SECTION');children.forEach(x=>el.appendChild(x));return {n:3,el};}
const ctx={window:{},document:{createElement:t=>new Element(t)},Map,
  Image:class {set src(s){this._src=s;}decode(){return Promise.resolve();}},
  setTimeout:()=>{},console};
vm.runInNewContext(comic,ctx);
const api=ctx.window.JFComicPages;
assert.equal(typeof api.fromSection,'function');
const chapter=sec(new Element('H3','FILE:1'),image(1),image(2),image(3));
const items=api.fromSection(chapter);
assert.equal(items.length,3,'three scanned images form three physical leaves');
assert.deepEqual(Array.from(items,x=>x.comicIndex),[0,1,2]);
assert.equal(items[0].comicTotal,3);
assert(items.every(x=>x.comic));
assert.equal(items.map(x=>x.node.textContent).join(''),chapter.el.textContent,
  'no title/source characters removed');
assert(new Set(items.map(x=>x.offset)).size===3,'image-only anchors distinct');
const text=sec(new Element('P','这是一大段普通小说正文，'.repeat(30)),image(0));
assert.equal(api.fromSection(text),null,'illustrated prose must not become manga');
const glyph=sec(image(0,32));
assert.equal(api.fromSection(glyph),null,'small glyph must not become manga');
// A gallery of 800x300 horizontal comic panels is not three scanned pages.
const panel=sec(image(7));
panel.el.children[0].naturalWidth=800;
panel.el.children[0].naturalHeight=300;
assert.equal(api.fromSection(panel),null,'comic panel must not be a full-page scan');
const complex=new Element('DIV');
for(let i=0;i<3;i++)complex.appendChild(image(i));
assert.equal(api.fromSection(sec(complex)),null,'collage markup uses original paginator');
const host={
  childNodes:[],get firstChild(){return this.childNodes[0];},
  get lastChild(){return this.childNodes.at(-1);},
  get firstElementChild(){return this.firstChild;},
  get scrollHeight(){return this.childNodes.length*10;},
  replaceChildren(...nodes){this.childNodes=nodes;},
  appendChild(node){this.childNodes.push(node);},
  removeChild(node){this.childNodes.splice(this.childNodes.indexOf(node),1);}
};
const engineCtx={
  window:{},WeakMap,Number,Math,performance:{now:()=>0},
  getComputedStyle:()=>({lineHeight:'10px',fontSize:'10px',
    marginTop:'0',marginBottom:'0'})
};
vm.runInNewContext(engine,engineCtx);
const leaves=engineCtx.window.JFPageEngine.paginate(items,100,host);
assert.equal(leaves.length,3,'comic pages must not merge or split');
assert(leaves.every(page=>page.length===1&&page[0].comic),
  'every leaf is an original comic page');
assert.equal(engineCtx.window.JFPageEngine.diagnostics().columnMeasurements,0,
  'manga must bypass all DOM height probes');
api.warm(leaves,'bookA');
assert.equal(api.stats().warmed,3);
api.reset('bookB');
assert.equal(api.stats().warmed,0,'switching books frees decoded-image references');
// CSS must keep the original photographic old-paper surface and image ratio.
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const manga=css.slice(css.indexOf('/* ===== v7.127 ·'));
assert(manga.includes('mix-blend-mode:multiply!important;'),
  'comic whites must blend with the existing old-paper background');
assert(manga.includes('object-fit:contain!important'),
  'full manga artwork is always fitted without deformation');
assert(manga.includes('scale(var(--jf-comic-zoom,1))!important'),
  'blank-edge zoom is uniformly applied on both axes');
assert(!manga.includes('object-fit:cover!important'),
  'never crop panel artwork just to fill the view');
console.log('PASS v7.127 comic printed-paper and bounded aspect-safe crop');
console.log('PASS v7.126 comic reader: source, split boundaries, zero layout probes and bounded image cache');
