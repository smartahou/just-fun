#!/usr/bin/env python3
"""v7.129 Chromium: EPUB paper selection, saved mark and source-linked notes."""
import json
import pathlib
import struct
import zlib
import tempfile
import urllib.request
import zipfile

from isolated import ROOT, launch, stop
from playwright.sync_api import sync_playwright

FIRST = '纸书选区测试甲乙丙丁'
SECOND = '加入笔记测试子丑寅卯'
THIRD = '分页后精确标记辛壬癸甲乙丙丁'


def make_epub(path):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip',
                   compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml',
                   '<container><rootfiles><rootfile '
                   'full-path="OEBPS/content.opf"/></rootfiles></container>')
        z.writestr('OEBPS/content.opf',
                   '<package version="3.0" xmlns="http://www.idpf.org/2007/opf">'
                   '<metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">'
                   'Selection Book</dc:title></metadata><manifest>'
                   '<item id="a" href="chapter.xhtml" '
                   'media-type="application/xhtml+xml"/>'
                   '</manifest><spine><itemref idref="a"/></spine></package>')
        text = (f'在一张古旧纸页上，{FIRST}，读者仍然能看到清楚的铅字。'
                f'接下来{SECOND}，这段文字可以关联到读书笔记。')
        long_text = '此处是用于检查分页后源文字坐标的连续内容，必须避免误标邻近的句子。' * 140
        z.writestr('OEBPS/chapter.xhtml',
                   '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
                   '<h2>选区测试</h2>\n    <p>' + text + '</p>\n    '
                   '<p>此段用于检验注释之后正文没有被重写。</p>\n    '
                   '<p>' + long_text + THIRD + '，后文不应该被标记。</p>'
                   '</body></html>')



def make_epub_images(path):
    """Two visual illustrations sharing the same file but distinct source anchors."""
    width,height=240,146
    raw=bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend((32+(x*3+y)%75,65+(x+y*2)%80,76+(x*2+y*3)%88))
    def chunk(kind,data):
        return (struct.pack('>I',len(data))+kind+data+
                struct.pack('>I',zlib.crc32(kind+data)&0xffffffff))
    png=(b'\x89PNG\r\n\x1a\n'+
         chunk(b'IHDR',struct.pack('>2I5B',width,height,8,2,0,0,0))+
         chunk(b'IDAT',zlib.compress(bytes(raw),9))+chunk(b'IEND',b''))
    with zipfile.ZipFile(path,'w') as z:
        z.writestr('mimetype','application/epub+zip',
                   compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml',
                   '<container><rootfiles><rootfile '
                   'full-path="OEBPS/content.opf"/></rootfiles></container>')
        z.writestr('OEBPS/content.opf',
                   '<package version="3.0" xmlns="http://www.idpf.org/2007/opf">'
                   '<metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">'
                   'Illustrations</dc:title></metadata><manifest>'
                   '<item id="a" href="chapter.xhtml" media-type="application/xhtml+xml"/>'
                   '<item id="photo" href="media/photo.png" media-type="image/png"/>'
                   '</manifest><spine><itemref idref="a"/></spine></package>')
        text='<p>'+'这是含有图片的旧书章节，图片前后的正文应保持原有分页行为。'*6+'</p>'
        middle='<p>'+'图文并茂，原文照旧，重复图片的标记必须分别保存。'*9+'</p>'
        z.writestr('OEBPS/chapter.xhtml',
                   '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
                   '<h2>插图标记验收</h2>'+text+
                   '<figure><img src="media/photo.png" alt="第一幅测试插图"/></figure>'+
                   middle+
                   '<figure><img src="media/photo.png" alt="第二幅测试插图"/></figure>'+
                   text+'</body></html>')
        z.writestr('OEBPS/media/photo.png',png)

def choose(page, word):
    result = page.evaluate("""(word)=>{
      const blocks=[...document.querySelectorAll('#jfSheetLeft p, #jfSheetRight p')];
      const p=blocks.find(x=>x.textContent.includes(word));
      if(!p)return {ok:false,where:'no printed paragraph',text:blocks.map(x=>x.textContent)};
      const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())){
        const at=node.nodeValue.indexOf(word);
        if(at<0)continue;
        const r=document.createRange();r.setStart(node,at);
        r.setEnd(node,at+word.length);
        const s=getSelection();s.removeAllRanges();s.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
        return {ok:true,text:s.toString()};
      }
      return {ok:false,where:'no text node'};
    }""", word)
    assert result['ok'] and result['text'] == word, result
    page.wait_for_function(
        "()=>!document.getElementById('jfEpubSelectionMenu')?.hidden")


def choose_across_paragraphs(page):
    outcome = page.evaluate("""()=>{
      const nodes=[...document.querySelectorAll('#jfSheetLeft p, #jfSheetRight p')];
      const first=nodes.find(p=>p.textContent.includes('纸书选区测试甲乙丙丁'));
      const second=nodes.find(p=>p.textContent.includes('此段用于检验注释之后'));
      if(!first||!second)return {ok:false,reason:'paragraphs missing'};
      const start=[...first.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&
        n.textContent.includes('纸书选区测试甲乙丙丁'));
      const end=[...second.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&
        n.textContent.includes('此段用于检验注释之后'));
      if(!start||!end)return {ok:false,reason:'text nodes missing'};
      const range=document.createRange();
      range.setStart(start,start.textContent.indexOf('纸书选区测试甲乙丙丁'));
      range.setEnd(end,end.textContent.indexOf('此段用于检验注释之后')+
        '此段用于检验注释之后'.length);
      const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return {ok:true,selected:sel.toString(),startTag:range.startContainer.parentElement.tagName,
        endTag:range.endContainer.parentElement.tagName};
    }""")
    assert outcome['ok'] and outcome['startTag'] == 'P' and outcome['endTag'] == 'P', outcome
    page.wait_for_function(
        "()=>!document.getElementById('jfEpubSelectionMenu').hidden")
    return outcome


