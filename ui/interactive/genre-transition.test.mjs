import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenreTransition,trayPose} from './genre-transition.js';
import {createChipPhysics,chipContact} from './window-inertia.js';
import {createSoundCadence} from './sound-cadence.js';

function setup(reduced=false){
  let clock=0;const events=[];
  const transition=createGenreTransition({order:['all','audio','video','image','ui'],now:()=>clock,reduced:()=>reduced,
    onStart:e=>events.push(['start',e]),onFrame:e=>events.push(['frame',e]),onFinish:e=>events.push(['finish',e])});
  return{transition,events,tick(at){clock=at;transition.tick(at);}};
}
test('the two rigid trays share a bounded 200ms displacement and decelerate to rest',()=>{
  for(const direction of [-1,1]){
    let last=trayPose(0,434,direction),speed=Infinity;
    assert.equal(last.incoming,direction*434);assert.equal(last.outgoing,0);
    for(let t=1;t<=200;t++){
      const pose=trayPose(t,434,direction),delta=Math.abs(pose.incoming-last.incoming);
      assert.ok(delta<=speed+1e-8);assert.ok(pose.progress>=0&&pose.progress<=1);
      assert.ok(Math.abs(pose.incoming-pose.outgoing-direction*434)<1e-8);
      assert.ok(Math.abs(pose.incoming)<=434&&Math.abs(pose.outgoing)<=434);last=pose;speed=delta;
    }
    assert.equal(last.incoming,0);assert.equal(last.outgoing,-direction*434);assert.ok(speed<.001);
    assert.deepEqual(trayPose(900,434,direction),last);
  }
});
test('flicks and button selections finish the current tray then visit only the latest destination',()=>{
  const {transition:t,events,tick}=setup();t.request('audio');tick(50);
  t.request('video');t.request('image');t.request('ui');
  assert.equal(t.target,'ui');tick(199);assert.equal(events.filter(e=>e[0]==='start').length,1);
  tick(200);assert.equal(t.active,true);
  assert.deepEqual(events.filter(e=>e[0]==='start').map(e=>[e[1].from,e[1].to]),[['all','audio'],['audio','ui']]);
  tick(400);assert.equal(t.active,false);assert.equal(t.target,'ui');
});
test('a new selection can replace a pending reversal or cancel it by choosing the incoming tray',()=>{
  const {transition:t,events,tick}=setup();t.request('image');tick(40);t.request('all');t.request('audio');
  tick(200);assert.equal(events.filter(e=>e[0]==='start').at(-1)[1].direction,-1);
  t.request('all');t.request('audio');tick(400);assert.equal(t.active,false);
  assert.equal(t.request('missing'),false);assert.equal(t.request('audio'),false);
});
test('reduced motion and cancellation clean up immediately without replaying pending motion',()=>{
  const reduced=setup(true);reduced.transition.request('image');assert.equal(reduced.transition.active,false);
  assert.equal(reduced.events.at(-1)[1].instant,true);
  const {transition:t,events,tick}=setup();t.request('video');t.request('ui');t.cancel();tick(1000);
  assert.equal(t.active,false);assert.equal(t.target,'video');assert.equal(events.filter(e=>e[0]==='start').length,1);
  assert.equal(events.at(-1)[1].cancelled,true);
});
test('fractional clocks land at 200ms and a slow visible frame preserves the latest pending destination',()=>{
  let clock=10000.12345;const events=[];
  const t=createGenreTransition({order:['all','audio','video'],now:()=>clock,onStart:e=>events.push(e.to)});
  t.request('audio');t.tick(clock+199.99999999);assert.equal(t.active,false);
  clock+=250;t.request('video');t.request('all');clock+=1000;t.tick(clock);
  assert.equal(t.active,true);assert.equal(t.target,'all');assert.deepEqual(events,['audio','video','all']);
  clock+=200;t.tick(clock);assert.equal(t.active,false);
});
test('both travelling trays have individual contacts; only visible contacts enter the shared sound cadence',()=>{
  const size=102.5,items=Array.from({length:16},(_,i)=>({key:`skill-${i}`,x:i%4*(size+8),y:Math.floor(i/4)*(size+8),size,stack:i===4}));
  const incoming=createChipPhysics(),outgoing=createChipPhysics();
  incoming.layout(items,434,434);outgoing.layout(items,434,434);
  const cues=[],cadence=createSoundCadence((kind,take,strength)=>cues.push({kind,take,strength,at}));cadence.setEnabled(true);
  let at=0,diversity=0,overlap=0,tail=false;const seen=[];
  for(at=0;at<=1600;at+=1000/120){
    const pose=trayPose(at,434,1),active=at<200,contacts=[];
    for(const [label,engine,x]of [['in',incoming,pose.incoming],['out',outgoing,pose.outgoing]]){
      engine.observeTray(x,at,active);const state=engine.tick(1000/120,at);
      for(const c of state.contacts){seen.push({...c,label});if(c.x+x>=0&&c.x+x<=434)contacts.push({...c,id:label+':'+c.id});}
      const bodies=engine.bodies;diversity=Math.max(diversity,Math.max(...bodies.map(b=>b.x))-Math.min(...bodies.map(b=>b.x)));
      for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)overlap=Math.max(overlap,chipContact(bodies[i],bodies[j])?.depth??0);
      if(at>200&&label==='in'&&state.moving)tail=true;
    }
    cadence.collisionFrame(contacts,at,1000/120,active||incoming.bodies.some(b=>b.vx||b.x));
    if(active||incoming.bodies.some(b=>b.vx||b.x))assert.equal(cadence.hover('hover',at),false);
  }
  assert.ok(diversity>3);assert.ok(tail);assert.ok(overlap<.08);
  assert.ok(seen.some(c=>c.label==='in'&&c.b));assert.ok(seen.some(c=>c.label==='out'&&c.wall));
  assert.ok(cues.length>0&&cues.length<=6);assert.ok(cues.every(c=>c.kind==='collision'));
  for(let i=1;i<cues.length;i++)assert.ok(cues[i].at-cues[i-1].at>=125-1e-8);
  assert.ok(incoming.bodies.every(b=>b.x===0&&b.vx===0));
});
