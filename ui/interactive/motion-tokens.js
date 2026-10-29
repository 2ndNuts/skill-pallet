// cinetic:brand-supplied Skill Pallet's solid wooden chips and quick UI pacing.
// Named critical springs: touch is quick; the collection carries more weight.
export const MOTION=Object.freeze({
  hover:Object.freeze({frequency:38}),
  // A short tap still reaches contact; release is slower than the hard seat.
  press:Object.freeze({frequency:120,minHold:110,standOff:14.8,hoverLift:6.5}),
  release:Object.freeze({frequency:54}),
  layout:Object.freeze({frequency:26}),
  reveal:Object.freeze({frequency:34}),
  scroll:Object.freeze({mouseTau:56,trackpadTau:30}),
  genre:Object.freeze({duration:200}),
  arrival:Object.freeze({stagger:12,contact:180,duration:340,offsetX:56,offsetY:44}),
  hoverDwell:80,tooltipDwell:180,inkTravelFraction:.22,frameGap:150
});

export function advanceMotion(state,target,milliseconds,preset=MOTION.hover){
  if(!Number.isFinite(milliseconds)||milliseconds<0||milliseconds>MOTION.frameGap){state.x=target;state.v=0;return false;}
  const seconds=Math.min(40,milliseconds)/1000,w=preset.frequency,offset=state.x-target,b=state.v+w*offset,decay=Math.exp(-w*seconds);
  state.x=target+(offset+b*seconds)*decay;state.v=(state.v-w*b*seconds)*decay;
  if(Math.abs(state.x-target)<.0001&&Math.abs(state.v)<.002){state.x=target;state.v=0;}
  return state.x!==target||state.v!==0;
}

// Text waits until its own dish is close to the destination, never flying across
// another readable label. Its hit area follows the same visibility.
export function inkVisibility(distance,size,reveal=0){
  const value=Math.max(0,Math.min(1,1-distance/Math.max(1,size*MOTION.inkTravelFraction)))*Math.max(0,Math.min(1,1-reveal));
  return value>.999?1:value<.001?0:value;
}
