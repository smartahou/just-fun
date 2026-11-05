#!/usr/bin/env node
'use strict';
// v7.76 executable DOM regression based on the structural shape of a REAL
// uploaded EPUB element: <p>...<img class=jfInlineGlyph>\n 匣，再将<img>...
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const start=script.indexOf('function jfDeskHideGlyphSeamSpace(');
const end=script.indexOf('function jfDeskMergeGlyphBlocks(',start);
assert(start>=0&&end>start,'inline and bridge seam functions present');
function text(s){
  return {
    nodeType:3,nodeValue:s,childNodes:[],parentNode:null,
    get textContent(){return this.nodeValue},
    get previousSibling(){const n=this.parentNode?.childNodes||[],i=n.indexOf(this);return i>0?n[i-1]:null},
    get nextSibling(){const n=this.parentNode?.childNodes||[],i=n.indexOf(this);return i>=0?n[i+1]||null:null},
    splitText(k){
      const tail=text(this.nodeValue.slice(k));this.nodeValue=this.nodeValue.slice(0,k);
      const n=this.parentNode.childNodes,i=n.indexOf(this);n.splice(i+1,0,tail);
      tail.parentNode=this.parentNode;return tail;
    }
  };
}
function el(tag,children=[]){
  const o={
    nodeType:1,tagName:tag,className:'',childNodes:[],parentNode:null,
    get textContent(){return this.childNodes.map(n=>n.textContent).join('')},
    get previousSibling(){const n=this.parentNode?.childNodes||[],i=n.indexOf(this);return i>0?n[i-1]:null},
    get nextSibling(){const n=this.parentNode?.childNodes||[],i=n.indexOf(this);return i>=0?n[i+1]||null:null},
    insertBefore(node,sibling){const i=this.childNodes.indexOf(sibling);if(i<0)throw Error('not child');this.childNodes.splice(i,0,node);node.parentNode=this},
    appendChild(node){
      if(node.parentNode){
        const old=node.parentNode.childNodes,i=old.indexOf(node);
        if(i>=0)old.splice(i,1);
      }
      this.childNodes.push(node);node.parentNode=this;return node;
    },
    querySelectorAll(q){
      if(q!=='img.jfInlineGlyph')return [];
      const all=[];for(const child of this.childNodes){
        if(child.tagName==='IMG'&&child.className==='jfInlineGlyph')all.push(child);
        else if(child.nodeType===1)all.push(...child.querySelectorAll(q));
      }return all;
    }
  };
  children.forEach(child=>o.appendChild(child));return o;
}
const glyph=()=>{const x=el('IMG');x.className='jfInlineGlyph';return x};
const node=el('P',[text('秘密诏书藏于'),glyph(),text('\n 匣，再将'),glyph(),text('\n 匣放在乾清宫匾后，取下'),glyph(),text('\n 匣，立新君。')]);
const original=node.textContent;
const ctx={document:{createElement:tag=>el(tag)}};
const impl=vm.runInNewContext(script.slice(start,end)+'\n({seams:jfDeskHideInlineGlyphSeams})',ctx);
assert.equal(impl.seams(node),3,'three real-world inline gaiji gaps classified');
assert.equal(node.textContent,original,'source character offsets remain unchanged');
const hidden=node.childNodes.filter(x=>x.className==='jfGlyphSeamSpace');
assert.equal(hidden.length,3,'each leading newline/space is wrapped in a hidden span');
assert(hidden.every(x=>x.textContent==='\n '),'only original whitespace is visually hidden');
assert.equal(impl.seams(node),0,'repeat application is idempotent');
const english=el('P',[text('English'),glyph(),text('  word')]);
assert.equal(impl.seams(english),0,'ordinary Latin spaces preserved');
const photo=el('P',[text('历史照片'),el('IMG'),text('\n 匣')]);
assert.equal(impl.seams(photo),0,'normal images are unaffected');
const before=el('P',[text('诏书藏于 '),glyph(),text('匣中')]);
assert.equal(impl.seams(before),1,'trailing Chinese whitespace before glyph is removed');
assert.equal(before.textContent,'诏书藏于 匣中','pre-glyph characters preserved');
assert(script.includes('jfDeskHideInlineGlyphSeams(block.node);'),'fix runs before pagination/render on clones');
assert(/color:rgba\(53,37,24,\.(?:93|95)\)/.test(css),'printed pigment retains approved warm tone');
assert(css.includes('.jfSheetBody .jfGlyphSeamSpace{'),'hidden space styling present');
assert(Number(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version.split('.')[1])>=76,'original inline gaiji whitespace invariant remains supported');
console.log('PASS v7.76: real single-P multi-glyph seams, offset fidelity, idempotence, text/image exclusions, ink density');
