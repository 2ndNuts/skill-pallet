import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenreSwipe,GENRE_SWIPE} from './genre-swipe.js';
import {createInertialScroll} from './inertial-scroll.js';

function fixture({initial=0,overflow=true,scale=1,reduced=false,native=false}={}){
  let clock=1000,sequence=0,nativeSample=0,nativeSequence=0,genre=initial,busy=false,starts=0,ends=0,scroll;
  const timers=new Map(),handlers=new Map(),steps=[],attempts=[];
  const viewport={scrollTop:400,clientWidth:434,clientHeight:434,scrollHeight:overflow?2600:434,dataset:{},
    addEventListener(name,fn,options){const listeners=handlers.get(name)||[];listeners.push({fn,capture:options===true||!!options?.capture});handlers.set(name,listeners);},
    removeEventListener(name,fn){handlers.set(name,(handlers.get(name)||[]).filter(item=>item.fn!==fn));}
  };
  function advance(ms){clock+=ms;for(const[id,item]of [...timers])if(item.at<=clock){timers.delete(id);item.fn();}}
  function emit(name,values={}){
    const event={deltaX:0,deltaY:0,deltaMode:0,defaultPrevented:false,cancelable:true,timeStamp:clock,
      preventDefault(){if(this.cancelable)this.defaultPrevented=true;},...values};
    for(const item of [...(handlers.get(name)||[])].sort((a,b)=>Number(b.capture)-Number(a.capture)))item.fn(event);
    return event;
  }
  const swipe=createGenreSwipe(viewport,{native,getScale:()=>scale,now:()=>clock,
    setTimer:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:clock+delay});return id;},clearTimer:id=>timers.delete(id),
    onStart(){starts++;scroll?.stop();},onEnd(){ends++;},
    onSwitch(direction){attempts.push(direction);if(busy)return false;const next=Math.max(0,Math.min(7,genre+direction));if(next===genre)return false;genre=next;steps.push(genre);return true;}
  });
  const original=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:reduced});
  try{scroll=createInertialScroll(viewport,{getScale:()=>scale,shouldHandleWheel:()=>!swipe.active});}
  finally{globalThis.matchMedia=original;}
  return{viewport,swipe,scroll,steps,attempts,advance,emit,
    wheel(x,y=0,options={}){advance(16);return emit('wheel',{deltaX:x,deltaY:y,...options});},
    nativeBegin(next){nativeSequence=next;return swipe.nativeWheel({sample:++nativeSample,sequence:next,kind:'begin',at:clock+100000000,deltaX:0,deltaY:0,deltaMode:0});},
    nativeEnd(){return swipe.nativeWheel({sample:++nativeSample,sequence:nativeSequence,kind:'end',at:clock+100000000,deltaX:0,deltaY:0,deltaMode:0});},
    nativeWheel(x,y=0,kind='change',options={}){advance(16);return swipe.nativeWheel({sample:++nativeSample,sequence:nativeSequence,kind,at:clock+100000000,deltaX:x,deltaY:y,deltaMode:0,...options});},
    get clock(){return clock;},delay(ms){clock+=ms;},
    get genre(){return genre;},set busy(value){busy=value;},get starts(){return starts;},get ends(){return ends;},get timers(){return timers.size;}
  };
}

test('one horizontal flick switches one adjacent genre and consumes its entire momentum tail',()=>{
  const f=fixture();for(const x of [10,20,30,200,100,50,20,6,3,2,1,1])assert.equal(f.wheel(x).defaultPrevented,true);
  assert.deepEqual(f.steps,[1]);assert.equal(f.starts,1);assert.equal(f.viewport.scrollTop,400);
  f.wheel(0,90);f.scroll.tick(16);assert.equal(f.viewport.scrollTop,400,'a vertical tail must not enter the vertical scroller');
  f.advance(GENRE_SWIPE.quiet+1);assert.equal(f.swipe.active,false);assert.equal(f.ends,1);
  f.wheel(-60);assert.deepEqual(f.steps,[1,0]);f.swipe.dispose();
});

test('same-direction strokes can repeat after a short pause without waiting for the momentum timeout',()=>{
  const f=fixture();f.wheel(12);f.advance(44);f.wheel(6);f.wheel(6);f.advance(44);f.wheel(6);f.wheel(6);
  assert.deepEqual(f.steps,[1,2,3]);assert.equal(f.starts,3);f.swipe.dispose();
});

