#!/usr/bin/env node
'use strict';
// v7.130 · Structural contracts; Chromium exercises real DOM and persistence.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const manifest=JSON.parse(read('build.manifest.json'));
const moduleFile='src/client/scripts/99d-epub-selection.js';
assert(manifest.scripts.includes(moduleFile),'bundled offline');
assert(manifest.scripts.indexOf(moduleFile)>manifest.scripts.indexOf('src/client/scripts/99-reading.js'));
const source=read(moduleFile),reader=read('src/client/scripts/99-reading.js');
const engine=read('src/client/scripts/98d-page-engine.js');
const css=read('src/client/styles/41-reading.css');
for(const js of [source,reader,engine])new Function(js);
assert(reader.includes('sourceStarts.set(child,sourceCursor)'),'source DOM whitespace mapped');
assert(reader.includes('sourceOffset:sourceStarts.get(node)'),'source offsets carried into blocks');
assert(engine.includes('sourceOffset:item.sourceOffset'),'original source offsets survive pagination');
assert(engine.includes('item.sourceOffset+split.head.textContent.length'),
  'split paragraph tail retains exact original coordinate');
assert(source.includes('item.sourceOffset')&&source.includes('function rangesFor('),
  'annotation range uses declared source coordinates instead of text guessing');
assert(!source.includes('source.indexOf(text)')&&!source.includes('source.indexOf(block.el.textContent)'),
  'printed page mapping never guesses by searching repeated text');
assert(source.includes('source.indexOf(mark.text)')&&source.includes('resolvedLegacy'),
  'prior wrong anchors recover only with unique verified text');
assert(source.includes('const span=source.slice(a.offset,z.offset)'),
  'selection from exact endpoint offsets supports paragraphs and both leaves');
assert(source.includes('schedulePaint')&&source.includes('lastPaintKey'),
  'mark changes draw once, stable state skips redraw');
assert(source.includes('CSS.highlights.set(key(col),new Highlight(...ranges))'),
  'durable markup replaces registry entry atomically');
assert(source.includes('document.caretRangeFromPoint')&&
  !source.includes('hit.range.getClientRects'),
  'existing marks use a single caret hit-test, not all-range geometry');
assert(reader.includes("if(payload.action==='mark'||payload.action==='mark-group'")&&
  reader.includes("window.JFEpubSelection?.restoreReady?.()"),
  'progress never redraws marks; reopening always paints after restore');
assert(source.includes('lastReasons')&&source.includes('diagnostics'),
  'render failures expose diagnostics rather than being invisible');
for(const t of ['取消标记','标记','加入笔记'])assert(source.includes(t),t+' action present');
assert(!source.includes("['cancel','取消']"),'tap-away replaces cancel button');
assert(source.includes('dismissOnClick')&&source.includes('event.stopImmediatePropagation()'),
  'one outside click dismisses selection before pagination click');
assert(source.includes("const color=mark.color||'blue'")&&
  source.includes("const col=colors.includes(color)?color:'blue'"),
  'default blue marks are rendered in the actual blue registry');
assert(source.includes("['copy','复制']")&&source.includes('navigator.clipboard?.writeText')&&
  source.includes("document.execCommand('copy')"),'copy has clipboard and fallback');
assert(reader.includes("jfPdfMarksListToggle').hidden=!!outline.nativePdf")&&
  reader.includes('jfPdfJsMarksListRender()'),
  'non-PDF books expose and refresh the shared mark index');
const pdf=read('src/client/scripts/99a-pdfjs.js');
assert(pdf.includes('await jfDeskShowChapter(mark.chapter,0,')&&
  !pdf.includes("jfDeskJumpToQuote({...mark,type:'text'})"),
  'non-PDF mark index navigates via source offset, never via DOM mutation');
assert(source.includes('jfEpubColorPalette')&&source.includes("action:'recolor-mark'")&&
  reader.includes("payload.action==='recolor-mark'"),
  'five reusable colors recolor without losing saved mark identity');
assert(source.includes('function indexFor(block)')&&source.includes('const {nodes}=indexFor(block)'),
  'text nodes and exact ranges are indexed once per rendered block');
assert(css.includes('[aria-pressed=true]')&&css.includes('[data-color=amber]'),
  'low saturation palette indicates current ink color');
assert(source.includes('jfDeskChooseQuote({...snap.ref,')&&
  source.includes('sourceText:snap.ref.text'),'note retains original mark source');
