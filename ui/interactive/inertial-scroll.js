import {MOTION} from './motion-tokens.js';
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
// Exponential decay is frame-rate independent; native trackpad momentum is not amplified.
export function nextScroll(current,target,dt,tau){
  if(Math.abs(target-current)<.2)return target;
  return current+(target-current)*(1-Math.exp(-dt/tau));
}
export function createInertialScroll(viewport,{onStart=()=>{},onSettle=()=>{},getScale=()=>1,shouldHandleWheel=()=>true}={}){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let target=viewport.scrollTop,position=target,written=target,active=false,tau=MOTION.scroll.mouseTau,velocity=0;
  const max=()=>Math.max(0,viewport.scrollHeight-viewport.clientHeight);
  function stop(){const wasActive=active;active=false;position=target=written=viewport.scrollTop;velocity=0;viewport.dataset.scrollState='idle';if(wasActive)onSettle();}
  function reset(){stop();target=written=viewport.scrollTop;}
  viewport.addEventListener('wheel',event=>{
    if(event.defaultPrevented||!shouldHandleWheel(event)||event.ctrlKey||event.metaKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||!max())return;
    const unit=event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1;
    const delta=event.deltaY*unit/Math.max(.25,getScale());if(!delta)return;
    event.preventDefault();
    if(!active){
      // Keep subpixel intent across tiny wheel gestures when WebKit rounded our
      // last write. External scrolls and explicit resets still reseed it.
      if(Math.abs(viewport.scrollTop-written)>.8)position=target=viewport.scrollTop;
      active=true;onStart();
    }
    tau=event.deltaMode===0&&Math.abs(event.deltaY)<50?MOTION.scroll.trackpadTau:MOTION.scroll.mouseTau;
    target=clamp(target+clamp(delta,-viewport.clientHeight*.9,viewport.clientHeight*.9),0,max());
    if(reduced.matches){viewport.scrollTop=target;written=viewport.scrollTop;stop();}
    else viewport.dataset.scrollState='coasting';
  },{passive:false});
  viewport.addEventListener('scroll',()=>{if(Math.abs(viewport.scrollTop-written)>.8){stop();}},{passive:true});
  viewport.addEventListener('pointerdown',stop,{capture:true});viewport.addEventListener('keydown',stop,{capture:true});
  return{
    tick(dt){
      if(!Number.isFinite(dt)||dt<0||dt>MOTION.frameGap){stop();return;}
      dt=Math.min(40,dt);
      if(!active){velocity*=Math.exp(-dt/28);if(Math.abs(velocity)<1)velocity=0;return;}
      target=clamp(target,0,max());const old=position;position=nextScroll(position,target,dt,tau);
      viewport.scrollTop=position;written=viewport.scrollTop;velocity=dt>0?(position-old)*1000/dt:0;
      // Keep the integration position separate from a webview's rounded scrollTop,
      // so small movements still accumulate at high refresh rates.
      if(Math.abs(target-position)<.3){position=target;viewport.scrollTop=target;written=viewport.scrollTop;active=false;viewport.dataset.scrollState='idle';onSettle();}
    },reset,stop,get moving(){return active;},get velocity(){return velocity;}
  };
}
