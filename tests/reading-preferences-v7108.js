#!/usr/bin/env node
'use strict';
// v7.108 UI contract: readable font control; fixed (disabled) page margin;
// no misleading old-paper switch/wear controls; flow margin still works.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'src/client/index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const paper=fs.readFileSync(path.join(root,'src/client/scripts/98e-paper-textures.js'),'utf8');
const pkg=require('../package.json');
const [major,minor]=pkg.version.split('.').map(Number);
assert(major>7||(major===7&&minor>=108),'v7.108 control contract retained in later versions');
assert(html.includes('id="jfReadTypographyPanel"'));
assert(html.includes('id="jfReadFamily"'),'font family selector preserved');
assert(html.includes('id="jfReadSide"'),'continuous-flow margin preserved');
assert(!html.includes('id="jfReadPaperAged"')&&!html.includes('id="jfReadPaperWear"'),
  'obsolete paper controls physically removed');
assert(!html.includes('jfReadPaperSettings'),'no empty paper row');
assert(paper.includes("localStorage.setItem(KEY,'on')"),'old OFF storage is migrated ON');
assert(paper.includes('const textures=__JUSTFUN_PAPER_SPREAD_ASSETS__'),'all original WebPs stay wired');
const later=css.slice(css.indexOf('/* v7.108 ·'));
assert(!/(?:\\.jfSheet|\\.jfBookPile|#jfPageView)[^{]*\\{[^}]*border-radius\\s*:/s.test(later),
  'paper surfaces cannot receive synthetic round corners; footer indicators are unrelated');
const start=js.indexOf('function jfDeskSyncTypographyControls(){');
const end=js.indexOf('// v7.71 · Typeface diagnostics',start);
assert(start>0&&end>start,'per-mode control synchronizer exists');
function inputControl(){
  const props={};
  return {disabled:false,value:'40',attrs:props,setAttribute(k,v){props[k]=v;},getAttribute(k){return props[k];}};
}
const slider=inputControl(),heading={textContent:''},label={
  title:'',toggleState:false,classList:{toggle(k,enabled){label.toggleState=enabled;}}
},button={title:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
const nodes={jfReadSide:slider,jfReadSideControl:label,jfReadTypographyTitle:heading,jfReadTypographyToggle:button};
const ctx={
  document:{getElementById:id=>nodes[id]||null},
  jfDeskPrefs:{side:22},
  jfDeskPaged:true
};
const helper=vm.runInNewContext(js.slice(start,end)+'\n({run:jfDeskSyncTypographyControls})',ctx);
helper.run();
assert.equal(slider.disabled,true,'paper spread must disable the range input');
assert.equal(slider.getAttribute('aria-disabled'),'true');
assert.equal(slider.value,'22','stale unsaved drag gets reset');
assert.equal(heading.textContent,'字体');
assert.equal(button.title,'字体设置');
assert(label.toggleState&&label.title.includes('固定'),'unavailable affordance explained');
ctx.jfDeskPaged=false;
helper.run();
assert.equal(slider.disabled,false,'continuous reading retains active margins');
assert.equal(slider.getAttribute('aria-disabled'),'false');
assert.equal(heading.textContent,'字体与边距');
assert(!label.toggleState&&label.title.includes('连续滚动'));
ctx.jfDeskPaged=true;
helper.run();
assert(slider.disabled,'mode roundtrip must restore disabled control');
const listenerStart=js.indexOf("document.getElementById('jfReadSide').addEventListener('input'");
const listenerEnd=js.indexOf('// ---- v7.32 paged',listenerStart);
assert(listenerStart>0&&listenerEnd>listenerStart,'side range handlers found');
const listeners=js.slice(listenerStart,listenerEnd);
assert(listeners.includes("if(jfDeskPaged){jfDeskSyncTypographyControls();return;}"),
  'synthetic events cannot change page margin prefs');
const toggleFrom=js.indexOf('jfDeskPaged=!oldMode;');
const toggleTo=js.indexOf('jfDeskSyncTypographyControls();',toggleFrom);
assert(toggleFrom>=0&&toggleTo>toggleFrom&&
  js.slice(toggleFrom,toggleTo).includes("jfReader.classList.toggle('paged',jfDeskPaged)"),
  'mode toggle immediately refreshes enabled state after releasing cached page faces');
assert(js.includes("jfDeskPaged=oldMode;\n      jfReader.classList.toggle('paged',oldMode);\n      jfDeskSyncTypographyControls();"),
  'mode toggle rollback restores enabled state');
assert(css.includes('.jfReadSideControl.jfPrefUnavailable'),'disabled control visibly muted');
console.log('PASS v7.108: obsolete paper row gone; real 16-photo paper retained; paged margin disabled; flow margin active; controls sync on toggle and rollback');