def choose_across_visible_pages(page):
    """Exercise real DOM Range from left printed leaf into its facing right leaf."""
    result = page.evaluate("""()=>{
      if(!jfDeskPagedGeometry().two)return {ok:false,reason:'single page'};
      const pages=jfDeskPages;
      let idx=-1;
      for(let i=0;i+1<pages.length;i+=2){
        const a=pages[i],b=pages[i+1];
        if(a.length&&b.length&&a[a.length-1].chapter===b[0].chapter&&
          a.some(x=>(x.node?.textContent||'').trim().length>14)&&
          b.some(x=>(x.node?.textContent||'').trim().length>14)){
          idx=i;break;
        }
      }
      if(idx<0)return {ok:false,reason:'no adjacent same-chapter leaves'};
      jfDeskPageIndex=idx;jfDeskPagedRender();
      const left=[...document.querySelectorAll('#jfSheetLeft p')]
        .filter(el=>el.textContent.trim().length>=9);
      const right=[...document.querySelectorAll('#jfSheetRight p')]
        .filter(el=>el.textContent.trim().length>=9);
      if(!left.length||!right.length)return {
        ok:false,reason:'missing printed paragraph',index:idx};
      function last(el){
        const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n,value=null;
        while((n=w.nextNode()))if(n.nodeValue.trim().length>=9)value=n;
        return value;
      }
      function first(el){
        const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;
        while((n=w.nextNode()))if(n.nodeValue.trim().length>=9)return n;
        return null;
      }
      const start=last(left[left.length-1]),end=first(right[0]);
      if(!start||!end)return {ok:false,reason:'text node missing'};
      const r=document.createRange();r.setStart(start,start.nodeValue.length-9);
      r.setEnd(end,11);
      const s=getSelection();s.removeAllRanges();s.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
      return {ok:true,index:idx,raw:s.toString()};
    }""")
    assert result['ok'], result
    page.wait_for_function("""()=>!document.getElementById('jfEpubSelectionMenu').hidden&&
      (CSS.highlights.get('jf-epub-selection')?.size||0)>=2""")
    checked = page.evaluate("""()=>{
      const ref=JFEpubSelection.reference()?.ref;
      const original=jfDeskFlow.find(x=>x.n===ref?.chapter)?.el.textContent;
      const ink=[...(CSS.highlights.get('jf-epub-selection')||[])];
      return {ref,source:original?.slice(ref.anchorStart,ref.anchorStart+ref.text.length),
        ink:ink.map(r=>r.toString()).join(''),
        leaves:[...new Set(ink.map(r=>r.startContainer.parentElement
          .closest('.jfSheetBody')?.id))]};
    }""")
    assert checked['ref'] and checked['ref']['text']==checked['source'], checked
    assert checked['ink'].replace(' ', '').replace('\n', '')==(
        checked['ref']['text'].replace(' ', '').replace('\n', '')), checked
    assert set(checked['leaves'])=={'jfSheetLeft','jfSheetRight'}, checked
    return result, checked


def assert_drag_stays_native(page):
    """120 selection updates during a held pointer never cause annotation layout."""
    report = page.evaluate("""()=>{
      const m=JFEpubSelection.metrics,before={settles:m.settles,maps:m.maps,redraws:m.redraws};
      const paragraph=document.querySelector('#jfSheetLeft p');
      const t=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT).nextNode();
      if(!t||t.nodeValue.length<10)return {ok:false,reason:'no long text node'};
      paragraph.dispatchEvent(new PointerEvent('pointerdown',{
        bubbles:true,pointerType:'mouse',clientX:20,clientY:40}));
      const sel=getSelection(),range=document.createRange();
      for(let i=0;i<120;i++){
        range.setStart(t,0);
        range.setEnd(t,Math.min(t.length,1+i%Math.max(2,t.length-1)));
        sel.removeAllRanges();sel.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        document.dispatchEvent(new PointerEvent('pointermove',{
          bubbles:true,pointerType:'mouse',clientX:30+i,clientY:40}));
      }
      const whileDragging={settles:m.settles-before.settles,
        maps:m.maps-before.maps,redraws:m.redraws-before.redraws,
        active:document.getElementById('jfReader').classList.contains('jfEpubDragging')};
      document.dispatchEvent(new PointerEvent('pointerup',{
        bubbles:true,pointerType:'mouse',clientX:165,clientY:40}));
      sel.removeAllRanges();
      return {ok:true,whileDragging};
    }""")
    assert report['ok'] and report['whileDragging']['active'], report
    assert report['whileDragging']['settles']==0, report
    assert report['whileDragging']['maps']==0 and report['whileDragging']['redraws']==0, report



