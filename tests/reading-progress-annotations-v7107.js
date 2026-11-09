#!/usr/bin/env node
'use strict';
// v7.107: one progress source for footer/piles; narrowly scoped source tables.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const part=(from,to)=>{
  const a=js.indexOf(from),b=js.indexOf(to,a+from.length);
  assert(a>=0&&b>a,'Missing reader section: '+from);
  return js.slice(a,b);
};
const stableSource=part('let jfDeskProgressContinuity=null;','// Background census:');
const stability=vm.runInNewContext(stableSource+'\n({run:jfDeskStabilizeBookProgress,reset:()=>{jfDeskProgressContinuity=null;}})',{
  Math,Number,jfDeskBook:{id:'test-book'},jfDeskSession:1,jfDeskPagesSig:'18px|two'
});
assert.equal(stability.run(.48,8,3),.48);
assert.equal(stability.run(.41,8,3),.48,'census cannot reverse displayed progress');
assert.equal(stability.run(.44,8,4),.48,'forward turn cannot regress as exact census catches up');
assert.equal(stability.run(.53,8,5),.53,'exact progress resumes after catching up');
assert.equal(stability.run(.33,8,4),.33,'backward turn lowers progress');
assert.equal(stability.run(.32,7,14),.32,'backward chapter lowers progress');
assert.equal(stability.run(5,7,15),1,'clamp >100%');
assert.equal(stability.run(-3,7,13),0,'clamp <0%');
assert.equal(stability.run(Number.NaN,7,14),0,'no NaN');

const mk=(text,colSpan=1,rowSpan=1)=>({textContent:text,colSpan,rowSpan});
const row=(left,right)=>({cells:[mk(left),mk(right)]});
const commentary={
  tagName:'TABLE',rows:[
    row('《唐诗纪事》','对这首诗的评析有许多细致而有趣的内容。'),
    row('《唐诗品汇》','以诗歌意境和章法为中心，详论作者手法。'),
    row('《诗境浅说》','此诗含蓄深婉，读来意味深长。')
  ]
};
const ordinary={tagName:'TABLE',rows:[
  row('序号','考试成绩及班级名称'),
  row('1','二年级一班'),
  row('2','三年级一班')
]};
const source=part('function jfDeskIsSourceCommentaryTable(node){','// v7.67 ·');
const detect=vm.runInNewContext(source+'\n({detect:jfDeskIsSourceCommentaryTable})',{Array,Math,Number,String});
assert(detect.detect(commentary),'source commentary table identified');
assert(!detect.detect(ordinary),'ordinary table unchanged');
assert(!detect.detect({tagName:'DIV',rows:commentary.rows}),'only real tables');
assert(!detect.detect({tagName:'TABLE',rows:commentary.rows.slice(0,1)}),'single row untouched');
assert(!detect.detect({tagName:'TABLE',rows:[
  {cells:[mk('《唐诗纪事》',2),mk('评论字数足够多超过最低限度')]},
  commentary.rows[1]
]}),'merged cells untouched');
const stackPart=part('// Reading progress drives how much paper is stacked on each outer edge:','  // Folio numbers are book-wide values, never the index into the mounted array.');
assert(stackPart.includes('progress=jfDeskStabilizeBookProgress(progress,chapterOfPage,inChapter)'));
assert(stackPart.includes('progress:Math.round(progress*100)'));
assert(stackPart.includes('page:pageA0'),'render snapshot includes page identity');
const footer=part('function jfDeskUpdateProgress(){','async function jfDeskCloseReader(){');
assert(!footer.includes('jfDeskPageIndex/Math.max(1,jfDeskPages.length)'),
  'footer must not use mounted-window fraction');
assert(footer.includes('sameSpread?stack.progress'),'footer from committed pile value');
assert(footer.includes("action:'progress'"),'saved bookmark code intact');

const shown=[{chapter:3,offset:100}];
const ui={'jfReadProgress':{textContent:''},'jfReadProgressFill':{style:{width:''}}};
const context={
 Math,Date,Number,clearTimeout:()=>{},setTimeout:()=>1,
 jfDeskBook:{id:'test-book'},jfDeskOutline:{chapters:Array.from({length:15})},
 jfDeskPaged:true,jfReader:{hidden:false},jfDeskRestoring:false,
 jfDeskCurrentPosition:()=>({chapter:3,ratio:.37,offset:100,scroll:0,mode:'paged'}),
 jfDeskPages:[shown],jfDeskPageIndex:0,jfDeskStackState:{
  bookId:'test-book',session:22,layout:'sig-a',page:shown,progress:48
 },
 jfDeskSession:22,jfDeskPagesSig:'sig-a',jfDeskProgressSignature:'',
 jfDeskProgressTimer:null,document:{getElementById:id=>ui[id]},
 jfDeskMutate:()=>Promise.resolve(),jfDeskMessage:()=>{}
};
const update=vm.runInNewContext(footer+'\n({update:jfDeskUpdateProgress})',context);
update.update();
assert.equal(ui.jfReadProgress.textContent,'48%');
assert.equal(ui.jfReadProgressFill.style.width,'48%');
context.jfDeskPages.push([],[],[],[],[],[]);
update.update();
assert.equal(ui.jfReadProgress.textContent,'48%','prefetch must not change percent');
const back=[{chapter:2,offset:10}];
context.jfDeskPages[0]=back;
context.jfDeskStackState={...context.jfDeskStackState,page:back,progress:31};
update.update();
assert.equal(ui.jfReadProgress.textContent,'31%','back turn reflected in footer');
assert.equal(ui.jfReadProgressFill.style.width,'31%');
const marker=css.indexOf('/* v7.107 · Annotated poetry source/commentary top alignment.');
assert(marker>0,'scoped vertical alignment appended');
const scoped=css.slice(marker);
assert(scoped.includes('table.jfPrintSourceCommentary'),'class-guarded styling');
assert(scoped.includes('vertical-align:top!important'),'override EPUB middle valign');
assert(!scoped.includes('.jfSheetBody td{'),'no global td');
assert(!/font-size:|line-height:|border-radius:|background-image:/.test(scoped),
  'no font or original paper changes');
const packageJson=require('../package.json');
const [major,minor]=packageJson.version.split('.').map(Number);
assert(major>7||(major===7&&minor>=107),'v7.107 progress fix must remain valid after later releases');
console.log('PASS v7.107: footer/piles same %, census continuity, reversed turns, source table isolation');
