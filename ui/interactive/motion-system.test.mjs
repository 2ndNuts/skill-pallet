import test from 'node:test';
import assert from 'node:assert/strict';
import {MOTION,advanceMotion,inkVisibility} from './motion-tokens.js';
import {createChipPhysics} from './window-inertia.js';
import {createInertialScroll} from './inertial-scroll.js';
import {createSoundCadence} from './sound-cadence.js';

const step=1000/60,size=102.5;
const tiles=()=>Array.from({length:96},(_,i)=>({key:'motion-'+i,x:i%4*(size+8),y:Math.floor(i/4)*(size+8),size,stack:i===20}));
function physics(){const p=createChipPhysics();p.layout(tiles(),434,434);p.setView(400);p.observeScroll(400,0);return p;}
function viewport(initial=400,rounded=false){
  const handlers=new Map();let top=initial;
  return{clientHeight:434,scrollHeight:2600,dataset:{},
    get scrollTop(){return top;},set scrollTop(value){top=Math.max(0,Math.min(2166,rounded?Math.round(value):value));},
    addEventListener(name,fn){const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);},
    emit(name,event={}){const e={deltaX:0,deltaY:0,deltaMode:0,preventDefault(){this.prevented=true;},...event};for(const fn of handlers.get(name)||[])fn(e);return e;}
  };
}
function media(fn,reduced=false){const original=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:reduced});try{return fn();}finally{globalThis.matchMedia=original;}}

