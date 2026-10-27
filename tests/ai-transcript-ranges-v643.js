'use strict';
// Execute the actual production functions in isolation. No real media or network.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'../src/media/50-ai-transcription.js'),'utf8');
function extract(name){
  const at=source.indexOf('function '+name+'(');if(at<0)throw Error('Missing '+name);
  const open=source.indexOf('{',at);let depth=0,end=-1;
  for(let i=open;i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth){end=i+1;break;}}
  if(end<0)throw Error('Missing closing brace '+name);return source.slice(at,end);
}
const sandbox={JF_ASR_MAX_ROWS:12000};vm.createContext(sandbox);
vm.runInContext(extract('jfAsrValidateRows')+'\n'+extract('jfAsrMergeOverlappingRows')+'\nthis.validate=jfAsrValidateRows;this.merge=jfAsrMergeOverlappingRows;',sandbox);
const row=(a,b,t)=>({startMs:a,endMs:b,text:t});
const clean=rows=>JSON.parse(JSON.stringify(sandbox.merge(rows)));
let checks=0;function pass(desc,fn){fn();checks++;console.log('PASS',desc);}
pass('Strict overlap merges and preserves both texts',()=>assert.deepEqual(clean([row(1000,3000,'A'),row(2000,5000,'B')]),[row(1000,5000,'A\n\nB')]));
pass('Touching endpoints remain two separate rows',()=>assert.deepEqual(clean([row(1000,3000,'A'),row(3000,5000,'B')]),[row(1000,3000,'A'),row(3000,5000,'B')]));
pass('Transitive overlap collapses all intersecting intervals',()=>assert.deepEqual(clean([row(1000,3000,'A'),row(2500,5500,'B'),row(5000,7000,'C')]),[row(1000,7000,'A\n\nB\n\nC')]));
pass('Meeting after union does not merge',()=>assert.deepEqual(clean([row(1000,3000,'A'),row(2000,5000,'B'),row(5000,7000,'C')]),[row(1000,5000,'A\n\nB'),row(5000,7000,'C')]));
pass('Enclosed interval retains outer end and both texts',()=>assert.deepEqual(clean([row(1000,10000,'长段'),row(2000,3000,'补句')]),[row(1000,10000,'长段\n\n补句')]));
pass('Edited earlier start reorders rows by time, not old index',()=>assert.deepEqual(clean([row(8000,9500,'后句'),row(1000,3000,'前句')]),[row(1000,3000,'前句'),row(8000,9500,'后句')]));
pass('Same start merges overlapping rows in stable original order',()=>assert.deepEqual(clean([row(1000,5000,'先'),row(1000,2000,'后')]),[row(1000,5000,'先\n\n后')]));
pass('Gap of one millisecond remains separate',()=>assert.equal(clean([row(1000,3000,'A'),row(3001,5000,'B')]).length,2));
pass('Overlap of one millisecond merges',()=>assert.equal(clean([row(1000,3001,'A'),row(3000,5000,'B')]).length,1));
pass('Empty segment text does not create duplicate separators',()=>assert.deepEqual(clean([row(1000,3000,''),row(2000,5000,'正文')]),[row(1000,5000,'正文')]));
pass('Start equal to end rejected by server validation',()=>assert.throws(()=>sandbox.validate([row(2000,2000,'错')],9000),/时间无效/));
pass('Negative start rejected by server validation',()=>assert.throws(()=>sandbox.validate([row(-1000,2000,'错')],9000),/时间无效/));
pass('End beyond audio rejected by server validation',()=>assert.throws(()=>sandbox.validate([row(1000,12000,'错')],9000),/时间无效/));
pass('Nan and floats rejected by server validation',()=>assert.throws(()=>sandbox.validate([row(1000.5,3000,'错')],9000),/时间无效/));
pass('Overlength merged text rejected without truncation',()=>assert.throws(()=>sandbox.merge([row(1000,3000,'A'.repeat(40000)),row(2000,5000,'B'.repeat(40000))]),/合并后的段落文字过长/));
pass('Maximum media duration valid',()=>assert.equal(sandbox.validate([row(0,10800000,'正常')],10800000).length,1));
console.log('TOTAL',checks,'PASS');
