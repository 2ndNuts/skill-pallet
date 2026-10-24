import test from 'node:test';
import assert from 'node:assert/strict';
import {ARRIVAL,arrivalPlan,arrivalPose,contactIsCurrent,createArrivalReplay} from './arrival-motion.js';

const tiles=Array.from({length:48},(_,i)=>({key:i,x:i%4*110,y:Math.floor(i/4)*110,size:100}));

test('visible tiles settle diagonally from bottom right to top left, including a scrolled tray',()=>{
  for(const scroll of [0,440]){
    const plan=arrivalPlan(tiles,434,scroll);
    assert.equal(plan.length,16);
    assert.equal(plan[0].key,15+scroll/110*4);
    assert.equal(plan.at(-1).key,scroll/110*4);
    for(let i=1;i<plan.length;i++){
      const a=tiles[plan[i-1].key],b=tiles[plan[i].key];
      assert.ok(a.x+a.y>=b.x+b.y);
    }
  }
  assert.deepEqual(arrivalPlan([],434),[]);
});

test('each chip approaches from bottom right and finishes at its exact rest position',()=>{
  for(let index=0;index<16;index++){
    let previous=arrivalPose(-1,index);
    assert.equal(previous.opacity,0);
    for(let elapsed=0;elapsed<=ARRIVAL.contact;elapsed++){
      const pose=arrivalPose(index*ARRIVAL.stagger+elapsed,index);
      for(const v of [pose.x,pose.y,pose.height,pose.tilt,pose.opacity])assert.ok(Number.isFinite(v));
      assert.ok(pose.x>=0&&pose.y>=0&&pose.height>=0&&pose.opacity>=0&&pose.opacity<=1);
      assert.ok(pose.x<=previous.x&&pose.y<=previous.y);
      previous=pose;
    }
    const contact=arrivalPose(index*ARRIVAL.stagger+ARRIVAL.contact,index);
    assert.equal(contact.x,0);assert.equal(contact.y,0);assert.equal(contact.height,0);assert.ok(contact.landed);
    const end=arrivalPose(index*ARRIVAL.stagger+ARRIVAL.duration,index);
    assert.deepEqual(end,{x:0,y:0,height:0,tilt:0,opacity:1,landed:true,done:true});
  }
  assert.equal(15*ARRIVAL.stagger+ARRIVAL.duration,520);
});

test('late, offscreen and hidden contact sounds are dropped rather than replayed in a burst',()=>{
  assert.ok(contactIsCurrent(180,0));
  assert.equal(contactIsCurrent(215,0),false);
  assert.equal(contactIsCurrent(180,0,false),false);
  assert.equal(contactIsCurrent(180,0,true,true),false);
});

test('state replies cannot replay an arrival; explicit new sequences can replay after cancellation',()=>{
  const replay=createArrivalReplay({sequence:1});
  assert.ok(replay.take());assert.equal(replay.take(),false);
  assert.equal(replay.observe(1),false);assert.equal(replay.take(),false);
  assert.ok(replay.observe(2));assert.equal(replay.take(false),false);assert.ok(replay.take());
  assert.ok(replay.observe(3));replay.cancel();assert.equal(replay.take(),false);
  assert.ok(replay.observe(4));assert.ok(replay.take());
  assert.equal(replay.observe(3),false);assert.equal(replay.observe(undefined),false);assert.equal(replay.take(),false);
});

test('web process recovery stays quiet until the next explicit presentation',()=>{
  const replay=createArrivalReplay({sequence:5,playArrival:false});
  assert.equal(replay.take(),false);assert.equal(replay.observe(5),false);
  assert.ok(replay.observe(6));assert.ok(replay.observe(7));assert.ok(replay.take());assert.equal(replay.take(),false);
});
