#!/usr/bin/env python3
"""v7.37: a page turn must never skip content.

Reproduces the reported defect: advancing one spread jumped past the next one,
and going back revealed it. Asserts source-interval continuity (not page-number
monotonicity) and strict reversibility A -> B -> A.
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
    for i in range(7):
        paras = ''.join('<p>%s</p>' % ('第%d章 跨页连续性测试段落。' % i * (8 + i)) for _ in range(5 + i))
        chapters.append('<h1>第 %d 章</h1>' % i + paras)
    with zipfile.ZipFile(dest, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml',
                   '<?xml version="1.0"?><container version="1.0" '
                   'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
                   '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                   '</rootfiles></container>')
        manifest = ''.join('<item id="c%d" href="text/c%d.xhtml" media-type="application/xhtml+xml"/>'
                           % (i, i) for i in range(len(chapters)))
        spine = ''.join('<itemref idref="c%d"/>' % i for i in range(len(chapters)))
        z.writestr('OEBPS/content.opf',
                   '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" '
                   'version="3.0" unique-identifier="id"><metadata '
                   'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">ns</dc:identifier>'
                   '<dc:title>NoSkip</dc:title><dc:language>zh</dc:language></metadata>'
                   '<manifest>%s</manifest><spine>%s</spine></package>' % (manifest, spine))
        for i, body in enumerate(chapters):
            z.writestr('OEBPS/text/c%d.xhtml' % i,
                       '<?xml version="1.0" encoding="UTF-8"?><html '
                       'xmlns="http://www.w3.org/1999/xhtml"><head><title>c%d</title></head>'
                       '<body>%s</body></html>' % (i, body))

with tempfile.TemporaryDirectory(prefix='jf-architecture-test-noskip-v737-') as d:
    tmp = pathlib.Path(d)
    lib = tmp / 'library'; lib.mkdir()
    png = tmp / 'src.png'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
                    '-i', 'testsrc2=size=400x520', '-frames:v', '1', str(png)],
                   check=True, timeout=40)
    build_epub(lib / 'noskip.epub', png.read_bytes())
    (lib / 'long.txt').write_text(('长篇 TXT 跨页连续性验证段落。' * 45 + '\n\n') * 200, encoding='utf-8')
    proc = lg = None
    try:
        proc, port, lg = launch(ROOT / 'dist/douyin.js', lib, tmp / 'home')
        base = 'http://127.0.0.1:' + str(port)
        for _ in range(60):
            try:
                books = get(base, '/api/books?refresh=1')['books']; break
            except Exception: time.sleep(0.5)
        book = [b for b in books if b['name'] == 'noskip.epub'][0]

        with sync_playwright() as p:
            br = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                   args=['--no-sandbox'])
            pg = br.new_page(viewport={'width': 1180, 'height': 840})
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

            # 1) 200 turns: source interval continuity, not page-number monotonicity
            log = pg.evaluate("""async()=>{
              const out=[];
              for(let i=0;i<200;i++){
                const before=jfDeskPageIndex;
                jfDeskPageTurn(1);
                const geo=jfDeskPagedGeometry();
                const two=geo.two&&jfDeskPages.length>1;
                const all=(jfDeskPages[jfDeskPageIndex]||[]).concat(two?(jfDeskPages[jfDeskPageIndex+1]||[]):[]);
                const f=all[0],l=all[all.length-1];
                out.push({i,before,after:jfDeskPageIndex,step:two?2:1,pages:jfDeskPages.length,
                          chapter:f?f.chapter:null,start:f?(f.offset||0):null,
                          end:l?((l.offset||0)+l.node.textContent.length):null,
                          firstKey:f?f.key:null,lastKey:l?l.key:null});
                await new Promise(r=>requestAnimationFrame(r));
              }
              return out;
            }""")
            gaps = []
            for i in range(1, len(log)):
                prev, cur = log[i-1], log[i]
                if cur['after'] == prev['after']: continue
                if prev['chapter'] != cur['chapter']: continue
                if cur['start'] != prev['end']:
                    gaps.append({'i': i, 'delta': (cur['start'] or 0) - (prev['end'] or 0),
                                 'prev': prev, 'cur': cur})
            ck('200 turns never skip or overlap content',
               not gaps, json.dumps(gaps[:2], ensure_ascii=False))

            # 2) strict reversibility A -> B -> A over every spread
            pg.evaluate("()=>{jfDeskPageIndex=0;jfDeskPagedRender();}")
            pg.wait_for_timeout(400)
            trip = pg.evaluate("""async()=>{
              const ident=()=>{
                const geo=jfDeskPagedGeometry();
                const two=geo.two&&jfDeskPages.length>1;
                const all=(jfDeskPages[jfDeskPageIndex]||[]).concat(two?(jfDeskPages[jfDeskPageIndex+1]||[]):[]);
                return all.map(x=>x.chapter+':'+(x.offset||0)).join('|');
              };
              const bad=[];let checked=0;
              while(checked<40){
                const a=ident();
                if(!jfDeskPageTurn(1))break;
                await new Promise(r=>requestAnimationFrame(r));
                const b=ident();
                if(!jfDeskPageTurn(-1)){bad.push({why:'no back',b});break;}
                await new Promise(r=>requestAnimationFrame(r));
                const back=ident();
                checked++;
                if(back!==a)bad.push({why:'not reversible',a:a.slice(0,30),back:back.slice(0,30)});
                if(b===a)break;
              }
              return {checked,bad:bad.slice(0,2),badCount:bad.length};
            }""")
            ck('Every spread advances and returns to an identical source interval',
               trip['badCount'] == 0 and trip['checked'] > 5, json.dumps(trip, ensure_ascii=False))

            # 3) spread index always aligned to the step grid
            align = pg.evaluate("""()=>{
              const geo=jfDeskPagedGeometry();
              const step=geo.two&&jfDeskPages.length>1?2:1;
              const bad=[];
              for(let i=0;i<jfDeskPages.length;i+=step){
                jfDeskPageIndex=i;jfDeskPagedRender();
                if(jfDeskPageIndex%step!==0)bad.push({i,idx:jfDeskPageIndex});
              }
              return {bad:bad.length,step};
            }""")
            ck('Spread indices stay aligned to the step grid', align['bad'] == 0, str(align))

            # 4) async append while the reader is turning must not change the spread
            app = pg.evaluate("""async()=>{
              const ident=()=>{
                const geo=jfDeskPagedGeometry();
                const two=geo.two&&jfDeskPages.length>1;
                const all=(jfDeskPages[jfDeskPageIndex]||[]).concat(two?(jfDeskPages[jfDeskPageIndex+1]||[]):[]);
                return all.map(x=>x.key).join('|');
              };
              const idx=jfDeskPageIndex;
              const before=ident();
              const p=jfDeskFlowAppend(((jfDeskFlow[jfDeskFlow.length-1]||{}).n)+1).catch(()=>{});
              await new Promise(r=>requestAnimationFrame(r));
              const afterAppend=ident();
              await p;
              await new Promise(r=>setTimeout(r,400));
              return {same:before===afterAppend,idx,jfDeskPageIndex,pages:jfDeskPages.length};
            }""")
            ck('Appending a chapter does not move the current spread',
               app['same'] and app['idx'] == app['jfDeskPageIndex'], json.dumps(app, ensure_ascii=False))

            # 5) font change then continue turning stays continuous
            pg.evaluate("()=>jfDeskSetPref({font:22})")
            pg.wait_for_timeout(1200)
            cont = pg.evaluate("""async()=>{
              const out=[];
              for(let i=0;i<20;i++){
                const before=jfDeskPageIndex;
                jfDeskPageTurn(1);
                const geo=jfDeskPagedGeometry();
                const two=geo.two&&jfDeskPages.length>1;
                const all=(jfDeskPages[jfDeskPageIndex]||[]).concat(two?(jfDeskPages[jfDeskPageIndex+1]||[]):[]);
                const f=all[0],l=all[all.length-1];
                out.push({before,after:jfDeskPageIndex,
                          chapter:f?f.chapter:null,start:f?(f.offset||0):null,
                          end:l?((l.offset||0)+l.node.textContent.length):null});
                await new Promise(r=>requestAnimationFrame(r));
              }
              return out;
            }""")
            fg = [c for i, c in enumerate(cont[1:], 1)
                  if c['after'] != cont[i-1]['after'] and c['chapter'] == cont[i-1]['chapter']
                  and c['start'] != cont[i-1]['end']]
            ck('Turning stays continuous after a font change', not fg, json.dumps(fg[:2], ensure_ascii=False))

            ck('No page errors during 200+ turns', not errors, str(errors[:2]))
            br.close()
    finally:
        if proc:
            stop(proc, lg)

print('TOTAL', checks)
