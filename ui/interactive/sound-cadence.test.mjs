import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundCadence,COLLISION_SOUND} from './sound-cadence.js';
import {createUISound,soundLevel} from './ui-audio.js';
import {SOUND_VOLUMES,volumeFromState,nextSoundVolume} from './sound-volume.js';

test('volume has one louder step above the existing level and legacy ON keeps its level',()=>{
  assert.deepEqual(SOUND_VOLUMES.map(level=>level.label),['OFF','標準','大']);
  assert.deepEqual([0,1,2].map(nextSoundVolume),[1,2,0]);
  assert.equal(volumeFromState({sound:true}),1);assert.equal(volumeFromState({sound:false}),0);
  assert.equal(volumeFromState({sound:true,soundVolume:2}),2);
  assert.equal(volumeFromState({sound:true,soundVolume:99}),1);
  for(const kind of ['hover','collision','startup','success'])for(const strength of [0,.3,1]){
    assert.equal(soundLevel(kind,strength,0),0);
    assert.equal(soundLevel(kind,strength,2),2*soundLevel(kind,strength,1));
    assert.ok(soundLevel(kind,strength,2)<=1);
  }
});
function fixture(){
  let now=0;const events=[];const sound=createSoundCadence((kind,take,strength)=>events.push({kind,take,strength,now}));sound.setEnabled(true);
  return{sound,events,frame(t,contacts=[],active=true,elapsed=16){now=t;return sound.collisionFrame(contacts,t,elapsed,active);}};
}
const hit=(now,id='a-b',speed=80)=>({id,speed,now});
test('moving without contact is silent even over many frames',()=>{
  const {sound,frame,events}=fixture();
  for(let t=0;t<2000;t+=16){sound.windowActivity(true,t);frame(t);}
  assert.equal(events.length,0);
});
test('one strongest fresh collision drives its take and bounded impact level',()=>{
  const {frame,events}=fixture();
  assert.ok(frame(0,[hit(0,'soft',20),hit(0,'hard',160)]));
  assert.equal(events[0].kind,'collision');assert.equal(events[0].strength,1);
  assert.equal(frame(100,[hit(100,'other',100)]),false);
  assert.ok(frame(125,[hit(125,'other',30)]));assert.ok(events[1].strength<events[0].strength);
  assert.equal(frame(250,[hit(250,'other',100)]),false,'resting pair has its own cooldown');
  assert.ok(frame(260,[hit(260,'third',100)]));
  assert.deepEqual(events.map(e=>e.take),[0,1,2]);
  for(let i=1;i<events.length;i++)assert.ok(events[i].now-events[i-1].now>=COLLISION_SOUND.interval);
});
test('a collision family excludes hover, scroll and startup throughout settling',()=>{
  const {sound,frame,events}=fixture();frame(0,[hit(0)]);
  assert.equal(sound.hover('a',300),false);assert.equal(sound.contact(0,300),false);
  sound.beginScroll(320);assert.equal(sound.hover('scrolling',340),false);sound.endScroll(340);
  frame(400,[],false);assert.equal(sound.hover('b',740),false);
  assert.equal(sound.hover('b',791),true);assert.equal(events.length,2);
});
test('stale, subthreshold and suspended contacts are dropped without deferred playback',()=>{
  const {frame,events}=fixture();
  assert.equal(frame(100,[hit(0)]),false);assert.equal(frame(200,[hit(200,'gentle',10)]),false);
  assert.equal(frame(400,[hit(400)],true,240),false);assert.equal(frame(416,[]),false);
  assert.equal(events.length,0);assert.ok(frame(432,[hit(432)]));assert.equal(events.length,1);
});
test('OFF never emits contacts and native playback receives the collision strength',()=>{
  const original=globalThis.document;globalThis.document={hidden:false};
  try{
    const events=[],sound=createUISound({native:true,sendNative:(kind,take,strength)=>events.push({kind,take,strength})});
    sound.collisionFrame([hit(0)],0,16,true);assert.equal(events.length,0);
    sound.setVolume(2);sound.collisionFrame([hit(200)],200,16,true);
    assert.equal(events.length,1);assert.equal(events[0].kind,'collision');assert.ok(events[0].strength>0&&events[0].strength<=1);
    sound.setEnabled(false);sound.collisionFrame([hit(400)],400,16,true);assert.equal(events.length,1);
  }finally{globalThis.document=original;}
});
test('natural wood tails stay within two voices and mute stops active audio',()=>{
  const original={Audio:globalThis.Audio,document:globalThis.document};let now=0,maxVoices=0;const played=[];
  class FakeAudio{
    static all=[];
    constructor(url){this.url=url;this.duration=.22;this.currentTime=0;this.paused=true;this.ended=false;FakeAudio.all.push(this);}
    play(){this.paused=false;this.ended=false;this.started=now;played.push({url:this.url,volume:this.volume,now});maxVoices=Math.max(maxVoices,FakeAudio.all.filter(a=>!a.paused&&!a.ended).length);return Promise.resolve();}
    pause(){this.paused=true;}
  }
  globalThis.Audio=FakeAudio;globalThis.document={hidden:false,baseURI:'https://example.invalid/interactive/index.html'};
  try{
    const sound=createUISound();sound.setEnabled(true);
    for(let t=0;t<1600;t+=25){
      now=t;for(const audio of FakeAudio.all)if(!audio.paused&&t-audio.started>=220){audio.paused=true;audio.ended=true;}
      sound.collisionFrame([hit(t,'pair-'+t,100)],t,25,true);sound.hover('a'+t,t);
    }
    assert.ok(played.length>=10);assert.equal(maxVoices,2);
    assert.ok(played.every(e=>e.url.includes('scroll-')&&e.volume>0&&e.volume<=soundLevel('collision',1)));
    const active=FakeAudio.all.filter(a=>!a.paused&&!a.ended),before=active.map(a=>a.volume),playCount=played.length;
    assert.ok(active.length>0);sound.setVolume(2);
    assert.deepEqual(active.map(a=>a.volume),before.map(level=>level*2));
    assert.equal(played.length,playCount,'changing volume must not start or duplicate a contact');
    sound.setEnabled(true);assert.deepEqual(active.map(a=>a.volume),before.map(level=>level*2));
    sound.setEnabled(false);assert.ok(FakeAudio.all.every(a=>a.paused));
  }finally{globalThis.Audio=original.Audio;globalThis.document=original.document;}
});
