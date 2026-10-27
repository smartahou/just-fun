// v7.11: pure, bounded Workspace v1 relationship audit.
// Reads supplied objects only; no media-library scans, file I/O, repair or migration.
// Issue codes contain no user content or local paths.
function jfReadingAuditRelationships(workspace){
  const issues=new Set();
  const notes=Array.isArray(workspace?.notes)?workspace.notes:[];
  const marks=Array.isArray(workspace?.marks)?workspace.marks:[];
  const noteIds=new Set(notes.filter(n=>n&&typeof n.id==='string').map(n=>n.id));
  const grouped=new Map();
  let quotesChecked=0,blocksChecked=0,pagesChecked=0,groupsChecked=0;
  for(const note of notes){
    if(!note||typeof note!=='object')continue;
    if(note.quotes!==undefined&&!Array.isArray(note.quotes)){
      issues.add('invalid_note_quotes');continue;
    }
    const quotes=Array.isArray(note.quotes)?note.quotes:[];
    for(const q of quotes){
      quotesChecked++;
      if(!q||typeof q!=='object'){
        issues.add('invalid_note_quote');continue;
      }
      if(q.type!=='image')continue;
      if(q.pages===undefined)continue;
      if(!Array.isArray(q.pages)||q.pages.length<2||q.pages.length>6){
        issues.add('invalid_cross_page_sequence');continue;
      }
      pagesChecked+=q.pages.length;
      let previous=-1;
      for(let i=0;i<q.pages.length;i++){
        const page=q.pages[i];
        if(!page||!Number.isSafeInteger(page.chapter)||page.chapter<0||page.chapter>5000||
           page.chapter<previous||typeof page.image!=='string'||
           (i===0&&(page.chapter!==q.chapter||page.image!==q.image)))
          issues.add('invalid_cross_page_sequence');
        if(page&&Number.isSafeInteger(page.chapter))previous=page.chapter;
      }
    }
    if(note.blocks===undefined)continue; // Legacy v1 notes have no blocks.
    if(!Array.isArray(note.blocks)||note.blocks.length>90){
      issues.add('invalid_note_blocks');continue;
    }
    const refs=new Set();let count=0;
    for(const block of note.blocks){
      blocksChecked++;
      if(block?.kind==='text'&&typeof block.text==='string')continue;
      if(block?.kind==='quote'&&Number.isSafeInteger(block.index)&&
         block.index>=0&&block.index<quotes.length){
        count++;refs.add(block.index);continue;
      }
      issues.add('invalid_note_blocks');
    }
    if(count!==quotes.length||refs.size!==quotes.length)
      issues.add('invalid_note_blocks');
  }
  if(workspace?.lastExcerptNoteId!=null&&workspace.lastExcerptNoteId!==''&&
     !noteIds.has(workspace.lastExcerptNoteId))issues.add('dangling_recent_note');
  for(const mark of marks){
    if(!mark||typeof mark!=='object')continue;
    if(mark.type==='area'){
      const a=mark.area;
      if(!Array.isArray(a)||a.length!==4||a.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)||
        a[2]<=0||a[3]<=0||a[0]+a[2]>1.001||a[1]+a[3]>1.001)
        issues.add('invalid_mark_geometry');
    }else if(mark.type==='text'){
      if(!Number.isSafeInteger(mark.anchorStart)||mark.anchorStart<0||
        !Number.isSafeInteger(mark.length)||mark.length<1||!mark.text)
        issues.add('invalid_text_mark_anchor');
    }
    if(mark.groupId===undefined||mark.groupId===null)continue;
    if(mark.type!=='area'||typeof mark.groupId!=='string'||!/^[a-f0-9]{24}$/.test(mark.groupId)){
      issues.add('invalid_mark_group');continue;
    }
    if(!grouped.has(mark.groupId))grouped.set(mark.groupId,[]);
    grouped.get(mark.groupId).push(mark);
  }
  for(const items of grouped.values()){
    groupsChecked++;
    if(items.length<2||items.length>6||items.some(m=>m.bookId!==items[0].bookId))
      issues.add('invalid_mark_group');
  }
  if(workspace?.progress!==undefined){
    if(!workspace.progress||typeof workspace.progress!=='object'||Array.isArray(workspace.progress))
      issues.add('invalid_reading_progress');
    else for(const [bookId,p] of Object.entries(workspace.progress)){
      if(!/^[a-f0-9]{16}$/.test(bookId)||!p||typeof p!=='object'||
         !Number.isSafeInteger(p.chapter)||p.chapter<0||p.chapter>5000||
         typeof p.ratio!=='number'||!Number.isFinite(p.ratio)||p.ratio<0||p.ratio>1){
        issues.add('invalid_reading_progress');break;
      }
    }
  }
  return {issues:[...issues].sort(),quotesChecked,blocksChecked,pagesChecked,groupsChecked};
}
