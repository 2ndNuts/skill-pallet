// Window motion and scrolling share the contacts of the rendered chip physics.
export const COLLISION_SOUND=Object.freeze({interval:125,pairInterval:180,minImpact:14,quietAfter:350,maxFrameGap:150});
export function createSoundCadence(emit){
  let enabled=false,lastAny=-Infinity,lastHover=-Infinity,lastKey=null,hoverBlockedUntil=-Infinity;
  let carrying=false,collisionTake=0,lastCollision=-Infinity,carryQuietUntil=-Infinity;
  const pairTimes=new Map();
  const send=(kind,take,now,strength=1)=>{lastAny=now;emit(kind,take,strength);return true;};
  function endWindowMove(now){if(carrying){carrying=false;carryQuietUntil=now+COLLISION_SOUND.quietAfter;}}
  function carryBlocks(now){return carrying||now<carryQuietUntil;}
  return{
    setEnabled(value){enabled=!!value;if(!enabled){lastKey=null;hoverBlockedUntil=-Infinity;carrying=false;carryQuietUntil=-Infinity;pairTimes.clear();}},
    beginScroll(now){hoverBlockedUntil=Infinity;lastKey=null;},
    endScroll(now){hoverBlockedUntil=now+450;lastKey=null;},
    hover(key,now){
      if(!enabled||carryBlocks(now)||now<hoverBlockedUntil||(key===lastKey&&now-lastHover<500)||now-lastHover<260||now-lastAny<200)return false;
      lastHover=now;lastKey=key;return send('hover',Math.floor(now/260)%4,now);
    },
    windowActivity(active,now){if(active)carrying=true;else endWindowMove(now);},
    collisionFrame(contacts,now,elapsed,active){
      if(!Number.isFinite(now)||!Number.isFinite(elapsed)||elapsed<0||elapsed>COLLISION_SOUND.maxFrameGap){endWindowMove(now);return false;}
      if(active)carrying=true;else endWindowMove(now);
      for(const[id,time]of pairTimes)if(now-time>1000)pairTimes.delete(id);
      if(!enabled||!Array.isArray(contacts)||now-lastCollision<COLLISION_SOUND.interval||now-lastAny<COLLISION_SOUND.interval)return false;
      // One strongest fresh contact per frame, no queue of deferred collisions.
      const hit=contacts.filter(c=>typeof c.id==='string'&&Number.isFinite(c.speed)&&c.speed>=COLLISION_SOUND.minImpact&&Number.isFinite(c.now)&&Math.abs(now-c.now)<=40&&now-(pairTimes.get(c.id)??-Infinity)>=COLLISION_SOUND.pairInterval).sort((a,b)=>b.speed-a.speed)[0];
      if(!hit)return false;
      pairTimes.set(hit.id,now);lastCollision=now;lastKey=null;
      const strength=Math.sqrt(Math.max(.08,Math.min(1,(hit.speed-COLLISION_SOUND.minImpact)/140)));
      return send('collision',collisionTake++%3,now,strength);
    },
    endWindowMove,
    contact(index,now){if(!enabled||carryBlocks(now)||(index!==0&&index!==12))return false;return send('startup',index%4,now);},
    success(now){if(!enabled)return false;lastKey=null;return send('success',0,now);}
  };
}
