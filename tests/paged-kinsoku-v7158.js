#!/usr/bin/env node
'use strict';
// v7.158 regression: page splitting must follow Chinese 禁则. The Tang-poetry
// EPUB (唐诗三百首新注) produced a leaf that OPENED with a stranded "》" because
// the Range split fell between a 《…》 pair; a page must never start with a
// closing mark, end with a dangling opener, or cut through a pair.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
assert(engine.includes('function snapKinsokuOffset('),'kinsoku boundary snapper exists');
assert(engine.includes('function splitCandidates('),'split walks only legal candidates');
assert(engine.includes('var cuts=splitCandidates(el.textContent,best);'),'trySplit uses the snapped candidates');
assert(css.includes('text-justify:none!important'),'verse/commentary opt out of inter-ideograph stretch');
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
  appendChild(node){this.childNodes.push(node);}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  getBoundingClientRect(){return {height:this.textContent.length};}
}
const doc={
  createDocumentFragment(){return {nodes:[],appendChild(n){this.nodes.push(n);}};},
  createTreeWalker(root){let i=0;const nodes=root.childNodes.filter(n=>n.nodeType===3);
    return {nextNode(){return nodes[i++]||null;}};},
  createRange(){let a,b,c,d;return{
    setStart(n,o){a=n;b=o;},setEnd(n,o){c=n;d=o;},
    cloneContents(){if(a!==c)throw Error('fixture uses one text node');return new Text(a.nodeValue.slice(b,d));}
  };}
};
const host={
  nodes:[],replaceChildren(...items){this.nodes=items.flatMap(x=>x.nodes?x.nodes:[x]);},
  get firstElementChild(){return this.nodes[0]||null;},
  get scrollHeight(){return this.nodes.reduce((n,x)=>n+x.getBoundingClientRect().height,0);}
};
const context={document:doc,NodeFilter:{SHOW_TEXT:4},
  getComputedStyle:()=>({lineHeight:'10px',fontSize:'10px',marginTop:'0px',marginBottom:'0px'}),
  window:{JF_DEBUG_SPLIT:false}};
vm.runInNewContext(engine,context);
const paginate=context.window.JFPageEngine.paginate;
// A · the binary-search boundary (char 100) falls INSIDE 《大历诗略》.
const pairText='甲'.repeat(97)+'《大历诗略》'+'乙'.repeat(17);
const pagesA=paginate([{chapter:1,key:'p',offset:0,node:new Block(pairText)}],100,host);
assert.equal(pagesA.length,2,'pair case splits into two leaves');
const headA=pagesA[0][0].node.textContent,tailA=pagesA[1][0].node.textContent;
assert.equal(headA+tailA,pairText,'every character lands exactly once');
assert(tailA.startsWith('《大历诗略》'),'a 《…》 pair is never cut across leaves, got tail '+JSON.stringify(tailA.slice(0,8)));
assert(!/^[，。！？；：、）》】』」〕〉”’]/.test(tailA),'no leaf opens with a closing mark');
// B · the boundary lands exactly before a closing mark (char 100 is 》).
const closerText='甲'.repeat(100)+'》'+'乙'.repeat(19);
const pagesB=paginate([{chapter:1,key:'q',offset:0,node:new Block(closerText)}],100,host);
assert.equal(pagesB.length,2,'closer case splits into two leaves');
const headB=pagesB[0][0].node.textContent,tailB=pagesB[1][0].node.textContent;
assert.equal(headB+tailB,closerText,'every character lands exactly once');
assert(!tailB.startsWith('》'),'a stranded 》 never opens a leaf, got '+JSON.stringify(tailB.slice(0,4)));
const lastB=headB.slice(-1);
assert(!'《（“【『「〈〔'.includes(lastB),'a leaf never ends with a dangling opener, got '+JSON.stringify(lastB));
console.log('PASS v7.158: kinsoku page splits — pairs stay whole, no stranded closers/openers');
