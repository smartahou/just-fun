#!/usr/bin/env python3
"""v7.126 real Chromium: image-led EPUB turns are atomic, unmodified and fast-path."""
import io
import json
import pathlib
import tempfile
import urllib.request
import zipfile

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop


def make_scan(n):
    im = Image.new('RGB', (800, 1180), 'white')
    pen = ImageDraw.Draw(im)
    pen.rectangle((40, 40, 760, 1138), outline='black', width=8)
    pen.rectangle((80, 140, 720, 470), outline='black', width=4)
    pen.rectangle((80, 510, 720, 1030), outline='black', width=4)
    pen.text((120, 160), 'SCAN ' + str(n), fill='black')
    out = io.BytesIO()
    im.save(out, format='JPEG', quality=88)
    return out.getvalue()


def epub(dest):
    with zipfile.ZipFile(dest, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip',
                   compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml',
                   '<container><rootfiles><rootfile '
                   'full-path="OEBPS/package.opf"/></rootfiles></container>')
        items = ''.join('<item id="c%d" href="text/c%d.xhtml" '
                        'media-type="application/xhtml+xml"/>' % (n, n)
                        for n in range(4))
        images = ''.join('<item id="i%d" href="images/p%d.jpg" '
                         'media-type="image/jpeg"/>' % (n, n)
                         for n in range(4))
        spine = ''.join('<itemref idref="c%d"/>' % n for n in range(4))
        z.writestr('OEBPS/package.opf', '<package><metadata></metadata><manifest>' +
                   items + images + '</manifest><spine>' + spine + '</spine></package>')
        for n in range(4):
            z.writestr('OEBPS/text/c%d.xhtml' % n,
                       '<html><body><img src="../images/p%d.jpg" alt="page"/></body></html>' % n)
            z.writestr('OEBPS/images/p%d.jpg' % n, make_scan(n))


def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-comics-v7126-') as temp:
        work = pathlib.Path(temp)
        library = work / 'library'
        library.mkdir()
        epub(library / 'manga-test.epub')
        proc = log = None
        try:
            proc, port, log = launch(ROOT / 'dist/douyin.js', library, work / 'home')
            origin = 'http://127.0.0.1:' + str(port)
            with urllib.request.urlopen(origin + '/api/books?refresh=1', timeout=30) as resp:
                book = next(item for item in json.load(resp)['books']
                            if item['name'] == 'manga-test.epub')
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path='/usr/bin/chromium',
                                             headless=True, args=['--no-sandbox'])
                page = browser.new_page(viewport={'width': 1400, 'height': 920})
                errors = []
                page.on('pageerror', lambda exc: errors.append(str(exc)))
                page.goto(origin, wait_until='domcontentloaded')
                page.wait_for_function("typeof jfDeskOpenReader === 'function'")
                page.evaluate('(bookId)=>jfDeskOpenReader(bookId,0)', book['id'])
                page.wait_for_function("()=>jfDeskFlow.length>0 && !jfDeskRestoring")
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>jfDeskPaged&&jfDeskPages.length>0")
                page.evaluate("""async()=>{
                  for(let n=1;n<4;n++)await jfDeskFlowAppend(n);
                }""")
                page.wait_for_function("()=>jfDeskPages.length===4")
                page.wait_for_function("""()=>{
                  const img=document.querySelector('#jfSheetLeft img[data-jf-comic-image]');
                  return img?.complete&&img.naturalWidth===800;
                }""")
                report = page.evaluate("""()=>{
                  const all=jfDeskPages;
                  const left=document.getElementById('jfSheetLeft');
                  const img=left.querySelector('img[data-jf-comic-image]');
                  const sheet=left.closest('.jfSheet');
                  const cs=img?getComputedStyle(img):null;
                  return {
                    leaves:all.length, allAtomic:all.every(p=>p.length===1&&p[0].comic),
                    scannedText:all.map(p=>p[0].node.textContent).join(''),
                    width:img?.naturalWidth||0, objectFit:cs?.objectFit,
                    comicCss:sheet?.classList.contains('jf-comic-leaf'),
                    originalSrc:img?.getAttribute('src')?.startsWith('/api/reading/epub-asset?'),
                    knockout:img?.dataset.jfPlate||null,
                    diagnostics:JFComicDiagnostics()
                  };
                }""")
                assert report['leaves'] == 4 and report['allAtomic'], report
                assert report['scannedText'] == '', report
                assert report['width'] == 800 and report['objectFit'] == 'contain', report
                assert report['comicCss'] and report['originalSrc'], report
                assert report['knockout'] is None, report
                page.evaluate('()=>jfDeskPageTurn(1)')
                page.wait_for_function("()=>jfDeskPageIndex===2")
                page.wait_for_function("""()=>{
                  const sheet=document.getElementById('jfSheetLeft');
                  return sheet&&sheet.closest('.jfSheet')?.classList.contains('jf-comic-leaf')&&
                    sheet.querySelector('img[data-jf-comic-image]');
                }""")
                assert not errors, errors
                print('PASS v7.126 real Chrome manga: ' +
                      json.dumps(report, ensure_ascii=False), flush=True)
                browser.close()
        finally:
            if proc is not None:
                stop(proc, log)


if __name__ == '__main__':
    main()
