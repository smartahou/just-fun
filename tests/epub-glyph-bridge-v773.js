#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const server=fs.readFileSync(path.join(root,'src/server/46-reading-and-notes.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const a=code.indexOf('function jfDeskGlyphDimensions('),b=code.indexOf('function jfDeskBlocksFor(sec){',a);
assert(a>=0&&b>a,'one canonical glyph classifier before pagination');
const src=code.slice(a,b);
const f=vm.runInNewContext(src+'\n({shape:jfDeskIsInlineGlyphShape,bridge:jfDeskCanBridgeGlyphText,dims:jfDeskGlyphDimensions})');
assert(f.shape(46,52,'藏于','匣，再将遗诏放在乾清宫'),'short inline CJK glyph');
assert(f.shape(600,600,'藏于','匣，再将遗诏放在乾清宫',true),'declared semantic glyph can have high-res raster');
assert(!f.shape(600,600,'藏于','匣，再将遗诏放在乾清宫'),'unspecified giant photo not a glyph');
assert(!f.shape(40,150,'藏于','匣，再将遗诏放在乾清宫'),'portrait not an inline character');
assert(!f.shape(46,52,'','孤立图像'),'standalone photo not a glyph');
assert(f.bridge('上书藏于','匣，再将遗诏放回乾清宫'),'sentence fragments bridge');
assert(!f.bridge('这是历史照片。','下面介绍图像'),'never merge across full stop');
assert(!f.bridge('历史文字如下：','画中人物是谁'),'never merge after colon');
assert.deepEqual(Array.from(f.dims({dataset:{jfSourceWidth:'24',jfSourceHeight:'23'},naturalWidth:600,naturalHeight:600})),[24,23],'authored 1em glyph size takes precedence');
const serverStart=server.indexOf('function jfReadingEpubImageLayoutHints(tag){'),serverEnd=server.indexOf('function jfReadingEpubChapterHtml(',serverStart);
assert(serverStart>=0&&serverEnd>serverStart,'server preserves sanitized image metadata');
const hs=vm.runInNewContext(server.slice(serverStart,serverEnd)+'\njfReadingEpubImageLayoutHints',{
 jfReadingAttr(tag,key){return tag[key]||'';},jfReadingXmlDecode:v=>v
});
assert(hs({src:'assets/rare-gaiji-u9481.png',width:'18',height:'19'}).includes('data-jf-glyph-hint="1"'),'gaiji filename is a strong signal');
assert(hs({src:'photos/portrait.jpg',width:'500',height:'350'}).includes('data-jf-source-width="500"'),'historical photos keep size metadata without being marked glyph');
assert(hs({src:'glyph.png',width:'999999'}).indexOf('data-jf-source-width')<0,'dimensions are strictly bounded');
assert(code.includes('const bridged=jfDeskMergeGlyphBlocks(raw,k);'),'cross-paragraph glyph fragments joined');
assert(code.includes('for(let m=k;m<=bridged.end;m++)acc+=raw[m].textContent.length'),'text offset is preserved across merged paragraphs');
assert(code.includes('window.JFReaderGlyphAudit=()=>'),'read-only glyph diagnostic exists');
assert(css.includes('.jfSheetBody p:has(img.jfInlineGlyph)'),'real line layout retained');
assert(code.includes('jfDeskPageForAnchor(jfDeskPages,number'),'paper book anchors unaffected');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
assert(engine.includes("if(!images[i].classList.contains('jfInlineGlyph'))return true;"),'real photos remain atomic');
assert(engine.includes('if(imageCount!==sourceImages)continue;'),'glyph images preserved at Range split');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,'7.73.0');
// Real clone-only bridge regression: 2 lost glyphs from an EPUB paragraph chain
// must be retained exactly once, and visible text offsets remain byte-for-byte.
function node(tag,children=[],attrs={}){
  const values=new Set(attrs.classes||[]);
  return {
    tagName:tag,childNodes:children,
    dataset:{...(attrs.dataset||{})},
    naturalWidth:attrs.width||0,naturalHeight:attrs.height||0,
    classList:{contains(k){return values.has(k);},add(k){values.add(k);}},
    get textContent(){return tag==='TEXT'?attrs.text:(this.childNodes||[]).map(c=>c.textContent).join('');},
    querySelectorAll(sel){
      return sel==='img'?this.childNodes.flatMap(c=>c.tagName==='IMG'?[c]:(c.querySelectorAll?.('img')||[])):[];
    },
    querySelector(sel){return sel==='img'?this.querySelectorAll('img')[0]||null:null;},
    appendChild(n){this.childNodes.push(n);return n;}
  };
}
const words=s=>node('TEXT',[],{text:s});
const glyph=()=>node('IMG',[],{width:44,height:48,
  dataset:{jfGlyphBridge:'1',jfInlineGlyph:'1'},classes:['jfInlineGlyph']});
const p=s=>node('P',[words(s)]);
const original=[p('密诏藏于'),node('P',[glyph()]),p('匣，再将'),node('P',[glyph()]),p('匣放回乾清宫。')];
function duplicate(el){
  if(el.tagName==='TEXT')return words(el.textContent);
  return node(el.tagName,el.childNodes.map(duplicate),{
    width:el.naturalWidth,height:el.naturalHeight,dataset:el.dataset,
    classes:el.classList.contains('jfInlineGlyph')?['jfInlineGlyph']:[]});
}
const merge=vm.runInNewContext(src+'\njfDeskMergeGlyphBlocks',{
  document:{importNode:duplicate}
});
const result=merge(original,0);
assert(result&&result.count===2&&result.end===4,'consecutive split glyph paragraphs are rejoined');
assert.equal(result.node.textContent,original.map(n=>n.textContent).join(''),
  'no content bytes lost across a 5-part EPUB paragraph');
assert.equal(result.node.querySelectorAll('img').length,2,'both rare-character bitmaps preserved');
assert.equal(original[0].querySelectorAll('img').length,0,'original EPUB nodes were not mutated');
console.log('PASS v7.73: inline glyph recognition, 2-glyph DOM bridge, metadata and page integrity');
