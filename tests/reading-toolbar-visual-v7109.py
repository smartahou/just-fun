#!/usr/bin/env python3
"""v7.109: inspect real EPUB toolbar through Chromium across mode changes."""
import base64
import io
import json
import pathlib
import runpy
import tempfile
import urllib.request

from PIL import Image
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop

create_epub=runpy.run_path(str(ROOT/'tests/paper-visual-smoke-v7104.py'))['create_epub']

def read_ui(page):
    return page.evaluate("""()=>{
      const theme=document.getElementById('jfReadTheme');
      const mask=document.getElementById('jfReadMask');
      const paper=document.querySelector('#jfPageView .jfSheet[data-side="left"]');
      return {
        paged:jfDeskPaged,
        scrambleAbsent:!mask,
        excerptEnabled:!document.getElementById('jfReadExcerpt').disabled,
        themeDisabled:theme.disabled,
        themeAriaDisabled:theme.getAttribute('aria-disabled'),
        themeOpacity:getComputedStyle(theme).opacity,
        themeTitle:theme.title,
        themePref:jfDeskPrefs.theme,
        paperEnabled:window.JFPaperTextures.isEnabled(),
        photoGroup:paper?.dataset.paperGroup||null,
        paperImage:paper?getComputedStyle(paper,'::after').backgroundImage.includes('data:image/webp'):false
      };
    }""")

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-toolbar-v7109-') as td:
        root=pathlib.Path(td)
        books=root/'books';books.mkdir()
        create_epub(books/'toolbar-check.epub')
        proc=log=None
        try:
            proc,port,log=launch(ROOT/'dist/douyin.js',books,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as response:
                book=next(b for b in json.load(response)['books'] if b['name']=='toolbar-check.epub')
            with sync_playwright() as playwright:
                browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                errors=[]
                page.on('pageerror',lambda err:errors.append(str(err)))
                page.goto(base,wait_until='domcontentloaded',timeout=30000)
                page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=20000)
                page.evaluate("(id)=>jfDeskOpenReader(id,0)",book['id'])
                page.wait_for_function("()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0",timeout=30000)
                page.wait_for_timeout(200)
                first=read_ui(page)
                assert first['scrambleAbsent'] and first['excerptEnabled'],first
                assert not first['paged'] and not first['themeDisabled'],first
                old_theme=first['themePref']
                page.locator('#jfReadTheme').click()
                page.wait_for_function("(prev)=>jfDeskPrefs.theme!==prev",arg=old_theme,timeout=10000)
                toggled=read_ui(page)
                assert toggled['themePref']!=old_theme and not toggled['themeDisabled'],toggled

                page.locator('#jfReadPaged').click()
                page.wait_for_function("""()=>{
                  const paper=document.querySelector('#jfPageView .jfSheet[data-side="left"]');
                  return jfDeskPaged&&document.getElementById('jfReadTheme').disabled&&
                    !!paper?.dataset.paperGroup&&
                    getComputedStyle(paper,'::after').backgroundImage.includes('data:image/webp');
                }""",timeout=30000)
                fixed=read_ui(page)
                assert fixed['themeDisabled'] and fixed['themeAriaDisabled']=='true',fixed
                assert float(fixed['themeOpacity'])<.5,fixed
                assert fixed['paperEnabled'] and fixed['paperImage'],fixed
                assert '不可用' in fixed['themeTitle'] and fixed['scrambleAbsent'],fixed

                # Even a synthetic click event cannot modify a stored flow
                # theme while the page mode uses fixed photographed paper.
                page.evaluate("""()=>{
                  document.getElementById('jfReadTheme')
                    .dispatchEvent(new MouseEvent('click',{bubbles:true}));
                }""")
                after_synthetic=read_ui(page)
                assert after_synthetic['themePref']==fixed['themePref'],after_synthetic

                # Cropped visual evidence: theme muted but other controls intact.
                jpeg=Image.open(io.BytesIO(page.screenshot())).convert('RGB').crop((970,0,1386,80))
                data=io.BytesIO()
                jpeg.save(data,'JPEG',quality=75,optimize=True)
                encoded=base64.b64encode(data.getvalue()).decode('ascii')
                print('TOOLBAR_V7109_FACTS',json.dumps({
                    'flow':first,'flowAfterThemeClick':toggled,'paper':fixed,
                    'syntheticClick':after_synthetic
                },ensure_ascii=False),flush=True)
                print('TOOLBAR_V7109_JPEG_BEGIN',flush=True)
                for i in range(0,len(encoded),3000):
                    print('TOOLBAR_V7109_JPEG_DATA:'+encoded[i:i+3000],flush=True)
                print('TOOLBAR_V7109_JPEG_END',flush=True)

                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>!jfDeskPaged&&!document.getElementById('jfReadTheme').disabled",timeout=30000)
                restored=read_ui(page)
                assert restored['excerptEnabled'] and restored['scrambleAbsent'],restored
                assert restored['themePref']==fixed['themePref'] and restored['themeAriaDisabled']=='false',restored
                page.locator('#jfReadTheme').click()
                page.wait_for_function("(prev)=>jfDeskPrefs.theme!==prev",arg=restored['themePref'],timeout=10000)
                assert not errors,errors
                print('PASS v7.109 browser: scramble absent, theme enabled in flow, disabled in book, paper intact, roundtrip restores',flush=True)
                browser.close()
        finally:
            stop(proc,log)

if __name__=='__main__':
    main()
