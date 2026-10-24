import test from 'node:test';
import assert from 'node:assert/strict';
import {CHIP_PHYSICS,createChipPhysics,chipContact} from './window-inertia.js';
const epoch=1_800_000_000_000,step=1000/60,size=102.5;
const tiles=(rows=4)=>Array.from({length:rows*4},(_,i)=>({key:'skill-'+i,x:i%4*(size+8),y:Math.floor(i/4)*(size+8),size,stack:i===4}));
function setup(items=tiles(),width=434,height=434){
  const engine=createChipPhysics();engine.layout(items,width,height);let sample=0;
  const send=(vx,vy,now,dragging=true,sequence=1)=>engine.receive({vx,vy,issuedAt:epoch+now,sequence,sample:++sample,dragging},now,epoch+now);
  return{engine,send};
}
function trace(engine,send,duration=1100){
  const contacts=[];let diversity=0,overlap=0,offset=0,last;
  for(let t=0;t<duration;t+=step){
    const vx=t<300?600*Math.sin(t/300*Math.PI/2):t<650?600:t<1000?-500:0;
    send(vx,100*Math.sin(t/120),t,t<1000);last=engine.tick(step,t);contacts.push(...last.contacts);
    const bodies=engine.bodies;
    diversity=Math.max(diversity,Math.max(...bodies.map(b=>b.x))-Math.min(...bodies.map(b=>b.x)));
    for(const b of bodies)offset=Math.max(offset,Math.abs(b.x),Math.abs(b.y));
    for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)overlap=Math.max(overlap,chipContact(bodies[i],bodies[j])?.depth??0);
  }
  return{contacts,diversity,overlap,offset,last};
}
test('a stationary tray has exact rest poses and no contact events',()=>{
  const {engine}=setup();
  for(let t=0;t<1000;t+=step)assert.equal(engine.tick(step,t).contacts.length,0);
  assert.ok(engine.bodies.every(b=>b.x===0&&b.y===0&&b.tiltX===0&&b.tiltZ===0));
});
test('separate chips slide, collide and transfer impulses through the grid',()=>{
  const {engine,send}=setup(),result=trace(engine,send);
  assert.ok(result.diversity>8,'the grid must never move as one rigid sheet');
  assert.ok(result.contacts.some(c=>c.b),'actual chip-to-chip contact is required');
  assert.ok(result.contacts.some(c=>c.wall),'tray walls also constrain loose chips');
  assert.ok(result.contacts.every(c=>c.speed>=CHIP_PHYSICS.minImpact));
  assert.ok(result.overlap<.08,'rounded dishes must not tunnel through their neighbours');
  assert.ok(result.offset<21);
  assert.ok(new Set(engine.bodies.map(b=>b.friction)).size>1);
  assert.ok(engine.pose('skill-4').mass>engine.pose('skill-0').mass);
});
test('movement through empty space produces no collision, regardless of distance',()=>{
  const {engine,send}=setup([{key:'alone',x:400,y:400,size:100}],1000,1000);let contacts=0,travel=0;
  for(let t=0;t<500;t+=step){send(450,100,t);contacts+=engine.tick(step,t).contacts.length;travel=Math.max(travel,Math.hypot(engine.pose('alone').x,engine.pose('alone').y));}
  assert.ok(travel>2);assert.equal(contacts,0);
});
test('rounded corners do not make the false contacts of rectangular hit boxes',()=>{
  const a={baseX:0,baseY:0,x:0,y:0,half:50,radius:14},b={...a,baseX:99,baseY:99};
  assert.equal(chipContact(a,b),null);
  const corner=chipContact(a,{...b,baseX:90,baseY:80});assert.ok(corner&&corner.nx>0&&corner.ny>0);
  const side=chipContact(a,{...b,baseX:99,baseY:0});assert.equal(side.depth,1);assert.equal(side.ny,0);
});
test('a closing pair rebounds once and resting contact does not chatter',()=>{
  const {engine,send}=setup([{key:'a',x:150,y:150,size:100},{key:'b',x:250,y:150,size:100}],600,600);
  send(10,0,0);engine.tick(0,0);const a=engine.pose('a'),b=engine.pose('b');a.vx=80;b.vx=-80;
  const hits=engine.tick(20,20).contacts.filter(c=>c.b);
  assert.equal(hits.length,1);assert.ok(hits[0].speed>140);assert.ok(a.vx<b.vx);
  assert.ok((chipContact(a,b)?.depth??0)<.02);
});
test('chips return separately to their exact slots after release',()=>{
  const {engine,send}=setup();trace(engine,send);
  send(0,0,1120,false);let state;
  for(let t=1120;t<3000;t+=step)state=engine.tick(step,t);
  assert.equal(state.moving,false);assert.equal(state.dragging,false);assert.deepEqual(state.contacts,[]);
  assert.ok(engine.bodies.every(b=>b.x===0&&b.y===0&&b.vx===0&&b.vy===0&&b.tiltX===0&&b.tiltZ===0));
});
test('duplicate, reordered, stale and invalid packets cannot replay a force',()=>{
  const {engine}=setup(),p={vx:700,vy:0,issuedAt:epoch,sequence:1,sample:1,dragging:true};
  assert.ok(engine.receive(p,0,epoch));assert.equal(engine.receive(p,1,epoch+1),false);
  assert.equal(engine.receive({...p,sequence:0,sample:2},2,epoch+2),false);
  assert.equal(engine.receive({...p,sample:2,vx:NaN},2,epoch+2),false);
  assert.equal(engine.receive({...p,sample:3},240,epoch+240),false);
  assert.equal(engine.tick(step,240).moving,false);
});
test('reduced motion, hidden/reset and a suspended frame discard motion and contacts',()=>{
  const {engine,send}=setup();trace(engine,send,300);
  assert.equal(engine.tick(step,310,true).moving,false);
  trace(engine,send,300);engine.reset();assert.equal(engine.tick(step,400).moving,false);
  send(700,0,500);assert.equal(engine.tick(2000,2500).moving,false);
  assert.ok(engine.bodies.every(b=>b.x===0&&b.y===0));
});
test('fixed substeps yield the same positions and contacts at 60Hz and 120Hz',()=>{
  const run=hz=>{
    const {engine,send}=setup();let hits=0;
    for(let i=0;i<Math.round(hz*.4);i++){const t=i*1000/hz;send(600,0,t);hits+=engine.tick(1000/hz,t).contacts.length;}
    return{poses:engine.bodies.map(b=>[b.x,b.y]),hits};
  };
  const a=run(60),b=run(120);
  for(let i=0;i<a.poses.length;i++)assert.ok(Math.hypot(a.poses[i][0]-b.poses[i][0],a.poses[i][1]-b.poses[i][1])<.03);
  assert.ok(Math.abs(a.hits-b.hits)<=2);
});
test('offscreen rows stay at rest and cannot generate audible contacts',()=>{
  const {engine,send}=setup(tiles(30));engine.setView(1105,434);
  const contacts=[];
  for(let t=0;t<600;t+=step){send(700,100,t);contacts.push(...engine.tick(step,t).contacts);}
  assert.equal(engine.pose('skill-0').x,0);assert.equal(engine.pose('skill-119').x,0);
  assert.ok(contacts.length>0);assert.ok(contacts.every(c=>c.y>=1105&&c.y<=1539));
  engine.layout(tiles(1),434,434);assert.ok(engine.bodies.every(b=>b.x===0&&b.y===0));
});
