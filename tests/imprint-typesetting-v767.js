#!/usr/bin/env node
'use strict';
// v7.67 EPUB CIP / imprint block typography and print ink: isolated guards.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const a=js.indexOf('function jfDeskIsImprintChapter(');
const b=js.indexOf('function jfDeskBlocksFor(sec){',a);
const end=js.indexOf('async function jfDeskPagedLayout(',b);
assert(a>=0&&b>a&&end>b,'pagination front matter helpers exist');
const fragment=js.slice(a,end);
const decorate=vm.runInNewContext(fragment+'\n({detect:jfDeskIsImprintChapter,mark:jfDeskDecorateImprintBlock,blocks:jfDeskBlocksFor})',{
  document:{importNode(node){return clone(node);},createElement(){throw Error('unexpected figure creation in text-only case');}}
});
function clone(node){
  const classes=new Set();
  return {tagName:node.tagName,textContent:node.textContent,querySelector:()=>null,
    classList:{add(s){classes.add(s);},contains(s){return classes.has(s);}}};
}
const imprint='图书在版编目（CIP）数据 ISBN 978-7-301-23509-6 北京大学出版社 责任编辑张某 定价48.00元';
const continued='编辑部 电话 62752015 印刷者: 新华书店 定价 48.00元 版权所有';
const article='第一章 清末的监狱与酷刑。清王朝继承了中国几千年的专制制度，这是一段普通叙事文本。';
assert.equal(decorate.detect(0,imprint),true,'CIP and ISBN recognised');
assert.equal(decorate.detect(2,continued),true,'continued copyright without ISBN recognised');
assert.equal(decorate.detect(1,article),false,'narrative is never an imprint');
assert.equal(decorate.detect(8,imprint),false,'only front chapters may be classified');
assert.equal(decorate.detect(0,'我收藏了一本有 ISBN 的历史书，出版社已更名。'),false,'incidental publisher reference not enough');
const p=(text)=>({tagName:'P',textContent:text,querySelector:()=>null,classList:{contains(){return false}}});
const original=[p('图书在版编目（CIP）数据'),p('ISBN 978-7-301-23509-6'),p('责任编辑 张某 定价 48.00元')];
const blocks=decorate.blocks({n:0,el:{children:original,textContent:imprint}});
assert.equal(blocks.length,3);
for(const block of blocks)assert(block.node.classList.contains('jfPrintImprint'),'all imprint blocks styled on clone');
assert(blocks[0].node.classList.contains('jfPrintImprintLead'),'first CIP line has restrained title rhythm');
assert(original.every(n=>!n.classList.contains('jfPrintImprint')),'source EPUB DOM is never mutated');
assert.deepEqual(Array.from(blocks,x=>x.offset),[0,original[0].textContent.length,
  original[0].textContent.length+original[1].textContent.length],'offset anchors unchanged');
const prose=decorate.blocks({n:3,el:{children:[p(article)],textContent:article}});
assert(!prose[0].node.classList.contains('jfPrintImprint'),'prose remains unaffected');
const bg=decorate.blocks({n:0,el:{children:[p(imprint)],textContent:imprint}});
assert.equal(bg[0].node.textContent,imprint,'metadata is not rewritten');
assert(css.includes('.jfReader.paged #jfPageView .jfSheetBody>.jfPrintImprint{'),'both measure host and rendered sheet share selector');
assert(css.includes('text-align:left')&&css.includes('text-indent:0!important'),'metadata has no forced justify or prose indent');
assert(css.includes('word-break:normal')&&!css.slice(css.indexOf('/* ===== v7.67')).includes('word-break:keep-all'),'Chinese wraps naturally');
assert(css.includes('.jfReader.paged.jf-aged-paper #jfPageView .jfSheetBody{'),'ink only on old-paper mode');
assert(css.includes('text-shadow:0 .22px .28px'),'very light ink interaction');
console.log('PASS v7.67 imprint detection, clone-only layout, accurate offsets, prose isolation and ink styling');