def assert_corner_dwell(page, direction, pointer_type='mouse'):
    """Held pointer near outer upper corner flips without losing source span."""
    started = page.evaluate("""({direction,pointerType})=>{
      JFEpubSelection.reset();
      const step=jfDeskPagedGeometry().two?2:1;
      if(step!==2)return {ok:false,reason:'not a two-page spread'};
      let index=-1;
      for(let i=0;i+3<jfDeskPages.length;i+=2){
        const current=jfDeskPages[i],next=jfDeskPages[i+2];
        if(!current?.length||!next?.length||
           current[0].chapter!==next[0].chapter)continue;
        if(direction<0){if(i<2)continue;index=i;break;}
        if(i+2>=jfDeskPages.length)continue;
        index=i;break;
      }
      if(direction<0){
        for(let i=2;i+1<jfDeskPages.length;i+=2){
          if(jfDeskPages[i]?.length&&jfDeskPages[i-2]?.length&&
             jfDeskPages[i][0].chapter===jfDeskPages[i-2][0].chapter){
            index=i;break;
          }
        }
      }
      if(index<0)return {ok:false,reason:'no same-chapter adjacent spread'};
      jfDeskPageIndex=index;jfDeskPagedRender();
      const id=direction<0?'jfSheetLeft':'jfSheetRight';
      const sheet=document.getElementById(id);
      const walker=document.createTreeWalker(sheet,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())){
        if(node.nodeValue.trim().length>15)break;
      }
      if(!node)return {ok:false,reason:'no anchor text'};
      const range=document.createRange();
      range.setStart(node,1);range.setEnd(node,7);
      const root=node.parentElement,box=root.getBoundingClientRect();
      root.dispatchEvent(new PointerEvent('pointerdown',{
        bubbles:true,pointerType,pointerId:73,buttons:1,button:0,
        clientX:box.left+24,clientY:box.top+12}));
      const native=getSelection();
      native.removeAllRanges();native.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      const previous=JFEpubSelection.reference()?.ref;
      // Moving off the RIGHT leaf can collapse the browser's live Selection.
      // The last real source range must still seed the outgoing page turn.
      if(direction>0){
        native.removeAllRanges();
        document.dispatchEvent(new Event('selectionchange'));
      }
      const shell=sheet.parentElement.getBoundingClientRect();
      const x=direction<0?shell.left-12:shell.right+12;
      const y=direction<0?shell.top+20:shell.bottom-20;
      return {ok:true,index,chapter:jfDeskChapter,
        before:previous,target:index+direction*2,x,y,
        oldWrongCorner:{x:shell.right+12,y:shell.top+20}};
    }""", {'direction': direction, 'pointerType': pointer_type})
    assert started['ok'], started
    if direction>0:
        page.evaluate("""({pointerType,oldWrongCorner})=>{
          document.dispatchEvent(new PointerEvent('pointermove',{
            bubbles:true,pointerType,pointerId:73,buttons:1,
            clientX:oldWrongCorner.x,clientY:oldWrongCorner.y}));
        }""", {'pointerType':pointer_type,
                 'oldWrongCorner':started['oldWrongCorner']})
        page.wait_for_timeout(860)
        assert page.evaluate('jfDeskPageIndex')==started['index'], started
    page.evaluate("""({pointerType,x,y})=>{
      document.dispatchEvent(new PointerEvent('pointermove',{
        bubbles:true,pointerType,pointerId:73,buttons:1,
        clientX:x,clientY:y}));
    }""", {'pointerType':pointer_type,'x':started['x'],'y':started['y']})
    page.wait_for_function("""(target)=>
      jfDeskPageIndex===target && JFEpubSelection.diagnostics().crossPage""",
                           arg=started['target'], timeout=6000)
    # The anchor survives replacement of all printed DOM nodes.
    after = page.evaluate("""()=>{
      const snap=JFEpubSelection.reference();
      const source=jfDeskFlow.find(x=>x.n===snap?.ref.chapter)?.el.textContent;
      return {ref:snap?.ref,exact:!!snap?.ref&&
        source.slice(snap.ref.anchorStart,
          snap.ref.anchorStart+snap.ref.text.length)===snap.ref.text,
        index:jfDeskPageIndex};
    }""")
    assert after['ref'] and after['exact'], (started,after)
    # Turning pages must NOT select the newly exposed full leaf.
    assert after['ref'] == started['before'], (started,after)
    first_index=after['index']
    page.wait_for_timeout(950)
    stable=page.evaluate("""()=>({page:jfDeskPageIndex,
      locked:JFEpubSelection.diagnostics().edgeLocked})""")
    assert stable['page']==first_index and stable['locked'], (started,stable)
    # Only a new drag movement over real text may extend the stored span.
    continued=page.evaluate("""({direction,pointerType})=>{
      const sheet=document.getElementById(
        direction<0?'jfSheetLeft':'jfSheetRight');
      const walker=document.createTreeWalker(sheet,NodeFilter.SHOW_TEXT);
      let node=null,next;
      while((next=walker.nextNode())){
        if(next.nodeValue.trim().length>20){node=next;break;}
      }
      if(!node)return {ok:false,reason:'new page has no text node'};
      const at=Math.floor(node.nodeValue.length/2);
      const r=document.createRange();
      r.setStart(node,at);r.setEnd(node,at+1);
      const rect=r.getBoundingClientRect();
      const x=rect.left+Math.max(1,rect.width/2),y=rect.top+rect.height/2;
      document.dispatchEvent(new PointerEvent('pointermove',{
        bubbles:true,pointerType,pointerId:73,buttons:1,clientX:x,clientY:y}));
      const ref=JFEpubSelection.reference()?.ref;
      return {ok:!!ref,ref,x,y,
        page:jfDeskPageIndex,locked:JFEpubSelection.diagnostics().edgeLocked,
        ink:CSS.highlights.get('jf-epub-selection')?.size||0};
    }""", {'direction': direction,'pointerType':pointer_type})
    assert continued['ok'] and continued['ref'], (started,continued)
    assert len(continued['ref']['text'])>len(after['ref']['text']), (
      started,after,continued)
    assert continued['page']==first_index and not continued['locked'], continued
    page.wait_for_function("""()=>JFEpubSelection.diagnostics().crossPage&&
      (CSS.highlights.get('jf-epub-selection')?.size||0)>0""")
    page.evaluate("""({pointerType,x,y})=>{
      document.dispatchEvent(new PointerEvent('pointerup',{
        bubbles:true,pointerType,pointerId:73,button:0,buttons:0,
        clientX:x,clientY:y}));
    }""", {'pointerType': pointer_type,
              'x':continued['x'],'y':continued['y']})
    page.wait_for_function("""()=>!document.getElementById(
      'jfEpubSelectionMenu').hidden && !!JFEpubSelection.reference()""")
    assert page.evaluate("""()=>[...(CSS.highlights.get(
      'jf-epub-selection')||[])].length>0""")
    assert page.evaluate('()=>JFEpubSelection.reference()?.ref.text') == (
      continued['ref']['text'])
    page.evaluate('()=>JFEpubSelection.reset()')
    return after