assert(css.includes('::highlight(jf-epub-selection)')&&
  css.includes('text-decoration-line:underline')&&
  css.includes('background-color:transparent!important'),'single legible thin line');
assert(source.includes('const EDGE_DWELL_MS=720')&&
  source.includes('function cornerDirection(')&&source.includes('function edgeTurn(')&&
  source.includes('function adjacentSource('),
  'corner dwell auto-turn uses existing prepared spreads only');
assert(source.includes("const limit=direction<0?low:high")&&
  source.includes('return {index};')&&
  !source.includes('virtual.focus=virtual.pending.focus'),
  'turning either way preserves the original selection endpoint');
assert(source.includes('function captureDragSeed()')&&
  source.includes('if(direction&&(selecting()||dragSeed))armEdge(direction)'),
  'forward edge works after the native selection collapses in the outer gutter');
assert(source.includes('edgeLocked=true;')&&source.includes('edgeLocked=false;')&&
  source.includes('if(edgeLocked){stopEdge();return;}'),
  'stationary pointer does not keep turning entire unselected spreads');
assert(source.includes('if(virtual)return virtualReference()')&&
  source.includes('if(virtual&&virtual.session===jfDeskSession')&&
  source.includes('virtual.index=jfDeskPageIndex;virtual.pending=null;'),
  'page render retains immutable source coordinates for cross-page selection');
assert(source.includes('if(onText)extendVirtual(onText)')&&
  source.includes('if(virtual)scheduleSettle(0)'),
  'continued drag extends only when over visible text and commits on release');
assert(source.includes('const nearBottom=r=>')&&
  source.includes('y>=right.bottom-nearBottom(right)')&&
  source.includes('y<=right.bottom+12'),
  'forward dwell requires the lower-right paper corner');
assert(source.includes('function textPointAt(x,y)')&&
  source.includes('rect.left-x,x-rect.right')&&
  source.includes('rect.top-y,y-rect.bottom')&&
  source.includes('if(!onText&&dragOriginInText&&dragSeed)')&&
  source.includes('enterVirtual();'),
  'non-text margins cannot expand selection by browser caret clamping');
assert(source.includes('if(dragging){captureDragSeed();return;}')&&
  source.includes('if(virtual)return;')&&source.includes('else armEdge(0);'),
  'normal native selection avoids eager expensive redraws');
const savedInkTints={
  amber:['#947349','rgba(148,115,73,.09)'],
  blue:['#668b9c','rgba(102,139,156,.09)'],
  mint:['#698c72','rgba(105,140,114,.09)'],
  rose:['#ad7c7b','rgba(173,124,123,.09)'],
  violet:['#8474a1','rgba(132,116,161,.09)']
};
for(const [name,[underline,tint]] of Object.entries(savedInkTints)){
  const selector='.jfReader ::highlight(jf-epub-mark-'+name+')';
  const at=css.lastIndexOf(selector+'{');
  assert(at>=0,'missing saved mark style '+name);
  const rule=css.slice(at,css.indexOf('}',at)+1);
  assert(rule.includes('text-decoration-color:'+underline),
    name+' must retain its existing thin underline hue');
  assert(rule.includes('background-color:'+tint),
    name+' must use the same hue at 9% opacity');
}
assert(!css.includes('.jfReader.jfEpubSelecting ::highlight(jf-epub-mark-violet)'),
  'saved text ink remains visible while making a new selection');
assert(/\.jfReader ::highlight\(jf-epub-selection\)\s*\{[^}]*background-color:rgba\(148,115,73,\.09\)/.test(css)&&
  /\.jfReader ::highlight\(jf-epub-selection\)\s*\{[^}]*text-decoration-color:#947349/.test(css),
  'live text selection previews the final thin ink and faint same-hue tint');
// v7.137 · EPUB image annotations use a source image ordinal, never a
// viewport rectangle or a mutable decoded/reprocessed image URL.
const server=read('src/server/46-reading-and-notes.js');
assert(server.includes('function jfReadingAddMarkGroup(d,marks)')&&
  server.includes("body.action==='mark-group'")&&
  server.includes('if(body.alsoMarks)'),
  'combined text/image ink and note atomically share a group of source marks');
for(const contract of [
  "['area','page','epub-image'].includes(value.type)",
  "kind==='epub-image'",
  "type==='epub-image'&&m.imageIndex===identity.imageIndex",
  "epubImageIndex=isImage?q.epubImageIndex:undefined"
])assert(server.includes(contract),'image data validation: '+contract);
assert(reader.includes('function jfDeskTagSourceImages(section,chapter)')&&
  reader.includes('node.dataset.jfEpubImageIndex=String(i++)')&&
  reader.includes('node.dataset.jfEpubImageOffset=String(offset)')&&
  reader.includes('jfDeskTagSourceImages(first,number)'),
  'original image ordinals and source-text offsets survive EPUB printing');