test('named touch and collection springs settle monotonically without overshoot',()=>{
  for(const preset of[MOTION.hover,MOTION.press,MOTION.layout,MOTION.reveal]){
    const state={x:0,v:0};let previous=0;
    for(let i=0;i<100;i++){advanceMotion(state,1,step,preset);assert.ok(state.x>=previous&&state.x<=1);previous=state.x;}
    assert.equal(state.x,1);assert.equal(state.v,0);
  }
  const press={x:0,v:0},layout={x:0,v:0};for(let i=0;i<8;i++){advanceMotion(press,1,step,MOTION.press);advanceMotion(layout,1,step,MOTION.layout);}
  assert.ok(press.x>layout.x);
});
test('a changed target stays continuous and critical motion is frame-rate independent',()=>{
  const state={x:0,v:0};advanceMotion(state,100,16,MOTION.layout);const before=state.x;
  advanceMotion(state,-100,0,MOTION.layout);assert.equal(state.x,before);
  const run=dt=>{const s={x:0,v:0};for(let t=0;t<160;t+=dt)advanceMotion(s,100,dt,MOTION.layout);return s.x;};
  assert.ok(Math.abs(run(16)-run(8))<1e-10);
  advanceMotion(state,25,2000,MOTION.layout);assert.deepEqual(state,{x:25,v:0});
});
test('labels resolve at their own destination instead of crossing readable neighbours',()=>{
  assert.equal(inkVisibility(120,100),0);assert.equal(inkVisibility(0,100,1),0);assert.equal(inkVisibility(0,100,0),1);
  assert.ok(inkVisibility(5,100)>inkVisibility(15,100));
});
test('actual positive scrolling makes each chip lag downward without a window packet',()=>{
  const p=physics();let state;
  for(let i=1;i<=12;i++){const position=400+i*12;p.setView(position);p.observeScroll(position,i*step);state=p.tick(step,i*step);}
  assert.equal(state.dragging,false);assert.ok(state.scrolling&&state.moving);assert.ok(p.pose('motion-20').y>1);
  assert.ok(new Set(p.bodies.filter(b=>b.baseY>550&&b.baseY<900).map(b=>b.y.toFixed(3))).size>1);
});
test('wheel, coast and reversal feed actual contacts, never a distance sound',()=>media(()=>{
  const v=viewport(),scroller=createInertialScroll(v),p=physics(),events=[];let contacts=[],now=0,pairs=0;
  const sound=createSoundCadence((kind,take,strength)=>{assert.ok(contacts.length);events.push({kind,take,strength,now});});sound.setEnabled(true);
  for(let frame=1;frame<240;frame++){
    now=frame*step;if([2,7,12,17].includes(frame))v.emit('wheel',{deltaY:120});if([65,70,75,80].includes(frame))v.emit('wheel',{deltaY:-120});
    scroller.tick(step);p.setView(v.scrollTop);p.observeScroll(v.scrollTop,now);const state=p.tick(step,now);contacts=state.contacts;pairs+=contacts.filter(c=>c.b).length;
    sound.collisionFrame(contacts,now,step,state.moving||state.scrolling);
  }
  assert.ok(pairs>0);assert.ok(events.length>0);assert.ok(events.every(e=>e.kind==='collision'));
  assert.equal(typeof sound.scroll,'undefined');
  for(let i=1;i<events.length;i++)assert.ok(events[i].now-events[i-1].now>=125);
  assert.ok(p.bodies.every(b=>Math.abs(b.y)<.025));
}));
test('wheel input at an immovable scroll boundary does not invent an impact',()=>media(()=>{
  const v=viewport(2166),scroller=createInertialScroll(v),p=createChipPhysics();p.layout(tiles(),434,434);p.setView(v.scrollTop);p.observeScroll(v.scrollTop,0);
  let count=0;for(let i=1;i<60;i++){v.emit('wheel',{deltaY:200});scroller.tick(step);p.observeScroll(v.scrollTop,i*step);count+=p.tick(step,i*step).contacts.length;}
  assert.equal(count,0);assert.ok(p.bodies.every(b=>b.x===0&&b.y===0));
}));
test('window and scroll forces can act together without erasing one another',()=>{
  const p=physics(),t=step;p.receive({vx:500,vy:0,issuedAt:1800000000000+t,sequence:1,sample:1,dragging:true},t,1800000000000+t);
  p.setView(410);p.observeScroll(410,t);p.tick(step,t);
  assert.ok(p.pose('motion-21').x<0);assert.ok(p.pose('motion-21').y>0);
});
test('a stale window packet cannot reset a valid in-progress scroll',()=>{
  const p=physics();for(let i=1;i<=5;i++){p.setView(400+i*12);p.observeScroll(400+i*12,i*step);p.tick(step,i*step);}
  const body=p.pose('motion-21'),before={y:body.y,vy:body.vy};assert.ok(before.y>0);
  assert.equal(p.receive({vx:0,vy:0,issuedAt:1800000000000,sequence:1,sample:1,dragging:false},240,1800000000240),false);
  assert.equal(body.y,before.y);assert.equal(body.vy,before.vy);
  p.observeScroll(472,6*step);assert.ok(p.tick(step,6*step).scrolling);
});
test('a layout reseeds the scroll reference and a suspended frame cannot replay forces',()=>{
  const p=physics();p.observeScroll(450,step);p.tick(step,step);
  p.layout(tiles(),434,434);p.setView(1200);p.observeScroll(1200,2*step);
  assert.equal(p.tick(step,2*step).moving,false);
  p.observeScroll(1300,3*step);assert.equal(p.tick(2000,2000).moving,false);
  assert.ok(p.bodies.every(b=>b.y===0));
});
test('reduced motion removes scroll dynamics and contact cues',()=>{
  const p=physics();p.observeScroll(500,step);const state=p.tick(step,step,true);
  assert.equal(state.moving,false);assert.deepEqual(state.contacts,[]);
});
test('rounded scrollTop still accumulates small trackpad motion and settles once',()=>media(()=>{
  const v=viewport(400,true);let starts=0,settles=0;const scroll=createInertialScroll(v,{onStart(){starts++;},onSettle(){settles++;}});
  for(let i=0;i<15;i++){v.emit('wheel',{deltaY:.3});scroll.tick(1000/120);}
  for(let i=0;i<100;i++)scroll.tick(1000/120);
  assert.ok(v.scrollTop>=404);assert.equal(scroll.moving,false);assert.equal(starts,settles);
}));
test('a suspended scroll stops at the visible position instead of jumping later',()=>media(()=>{
  const v=viewport(),scroll=createInertialScroll(v);v.emit('wheel',{deltaY:120});scroll.tick(step);const atPause=v.scrollTop;
  scroll.tick(2000);assert.equal(scroll.moving,false);for(let i=0;i<20;i++)scroll.tick(step);
  assert.equal(v.scrollTop,atPause);
}));
test('modified wheel gestures are left to the platform and reduced scroll stays direct',()=>{
  media(()=>{const v=viewport(),s=createInertialScroll(v);assert.equal(v.emit('wheel',{deltaY:100,ctrlKey:true}).prevented,undefined);assert.equal(s.moving,false);});
  media(()=>{const v=viewport(),s=createInertialScroll(v);v.emit('wheel',{deltaY:100});assert.equal(v.scrollTop,500);assert.equal(s.moving,false);},true);
});
test('ignored wheel gestures never start an interaction handoff or dismiss hover',()=>media(()=>{
  let handoffs=0;const v=viewport(),s=createInertialScroll(v,{onStart(){handoffs++;}});
  v.emit('wheel',{deltaY:100,ctrlKey:true});v.emit('wheel',{deltaY:5,deltaX:100});
  v.scrollHeight=v.clientHeight;v.emit('wheel',{deltaY:100});
  assert.equal(handoffs,0);assert.equal(s.moving,false);
}));
