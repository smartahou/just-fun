#!/usr/bin/env python3
"""v7.32: EPUB chapters render as sanitized HTML (images, structure) instead of flat text.

Server-side assertions cover the sanitizer contract; the Chromium pass proves a
real <img> from inside the archive actually decodes in the reader.
"""
import json, pathlib, tempfile, urllib.request, urllib.parse, zipfile, subprocess, sys
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop

checks = 0
def ck(label, ok, detail=''):
    global checks
    if not ok:
        raise AssertionError(f'{label}: {detail}')
    checks += 1
    print('PASS', label, flush=True)

def get(base, path, raw=False):
    with urllib.request.urlopen(base + path, timeout=25) as r:
        data = r.read()
        return (r.status, dict(r.headers), data) if raw else json.loads(data)

def build_epub(dest, png_bytes):
    with zipfile.ZipFile(dest, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" '
                   'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
                   '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                   '</rootfiles></container>')
        z.writestr('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?>'
                   '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
                   '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">demo</dc:identifier>'
                   '<dc:title>EPUB Render</dc:title><dc:language>zh</dc:language></metadata>'
                   '<manifest><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>'
                   '<item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>'
                   '<item id="img1" href="images/pic.png" media-type="image/png"/></manifest>'
                   '<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>')
        z.writestr('OEBPS/text/ch1.xhtml', '<?xml version="1.0" encoding="UTF-8"?>'
                   '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>one</title>'
                   '<style>body{color:red}</style></head><body><h1>Chapter One</h1>'
                   '<p>keep <strong>bold</strong> and <em>italic</em>.</p>'
                   '<figure><img src="../images/pic.png" alt="figure"/>'
                   '<figcaption>caption one</figcaption></figure>'
                   '<p>inline <code>code()</code> and <a href="#sec1">jump</a>.</p>'
                   '<h2 id="sec1">Section</h2><ul><li>alpha</li><li>beta</li></ul></body></html>')
        z.writestr('OEBPS/text/ch2.xhtml', '<?xml version="1.0" encoding="UTF-8"?>'
                   '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>two</title></head><body>'
                   '<h1>Chapter Two</h1><p>remote: <a href="https://example.com/x">link</a></p>'
                   '<p onclick="alert(1)">handler paragraph</p>'
                   '<img src="../../../../etc/passwd" alt="escape"/>'
                   '<img src="http://evil.example/x.png" alt="remote"/>'
                   '<script>window.pwned = true;</script><p>tail</p></body></html>')
        z.writestr('OEBPS/images/pic.png', png_bytes)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-epub-v732-') as d:
    tmp = pathlib.Path(d)
    lib = tmp / 'library'; lib.mkdir()
    png = tmp / 'src.png'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
                    '-i', 'testsrc2=size=320x200', '-frames:v', '1', str(png)],
                   check=True, timeout=40)
    build_epub(lib / 'render.epub', png.read_bytes())
    proc = lg = None
    try:
        proc, port, lg = launch(ROOT / 'dist/douyin.js', lib, tmp / 'home')
        base = 'http://127.0.0.1:' + str(port)
        books = get(base, '/api/books?refresh=1')['books']
        book = [b for b in books if b['name'].endswith('.epub')][0]
        bid = book['id']

        ch1 = get(base, '/api/reading/chapter?id=' + bid + '&chapter=0')
        ck('Chapter returns an html fragment', isinstance(ch1.get('html'), str) and ch1['html'])
        ck('Plain text is still returned for anchors', bool(ch1.get('text')))
        h1 = ch1['html']
        ck('In-archive image is rewritten to the asset route',
           '<img ' in h1 and '/api/reading/epub-asset' in h1)
        ck('Structure survives (heading, emphasis, list, code)',
           '<h1' in h1 and '<strong>' in h1 and '<li>' in h1 and '<code>' in h1)
        ck('In-page anchor is preserved', 'href="#sec1"' in h1)
        ck('Inline style element is removed', '<style' not in h1 and 'color:red' not in h1)

        ch2 = get(base, '/api/reading/chapter?id=' + bid + '&chapter=1')
        h2 = ch2['html']
        ck('Script is stripped', '<script' not in h2 and 'pwned' not in h2)
        ck('Inline event handler is stripped', 'onclick' not in h2)
        ck('Archive-escaping image is dropped', 'passwd' not in h2)
        ck('Remote image is dropped', 'evil.example' not in h2)
        ck('Remote link is flattened to text', 'example.com' not in h2 and 'link' in h2)

        status, headers, data = get(
            base, '/api/reading/epub-asset?id=' + bid +
            '&src=' + urllib.parse.quote('OEBPS/images/pic.png', safe=''), raw=True)
        ck('Asset is served', status == 200 and headers.get('Content-Type') == 'image/png')
        ck('Asset bytes are a real PNG', data[:8] == b'\x89PNG\r\n\x1a\n')

        for bad in ('../../etc/passwd', 'OEBPS/../../x', 'OEBPS/missing.png'):
            try:
                get(base, '/api/reading/epub-asset?id=' + bid +
                    '&src=' + urllib.parse.quote(bad, safe=''), raw=True)
                ck('Rejects ' + bad, False, 'served unexpectedly')
            except urllib.error.HTTPError as e:
                ck('Rejects ' + bad, e.code in (400, 404, 422), str(e.code))

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                        args=['--no-sandbox'])
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(base, wait_until='domcontentloaded', timeout=30000)
            page.wait_for_function("typeof jfDeskOpenReader==='function'", timeout=20000)
            page.evaluate('(id)=>jfDeskOpenReader(id)', bid)
            page.wait_for_function(
                "()=>{const t=document.getElementById('jfReadText');return t && t.querySelector('img')}",
                timeout=25000)
            page.wait_for_function(
                "()=>{const i=document.querySelector('#jfReadText img');return i && i.complete}",
                timeout=20000)
            info = page.evaluate("""()=>{
              const t=document.getElementById('jfReadText'), img=t.querySelector('img');
              return {html:t.classList.contains('jfReadHtml'), w:img?img.naturalWidth:0,
                      n:t.querySelectorAll('img').length,
                      ws:getComputedStyle(t).whiteSpace,
                      strong:t.querySelectorAll('strong').length,
                      li:t.querySelectorAll('li').length};
            }""")
            ck('Reader uses the HTML rendering path', info['html'])
            ck('Image actually decodes in the browser', info['w'] >= 100, str(info['w']))
            ck('Whitespace mode switched off pre-wrap', info['ws'] == 'normal', info['ws'])
            ck('Emphasis and list are rendered', info['strong'] >= 1 and info['li'] >= 2)
            ck('No page errors while reading', not errors)

            # v7.32: the fixed-position reader used to leave the page behind it
            # scrollable, which produced a second, meaningless scrollbar.
            lock = page.evaluate("""()=>{
              const r=document.getElementById('jfReader');
              const wasHidden=r.hidden;
              r.hidden=false;
              const open={html:getComputedStyle(document.documentElement).overflowY,
                          body:getComputedStyle(document.body).overflowY};
              r.hidden=true;
              const closed={body:getComputedStyle(document.body).overflowY};
              r.hidden=wasHidden;
              return {open,closed};
            }""")
            ck('Document is locked while the reader is open',
               lock['open']['html'] == 'hidden' and lock['open']['body'] == 'hidden',
               str(lock['open']))
            ck('Document scroll is restored after the reader closes',
               lock['closed']['body'] != 'hidden', str(lock['closed']))
            ck('One scroll container only: the chapter column itself',
               page.evaluate("""()=>{
                 const t=document.getElementById('jfReadText');
                 const c=document.getElementById('jfReadCenter');
                 return getComputedStyle(t).overflowY==='visible'
                     && ['auto','scroll'].includes(getComputedStyle(c).overflowY);
               }"""))
            browser.close()
    finally:
        if proc:
            stop(proc, lg)

print('TOTAL', checks)