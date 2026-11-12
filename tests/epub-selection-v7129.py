#!/usr/bin/env python3
"""v7.129 Chromium: EPUB paper selection, saved mark and source-linked notes."""
import json
import pathlib
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
                   '<h2>选区测试</h2><p>' + text + '</p>'
                   '<p>此段用于检验注释之后正文没有被重写。</p>'
                   '<p>' + long_text + THIRD + '，后文不应该被标记。</p>'
                   '</body></html>')


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


def main():
    with tempfile.TemporaryDirectory(
        prefix='jf-architecture-test-epub-selection-v7129-'
    ) as temp:
        work = pathlib.Path(temp)
        library = work / 'library'
        library.mkdir()
        make_epub(library / 'selection.epub')
        proc = log = None
        try:
            proc, port, log = launch(ROOT / 'dist/douyin.js', library,
                                     work / 'home')
            origin = f'http://127.0.0.1:{port}'
            with urllib.request.urlopen(origin+'/api/books?refresh=1',
                                        timeout=30) as response:
                book = next(b for b in json.load(response)['books']
                            if b['name'] == 'selection.epub')
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
                  pageCount:jfDeskPages.length
                })""")
                assert marked['marks'] == 1 and marked['ranges'] >= 1, marked
                assert marked['painted'] == FIRST and marked['underline'] == 'underline', marked
                assert marked['pageCount'] == baseline, marked
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
                assert page.evaluate("getSelection().toString()") == FIRST
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
                assert ''.join(cross['ranges']) == cross['ref']['text'], cross
                page.locator('#jfEpubSelectionMenu [data-action="mark"]').click()
                page.wait_for_function("""(selected)=>jfDeskWorkspace.marks.some(m=>
                  m.text===selected)""", arg=cross['ref']['text'])
                cross_mark = page.evaluate("""(selected)=>{
                  const m=jfDeskWorkspace.marks.find(m=>m.text===selected);
                  return {mark:m,ranges:[...(CSS.highlights.get('jf-epub-mark-amber')||[])]
                    .map(r=>r.toString())};
                }""", cross['ref']['text'])
                assert cross_mark['mark']['anchorStart'] == cross['ref']['anchorStart'], cross_mark
                assert ''.join(cross_mark['ranges']) == cross['ref']['text'], cross_mark
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
                assert not errors, errors
                print('PASS v7.129.3 Chromium EPUB: cross-paragraph selection, source-' 
                      'accurate segmented underlines, saved mark click/removal, '
                      'split pagination and note workflow', flush=True)
                browser.close()
        finally:
            if proc is not None:
                stop(proc, log)


if __name__ == '__main__':
    main()
