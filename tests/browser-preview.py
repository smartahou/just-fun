import base64, json, re, pathlib, time, tempfile, subprocess
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]; source=(root/'dist/douyin.js').read_text()
(root/'dist/browser-shots').mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-preview-') as temp:
    movie=pathlib.Path(temp)/'preview.mp4'; poster=pathlib.Path(temp)/'cover.jpg'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=192x320:rate=24:duration=5','-c:v','libx264','-pix_fmt','yuv420p','-preset','fast','-movflags','+faststart','-an',str(movie)],check=True,timeout=25)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss','1','-i',str(movie),'-frames:v','1',str(poster)],check=True,timeout=20)
    videodata=movie.read_bytes(); posterdata=poster.read_bytes()
m=re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',source)
assert m,'HTML not found'
html=json.loads(m.group(1))
video='data:video/mp4;base64,'+base64.b64encode(videodata).decode()
cover='data:image/jpeg;base64,'+base64.b64encode(posterdata).decode()
items=[]
for i in range(3):
    items.append(dict(kind='video',key='preview-'+str(i),originalName='preview'+str(i)+'.mp4',title='测试预览'+str(i),displayName='测试预览'+str(i),mediaUrl=video,cover=cover,coverTime=1.0,relativeDir='root',resolution='192×320',durationText='0:05',modifiedTimeMs=300-i,rating=5-i))
payload=dict(items=items,folders=[],scanStatus='ready',updatedAt='fixture-v622')
checks=[]
def ck(name,ok,detail=''):
    checks.append((name,bool(ok),detail))
    print('PASS' if ok else 'FAIL',name,detail,flush=True)
    if not ok:raise AssertionError(name+' '+detail)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.evaluate('''(payload)=>{window.fetch=async()=>{await new Promise(r=>setTimeout(r,1300));return{ok:true,status:200,json:async()=>payload};};}''',payload)
    page.set_content(html,wait_until='load',timeout=25000)
    ck('Splash visible while index pending',page.locator('#jfAppSplash').is_visible())
    page.screenshot(path=str(root/'dist/browser-shots/app-loading-v622.png'))
    page.wait_for_timeout(400)
    ck('No fake immediate splash dismissal',page.locator('#jfAppSplash').is_visible())
    page.wait_for_function('document.querySelector("#jfAppSplash").hidden===true',timeout=6500)
    ck('Splash dismissed after data render',page.locator('#grid .jfCoverTile').count()==3)
    ck('Body interactions unlocked',not page.locator('body').evaluate('(el)=>el.classList.contains("jfBooting")'))
    page.screenshot(path=str(root/'dist/browser-shots/video-list-v622.png'))
    first=page.locator('.jfCoverTile .coverWrap').first
    first.hover()
    page.wait_for_timeout(550)
    ck('No premature preview before 800ms',page.locator('.jfHoverPreview').count()==0)
    page.wait_for_timeout(350)
    ck('Preview created after 800ms',page.locator('.jfHoverPreview').count()==1)
    video_node=page.locator('.jfHoverPreview')
    ck('Preview hidden until frame',video_node.evaluate("v=>v.classList.contains('jfPreviewVisible') || getComputedStyle(v).opacity==='0'"))
    # Actual Chromium should decode the data:video/mp4 and present the frame.
    try:
      page.wait_for_function('''() => document.querySelector('.jfHoverPreview')?.classList.contains('jfPreviewVisible')''',timeout=7000)
      visible=True
    except:visible=False
    ck('First decoded frame becomes visible',visible, page.locator('.jfHoverPreview').evaluate('v=>JSON.stringify({readyState:v.readyState,paused:v.paused,networkState:v.networkState,error:v.error?.message,currentTime:v.currentTime})') if page.locator('.jfHoverPreview').count() else 'gone')
    ck('Preview muted',video_node.evaluate('v=>v.muted && v.defaultMuted && v.volume===1'))
    ck('Starts from cover time',video_node.evaluate('v=>v.currentTime>=.9'))
    page.screenshot(path=str(root/'dist/browser-shots/preview-ready-v622.png'))
    page.mouse.move(3,3)
    page.wait_for_timeout(180)
    ck('Mouse leave cleans up video',page.locator('.jfHoverPreview').count()==0)
    second=page.locator('.jfCoverTile .coverWrap').nth(1)
    second.hover();page.wait_for_timeout(950)
    ck('Second card has at most one preview',page.locator('.jfHoverPreview').count()==1)
    ck('Second preview does not expose black before first frame',page.locator('.jfHoverPreview').evaluate("v=>v.classList.contains('jfPreviewVisible') || getComputedStyle(v).opacity==='0'"))
    first.hover();page.wait_for_timeout(260)
    ck('Rapid hover switch does not spawn video',page.locator('.jfHoverPreview').count()==0)
    page.mouse.move(0,0)
    ck('No browser script exception',not errors,str(errors))
    browser.close()
(root/'dist/browser-v622-report.json').write_text(json.dumps({'checks':[{'name':n,'passed':b,'detail':d} for n,b,d in checks]},ensure_ascii=False,indent=2))
print('RESULT',len(checks),'/',len(checks))
