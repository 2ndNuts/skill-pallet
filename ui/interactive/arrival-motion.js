import {MOTION} from './motion-tokens.js';
export const ARRIVAL=MOTION.arrival;

export function contactIsCurrent(elapsed,index,visible=true,hidden=false){
  const late=elapsed-index*ARRIVAL.stagger-ARRIVAL.contact;
  return visible&&!hidden&&late>=0&&late<=34;
}

export function arrivalPose(elapsed,index){
  const t=elapsed-index*ARRIVAL.stagger;
  if(t<0)return{x:ARRIVAL.offsetX,y:ARRIVAL.offsetY,height:24,tilt:-.045,opacity:0,landed:false,done:false};
  if(t<ARRIVAL.contact){
    const p=t/ARRIVAL.contact,drift=(1-p)**3;
    return{x:ARRIVAL.offsetX*drift,y:ARRIVAL.offsetY*drift,height:24*(1-p*p),tilt:-.045*(1-p),opacity:Math.min(1,t/32),landed:false,done:false};
  }
  const p=Math.min(1,(t-ARRIVAL.contact)/(ARRIVAL.duration-ARRIVAL.contact));
  return{x:0,y:0,height:1.8*Math.sin(p*Math.PI)*Math.pow(1-p,2),tilt:0,opacity:1,landed:true,done:p===1};
}

export function arrivalPlan(items,height,scroll=0){
  return items.filter(item=>item.y+item.size>scroll&&item.y<scroll+height).slice(0,16)
    .sort((a,b)=>((b.x??0)+b.y)-((a.x??0)+a.y)||b.y-a.y||(b.x??0)-(a.x??0))
    .map((item,index)=>({key:item.key,index,contact:index*ARRIVAL.stagger+ARRIVAL.contact}));
}

// Native state is also published for timers, insertion replies and preferences.
// Only a new presentation sequence requests an arrival; repeated snapshots do not.
export function createArrivalReplay({sequence=0,playArrival=true}={}){
  let latest=sequence,pending=playArrival;
  return{
    observe(sequence){
      if(!Number.isSafeInteger(sequence)||sequence<=latest)return false;
      latest=sequence;pending=true;return true;
    },
    take(canPlay=true){if(!pending||!canPlay)return false;pending=false;return true;},
    cancel(){pending=false;}
  };
}
