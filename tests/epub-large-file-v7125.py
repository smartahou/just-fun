#!/usr/bin/env python3
"""v7.125: >40 MiB EPUB is read by ZIP offsets, not copied into RAM per chapter."""
import base64
import json
import pathlib
import tempfile
import urllib.parse
import urllib.request
import zipfile

from isolated import ROOT, launch, stop

PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8'
    '/x8AAwMCAO+/7y0AAAAASUVORK5CYII='
)


def request(base, uri, raw=False):
    with urllib.request.urlopen(base + uri, timeout=40) as resp:
        body = resp.read()
        return body if raw else json.loads(body)


def create_large_epub(dest):
    with zipfile.ZipFile(dest, 'w', allowZip64=False) as z:
        z.writestr('mimetype', 'application/epub+zip',
                   compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml',
                   '<container><rootfiles><rootfile '
                   'full-path="OEBPS/content.opf"/></rootfiles></container>')
        z.writestr('OEBPS/content.opf',
                   '<?xml version="1.0" encoding="UTF-8"?>'
                   '<package><metadata><meta name="cover" content="front"/></metadata>'
                   '<manifest><item id="a" href="chapter1.xhtml" media-type="application/xhtml+xml"/>'
                   '<item id="b" href="chapter2.xhtml" media-type="application/xhtml+xml"/>'
                   '<item id="front" href="images/front.png" media-type="image/png"/>'
                   '<item id="large" href="images/large.jpg" media-type="image/jpeg"/>'
                   '</manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>')
        z.writestr('OEBPS/chapter1.xhtml',
                   '<html><body><h1>第一章</h1><p>大书可以正常阅读。</p>'
                   '<img src="images/front.png" alt="封面"/></body></html>',
                   compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/chapter2.xhtml',
                   '<html><body><h1>第二章</h1><p>翻页不再重新读取整个压缩包。</p></body></html>')
        z.writestr('OEBPS/images/front.png', PNG)
        # A large STORED illustration makes the ZIP genuinely >40 MiB.
        # Stream fixed-size blocks; don't materialize a giant Python byte array.
        with z.open('OEBPS/images/large.jpg', 'w', force_zip64=False) as target:
            chunk = b'\0' * 1024 * 1024
            for _ in range(41):
                target.write(chunk)


def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-large-epub-v7125-') as tmp:
        root = pathlib.Path(tmp)
        library = root / 'books'
        library.mkdir()
        book_path = library / 'large-illustrated.epub'
        create_large_epub(book_path)
        assert book_path.stat().st_size > 40 * 1024 * 1024
        proc = log = None
        try:
            proc, port, log = launch(ROOT / 'dist/douyin.js', library, root / 'home')
            base = 'http://127.0.0.1:' + str(port)
            books = request(base, '/api/books?refresh=1')['books']
            book = next(b for b in books if b['name'] == book_path.name)
            ident = urllib.parse.quote(book['id'], safe='')
            outline = request(base, '/api/reading/outline?id=' + ident)
            assert outline['format'] == 'EPUB' and len(outline['chapters']) == 2, outline
            for i, expected in [(0, '大书可以正常阅读'), (1, '翻页不再重新读取')]:
                chapter = request(base, '/api/reading/chapter?id=' + ident +
                                  '&chapter=' + str(i))
                assert expected in chapter['text'], chapter
                assert chapter['total'] == 2, chapter
            asset = request(
                base, '/api/reading/epub-asset?id=' + ident +
                '&src=' + urllib.parse.quote('OEBPS/images/front.png', safe=''),
                raw=True)
            assert asset == PNG, (len(asset), len(PNG))
            cover = request(base, '/api/books/cover?id=' + ident, raw=True)
            assert cover == PNG, (len(cover), len(PNG))
            print('PASS v7.125: >40MiB on-disk EPUB outline, two chapters, '
                  'asset and cover; size=' + str(book_path.stat().st_size), flush=True)
        finally:
            if proc is not None:
                stop(proc, log)


if __name__ == '__main__':
    main()
