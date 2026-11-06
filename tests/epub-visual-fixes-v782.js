#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const reader=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const server=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
const tabs=fs.readFileSync(path.join(root,'src/client/scripts/98f-epub-paper-tabs.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const markStart=reader.indexOf('function jfDeskMarkInlineGlyphs(root){');
const markEnd=reader.indexOf('// Build a single printer paragraph',markStart);
assert(markStart>0&&markEnd>markStart,'real glyph classifier found');
let before='起语往往整策，道人四语景色霮',after='如沐';
const classes=new Set();
let marked='';
const cell={tagName:'TD',textContent:before+after,querySelectorAll(sel){return sel==='img'?[img]:[]}};
const img={
  className:'kindle-cn-inline-image',alt:'075-01',dataset:{},
  naturalWidth:34,naturalHeight:34,
  classList:{contains:v=>classes.has(v),add:v=>classes.add(v)},
  closest(sel){
    if(sel==='figure,figcaption,pre')return null;
    if(sel==='td,th'||sel==='p,li,blockquote,td,th')return cell;
    return null;
  }
};
const rootElement={querySelectorAll:k=>k==='img'?[img]:[]};
const context={
  document:{createRange(){
    return{selectNodeContents(){},setEndBefore(){this.side='before'},
      setStartAfter(){this.side='after'},toString(){return this.side==='before'?before:after}};
  }},
  jfDeskGlyphDimensions:()=>[34,34],
  jfDeskIsInlineGlyphShape:(w,h,l,r)=>w>0&&h>0&&l.length&&r.length
};
const mark=vm.runInNewContext(reader.slice(markStart,markEnd)+'\njfDeskMarkInlineGlyphs',context);
mark(rootElement);
assert.equal(img.dataset.jfInlineGlyph,'1','34x34 Calibre rare character inside table is inline ink');
assert(classes.has('jfInlineGlyph'),'classified bitmap adopts glyph styles');
assert(css.includes('.jfReader.paged .jfSheetBody :is(td,th) img.jfInlineGlyph'),
  'inline gaiji applies to both visible sheet and measurement probe');
assert(css.includes('p[class*="poem"]')&&css.includes('text-indent:0!important'),
  'poetry paragraphs do not inherit printed prose indentation');
const lastCss=css.slice(css.indexOf('/* ===== v7.82 ·'));
assert(lastCss.includes('#jfReadCenter.jfEpubDrawerOpen #jfPageView') &&
  lastCss.includes('transform:none!important'),'opening paper slip cannot shrink the book');
assert(lastCss.includes('.jfSheet>.jfSheetCurl')&&lastCss.includes('display:none!important'),
  'old overlay curl retired in photographic old-paper mode');
assert(lastCss.includes('calc(100% + 24px) calc(100% + 24px)'),
  'trim only peripheral scan rim without changing paper page boxes');
assert(tabs.includes("tab.textContent='目录'")||tabs.includes("tab.type='button';tab.textContent='目录'"),
  'side bookmark reads full 目录 instead of a lonely character');
assert(tabs.includes("noteTab.textContent='笺注'"),'side bookmark reads full 笺注');
assert(lastCss.includes('#jfEpubNoteTab[hidden]')&&
  lastCss.includes('display:none!important'),'note-free spreads MUST hide the side marker');
assert(tabs.includes("b.style.paddingLeft=(10+depth*22)+'px'"),
  'hierarchy is a valid pixel indentation, not invalid calc multiplication');
assert(tabs.includes('jfEpubNoteNumber')&&tabs.includes("n.number"),
  'note slips use source note numbers, not truncated raw markup quotes');
assert(server.includes('notes.push({id:key,number,text:found.text,quote})'),
  'annotated source number travels from verified book into the paper slips');
console.log('PASS v7.82: table inline gaiji, poem indent, stationary book, rim/overlay, hierarchy, note number');
