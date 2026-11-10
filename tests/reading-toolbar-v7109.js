#!/usr/bin/env node
'use strict';
// v7.109: the screenshot-scramble mode is gone, while night-theme is truly
// disabled only for physically paginated old-paper books.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'src/client/index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const version=require('../package.json').version;
const [major,minor]=version.split('.').map(Number);
assert(major>7||(major===7&&minor>=109),'v7.109 toolbar contract still applies to later readers');
assert(!html.includes('id="jfReadMask"'),'obsolete scramble toggle removed from header');
assert(!js.includes('jfReadMaskEnabled')&&!js.includes('jfReadToggleMask')&&
  !js.includes('jfReadApplyMask')&&!js.includes("getElementById('jfReadMask')"),
  'scramble implementation and stale selectors removed');
assert(!css.includes('.jfReadMaskBtn'),'retired control style removed');
assert(html.includes('id="jfReadExcerpt"'),'real excerpts remain available');
assert(js.includes("if(jfDeskOutline.format==='EPUB')return jfDeskShowChapterFlow("),
  'EPUB always uses the normal continuous chapter flow');
assert(js.includes("function jfReadRenderChapterContent()"),'ordinary TXT/EPUB content rendering remains');

const from=js.indexOf('function jfReadRenderChapterContent(){');
const to=js.indexOf('const jfNotesPanel=',from);
assert(from>=0&&to>from);
const cls=new Set();
const readerText={innerHTML:'',textContent:'',classList:{
  add:k=>cls.add(k),remove:k=>cls.delete(k)
}};
const renderCtx={jfReadText:readerText,jfReadHtml:'<p>真实 EPUB 文本</p>',jfReadVisualText:'TXT文本'};
const render=vm.runInNewContext(js.slice(from,to)+'\njfReadRenderChapterContent',renderCtx);
render();
assert.equal(readerText.innerHTML,'<p>真实 EPUB 文本</p>');
assert(cls.has('jfReadHtml'));
renderCtx.jfReadHtml='';
render();
assert.equal(readerText.textContent,'TXT文本','TXT no longer depends on retired mask');
assert(!cls.has('jfReadHtml'));

const start=js.indexOf('function jfDeskSyncTypographyControls(){');
const end=js.indexOf('// v7.71 · Typeface diagnostics',start);
assert(start>0&&end>start);
const control=()=>({value:'22',disabled:false,title:'',attrs:{},classes:new Set(),
  setAttribute(k,v){this.attrs[k]=v;},
  getAttribute(k){return this.attrs[k]},
  classList:{toggle(){}}});
const slider=control(),heading={textContent:''},toggle=control(),theme=control();
theme.classList={toggle(k,on){if(on)theme.classes.add(k);else theme.classes.delete(k)}};
const label={title:'',classList:{toggle(){}}};
const nodes={jfReadSide:slider,jfReadSideControl:label,
  jfReadTypographyTitle:heading,jfReadTypographyToggle:toggle,jfReadTheme:theme};
const ctx={jfDeskPaged:false,jfDeskPrefs:{side:22},
  document:{getElementById:id=>nodes[id]||null}};
const sync=vm.runInNewContext(js.slice(start,end)+'\njfDeskSyncTypographyControls',ctx);
sync();
assert.equal(theme.disabled,false,'night toggle available in flow');
assert.equal(theme.attrs['aria-disabled'],'false');
assert.equal(theme.title,'切换阅读主题');
ctx.jfDeskPaged=true;
sync();
assert.equal(theme.disabled,true,'night toggle actually disabled in real book');
assert.equal(theme.attrs['aria-disabled'],'true');
assert(theme.title.includes('固定纸张'));
assert(theme.classes.has('jfPrefUnavailable'),'disabled theme gets a visible muted class');
assert.equal(slider.disabled,true,'previously established fixed page margins still disabled');
ctx.jfDeskPaged=false;
sync();
assert.equal(theme.disabled,false,'night toggle restored when leaving book mode');
assert(!theme.classes.has('jfPrefUnavailable'),'disabled appearance removed in flow');
assert.equal(slider.disabled,false);
assert(js.includes("if(jfDeskPaged){jfDeskSyncTypographyControls();return;}\n  jfDeskSetPref({theme:"),
  'synthetic click cannot alter stored theme in paper mode');
const toggleStart=js.indexOf('jfDeskPaged=!oldMode;');
const syncEnd=js.indexOf('jfDeskSyncTypographyControls();',toggleStart);
assert(toggleStart>=0&&syncEnd>toggleStart&&
  js.slice(toggleStart,syncEnd).includes("jfReader.classList.toggle('paged',jfDeskPaged)"),
  'mode switch updates night control after cache disposal');
assert(js.includes("jfDeskPaged=oldMode;\n      jfReader.classList.toggle('paged',oldMode);\n      jfDeskSyncTypographyControls();"),
  'failed mode switch restores night control');
assert(css.includes('#jfReadTheme:disabled:hover')&&css.includes('opacity:.30!important'),
  'fixed-paper theme button visibly greyed out');
assert(!css.slice(css.indexOf('/* v7.109:')).includes('background-image:'),
  'no visual book texture changes');
console.log('PASS v7.109: scramble mode removed; EPUB/TXT normal content; theme disabled only in book; flow theme and excerpts retained');
