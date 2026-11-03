'use strict';
// Regression: uses actual server serializer + browser picker source.
// Keep compatibility with the legacy /api/data responses lacking a state property.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(ROOT,'src/server/60-http-router.js'),'utf8');
const browser=fs.readFileSync(path.join(ROOT,'src/client/scripts/80-library-actions.js'),'utf8');
let checks=0;
function check(label,condition){assert(condition,label);checks++;console.log('PASS',label);}
const apiExpression=server.match(/folders:\s*(catalog\.folders\.filter\(f => f\.state === 'ready'\)\.map\(f => \(\{[\s\S]*?\}\)\))/);
assert(apiExpression,'Missing /api/data folder serializer');
const publicFolders=Function('catalog','return '+apiExpression[1]);
const input=[
 {relativeDir:'source',originalName:'子目录',parentDir:'root',state:'ready',readOnly:true},
 {relativeDir:'source/原有目录',originalName:'原有目录',parentDir:'source',state:'ready',readOnly:true},
 {relativeDir:'source/空目录',originalName:'空目录',parentDir:'source',state:'ready',readOnly:true},
 {relativeDir:'data/1002',originalName:'提取的音轨',parentDir:'data',state:'ready'},
 {relativeDir:'source/未完成',originalName:'未完成',parentDir:'source',state:'pending'}
];
const serialized=JSON.parse(JSON.stringify(publicFolders({folders:input})));
check('API exposes ready source folders',serialized.some(x=>x.relativeDir==='source/原有目录'));
check('API exposes original empty folders',serialized.some(x=>x.relativeDir==='source/空目录'));
check('API filters pending folder',!serialized.some(x=>x.relativeDir==='source/未完成'));
check('API explicitly marks ready folders',serialized.every(x=>x.state==='ready'));
const begin=browser.indexOf('function unifiedFolderOptions() {');
const end=browser.indexOf('function closeUnifiedMove()',begin);
assert(begin>=0&&end>begin,'Move dialog source not found');
const functions=browser.slice(begin,end);
const compile=Function('allFolders','allItems','document','esc','hideUnifiedContext',
  'unifiedToast','activeFolder','folderDisplayName',
  "let unifiedMoveKeys=[];"+functions+
  ";return {options:unifiedFolderOptions,show:openUnifiedMove};");
function render(data){
  const select={innerHTML:'',value:'',focus(){}};
  const nodes={'#unifiedMoveTarget':select,
    '#unifiedMoveSummary':{textContent:''},'#unifiedMoveBack':{hidden:true}};
  const byName=relative=>data.find(x=>x.relativeDir===relative)?.originalName||relative;
  const api=compile(data,[{key:'0123456789abcdef',kind:'video'}],
    {querySelector:key=>nodes[key]},str=>String(str),()=>{},()=>{},'root',byName);
  api.show(['0123456789abcdef']);
  return {options:api.options(),html:select.innerHTML};
}
const real=render(serialized);
check('Picker includes existing nested folder',real.options.some(x=>x.relativeDir==='source/原有目录'));
check('Picker includes empty nested folder',real.options.some(x=>x.relativeDir==='source/空目录'));
check('Actual select includes both folders',real.html.includes('source/原有目录')&&real.html.includes('source/空目录'));
check('Pending folders never enter picker',!real.options.some(x=>x.relativeDir==='source/未完成'));
const legacy=serialized.map(({state,...rest})=>rest);
const old=render(legacy);
check('Legacy API without state remains compatible',old.options.some(x=>x.relativeDir==='source/原有目录')&&old.html.includes('source/空目录'));
const mixed=render([...legacy,{relativeDir:'source/处理中',originalName:'处理中',state:'pending'}]);
check('Explicit pending state is still rejected',!mixed.options.some(x=>x.relativeDir==='source/处理中'));
console.log('TOTAL',checks,'PASS');