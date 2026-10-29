import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenreSwipe,GENRE_SWIPE} from './genre-swipe.js';
import {createInertialScroll} from './inertial-scroll.js';

function fixture({initial=0,overflow=true,scale=1,reduced=false}={}){
  let clock=1000,sequence=0,genre=initial,busy=false,starts=0,ends=0,scroll;
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
  const swipe=createGenreSwipe(viewport,{getScale:()=>scale,now:()=>clock,
    setTimer:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:clock+delay});return id;},clearTimer:id=>timers.delete(id),
    onStart(){starts++;scroll?.stop();},onEnd(){ends++;},
    onSwitch(direction){attempts.push(direction);if(busy)return false;const next=Math.max(0,Math.min(7,genre+direction));if(next===genre)return false;genre=next;steps.push(genre);return true;}
  });
  const original=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:reduced});
  try{scroll=createInertialScroll(viewport,{getScale:()=>scale,shouldHandleWheel:()=>!swipe.active});}
  finally{globalThis.matchMedia=original;}
  return{viewport,swipe,scroll,steps,attempts,advance,emit,
    wheel(x,y=0,options={}){advance(16);return emit('wheel',{deltaX:x,deltaY:y,...options});},
    get genre(){return genre;},set busy(value){busy=value;},get starts(){return starts;},get ends(){return ends;},get timers(){return timers.size;}
  };
}

test('one horizontal flick switches one adjacent genre and consumes its entire momentum tail',()=>{
  const f=fixture();for(const x of [10,20,30,200,100,-80])assert.equal(f.wheel(x).defaultPrevented,true);
  assert.deepEqual(f.steps,[1]);assert.equal(f.starts,1);assert.equal(f.viewport.scrollTop,400);
  f.wheel(0,90);f.scroll.tick(16);assert.equal(f.viewport.scrollTop,400,'a vertical tail must not enter the vertical scroller');
  f.advance(GENRE_SWIPE.quiet+1);assert.equal(f.swipe.active,false);assert.equal(f.ends,1);
  f.wheel(-60);assert.deepEqual(f.steps,[1,0]);f.swipe.dispose();
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
  const f=fixture();f.wheel(15);f.emit('pointerdown');f.wheel(100);assert.deepEqual(f.steps,[]);
  f.advance(220);f.wheel(60);assert.deepEqual(f.steps,[1]);
  f.swipe.dispose();assert.equal(f.timers,0);assert.equal(f.swipe.active,false);
  f.wheel(100);assert.deepEqual(f.steps,[1]);
});

test('uncancellable horizontal momentum never leaks into vertical inertia, including reduced motion',()=>{
  const f=fixture({reduced:true});f.wheel(60);f.wheel(0,80,{cancelable:false});
  assert.equal(f.viewport.scrollTop,400);assert.deepEqual(f.steps,[1]);f.swipe.dispose();
});