test('a fresh acceleration after a slow tail opens one new stroke, while the remaining slow tail stays quiet',()=>{
  const f=fixture();for(const x of [12,20,30,18,10,4,2,1,1,1,1])f.wheel(x);
  assert.deepEqual(f.steps,[1]);f.wheel(6);f.wheel(7);assert.deepEqual(f.steps,[1,2]);
  for(const x of [5,3,2,1,1,1,1,1,1,1])f.wheel(x);assert.deepEqual(f.steps,[1,2]);f.swipe.dispose();
});

test('a deliberate reversal is a new stroke while a few opposite pixels are only release jitter',()=>{
  const f=fixture({initial:3});f.wheel(12);f.wheel(-3);f.wheel(-3);assert.deepEqual(f.steps,[4]);
  f.wheel(-6);assert.deepEqual(f.steps,[4,3]);f.swipe.dispose();
});

test('native finger epochs accept consecutive flicks even when the prior momentum is still fast',()=>{
  const f=fixture({native:true});
  for(let sequence=1;sequence<=3;sequence++){
    f.nativeBegin(sequence);f.nativeWheel(6);f.nativeEnd();
    for(const x of [20,10,2,1,8,8])f.nativeWheel(x);
    assert.equal(f.steps.length,sequence);
  }
  assert.deepEqual(f.steps,[1,2,3]);f.swipe.dispose();
});

test('native phase and movement share one channel regardless of DOM delivery order or clock origin',()=>{
  const f=fixture({native:true});f.wheel(30);assert.deepEqual(f.steps,[]);
  f.nativeBegin(1);f.nativeWheel(6);f.wheel(6);f.nativeEnd();assert.deepEqual(f.steps,[1]);
  f.wheel(80);f.nativeBegin(2);f.nativeWheel(6);f.wheel(6);assert.deepEqual(f.steps,[1,2]);
  assert.equal(f.swipe.nativeWheel({sample:1,sequence:1,kind:'change',at:1,deltaX:100,deltaY:0}),false);
  f.swipe.dispose();
});

test('a fresh native vertical gesture after a horizontal stroke returns input to the vertical scroller',()=>{
  const f=fixture({native:true});f.nativeBegin(1);f.nativeWheel(12);f.nativeEnd();
  f.nativeBegin(2);f.nativeWheel(0,80);f.wheel(0,80);f.scroll.tick(16);
  assert.ok(f.viewport.scrollTop>400);assert.deepEqual(f.steps,[1]);f.swipe.dispose();
});

test('native cleanup releases a finger that was hidden before its axis was known',()=>{
  const f=fixture({native:true});f.nativeBegin(1);f.swipe.cancel();f.advance(GENRE_SWIPE.fingerLease+100);
  f.nativeBegin(2);f.nativeWheel(6);assert.deepEqual(f.steps,[1]);f.swipe.dispose();assert.equal(f.timers,0);
});

test('native wheels without finger phases retain navigation without duplicating their DOM events',()=>{
  const f=fixture({native:true});f.nativeWheel(40,0,'legacy');f.wheel(40);assert.deepEqual(f.steps,[1]);
  f.advance(200);f.nativeWheel(40,0,'legacy');f.wheel(40);assert.deepEqual(f.steps,[1,2]);f.swipe.dispose();
});

test('a coalesced decaying tail after a long event gap cannot immediately trigger another page',()=>{
  const f=fixture();f.wheel(12);f.advance(70);f.wheel(80);
  for(const x of [40,20,10,4,2,1,1,1])f.wheel(x);
  assert.deepEqual(f.steps,[1]);f.swipe.dispose();
});

test('queued delivery uses event generation times and cannot make a momentum tail a fresh stroke',()=>{
  const f=fixture();f.wheel(12);const generated=f.clock+16;f.delay(200);
  f.emit('wheel',{deltaX:100,timeStamp:generated});assert.deepEqual(f.steps,[1]);f.swipe.dispose();
});

test('vertical gestures keep their inertia and cannot become genre flicks midway through a burst',()=>{
  const f=fixture();
  assert.equal(f.wheel(1,80).defaultPrevented,true);f.scroll.tick(16);assert.ok(f.viewport.scrollTop>400);
  f.wheel(200,2);f.wheel(-140,0);f.scroll.tick(16);
  assert.deepEqual(f.steps,[]);assert.equal(f.starts,0);f.swipe.dispose();
});

test('diagonal gestures favor scrolling, and small horizontal jitter is not navigation',()=>{
  const f=fixture();f.wheel(10,8);f.wheel(120,1);assert.deepEqual(f.steps,[]);
  f.advance(220);for(let i=0;i<12;i++)f.wheel(i%2?2:-2,0);
  assert.deepEqual(f.steps,[]);f.swipe.dispose();
});

test('a small initial vertical twitch does not prevent a deliberate horizontal flick',()=>{
  const f=fixture();f.wheel(0,.3);f.wheel(20,1);f.wheel(40,1);
  assert.deepEqual(f.steps,[1]);assert.equal(f.starts,1);f.swipe.dispose();
});

