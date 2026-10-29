import {MOTION,advanceMotion} from './motion-tokens.js';

// Visual contact is independent of the insertion promise. A fast click cannot
// disappear between animation frames, and never delays the actual invocation.
export function createChipPress(){
  const states=new Map();
  function state(id){
    if(!states.has(id))states.set(id,{x:0,v:0,held:false,pending:false,until:-Infinity,released:-Infinity,point:{x:0,y:0}});
    return states.get(id);
  }
  return{
    down(id,now,point={x:0,y:0}){
      const s=state(id);s.held=true;s.until=now+MOTION.press.minHold;s.point={...point};
    },
    up(id,now,{cancelled=false}={}){
      const s=states.get(id);if(!s)return;
      if(cancelled)s.until=now;
      if(s.held){s.held=false;s.released=now;}
    },
    activate(id,now){
      const s=state(id);
      // Pointer/keyboard release already owns its pulse. Accessibility clicks
      // with no preceding down/up receive the same visible contact.
      if(!s.held&&now-s.released>32)s.until=now+MOTION.press.minHold;
    },
    setPending(id,value){const s=states.get(id)||(value?state(id):null);if(s)s.pending=!!value;},
    releaseAll(now){for(const id of states.keys())this.up(id,now);},
    reset(){states.clear();},
    retain(keys){for(const id of states.keys())if(!keys.has(id))states.delete(id);},
    sample(id,now,elapsed,reduced=false){
      const s=state(id),target=s.held||s.pending||now<s.until?1:0;
      let moving=false;
      if(reduced){s.x=target;s.v=0;}
      else moving=advanceMotion(s,target,elapsed,target>s.x?MOTION.press:MOTION.release);
      return{amount:s.x,held:s.held,point:s.point,moving};
    }
  };
}

// Pressing seats the rigid dish on its support. It removes hover clearance
// instead of requesting a downward move that the tray collision clamps away.
export function chipContactHeight({base,extent,lift,amount,reduced=false}){
  if(reduced)return Math.max(base,extent+.35);
  const raised=Math.max(base+lift,extent+.35),seated=extent+.35;
  return raised+(seated-raised)*Math.max(0,Math.min(1,amount));
}