def assert_real_forward_mouse(page):
    """Actual Playwright mouse drag, not dispatched synthetic PointerEvents."""
    setup = page.evaluate("""()=>{
      JFEpubSelection.reset();
      if(!jfDeskPagedGeometry().two)return {ok:false,reason:'no facing pages'};
      let index=-1;
      for(let i=0;i+3<jfDeskPages.length;i+=2){
        if(jfDeskPages[i+1]?.some(b=>!b.comic&&b.chapter===jfDeskChapter)&&
           jfDeskPages[i+2]?.some(b=>!b.comic&&b.chapter===jfDeskChapter)){
          index=i;break;
        }
      }
      if(index<0)return {ok:false,reason:'no forward spread'};
      jfDeskPageIndex=index;jfDeskPagedRender();
      const sheet=document.getElementById('jfSheetRight');
      const walker=document.createTreeWalker(sheet,NodeFilter.SHOW_TEXT);
      let node=null,n;
      while((n=walker.nextNode())){
        if(n.nodeValue.trim().length>35){node=n;break;}
      }
      if(!node)return {ok:false,reason:'no long text node'};
      const glyph=at=>{
        const r=document.createRange();
        r.setStart(node,at);r.setEnd(node,at+1);
        const rect=r.getBoundingClientRect();
        return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
      };
      const shell=sheet.parentElement.getBoundingClientRect();
      return {ok:true,index,target:index+2,
        start:glyph(4),end:glyph(28),
        blank:{x:shell.left+shell.width*.5,y:shell.bottom-18},
        wrongCorner:{x:shell.right+12,y:shell.top+20},
        corner:{x:shell.right+12,y:shell.bottom-20}};
    }""")
    assert setup['ok'], setup
    page.mouse.move(setup['start']['x'], setup['start']['y'])
    page.mouse.down()
    try:
        page.mouse.move(setup['end']['x'], setup['end']['y'], steps=10)
        page.wait_for_function("""()=>getSelection()?.toString().trim().length>=3""",
                               timeout=2500)
        before=page.evaluate('JFEpubSelection.reference()?.ref')
        assert before and before['text'], (setup,before)
        # Move into non-selectable blank paper. Neither native caret clamping
        # nor synthetic Highlight may extend the previous selection.
        page.mouse.move(setup['blank']['x'],setup['blank']['y'])
        page.wait_for_timeout(120)
        blank=page.evaluate("""()=>({
          ref:JFEpubSelection.reference()?.ref,
          cross:JFEpubSelection.diagnostics().crossPage,
          page:jfDeskPageIndex
        })""")
        assert blank['cross'] and blank['ref']==before and (
          blank['page']==setup['index']), (setup,before,blank)
        # Upper-right is NOT the forward hotspot.
        page.mouse.move(setup['wrongCorner']['x'],
                        setup['wrongCorner']['y'])
        page.wait_for_timeout(860)
        assert page.evaluate('jfDeskPageIndex')==setup['index'], setup
        assert page.evaluate('JFEpubSelection.reference()?.ref')==before
        # Only the lower-right outer corner turns forward.
        page.mouse.move(setup['corner']['x'], setup['corner']['y'])
        page.wait_for_function("""(target)=>jfDeskPageIndex===target &&
          JFEpubSelection.diagnostics().crossPage""",
                               arg=setup['target'], timeout=6000)
        # The physical mouse stays in the same place after the flip.
        current=page.evaluate("""()=>({
          ref:JFEpubSelection.reference()?.ref,
          page:jfDeskPageIndex,
          locked:JFEpubSelection.diagnostics().edgeLocked
        })""")
        assert current['ref'] and current['locked'], (setup,current)
        page.wait_for_timeout(950)
        stable=page.evaluate("""()=>({
          ref:JFEpubSelection.reference()?.ref,page:jfDeskPageIndex
        })""")
        assert stable=={'ref':current['ref'],'page':current['page']}, (
          setup,current,stable)
    finally:
        page.mouse.up()
    page.wait_for_function("""()=>!document.getElementById(
      'jfEpubSelectionMenu').hidden && !!JFEpubSelection.reference()""")
    page.evaluate('()=>JFEpubSelection.reset()')



def assert_epub_images(page,book_id):
    """Click and mark two repeated EPUB illustrations by independent source index."""
    page.evaluate('(id)=>jfDeskOpenReader(id,0)',book_id)
    page.wait_for_function("""(id)=>jfDeskBook?.id===id&&!jfDeskRestoring&&
      jfDeskFlow.length>0""",arg=book_id,timeout=12000)
    # Paper mode is remembered per book. A new fixture has no saved preference.
    if not page.evaluate('jfDeskPaged'):
        page.locator('#jfReadPaged').click()
    page.wait_for_function("""()=>jfDeskPaged&&jfDeskPages.length>0""",
                           timeout=12000)
    overview=page.evaluate("""()=>{
      const images=[...jfDeskFlow[0].el.querySelectorAll('img')];
      return {indices:images.map(i=>i.dataset.jfEpubImageIndex),
        sources:images.map(i=>i.getAttribute('src')),paged:jfDeskPaged};
    }""")
    assert overview['paged'] and overview['indices']==['0','1'],overview
    assert overview['sources'][0]==overview['sources'][1],overview

    def focus(index):
        result=page.evaluate("""(index)=>{
          const sel='img[data-jf-epub-image-index="'+index+'"]';
          const at=jfDeskPages.findIndex(page=>page.some(b=>
            b.node?.matches?.(sel)||b.node?.querySelector?.(sel)));
          if(at<0)return {ok:false,reason:'no paginated image',index};
          const step=jfDeskPagedGeometry().two?2:1;
          jfDeskPageIndex=Math.floor(at/step)*step;
          jfDeskPagedRender();
          const img=document.querySelector('#jfSheetLeft '+sel+
            ',#jfSheetRight '+sel);
          if(!img)return {ok:false,reason:'no visible image',index,at};
          const r=img.getBoundingClientRect();
          return {ok:r.width>20&&r.height>20,
            x:r.left+r.width/2,y:r.top+r.height/2,
            page:jfDeskPageIndex,chapter:img.dataset.jfEpubImageChapter,
            source:img.currentSrc};
        }""",index)
        assert result['ok'],result
        page.mouse.click(result['x'],result['y'])
        page.wait_for_function("""(index)=>!document.getElementById(
          'jfEpubSelectionMenu').hidden&&
          JFEpubSelection.reference()?.ref.type==='epub-image'&&
          JFEpubSelection.reference()?.ref.imageIndex===index""",arg=index)
        assert page.evaluate('jfDeskPageIndex')==result['page'],result
        return result

    focus(0)
    page.locator('#jfEpubSelectionMenu [data-color="mint"]').click()
    page.wait_for_function("""()=>jfDeskWorkspace.marks.some(m=>
      m.bookId===jfDeskBook.id&&m.type==='epub-image'&&
      m.imageIndex===0&&m.color==='mint')""")
    page.wait_for_function("""()=>!!document.querySelector(
      '#jfSheetLeft img[data-jf-epub-image-color="mint"],'+
      '#jfSheetRight img[data-jf-epub-image-color="mint"]')""")
    style=page.evaluate("""()=>{
      const img=document.querySelector(
        '#jfSheetLeft img[data-jf-epub-image-color="mint"],'+
        '#jfSheetRight img[data-jf-epub-image-color="mint"]');
      return {outline:getComputedStyle(img).outlineStyle,
        originals:jfDeskFlow[0].el.querySelectorAll('img').length};
    }""")
    assert style['outline']=='solid' and style['originals']==2,style

    focus(0)
    page.locator('#jfEpubSelectionMenu [data-action="note"]').click()
    page.locator('#jfPdfQuoteChooser').wait_for(state='visible')
    page.locator('#jfPdfQuoteOptions button[data-note-id="new"]').click()
    page.locator('#jfPdfQuoteNewTitle').fill('旧书插图笔记')
    page.locator('#jfPdfQuoteCommit').click()
    page.wait_for_function("""()=>jfDeskWorkspace.notes.some(n=>
      n.title==='旧书插图笔记'&&n.quotes.some(q=>
        q.type==='image'&&q.epubImageIndex===0&&
        q.image.startsWith('data:image/jpeg;base64,')))""",timeout=12000)
    saved=page.evaluate("""()=>{
      const n=jfDeskWorkspace.notes.find(n=>n.title==='旧书插图笔记');
      return {index:n.quotes[0].epubImageIndex,size:n.quotes[0].image.length};
    }""")
    assert saved['index']==0 and 150<saved['size']<=235000,saved

    focus(0)
    page.locator('#jfEpubSelectionMenu [data-color="blue"]').click()
    page.wait_for_function("""()=>jfDeskWorkspace.marks.some(m=>
      m.type==='epub-image'&&m.imageIndex===0&&m.color===undefined)""")
    focus(1)
    page.locator('#jfEpubSelectionMenu [data-color="rose"]').click()
    page.wait_for_function("""()=>jfDeskWorkspace.marks.some(m=>
      m.type==='epub-image'&&m.imageIndex===1&&m.color==='rose')""")
    independent=page.evaluate("""()=>jfDeskWorkspace.marks.filter(m=>
      m.bookId===jfDeskBook.id&&m.type==='epub-image')
      .map(m=>[m.imageIndex,m.color||'blue']).sort((a,b)=>a[0]-b[0])""")
    assert independent==[[0,'blue'],[1,'rose']],independent

    page.evaluate("""()=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,
        value:{write:async items=>{window.__jfCopiedImageTypes=items[0].types;}}});
    }""")
    focus(1)
    page.locator('#jfEpubSelectionMenu [data-action="copy"]').click()
    page.wait_for_function("""()=>window.__jfCopiedImageTypes?.includes('image/png')&&
      document.getElementById('jfEpubSelectionMenu').hidden""")
    page.locator('#jfPdfMarksListToggle').click()
    page.wait_for_function("""()=>!document.getElementById('jfPdfMarksList').hidden&&
      document.getElementById('jfPdfMarksListItems').textContent.includes('图片标记')""")
    row=page.locator('#jfPdfMarksListItems .jfPdfMarkItem').filter(
        has_text='第二幅测试插图').first
    row.click()
    page.wait_for_function("""()=>document.getElementById('jfPdfMarksList').hidden&&
      !!document.querySelector('#jfSheetLeft img[data-jf-epub-image-index="1"],'+
      '#jfSheetRight img[data-jf-epub-image-index="1"]')""")
    page.evaluate('()=>{JFEpubSelection.reset();JFEpubSelection.restoreReady();}')
    page.wait_for_function("""()=>!!document.querySelector(
      '#jfSheetLeft img[data-jf-epub-image-color="rose"],'+
      '#jfSheetRight img[data-jf-epub-image-color="rose"]')""")
    focus(1)
    page.locator('#jfEpubSelectionMenu [data-action="mark"]').click()
    page.wait_for_function("""()=>!jfDeskWorkspace.marks.some(m=>
      m.bookId===jfDeskBook.id&&m.type==='epub-image'&&m.imageIndex===1)""")
    assert page.evaluate("""()=>jfDeskWorkspace.marks.some(m=>
      m.bookId===jfDeskBook.id&&m.type==='epub-image'&&m.imageIndex===0)""")

