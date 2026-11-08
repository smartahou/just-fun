#!/usr/bin/env python3
"""Real Chromium old-paper visual smoke with reproducible offline EPUB."""
import base64
import io
import json
import pathlib
import tempfile
import urllib.request
import zipfile

from PIL import Image
from playwright.sync_api import sync_playwright
from isolated import ROOT, launch, stop

def create_epub(dst):
    lines = []
    for chapter in range(4):
        text = '<h1>第%d章 · 旧书纸页验收</h1>'%(chapter+1)
        text += '<p>' + ('这是一段用于模拟真实中文阅读排版和分页的长段落。' * 20) + '</p>'
        text += ''.join('<p>' + ('旧纸的纹理、书页的自然外角、翻页的稳定性。' * 8) + '</p>' for _ in range(35))
        lines.append(text)
    with zipfile.ZipFile(dst,'w') as z:
        z.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        manifest=''.join('<item id="c%d" href="c%d.xhtml" media-type="application/xhtml+xml"/>'%(i,i) for i in range(4))
        spine=''.join('<itemref idref="c%d"/>'%i for i in range(4))
        opf='<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">paper-v7104-smoke</dc:identifier><dc:title>Just Fun paper visual regression</dc:title><dc:language>zh</dc:language></metadata><manifest>%s</manifest><spine>%s</spine></package>'%(manifest,spine)
        z.writestr('OEBPS/content.opf',opf)
        for i,t in enumerate(lines):
            z.writestr('OEBPS/c%d.xhtml'%i,'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>v7.104</title></head><body>%s</body></html>'%t)

def run():
    with tempfile.TemporaryDirectory(prefix="jf-architecture-test-visual-v7104-") as t:
        root=pathlib.Path(t)
        library=root/'books';library.mkdir()
        create_epub(library/'paper-check.epub')
        process=log=None
        try:
            process,port,log=launch(ROOT/'dist/douyin.js',library,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as resp:
                book=next(x for x in json.load(resp)['books'] if x['name']=='paper-check.epub')
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                pg=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                errors=[]
                pg.on('pageerror',lambda e:errors.append(str(e)))
                pg.goto(base,wait_until='domcontentloaded',timeout=30000)
                pg.wait_for_function("typeof jfDeskOpenReader === 'function'",timeout=20000)
                pg.evaluate('(id)=>jfDeskOpenReader(id,0)',book['id'])
                pg.wait_for_function("()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0",timeout=30000)
                pg.wait_for_timeout(750)
                pg.locator('#jfReadPaged').click()
                pg.wait_for_function("()=>jfDeskPaged&&jfDeskPages.length>4",timeout=30000)
                pg.wait_for_timeout(750)
                if not pg.evaluate("()=>window.JFPaperTextures?.isEnabled()"):
                    pg.evaluate("()=>document.getElementById('jfReadPaperAged').click()")
                pg.evaluate("()=>{jfDeskPageIndex=2;jfDeskPagedRender();}")
                pg.wait_for_timeout(500)
                facts=pg.evaluate("""()=>({
                  version:'7.104.0',
                  pages:jfDeskPages.length,
                  oldPaper:window.JFPaperTextures?.isEnabled(),
                  leftGroup:document.querySelector('#jfPageView .jfSheet[data-side="left"]')?.dataset.paperGroup,
                  rightGroup:document.querySelector('#jfPageView .jfSheet[data-side="right"]')?.dataset.paperGroup,
                  radius:getComputedStyle(document.querySelector('#jfPageView .jfSheet[data-side="left"]'),'::after').borderTopLeftRadius,
                  hardcover:document.getElementById('jfPageView').classList.contains('jf-hardcover-book')
                })""")
                assert facts['oldPaper'],facts
                assert facts['radius']=='0px',facts
                assert facts['pages']>4,facts
                assert facts['leftGroup']==facts['rightGroup'],facts
                assert not errors,errors
                screenshot=pg.screenshot(full_page=False)
                preview=Image.open(io.BytesIO(screenshot)).convert('RGB')
                preview.thumbnail((1200,760),Image.Resampling.LANCZOS)
                out=io.BytesIO()
                preview.save(out,format='JPEG',quality=70,optimize=True)
                b64=base64.b64encode(out.getvalue()).decode('ascii')
                print("VISUAL_FACTS",json.dumps(facts,ensure_ascii=False),flush=True)
                print("VISUAL_JPEG_BEGIN")
                for i in range(0,len(b64),3000):
                    print("VISUAL_DATA:"+b64[i:i+3000])
                print("VISUAL_JPEG_END")
                print("PASS real browser v7.104 visual and paper alpha CSS",flush=True)
                browser.close()
        finally:
            stop(process,log)

if __name__=='__main__':
    run()
