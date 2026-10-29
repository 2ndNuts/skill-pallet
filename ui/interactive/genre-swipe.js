export const GENRE_SWIPE=Object.freeze({intent:8,dominance:1.6,distance:56,quiet:180,stale:250});

// A wheel burst owns one axis and can request at most one adjacent genre.
// Its latch survives layout changes and momentum until the input falls quiet.
export function createGenreSwipe(viewport,{
  onSwitch=()=>false,onStart=()=>{},onEnd=()=>{},getScale=()=>1,
  now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout
}={}){
  let axis=null,totalX=0,travelX=0,travelY=0,lastAt=-Infinity,fired=false,started=false,timer=null,disposed=false;
  function finish(){
    if(timer!==null)clearTimer(timer);timer=null;
    const notify=started;
    axis=null;totalX=travelX=travelY=0;lastAt=-Infinity;fired=started=false;
    viewport.dataset.genreSwipe='idle';
    if(notify)onEnd();
  }
  function arm(){
    if(timer!==null)clearTimer(timer);
    timer=setTimer(finish,GENRE_SWIPE.quiet);
  }
  function cancel(){
    if(axis===null)return;
    // A pointer/keyboard interaction must not make a remaining tail a new flick.
    fired=true;totalX=0;lastAt=now();arm();
  }
  function wheel(event){
    if(disposed)return;
    if(event.ctrlKey||event.metaKey||event.buttons){cancel();return;}
    if(!Number.isFinite(event.deltaX)||!Number.isFinite(event.deltaY))return;
    const at=now();
    if(Number.isFinite(event.timeStamp)&&event.timeStamp>0&&at-event.timeStamp>GENRE_SWIPE.stale){cancel();return;}
    if(at-lastAt>=GENRE_SWIPE.quiet)finish();
    const unit=event.deltaMode===1?16:event.deltaMode===2?viewport.clientWidth:1;
    const scale=Math.max(.25,Number(getScale())||1),x=event.deltaX*unit/scale,y=event.deltaY*unit/scale;
    if(!x&&!y)return;
    lastAt=at;arm();
    totalX+=x;travelX+=Math.abs(x);travelY+=Math.abs(y);
    if(axis===null){
      if(Math.abs(y)>=Math.abs(x)&&Math.abs(y)>=2)axis='vertical';
      else if(travelX>=GENRE_SWIPE.intent&&travelX>=travelY*GENRE_SWIPE.dominance){
        axis='horizontal';started=true;viewport.dataset.genreSwipe='tracking';onStart();
      }else if(travelX+travelY>=GENRE_SWIPE.intent)axis='vertical';
    }
    if(axis==='horizontal'){
      event.preventDefault();
      if(!fired&&Math.abs(totalX)>=GENRE_SWIPE.distance){
        fired=true;viewport.dataset.genreSwipe='settling';onSwitch(Math.sign(totalX));
      }
    }else if(axis===null&&Math.abs(x)>Math.abs(y))event.preventDefault();
  }
  viewport.dataset.genreSwipe='idle';
  viewport.addEventListener('wheel',wheel,{capture:true,passive:false});
  viewport.addEventListener('pointerdown',cancel,{capture:true});
  viewport.addEventListener('keydown',cancel,{capture:true});
  return{
    cancel,get active(){return axis==='horizontal';},
    dispose(){disposed=true;finish();viewport.removeEventListener('wheel',wheel,true);viewport.removeEventListener('pointerdown',cancel,true);viewport.removeEventListener('keydown',cancel,true);}
  };
}
