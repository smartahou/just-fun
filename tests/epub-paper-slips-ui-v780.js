#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../src/client/scripts/98f-epub-paper-tabs.js'),'utf8');
const registry=new Map(),docEvents={};
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.hidden=false;
    this.style={setProperty(k,v){this[k]=v}};
    const classes=new Set();
    this.classList={toggle(k,on){if(on)classes.add(k);else classes.delete(k)},contains:k=>classes.has(k)};
    this.attrs={};this.textContent='';this.parentElement=null;
  }
  set id(v){this._id=v;registry.set(v,this)}
  get id(){return this._id}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n)}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes)}
  setAttribute(k,v){this.attrs[k]=String(v)}
  getAttribute(k){return this.attrs[k]}
  addEventListener(k,fn){this.listeners[k]=fn}
  click(){this.listeners.click?.({target:this})}
  contains(n){return n===this||this.children.some(c=>c.contains?.(n))}
  querySelectorAll(selector){
    const result=[];
    const visit=node=>{
      for(const c of node.children){
        if(selector==='[data-jf-chapter]'&&c.dataset.jfChapter!==undefined)result.push(c);
        if(selector==='[data-jf-note-ref]'&&c.dataset.jfNoteRef!==undefined)result.push(c);
        visit(c);
      }
    };
    visit(this);return result;
  }
  closest(selector){return selector==='[data-chapter]'?null:null}
}
const host=new Element('div');host.id='jfPageView';
const document={getElementById:k=>registry.get(k)||null,createElement:k=>new Element(k),
  addEventListener(k,fn){(docEvents[k]??=[]).push(fn)}};
const state={window:{},document,jfDeskPaged:true,
  jfDeskOutline:{format:'EPUB',toc:[{title:'卷一',chapter:1,depth:0},{title:'卷二',chapter:2,depth:1}]},
  jfDeskChapter:1,jfDeskBook:{id:'book'},jfDeskSession:1,
  jfDeskShowChapter:async()=>{},jfDeskFlow:[],jfDeskPageForAnchor:()=>0,
  jfDeskPages:[],jfDeskPagedGeometry:()=>({two:true}),jfDeskPagedRender:()=>{},
  jfDeskUpdateProgress:()=>{},setTimeout,clearTimeout,Map,Set,Number,String,Array,
  console,NodeFilter:{SHOW_TEXT:4}};
vm.runInNewContext(source,state);
const api=state.window.JFEpubPaperToc;
assert(api,'controller should initialize');
api.sync();
const tocTab=registry.get('jfEpubTocTab'),tocPane=registry.get('jfEpubTocPane');
const noteTab=registry.get('jfEpubNoteTab'),notePane=registry.get('jfEpubNotePane');
assert.equal(tocTab.hidden,false);
assert.equal(noteTab.hidden,true);
tocTab.click();
assert.equal(tocPane.hidden,false);
assert.equal(tocPane.children[1].children.length,2,'real entries from outline');
const left=new Element('div'),right=new Element('div');
const marker=new Element('span');marker.dataset.jfNoteRef='stable-note-id';
left.append(marker);
const notes=new Map([[1,[{id:'stable-note-id',text:'翠微：青翠的山色。',quote:'翠微'}]]]);
api.renderNotes(left,right,notes);
assert.equal(noteTab.hidden,false,'left-only note reveals 笺');
noteTab.click();
assert.equal(notePane.hidden,false);
assert.equal(tocPane.hidden,true,'opening 笺 closes 目');
assert.equal(notePane.children[1].children.length,1);
assert.equal(notePane.children[1].children[0].children[1].textContent,'翠微：青翠的山色。');
const another=new Element('div');another.append(Object.assign(new Element('span'),{dataset:{jfNoteRef:'stable-note-id'}}));
api.renderNotes(left,another,notes);
assert.equal(notePane.hidden,true,'page rerender closes the note drawer');
noteTab.click();
assert.equal(notePane.children[1].children.length,1,'duplicate left and right target deduplicated');
api.renderNotes(new Element('div'),new Element('div'),notes);
assert.equal(noteTab.hidden,true,'note-free spread removes tab entirely');
tocTab.click();
for(const f of docEvents.keydown||[])f({key:'Escape',stopPropagation(){}});
assert.equal(tocPane.hidden,true,'Esc closes TOC');
state.jfDeskPaged=false;api.sync();
assert.equal(tocTab.hidden,true,'non-paper mode hides TOC');
console.log('PASS v7.80 UI: TOC data, paper notes current-spread, dedup, mutual exclusion, Esc and mode gate');
