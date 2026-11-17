#!/usr/bin/env node
'use strict';
// Regression for audio/video speed choices; no playback files or user data.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const audio=fs.readFileSync(path.join(root,'src/client/scripts/20-audio-controls.js'),'utf8');
const video=fs.readFileSync(path.join(root,'src/client/scripts/95-annotations.js'),'utf8');
const optionsMatch=audio.match(/const AUDIO_SPEED_OPTIONS\s*=\s*(\[[^\]]+\]);/);
const ratesMatch=video.match(/const rates\s*=\s*(\[[^\]]+\]);[\s\S]*?video\.playbackRate\s*=\s*rates\[\(i\+1\)%rates\.length\]/);
assert(optionsMatch&&ratesMatch,'speed controls must keep valid rate arrays');
const audioOptions=vm.runInNewContext(optionsMatch[1]);
const videoOptions=vm.runInNewContext(ratesMatch[1]);
for(const [name,options] of [['audio',audioOptions],['video',videoOptions]]){
  assert(options.includes(0.25),name+' includes 0.25x');
  assert(options.includes(0.5),name+' includes 0.5x');
  assert(options.includes(1),name+' includes 1x');
  assert.equal(new Set(options).size,options.length,'no duplicate rates');
  assert(options.every(x=>Number.isFinite(x)&&x>=0.25&&x<=2));
}
assert(audioOptions.includes(1.75),'preserve audio 1.75x');
assert(videoOptions.includes(1.25)&&videoOptions.includes(1.5),'preserve video 1.25x/1.5x');
assert(audio.includes('AUDIO_SPEED_OPTIONS.map(rate=>'),'audio choices generated from options');
assert(audio.includes('AUDIO_SPEED_OPTIONS.includes(savedRate)'),'saved slow speed restored');
assert(audio.includes("function audioSpeedLabel(rate) { return String(rate)+'×'; }"),'rate label');
let rate=1;const visited=[];
for(let n=0;n<videoOptions.length;n++){
  const i=videoOptions.findIndex(x=>Math.abs(rate-x)<.01);
  rate=videoOptions[(i+1)%videoOptions.length];
  visited.push(rate);
}
assert(visited.includes(0.25)&&visited.includes(0.5),'video cycle visits both slow speeds');
assert.equal(rate,1,'video cycle returns to normal');
assert(video.includes("rate.textContent=(Number(video.playbackRate)||1)+'×'"),
  'video timeline shows actual playbackRate');
console.log('PASS audio/video speed choices and video cycle including 0.25x and 0.5x');
