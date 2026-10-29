import test from 'node:test';
import assert from 'node:assert/strict';
import {createChipPress,chipContactHeight} from './chip-press.js';
import {MOTION} from './motion-tokens.js';

test('a tap shorter than one frame still reaches a visible seat and returns once',()=>{
  const p=createChipPress();p.down('a',0);p.up('a',8);
  const amounts=[];for(let now=8;now<=400;now+=8)amounts.push(p.sample('a',now,8).amount);
  assert.ok(amounts[1]>.4,'the first display frame has a readable reaction');
  assert.ok(Math.max(...amounts)>.99,'release cannot erase a short tap before it renders');
  assert.ok(amounts.every(x=>x>=0&&x<=1),'solid wood does not squash or overshoot');
  assert.equal(amounts.at(-1),0);
});

test('holding stays seated, duplicate release cannot create another pulse',()=>{
  const p=createChipPress();p.down('a',0,{x:.5,y:-.5});
  let frame;for(let now=8;now<=800;now+=8)frame=p.sample('a',now,8);
  assert.equal(frame.amount,1);assert.equal(frame.held,true);assert.deepEqual(frame.point,{x:.5,y:-.5});
  p.up('a',800);p.up('a',808);p.activate('a',808);
  for(let now=808;now<=1200;now+=8)frame=p.sample('a',now,8);
  assert.equal(frame.amount,0);assert.equal(frame.held,false);
});

test('cancelled gestures release immediately instead of completing the minimum hold',()=>{
  const cancelled=createChipPress(),accepted=createChipPress();
  for(const p of[cancelled,accepted]){p.down('a',0);p.sample('a',8,8);}
  cancelled.up('a',8,{cancelled:true});accepted.up('a',8);
  let a,b;for(let now=16;now<=64;now+=8){a=cancelled.sample('a',now,8);b=accepted.sample('a',now,8);}
  assert.ok(a.amount<b.amount*.5);assert.ok(b.amount>.99);
});

test('chips have independent contact and losing window focus releases held buttons',()=>{
  const p=createChipPress();p.down('a',0);p.down('b',8);p.up('b',16,{cancelled:true});
  for(let now=16;now<=200;now+=8){p.sample('a',now,8);p.sample('b',now,8);}
  assert.equal(p.sample('a',208,8).amount,1);assert.equal(p.sample('b',208,8).amount,0);
  p.releaseAll(208);for(let now=216;now<=608;now+=8)p.sample('a',now,8);
  assert.equal(p.sample('a',616,8).amount,0);
});

test('accessibility activation has feedback without needing a pointer gesture',()=>{
  const p=createChipPress();p.activate('a',0);
  let peak=0;for(let now=8;now<=400;now+=8)peak=Math.max(peak,p.sample('a',now,8).amount);
  assert.ok(peak>.99);assert.equal(p.sample('a',408,8).amount,0);
});

test('the chosen chip stays seated through a request and releases on its reply',()=>{
  const p=createChipPress();p.down('a',0);p.up('a',8);p.setPending('a',true);p.releaseAll(24);
  for(let now=8;now<=800;now+=8)p.sample('a',now,8);
  assert.equal(p.sample('a',808,8).amount,1);
  assert.equal(p.sample('b',808,8).amount,0);
  p.setPending('a',false);
  for(let now=816;now<=1200;now+=8)p.sample('a',now,8);
  assert.equal(p.sample('a',1208,8).amount,0);
});

test('contact lowers the rigid dish without penetrating the tray, including stacks',()=>{
  for(const base of[5.4,14])for(const extent of[4.5,13.4,18,25]){
    let previous=Infinity;
    for(let amount=0;amount<=1.001;amount+=.1){
      const y=chipContactHeight({base,extent,lift:8.5,amount});
      assert.ok(y>=extent+.35-1e-10);assert.ok(y<=previous+1e-10);previous=y;
    }
  }
  const base=5.4+MOTION.press.standOff;
  const hover=chipContactHeight({base,extent:4.5,lift:MOTION.press.hoverLift,amount:0});
  const rest=chipContactHeight({base,extent:4.5,lift:0,amount:0});
  const seat=chipContactHeight({base,extent:4.5,lift:MOTION.press.hoverLift,amount:1});
  assert.ok((hover-seat)*.28/Math.hypot(1,.28)>5.7,'hovered chips have clear visible travel');
  assert.ok((rest-seat)*.28/Math.hypot(1,.28)>4,'immediate clicks have travel before hover can lift the dish');
});

test('reduced motion gives static contact shading without moving the dish',()=>{
  const p=createChipPress();p.down('a',0);p.up('a',8);
  assert.equal(p.sample('a',16,16,true).amount,1);
  for(const amount of[0,.5,1])assert.equal(chipContactHeight({base:5.4,extent:4.5,lift:8.5,amount,reduced:true}),5.4);
  assert.equal(p.sample('a',MOTION.press.minHold+8,MOTION.press.minHold-8,true).amount,0);
});

test('a suspended frame or removed chip cannot replay an old press',()=>{
  const p=createChipPress();p.activate('a',0);p.sample('a',8,8);
  assert.equal(p.sample('a',2000,1992).amount,0);
  p.down('b',2000);p.retain(new Set(['a']));assert.equal(p.sample('b',2016,16).amount,0);
  p.down('a',2016);p.reset();assert.equal(p.sample('a',2032,16).amount,0);
});
