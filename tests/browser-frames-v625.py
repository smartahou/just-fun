#!/usr/bin/env python3
"""v6.25 isolated real Chromium seek/no-flash + landscape layout regression.
Does not launch the server or use any real library/media."""
import base64, json, pathlib, re, subprocess, tempfile, time
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
script=(ROOT/'dist/douyin.js').read_text()
m=re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',script)
assert m,'Missing embedded HTML'
html=json.loads(m.group(1))
checks=[]
def check(label,passed,extra=''):
    checks.append({'name':label,'passed':bool(passed),'detail':extra})
    print(('PASS' if passed else 'FAIL'),label,extra,flush=True)
    if not passed: raise AssertionError(label+' '+extra)
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-frames-') as temp:
  output=pathlib.Path(temp)/'synthetic.mp4'
  subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=12:duration=6','-c:v','libx264','-pix_fmt','yuv420p','-preset','ultrafast','-movflags','+faststart','-an',str(output)],check=True,timeout=30)
  movie='data:video/mp4;base64,'+base64.b64encode(output.read_bytes()).decode()
  with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    page=browser.new_page(viewport={'width':1920,'height':1080})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.evaluate('''() => {
      window.fetch=async (arg,opts)=>{
        let url=String(arg?.url||arg);
        if(url==='/api/frame-times')return {ok:true,status:200,json:async()=>({ok:true,times:Array.from({length:72},(_,i)=>i/12),duration:6,estimated:false,fps:12})};
        if(url==='/api/frame-preview/start')throw Error('No thumbnail backend in browser fixture');
        return {ok:true,status:200,json:async()=>({items:[],folders:[],scanStatus:'ready',updatedAt:'test'})};
      };
    }''')
    page.set_content(html,wait_until='load',timeout=25000)
    page.wait_for_timeout(500)
    # Card ratio: static layout checks on actual built CSS/JS.
    page.evaluate('''()=>{
      document.body.dataset.studioMode='video';document.body.classList.remove('studioHideVideoNames');
      const grid=document.querySelector('#grid');grid.className='grid';grid.style.width='300px';grid.style.padding='12px';
      grid.innerHTML=card({kind:'video',key:'wide-video',title:'中文片名',displayName:'横屏片名',creator:'讲师',resolution:'1920×1080',rating:4.5,cover:'',durationText:'1:00'});
    }''')
    page.wait_for_timeout(130)
    measurements=page.evaluate('''()=>{let card=document.querySelector('#grid .jfCoverTile');let wrap=card.querySelector('.coverWrap'),info=card.querySelector('.jfCoverInfo');let title=info.querySelector('.titleText');return {orientation:card.dataset.orientation,coverHeight:wrap.getBoundingClientRect().height,infoHeight:info.getBoundingClientRect().height,titleVisible:getComputedStyle(title).display!=='none',actionsVisible:info.querySelector('.actions').getBoundingClientRect().height>0}}''')
    check('Wide poster classified landscape',measurements['orientation']=='landscape')
    check('Landscape info overlay less than half image',measurements['infoHeight']/measurements['coverHeight']<.49,str(measurements))
    check('Landscape title and actions accessible',measurements['titleVisible'] and measurements['actionsVisible'])
    page.evaluate('''()=>{let tile=document.querySelector('#grid .jfCoverTile');tile.dataset.orientation='portrait';tile.style.setProperty('--jf-video-ratio','.5625');}''')
    portraits=page.evaluate('''()=>{let tile=document.querySelector('.jfCoverTile');return {creator:getComputedStyle(tile.querySelector('.creatorRow')).display,inf:tile.querySelector('.jfCoverInfo').getBoundingClientRect().height,cover:tile.querySelector('.coverWrap').getBoundingClientRect().height}}''')
    check('Portrait metadata remains accessible',portraits['creator']!='none',str(portraits))
    page.evaluate('''(src)=>{const video=document.createElement('video');video.id='syntheticSource';video.preload='auto';video.src=src;video.muted=true;document.body.appendChild(video);video.load();}''',movie)
    page.wait_for_function("document.querySelector('#syntheticSource').readyState>=2",timeout=8000)
    page.evaluate('''()=>openShotStudio({kind:'video',key:'synthetic',title:'synthetic landscape',mediaUrl:document.querySelector('#syntheticSource').src,duration:6},document.querySelector('#syntheticSource'))''')
    page.wait_for_function('document.querySelector(".shotSeek")?.max === "71"',timeout=10000)
    check('Frame timeline loaded',page.locator('.shotSeek').get_attribute('max')=='71')
    check('Landscape timeline at least 90% viewport',page.evaluate('''()=>{const f=document.querySelector('.shotFoot');return f.getBoundingClientRect().width/innerWidth>=.9}'''),str(page.evaluate("()=>({width:document.querySelector('.shotFoot').getBoundingClientRect().width,viewport:innerWidth})")))
    page.wait_for_timeout(750)
    check('Stable canvas after initial frame',page.evaluate("()=>!document.querySelector('.shotSnapshot').hidden"))
    # Track every hidden property change; switching to the video layer recreates stale frames.
    page.evaluate('''()=>{
      window.__hiddenTransitions=[];
      const canvas=document.querySelector('.shotSnapshot');
      new MutationObserver(()=>window.__hiddenTransitions.push(canvas.hidden)).observe(canvas,{attributes:true,attributeFilter:['hidden']});
    }''')
    page.locator('.shotSeek').evaluate('(node)=>{node.value="42";node.dispatchEvent(new Event("input",{bubbles:true}));}')
    page.wait_for_function('''()=>{const v=document.querySelector('.shotVideo'),c=document.querySelector('.shotSnapshot');return c?.width>=640 && Math.abs((v?.currentTime||0)-3.5)<.15;}''',timeout=9000)
    first=page.evaluate('''()=>{let v=document.querySelector('.shotVideo'),c=document.querySelector('.shotSnapshot');let p=c.getContext('2d').getImageData(200,130,1,1).data;
      const img=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let fp=2166136261;for(let y=5;y<c.height;y+=28)for(let x=7;x<c.width;x+=31){let i=(y*c.width+x)*4;for(let k=0;k<3;k++){fp^=img[i+k];fp=Math.imul(fp,16777619);}}
      return {t:v.currentTime,sw:c.width,px:Array.from(p),fingerprint:(fp>>>0),hidden:c.hidden}}''')
    check('High-resolution canvas receives decoded seek result',first['sw']>=640 and abs(first['t']-3.5)<.15,str(first))
    # Three rapid moves should leave latest selection displayed, no first-frame reappearance.
    for i in [5,60,18]:
      page.locator('.shotSeek').evaluate('(node,i)=>{node.value=String(i);node.dispatchEvent(new Event("input",{bubbles:true}));}',i)
      page.wait_for_timeout(35)
    page.wait_for_timeout(1550)
    second=page.evaluate('''()=>{let v=document.querySelector('.shotVideo'),c=document.querySelector('.shotSnapshot');let p=c.getContext('2d').getImageData(200,130,1,1).data;
      const img=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let fp=2166136261;for(let y=5;y<c.height;y+=28)for(let x=7;x<c.width;x+=31){let i=(y*c.width+x)*4;for(let k=0;k<3;k++){fp^=img[i+k];fp=Math.imul(fp,16777619);}}
      return {t:v.currentTime,sw:c.width,px:Array.from(p),fingerprint:(fp>>>0),hidden:c.hidden,changed:window.__hiddenTransitions}}''')
    check('Rapid seeks converge on newest frame',abs(second['t']-1.5)<.15,str(second))
    check('Rapid seeks repaint image instead of frozen opener',second['fingerprint']!=first['fingerprint'],str((first['fingerprint'],second['fingerprint'])))
    check('Canvas never unhidden/hidden between frames',not any(second['changed']) and not second['hidden'],str(second['changed']))
    check('No browser script exceptions',not errors,str(errors))
    page.locator('.shotClose').click()
    check('Frame studio releases dialog',page.locator('.shotStudio').count()==0)
    browser.close()
result={'passed':all(x['passed'] for x in checks),'total':len(checks),'checks':checks}
(ROOT/'dist/browser-frames-v625-report.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print('RESULT',len(checks),'/',len(checks),flush=True)
