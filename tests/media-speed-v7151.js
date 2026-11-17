#!/usr/bin/env node
'use strict';
// Regression for audio/video dropdown speed choices, no user media/files.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const audio=read('src/client/scripts/20-audio-controls.js');
const player=read('src/client/scripts/50-video-playback.js');
const timeline=read('src/client/scripts/95-annotations.js');
const markup=read('src/client/scripts/60-video-tools.js');
const styles=read('src/client/styles/30-overrides.css');
const audioMatch=audio.match(/const AUDIO_SPEED_OPTIONS\s*=\s*(\[[^\]]+\]);/);
const videoMatch=player.match(/const JF_VIDEO_SPEED_OPTIONS\s*=\s*(\[[^\]]+\]);/);
assert(audioMatch&&videoMatch,'audio and video speed lists exist');
const audioOptions=vm.runInNewContext(audioMatch[1]);
const videoOptions=vm.runInNewContext(videoMatch[1]);
for(const [name,options] of [['audio',audioOptions],['video',videoOptions]]){
  assert(options.includes(0.25),name+' includes 0.25x');
  assert(options.includes(0.5),name+' includes 0.5x');
  assert(options.includes(1),name+' includes normal 1x');
  assert.equal(new Set(options).size,options.length,'no duplicate speeds');
  assert(options.every(x=>Number.isFinite(x)&&x>=0.25&&x<=2));
}
assert(audioOptions.includes(1.75),'preserve audio 1.75x');
assert(videoOptions.includes(1.25)&&videoOptions.includes(1.5),'preserve video speeds');
assert(audio.includes('AUDIO_SPEED_OPTIONS.map(rate=>'),'audio popup unchanged');
assert(audio.includes('AUDIO_SPEED_OPTIONS.includes(savedRate)'),'saved audio speed restored');
assert(markup.includes('class="jfTimelineRate" title="选择播放倍速"'),
  'video timeline uses accessible select');
assert(markup.includes('JF_VIDEO_SPEED_OPTIONS.map(rate=>'),
  'dropdown options share a single speed list');
assert(!markup.includes('<button type="button" class="jfTimelineRate"'),
  'old cyclic speed button removed');
assert(timeline.includes("if(rate.value!==String(selected))rate.value=String(selected)"),
  'timeline syncs selected option instead of replacing options');
assert(!timeline.includes('rates[(i+1)%rates.length]'),
  'old click-to-cycle handler removed');
assert(styles.includes('select.jfTimelineRate'),'native select styled for timeline');
const start=timeline.indexOf("  feed.addEventListener('change',event=>{");
const end=timeline.indexOf("  feed.addEventListener('pointerdown'",start);
assert(start>=0&&end>start,'delegated native select change handler');
let handler,updates=0,stopped=0;
const feed={addEventListener(type,callback){
  assert.equal(type,'change');handler=callback;
}};
const video={playbackRate:1};
const stage={querySelector(selector){
  assert.equal(selector,'video.feedVideo');return video;
}};
const select={value:'0.25',closest(selector){
  if(selector==='select.jfTimelineRate')return this;
  if(selector==='.videoStage')return stage;
  return null;
}};
const update=source=>{assert.equal(source,video);updates++;};
new Function('feed','JF_VIDEO_SPEED_OPTIONS','jfTimelineUpdate',
  timeline.slice(start,end))(feed,videoOptions,update);
for(const rate of [0.25,0.5,1,1.5,2]){
  select.value=String(rate);
  handler({target:select,stopPropagation(){stopped++;}});
  assert.equal(video.playbackRate,rate,'selection changes actual playback rate');
}
const previous=video.playbackRate;
select.value='9';
handler({target:select,stopPropagation(){}});
assert.equal(video.playbackRate,previous,'unlisted rate rejected');
assert.equal(updates,5,'player UI updated once per valid choice');
assert.equal(stopped,5,'dropdown does not bubble into feed controls');
console.log('PASS video native dropdown selection, 0.25x/0.5x and audio speeds');
