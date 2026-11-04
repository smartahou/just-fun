#!/usr/bin/env python3
"""v7.36: pagination correctness. Content, offsets, images, order, round-trip.

Compares the assembled reading stream character by character against the source,
verifies offset continuity across page boundaries, and checks image identity and
ordering. Fails with the chapter/page/offset where the streams first diverge.
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
    # Chapter mix: short, long, image-heavy with <p><img></p>, bare caption paragraph.
    chapters = [
        '<h1>短章一</h1><p>短。</p>',
        '<h1>长章</h1>' + ''.join('<p>%s</p>' % ('长段落内容用于跨页测试。' * 40) for _ in range(6)),
        '<h1>图片章</h1>' +
        ''.join('<p><img src="images/p%d.png" alt="图%d"/></p><p>（明信片）图%d 说明</p>' % (k, k, k)
                for k in range(1, 5)),
        '<h1>中章</h1>' + ''.join('<p>%s</p>' % ('中等长度段落。' * 25) for _ in range(4)),
        '<h1>短章二</h1><p>收尾。</p>',
    ]
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
                            for k in range(1, 5))
        spine = ''.join('<itemref idref="c%d"/>' % i for i in range(len(chapters)))
        z.writestr('OEBPS/content.opf',
                   '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" '
                   'version="3.0" unique-identifier="id"><metadata '
                   'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">cc</dc:identifier>'
                   '<dc:title>Correctness</dc:title><dc:language>zh</dc:language></metadata>'
                   '<manifest>%s</manifest><spine>%s</spine></package>' % (manifest, spine))
        for i, body in enumerate(chapters):
            z.writestr('OEBPS/text/c%d.xhtml' % i,
                       '<?xml version="1.0" encoding="UTF-8"?><html '
                       'xmlns="http://www.w3.org/1999/xhtml"><head><title>c%d</title></head>'
                       '<body>%s</body></html>' % (i, body))
        for k in range(1, 5):
            z.writestr('OEBPS/images/p%d.png' % k, png)

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-correctness-v736-') as d:
    tmp = pathlib.Path(d)
    lib = tmp / 'library'; lib.mkdir()
    png = tmp / 'src.png'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
                    '-i', 'testsrc2=size=480x620', '-frames:v', '1', str(png)],
                   check=True, timeout=40)
    build_epub(lib / 'correctness.epub', png.read_bytes())
    (lib / 'long.txt').write_text(('这是一个用于验证 TXT 分页的长段落。' * 60 + '\n\n') * 120,
                                  encoding='utf-8')
    proc = lg = None
    try:
        proc, port, lg = launch(ROOT / 'dist/douyin.js', lib, tmp / 'home')
        base = 'http://127.0.0.1:' + str(port)
        for _ in range(60):
            try:
                books = get(base, '/api/books?refresh=1')['books']; break
            except Exception: time.sleep(0.5)
        book = [b for b in books if b['name'] == 'correctness.epub'][0]

        with sync_playwright() as p:
            br = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                   args=['--no-sandbox'])
            pg = br.new_page(viewport={'width': 1180, 'height': 860})
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto(base, wait_until='domcontentloaded', timeout=30000)
            pg.wait_for_function("typeof jfDeskOpenReader==='function'", timeout=20000)
            pg.evaluate('(id)=>jfDeskOpenReader(id,0)', book['id'])
            pg.wait_for_function(
                "()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0", timeout=30000)
            pg.wait_for_timeout(900)
            pg.locator('#jfReadPaged').click()
            pg.wait_for_function("()=>jfDeskPages.length>0", timeout=40000)
            pg.wait_for_timeout(1500)

            # 1) character-exact stream comparison, with the first divergence located
            stream = pg.evaluate("""()=>{
              // XML indentation leaves whitespace text nodes directly under the
              // section; pagination consumes element children only, and those
              // blanks are not content. Normalise whitespace, keep character-exact
              // comparison for every non-whitespace character.
              const norm=s=>s.replace(/\s+/g,'');
              const pageText=norm(jfDeskPages.flat().map(b=>b.node.textContent).join(''));
              const srcText=norm(jfDeskFlow.map(s=>s.el.textContent).join(''));
              if(pageText===srcText)return {ok:true,len:pageText.length};
              let i=0;while(i<pageText.length&&i<srcText.length&&pageText[i]===srcText[i])i++;
              return {ok:false,len:pageText.length,srcLen:srcText.length,at:i,
                      pageTail:pageText.slice(i,i+40),srcTail:srcText.slice(i,i+40)};
            }""")
            ck('Reading stream matches the source character for character',
               stream['ok'], json.dumps(stream, ensure_ascii=False))

            # 2) offsets must be continuous across every page boundary
            offsets = pg.evaluate("""()=>{
              const flat=jfDeskPages.flat();const bad=[];
              for(let i=1;i<flat.length;i++){
                const a=flat[i-1],b=flat[i];
                if(a.chapter!==b.chapter)continue;
                const expected=(a.offset||0)+a.node.textContent.length;
                if((b.offset||0)!==expected)
                  bad.push({chapter:b.chapter,expected,actual:b.offset||0,
                            prevKey:a.key,nextKey:b.key});
              }
              return {bad:bad.slice(0,5),count:bad.length,
                      total:(jfDeskPages[0]&&jfDeskPages[0][0]?jfDeskPages[0][0].offset:null)};
            }""")
            ck('Offsets are continuous across page boundaries',
               offsets['count'] == 0, json.dumps(offsets, ensure_ascii=False))

            # 3) image identity and order
            imgs = pg.evaluate("""()=>{
              const seq=jfDeskPages.flat().map(b=>{
                const list=b.node.querySelectorAll?b.node.querySelectorAll('img'):[];
                return [...list].map(i=>i.getAttribute('src'));
              }).flat();
              const src=jfDeskFlow.map(s=>[...s.el.querySelectorAll('img')].map(i=>i.getAttribute('src'))).flat();
              return {same:JSON.stringify(seq)===JSON.stringify(src),seq,src};
            }""")
            ck('Images keep identity and order', imgs['same'],
               json.dumps({'seq': imgs['seq'][:5], 'src': imgs['src'][:5]}, ensure_ascii=False))

            # 4) no page may repeat or skip content: every page's text must be a
            #    contiguous slice of the chapter stream
            contig = pg.evaluate("""()=>{
              const chapters={};
              for(const s of jfDeskFlow)chapters[s.n]=s.el.textContent;
              const bad=[];
              let cursor={};
              for(const page of jfDeskPages){
                for(const b of page){
                  const ch=b.chapter;
                  if(!(ch in cursor))cursor[ch]=0;
                  const want=chapters[ch].slice(cursor[ch],cursor[ch]+b.node.textContent.length);
                  if(want!==b.node.textContent)
                    bad.push({chapter:ch,at:cursor[ch],want:want.slice(0,30),got:b.node.textContent.slice(0,30)});
                  cursor[ch]+=b.node.textContent.length;
                }
              }
              return {bad:bad.slice(0,3),count:bad.length};
            }""")
            ck('Pages are contiguous slices of their chapter (no repeat, no skip)',
               contig['count'] == 0, json.dumps(contig, ensure_ascii=False))

            # 5) round trip: forward N then back N returns to the same anchor
            trip = pg.evaluate("""()=>{
              const start=JSON.stringify(jfDeskCurrentAnchor());
              const forward=[];
              for(let i=0;i<6;i++){jfDeskPageTurn(1);forward.push(jfDeskPageIndex);}
              for(let i=0;i<6;i++)jfDeskPageTurn(-1);
              return {start,end:JSON.stringify(jfDeskCurrentAnchor()),forward,
                      idx:jfDeskPageIndex};
            }""")
            ck('Forward then backward returns to the same anchor',
               trip['start'] == trip['end'], json.dumps(trip, ensure_ascii=False))

            # 6) determinism: re-running layout with identical parameters is stable
            det = pg.evaluate("""async()=>{
              const sig=jfDeskPages.map(p=>p.map(b=>b.key+':'+(b.offset||0)).join(',')).join('|');
              await jfDeskPagedLayout(true,'determinism');
              await new Promise(r=>setTimeout(r,300));
              const sig2=jfDeskPages.map(p=>p.map(b=>b.key+':'+(b.offset||0)).join(',')).join('|');
              return {same:sig===sig2,len:sig.length};
            }""")
            ck('Re-paginating with the same parameters is deterministic',
               det['same'], json.dumps(det, ensure_ascii=False))

            # 7) resize: anchor survives and stays in the same chapter
            before = pg.evaluate("()=>jfDeskCurrentAnchor()")
            pg.set_viewport_size({'width': 900, 'height': 800})
            pg.wait_for_timeout(1200)
            after = pg.evaluate("()=>jfDeskCurrentAnchor()")
            ck('Resize keeps the same chapter', before and after and before['chapter'] == after['chapter'],
               str((before, after)))
            ck('Resize keeps the reader near the same offset',
               before and after and abs((after['offset'] or 0) - (before['offset'] or 0)) < 900,
               str((before, after)))

            ck('No page errors while paginating', not errors, str(errors[:2]))
            br.close()

        # 8) TXT: character-exact as well
        txt = [b for b in books if b['name'] == 'long.txt'][0]
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                   args=['--no-sandbox'])
            pg = br.new_page(viewport={'width': 1180, 'height': 860})
            pg.goto(base, wait_until='domcontentloaded', timeout=30000)
            pg.wait_for_function("typeof jfDeskOpenReader==='function'", timeout=20000)
            pg.evaluate('(id)=>jfDeskOpenReader(id,0)', txt['id'])
            pg.wait_for_function(
                "()=>{const t=document.getElementById('jfReadText');return t && t.textContent.length>200}",
                timeout=40000)
            pg.wait_for_timeout(600)
            pg.locator('#jfReadPaged').click()
            pg.wait_for_function("()=>jfDeskPages.length>0", timeout=60000)
            pg.wait_for_timeout(800)
            tstate = pg.evaluate("""()=>{
              // TXT paragraphs are <p> elements, so the blank line between them is
              // structure, not content. Normalise whitespace but still compare
              // character for character.
              const norm=s=>s.replace(/\s+/g,'');
              const pageText=norm(jfDeskPages.flat().map(b=>b.node.textContent).join(''));
              const srcText=norm(String(jfReadRawText||''));
              if(pageText===srcText)return {ok:true,len:pageText.length};
              let i=0;while(i<pageText.length&&i<srcText.length&&pageText[i]===srcText[i])i++;
              return {ok:false,len:pageText.length,srcLen:srcText.length,at:i,
                      pageTail:pageText.slice(i,i+30),srcTail:srcText.slice(i,i+30)};
            }""")
            ck('TXT stream matches the source character for character',
               tstate['ok'], json.dumps(tstate, ensure_ascii=False))
            br.close()
    finally:
        if proc:
            stop(proc, lg)

print('TOTAL', checks)
