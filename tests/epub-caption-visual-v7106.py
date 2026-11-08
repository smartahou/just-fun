#!/usr/bin/env python3
"""v7.106 actual Chromium EPUB: labelled 画片 caption + font fallback audit.

Fixture is synthetic and isolated; no access to a user's actual reading files.
The actual reader builds and paginates image+caption as a single figure and
prints both centred against the real book paper. Font glyphs are checked via
Chrome DevTools protocol rather than inferred from a fallback CSS list.
"""
import base64
import io
import json
import pathlib
import tempfile
import urllib.request
import zipfile

from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop

def fixture(path):
    plate=Image.new("RGB",(440,300),(240,234,222))
    d=ImageDraw.Draw(plate)
    d.rectangle((44,34,396,271),outline=(87,65,44),width=3)
    d.ellipse((170,65,255,155),outline=(76,58,39),width=5)
    d.line((208,155,208,246),fill=(76,58,39),width=6)
    d.line((208,190,152,226),fill=(76,58,39),width=4)
    d.line((208,190,270,226),fill=(76,58,39),width=4)
    stream=io.BytesIO()
    plate.save(stream,'PNG')
    intro='<h1>第三章 入国联军的“辱华明信片”</h1>'
    intro+=''.join('<p>1842年以后，历史书籍逐渐刊载了更多插图，文字应当保持自然的阅读节奏。</p>' for _ in range(4))
    intro+='<p class="illustration"><img src="plate.png" width="440" height="300" alt="历史画片"/></p>'
    intro+='<p>街头剃头匠（画片）</p>'
    intro+='<p>（这不是图注，而是一段普通的括号内说明。）</p>'
    intro+=''.join('<p>历史资料中的文字段落保持正常缩进和分页，1842年与1895年等阿拉伯数字沿用原来的衬线字体设置。</p>' for _ in range(35))
    body='<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>图文验收</title></head><body>'+intro+'</body></html>'
    manifest='<item id="c0" href="c0.xhtml" media-type="application/xhtml+xml"/><item id="image" href="plate.png" media-type="image/png"/>'
    opf='<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">caption-v7106</dc:identifier><dc:title>Caption test EPUB</dc:title><dc:language>zh</dc:language></metadata><manifest>'+manifest+'</manifest><spine><itemref idref="c0"/></spine></package>'
    with zipfile.ZipFile(path,'w') as z:
        z.writestr('mimetype','application/epub+zip',compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr('OEBPS/content.opf',opf)
        z.writestr('OEBPS/c0.xhtml',body)
        z.writestr('OEBPS/plate.png',stream.getvalue())

def platform_font_info(page,css_selector):
    cdp=page.context.new_cdp_session(page)
    try:
        cdp.send('DOM.enable')
        cdp.send('CSS.enable')
        dom=cdp.send('DOM.getDocument')['root']['nodeId']
        node=cdp.send('DOM.querySelector',{'nodeId':dom,'selector':css_selector})['nodeId']
        if not node:
            return {'error':'audit span missing'}
        return cdp.send('CSS.getPlatformFontsForNode',{'nodeId':node})['fonts']
    except Exception as e:
        return {'unavailable':str(e)}
    finally:
        cdp.detach()

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-caption-v7106-') as rootdir:
        root=pathlib.Path(rootdir)
        library=root/'books';library.mkdir()
        fixture(library/'caption-check.epub')
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',library,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as r:
                book=next(x for x in json.load(r)['books'] if x['name']=='caption-check.epub')
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='domcontentloaded',timeout=30000)
                page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=20000)
                page.evaluate("(id)=>jfDeskOpenReader(id,0)",book['id'])
                page.wait_for_function("()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0",timeout=30000)
                page.wait_for_timeout(500)
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>jfDeskPaged&&jfDeskPages.length>1",timeout=30000)
                page.wait_for_timeout(800)
                idx=page.evaluate("""()=>jfDeskPages.findIndex(p=>p.some(b=>b.node?.classList?.contains('jfPrintPlateWithCaption')))""")
                assert idx>=0,'standalone image+（画片） caption not merged by real EPUB reader'
                block=page.evaluate("""(i)=>{
                    const found=jfDeskPages[i].find(b=>b.node?.classList?.contains('jfPrintPlateWithCaption'));
                    return {offset:found.offset,caption:found.node.querySelector('figcaption')?.textContent,
                       imageCount:found.node.querySelectorAll('img').length,
                       sourceUnchanged:Array.from(document.querySelectorAll('#jfReadText p'))
                         .some(p=>p.textContent.trim()==='街头剃头匠（画片）')};
                }""",idx)
                assert block['caption']=='街头剃头匠（画片）',block
                assert block['imageCount']==1 and block['sourceUnchanged'],block
                page.evaluate("(i)=>{jfDeskPageIndex=Math.floor(i/2)*2;jfDeskPagedRender();}",idx)
                page.wait_for_timeout(600)
                info=page.evaluate("""()=>{
                  const f=document.querySelector('#jfPageView .jfSheetBody figure.jfPrintPlateWithCaption');
                  if(!f)return {error:'rendered figure missing'};
                  const img=f.querySelector('img'),cap=f.querySelector('figcaption');
                  const ir=img.getBoundingClientRect(),cr=cap.getBoundingClientRect();
                  const inner=document.getElementById('jfSheetLeft');
                  const styles=getComputedStyle(f);
                  return {
                    caption:cap?.textContent?.trim(),
                    pictureNaturalSize:[img.naturalWidth,img.naturalHeight],
                    imageX:(ir.left+ir.right)/2,captionX:(cr.left+cr.right)/2,
                    captionAlignment:getComputedStyle(cap).textAlign,
                    figureDisplay:styles.display,
                    pageIndex:jfDeskPageIndex,pages:jfDeskPages.length,
                    sourceParagraphs:[...document.querySelectorAll('#jfReadText p')].length,
                    visibleUnlabelled:Array.from(document.querySelectorAll('#jfPageView .jfSheetBody p'))
                      .some(p=>p.textContent.includes('这不是图注')),
                    leftPaper:document.querySelector('#jfPageView .jfSheet[data-side="left"]')?.dataset.paperGroup,
                    rightPaper:document.querySelector('#jfPageView .jfSheet[data-side="right"]')?.dataset.paperGroup
                  };
                }""")
                assert 'error' not in info,info
                assert info['caption']=='街头剃头匠（画片）',info
                assert info['pictureNaturalSize'][0]>100,info
                assert abs(info['imageX']-info['captionX'])<4,info
                assert info['captionAlignment']=='center',info
                assert info['leftPaper']==info['rightPaper'],info
                assert not errors,errors
                # Diagnose native font fallback on this Chromium/Linux runner.
                # Two temporary spans inherit the same printed typography; they
                # do not change the EPUB nor the actual displayed book.
                page.evaluate("""()=>{
                   const sheet=document.getElementById('jfSheetLeft');
                   for(const [id,text] of [['jfNativeNumberAudit','1842 1895'],
                                            ['jfNativeHanziAudit','道光皇帝历史']]){
                      const span=document.createElement('span');
                      span.id=id;span.textContent=text;
                      span.style.cssText='display:inline;position:absolute;left:80px;top:80px;font:inherit;opacity:.001;pointer-events:none';
                      sheet.append(span);
                   }
                }""")
                native={
                  'digits':platform_font_info(page,'#jfNativeNumberAudit'),
                  'hanzi':platform_font_info(page,'#jfNativeHanziAudit'),
                  'cssStack':page.evaluate("()=>getComputedStyle(document.getElementById('jfSheetLeft')).fontFamily")
                }
                page.evaluate("""()=>{
                  document.getElementById('jfNativeNumberAudit')?.remove();
                  document.getElementById('jfNativeHanziAudit')?.remove();
                }""")
                screenshot=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
                screenshot.thumbnail((1100,675),Image.Resampling.LANCZOS)
                payload=io.BytesIO()
                screenshot.save(payload,format='JPEG',quality=72,optimize=True)
                encoded=base64.b64encode(payload.getvalue()).decode('ascii')
                print('CAPTION_VISUAL_FACTS',json.dumps({'block':block,'render':info,'fonts':native},ensure_ascii=False),flush=True)
                print('CAPTION_VISUAL_BEGIN',flush=True)
                for i in range(0,len(encoded),3000):
                    print('CAPTION_VISUAL_DATA:'+encoded[i:i+3000],flush=True)
                print('CAPTION_VISUAL_END',flush=True)
                print('PASS v7.106 actual EPUB caption remains attached, centred, source untouched; native numeric fonts audited',flush=True)
                browser.close()
        finally:
            stop(proc,log)
if __name__=='__main__':
    main()
