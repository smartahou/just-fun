#!/usr/bin/env node
'use strict';
// v7.66: stable paper-book toolbar, immersive Escape, per-book mode persistence.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'src/client/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
function section(from,to){const a=js.indexOf(from),b=js.indexOf(to,a+from.length);assert(a>=0&&b>a,'missing '+from);return js.slice(a,b);}
const panelStart=html.indexOf('<div id="jfReadTypographyPanel"');
const paperStart=html.indexOf('id="jfReadPaperAged"');
const wearStart=html.indexOf('id="jfReadPaperWear"');
const panelEnd=html.indexOf('</div></div>',panelStart);
assert(panelStart>=0&&paperStart>panelStart&&wearStart>paperStart&&panelEnd>wearStart,'paper controls are inside typography popover');
const pagedStart=html.indexOf('id="jfReadPaged"'),excerptStart=html.indexOf('id="jfReadExcerpt"');
assert(pagedStart>0&&excerptStart>pagedStart,'book and excerpt controls retain order');
assert(!html.slice(pagedStart,excerptStart).includes('id="jfReadPaperAged"'),'old paper no longer inserts a new header button');
assert(!html.slice(pagedStart,excerptStart).includes('id="jfReadPaperWear"'),'wear select no longer shifts header');
assert.equal((html.match(/id="jfReadPaperAged"/g)||[]).length,1);
assert.equal((html.match(/id="jfReadPaperWear"/g)||[]).length,1);
assert(css.includes('.jfReader.paged .jfReadTypographyPanel .jfReadPaperSettings'),'popover paper group in paper mode');
const esc=section("document.addEventListener('keydown',event=>{","// v6.85 · Adjustable divider");
const modal=esc.indexOf("if(!jfNotesPanel.hidden)"),immersive=esc.indexOf("else if(!jfReader.hidden&&jfDeskImmersive)"),close=esc.indexOf("else if(!jfReader.hidden){jfDeskCloseReader()");
assert(modal>=0&&immersive>modal&&close>immersive,'Escape closes nested overlays first, then immersive, then book');
assert(esc.includes("jfDeskImmersiveToggle();event.stopImmediatePropagation();event.preventDefault();return;"),'Esc consumed after exit immersive');
assert(js.includes("jfDeskSyncImmersive(false);\n  // A previous popover"),'fresh reader resets immersive chrome');
assert(js.includes("jfDeskSyncImmersive(false);\n  document.getElementById('jfReadTypographyPanel').hidden=true;"),'closing resets immersive state');
const immersiveCode=section('function jfDeskSyncImmersive(enabled){','function jfDeskImmersiveOnScroll(){');
const fake={
  jfDeskImmersive:true,jfDeskImmersiveLast:0,
  jfReader:{hidden:false,classList:{values:new Set(),toggle(k,v){if(v)this.values.add(k);else this.values.delete(k);}}},
  jfReadCenter:{scrollTop:321},
  document:{getElementById(){return {classList:{values:new Set(),toggle(k,v){if(v)this.values.add(k);else this.values.delete(k);}},setAttribute(k,v){this[k]=v}}}},
  jfDeskMessage(){},jfDeskPaged:false,jfDeskPagedRelayoutWithBusy:async()=>{}
};
const fn=vm.runInNewContext(immersiveCode+'\n({sync:jfDeskSyncImmersive,toggle:jfDeskImmersiveToggle})',fake);
fn.sync(false);
assert.equal(fake.jfReader.classList.values.has('immersive-hidden'),false,'Escape exit removes hidden-chrome class');
assert.equal(fake.jfDeskImmersiveLast,321,'reader geometry anchor retained');
// The mode writer is awaited on close, and writes the mode for the active book.
const mode=section('async function jfDeskPagedToggle(){',"document.getElementById('jfReadTheme').addEventListener");
assert(mode.includes("mode:jfDeskPaged?'paged':'flow'"),'instant book-specific mode saved');
assert(mode.includes("const bookId=jfDeskBook.id,session=jfDeskSession"),'book identity isolated');
assert(!mode.includes("jfDeskSetPref({theme:'paper'})"),'no global theme mutation on mode switch');
assert(js.includes('try{await jfDeskPagedSwitchPromise;}'),'close waits for mode persistence');
assert(js.includes('catch{return false;} // keep the book open when a mode write fails'),'failed mode save cannot close book');
assert(mode.includes("jfDeskPagedSwitchPromise.catch(()=>false)"),'second click never propagates an unhandled promise');
assert(mode.includes('clearTimeout(jfDeskProgressTimer);'),'rollback clears pending progress save');
assert(mode.includes('try{await jfDeskShowChapter(Math.max(0,position.chapter)'),'rollback restores old layout');
assert(js.includes("const savedMode=jfDeskWorkspace.progress[bookId]?.mode;"),'per-book mode restored');
assert(js.includes("jfDeskPaged=outline.format==='EPUB'&&savedMode==='paged';"),'EPUB opens in saved mode');
assert(css.includes('#jfReadPaperWear'),'paper wear styles retained');
console.log('PASS v7.66 reader interactions: Escape precedence, toolbar stability, per-book mode and synchronous immersive state');
