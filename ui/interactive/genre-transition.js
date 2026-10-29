import {MOTION} from './motion-tokens.js';

// One rigid tray travels; its loose dishes keep their own contact physics.
export function trayPose(elapsed,width,direction){
  const t=Math.max(0,Math.min(1,elapsed/MOTION.genre.duration));
  const progress=1-(1-t)**3;
  return{progress,outgoing:-direction*width*progress||0,incoming:direction*width*(1-progress)||0,done:t===1};
}

export function createGenreTransition({initial='all',order=[],now=()=>performance.now(),
  reduced=()=>false,onStart=()=>{},onFrame=()=>{},onFinish=()=>{}}={}){
  let current=initial,flight=null,pending=null;
  function begin(to){
    if(to===current)return false;
    const from=current,direction=Math.sign(order.indexOf(to)-order.indexOf(from));
    if(!direction)return false;
    current=to;pending=null;
    flight={from,to,direction,start:0};
    onStart({...flight,instant:reduced()});
    flight.start=now();
    onFrame({...flight,elapsed:0,at:flight.start,instant:reduced()});
    if(reduced())finish(true);
    return true;
  }
  function finish(instant=false,cancelled=false){
    if(!flight)return;
    const ended=flight;flight=null;
    onFinish({...ended,instant,cancelled});
    const next=pending;pending=null;
    if(!cancelled&&next!==null&&next!==current)begin(next);
  }
  return{
    request(to){
      if(!order.includes(to))return false;
      if(flight){pending=to===current?null:to;return true;}
      return begin(to);
    },
    tick(at=now()){
      if(!flight)return;
      const elapsed=Math.max(0,at-flight.start),stale=elapsed>MOTION.frameGap+MOTION.genre.duration,instant=reduced()||stale;
      const done=elapsed>=MOTION.genre.duration-.001;
      onFrame({...flight,elapsed:instant||done?MOTION.genre.duration:elapsed,at,instant});
      if(instant||done)finish(instant);
    },
    cancel(){pending=null;if(flight)finish(true,true);},
    get active(){return flight!==null;},
    get target(){return pending??current;}
  };
}
