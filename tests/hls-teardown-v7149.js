#!/usr/bin/env node
'use strict';
// HLS teardown regression; synthetic videos/HLS.js, no browser or user media.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const hlsSource=fs.readFileSync(path.join(root,'src/client/scripts/50-video-playback.js'),'utf8');
const feedSource=fs.readFileSync(path.join(root,'src/client/scripts/60-video-tools.js'),'utf8');
const miniSource=fs.readFileSync(path.join(root,'src/client/scripts/70-multi-window.js'),'utf8');
const hlsEnd=hlsSource.indexOf('let nativeFullscreenVideo = null;');
const closeStart=feedSource.indexOf('function closeFeed() {');
const closeEnd=feedSource.indexOf('function stepFeed(direction) {',closeStart);
assert(hlsEnd>0&&closeStart>0&&closeEnd>closeStart,'source extraction bounds');
class FakeHls{
  static Events={MEDIA_ATTACHED:'attached',MANIFEST_PARSED:'parsed',ERROR:'error'};
  static ErrorTypes={NETWORK_ERROR:'network',MEDIA_ERROR:'media'};
  static isSupported(){return true;}
  constructor(){this.handlers=new Map();this.stops=0;this.destroys=0;FakeHls.list.push(this);}
  on(event,fn){this.handlers.set(event,fn);}
  attachMedia(video){this.video=video;video.setAttribute('src','blob:mock-media-source');}
  stopLoad(){this.stops++;}
  destroy(){this.destroys++;}
}
FakeHls.list=[];
function video(key){
  const attrs=new Map();
  return {dataset:{itemKey:key,loaded:'1'},isConnected:true,paused:false,
    preload:'auto',srcObject:null,plays:0,pauses:0,loads:0,
    classList:{contains:v=>v==='feedVideo'},
    setAttribute:(k,v)=>attrs.set(k,v),
    getAttribute:k=>attrs.get(k)||null,hasAttribute:k=>attrs.has(k),
    removeAttribute:k=>attrs.delete(k),
    pause(){this.pauses++;this.paused=true;},
    play(){this.plays++;this.paused=false;return Promise.resolve();},
    load(){this.loads++;},attributes:attrs};
}
const first=video('hls-1'),second=video('hls-2'),direct=video('direct');
direct.setAttribute('src','/media/direct');
const videos=[first,second,direct];
const overlay={open:true,classList:{
  remove(v){if(v==='open')overlay.open=false;},
  contains(v){return v==='open'&&overlay.open;}},
  setAttribute(){}};
const scroller={querySelectorAll(){return videos;},_html:'initial',
  set innerHTML(s){this._html=s;for(const v of videos)v.isConnected=false;},
  get innerHTML(){return this._html;}};
const document={
  querySelector:s=>s==='#feedOverlay'?overlay:s==='#feedScroller'?scroller:null,
  querySelectorAll:s=>s==='#feedScroller video'?videos:[],
  getElementById:s=>s==='feedOverlay'?overlay:null
};
const item1={key:'hls-1',originalExt:'.m3u8',mediaUrl:'/media/hls-1'},
  item2={key:'hls-2',originalExt:'.m3u8',mediaUrl:'/media/hls-2'};
const context={window:{JF:{Hls:FakeHls}},document,allItems:[item1,item2],
  currentFeedKey:'hls-1',console,
  resetFeedVideoSession:()=>{},resetFeedWheelGesture:()=>{},
  resetFeedDeleteButton:()=>{},exitImmersiveChrome:()=>{},
  resetStudioFeedPanels:()=>{},disconnectFeedVideoObserver:()=>{},
  renderStudioEntrance:()=>{},scrollGridToFeedKey:()=>{},
  renderCreatorTags:()=>{},render:()=>{}};
vm.createContext(context);
const state='let jfFeedSessionGeneration=0,feedObserver=null,jfFeedVirtualState=null;\n'+
  'let nativeFullscreenVideo=null,nativeFullscreenKey="",nativeFullscreenOrigin=null;\n'+
  'let pendingGridRender=false;';
vm.runInContext(state+'\n'+hlsSource.slice(0,hlsEnd)+'\n'+
  feedSource.slice(closeStart,closeEnd)+'\n'+
  'this.run={set:jfSetVideoSource,dispose:jfDisposeVideoSource,close:closeFeed};',context);
context.run.set(first,item1.mediaUrl,item1);
context.run.set(second,item2.mediaUrl,item2);
assert.equal(FakeHls.list.length,2);
const hls=FakeHls.list.slice();
context.run.close();
for(const entry of hls){
  assert.equal(entry.stops,1,'HLS network loading stopped');
  assert.equal(entry.destroys,1,'HLS MediaSource destroyed');
}
for(const v of videos){
  assert(v.pauses>=1,'every video paused');
  assert.equal(v.dataset.loaded,'0','load state reset');
  assert.equal(v.getAttribute('src'),null,'blob/native source removed');
  assert.equal(v.srcObject,null,'MediaStream disconnected');
  assert(v.loads>=1,'decoder reset');
}
assert.equal(scroller.innerHTML,'','feed DOM cleared');
assert.equal(overlay.open,false,'overlay hidden');
const before=first.plays;
hls[0].handlers.get(FakeHls.Events.MANIFEST_PARSED)();
assert.equal(first.plays,before,'stale HLS event cannot restart closed video');
context.run.close();
assert.equal(hls[0].destroys,1,'teardown is idempotent');
const mini=video('hls-1');
context.run.set(mini,item1.mediaUrl,item1);
const miniEngine=FakeHls.list.at(-1);
context.run.dispose(mini);
assert.equal(miniEngine.destroys,1,'mini HLS source destroyed');
assert.equal(mini.getAttribute('src'),null);
assert(feedSource.slice(closeStart,closeEnd).includes('jfDisposeVideoSource(video)'));
const openStart=feedSource.indexOf('function openFeed(key) {');
const openEnd=feedSource.indexOf('function scrollGridToFeedKey(',openStart);
assert(openStart>0&&openEnd>openStart);
assert(feedSource.slice(openStart,openEnd).includes('jfDisposeVideoSource(video)'),
  'reopening Feed releases previous HLS engines');
assert(miniSource.includes('if(video)jfDisposeVideoSource(video);'),
  'closing mini window also detaches its source');
console.log('PASS HLS close Feed/reopen/mini teardown + stale event cancellation');
