/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Component: wooden chip dynamics · theme: Skill Pallet wood
 * Each chip has its own velocity, friction, mass and contact response.
 * Physical contacts drive sound; there is no shared grid displacement.
 */
export const CHIP_PHYSICS=Object.freeze({step:1/240,driveGain:.24,scrollGain:.16,scrollFilter:22,maxSpeed:200,maxTravel:20,maxTilt:.065,restitution:.16,minImpact:14,transportMaxAge:120,staleAfter:120,maxFrameGap:150});
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
function seed(key){let h=2166136261;for(const char of key){h^=char.codePointAt(0);h=Math.imul(h,16777619);}return(h>>>0)/4294967295;}
function clearBody(body){Object.assign(body,{x:0,y:0,vx:0,vy:0,tiltX:0,tiltZ:0,wx:0,wz:0});}

// Exact Minkowski contact for two axis-aligned rounded squares. The dishes keep
// their printed orientation; pitch/roll is a small visual rocking response.
export function chipContact(a,b){
  const dx=b.baseX+b.x-a.baseX-a.x,dy=b.baseY+b.y-a.baseY-a.y;
  const hx=a.half+b.half,ax=Math.abs(dx),ay=Math.abs(dy);
  if(ax>=hx||ay>=hx)return null;
  const radius=a.radius+b.radius,core=hx-radius,qx=ax-core,qy=ay-core;
  if(qx>0&&qy>0){
    const length=Math.hypot(qx,qy);if(length>=radius)return null;
    return{nx:(dx<0?-1:1)*qx/length,ny:(dy<0?-1:1)*qy/length,depth:radius-length};
  }
  return hx-ax<hx-ay?{nx:dx<0?-1:1,ny:0,depth:hx-ax}:{nx:0,ny:dy<0?-1:1,depth:hx-ay};
}

