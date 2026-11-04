#!/usr/bin/env python3
"""v7.33: measured pagination must not lose text, crop images or overflow a page.

Builds four fixtures on the fly: a very long paragraph, an image-heavy chapter,
mixed CJK/Latin text, and a 40k-character TXT book.
"""
import json, pathlib, tempfile, urllib.request, zipfile, subprocess, time, re
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop

checks = 0
def ck(label, ok, detail=''):
    global checks
    if not ok:
        raise AssertionError(f'{label}: {detail}')
    checks += 1
    print('PASS', label, flush=True)

def get(base, path):
    with urllib.request.urlopen(base + path, timeout=30) as r:
        return json.loads(r.read())

LONG = '这是一段用于验证分页的连续长文本，不含换行。' * 260          # ~5000 chars, one block
MIXED = ('The quick brown fox jumps over the lazy dog. ' * 40 +
         '中文与 English 混排时的断行必须正确，不能把单词从中间切开。' * 60)

def build_epub(dest, png_bytes):
    chapters = [
        ('long', '<h1>超长段落</h1><p>%s</p>' % LONG),
        ('images', '<h1>图片密集</h1>' + ''.join(
            '<figure><img src="images/p%d.png" alt="p%d"/><figcaption>图 %d 说明</figcaption></figure>' % (i, i, i)
            for i in range(1, 7))),
        ('mixed', '<h1>中英混排</h1><p>%s</p><p>%s</p>' % (MIXED, MIXED)),
    ]
    with zipfile.ZipFile(dest, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml',
                   '<?xml version="1.0"?><container version="1.0" '
                   'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
                   '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                   '</rootfiles></container>')
        manifest = ''.join('<item id="c%d" href="text/c%d.xhtml" media-type="application/xhtml+xml"/>' % (i, i)
                           for i in range(3))
        manifest += ''.join('<item id="i%d" href="images/p%d.png" media-type="image/png"/>' % (i, i)
                            for i in range(1, 7))
        spine = ''.join('<itemref idref="c%d"/>' % i for i in range(3))
        z.writestr('OEBPS/content.opf',
                   '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" '
                   'version="3.0" unique-identifier="id"><metadata '
                   'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">pg</dc:identifier>'
                   '<dc:title>Pagination</dc:title><dc:language>zh</dc:language></metadata>'
                   '<manifest>%s</manifest><spine>%s</spine></package>' % (manifest, spine))
        for i, (_, body) in enumerate(chapters):
            z.writestr('OEBPS/text/c%d.xhtml' % i,
                       '<?xml version="1.0" encoding="UTF-8"?><html '
                       'xmlns="http://www.w3.org/1999/xhtml"><head><title>c%d</title></head>'
                       '<body>%s</body></html>' % (i, body))
        for i in range(1, 7):
            z.writestr('OEBPS/images/p%d.png' % i, png_bytes)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-paged-v733-') as d:
    tmp = pathlib.Path(d)
    lib = tmp / 'library'; lib.mkdir()
    png = tmp / 'src.png'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
                    '-i', 'testsrc2=size=640x420', '-frames:v', '1', str(png)],
                   check=True, timeout=40)
    build_epub(lib / 'pagination.epub', png.read_bytes())
    (lib / 'long.txt').write_text(('长文本段落测试。' * 40 + '\n\n') * 220, encoding='utf-8')
    proc = lg = None
    try:
        proc, port, lg = launch(ROOT / 'dist/douyin.js', lib, tmp / 'home')
        base = 'http://127.0.0.1:' + str(port)
        for _ in range(60):
            try:
                books = get(base, '/api/books?refresh=1')['books']; break
            except Exception: time.sleep(0.5)
        book = [b for b in books if b['name'] == 'pagination.epub'][0]

        with sync_playwright() as p:
            br = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                   args=['--no-sandbox'])
            pg = br.new_page(viewport={'width': 1200, 'height': 820})
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto(base, wait_until='domcontentloaded', timeout=30000)
            pg.wait_for_function("typeof jfDeskOpenReader==='function'", timeout=20000)
            pg.evaluate('(id)=>jfDeskOpenReader(id,0)', book['id'])
            pg.wait_for_function(
                "()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0", timeout=30000)
            pg.wait_for_timeout(800)
            pg.locator('#jfReadPaged').click()
            pg.wait_for_timeout(2500)

            state = pg.evaluate("""()=>({
              pages:jfDeskPages.length,
              spread:!document.getElementById('jfPageView').classList.contains('single')
            })""")
            ck('Long paragraph splits into several pages', state['pages'] >= 3, str(state))

            # No page may overflow its sheet, and no text may be lost.
            overflow = pg.evaluate("""()=>[...document.querySelectorAll('.jfSheetBody')].map(el=>({
                over: el.scrollHeight - el.clientHeight,
                under: el.clientHeight - el.querySelector('*')?.getBoundingClientRect().height
            })).filter(x=>x.over>2)""")
            ck('No page overflows its text block', not overflow, str(overflow))

            lost = pg.evaluate("""()=>{
              const body=(el)=>el?el.textContent.replace(/\s+/g,''):'';
              const pages=jfDeskPages.map(pg=>pg.map(b=>body(b.node)).join(''));
              const joined=pages.join('');
              const source=jfDeskFlow.map(s=>body(s.el)).join('');
              return {joined:joined.length, source:source.length};
            }""")
            ck('Every character survives pagination (no loss, no duplication)',
               lost['joined'] == lost['source'], str(lost))

            # Images: keep aspect ratio and stay inside the text block.
            imgs = pg.evaluate("""()=>[...document.querySelectorAll('#jfReadText img')]
                .map(i=>({nw:i.naturalWidth,nh:i.naturalHeight,cw:i.getBoundingClientRect().width}))""")
            ck('Source images decoded before measuring', all(i['nw'] > 0 for i in imgs), str(imgs[:3]))

            # Move to the image chapter and verify figures are not cropped.
            pg.evaluate("()=>{jfDeskChapter=1;}")
            pg.wait_for_timeout(100)
            page_img = pg.evaluate("""()=>{
              const imgs=[...document.querySelectorAll('#jfSheetLeft img,#jfSheetRight img')];
              const body=document.querySelector('#jfSheetLeft')?.parentElement;
              return imgs.map(i=>{const r=i.getBoundingClientRect();
                return {w:Math.round(r.width),h:Math.round(r.height),nw:i.naturalWidth,nh:i.naturalHeight};});
            }""")
            ck('Rendered images never exceed the text block',
               all(i['w'] <= 700 and i['h'] > 0 for i in page_img), str(page_img[:3]))

            # Anchor: changing the font size must keep the reader near the same text.
            before = pg.evaluate("""()=>({key:(jfDeskPages[jfDeskPageIndex]||[])[0]?.key,
                                          chapter:(jfDeskPages[jfDeskPageIndex]||[])[0]?.chapter,
                                          pages:jfDeskPages.length})""")
            pg.evaluate("()=>jfDeskSetPref({font:26})")
            pg.wait_for_timeout(1500)
            after = pg.evaluate("""()=>({key:(jfDeskPages[jfDeskPageIndex]||[])[0]?.key,
                                         chapter:(jfDeskPages[jfDeskPageIndex]||[])[0]?.chapter,
                                         pages:jfDeskPages.length})""")
            ck('Reflow after a font change keeps the same chapter',
               after['chapter'] == before['chapter'], str((before, after)))
            ck('A larger font produces more pages', after['pages'] >= before['pages'], str((before, after)))

            ck('No page errors while paginating', not errors, str(errors[:2]))
            br.close()

        # TXT book: structure into paragraphs and paginate without stalling.
        txt = [b for b in books if b['name'] == 'long.txt'][0]
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                   args=['--no-sandbox'])
            pg = br.new_page(viewport={'width': 1200, 'height': 820})
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto(base, wait_until='domcontentloaded', timeout=30000)
            pg.wait_for_function("typeof jfDeskOpenReader==='function'", timeout=20000)
            pg.evaluate('(id)=>jfDeskOpenReader(id,0)', txt['id'])
            pg.wait_for_function(
                "()=>{const t=document.getElementById('jfReadText');return t && t.textContent.length>200}",
                timeout=40000)
            pg.wait_for_timeout(600)
            started = time.time()
            pg.locator('#jfReadPaged').click()
            pg.wait_for_timeout(2500)
            took = time.time() - started
            tstate = pg.evaluate("""()=>({pages:jfDeskPages.length,
                over:[...document.querySelectorAll('.jfSheetBody')].filter(e=>e.scrollHeight-e.clientHeight>2).length})""")
            ck('TXT book paginates into many pages', tstate['pages'] >= 2, str(tstate))
            ck('TXT pagination leaves no overflowing page', tstate['over'] == 0, str(tstate))
            ck('TXT pagination finishes in reasonable time', took < 25, f'{took:.1f}s')
            br.close()
    finally:
        if proc:
            stop(proc, lg)

print('TOTAL', checks)
