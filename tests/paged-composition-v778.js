#!/usr/bin/env node
'use strict';
// v7.78 · Reproduce the composed-vs-isolated measurement conflict which
// previously created a 3-line blank at an otherwise splittable page end.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
class Text{
  constructor(value){this.nodeType=3;this.nodeValue=value;}
  get textContent(){return this.nodeValue;}
  cloneNode(){return new Text(this.nodeValue);}
}
class Block{
  constructor(str='',tag='P'){
    this.tagName=tag;this.childNodes=str?[new Text(str)]:[];
    this._classes=new Set();
    this.classList={add:x=>this._classes.add(x),contains:x=>this._classes.has(x)};
  }
  get textContent(){return this.childNodes.map(x=>x.textContent).join('');}
  cloneNode(deep){
    const b=new Block('',this.tagName);
    if(deep)b.childNodes=this.childNodes.map(x=>x.cloneNode());
    for(const x of this._classes)b.classList.add(x);
    return b;
  }
  appendChild(fragment){
    if(fragment instanceof Text)this.childNodes.push(fragment);
    else this.childNodes.push(...fragment.nodes);
  }
  querySelector(){return null;}
  querySelectorAll(){return [];}
  getBoundingClientRect(){return {height:this.textContent.length};}
}
class Fragment{
  constructor(){this.nodes=[];}
  appendChild(node){this.nodes.push(node);}
}
const doc={
  createDocumentFragment(){return new Fragment();},
  createTreeWalker(root){let i=0,nodes=root.childNodes.filter(n=>n.nodeType===3);
    return {nextNode(){return nodes[i++]||null;}};},
  createRange(){let a,b,c,d;return {
    setStart(n,o){a=n;b=o;},setEnd(n,o){c=n;d=o;},
    cloneContents(){if(a!==c)throw Error('fixture uses one text node');return new Text(a.nodeValue.slice(b,d));}
  };}
};
const host={
  nodes:[],replaceChildren(...items){this.nodes=items.flatMap(x=>x instanceof Fragment?x.nodes:[x]);},
  get firstElementChild(){return this.nodes[0]||null;},
  get scrollHeight(){
    // Isolated p margins/first-child metrics are not equal to an assembled
    // column. Simulate the 8px composed cost which invalidated one-pass split.
    return this.nodes.reduce((n,x)=>n+x.getBoundingClientRect().height,0)+(this.nodes.length>1?8:0);
  }
};
const context={document:doc,NodeFilter:{SHOW_TEXT:4},
  getComputedStyle:el=>({lineHeight:'10px',fontSize:'10px',marginTop:'0px',marginBottom:'0px'}),
  window:{JF_DEBUG_SPLIT:false}};
vm.runInNewContext(engine,context);
const paginate=context.window.JFPageEngine.paginate;
const input=[{chapter:2,key:'a',offset:0,node:new Block('甲'.repeat(70))},
             {chapter:2,key:'b',offset:70,node:new Block('乙'.repeat(100))}];
const pages=paginate(input,100,host);
assert.equal(pages.length,2,'two leaves with safe fragment, not three');
assert.equal(pages[0].length,2,'a two-line prefix fits after one-line backoff');
assert(pages[0][1].node.textContent.length>=20,'minimum two lines retained on this leaf');
assert(host.scrollHeight>=0,'measurement completed');
const head=pages[0][1],tail=pages[1][0];
assert.equal(head.node.textContent+tail.node.textContent,'乙'.repeat(100),'every original character appears exactly once');
assert.equal(tail.offset,70+head.node.textContent.length,'tail anchor continues at exact char offset');
assert(tail.node.classList.contains('jfPrintContinuation'),'split tail carries its own first-line exception');
assert(!input[1].node.classList.contains('jfPrintContinuation'),'original source paragraph not mutated');
assert(css.includes('line-height:1.69;'),'paper typography line-height agrees with version');
assert(css.includes('margin:0 0 .47em;'),'measured and rendered paragraph margin agree');
assert(css.includes('p:first-child:not(.jfPrintContinuation)'),'new page-top paragraphs retain book indent');
assert(css.includes('p.jfPrintContinuation{'),'carried-over paragraphs start without an extra indent');
assert(css.includes('color:rgba(53,37,24,.95)'),'denser but translucent paper pigment');
assert(!engine.includes('available-=lh*MIN_LINES'),'never reduce below two-line split budget');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,'7.78.0');
console.log('PASS v7.78: assembled split rescue, exact offsets, 2-line rule, paper indent and ink');
