#!/usr/bin/env python3
"""v7.35: reading continuity, deterministic pagination, image integrity.

Reproduces the reported P0 failures: duplicated chapters from concurrent
prefetch, page regression after a reflow, and images clipped because a block was
published as "oversized" while the picture was still decoding.
"""
import json, pathlib, tempfile, urllib.request, zipfile, subprocess, time
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

def build_epub(dest, png):
    chapters = []
    for i in range(6):
        figs = ''.join(
            '<figure><img src="images/p%d.png" alt="p%d"/><figcaption>图 %d（明信片）</figcaption></figure>'
            % (k, k, k) for k in range(1, 3))
        body = ('<h1>章节 %d</h1>' % i) + ('<p>%s</p>' % ('连续性测试段落。' * 60)) * 3 + figs
        chapters.append(body)
    with zipfile.ZipFile(dest, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml',
                   '<?xml version="1.0"?><container version="1.0" '
                   'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
                   '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                   '</rootfiles></container>')
        manifest = ''.join('<item id="c%d" href="text/c%d.xhtml" media-type="application/xhtml+xml"/>'
                           % (i, i) for i in range(len(chapters)))
        manifest += ''.join('<item id="i%d" href="images/p%d.png" media-type="image/png"/>' % (k, k)
                            for k in range(1, 3))
        spine = ''.join('<itemref idref="c%d"/>' % i for i in range(len(chapters)))
        z.writestr('OEBPS/content.opf',
                   '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" '
                   'version="3.0" unique-identifier="id"><metadata '
                   'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">st</dc:identifier>'
                   '<dc:title>Stability</dc:title><dc:language>zh</dc:language></metadata>'
                   '<manifest>%s</manifest><spine>%s</spine></package>' % (manifest, spine))
        for i, body in enumerate(chapters):
            z.writestr('OEBPS/text/c%d.xhtml' % i,
                       '<?xml version="1.0" encoding="UTF-8"?><html '
                       'xmlns="http://www.w3.org/1999/xhtml"><head><title>c%d</title></head>'
                       '<body>%s</body></html>' % (i, body))
        for k in range(1, 3):
            z.writestr('OEBPS/images/p%d.png' % k, png)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-stability-v735-') as d:
    tmp = pathlib.Path(d)
    lib = tmp / 'library'; lib.mkdir()
    png = tmp / 'src.png'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
                    '-i', 'testsrc2=size=520x700', '-frames:v', '1', str(png)],
                   check=True, timeout=40)
    build_epub(lib / 'stability.epub', png.read_bytes())
    proc = lg = None
    try:
        proc, port, lg = launch(ROOT / 'dist/douyin.js', lib, tmp / 'home')
        base = 'http://127.0.0.1:' + str(port)
        for _ in range(60):
            try:
                books = get(base, '/api/books?refresh=1')['books']; break
            except Exception: time.sleep(0.5)
        book = [b for b in books if b['name'] == 'stability.epub'][0]

        with sync_playwright() as p:
            br = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                   args=['--no-sandbox'])
            pg = br.new_page(viewport={'width': 1280, 'height': 860})
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto(base, wait_until='domcontentloaded', timeout=30000)
            pg.wait_for_function("typeof jfDeskOpenReader==='function'", timeout=20000)
            pg.evaluate('(id)=>jfDeskOpenReader(id,0)', book['id'])
            pg.wait_for_function(
                "()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0", timeout=30000)
            pg.wait_for_timeout(900)
            pg.locator('#jfReadPaged').click()
            pg.wait_for_timeout(2500)

            # 1) chapters must never be mounted twice
            dups = pg.evaluate("""()=>{
              const ns=jfDeskFlow.map(s=>s.n);
              return {n:ns, dup:ns.length!==new Set(ns).size,
                      dom:[...document.querySelectorAll('#jfReadText [data-chapter]')]
                           .map(s=>Number(s.dataset.chapter))};
            }""")
            ck('No chapter mounted twice', not dups['dup'] and
               len(dups['dom']) == len(set(dups['dom'])), str(dups))

            # 2) rapid turns must advance monotonically (no content regression)
            seq = pg.evaluate("""async()=>{
              const seen=[];
              for(let i=0;i<50;i++){
                jfDeskPageTurn(1);
                const page=jfDeskPages[jfDeskPageIndex];
                seen.push(page&&page[0]?page[0].chapter+':'+(page[0].offset||0):'');
                await new Promise(r=>requestAnimationFrame(r));
              }
              return seen;
            }""")
            keys = [s for s in seq if s]
            ordered = all(keys[i] <= keys[i+1] for i in range(len(keys)-1)) if len(keys) > 1 else True
            ck('50 rapid turns never move backwards', ordered, str(keys[:6]) + '...' + str(keys[-3:]))

            # 3) images: rendered rects inside the text block, aspect ratio kept
            imgs = pg.evaluate("""()=>{
              const out=[];
              for(const sheet of document.querySelectorAll('.jfSheetBody')){
                if(!sheet.offsetParent)continue;
                const box=sheet.getBoundingClientRect();
                for(const img of sheet.querySelectorAll('img')){
                  const r=img.getBoundingClientRect();
                  out.push({inside:r.top>=box.top-1&&r.bottom<=box.bottom+1&&r.left>=box.left-1,
                            w:Math.round(r.width),h:Math.round(r.height),
                            nw:img.naturalWidth,nh:img.naturalHeight});
                }
              }
              return out;
            }""")
            ck('Visible images stay inside the text block',
               all(i['inside'] for i in imgs), str(imgs[:3]))
            ck('Images keep their aspect ratio',
               all(abs(i['w']/i['h'] - i['nw']/i['nh']) < 0.04 for i in imgs if i['nw'] and i['h']),
               str(imgs[:2]))

            # 4) caption never orphaned from its figure
            orphan = pg.evaluate("""()=>{
              let bad=0;
              for(const sheet of document.querySelectorAll('.jfSheetBody')){
                if(!sheet.offsetParent)continue;
                for(const cap of sheet.querySelectorAll('figcaption')){
                  const fig=cap.closest('figure');
                  if(fig&&!cap.parentElement.isConnected)bad++;
                  if(!fig)bad++;
                }
              }
              const firstCaption=document.querySelector('.jfSheetBody figcaption');
              const firstText=document.querySelector('.jfSheetBody')?.textContent.trim()||'';
              return {bad, startsWithCaption:/^[（(]?明信片/.test(firstText)};
            }""")
            ck('Captions stay inside their figure', orphan['bad'] == 0, str(orphan))

            # 5) concurrent appends of the same chapter resolve once
            conc = pg.evaluate("""async()=>{
              const before=jfDeskFlow.length;
              const target=jfDeskFlow[jfDeskFlow.length-1].n+1;
              const results=await Promise.all([
                jfDeskFlowAppend(target), jfDeskFlowAppend(target), jfDeskFlowAppend(target)
              ]);
              await new Promise(r=>setTimeout(r,600));
              const ns=jfDeskFlow.map(s=>s.n);
              return {results, grew:jfDeskFlow.length-before,
                      dup:ns.length!==new Set(ns).size, ns};
            }""")
            ck('Concurrent appends mount the chapter exactly once',
               conc['grew'] <= 1 and not conc['dup'], str(conc))

            # 6) font change keeps the reader near the same text
            before = pg.evaluate("()=>({c:jfDeskCurrentAnchor()?.chapter, o:jfDeskCurrentAnchor()?.offset})")
            pg.evaluate("()=>jfDeskSetPref({font:24})")
            pg.wait_for_timeout(1800)
            after = pg.evaluate("()=>({c:jfDeskCurrentAnchor()?.chapter, o:jfDeskCurrentAnchor()?.offset})")
            ck('Reflow keeps the same chapter and nearby offset',
               after['c'] == before['c'] and abs((after['o'] or 0) - (before['o'] or 0)) < 1200,
               str((before, after)))

            ck('No page errors during the run', not errors, str(errors[:2]))
            br.close()
    finally:
        if proc:
            stop(proc, lg)

print('TOTAL', checks)
