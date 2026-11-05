#!/usr/bin/env python3
"""Synthetic EPUB + real Chromium: old-paper TOC and current-spread note tabs.
Never opens the user's media directory or books.
"""
import json
import pathlib
import tempfile
import time
import urllib.request
import zipfile

from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop


def make_epub(p):
    filler = ''.join(
        '<p>' + ('松风吹过书页，字迹清楚，旧纸自然。' * 42) + '</p>'
        for _ in range(32)
    )
    files = {
        'mimetype': 'application/epub+zip',
        'META-INF/container.xml': (
            '<container><rootfiles><rootfile full-path="OPS/book.opf"/>'
            '</rootfiles></container>'
        ),
        'OPS/book.opf': (
            '<package><metadata><dc:title xmlns:dc="x">Paper Tabs Fixture</dc:title></metadata>'
            '<manifest>'
            '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
            '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>'
            '<item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>'
            '<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>'
            '</manifest><spine><itemref idref="nav"/><itemref idref="a"/>'
            '<itemref idref="b"/></spine></package>'
        ),
        'OPS/nav.xhtml': (
            '<html><body><nav epub:type="toc"><ol><li>'
            '<a href="a.xhtml#start">本篇</a><ol><li>'
            '<a href="b.xhtml#next">下篇</a></li></ol></li></ol></nav></body></html>'
        ),
        'OPS/a.xhtml': (
            '<html><body><h2 id="start">本篇</h2>'
            '<p>却顾<a epub:type="noteref" href="notes.xhtml#n17">[17]</a>翠微。'
            '这一句确实附有笺注。</p>'
            '<p>字面数字 [2018] 不是注释，不能消失。</p>'
            + filler + '</body></html>'
        ),
        'OPS/b.xhtml': '<html><body><h2 id="next">下篇</h2><p>这里没有笺注。</p></body></html>',
        'OPS/notes.xhtml': (
            '<html><body><aside epub:type="footnote" id="n17">'
            '<p>回头看山色的意思。</p></aside></body></html>'
        )
    }
    with zipfile.ZipFile(p, 'w') as z:
        for name, content in files.items():
            z.writestr(name, content, compress_type=zipfile.ZIP_STORED if name == 'mimetype'
                       else zipfile.ZIP_DEFLATED)


def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-epub-tabs-v7782-') as d:
        temp = pathlib.Path(d)
        library = temp / 'books'
        library.mkdir()
        make_epub(library / 'tabs.epub')
        proc = log = None
        try:
            proc, port, log = launch(ROOT / 'dist' / 'douyin.js', library, temp / 'home')
            url = 'http://127.0.0.1:' + str(port)
            for _ in range(80):
                try:
                    with urllib.request.urlopen(url + '/api/books?refresh=1', timeout=5) as r:
                        books = json.load(r)['books']
                    break
                except Exception:
                    time.sleep(.3)
            book = next(x for x in books if x['name'] == 'tabs.epub')
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path='/usr/bin/chromium',
                                            headless=True, args=['--no-sandbox'])
                page = browser.new_page(viewport={'width': 1440, 'height': 900})
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(url, wait_until='domcontentloaded')
                page.wait_for_function("typeof jfDeskOpenReader === 'function'")
                page.evaluate('(id) => jfDeskOpenReader(id, 1)', book['id'])
                page.wait_for_function("() => jfDeskOutline?.format === 'EPUB'")
                assert page.evaluate("() => jfDeskOutline.toc.length") == 2
                assert page.evaluate("() => jfDeskOutline.annotations.length") == 1
                assert page.evaluate("() => jfDeskOutline.chapters[0].paperOmit") == 'toc-nav'
                # Flow reading retains untouched source. Filtering is paper-only.
                assert '[17]' in page.locator('#jfReadText').inner_text()
                page.evaluate('() => jfDeskPagedToggle()')
                page.wait_for_function(
                    "() => jfDeskPaged && jfDeskPages.length > 2 && window.JFEpubPaperTabs?.hasToc()",
                    timeout=55000
                )
                assert page.evaluate("() => jfDeskPageIndex >= 0")
                assert page.locator('.jfEpubTocTab').is_visible()
                assert page.locator('.jfEpubNoteTab').is_visible()
                assert '[17]' not in page.locator('#jfSheetLeft').inner_text()
                assert page.evaluate("() => window.JFEpubPaperTabs.getCurrentNotes().length") == 1
                page.locator('.jfEpubNoteTab').evaluate('(b) => b.click()')
                assert page.locator('.jfEpubPaperDrawer').is_visible()
                assert '回头看山色' in page.locator('.jfEpubPaperDrawer').inner_text()
                page.keyboard.press('Escape')
                assert not page.locator('.jfEpubPaperDrawer').is_visible()
                page.locator('.jfEpubTocTab').evaluate('(b) => b.click()')
                assert '本篇' in page.locator('.jfEpubPaperDrawer').inner_text()
                # Programmatically activate the real TOC entry; it must navigate
                # through jfDeskShowChapter and restore the mapped source chapter.
                page.locator('.jfEpubTocJump').filter(has_text='下篇').first.evaluate('(b) => b.click()')
                page.wait_for_function('() => jfDeskChapter === 2', timeout=20000)
                assert not page.locator('.jfEpubNoteTab').is_visible()
                assert page.locator('.jfEpubTocTab').is_visible()
                assert not errors, errors[:3]
                (ROOT / 'dist').mkdir(exist_ok=True)
                page.screenshot(path=str(ROOT / 'dist' / 'epub-tabs-v7782.png'))
                print('PASS Chromium EPUB TOC jump, note presence/absence, paper-only filtering, Esc, unchanged flow')
                browser.close()
        finally:
            if proc:
                stop(proc, log)


if __name__ == '__main__':
    main()
