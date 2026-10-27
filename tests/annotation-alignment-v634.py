#!/usr/bin/env python3
"""v6.34 visual contract: timeline mark centers, audio/video parity and icon parity.

Only in-memory DOM and synthetic clip metadata; no media or user files accessed.
"""
import json,pathlib,re
from playwright.sync_api import sync_playwright
from isolated import ROOT

code=(ROOT/'dist/douyin.js').read_text(encoding='utf8')
m=re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}',code)
assert m, 'Could not read generated HTML'
html=json.loads(m.group(1))
passed=[]
def ck(label,test):
    ok=bool(test)
    print(('PASS ' if ok else 'FAIL ')+label,flush=True)
    passed.append(ok)
    if not ok:raise AssertionError(label)

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    page.evaluate('''()=>{window.fetch=async()=>({ok:true,json:async()=>({ok:true,clips:[],items:[],folders:[]})})}''')
    page.set_content(html,wait_until='load',timeout=20000)
    page.wait_for_timeout(300)
    for width in (760,360):
        results=page.evaluate('''(width)=>{
          document.querySelector('#jfFixture')?.remove();
          const host=document.createElement('div');host.id='jfFixture';
          host.style.cssText='position:absolute;top:150px;left:50px;width:'+width+'px;height:220px;z-index:500';
          host.innerHTML='<div class="feedItem" style="position:relative;width:100%;height:90px"><div class="videoStage" style="position:relative;width:100%;height:90px"><div class="jfTimeline" style="position:relative;left:0;right:0;bottom:0;width:100%;height:58px"><div class="jfTimelineTrack"><div class="jfAnnotationRail" data-annotation-key="vf"></div><input class="jfVideoSeek" type="range" min="0" max="100" value="37"></div></div></div></div>';
          document.body.append(host);
          const dock=document.querySelector('#audioDock');dock.hidden=false;
          dock.style.setProperty('width',width+'px','important');
          dock.style.setProperty('left','50px','important');
          dock.style.setProperty('right','auto','important');
          dock.innerHTML=audioDockMarkup({key:'af',title:'测试录音',name:'测试录音',kind:'audio',mediaUrl:'',sizeText:'仅测试'});
          clipShelfRecords=[];
          for(const kind of ['video','audio']){
            const sourceKey=kind==='video'?'vf':'af';
            for(const t of [0,37,100])clipShelfRecords.push({id:kind+t,sourceKey,kind,a:t,b:null,name:'标记'+t});
            clipShelfRecords.push({id:kind+'range',sourceKey,kind,a:20,b:40,name:'区间'});
          }
          for(const [sel] of [['.jfAnnotationRail'],['.jfAnnotationAudioMarks']])
            jfAnnotationPaint(document.querySelector('#jfFixture '+sel)||dock.querySelector(sel),{duration:100});
          const info={};
          for(const [type,sel,slider] of [['video','#jfFixture .jfAnnotationRail','#jfFixture .jfVideoSeek'],['audio','#audioDock .jfAnnotationAudioMarks','#audioDock .audioSeek']]){
            const rail=document.querySelector(sel),range=document.querySelector(slider),seek=range.getBoundingClientRect();
            const thumb=type==='video'?13:11;
            const centers=[0,37,100].map(t=>{
              const n=rail.querySelector('[data-annotation-id="'+type+t+'"]');
              const r=n.getBoundingClientRect();
              const pseudo=getComputedStyle(n,'::after');
              const expected=seek.left+thumb/2+(seek.width-thumb)*t/100;
              return {t,delta:Math.abs(r.left+r.width/2-expected),pseudoLeft:pseudo.left,pseudoWidth:pseudo.width,cssTransform:pseudo.transform,pointWidth:n.offsetWidth,stemCentered:Math.abs(parseFloat(pseudo.left)-n.clientWidth/2)<.6&&pseudo.transform!=='none',noRotation:getComputedStyle(n).transform};
            });
            const mark=rail.querySelector('[data-annotation-id="'+type+'range"]');
            const rect=mark.getBoundingClientRect(),start=seek.left+thumb/2+(seek.width-thumb)*.2;
            const end=seek.left+thumb/2+(seek.width-thumb)*.4;
            const railRect=rail.getBoundingClientRect();
            info[type]={centers,startError:Math.abs(rect.left-start),endError:Math.abs(rect.right-end),railBottom:railRect.bottom,sliderTop:seek.top,sliderMid:(seek.top+seek.bottom)/2,pointBottom:rail.querySelector('.jfAnnotationPoint').getBoundingClientRect().bottom,markRangeHeight:rect.height,sliderWidth:seek.width};
          }
          const videoSVG=document.querySelector('#feedClipShelf svg');
          const audioSVG=dock.querySelector('.jfAudioShelf svg');
          info.sameIcon=!!videoSVG&&!!audioSVG&&videoSVG.innerHTML.replace(/\\s+/g,'')===audioSVG.innerHTML.replace(/\\s+/g,'');
          info.videoIcon=videoSVG?.innerHTML;
          info.audioIcon=audioSVG?.innerHTML;
          return info;
        }''',width)
        for typ in ('video','audio'):
            values=results[typ]
            ck(f'{width}px {typ}: point centered at 0%, 37%, 100%',all(x['delta']<1.5 for x in values['centers']))
            ck(f'{width}px {typ}: stem anchored to mark center',all(x['stemCentered'] for x in values['centers']))
            ck(f'{width}px {typ}: range interval endpoints aligned',values['startError']<1.5 and values['endError']<1.5)
            ck(f'{width}px {typ}: separate from seeking',values['railBottom']<values['sliderMid'])
        ck(f'{width}px: audio and video span style match',abs(results['video']['markRangeHeight']-results['audio']['markRangeHeight'])<1)
        ck(f'{width}px: audio icon identical to video annotation icon',results['sameIcon'])
        print('GEOMETRY',width,json.dumps(results,ensure_ascii=False),flush=True)
    browser.close()
print('ALIGNMENT V634',sum(passed),'/',len(passed),flush=True)