test('horizontal switching works in short genres without vertical overflow',()=>{
  const f=fixture({overflow:false});f.wheel(70);assert.equal(f.genre,1);f.swipe.dispose();
});

test('a short deliberate flick starts the tray on its first sample without a quiet-time wait',()=>{
  const f=fixture();assert.equal(f.wheel(12,1).defaultPrevented,true);
  assert.deepEqual(f.steps,[1]);assert.equal(f.starts,1);assert.equal(f.swipe.active,true);
  f.wheel(200,0);assert.deepEqual(f.steps,[1],'momentum must not turn the lower threshold into multiple pages');f.swipe.dispose();
});

test('a short fast flick uses velocity while a slow small movement waits for deliberate travel',()=>{
  const fast=fixture();fast.wheel(6,.2);assert.deepEqual(fast.steps,[1]);fast.swipe.dispose();
  const slow=fixture();slow.wheel(2,.1);
  for(let i=0;i<4;i++){slow.advance(44);slow.wheel(2,.1);assert.deepEqual(slow.steps,[]);}
  slow.advance(44);slow.wheel(2,.1);assert.deepEqual(slow.steps,[1]);slow.swipe.dispose();
});

test('a very small vertical lead does not steal the following horizontal flick',()=>{
  const f=fixture();f.wheel(1,2.5);f.wheel(6,1);assert.deepEqual(f.steps,[1]);f.swipe.dispose();
});

test('light trackpad samples cross the threshold earlier while signed jitter and vertical intent remain safe',()=>{
  const f=fixture();f.wheel(4,.5);f.wheel(6,.5);f.wheel(10,1);assert.deepEqual(f.steps,[1]);f.swipe.dispose();
  const jitter=fixture();for(let i=0;i<18;i++)jitter.wheel(i%2?3:-3,.1);assert.deepEqual(jitter.steps,[]);jitter.swipe.dispose();
  const vertical=fixture();vertical.wheel(2,5);vertical.wheel(25,1);assert.deepEqual(vertical.steps,[]);vertical.swipe.dispose();
});

test('a tiny horizontal lead with a little vertical drift remains eligible for the first flick',()=>{
  const f=fixture();f.wheel(3,1);f.wheel(7,1);f.wheel(10,1);
  assert.deepEqual(f.steps,[1]);assert.equal(f.starts,1);f.swipe.dispose();
});

test('genre boundaries and busy requests consume the gesture without wrapping or deferred switches',()=>{
  const edge=fixture({initial:7});edge.wheel(70);edge.wheel(200);assert.equal(edge.genre,7);assert.deepEqual(edge.attempts,[1]);edge.swipe.dispose();
  const f=fixture();f.busy=true;f.wheel(70);f.busy=false;f.wheel(150);assert.deepEqual(f.steps,[]);
  f.advance(220);f.wheel(70);assert.deepEqual(f.steps,[1]);f.swipe.dispose();
});

test('zoom, modified gestures, held clicks and stale queued samples do not navigate',()=>{
  const f=fixture();
  for(const options of [{ctrlKey:true},{metaKey:true},{buttons:1},{timeStamp:1}])assert.equal(f.wheel(100,0,options).defaultPrevented,false);
  assert.deepEqual(f.steps,[]);assert.equal(f.starts,0);f.swipe.dispose();
});

test('line/page wheel units and scaled windows use the same logical flick distance',()=>{
  for(const options of [{x:4,deltaMode:1},{x:.2,deltaMode:2},{x:30,scale:.5}]){
    const f=fixture({scale:options.scale||1});f.wheel(options.x,0,{deltaMode:options.deltaMode||0});
    assert.deepEqual(f.steps,[1]);f.swipe.dispose();
  }
});

test('cancelling a gesture seals its tail; disposal removes listeners and pending timers',()=>{
  const f=fixture();f.wheel(4);f.emit('pointerdown');f.wheel(100);assert.deepEqual(f.steps,[]);
  f.advance(220);f.wheel(60);assert.deepEqual(f.steps,[1]);
  f.swipe.dispose();assert.equal(f.timers,0);assert.equal(f.swipe.active,false);
  f.wheel(100);assert.deepEqual(f.steps,[1]);
});

test('uncancellable horizontal momentum never leaks into vertical inertia, including reduced motion',()=>{
  const f=fixture({reduced:true});f.wheel(60);f.wheel(0,80,{cancelable:false});
  assert.equal(f.viewport.scrollTop,400);assert.deepEqual(f.steps,[1]);f.swipe.dispose();
});
