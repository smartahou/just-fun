// v7.05 · Pure TXT presentation domain. No DOM, mutable reader state or I/O.
// Stable facade; legacy reader entry points delegate to this implementation.
const jfTextPresentation=Object.freeze((()=>{
function jfTxtSmartReflow(raw){
  // Read TXT as prose, rather than treating every physical line as a hard line break.
  // Keep an index for each original character: existing excerpts continue to target
  // the unchanged on-disk TXT, regardless of the display reflow.
  raw=String(raw||'');
  const lines=raw.split('\n');
  const entries=lines.map((line,i)=>({line,i,text:line.trim(),w:[...line.trim()].reduce((n,ch)=>n+(/[\u2e80-\uffef]/.test(ch)?2:1),0)}));
  const valid=entries.filter(x=>x.text);
  const widths=valid.map(x=>x.w).filter(n=>n>=18).sort((a,b)=>a-b);
  const typical=widths.length?widths[Math.floor(widths.length*.65)]:0;
  const poetry=valid.length>=4&&valid.filter(x=>x.w<=25).length/valid.length>=.8&&typical<34;
  const heading=/^(?:第[〇零一二三四五六七八九十百千万两\d]+[章节卷回篇部]|(?:序言?|前言|后记|尾声|楔子|目录|引子|正文|附录)(?:\s|$)|[【\[][^】\]]{1,40}[】\]]|#{1,6}\s|[-*+•·]\s|\d{1,3}[、.)．])/;
  const list=/^(?:[-*+•·]\s|\d{1,3}[、.)．]\s|[①-⑳])/;
  const strongEnd=/[。！？!?…；;]\s*[”’』」）)]?$/;
  const weakEnd=/[，、,:：]\s*[”’』」）)]?$/;
  const word=/[A-Za-z0-9]$/;
  const beginWord=/^[A-Za-z0-9]/;
  const blankBetween=entries.slice(1,-1).filter((x,i)=>!x.text&&entries[i].text&&entries[i+2].text).length;
  const blankCoverage=valid.length>1?blankBetween/(valid.length-1):0;
  // Some TXT exporters insert one blank row after each hard-wrapped line.
  // If that convention dominates the document, a blank row alone is not evidence
  // of a real paragraph; indentation, punctuation and headings still protect it.
  const mechanicalBlanks=blankCoverage>=.65&&valid.length>=5&&typical>=25;
  const indents=valid.filter(x=>/^(?:　{1,}| {2,}|\t+)/.test(x.line));
  const commonIndent=valid.length>=5&&indents.length/valid.length>=.72;
  const indent=line=>/^(?:　{1,}| {2,}|\t+)/.test(line);
  let output='';const map=new Uint32Array(raw.length+1);let src=0;
  const add=ch=>{output+=ch;};
  for(let i=0;i<entries.length;i++){
    const {line}=entries[i];
    // Strip purely mechanical leading spaces on full-width prose lines,
    // but retain intentional paragraph indentation and inline spacing.
    const dropIndent=commonIndent&&line.trim().length>0;
    const leading=dropIndent?(line.length-line.trimStart().length):0;
    for(let j=0;j<line.length;j++){
      map[src++]=output.length;
      if(j>=leading)add(line[j]);
    }
    if(i===entries.length-1)break;
    let next=i+1, blanks=0;
    while(next<entries.length&&!entries[next].text){blanks++;next++;}
    const a=entries[i],b=entries[next];
    // Each source separator must retain a mapping, including collapsed blank rows.
    const boundary=src;
    map[src++]=output.length; // newline after this line
    if(!a.text){
      // This line is blank. Previous nonblank line already emitted the separator.
      if(!mechanicalBlanks && output && !output.endsWith('\n\n'))add('\n');
      continue;
    }
    if(!b){add('\n');continue;}
    if(blanks){
      if(!mechanicalBlanks||blanks>=2){add('\n');continue;}
    }
    const startsParagraph=!commonIndent&&indent(b.line);
    const title=heading.test(a.text)||heading.test(b.text)||list.test(a.text)||list.test(b.text);
    const complete=strongEnd.test(a.text);
    const nearWrap=typical>=24&&a.w>=typical*.69;
    const completeShort=complete && (!nearWrap || b.w<typical*.43 || /^[“「『]/.test(b.text));
    const shortIndependent=complete&&a.w<27&&b.w<27;
    if(poetry||startsParagraph||title||completeShort||shortIndependent){add('\n');continue;}
    // The wrapped source newline is soft. Space between English words, but
    // never inject extra spacing between Chinese glyphs.
    if(word.test(a.text)&&beginWord.test(b.text))add(' ');
  }
  map[raw.length]=output.length;
  return {text:output,rawToDisplay:map};
}

function jfReadMaskString(value){
  const chars='ＡＢＣＤＥＦＧＨＪＫＬＭＮＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｊｋｍｎｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９＠＃％＆＊';
  return String(value||'').replace(/[\p{Script=Han}，。！？；：、（）【】《》“”‘’]/gu,(ch,idx)=>chars[(idx*131+(ch.codePointAt(0)||0)*17)%chars.length]);
}

return {reflow:jfTxtSmartReflow,mask:jfReadMaskString};
})());
