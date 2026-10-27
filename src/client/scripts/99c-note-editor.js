// v6.79 · Note formatting is a view over existing Markdown text blocks.
// Source excerpts remain separate immutable reference blocks. No HTML reaches storage.
let jfNoteMode='md',jfNotePreviewOn=false,jfNoteFocusedRich=null;
const jfNoteEscape=text=>String(text??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function jfNoteInline(raw){
  // Reject raw HTML. Links are emitted only with safe schemes, never script URLs.
  let s=jfNoteEscape(raw),saved=[];
  s=s.replace(/`([^`\n]+)`/g,(_,code)=>{const key='\uE000'+saved.length+'\uE001';saved.push('<code>'+code+'</code>');return key;});
  s=s.replace(/\[([^\]\n]{1,160})\]\(([^)\s]{1,1000})\)/g,(match,label,href)=>{
    const u=href.replace(/&amp;/g,'&');
    if(!/^(https?:\/\/|mailto:)/i.test(u))return match;
    return '<a href="'+jfNoteEscape(u)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>';
  });
  s=s.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
     .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g,'<em>$1</em>')
     .replace(/~~([^~\n]+)~~/g,'<s>$1</s>');
  return s.replace(/\uE000(\d+)\uE001/g,(_,idx)=>saved[Number(idx)]||'');
}
function jfNoteMarkdownHtml(md){
  const lines=String(md||'').replace(/\r\n?/g,'\n').split('\n'),out=[];
  let list='',para=[],quote=[],code=[];let fenced=false;
  const closePara=()=>{if(para.length){out.push('<p>'+para.map(jfNoteInline).join('<br>')+'</p>');para=[];}};
  const closeList=()=>{if(list){out.push('</'+list+'>');list='';}};
  const closeQuote=()=>{if(quote.length){out.push('<blockquote><p>'+quote.map(jfNoteInline).join('<br>')+'</p></blockquote>');quote=[];}};
  for(const line of lines){
    if(/^\s*```/.test(line)){
      closePara();closeList();closeQuote();
      if(fenced){out.push('<pre><code>'+jfNoteEscape(code.join('\n'))+'</code></pre>');code=[];}fenced=!fenced;continue;
    }
    if(fenced){code.push(line);continue;}
    const heading=line.match(/^(#{1,4})\s+(.+)$/),item=line.match(/^\s{0,3}([-*+]|\d+\.)\s+(.+)$/),quotation=line.match(/^>\s?(.*)$/);
    if(!line.trim()){closePara();closeList();closeQuote();continue;}
    if(heading){closePara();closeList();closeQuote();const n=heading[1].length;out.push('<h'+n+'>'+jfNoteInline(heading[2])+'</h'+n+'>');continue;}
    if(/^\s*([-*_]\s*){3,}$/.test(line)){closePara();closeList();closeQuote();out.push('<hr>');continue;}
    if(item){closePara();closeQuote();const type=/\d/.test(item[1][0])?'ol':'ul';if(type!==list){closeList();out.push('<'+type+'>');list=type;}out.push('<li>'+jfNoteInline(item[2])+'</li>');continue;}
    if(quotation){closePara();closeList();quote.push(quotation[1]);continue;}
    closeList();closeQuote();para.push(line);
  }
  closePara();closeList();closeQuote();if(fenced)out.push('<pre><code>'+jfNoteEscape(code.join('\n'))+'</code></pre>');
  return out.join('\n');
}
function jfNoteRichMarkdown(root){
  if(!root)return '';
  const inline=node=>{
    if(node.nodeType===Node.TEXT_NODE)return node.nodeValue||'';
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    const tag=node.tagName.toLowerCase();if(tag==='br')return '\n';
    const val=Array.from(node.childNodes,inline).join('');
    if(tag==='b'||tag==='strong'||node.style?.fontWeight==='bold')return '**'+val+'**';
    if(tag==='em'||tag==='i'||node.style?.fontStyle==='italic')return '*'+val+'*';
    if(tag==='s'||tag==='strike')return '~~'+val+'~~';
    if(tag==='code')return '`'+val.replace(/`/g,'')+'`';
    if(tag==='a'){const url=node.getAttribute('href')||'';return /^(https?:\/\/|mailto:)/i.test(url)?'['+val+']('+url+')':val;}
    return val;
  };
  const serialize=node=>{
    if(node.nodeType===Node.TEXT_NODE)return node.nodeValue||'';
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    const tag=node.tagName.toLowerCase();
    if(tag==='ul'||tag==='ol')return Array.from(node.children).map((li,i)=>(tag==='ol'?(i+1)+'. ':'- ')+inline(li)).join('\n')+'\n\n';
    if(tag==='pre')return '```\n'+(node.innerText||node.textContent||'').trimEnd()+'\n```\n\n';
    if(tag==='blockquote')return (node.innerText||node.textContent||'').trim().split('\n').map(s=>'> '+s).join('\n')+'\n\n';
    if(/^h[1-4]$/.test(tag))return '#'.repeat(Number(tag[1]))+' '+inline(node)+'\n\n';
    if(tag==='hr')return '---\n\n';
    if(tag==='div'||tag==='p')return Array.from(node.childNodes,inline).join('').trimEnd()+'\n\n';
    return Array.from(node.childNodes,inline).join('');
  };
  return Array.from(root.childNodes,serialize).join('').replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').trimEnd();
}
function jfNoteCommitRichFields(){} // Blocks now share one native contenteditable surface.
function jfNoteApplyBlocks(blocks){
  const root=document.getElementById('jfDeskExcerpt');
  const cards=new Map([...root.children].filter(e=>e.dataset.quoteIndex!==undefined).map(e=>[Number(e.dataset.quoteIndex),e]));
  root.replaceChildren();
  for(const block of blocks){
    if(block.kind==='quote'){const card=cards.get(block.index);if(card)root.append(card);}
    else root.append(jfDeskNewTextChunk(block.text));
  }
  if(!root.hasChildNodes())root.append(jfDeskNewTextChunk(''));
}
function jfNoteRefreshViews(){
  const root=document.getElementById('jfDeskExcerpt');
  root.contentEditable=String(!jfNotePreviewOn);
  root.classList.toggle('jfNotePreviewing',jfNotePreviewOn);
  for(const chunk of root.querySelectorAll(':scope > .jfNoteTextChunk')){
    if(jfNotePreviewOn){
      const raw=chunk.dataset.raw ?? jfDeskChunkValue(chunk);
      chunk.dataset.raw=raw;
      chunk.innerHTML=jfNoteMarkdownHtml(raw);
    }
  }
  const title=document.getElementById('jfNoteFormatHelp');
  title.textContent=jfNotePreviewOn?'仅预览，不修改原笔记':jfNoteMode==='md'?'Markdown · 可直接编辑语法':'富文本 · 支持标题、强调、列表及引用';
  document.getElementById('jfNoteRichMode').setAttribute('aria-pressed',String(jfNoteMode==='rich'));
  document.getElementById('jfNoteMdMode').setAttribute('aria-pressed',String(jfNoteMode==='md'));
  document.getElementById('jfNotePreview').setAttribute('aria-pressed',String(jfNotePreviewOn));
  document.getElementById('jfNotePreview').textContent=jfNotePreviewOn?'继续编辑':'预览';
  document.getElementById('jfNoteFormatTools').hidden=jfNoteMode!=='rich'||jfNotePreviewOn;
}
function jfNoteSelectMode(mode){
  jfNoteMode=mode==='rich'?'rich':'md';jfNotePreviewOn=false;jfNoteFocusedRich=null;
  jfNoteRefreshViews();
}
function jfNoteChangeMode(mode){
  if(jfNoteMode===mode&&!jfNotePreviewOn)return;
  const blocks=jfDeskEditorBlocks();jfNoteMode=mode==='rich'?'rich':'md';jfNotePreviewOn=false;
  jfNoteApplyBlocks(blocks);jfNoteRefreshViews();jfDeskScheduleEditor();jfNoteHistoryPush();
}
function jfNoteTogglePreview(){
  if(!jfDeskActiveNote)return;
  const blocks=jfDeskEditorBlocks();
  if(jfNotePreviewOn){jfNotePreviewOn=false;jfNoteApplyBlocks(blocks);}
  else{jfNotePreviewOn=true;jfNoteApplyBlocks(blocks);}
  jfNoteRefreshViews();
}
function jfNoteFormat(command){
  if(jfNoteMode!=='rich'||jfNotePreviewOn)return;
  const editor=document.getElementById('jfDeskExcerpt'),sel=window.getSelection();
  const anchor=sel?.anchorNode;
  if(!anchor||!editor.contains(anchor))return;
  if(command==='h2')document.execCommand('formatBlock',false,'h2');
  else if(command==='ul')document.execCommand('insertUnorderedList',false,null);
  else if(command==='quote')document.execCommand('formatBlock',false,'blockquote');
  else document.execCommand(command,false,null);
  jfDeskScheduleEditor();jfNoteHistoryPush();
}
function jfNoteExportContent(){
  const note=jfDeskWorkspace.notes.find(n=>n.id===jfDeskActiveNote)||jfDeskDraft;
  if(!note)return null;
  const blocks=jfDeskEditorBlocks(),quotes=jfDeskQuotesFor(note),parts=[],htmlParts=[];
  for(const block of blocks){
    if(block.kind==='text'){parts.push(block.text);htmlParts.push(jfNoteMarkdownHtml(block.text));continue;}
    const q=quotes[block.index];if(!q)continue;
    const book=jfBooks.find(x=>x.id===q.bookId);
    const source=(book?.name||'书籍')+' · '+(q.chapter+1)+(book?.kind==='pdf'?' 页':' 节');
    if(q.type==='image'&&q.image){
      const pages=Array.isArray(q.pages)&&q.pages.length>1?q.pages:[{chapter:q.chapter,image:q.image}];
      const reference=pages.length>1?(book?.name||'书籍')+' · 第 '+(pages[0].chapter+1)+'–'+(pages[pages.length-1].chapter+1)+' 页':source;
      parts.push(pages.map(p=>'!['+(q.text||'第 '+(p.chapter+1)+' 页摘录').replace(/\]/g,'')+']('+p.image+')').join('\n\n')+'\n\n*'+reference+'*');
      htmlParts.push('<figure>'+pages.map(p=>'<img src="'+jfNoteEscape(p.image)+'" alt="第 '+(p.chapter+1)+' 页摘录">').join('')+'<figcaption>'+jfNoteEscape(reference)+'</figcaption></figure>');
    }else{
      parts.push(q.text.split('\n').map(line=>'> '+line).join('\n')+'\n\n*'+source+'*');
      htmlParts.push('<blockquote><p>'+jfNoteEscape(q.text).replace(/\n/g,'<br>')+'</p><small>'+jfNoteEscape(source)+'</small></blockquote>');
    }
  }
  return {name:document.getElementById('jfDeskNoteTitle').value.trim()||'无标题',markdown:parts.filter(Boolean).join('\n\n'),html:htmlParts.filter(Boolean).join('\n')};
}
function jfNoteDownload(kind){
  const data=jfNoteExportContent();if(!data)return;
  let content,mime,extension;
  if(kind==='md'){content='# '+data.name+'\n\n'+data.markdown+'\n';mime='text/markdown';extension='md';}
  else{
    const full='<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+jfNoteEscape(data.name)+'</title><style>body{max-width:760px;margin:60px auto;padding:0 24px;font:17px/1.85 system-ui;color:#253237;background:#fcfdfc}h1,h2,h3{line-height:1.4}blockquote{border-left:3px solid #75adab;margin:22px 0;padding:4px 18px;background:#f0f7f5}img{max-width:100%;height:auto}pre{overflow:auto;background:#ecf3f1;padding:16px;border-radius:8px}code{overflow-wrap:anywhere}</style></head><body><h1>'+jfNoteEscape(data.name)+'</h1>'+data.html+'</body></html>';
    content=full;mime='text/html';extension='html';
  }
  const blob=new Blob([content],{type:mime+';charset=utf-8'}),url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=data.name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,80)+'.'+extension;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  jfDeskMessage('已导出 '+extension.toUpperCase()+(jfDeskDirty?'（包含当前未保存修改）':''));
}
document.getElementById('jfNoteRichMode').addEventListener('click',()=>jfNoteChangeMode('rich'));
document.getElementById('jfNoteMdMode').addEventListener('click',()=>jfNoteChangeMode('md'));
document.getElementById('jfNotePreview').addEventListener('click',jfNoteTogglePreview);
document.getElementById('jfNoteExportMd').addEventListener('click',()=>jfNoteDownload('md'));
document.getElementById('jfNoteExportHtml').addEventListener('click',()=>jfNoteDownload('html'));
document.getElementById('jfNoteFormatTools').addEventListener('pointerdown',e=>{if(e.target.closest('button'))e.preventDefault();});
document.getElementById('jfNoteFormatTools').addEventListener('click',e=>{const command=e.target.closest('button')?.dataset.jfFormat;if(command)jfNoteFormat(command);});

// Set every excerpt image in the current note to a common width.
document.getElementById('jfNoteAllImageWidth').addEventListener('input',e=>{
  jfNoteSetAllImagesWidth(Number(e.target.value),false);
});
document.getElementById('jfNoteAllImageWidth').addEventListener('change',e=>{
  jfNoteSetAllImagesWidth(Number(e.target.value),true);
});
