#!/usr/bin/env python3
"""Just Fun v6.42 isolated UI: real Chromium, no provider upload or user media."""
import json,pathlib,sys
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
html=(ROOT/'dist/douyin.js').read_text()
# Bundle extraction uses the generated page through isolated legacy helper.
from isolated import ROOT as _,urlopen,launch,stop
import tempfile,subprocess,time

def check(label,condition):
    if not condition:raise AssertionError(label)
    print('PASS',label,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-transcriptux-') as d:
    lib=pathlib.Path(d)/'模拟媒体';lib.mkdir()
    subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=450:duration=4','-y',str(lib/'lecture.wav')],check=True,timeout=20)
    proc=log=None
    try:
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,pathlib.Path(d)/'home')
        page_html=urlopen(f'http://127.0.0.1:{port}/')[2].decode()
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            context=browser.new_context(viewport={'width':1440,'height':900},accept_downloads=True)
            page=context.new_page();errors=[]
            page.on('pageerror',lambda e: errors.append(str(e)))
            page.set_content(page_html,wait_until='domcontentloaded',timeout=25000)
            document={'version':1,'sourceKey':'0123456789abcdef','durationMs':185000,'segments':[
              {'startMs':1000,'endMs':7000,'text':'这是一段江浙口音的课程介绍，文字应该能够自然排版，不需要独立的小滚动条。'},
              {'startMs':7000,'endMs':17000,'text':'这是第二段转写正文，其中提到了《周易参同契》和魏伯阳。'}],
              'complete':True,'confirmed':False,'revision':1}
            page.evaluate("""async ({doc})=>{
              window.jfTest={doc,chatOpened:false,rewriteKey:null,saveCalls:0};
              allItems=[{key:doc.sourceKey,kind:'audio',title:'课程音轨',displayName:'课程音轨'}];
              window.fetch=async(url,opts={})=>{
                const s=String(url);
                if(s.includes('/api/ai-transcript/save')){
                  const value=JSON.parse(opts.body);window.jfTest.saveCalls++;
                  window.jfTest.doc.segments=value.segments;
                  window.jfTest.doc.revision++;
                  return new Response(JSON.stringify({ok:true,data:window.jfTest.doc}));
                }
                if(s.includes('/api/ai-transcript?'))return new Response(JSON.stringify({ok:true,data:window.jfTest.doc}));
                if(s.includes('/api/ai-learning/discover'))return new Response(JSON.stringify({ok:true,found:[]}));
                return new Response(JSON.stringify({ok:true,data:null}));
              };
              window.open=()=>({opener:null,closed:false,document:{title:''},location:{replace(url){window.jfTest.chatOpened=url;}},close(){}});
              window.confirm=()=>true;
              window.jfAiAudioRegenerate=(k)=>{window.jfTest.rewriteKey=k;};
              await window.jfAiLearningOpen(doc.sourceKey,'transcript');
            }""",{'doc':document})
            page.wait_for_timeout(150)
            page.evaluate("document.querySelector('#jfAppSplash')?.remove()")
            check('Two actions visible, no approval/export',page.locator('.jfLearnToolbar button:visible').all_text_contents()==['重新生成','AI 分析 ↗'])
            check('Paragraph-like text with peripheral timestamp',page.locator('.jfTransEntry').count()==2 and page.locator('.jfTransJump').first.evaluate('(el)=>getComputedStyle(el).fontSize')=='10px')
            check('No nested editable scrollbar',page.locator('.jfTransRowEdit').first.evaluate('(el)=>el.scrollHeight<=el.clientHeight+3'))
            initial=page.locator('#jfAiLearningDrawer').bounding_box()
            handle=page.locator('.jfLearnResize');box=handle.bounding_box()
            page.mouse.move(box['x']+12,box['y']+12);page.mouse.down();page.mouse.move(box['x']-100,box['y']-70,steps=8);page.mouse.up()
            expanded=page.locator('#jfAiLearningDrawer').bounding_box()
            check('Drag handle changes width and height',expanded['width']>initial['width']+70 and expanded['height']>initial['height']+40)
            page.locator('.jfTransRowEdit').first.fill('人工修订后的核心原话')
            page.wait_for_timeout(1600)
            check('Typed text autosaves',page.evaluate('window.jfTest.doc.segments[0].text')=='人工修订后的核心原话')
            with page.expect_download(timeout=7000) as caught:
                page.locator('.jfTransAnalyze').click()
            download=caught.value
            check('AI action downloads Markdown',download.suggested_filename.endswith('.md'))
            content=pathlib.Path(download.path()).read_text(encoding='utf-8-sig')
            check('Markdown contains edited text/time/source/schema',all(x in content for x in ['人工修订后的核心原话','0123456789abcdef','notes.json','outline.json','0:01 → 0:07']))
            check('AI action opens fresh ChatGPT',page.evaluate('window.jfTest.chatOpened')=='https://chatgpt.com/')
            page.locator('.jfTransRegenerate').click()
            check('Explicit regenerate triggers existing audio workflow',page.evaluate('window.jfTest.rewriteKey')=='0123456789abcdef')
            check('No page script errors',not errors)
            context.close();browser.close()
    finally:
        if proc:stop(proc,log)