def main():
    with tempfile.TemporaryDirectory(
        prefix='jf-architecture-test-epub-selection-v7129-'
    ) as temp:
        work = pathlib.Path(temp)
        library = work / 'library'
        library.mkdir()
        make_epub(library / 'selection.epub')
        make_epub_images(library / 'illustrations.epub')
        proc = log = None
        try:
            proc, port, log = launch(ROOT / 'dist/douyin.js', library,
                                     work / 'home')
            origin = f'http://127.0.0.1:{port}'
            with urllib.request.urlopen(origin+'/api/books?refresh=1',
                                        timeout=30) as response:
                books=json.load(response)['books']
                book=next(b for b in books if b['name']=='selection.epub')
                image_book=next(b for b in books if b['name']=='illustrations.epub')
            with sync_playwright() as pw:
                browser = pw.chromium.launch(
                    executable_path='/usr/bin/chromium',
                    headless=True, args=['--no-sandbox'])
                page = browser.new_page(viewport={'width': 1340, 'height': 850})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin, wait_until='domcontentloaded')
                page.wait_for_function(
                    "()=>typeof JFEpubSelection==='object' && "
                    "typeof jfDeskOpenReader==='function'")
                page.evaluate('(id)=>jfDeskOpenReader(id,0)', book['id'])
                page.wait_for_function('()=>jfDeskFlow.length>0&&!jfDeskRestoring')
                if not page.evaluate('jfDeskPaged'):
                    page.locator('#jfReadPaged').click()
                page.wait_for_function(
                    "()=>jfDeskPaged&&jfDeskPages.length>0&&"
                    "document.getElementById('jfSheetLeft')?.querySelector('p')")
                page.wait_for_function('()=>!jfDeskRestoring')
                baseline = page.evaluate('jfDeskPages.length')
                choose(page, FIRST)
                visual = page.evaluate("""()=>{
                  const menu=document.getElementById('jfEpubSelectionMenu');
                  const ref=JFEpubSelection.reference()?.ref;
                  const source=jfDeskFlow.find(x=>x.n===ref?.chapter)?.el.textContent;
                  const sel=getSelection(),r=sel.getRangeAt(0);
                  return {overlay:!!document.querySelector('#jfEpubSelectionOverlay'),
                    visible:!menu.hidden,ref,selected:sel.toString(),
                    sourceText:source?.slice(ref?.anchorStart,
                      ref?.anchorStart+ref?.text.length),
                    color:getComputedStyle(r.startContainer.parentElement,'::selection').color,
                    nativeBackground:getComputedStyle(r.startContainer.parentElement,'::selection').backgroundColor,
                    temporaryCount:CSS.highlights.get('jf-epub-selection')?.size||0,
                    underline:getComputedStyle(r.startContainer.parentElement,'::highlight(jf-epub-selection)').textDecorationLine};
                }""")
                assert not visual['overlay'] and visual['visible'], visual
                assert visual['ref']['text'] == FIRST, visual
                assert visual['sourceText'] == FIRST, visual
                assert visual['selected'] == FIRST, visual
                assert '255, 255, 255' not in visual['color'], visual
                assert visual['nativeBackground'] in ('rgba(0, 0, 0, 0)', 'transparent'), visual
                assert visual['temporaryCount'] == 1 and visual['underline'] == 'underline', visual
                # Copy selected original text without saving a mark.
                page.evaluate("""()=>{
                  Object.defineProperty(navigator,'clipboard',{configurable:true,
                    value:{writeText:async text=>{window.__jfCopiedText=text;}}});
                }""")
                page.locator('#jfEpubSelectionMenu [data-action="copy"]').click()
                page.wait_for_function("""()=>window.__jfCopiedText==='纸书选区测试甲乙丙丁' &&
                  document.getElementById('jfEpubSelectionMenu').hidden""")
                assert not page.evaluate("""()=>jfDeskWorkspace.marks.some(m=>
                  m.text==='纸书选区测试甲乙丙丁')""")
                choose(page, FIRST)
                page.locator('#jfEpubSelectionMenu [data-action="mark"]').click()
                page.wait_for_function("""()=>jfDeskWorkspace.marks.some(m=>
                  m.text==='纸书选区测试甲乙丙丁')""")
                marked = page.evaluate("""()=>({
                  marks:jfDeskWorkspace.marks.filter(x=>x.bookId===jfDeskBook.id).length,
                  ranges:CSS.highlights.get('jf-epub-mark-amber')?.size||0,
                  painted:[...(CSS.highlights.get('jf-epub-mark-amber')||[])]
                    .map(r=>r.toString()).join(''),
                  underline:getComputedStyle(document.querySelector('#jfSheetLeft p'),
                    '::highlight(jf-epub-mark-amber)').textDecorationLine,
                  background:getComputedStyle(document.querySelector('#jfSheetLeft p'),
                    '::highlight(jf-epub-mark-amber)').backgroundColor,
                  pageCount:jfDeskPages.length
                })""")
                assert marked['marks'] == 1 and marked['ranges'] >= 1, marked
                assert marked['painted'] == FIRST and marked['underline'] == 'underline', marked
                assert marked['background'] == 'rgba(148, 115, 73, 0.09)', marked
                assert marked['pageCount'] == baseline, marked
                # EPUB exposes a real book-wide mark index.
                assert page.locator('#jfPdfMarksListToggle').is_visible()
                page.locator('#jfPdfMarksListToggle').click()
                page.wait_for_function("""()=>!document.getElementById('jfPdfMarksList').hidden
                  && document.getElementById('jfPdfMarksListItems')
                    .textContent.includes('纸书选区测试甲乙丙丁')""")
                assert page.evaluate("""()=>{
                  const header=document.querySelector('.jfReaderHeader')
                    .getBoundingClientRect();
                  const panel=document.getElementById('jfPdfMarksList')
                    .getBoundingClientRect();
                  return panel.top>=header.bottom+4;
                }"""), 'mark list must open below reader header'
                page.locator('#jfPdfMarksListToggle').click()
                assert page.locator('#jfPdfMarksList').is_hidden()
                # Blue is encoded as an omitted color field in the server.
                pos_blue=page.evaluate("""()=>{
                  const r=[...CSS.highlights.get('jf-epub-mark-amber')][0]
                    .getClientRects()[0];
                  return {x:r.left+r.width/2,y:r.top+r.height/2};
                }""")
                page.mouse.click(pos_blue['x'],pos_blue['y'])
                page.wait_for_function("""()=>!document.getElementById(
                  'jfEpubSelectionMenu').hidden""")
                page.locator('#jfEpubSelectionMenu [data-color="blue"]').click()
                page.wait_for_function("""()=>jfDeskWorkspace.marks.some(m=>
                  m.text==='纸书选区测试甲乙丙丁' && m.color===undefined) &&
                  [...(CSS.highlights.get('jf-epub-mark-blue')||[])]
                    .map(r=>r.toString()).join('')==='纸书选区测试甲乙丙丁'""")
                assert page.evaluate("""()=>
                  [...(CSS.highlights.get('jf-epub-mark-amber')||[])]
                    .every(r=>r.toString()!=='纸书选区测试甲乙丙丁')""")
                # Recolor back to amber to preserve later precise-source cases.
                pos_amber=page.evaluate("""()=>{
                  const r=[...CSS.highlights.get('jf-epub-mark-blue')][0]
                    .getClientRects()[0];
                  return {x:r.left+r.width/2,y:r.top+r.height/2};
                }""")
                page.mouse.click(pos_amber['x'],pos_amber['y'])
                page.wait_for_function("""()=>!document.getElementById(
                  'jfEpubSelectionMenu').hidden""")
                page.locator('#jfEpubSelectionMenu [data-color="amber"]').click()
                page.wait_for_function("""()=>jfDeskWorkspace.marks.some(m=>
                  m.text==='纸书选区测试甲乙丙丁'&&m.color==='amber') &&
                  [...(CSS.highlights.get('jf-epub-mark-amber')||[])]
                    .map(r=>r.toString()).join('')==='纸书选区测试甲乙丙丁'""")
                # A routine progress mutation used to repaint ALL highlights,
                # even though neither the visible book nor marks changed.
                before_progress = page.evaluate('JFEpubSelection.metrics.redraws')
                page.evaluate("""async()=>{
                  await jfDeskMutate({action:'progress',bookId:jfDeskBook.id,
                    chapter:jfDeskChapter,ratio:0,mode:'paged',
                    total:jfDeskOutline.chapters.length});
                }""")
                page.wait_for_timeout(90)
                after_progress = page.evaluate('JFEpubSelection.metrics.redraws')
                assert after_progress == before_progress, (
                    before_progress, after_progress)
                # Mouse-clicking an existing annotation must offer its actions,
                # instead of triggering the half-sheet page-turn handler.
                pos = page.evaluate("""()=>{
                  const r=[...CSS.highlights.get('jf-epub-mark-amber')][0]
                    .getClientRects()[0];
                  return {x:r.left+r.width/2,y:r.top+r.height/2};
                }""")
                page.mouse.click(pos['x'], pos['y'])
                page.wait_for_function("""()=>!document.getElementById(
                  'jfEpubSelectionMenu').hidden &&
                  document.querySelector('#jfEpubSelectionMenu '
                    +'[data-action=mark]').textContent==='取消标记'""")
                # Saved underline actions target the durable FULL mark, not a
                # synthetic native selection of only its first visible piece.
                assert page.evaluate("getSelection().toString()") == ''
                page.locator('#jfEpubSelectionMenu [data-action="mark"]').click()
                page.wait_for_function("""()=>!jfDeskWorkspace.marks.some(m=>
                  m.text==='纸书选区测试甲乙丙丁')""")
                assert page.evaluate('jfDeskPages.length') == baseline
                # A real Selection spans two independently printed paragraph
                # blocks. The saved mark must consist of exactly those glyphs,
                # without the browser's visual paragraph separators.
                cross_selected = choose_across_paragraphs(page)
                cross = page.evaluate("""()=>{
                  const ref=JFEpubSelection.reference()?.ref;
                  const source=jfDeskFlow.find(s=>s.n===ref?.chapter)?.el.textContent;
                  return {ref,original:source?.slice(ref.anchorStart,
                    ref.anchorStart+ref.text.length),
                    ranges:[...(CSS.highlights.get('jf-epub-selection')||[])]
                      .map(r=>r.toString())};
                }""")
                assert cross['ref'] and cross['ref']['text'] == cross['original'], cross
                assert '纸书选区测试甲乙丙丁' in cross['ref']['text'], cross
                assert '此段用于检验注释之后' in cross['ref']['text'], cross
                assert len(cross['ranges']) >= 2, cross
                assert ''.join(cross['ranges']).replace(' ', '').replace('\n', '') == (
                    cross['ref']['text'].replace(' ', '').replace('\n', '')), cross
                page.locator('#jfEpubSelectionMenu [data-action="mark"]').click()
                page.wait_for_function("""(selected)=>jfDeskWorkspace.marks.some(m=>
                  m.text===selected)""", arg=cross['ref']['text'])
                cross_mark = page.evaluate("""(selected)=>{
                  const m=jfDeskWorkspace.marks.find(m=>m.text===selected);
                  return {mark:m,ranges:[...(CSS.highlights.get('jf-epub-mark-amber')||[])]
                    .map(r=>r.toString())};
                }""", cross['ref']['text'])
                assert cross_mark['mark']['anchorStart'] == cross['ref']['anchorStart'], cross_mark
                assert ''.join(cross_mark['ranges']).replace(' ', '').replace('\n', '') == (
                    cross['ref']['text'].replace(' ', '').replace('\n', '')), cross_mark
                assert len(cross_mark['ranges']) >= 2, cross_mark
                # Tap the second (not first) line of the same saved mark:
                # the menu must still target the WHOLE cross-paragraph mark.
                pos = page.evaluate("""()=>{
                  const spans=[...CSS.highlights.get('jf-epub-mark-amber')];
                  const r=spans[spans.length-1].getClientRects()[0];
                  return {x:r.left+r.width/2,y:r.top+r.height/2};
                }""")
                page.mouse.click(pos['x'],pos['y'])
                page.wait_for_function("""()=>!document.getElementById(
                  'jfEpubSelectionMenu').hidden&&document.querySelector(
                  '#jfEpubSelectionMenu [data-action=mark]').textContent==='取消标记'""")
                page.locator('#jfEpubSelectionMenu [data-action="mark"]').click()
                page.wait_for_function("""(selected)=>!jfDeskWorkspace.marks.some(m=>
                  m.text===selected)""", arg=cross['ref']['text'])
                assert page.evaluate('jfDeskPages.length') == baseline
                # Cross-paragraph excerpt must remain a real note, while the
                # associated highlight is anchored to the exact source span.
                choose_across_paragraphs(page)
                page.locator('#jfEpubSelectionMenu [data-action="note"]').click()
                page.locator('#jfPdfQuoteChooser').wait_for(state='visible')
                page.locator('#jfPdfQuoteOptions button[data-note-id="new"]').click()
                page.locator('#jfPdfQuoteNewTitle').fill('跨自然段原文笔记')
                page.locator('#jfPdfQuoteCommit').click()
                page.wait_for_function("""()=>jfDeskWorkspace.notes.some(n=>
                  n.title==='跨自然段原文笔记')""")
                cross_note = page.evaluate("""(selected)=>{
                  const n=jfDeskWorkspace.notes.find(x=>x.title==='跨自然段原文笔记');
                  const mark=jfDeskWorkspace.marks.find(x=>x.text===selected);
                  return {quote:n?.quotes[0]?.text,mark};
                }""", cross['ref']['text'])
                assert '纸书选区测试甲乙丙丁' in cross_note['quote'], cross_note
                assert '此段用于检验注释之后' in cross_note['quote'], cross_note
                assert cross_note['mark']['anchorStart'] == cross['ref']['anchorStart'], cross_note
                assert page.evaluate('jfDeskPages.length') == baseline
                choose(page, SECOND)
                page.locator('#jfEpubSelectionMenu [data-action="note"]').click()
                page.locator('#jfPdfQuoteChooser').wait_for(state='visible')
                page.locator('#jfPdfQuoteOptions button[data-note-id="new"]').click()
                page.locator('#jfPdfQuoteNewTitle').fill('纸书摘录笔记')
                page.locator('#jfPdfQuoteCommit').click()
                page.wait_for_function("""()=>jfDeskWorkspace.notes.some(n=>
                  n.title==='纸书摘录笔记'&&n.quotes.some(q=>
                    q.text==='加入笔记测试子丑寅卯'))""")
                assert page.evaluate('jfDeskPages.length') == baseline
                assert page.evaluate("""()=>jfDeskWorkspace.marks.some(m=>
                  m.text==='加入笔记测试子丑寅卯')""")
                # A real selection spanning two facing *physical* leaves
                # must be accepted without including paper headers or spine.
                facingSetup, facing = choose_across_visible_pages(page)
                selectedAcross = facing['ref']['text']
                page.locator('#jfEpubSelectionMenu [data-action="mark"]').click()
                page.wait_for_function("""(text)=>jfDeskWorkspace.marks.some(m=>
                  m.text===text)""", arg=selectedAcross)
                stored = page.evaluate("""(text)=>{
                  const mark=jfDeskWorkspace.marks.find(m=>m.text===text);
                  const ranges=[...(CSS.highlights.get('jf-epub-mark-amber')||[])];
                  // Earlier quote/note acceptance steps legitimately created
                  // other amber marks. New mark ranges are the final two.
                  const own=ranges.slice(-2);
                  return {mark,ink:own.map(r=>r.toString()).join(''),
                    leaves:[...new Set(own.map(r=>r.startContainer.parentElement
                      .closest('.jfSheetBody')?.id))]};
                }""", selectedAcross)
                assert stored['mark']['anchorStart']==facing['ref']['anchorStart'], stored
                assert stored['ink'].replace(' ', '').replace('\n', '')==(
                    selectedAcross.replace(' ', '').replace('\n', '')), stored
                assert set(stored['leaves'])=={'jfSheetLeft','jfSheetRight'}, stored
                point = page.evaluate("""()=>{
                  const r=[...CSS.highlights.get('jf-epub-mark-amber')]
                    .slice(-2).find(x=>x.startContainer.parentElement
                      .closest('.jfSheetBody')?.id==='jfSheetRight')
                    .getClientRects()[0];
                  return {x:r.left+r.width/2,y:r.top+r.height/2};
                }""")
                page.mouse.click(point['x'],point['y'])
                page.wait_for_function("""()=>!document.getElementById(
                  'jfEpubSelectionMenu').hidden&&
                  document.querySelector('#jfEpubSelectionMenu [data-action=mark]')
                    .textContent==='取消标记'""")
                page.locator('#jfEpubSelectionMenu [data-action="mark"]').click()
                page.wait_for_function("""(text)=>!jfDeskWorkspace.marks.some(m=>
                  m.text===text)""", arg=selectedAcross)
                assert page.evaluate('jfDeskPages.length')==baseline
                assert_drag_stays_native(page)
                # The precise-source check must hold inside a split paragraph,
                # not only for a short untouched single-paragraph block.
                target = page.evaluate("""()=>{
                  const i=jfDeskPages.findIndex(p=>p.some(x=>
                    x.node.textContent.includes('分页后精确标记辛壬癸甲乙丙丁')));
                  const step=jfDeskPagedGeometry().two?2:1;
                  if(i<0)return {i,found:false};
                  jfDeskPageIndex=Math.floor(i/step)*step;
                  jfDeskPagedRender();
                  return {i,found:true,page:jfDeskPageIndex};
                }""")
                assert target['found'] and target['i'] >= 2, target
                choose(page, THIRD)
                ref = page.evaluate("""()=>JFEpubSelection.reference()?.ref""")
                assert ref['text'] == THIRD, ref
                source_fragment = page.evaluate("""(r)=>{
                  const src=jfDeskFlow.find(s=>s.n===r.chapter).el.textContent;
                  return src.slice(r.anchorStart,r.anchorStart+r.text.length);
                }""", ref)
                assert source_fragment == THIRD, (ref, source_fragment)
                page.locator('#jfEpubSelectionMenu [data-action="mark"]').click()
                page.wait_for_function("""()=>jfDeskWorkspace.marks.some(m=>
                  m.text==='分页后精确标记辛壬癸甲乙丙丁')""")
                split_paint = page.evaluate("""()=>{
                  return [...(CSS.highlights.get('jf-epub-mark-amber')||[])]
                    .map(r=>r.toString()).join('');
                }""")
                assert split_paint == THIRD, split_paint
                assert page.evaluate('jfDeskPages.length') == baseline
                # Reader reopening previously dropped all marks because the
                # render hook ran while jfDeskRestoring was true.
                page.evaluate('()=>JFEpubSelection.reset()')
                page.evaluate('()=>JFEpubSelection.restoreReady()')
                page.wait_for_function("""()=>JFEpubSelection.metrics.lastVisible>=1
                  && (CSS.highlights.get('jf-epub-mark-amber')?.size||0)>=1""")
                diagnostic = page.evaluate('JFEpubSelection.diagnostics()')
                assert diagnostic['lastReasons'].get('unresolved', 0) == 0, diagnostic
                assert diagnostic['paintMs'] < 200, diagnostic
                # Dozens of visible saved marks must not produce an O(N)
                # geometry measurement per click or a giant redraw.
                pressure = page.evaluate("""()=>{
                  const own=(jfDeskPages[jfDeskPageIndex]||[])
                    .concat(jfDeskPages[jfDeskPageIndex+1]||[]);
                  const existing=jfDeskWorkspace.marks;
                  const fake=[];
                  for(const item of own){
                    if(!Number.isSafeInteger(item.sourceOffset)||!item.node)continue;
                    const text=item.node.textContent;
                    for(let i=0;i+3<=text.length&&fake.length<120;i+=3)
                      fake.push({type:'text',bookId:jfDeskBook.id,chapter:item.chapter,
                        anchorStart:item.sourceOffset+i,text:text.slice(i,i+3),
                        length:3,color:'amber'});
                  }
                  if(fake.length<30)return {ok:false,count:fake.length};
                  window.__jfStressOriginalMarks=existing;
                  jfDeskWorkspace.marks=existing.concat(fake);
                  const before=JFEpubSelection.metrics.redraws;
                  JFEpubSelection.refresh();
                  return {ok:true,count:fake.length,before};
                }""")
                assert pressure['ok'], pressure
                page.wait_for_function("""(before)=>
                  JFEpubSelection.metrics.redraws>before""", arg=pressure['before'])
                pressure_diag = page.evaluate('JFEpubSelection.diagnostics()')
                assert pressure_diag['paintMs'] < 250, (pressure,pressure_diag)
                assert pressure_diag['lastVisible'] >= 2, pressure_diag
                page.evaluate("""()=>{
                  jfDeskWorkspace.marks=window.__jfStressOriginalMarks;
                  delete window.__jfStressOriginalMarks;JFEpubSelection.refresh();
                }""")
                # List navigation must preserve source DOM and close the panel.
                page.locator('#jfPdfMarksListToggle').click()
                page.wait_for_function("""()=>!document.getElementById('jfPdfMarksList').hidden
                  && document.querySelector('#jfPdfMarksListItems .jfPdfMarkItem')""")
                page.locator('#jfPdfMarksListItems .jfPdfMarkItem').first.click()
                page.wait_for_function("""()=>!jfDeskRestoring &&
                  document.getElementById('jfPdfMarksList').hidden""")
                assert page.evaluate("""()=>!document.querySelector(
                  '#jfReadText mark.jfReadCitation')""")
                # Separate synthetic held-pointer cases cover both directions.
                # A synthetic touch pointer verifies the JS gesture contract,
                # not iOS native selection-handle behavior.
                assert_corner_dwell(page, 1, 'mouse')
                assert_corner_dwell(page, -1, 'touch')
                assert_real_forward_mouse(page)
                assert_epub_images(page,image_book['id'])
                assert not errors, errors
                print('PASS v7.137 Chromium EPUB: blue, copy, book mark list, '
                      'saved mark on both pages, right-leaf undo, '
                      '120 native drag events, precise source offsets', flush=True)
                browser.close()
        finally:
            if proc is not None:
                stop(proc, log)


if __name__ == '__main__':
    main()
