import {createWheelStroke} from './wheel-stroke.js';
export const GENRE_SWIPE=Object.freeze({intent:4,dominance:1.6,distance:12,flingDistance:6,flingSpeed:320,quiet:180,stale:250,fingerLease:2000});

// The Mac feeds phase and delta atomically on one channel. DOM wheel remains
// responsible for vertical scrolling; a browser estimates fresh strokes.
export function createGenreSwipe(viewport,{
  onSwitch=()=>false,onStart=()=>{},onEnd=()=>{},getScale=()=>1,native=false,
  now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout
}={}){
  let axis=null,totalX=0,travelX=0,travelY=0,lastAt=-Infinity,fired=false,sealed=false,started=false,timer=null,disposed=false;
  let nativeSequence=-1,nativeSample=-1,nativeFiredSequence=-2,nativeMode=false,nativeFinger=false,nativeActivity=-Infinity;
  const stroke=createWheelStroke();
  function finish(){
    if(timer!==null)clearTimer(timer);timer=null;
    const notify=started;
    axis=null;totalX=travelX=travelY=0;lastAt=-Infinity;fired=sealed=started=false;nativeMode=nativeFinger=false;stroke.reset();
    viewport.dataset.genreSwipe='idle';if(notify)onEnd();
  }
  function arm(){
    if(timer!==null)clearTimer(timer);
    timer=setTimer(()=>{
      timer=null;
      if(nativeFinger&&now()-nativeActivity<GENRE_SWIPE.fingerLease){arm();return;}
      finish();
    },GENRE_SWIPE.quiet);
  }
  function cancel(){
    nativeFinger=false;
    if(nativeMode)nativeFiredSequence=nativeSequence;
    if(axis===null)return;
    fired=sealed=true;totalX=0;arm();
  }
  function sample(input,preventDefault=()=>{}){
    let {x,y,at}=input;
    if(at<lastAt)return;
    if(!nativeFinger&&at-lastAt>=GENRE_SWIPE.quiet)finish();
    if(axis==='horizontal'&&fired&&!sealed&&!nativeMode){
      const next=stroke.sample(x,y,at);if(next){finish();x=next.carryX;}
    }
    const elapsed=Number.isFinite(lastAt)?Math.max(1,at-lastAt):1000/60,velocity=x*1000/elapsed;
    lastAt=at;arm();totalX+=x;travelX+=Math.abs(x);travelY+=Math.abs(y);
    if(axis===null){
      if(Math.abs(y)>=Math.abs(x)&&travelY>=GENRE_SWIPE.intent)axis='vertical';
      else if(travelX>=GENRE_SWIPE.intent&&travelX>=travelY*GENRE_SWIPE.dominance){
        axis='horizontal';started=true;viewport.dataset.genreSwipe='tracking';onStart();
      }else if(Math.max(travelX,travelY)>=GENRE_SWIPE.intent)axis='vertical';
    }
    if(axis==='horizontal'){
      preventDefault();
      const fling=Math.abs(totalX)>=GENRE_SWIPE.flingDistance&&Math.abs(velocity)>=GENRE_SWIPE.flingSpeed&&Math.sign(velocity)===Math.sign(totalX);
      if(!fired&&(Math.abs(totalX)>=GENRE_SWIPE.distance||fling)){
        fired=true;stroke.latch(Math.sign(totalX),at);viewport.dataset.genreSwipe='settling';onSwitch(Math.sign(totalX));
      }
    }else if(axis===null&&Math.abs(x)>Math.abs(y))preventDefault();
  }
  function wheel(event){
    if(disposed)return;
    if(event.ctrlKey||event.metaKey||event.buttons){cancel();return;}
    if(!Number.isFinite(event.deltaX)||!Number.isFinite(event.deltaY))return;
    if(native){
      if(axis==='horizontal'||Math.abs(event.deltaX)>Math.abs(event.deltaY))event.preventDefault();
      return;
    }
    const clock=now(),at=Number.isFinite(event.timeStamp)&&event.timeStamp>0?event.timeStamp:clock;
    if(clock-at>GENRE_SWIPE.stale||at-clock>1000){cancel();return;}
    const unit=event.deltaMode===1?16:event.deltaMode===2?viewport.clientWidth:1,scale=Math.max(.25,Number(getScale())||1);
    const input={x:event.deltaX*unit/scale,y:event.deltaY*unit/scale,at};if(!input.x&&!input.y)return;
    sample(input,()=>event.preventDefault());
  }
  viewport.dataset.genreSwipe='idle';
  viewport.addEventListener('wheel',wheel,{capture:true,passive:false});
  viewport.addEventListener('pointerdown',cancel,{capture:true});viewport.addEventListener('keydown',cancel,{capture:true});
  return{
    cancel,get active(){return axis==='horizontal';},
    nativeWheel(packet){
      if(disposed||!native||!packet||!Number.isSafeInteger(packet.sample)||packet.sample<=nativeSample||!Number.isSafeInteger(packet.sequence)||![packet.at,packet.deltaX,packet.deltaY].every(Number.isFinite))return false;
      nativeSample=packet.sample;
      if(packet.modified||packet.buttons){cancel();return false;}
      const phase=packet.kind!=='legacy';
      if(packet.kind==='begin'){
        if(packet.sequence<=nativeSequence)return false;
        finish();nativeSequence=packet.sequence;nativeMode=nativeFinger=true;nativeActivity=now();
      }else if(phase){
        if(packet.sequence!==nativeSequence)return false;
        nativeMode=true;nativeActivity=now();
      }else{
        if(nativeMode)finish();nativeMode=nativeFinger=false;
      }
      const ended=packet.kind==='end';
      if(phase&&nativeFiredSequence===packet.sequence){
        if(ended)nativeFinger=false;
        if(started)arm();return true;
      }
      const scale=Math.max(.25,Number(getScale())||1),unit=packet.deltaMode===1?16:1;
      const input={x:packet.deltaX*unit/scale,y:packet.deltaY*unit/scale,at:packet.at};
      if(input.x||input.y)sample(input);
      if(phase&&fired)nativeFiredSequence=packet.sequence;
      if(ended){nativeFinger=false;arm();}
      return true;
    },
    dispose(){disposed=true;finish();viewport.removeEventListener('wheel',wheel,true);viewport.removeEventListener('pointerdown',cancel,true);viewport.removeEventListener('keydown',cancel,true);}
  };
}