assert(reader.includes("mark={type:'epub-image'")&&
  reader.includes("imageIndex:quote.epubImageIndex"),
  'image note atomically writes its source image annotation');
assert(pdf.includes("mark.type==='epub-image'")&&
  pdf.includes('JFEpubSelection?.jumpImage?.(mark)'),
  'shared mark index labels and jumps to EPUB image marks');
for(const needle of [
  'function sourceImages(chapter)',
  'function imagesInSelection(chapter,start,end,nativeRange=null,focusImage=null)',
  'function extendVirtualImage(img)',
  'function drawLive(snap)',
  'function scheduleLivePreview()',
  'function selectionMarkParts(snap,color=',
  "action:'mark-group'",
  'function imageMarkRef(img)',
  'function selectImage(img)',
  'function imageCanvas(img,maxSide=1440)',
  'function quoteImageJpeg(img)',
  "new ClipboardItem({'image/png':blob})",
  'function jumpImage(mark)',
  "img.dataset.jfEpubImageColor=saved",
  'clearImageFocus()'
])assert(source.includes(needle),'EPUB image selection path: '+needle);
for(const color of ['amber','blue','mint','rose','violet']){
  assert(css.includes('img[data-jf-epub-image-color="'+color+'"]'),
    color+' image border exists');
}
assert(css.includes('outline-offset:3px')&&
  css.includes('box-shadow:0 0 0 4px var(--jf-epub-img-halo)')&&
  css.includes('img[data-jf-epub-image-preview]')&&
  !css.includes('img[data-jf-epub-image-color]:not([data-jf-epub-image-active])'),
  'saved and live image ink both remain visible without covering image pixels');
// Verify the server's real add / stable-identity functions without a vault.
// An identical URL may appear twice in the same chapter: imageIndex
// differentiates them without searching source text or displayed img src.
const vm=require('node:vm');
const from=server.indexOf('function jfReadingAddMark(');
const to=server.indexOf('function jfReadingUpdate(',from);
assert(from>=0&&to>from,'server mark contract');
const context={jfReaderError:(status,message)=>{
  const err=new Error(message);err.status=status;return err;},
  crypto:{randomBytes:()=>({toString:()=> 'a'.repeat(24)})}};
vm.runInNewContext(server.slice(from,to),context);
const state={marks:[]},baseMark={bookId:'a'.repeat(16),chapter:2,
  type:'epub-image',imageIndex:0,label:'图一',color:'amber'};
context.jfReadingAddMark(state,baseMark);
context.jfReadingAddMark(state,{...baseMark});
context.jfReadingAddMark(state,{...baseMark,imageIndex:1,label:'图二'});
assert.equal(state.marks.length,2,'same-URL illustrations retain unique ordinals');
assert.equal(context.jfReadingMarkIndex(state,baseMark),0);
assert.equal(context.jfReadingMarkIndex(state,{...baseMark,imageIndex:1}),1);
assert.throws(()=>context.jfReadingAddMark(state,{...baseMark,imageIndex:-1}),
  /EPUB 图片编号无效/);
assert.throws(()=>context.jfReadingMarkIndex(state,{...baseMark,imageIndex:100002}),
  /图片标记定位无效/);
const groupState={marks:[]};
context.jfReadingAddMarkGroup(groupState,[
  {type:'text',bookId:'a'.repeat(16),chapter:2,anchorStart:4,
    text:'原文摘录',length:4,color:'amber'},
  {...baseMark}
]);
assert.equal(groupState.marks.length,2);
assert(groupState.marks[0].groupId&&
  groupState.marks[0].groupId===groupState.marks[1].groupId,
  'one group identity covers both text and illustration');
assert.throws(()=>context.jfReadingAddMarkGroup(groupState,[
  {...baseMark,imageIndex:1},{...baseMark,imageIndex:-1}]),
  /EPUB 图片编号无效/);
assert.equal(groupState.marks.length,2,'invalid group must not partially save');
assert(!source.includes('innerHTML'),'source annotation layer never rewrites book DOM');
console.log('PASS v7.138 EPUB map: deterministic offsets, atomic ink, no progress redraw, lazy caret hit-testing');
