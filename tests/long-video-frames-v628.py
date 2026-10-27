#!/usr/bin/env python3
"""Long movie (>120000 frames) Chromium UI test + isolated service model test."""
import base64,json,pathlib,re,subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
subprocess.run(['node',str(ROOT/'tests/long-video-frame-service-v628.js')],cwd=ROOT,check=True,timeout=10)
subprocess.run(['python',str(ROOT/'tests/long-real-server-v628.py')],cwd=ROOT,check=True,timeout=40)
script=(ROOT/'dist/douyin.js').read_text(encoding='utf8')
m=re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',script)
assert m
html=json.loads(m.group(1))
checks=[]
def check(name,ok):
  assert ok,name
  checks.append(name)
  print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='jf-v628-video-test-') as directory:
  sample=pathlib.Path(directory)/'sample.mp4'
  subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
    '-f','lavfi','-i','testsrc2=size=320x180:rate=12:duration=2',
    '-c:v','libx264','-pix_fmt','yuv420p','-preset','ultrafast','-an',str(sample)],check=True,timeout=20)
  source='data:video/mp4;base64,'+base64.b64encode(sample.read_bytes()).decode()
  with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1920,'height':1080})
    page_errors=[]
    page.on('pageerror',lambda e:page_errors.append(str(e)))
    page.evaluate('''() => {window.__screenshotPayload=null;
      window.fetch=async (url,options)=>{
        url=String(url?.url||url);
        if(url==='/api/frame-times')return {ok:true,status:200,json:async()=>({ok:true,times:[],count:316800,compact:true,estimated:true,fps:30,duration:10560})};
        if(url==='/api/frame-preview/start')return {ok:true,status:200,json:async()=>({ok:true,id:'v628',ready:0,done:false,total:316800,error:'长视频已跳过批量逐帧缓存'})};
        if(url==='/api/screenshot'){window.__screenshotPayload=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({ok:true,key:'saved'})};}
        return {ok:true,status:200,json:async()=>({items:[],folders:[],scanStatus:'ready'})};
      };
    }''')
    page.set_content(html,wait_until='load',timeout=25000)
    page.evaluate('''(src)=>{let video=document.createElement('video');video.id='syntheticSource';video.muted=true;video.src=src;document.body.appendChild(video);video.load();}''',source)
    page.wait_for_function("document.querySelector('#syntheticSource')?.readyState >= 2",timeout=10000)
    page.evaluate('''()=>{
      openShotStudio({kind:'video',key:'fake-long',title:'二小时五十六分的讲座',duration:10560,mediaUrl:document.querySelector('#syntheticSource').src},document.querySelector('#syntheticSource'));
      const preview=document.querySelector('.shotVideo');
      Object.defineProperty(preview,'duration',{get:()=>10560});
    }''')
    page.wait_for_function('document.querySelector(".shotSeek")?.max === "316799"',timeout=8000)
    check('Long movie timeline includes frame 316800',page.locator('.shotSeek').get_attribute('max')=='316799')
    page.locator('.shotSeek').evaluate('node=>{node.value="316799";node.dispatchEvent(new Event("input",{bubbles:true}));}')
    page.wait_for_timeout(250)
    label=page.locator('.shotIndex').inner_text()
    time=page.locator('.shotTime').inner_text()
    check('At end slider reads 316800 / 316800', '316800 / 316800' in label)
    check('At end time reaches 175:59 instead of 66:39', '175:59.' in time)
    check('No misleading thumbnail background generation',page.locator('.shotThumbProgress').is_hidden())
    page.locator('.shotSave').click()
    page.wait_for_function('window.__screenshotPayload!==null',timeout=3000)
    payload=page.evaluate('window.__screenshotPayload')
    check('Long-frame screenshot seeks by timestamp',payload.get('frameIndex') is None and abs(payload.get('time',0)-10559.9675)<.01)
    check('Original-quality screenshot operation preserved',payload['key']=='fake-long' and payload['precise'] is True)
    page.keyboard.press('ArrowLeft')
    check('Long-video frame stepping remains one frame', '316799 / 316800' in page.locator('.shotIndex').inner_text())
    check('Browser has no script errors',not page_errors)
    browser.close()
print('PASS long-video browser',len(checks),'checks')
