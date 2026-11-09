#!/usr/bin/env python3
"""v7.108: real Chromium UI test for only-meaningful typography controls."""
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

def inspect(page):
    return page.evaluate("""()=>{
      const margin=document.getElementById('jfReadSide');
      const label=document.getElementById('jfReadSideControl');
      const family=document.getElementById('jfReadFamily');
      const panel=document.getElementById('jfReadTypographyPanel');
      const sheet=document.querySelector('#jfPageView .jfSheet[data-side="left"]');
      const sheetArt=sheet?getComputedStyle(sheet,'::after').backgroundImage:'';
      return {
        paged:jfDeskPaged,sidePref:jfDeskPrefs.side,sideValue:margin.value,
        marginDisabled:margin.disabled,ariaDisabled:margin.getAttribute('aria-disabled'),
        reason:label.title,heading:document.getElementById('jfReadTypographyTitle').textContent,
        fontValue:family.value,panelOpen:!panel.hidden,
        paperButtonRemoved:!document.getElementById('jfReadPaperAged'),
        paperWearRemoved:!document.getElementById('jfReadPaperWear'),
        originalPaperEnabled:window.JFPaperTextures.isEnabled(),
        paperStorage:localStorage.getItem('jf-reader-aged-paper-v768'),
        paperGroup:sheet?.dataset.paperGroup||null,
        originalWebpVisible:sheetArt.includes('data:image/webp')
      };
    }""")

def main():
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-toolbar-v7108-') as td:
        root=pathlib.Path(td)
        books=root/'books';books.mkdir()
        create_epub(books/'reader-settings.epub')
        process=log=None
        try:
            process,port,log=launch(ROOT/'dist/douyin.js',books,root/'home')
            base='http://127.0.0.1:'+str(port)
            with urllib.request.urlopen(base+'/api/books?refresh=1',timeout=30) as resp:
                book=next(b for b in json.load(resp)['books'] if b['name']=='reader-settings.epub')
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1386,'height':850},device_scale_factor=1)
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                # The removed OFF switch must not strand anyone on bare pages.
                page.add_init_script("""()=>{
                  try {localStorage.setItem('jf-reader-aged-paper-v768','off')}catch(e){}
                }""".replace('()=>{','{').replace('}""','}')) if False else None
                page.add_init_script("try{localStorage.setItem('jf-reader-aged-paper-v768','off')}catch(e){}")
                page.goto(base,wait_until='domcontentloaded',timeout=30000)
                page.wait_for_function("typeof jfDeskOpenReader==='function'",timeout=20000)
                page.evaluate('(id)=>jfDeskOpenReader(id,0)',book['id'])
                page.wait_for_function("()=>document.querySelectorAll('#jfReadText [data-chapter]').length>0",timeout=30000)
                page.wait_for_timeout(400)
                page.locator('#jfReadTypographyToggle').click()
                before=inspect(page)
                assert before['panelOpen'] and not before['paged'],before
                assert not before['marginDisabled'] and before['ariaDisabled']=='false',before
                assert before['paperButtonRemoved'] and before['paperWearRemoved'],before
                assert before['originalPaperEnabled'] and before['paperStorage']=='on',before

                page.evaluate("""()=>{
                  const side=document.getElementById('jfReadSide');
                  side.value='38';
                  side.dispatchEvent(new Event('input',{bubbles:true}));
                  side.dispatchEvent(new Event('change',{bubbles:true}));
                }""")
                page.wait_for_function("()=>jfDeskPrefs.side===38",timeout=10000)
                flow=inspect(page)
                assert flow['sidePref']==38 and flow['sideValue']=='38',flow

                page.locator('#jfReadTypographyToggle').click() # close panel
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>jfDeskPaged&&jfDeskPages.length>2",timeout=30000)
                page.locator('#jfReadTypographyToggle').click()
                fixed=inspect(page)
                assert fixed['paged'] and fixed['marginDisabled'],fixed
                assert fixed['ariaDisabled']=='true' and '固定' in fixed['reason'],fixed
                assert fixed['heading']=='字体',fixed
                assert fixed['sidePref']==38 and fixed['sideValue']=='38',fixed
                assert fixed['paperButtonRemoved'] and fixed['paperWearRemoved'],fixed
                assert fixed['originalPaperEnabled'] and fixed['originalWebpVisible'],fixed
                assert fixed['paperGroup'] is not None,fixed

                # Even manually dispatched synthetic change events cannot
                # commit a nonexistent page-margin change in fixed book mode.
                page.evaluate("""()=>{
                  const side=document.getElementById('jfReadSide');
                  side.value='84';
                  side.dispatchEvent(new Event('input',{bubbles:true}));
                  side.dispatchEvent(new Event('change',{bubbles:true}));
                }""")
                unchanged=inspect(page)
                assert unchanged['marginDisabled'] and unchanged['sidePref']==38,unchanged
                assert unchanged['sideValue']=='38',unchanged

                popover=Image.open(io.BytesIO(page.locator('#jfReadTypographyPanel').screenshot())).convert('RGB')
                photo=io.BytesIO()
                popover.save(photo,format='JPEG',quality=78,optimize=True)
                encoded=base64.b64encode(photo.getvalue()).decode('ascii')
                print('PREF_UI_FACTS',json.dumps({
                    'continuous':before,'continuousAfterMargin':flow,
                    'paperBook':fixed,'afterBlockedChange':unchanged
                },ensure_ascii=False),flush=True)
                print('PREF_UI_JPEG_BEGIN',flush=True)
                for i in range(0,len(encoded),3000):
                    print('PREF_UI_JPEG_DATA:'+encoded[i:i+3000],flush=True)
                print('PREF_UI_JPEG_END',flush=True)

                page.locator('#jfReadTypographyToggle').click()
                page.locator('#jfReadPaged').click()
                page.wait_for_function("()=>!jfDeskPaged",timeout=30000)
                page.locator('#jfReadTypographyToggle').click()
                back=inspect(page)
                assert not back['marginDisabled'] and back['ariaDisabled']=='false',back
                assert back['sidePref']==38 and back['heading']=='字体与边距',back
                assert not errors,errors
                print('PASS v7.108: real EPUB flow margin works; page margin disabled; no paper toggle; original 16 WebPs ON; mode roundtrip',flush=True)
                browser.close()
        finally:
            stop(process,log)
if __name__=='__main__':
    main()
