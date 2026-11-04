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
                   '<item id="img1" href="images/pic.png" media-type="image/png"/>'
                   '<item id="c3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>'
                   '<item id="c4" href="text/ch4.xhtml" media-type="application/xhtml+xml"/>'
                   '<item id="c5" href="text/ch5.xhtml" media-type="application/xhtml+xml"/>'
                   '<item id="c6" href="text/ch6.xhtml" media-type="application/xhtml+xml"/></manifest>'
                   '<spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/>'
                   '<itemref idref="c4"/><itemref idref="c5"/><itemref idref="c6"/></spine></package>')
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
        for i in range(3, 7):
            body = ''.join('<p>filler paragraph %d of chapter %d, long enough that the '
                           'spread layout still has to scroll.</p>' % (j, i) for j in range(1, 14))
            z.writestr('OEBPS/text/ch%d.xhtml' % i,
                       '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml">'
                       '<head><title>c%d</title></head><body><h1>Chapter %d</h1>%s</body></html>' % (i, i, body))


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
            # v7.32: continuous reading mounts neighbouring chapters on scroll.
            mounted = page.evaluate("()=>document.querySelectorAll('#jfReadText [data-chapter]').length")
            ck('Opening a book mounts the first chapters', mounted >= 2, str(mounted))
            page.evaluate("()=>{const c=document.getElementById('jfReadCenter');c.scrollTop=c.scrollHeight;}")
            page.wait_for_timeout(1200)
            grown = page.evaluate("()=>document.querySelectorAll('#jfReadText [data-chapter]').length")
            ck('Scrolling to the bottom mounts the next chapter', grown > mounted, str((mounted, grown)))
            order = page.evaluate(
                "()=>[...document.querySelectorAll('#jfReadText [data-chapter]')].map(s=>Number(s.dataset.chapter))")
            ck('Mounted chapters stay in reading order', order == sorted(order), str(order))
            excerpt = page.evaluate("""()=>{
              const secs=[...document.querySelectorAll('#jfReadText [data-chapter]')];
              const sec=secs.find(s=>s.textContent.trim().length>40)||secs[0];
              const walker=document.createTreeWalker(sec,NodeFilter.SHOW_TEXT);
              let n=null;while((n=walker.nextNode()))if(n.nodeValue.trim().length>0)break;
              if(!n)return {err:'no text node', secLen:sec.textContent.length};
              const r=document.createRange();r.setStart(n,0);r.setEnd(n,Math.min(6,n.nodeValue.length));
              const sel=getSelection();sel.removeAllRanges();sel.addRange(r);
              const selected=sel.toString();
              jfDeskExcerpt();
              const q=(typeof jfDeskQuotePending==='undefined')?null:jfDeskQuotePending;
              return {selected, hasBook:!!jfDeskBook, hasPending:!!q,
                      chapter:q?q.chapter:null, local:q?(q.anchorStart<=sec.textContent.length):null,
                      matches:q?(sec.textContent.slice(q.anchorStart,q.anchorStart+q.text.length)===q.text):null,
                      saveFailed:(typeof jfDeskSaveFailed==='undefined')?null:jfDeskSaveFailed};
            }""")
            ck('Excerpt anchor stays chapter-local in continuous mode',
               bool(excerpt) and excerpt['local'] and excerpt['matches'], str(excerpt))
            # Dismiss the excerpt chooser so it cannot intercept the paged-mode clicks.
            page.evaluate("()=>{const c=document.getElementById('jfPdfQuoteChooser');if(c)c.hidden=true;"
                          "const s=getSelection();if(s)s.removeAllRanges();}")
            page.wait_for_timeout(200)
            # v7.32: paper surface and spread layout.
            spread = page.evaluate("""()=>{
              const t=document.getElementById('jfReadText');
              const c=getComputedStyle(t);
              return {cols:c.columnCount, width:Math.round(t.getBoundingClientRect().width)};
            }""")
            if spread['width'] >= 1120:
                ck('Wide viewport lays the text out as a two-page spread',
                   spread['cols'] == '2', str(spread))
                ck('The spine is drawn as a fixed overlay',
                   'gradient' in page.evaluate(
                       "()=>getComputedStyle(document.getElementById('jfReadCenter'),'::after').backgroundImage"))
            else:
                ck('Narrow viewport stays single column', spread['cols'] in ('auto', '1'), str(spread))
            page.wait_for_timeout(300)
            paper = page.evaluate("""()=>{
              jfDeskSetPref({theme:'paper'});
              const t=document.getElementById('jfReadText'), cs=getComputedStyle(t);
              const out={paper:document.getElementById('jfReader').classList.contains('paper'),
                         bg:cs.backgroundColor, noise:cs.backgroundImage.includes('svg'),
                         ink:cs.color};
              jfDeskSetPref({theme:'dark'});
              return out;
            }""")
            ck('Paper theme paints a sheet with fibre grain',
               paper['paper'] and paper['noise'] and 'gradient' not in paper['bg'], str(paper))
            ck('Paper ink is dark on the sheet', paper['ink'] == 'rgb(43, 37, 29)', str(paper['ink']))
            # v7.32: paged (paper book) mode is opt-in and turns pages horizontally.
            ck('Continuous scrolling is the default mode',
               page.evaluate("()=>!document.getElementById('jfReader').classList.contains('paged')"))
            page.locator('#jfReadPaged').click()
            page.wait_for_timeout(1200)
            paged = page.evaluate("""()=>{
              const c=document.getElementById('jfReadCenter');
              return {on:document.getElementById('jfReader').classList.contains('paged'),
                      oy:getComputedStyle(c).overflowY, ox:getComputedStyle(c).overflowX,
                      sl:Math.round(c.scrollLeft), step:Math.round(jfDeskPagedMetrics().step),
                      total:jfDeskPagedTotal()};
            }""")
            ck('Paged mode stops vertical scrolling',
               paged['on'] and paged['oy'] == 'hidden', str(paged))
            ck('Paged mode has more than one page', paged['total'] > 1, str(paged['total']))
            page.keyboard.press('ArrowRight')
            page.wait_for_timeout(800)
            after = page.evaluate("()=>Math.round(document.getElementById('jfReadCenter').scrollLeft)")
            ck('ArrowRight turns to the next page', after >= paged['step'], str((paged['sl'], after)))
            page.keyboard.press('ArrowLeft')
            page.wait_for_timeout(800)
            back = page.evaluate("()=>Math.round(document.getElementById('jfReadCenter').scrollLeft)")
            ck('ArrowLeft turns back a page', back < after, str((after, back)))
            box = page.locator('#jfReadCenter').bounding_box()
            page.mouse.click(box['x'] + box['width'] * 0.85, box['y'] + box['height'] * 0.5)
            page.wait_for_timeout(800)
            clicked = page.evaluate("()=>Math.round(document.getElementById('jfReadCenter').scrollLeft)")
            ck('Clicking the right half turns forward', clicked > back, str((back, clicked)))
            page.locator('#jfReadPaged').click()
            page.wait_for_timeout(900)
            off = page.evaluate("""()=>({on:document.getElementById('jfReader').classList.contains('paged'),
                  oy:getComputedStyle(document.getElementById('jfReadCenter')).overflowY})""")
            ck('Leaving paged mode restores continuous scrolling',
               (not off['on']) and off['oy'] == 'auto', str(off))
            browser.close()
    finally:
        if proc:
            stop(proc, lg)

print('TOTAL', checks)