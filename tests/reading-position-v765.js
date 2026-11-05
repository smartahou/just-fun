#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),client=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const server=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
function extract(start,end){
  const a=client.indexOf(start),b=client.indexOf(end,a+start.length);
  assert(a>=0&&b>a,'function segment exists '+start);
  return client.slice(a,b);
}
const pageSource=extract('function jfDeskPageForAnchor(','function jfDeskCurrentAnchor(){');
const restoreSource=extract('function jfDeskRestoreScrollTarget(','function jfDeskCurrentPosition(){');
const helpers=vm.runInNewContext(pageSource+'\n'+restoreSource+'\n({page:jfDeskPageForAnchor,scroll:jfDeskRestoreScrollTarget})');
const p=(chapter,offset)=>[{chapter,offset}];
const pages=[p(0,0),p(0,100),p(0,200),p(1,0),p(1,100),p(1,200)];
assert.equal(helpers.page(pages,0,150,1),1);
assert.equal(helpers.page(pages,0,150,2),0);
assert.equal(helpers.page(pages,0,250,2),2);
assert.equal(helpers.page(pages,1,150,2),4);
assert.equal(helpers.page(pages,1,999,1),5);
assert.equal(helpers.page(pages,9,100,2),0);
assert.equal(helpers.scroll(0,810,100,10),700,'caret lands at same viewport y');
assert.equal(helpers.scroll(300,80,100,20),260,'existing scroll is accounted for');
assert.equal(helpers.scroll(0,50,100,20),0,'never scroll negative');
assert(client.includes("jfDeskRestoring=true;\n  jfReadCenter.classList.add('jf-reading-opening')"),'opening is gated');
assert(client.includes("range=valid?jfDeskRangeAtOffset(first,offset):null"),'character anchor preferred');
assert(client.includes("jfReadCenter.scrollTo({top:absoluteTop,behavior:'instant'})"),'resume snaps immediately');
assert(client.includes("mode:'paged'"),'paper-book persists its own mode');
assert(client.includes("jfDeskPageIndex=jfDeskPageForAnchor(jfDeskPages,number"),'paper-book reopens to stored page');
assert(client.includes("if(jfReader.hidden||jfDeskRestoring)return"),'scroll events blocked during restore');
assert(client.includes("if(book&&!jfDeskOutline?.nativePdf&&!jfDeskRestoring)"),'closing during restore keeps existing position');
assert(client.includes("window.addEventListener(type,interrupt,{passive:true,capture:true})"),'user navigation cancels late restore on any focused element');
assert(server.includes("const anchorY=Number.isFinite(body.anchorY)"),'server stores viewport offset');
assert(server.includes("const mode=body.mode==='paged'"),'server stores mode');
assert(css.includes(".jfReader .jfReadCenter{scroll-behavior:auto!important}"),'no CSS initiated open animation');
assert(css.includes(".jfReader .jfReadCenter.jf-reading-opening{opacity:0"),'no visible first-page flash');
console.log('reading-position-v765 PASS: 9 helper cases plus restore / persistence guards');
