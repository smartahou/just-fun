#!/usr/bin/env node
'use strict';
// v7.77 · Regression grounded in the *structure*, not copied prose, of the
// supplied "道光皇帝" EPUB (OEBPS/text00007.html and text00008.html):
// <p>paragraph</p><div class="empty"></div><p>paragraph</p>.
// Keep original copyrighted EPUBs out of the repository.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const foundation=fs.readFileSync(path.join(root,'src/client/styles/00-foundation.css'),'utf8');
const a=js.indexOf('function jfDeskIsBookBlank(');
const b=js.indexOf('function jfDeskBlocksFor(sec){',a);
assert(a>=0&&b>a,'book-blank classifier exists before constructing blocks');
const blank=vm.runInNewContext(js.slice(a,b)+'\njfDeskIsBookBlank');
function el(tag,text='',classes=[],media=false){
  return {tagName:tag,textContent:text,
    classList:{contains:name=>classes.includes(name)},
    querySelector:()=>media?{}:null};
}
assert(blank(el('DIV','',['empty'])),'real EPUB div.empty is a deliberate blank');
assert(blank(el('P','\n \u3000')),'old P-only empty handling retained');
assert(!blank(el('DIV','')), 'anonymous empty div might carry a page break');
assert(!blank(el('DIV','','empty')),'plain div is not a source spacer');
assert(!blank(el('DIV','真实正文',['empty'])),'text-bearing div.empty is not suppressed');
assert(!blank(el('DIV','',['empty'],true)),'image or other media cannot be hidden');
assert(!blank(el('H2','',['empty'])),'chapter headings remain untouched');
// Structural contract: blank blocks are cloned, tagged, and the original
// text-offset accounting in chapter pagination is unchanged.
const segment=js.slice(b,js.indexOf('async function jfDeskPagedLayout(',b));
assert(segment.includes('const blank=jfDeskIsBookBlank(node);'),'classifier is used on every source block');
assert(segment.includes("printed.classList.add('jfPrintQuietBreak')"),'first blank is a quiet page pause');
assert(segment.includes("printed.classList.add('jfPrintRedundantBlank')"),'repeat spacers collapse');
assert(segment.includes('const printed=document.importNode(node,true);'),'only printer clones are modified');
assert(segment.includes('acc+=node.textContent.length;'),'original character offsets unchanged');
const styles=css.slice(css.indexOf('/* ===== v7.77 · EPUB empty-spacer isolation'));
assert(styles.length>300,'spacer isolation CSS appended');
assert(foundation.includes('.empty{padding:70px;'),'verified cross-module class collision is tracked');
assert(styles.includes('.jfReader.paged #jfPageView .jfSheetBody > :is(p,div).jfPrintQuietBreak{'),
  'both empty p and div are safely shortened, in measured and displayed sheets');
assert(styles.includes(':is(p,div).jfPrintRedundantBlank{'),
  'consecutive blank divs are eliminated');
assert(styles.includes('.jfReader.paged #jfPageView .jfSheetBody div.empty{'),
  'generic app empty padding cannot leak into paged EPUB');
assert(styles.includes('.jfReader .jfReadHtml div.empty{'),
  'continuous EPUB reader also isolates .empty from application global rules');
assert(styles.includes('padding:0!important;'),'global 70px padding overridden');
assert(!/\.empty\s*\{/.test(styles),'global app .empty UI is not changed');
assert(js.includes('jfDeskPageForAnchor(jfDeskPages,number'),'saved book position handling unchanged');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(pkg.version,'7.77.0');
console.log('PASS v7.77: 137-source-spacer class collision, safe filtering, measured CSS parity and anchors');
