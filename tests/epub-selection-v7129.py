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
        z.writestr('OEBPS/chapter.xhtml',
                   '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
                   '<h2>选区测试</h2><p>' + text + '</p>'
                   '<p>此段用于检验注释之后正文没有被重写。</p>'
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
                  const patches=document.querySelectorAll('#jfEpubSelectionOverlay span');
                  const menu=document.getElementById('jfEpubSelectionMenu');
                  return {patches:patches.length,visible:!menu.hidden,
                    ref:JFEpubSelection.reference()?.ref};
                }""")
                assert visual['patches'] >= 1 and visual['visible'], visual
                assert visual['ref']['text'] == FIRST, visual
                page.locator('#jfEpubSelectionMenu [data-action="mark"]').click()
                page.wait_for_function("""()=>jfDeskWorkspace.marks.some(m=>
                  m.text==='纸书选区测试甲乙丙丁')""")
                marked = page.evaluate("""()=>({
                  marks:jfDeskWorkspace.marks.filter(x=>x.bookId===jfDeskBook.id).length,
                  ranges:CSS.highlights.get('jf-epub-mark-amber')?.size||0,
                  pageCount:jfDeskPages.length
                })""")
                assert marked['marks'] == 1 and marked['ranges'] >= 1, marked
                assert marked['pageCount'] == baseline, marked
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
                assert not errors, errors
                print('PASS v7.129 Chromium EPUB: soft selection patches, '
                      'source-anchored durable mark, note chooser and '
                      'atomic note+mark save; unchanged pagination', flush=True)
                browser.close()
        finally:
            if proc is not None:
                stop(proc, log)


if __name__ == '__main__':
    main()
