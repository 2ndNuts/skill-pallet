const HORIZONTAL=1.6;

// WheelEvent has no standard finger/momentum phase. A fresh acceleration after
// a lull is the browser fallback; the Mac app supplies exact gesture epochs.
export function createWheelStroke(){
  let direction=0,lastAt=null,lowCount=0,reference=Infinity,referenceDelta=0,afterGap=false,rearmed=false,candidate=0,reverse=0;
  return{
    latch(next,at){direction=next;lastAt=at;lowCount=0;reference=Infinity;referenceDelta=0;afterGap=rearmed=false;candidate=reverse=0;},
    sample(x,y,at){
      const gap=lastAt===null?0:at-lastAt;lastAt=at;
      if(gap<=0||!Number.isFinite(gap))return null;
      const horizontal=Math.abs(x)>=Math.abs(y)*HORIZONTAL,velocity=x*1000/gap,speed=Math.abs(velocity);
      if(horizontal&&Math.sign(x)===-direction){
        reverse+=Math.abs(x);candidate=0;
        return reverse>=12?{carryX:-direction*reverse}:null;
      }
      reverse=0;
      if(!horizontal||Math.sign(x)!==direction)return null;
      if(gap>=50&&Math.abs(x)>=4){rearmed=afterGap=true;reference=speed;referenceDelta=Math.abs(x);candidate=x;return null;}
      if(speed<150){lowCount++;reference=Math.min(reference,speed);candidate=0;afterGap=false;if(lowCount>=2)rearmed=true;}
      else if(rearmed){
        if(speed>=320&&speed>=Math.max(1,reference)*2&&(!afterGap||Math.abs(x)>=referenceDelta*.9)){
          candidate+=x;if(Math.abs(candidate)>=12)return{carryX:candidate};
        }
        else if(speed<Math.max(150,reference*1.5))candidate=0;
      }else lowCount=0;
      return null;
    },
    reset(){direction=0;lastAt=null;lowCount=0;reference=Infinity;referenceDelta=0;afterGap=rearmed=false;candidate=reverse=0;}
  };
}
