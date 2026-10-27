const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const implementation=fs.readFileSync(path.join(root,'src/server/46b-reading-relations-audit.js'),'utf8');
const audit=vm.runInNewContext(implementation+'\njfReadingAuditRelationships',Object.create(null),{timeout:3000});
const original={version:1,revision:4,progress:{['b'.repeat(16)]:{chapter:1,ratio:.2}},
 notes:[{id:'a'.repeat(24),quotes:[{type:'image',image:'fake-image-data',chapter:2,pages:[
   {chapter:2,image:'fake-image-data'},{chapter:3,image:'another'}]}],blocks:[{kind:'quote',index:0},{kind:'text',text:'x'}]}],
 marks:[{type:'area',bookId:'b'.repeat(16),chapter:2,area:[0.1,0.2,0.3,0.4],groupId:'f'.repeat(24)},
        {type:'area',bookId:'b'.repeat(16),chapter:3,area:[0.1,0.2,0.3,0.4],groupId:'f'.repeat(24)}],
 lastExcerptNoteId:'a'.repeat(24)};
const deep=x=>JSON.parse(JSON.stringify(x));
const before=JSON.stringify(original);
let result=deep(audit(original));
assert.deepEqual(result.issues,[]);assert.equal(result.quotesChecked,1);assert.equal(result.pagesChecked,2);
assert.equal(result.blocksChecked,2);assert.equal(result.groupsChecked,1);
assert.equal(JSON.stringify(original),before,'audit cannot mutate the workspace');
function issue(mutate,code){
 const state=deep(original);mutate(state);const pre=JSON.stringify(state),r=deep(audit(state));
 assert(r.issues.includes(code),`${code} not detected: ${JSON.stringify(r)}`);
 assert.equal(JSON.stringify(state),pre,`audit mutated input on ${code}`);
}
issue(d=>{d.notes[0].blocks=[{kind:'quote',index:0},{kind:'quote',index:0}]},'invalid_note_blocks');
issue(d=>{d.notes[0].blocks=[{kind:'quote',index:5}]},'invalid_note_blocks');
issue(d=>{d.notes[0].blocks='corrupt'},'invalid_note_blocks');
issue(d=>{d.notes[0].quotes='corrupt'},'invalid_note_quotes');
issue(d=>{d.notes[0].quotes[0].pages[0].image='different'},'invalid_cross_page_sequence');
issue(d=>{d.notes[0].quotes[0].pages[1].chapter=0},'invalid_cross_page_sequence');
issue(d=>{d.notes[0].quotes[0].pages=[]},'invalid_cross_page_sequence');
issue(d=>{d.lastExcerptNoteId='0'.repeat(24)},'dangling_recent_note');
issue(d=>{d.marks[0].area=[.9,.1,.5,.1]},'invalid_mark_geometry');
issue(d=>{d.marks[1].bookId='c'.repeat(16)},'invalid_mark_group');
issue(d=>{d.marks.pop()},'invalid_mark_group');
issue(d=>{d.marks[0].groupId='../../bad'},'invalid_mark_group');
issue(d=>{d.marks.push({type:'text',chapter:0,anchorStart:-1,length:0})},'invalid_text_mark_anchor');
issue(d=>{d.progress['b'.repeat(16)].ratio=Infinity},'invalid_reading_progress');
issue(d=>{d.progress['b'.repeat(16)].chapter=-1},'invalid_reading_progress');
// Preserve legacy note formats without blocks, quotes, mark group IDs or recent note.
const legacy={version:1,notes:[{id:'a'.repeat(24)}],marks:[{type:'page',bookId:'b'.repeat(16),chapter:0}],progress:{}};
assert.deepEqual(deep(audit(legacy)).issues,[]);
// 5000-note stress sample, no external media or user content, no writes.
const large={notes:Array.from({length:5000},(_,i)=>({id:i.toString(16).padStart(24,'0'),quotes:[],blocks:[]})),marks:[],progress:{}};
assert.deepEqual(deep(audit(large)).issues,[]);
const server=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
assert(server.includes('jfReadingAuditRelationships(data)'));
assert(server.includes('relations:{'));
console.log('PASS v7.11 relationship audit: healthy, 16 corruption scenarios, 5000-note stress, legacy compatibility, no mutations');
