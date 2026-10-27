// v7.05 locked baseline: pure TXT reflow, source offsets and screenshot mask.
// Runs without browser / media / network. Golden checksum from v7.04 original functions.
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/client/scripts/98a-txt-presentation.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source,context,{filename:'98a-txt-presentation.js',timeout:5000});
const api=vm.runInContext('jfTextPresentation',context);
assert.equal(Object.isFrozen(api),true);
assert.deepEqual(Object.keys(api).sort(),['mask','reflow']);
assert.equal(typeof api.reflow,'function');
assert.equal(typeof api.mask,'function');
let seed=0xdecafbad;
function next(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;}
const pieces=['春眠不觉晓，','于是他回过头来','• 列表：','第十二章','　　','中文，标点。','English','hello world','世界！','🙂 emoji','', '\t', '了……','（注释）','A12','¡¡','北京。\n上海。','22\u00032'];
const cases=[
  '', '\n', '\n\n', '第一章\n\n　　这是第一自然段。\n\n第二段','春眠不觉晓，\n处处闻啼鸟。\n夜来风雨声，\n花落知多少。',
  'hello\nworld', '正文\r\n第二行', '甲'.repeat(150)+'\n'+'乙'.repeat(150),
  '　　第一段。\n　　第二段。\n', '一二三\n\n\n四五六',
];
for(let i=0;i<512;i++){
  const lines=[];const n=next()%25;
  for(let j=0;j<n;j++){
    let line='';const k=next()%8;
    for(let z=0;z<k;z++)line+=pieces[next()%pieces.length];
    lines.push(line);
  }
  cases.push(lines.join('\n'));
}
const maskCases=['','纯中文一二三，。！？', 'Hello, 世界! 2026', '𠮷𠮷🙂😄', ...cases.slice(0,64)];
const digest=crypto.createHash('sha256');
for(const raw of cases){
  const result=api.reflow(raw);
  assert.equal(typeof result.text,'string');
  assert.equal(result.rawToDisplay.length,raw.length+1);
  assert.equal(result.rawToDisplay[raw.length],result.text.length);
  let prev=0;
  for(const pos of result.rawToDisplay){assert.ok(pos>=prev && pos<=result.text.length);prev=pos;}
  digest.update(JSON.stringify([result.text,Array.from(result.rawToDisplay)])+'\n');
}
for(const raw of maskCases){
  const result=api.mask(raw);
  assert.equal(typeof result,'string');
  digest.update(JSON.stringify([raw,result])+'\n');
}
const hash=digest.digest('hex');
if(process.argv.includes('--print-golden'))console.log('GOLDEN '+hash);
else assert.equal(hash,'9f18275010a0da00b5972c38c080c0c411c1612ababce74ff2fd0c25bc30d3ad','v7.04 TXT text/offset/mask semantics regressed');
console.log('PASS: '+cases.length+' deterministic reflow cases, '+maskCases.length+' mask cases; SHA '+hash);