export function createChipPhysics(){
  let bodies=new Map(),active=[],width=434,height=434,scroll=0,bottom=434;
  let sequence=-1,sample=-1,dragging=false,lastReceived=-Infinity,windowX=0,windowY=0,kickX=0,kickY=0,accumulator=0;
  let scrollPosition=null,scrollTime=null,scrollVelocity=0,scrollKick=0,scrolling=false;
  let trayPosition=null,trayTime=null,trayVelocity=0,trayKick=0,transporting=false;
  const quietPose=Object.freeze({x:0,y:0,vx:0,vy:0,tiltX:0,tiltZ:0});
  function reset(){for(const body of bodies.values())clearBody(body);dragging=false;windowX=windowY=kickX=kickY=accumulator=0;lastReceived=-Infinity;scrollPosition=scrollTime=null;scrollVelocity=scrollKick=0;scrolling=false;trayPosition=trayTime=null;trayVelocity=trayKick=0;transporting=false;}
  function view(){
    active=[];
    for(const body of bodies.values()){
      if(body.baseY+body.half>scroll-body.size&&body.baseY-body.half<scroll+height+body.size)active.push(body);
      else clearBody(body);
    }
  }
  function constrain(body){
    const travel=Math.min(CHIP_PHYSICS.maxTravel,body.size*.2);
    for(const axis of['x','y'])if(Math.abs(body[axis])>travel){body[axis]=clamp(body[axis],-travel,travel);if(body[axis]*body['v'+axis]>0)body['v'+axis]=0;}
  }
  return{
    layout(items,nextWidth,nextHeight){
      width=nextWidth;height=nextHeight;bottom=Math.max(height,...items.map(item=>item.y+item.size));
      bodies=new Map(items.map(item=>{
        const s=seed(item.key),mass=(item.stack?2.2:1)*(.9+s*.2),size=item.size;
        const body={key:item.key,size,baseX:item.x+size/2,baseY:item.y+size/2,half:(size-2)*.506,radius:(size-2)*.145,mass,invMass:1/mass,friction:50+seed(item.key+':grain')*70};
        clearBody(body);return[item.key,body];
      }));reset();view();
    },
    setView(nextScroll,nextHeight=height){if(scroll!==nextScroll||height!==nextHeight){scroll=nextScroll;height=nextHeight;view();}},
    observeScroll(position,now){
      if(!Number.isFinite(position)||!Number.isFinite(now))return;
      const dt=scrollTime===null?0:now-scrollTime,delta=scrollPosition===null?0:position-scrollPosition;
      scrollPosition=position;scrollTime=now;
      if(dt<=0||dt>CHIP_PHYSICS.maxFrameGap){scrollVelocity=scrollKick=0;scrolling=false;return;}
      const measured=clamp(delta*1000/dt,-1800,1800),blend=1-Math.exp(-dt/CHIP_PHYSICS.scrollFilter);
      const next=scrollVelocity+(measured-scrollVelocity)*blend;
      // Positive scrollTop moves the tray upward: each loose chip lags downward.
      scrollKick+=(next-scrollVelocity)*CHIP_PHYSICS.scrollGain;
      scrollVelocity=Math.abs(next)<.5?0:next;scrolling=Math.abs(scrollVelocity)>6;
    },
    observeTray(position,now,active=true){
      if(!Number.isFinite(position)||!Number.isFinite(now))return;
      const dt=trayTime===null?0:now-trayTime,delta=trayPosition===null?0:position-trayPosition;
      trayPosition=position;trayTime=now;transporting=active;
      if(dt<=0){if(!active){trayKick+=trayVelocity*CHIP_PHYSICS.driveGain;trayVelocity=0;}return;}
      if(dt>CHIP_PHYSICS.maxFrameGap){trayVelocity=trayKick=0;return;}
      const next=active?clamp(delta*1000/dt,-1800,1800):0;
      trayKick-=(next-trayVelocity)*CHIP_PHYSICS.driveGain;trayVelocity=next;
    },
    receive(packet,now,wallTime){
      if(!packet||![packet.vx,packet.vy,packet.issuedAt,now,wallTime].every(Number.isFinite)||!Number.isSafeInteger(packet.sequence)||!Number.isSafeInteger(packet.sample)||typeof packet.dragging!=='boolean')return false;
      if(packet.sequence<sequence||(packet.sequence===sequence&&packet.sample<=sample))return false;
      const newDrag=packet.sequence!==sequence;sequence=packet.sequence;sample=packet.sample;
      const age=wallTime-packet.issuedAt;
      // A stale window packet must not cancel the independent scroll channel.
      if(age>CHIP_PHYSICS.transportMaxAge||age< -1000)return false;
      if(newDrag){windowX=windowY=0;kickX=kickY=0;}
      const length=Math.hypot(packet.vx,packet.vy),ratio=Math.min(1,1800/Math.max(1,length));
      const x=packet.dragging?packet.vx*ratio:0,y=packet.dragging?packet.vy*ratio:0;
      kickX-= (x-windowX)*CHIP_PHYSICS.driveGain;kickY-= (y-windowY)*CHIP_PHYSICS.driveGain;
      windowX=x;windowY=y;dragging=packet.dragging;lastReceived=now;return true;
    },
    tick(milliseconds,now,reduced=false){
      const contacts=new Map();
      if(reduced||!Number.isFinite(milliseconds)||!Number.isFinite(now)||milliseconds<0||milliseconds>CHIP_PHYSICS.maxFrameGap){reset();return{moving:false,dragging:false,scrolling:false,transporting:false,contacts:[]};}
      if(now-lastReceived>CHIP_PHYSICS.staleAfter){dragging=false;windowX=windowY=kickX=kickY=0;}
      for(const body of active){body.vx=clamp(body.vx+kickX+trayKick,-CHIP_PHYSICS.maxSpeed,CHIP_PHYSICS.maxSpeed);body.vy=clamp(body.vy+kickY+scrollKick,-CHIP_PHYSICS.maxSpeed,CHIP_PHYSICS.maxSpeed);}
      kickX=kickY=scrollKick=trayKick=0;accumulator+=Math.min(40,milliseconds)/1000;
      const homing=!(dragging&&Math.hypot(windowX,windowY)>=8)&&!scrolling&&!transporting;
      function resolve(a,b,nx,ny,depth,wall){
        const other=b?.invMass??0,total=a.invMass+other;
        const correction=Math.max(0,depth-.001)/total;
        a.x-=nx*correction*a.invMass;a.y-=ny*correction*a.invMass;
        if(b){b.x+=nx*correction*b.invMass;b.y+=ny*correction*b.invMass;}
        const relative=((b?.vx??0)-a.vx)*nx+((b?.vy??0)-a.vy)*ny;
        if(relative>=0)return;
        const speed=-relative,impulse=(1+CHIP_PHYSICS.restitution)*speed/total;
        a.vx-=nx*impulse*a.invMass;a.vy-=ny*impulse*a.invMass;
        a.wx+=ny*impulse*a.invMass*.015;a.wz-=nx*impulse*a.invMass*.015;
        if(b){b.vx+=nx*impulse*b.invMass;b.vy+=ny*impulse*b.invMass;b.wx-=ny*impulse*b.invMass*.015;b.wz+=nx*impulse*b.invMass*.015;}
        if(speed<CHIP_PHYSICS.minImpact)return;
        const x=a.baseX+a.x+nx*a.half,y=a.baseY+a.y+ny*a.half;
        if(x< -1||x>width+1||y<scroll||y>scroll+height)return;
        const id=b?[a.key,b.key].sort().join('\u0000'):a.key+'\u0000wall:'+wall;
        if((contacts.get(id)?.speed??0)<speed)contacts.set(id,{id,a:a.key,b:b?.key??null,wall:wall??null,speed,x,y,now});
      }
      while(accumulator>=CHIP_PHYSICS.step){
        const dt=CHIP_PHYSICS.step;accumulator-=dt;
        for(const body of active){
          const k=homing?145:3,damping=homing?24:2.6;
          body.vx+=(-k*body.x/body.mass-damping*body.vx)*dt;
          body.vy+=(-k*body.y/body.mass-damping*body.vy)*dt;
          if(!homing){
            const speed=Math.hypot(body.vx,body.vy),factor=Math.max(0,1-body.friction*dt/Math.max(.001,speed));body.vx*=factor;body.vy*=factor;
          }
          body.x+=body.vx*dt;body.y+=body.vy*dt;constrain(body);
          const tx=clamp(-body.vy*.00065,-.04,.04),tz=clamp(body.vx*.00065,-.04,.04);
          body.wx+=((tx-body.tiltX)*400-40*body.wx)*dt;body.wz+=((tz-body.tiltZ)*400-40*body.wz)*dt;
          body.tiltX=clamp(body.tiltX+body.wx*dt,-CHIP_PHYSICS.maxTilt,CHIP_PHYSICS.maxTilt);body.tiltZ=clamp(body.tiltZ+body.wz*dt,-CHIP_PHYSICS.maxTilt,CHIP_PHYSICS.maxTilt);
        }
        // A few sequential impulse passes transmit a knock through neighbours.
        for(let pass=0;pass<5;pass++){
          for(const body of active){
            const x=body.baseX+body.x,y=body.baseY+body.y;
            if(x-body.half<0)resolve(body,null,-1,0,body.half-x,'left');
            if(x+body.half>width)resolve(body,null,1,0,x+body.half-width,'right');
            if(y-body.half<0)resolve(body,null,0,-1,body.half-y,'top');
            if(y+body.half>bottom)resolve(body,null,0,1,y+body.half-bottom,'bottom');
          }
          for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
            const a=active[i],b=active[j],contact=chipContact(a,b);
            if(contact)resolve(a,b,contact.nx,contact.ny,contact.depth);
          }
        }
      }
      let moving=false;
      for(const body of active){
        const asleep=Math.abs(body.x)<.025&&Math.abs(body.y)<.025&&Math.hypot(body.vx,body.vy)<.4&&Math.abs(body.tiltX)+Math.abs(body.tiltZ)<.001&&Math.abs(body.wx)+Math.abs(body.wz)<.01;
        if(homing&&asleep)clearBody(body);
        if(body.x||body.y||body.vx||body.vy||body.tiltX||body.tiltZ)moving=true;
      }
      return{moving,dragging,scrolling,transporting,contacts:[...contacts.values()]};
    },
    pose(key){return bodies.get(key)??quietPose;},
    get bodies(){return[...bodies.values()];},
    reset
  };
}
