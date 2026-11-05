'use strict';
// EPUB paper-only navigation/annotation index. Does not mutate EPUB bytes.
// All matches are source-file/fragment identities, not visible note numbers.
function jfEpubResolve(epub,source,href){
  const raw=String(href||'').trim();
  if(!raw||/^[a-z][a-z\d+.-]*:/i.test(raw)||raw.startsWith('//'))return null;
  const sharp=raw.indexOf('#'),filePart=sharp<0?raw:raw.slice(0,sharp);
  let fragment='';
  try{fragment=sharp<0?'':decodeURIComponent(jfReadingXmlDecode(raw.slice(sharp+1)));}catch{return null;}
  const path=filePart?jfReadingEpubEntryName(require('node:path').posix.dirname(source),filePart):source;
  if(!path||!epub.zip.entries.has(path))return null;
  const chapter=epub.chapters.findIndex(x=>x.file===path);
  return {file:path,fragment,chapter,available:chapter>=0};
}
function jfEpubPlain(s,max=4000){
  return jfReadingHtmlToText(String(s||'')).replace(/\s+/g,' ').trim().slice(0,max);
}
function jfEpubHash(s){
  let h=2166136261;
  for(const ch of String(s)){h=Math.imul(h^ch.charCodeAt(0),16777619);}
  return 'n'+(h>>>0).toString(16).padStart(8,'0');
}
// Return one complete named element with balanced same-name tags, never a
// regex crossing the first nested </p> or deleting unrelated sibling prose.
function jfEpubNamedElement(html,id){
  if(!id||id.length>160)return null;
  const opens=/<([a-z][a-z\d:_-]*)\b[^>]*>/gi;
  let m;
  while((m=opens.exec(html))){
    if(jfReadingAttr(m[0],'id')!==id)continue;
    const tag=m[1].toLowerCase();
    const self=/\/\s*>$/.test(m[0])||/^(br|img|hr|meta|link|input)$/.test(tag);
    if(self)return null;
    const scan=new RegExp('<\\/?'+tag+'\\b[^>]*>','gi');
    scan.lastIndex=opens.lastIndex;
    let depth=1,n;
    while((n=scan.exec(html))){
      if(/^<\//.test(n[0]))depth--;
      else if(!/\/\s*>$/.test(n[0]))depth++;
      if(depth===0)return {tag,start:m.index,end:scan.lastIndex,opening:m[0],
        inner:html.slice(opens.lastIndex,n.index),html:html.slice(m.index,scan.lastIndex)};
    }
    return null;
  }
  return null;
}
function jfEpubTocLinks(epub,source,html){
  const links=[];
  const navOpen=/<nav\b[^>]*>/gi;
  let selected='',m;
  while((m=navOpen.exec(html))){
    const attrs=m[0],end=html.indexOf('</nav>',navOpen.lastIndex);
    if(end<0)break;
    if(/(?:^|\s)toc(?:\s|$)/i.test(jfReadingAttr(attrs,'epub:type'))||
       jfReadingAttr(attrs,'role')==='doc-toc'){
      selected=html.slice(navOpen.lastIndex,end);break;
    }
  }
  if(!selected&&[...html.matchAll(/<nav\b/gi)].length===1){
    const match=/<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(html);
    selected=match?.[1]||'';
  }
  if(!selected)return links;
  let depth=0,anchor=null;
  const tokens=/<\/?(?:ol|ul|a)\b[^>]*>|[^<]+/gi;
  while((m=tokens.exec(selected))){
    const token=m[0];
    if(/^<(?:ol|ul)\b/i.test(token)){depth++;continue;}
    if(/^<\/(?:ol|ul)/i.test(token)){depth=Math.max(0,depth-1);continue;}
    if(/^<a\b/i.test(token)){anchor={href:jfReadingAttr(token,'href'),depth:Math.max(0,depth-1),text:''};continue;}
    if(/^<\/a/i.test(token)){
      if(anchor){
        const title=jfEpubPlain(anchor.text,160),target=jfEpubResolve(epub,source,anchor.href);
        if(title&&target)links.push({title,depth:Math.min(anchor.depth,12),
          href:anchor.href,file:target.file,fragment:target.fragment,
          chapter:target.chapter,available:target.available});
      }
      anchor=null;continue;
    }
    if(anchor&&!token.startsWith('<'))anchor.text+=token;
    if(links.length>=800)break;
  }
  return links;
}
function jfEpubNcxLinks(epub,source,xml){
  const links=[],stack=[];let ordinal=0;
  const tokens=/<navPoint\b[^>]*>|<\/navPoint\s*>|<navLabel\b[^>]*>[\s\S]*?<\/navLabel\s*>|<content\b[^>]*\/?>/gi;
  let m;
  while((m=tokens.exec(xml))){
    const tag=m[0];
    if(/^<navPoint/i.test(tag)){stack.push({depth:stack.length,title:'',href:'',ordinal:ordinal++});continue;}
    if(/^<navLabel/i.test(tag)){
      if(stack.length)stack[stack.length-1].title=jfEpubPlain(tag,160);
      continue;
    }
    if(/^<content/i.test(tag)){
      if(stack.length)stack[stack.length-1].href=jfReadingAttr(tag,'src');
      continue;
    }
    if(/^<\/navPoint/i.test(tag)&&stack.length){
      const item=stack.pop(),target=jfEpubResolve(epub,source,item.href);
      if(item.title&&target)links.push({order:item.ordinal,title:item.title,depth:Math.min(item.depth,12),
        href:item.href,file:target.file,fragment:target.fragment,
        chapter:target.chapter,available:target.available});
    }
    if(links.length>=800)break;
  }
  // NCX closes children before parents. Source opening order restores the tree.
  return links.sort((a,b)=>a.order-b.order).map(({order,...entry})=>entry);
}
function jfEpubAddEdit(edits,file,start,end,replacement){
  if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(end)||end<=start)return;
  if(!edits.has(file))edits.set(file,[]);
  edits.get(file).push({start,end,replacement});
}
// Legacy printed notes: require an explicit 注释 heading, at least two
// numbered definition paragraphs, and one unique earlier text occurrence per
// number. No title/date/[2018] is ever stripped on the number alone.
function jfEpubNumberedNotes(epub,file,html,annotations,edits){
  const heading=/<(h[1-5]|p|div)\b[^>]*>\s*(?:【\s*注\s*释\s*】|注\s*释|脚\s*注)\s*<\/\1\s*>/gi;
  let header;
  while((header=heading.exec(html))){
    const after=html.slice(heading.lastIndex,heading.lastIndex+18000);
    const defs=[];
    const re=/<(p|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
    let m;
    while((m=re.exec(after))){
      const plain=jfEpubPlain(m[2],6000);
      const x=/^[［\[【(（]\s*(\d{1,3})\s*[\]］】)）]\s*[.、:：]?\s*(.+)$/s.exec(plain);
      if(!x)continue;
      defs.push({number:x[1],text:x[2],start:heading.lastIndex+m.index,
        end:heading.lastIndex+re.lastIndex});
      if(defs.length>=100)break;
    }
    if(defs.length<2)continue;
    // A body number is considered only when present in a real XHTML text
    // segment before the annotation heading, not in an attribute or an href.
    const refs=new Map();
    const textParts=html.slice(0,header.index).matchAll(/>([^<]+)</g);
    for(const part of textParts){
      const text=part[1],base=part.index+1;
      const numbers=/[［\[【]\s*(\d{1,3})\s*[\]］】]/g;
      let n;
      while((n=numbers.exec(text))){
        const num=n[1],row={start:base+n.index,end:base+numbers.lastIndex,
          excerpt:jfEpubPlain(html.slice(Math.max(0,base+n.index-160),base+n.index),40)};
        if(!refs.has(num))refs.set(num,[]);
        refs.get(num).push(row);
      }
    }
    const existing=edits.get(file)||[];
    const verified=defs.filter(d=>refs.get(d.number)?.length===1&&d.text.length>=2&&
      !existing.some(e=>e.start<d.end&&e.end>d.start));
    if(verified.length<2||verified.length/defs.length<.8)continue;
    for(const def of verified){
      const ref=refs.get(def.number)[0];
      if(existing.some(e=>e.start<ref.end&&e.end>ref.start))continue;
      const noteId=jfEpubHash(file+'#legacy-notes#'+def.number);
      if(!annotations.has(noteId))annotations.set(noteId,{
        id:noteId,text:def.text.slice(0,6000),excerpt:ref.excerpt,source:'verified-numbered'});
      jfEpubAddEdit(edits,file,ref.start,ref.end,
        '<span class="jfEpubNoteAnchor" data-jf-note-id="'+noteId+'"></span>');
      jfEpubAddEdit(edits,file,def.start,def.end,'');
    }
    // Keep the heading if any definition could not be safely linked.
    if(verified.length===defs.length)
      jfEpubAddEdit(edits,file,header.index,heading.lastIndex,'');
  }
}

function jfEpubEnhance(epub){
  const {zip,chapters,base}=epub,posix=require('node:path').posix;
  const files=new Map();
  const get=file=>{
    if(!file||!zip.entries.has(file))return '';
    if(!files.has(file)){
      try{files.set(file,jfReadingTextDecode(zip.read(file)));}catch{files.set(file,'');}
    }
    return files.get(file);
  };
  const opfFile=jfReadingAttr(get('META-INF/container.xml').match(/<rootfile\b[^>]*>/i)?.[0]||'','full-path');
  const opf=get(opfFile),items=new Map();
  for(const m of opf.match(/<item\b[^>]*>/gi)||[]){
    const id=jfReadingAttr(m,'id'),href=jfReadingAttr(m,'href');
    if(id&&href)items.set(id,{href,media:jfReadingAttr(m,'media-type'),
      properties:jfReadingAttr(m,'properties')});
  }
  let navFile='',ncxFile='';
  for(const it of items.values()){
    const entry=jfReadingEpubEntryName(base,it.href);
    if(!entry)continue;
    if(/(?:^|\s)nav(?:\s|$)/i.test(it.properties))navFile=entry;
    if(it.media==='application/x-dtbncx+xml')ncxFile=entry;
  }
  let toc=navFile?jfEpubTocLinks(epub,navFile,get(navFile)):[];
  if(!toc.length&&ncxFile)toc=jfEpubNcxLinks(epub,ncxFile,get(ncxFile));
  // Stable de-duplication: identical href+fragment is one physical target.
  const seen=new Set();
  toc=toc.filter(x=>{const key=x.file+'#'+x.fragment;
    if(seen.has(key))return false;seen.add(key);return true;});
  // Only the OPF-designated nav spine document may be skipped unconditionally.
  // Other "目录" headings alone NEVER qualify for deletion.
  const navChapter=chapters.find(x=>x.file===navFile);
  if(navChapter&&toc.length)navChapter.paperOmit='toc-nav';
  // A hand-authored TOC qualifies only with both a matching TOC heading AND
  // at least four real chapter links whose targets dominate the document.
  for(const ch of chapters){
    if(ch.paperOmit)continue;
    const title=String(ch.title||'').trim();
    if(!/^(?:目录|目次|总目录|contents|table of contents)$/i.test(title))continue;
    const html=get(ch.file),links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)];
    if(links.length<4)continue;
    const verified=links.map(m=>jfEpubResolve(epub,ch.file,jfReadingAttr(m[0],'href')))
      .filter(x=>x&&x.available&&x.chapter!==chapters.indexOf(ch));
    if(verified.length>=4&&verified.length/links.length>=.8){
      const plain=jfEpubPlain(html,4000);
      if(plain.length<2200)ch.paperOmit='toc-verified';
      if(!toc.length)toc=jfEpubTocLinks(epub,ch.file,
        '<nav epub:type="toc"><ol>'+links.map(x=>'<li>'+x[0]+'</li>').join('')+'</ol></nav>');
    }
  }
  // Build trusted note references. Nothing is hidden until an actual target
  // element resolves to a footnote, endnote or verified note-specific ID.
  const annotations=new Map(),edits=new Map(),markedTargets=new Set();
  for(const ch of chapters){
    const source=ch.file,html=get(source);
    for(const ref of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
      if(annotations.size>=900)break;
      const attrs=ref[1],href=jfReadingAttr(attrs,'href');
      if(!href||!href.includes('#'))continue;
      const target=jfEpubResolve(epub,source,href);
      if(!target?.fragment)continue;
      const targetHtml=get(target.file),node=jfEpubNamedElement(targetHtml,target.fragment);
      if(!node||node.html.length>24000)continue;
      const label=jfEpubPlain(ref[2],50);
      const noteSemantic=/(?:^|\s)(?:footnote|endnote)(?:\s|$)/i.test(jfReadingAttr(node.opening,'epub:type'))||
        jfReadingAttr(node.opening,'role')==='doc-footnote'||
        /(?:^|\s)(?:footnote|endnote)(?:\s|$)/i.test(jfReadingAttr(node.opening,'class'));
      const refSemantic=/(?:^|\s)noteref(?:\s|$)/i.test(jfReadingAttr(attrs,'epub:type'))||
        jfReadingAttr(attrs,'role')==='doc-noteref';
      const hinted=/^(?:fn|footnote|endnote|note)[-_]?\d+[a-z]?$/i.test(target.fragment);
      const numeric=/^[\[\]［］【】()（）\d\s¹²³⁴⁵⁶⁷⁸⁹⁰]+$/.test(label)&&/\d/.test(label);
      if(!noteSemantic&&!refSemantic&&!(hinted&&numeric))continue;
      if(!['aside','section','li','p','div'].includes(node.tag))continue;
      const text=jfReadingHtmlToText(node.inner).trim().slice(0,6000)
        .replace(/^[\[［(（【]?\s*\d{1,4}\s*[\]］)）】]?\s*[.、:：]?\s*/,'');
      if(text.length<2)continue;
      const identity=target.file+'#'+target.fragment,noteId=jfEpubHash(identity);
      const context=jfEpubPlain(html.slice(Math.max(0,ref.index-260),ref.index),100);
      const excerpt=context.slice(-24).replace(/^[^\p{L}\p{N}]+/u,'');
      if(!annotations.has(noteId))annotations.set(noteId,{id:noteId,text,excerpt,
        target:identity,source:'structured'});
      jfEpubAddEdit(edits,source,ref.index,ref.index+ref[0].length,
        '<span class="jfEpubNoteAnchor" data-jf-note-id="'+noteId+'"></span>');
      // Do not remove an anchor that is also regular prose, or a large parent
      // mixed with other text. Only note-specific blocks are removable.
      if(!markedTargets.has(identity)&&(noteSemantic||hinted||refSemantic)){
        jfEpubAddEdit(edits,target.file,node.start,node.end,'');
        markedTargets.add(identity);
      }
    }
  }
  // Conservative standalone numbered notes, never guesses from a lone [17].
  for(const ch of chapters)if(annotations.size<900)
    jfEpubNumberedNotes(epub,ch.file,get(ch.file),annotations,edits);
  toc=toc.map(item=>chapters[item.chapter]?.paperOmit?{...item,available:false}:item);
  epub.toc=toc.slice(0,800);
  epub.annotations=[...annotations.values()];
  epub.paperEdits=edits;
  return epub;
}
function jfEpubPaperXhtml(epub,file,raw){
  const edits=(epub.paperEdits?.get(file)||[]).slice().sort((a,b)=>b.start-a.start||b.end-a.end);
  let text=raw,last=raw.length;
  for(const edit of edits){
    // Edits are indexed against original XHTML, not a previously altered copy.
    if(edit.end>last||edit.end>raw.length)continue;
    text=text.slice(0,edit.start)+edit.replacement+text.slice(edit.end);
    last=edit.start;
  }
  return text;
}
