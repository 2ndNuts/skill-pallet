import * as THREE from 'three';
import {createDishGeometry,createRimLineGeometry,DISH_FLOOR} from './dish-geometry.js';
import {arrivalPose,arrivalPlan,contactIsCurrent} from './arrival-motion.js';
import {createChipPhysics} from './window-inertia.js';
import {MOTION,advanceMotion,inkVisibility} from './motion-tokens.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import woodDiffuse from '../motion/assets/wood-diff.jpg';
import woodNormal from '../motion/assets/wood-nor_gl.jpg';
import woodRough from '../motion/assets/wood-rough.jpg';

const clamp=THREE.MathUtils.clamp;
export async function createWoodGrid(canvas,{onContact=()=>{},onMotionFrame=()=>{}}={}){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.NoToneMapping;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#b88c53');
  const camera=new THREE.OrthographicCamera(-217,217,217,-217,.1,3000);
  const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(room,.04).texture;scene.environmentIntensity=.28;room.dispose();
  scene.add(new THREE.AmbientLight('#ffffff',.45));
  const key=new THREE.DirectionalLight('#fff8e9',2.4);key.position.set(-300,700,-400);key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-320,right:320,top:320,bottom:-320,near:.1,far:1800});key.shadow.normalBias=.25;key.shadow.bias=-.0001;scene.add(key,key.target);
  const fill=new THREE.DirectionalLight('#fff4df',.35);fill.position.set(400,500,200);scene.add(fill);
  const loader=new THREE.TextureLoader();
  const [diffuse,normal,rough]=await Promise.all([woodDiffuse,woodNormal,woodRough].map(url=>loader.loadAsync(url)));
  diffuse.colorSpace=THREE.SRGBColorSpace;
  const groups=new Map(),reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const windowMotion=createChipPhysics();let carryState={moving:false,dragging:false};
  let hasLayout=false,reflowing=false,projectionScroll=0;
  const viewSlope=.28,depthScale=Math.sqrt(1+viewSlope*viewSlope),faceLevel=5.4+DISH_FLOOR+.06;
  let width=434,height=434,scroll=0,targetKey=null,selectedKey=null,pointer={x:0,y:0},downKey=null,pulseKey=null,pulseUntil=0,dirty=true,lastTime=performance.now(),frameHook=()=>{},introStart=null,introItems=[];
  const geometry=createDishGeometry(),rimGeometry=createRimLineGeometry();
  // The photograph supplies the grain; only its light/dark signal is remapped to pale timber.
  function material(index,role,part){
    const maps=[diffuse,normal,rough].map(texture=>{const t=texture.clone();t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(.5,.55);t.offset.set((index*.173)%.49,(index*.131)%.44);t.anisotropy=8;return t;});
    const mat=new THREE.MeshPhysicalMaterial({color:'#ffffff',map:maps[0],normalMap:maps[1],roughnessMap:maps[2],roughness:.9,metalness:0,specularIntensity:.18,transparent:part!=='tray'});mat.normalScale.set(part==='tray'?.16:.1,part==='tray'?.16:.1);
    const variation=(index%5)*.012;
    const uniforms={pocket:{value:part==='face'?1:part==='rim'?.65:0},low:{value:new THREE.Color(part==='tray'?'#795025':part==='body'?'#965d29':'#aa7932').multiplyScalar(1+variation)},high:{value:new THREE.Color(part==='tray'?'#b58a4d':part==='body'?'#d6ab6a':'#f0d49a').multiplyScalar(1-variation)}};
    mat.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{uPocket:uniforms.pocket,uWoodLow:uniforms.low,uWoodHigh:uniforms.high});
      shader.vertexShader='varying vec2 vChipUv;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvChipUv=uv;');
      shader.fragmentShader='varying vec2 vChipUv;uniform float uPocket;uniform vec3 uWoodLow;uniform vec3 uWoodHigh;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      #ifdef USE_MAP
        float grain=dot(sampledDiffuseColor.rgb,vec3(.2126,.7152,.0722));
        float woodTone=clamp(pow(grain,.38)*1.72-.18,0.0,1.0);
        vec3 timber=mix(uWoodLow,uWoodHigh,woodTone);
        vec2 q=abs(vChipUv-.5)-vec2(.361);
        float innerEdge=length(max(q,0.0))+min(max(q.x,q.y),0.0)-.064;
        float inside=1.0-smoothstep(-.004,.008,innerEdge);
        float edgeOcclusion=exp(-max(-innerEdge,0.0)/.025);
        float upperOcclusion=exp(-max(vChipUv.y-.075,0.0)/.06);
        float lowerBounce=exp(-max(.925-vChipUv.y,0.0)/.035);
        timber*=1.0+uPocket*inside*(-.10*edgeOcclusion-.24*upperOcclusion+.04*lowerBounce);
        diffuseColor.rgb=timber;
      #endif`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\nroughnessFactor=clamp(.76+roughnessFactor*.15,.76,.94);`);
    };mat.customProgramCacheKey=()=> 'scooped-wood-v5-brand';return{part,mat,maps,uniforms};
  }
  function setPatina(id,stage){
    const g=groups.get(id);if(!g||g.patinaStage===stage.stage)return;
    g.patinaStage=stage.stage;
    for(const part of g.parts){
      const base=new THREE.Color(stage.color),body=part.part==='body',rim=part.part==='rim';
      part.uniforms.low.value.copy(base).multiplyScalar(body?.50:rim?.88:.86);
      part.uniforms.high.value.copy(base).multiplyScalar(body?.67:rim?1.10:1.02);
    }
    dirty=true;
  }
  const trayMaterial=material(0,{color:'#7ecefd'},'tray');trayMaterial.maps.forEach(t=>t.repeat.set(6,8));
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(3000,3000),trayMaterial.mat);floor.rotation.x=-Math.PI/2;floor.position.y=-.2;floor.receiveShadow=true;scene.add(floor);
  function layout(items,nextWidth,nextHeight,nextScroll=scroll){
    const scrollShift=(nextScroll-projectionScroll)*depthScale,widthShift=(width-nextWidth)/2;
    scroll=nextScroll;projectionScroll=nextScroll;
    width=nextWidth;height=nextHeight;renderer.setSize(width,height,false);
    const visible=new Set(items.map(x=>x.key));
    for(const [id,g]of groups)if(!visible.has(id)){scene.remove(g.group);g.outline.material.dispose();g.parts.forEach(p=>{p.mat.dispose();p.maps.forEach(t=>t.dispose());});groups.delete(id);}
    items.forEach((item,index)=>{
      let g=groups.get(item.key);
      if(!g){
        const group=new THREE.Group(),parts=['body','face','rim'].map(part=>material(index,item.role,part));
        const dish=new THREE.Mesh(geometry,parts.map(p=>p.mat));dish.castShadow=dish.receiveShadow=true;group.add(dish);
        const outline=new THREE.Mesh(rimGeometry,new THREE.MeshBasicMaterial({color:item.role.color,transparent:true,opacity:0,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));group.add(outline);
        const back=[];
        if(item.stack)for(let layer=0;layer<2;layer++){const mesh=new THREE.Mesh(geometry,parts.map(p=>p.mat));mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);back.push(mesh);}
        g={group,dish,outline,back,parts,amount:0,ax:{x:0,v:0},az:{x:0,v:0},press:{x:0,v:0},lift:{x:0,v:0},reveal:{x:hasLayout?1:0,v:0}};groups.set(item.key,g);scene.add(group);
      }
      g.base={x:item.x+item.size/2-width/2,z:(item.y+item.size/2)*depthScale,size:item.size,left:item.x,top:item.y};g.print=item.print;g.button=item.button;
      g.stack=!!item.stack;g.outline.material.color.set(item.role.color);
      setPatina(item.key,item.patina);
      if(!g.posX){g.posX={x:item.spawn?item.spawn.x-width/2:g.base.x,v:0};g.posZ={x:item.spawn?item.spawn.y*depthScale+scrollShift:g.base.z,v:0};}
      else{g.posX.x+=widthShift;g.posZ.x+=scrollShift;}
      const size=item.size-(g.stack?6:2);g.dish.scale.set(size,1,size);
      g.outline.scale.set(size,1,size);
      const direction=item.x+item.size*1.5>width?-1:1;
      g.back.forEach((mesh,i)=>{const ratio=.99-i*.01;mesh.scale.set(size*ratio,.45,size*ratio);mesh.position.set(direction*(i+1)*2.5,i===0?-6.9:-11.4,(i+1)*2.2);mesh.rotation.y=-direction*(i+1)*.03;});
      g.button.dataset.layers=String(g.back.length+1);g.group.position.set(g.posX.x,g.stack?14:5.4,g.posZ.x);
    });hasLayout=true;windowMotion.layout(items,width,height);windowMotion.setView(scroll,height);dirty=true;
  }
  const projected=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
  function alignPrint(g){
    const currentTop=g.group.position.z/depthScale-g.base.size/2;
    if(!g.print)return;
    if((g.base.top+g.base.size<scroll-20&&currentTop+g.base.size<scroll-20)||(g.base.top>scroll+height+20&&currentTop>scroll+height+20)){
      // A label that moved out of view must not retain an old in-view projection.
      g.print.style.transform='none';g.print.style.opacity='1';g.print.style.pointerEvents='';return;
    }
    const s=g.base.size,half=s/2,y=DISH_FLOOR+.06;
    projected[0].set(-half,y,-half);projected[1].set(half,y,-half);projected[2].set(-half,y,half);
    for(const p of projected){p.applyMatrix4(g.group.matrixWorld).project(camera);p.set((p.x+1)*width/2,(1-p.y)*height/2,0);}
    const [a,b,c]=projected;
    g.print.style.transform=`matrix(${(b.x-a.x)/s},${(b.y-a.y)/s},${(c.x-a.x)/s},${(c.y-a.y)/s},${a.x-g.base.left},${a.y-(g.base.top-scroll)})`;
    const distance=Math.hypot(g.posX.x-g.base.x,(g.posZ.x-g.base.z)/depthScale),ink=inkVisibility(distance,g.base.size,g.reveal.x)*(g.introOpacity??1);
    g.print.style.opacity=String(ink);g.print.style.pointerEvents=ink<.95?'none':'';
    g.button.dataset.tiltX=(g.ax.x*180/Math.PI).toFixed(2);g.button.dataset.tiltY=(-g.az.x*180/Math.PI).toFixed(2);g.button.dataset.press=g.press.x.toFixed(3);
  }
  function render(now){
    const elapsed=now-lastTime,dt=Math.min(40,elapsed);lastTime=now;frameHook(dt,now,elapsed);
    const reduced=reducedMotion.matches;
    windowMotion.observeScroll(scroll,now);
    const wasCarrying=carryState.moving;carryState=windowMotion.tick(elapsed,now,reduced);let moving=carryState.moving;
    reflowing=false;
    if(wasCarrying&&!carryState.moving)dirty=true;
    for(const [id,g]of groups){
      const body=windowMotion.pose(id);
      const wanted=id===targetKey?1:0,oldAmount=g.amount;
      g.amount=reduced?wanted:THREE.MathUtils.lerp(g.amount,wanted,1-Math.exp(-dt/15));
      if(Math.abs(g.amount-wanted)<.001)g.amount=wanted;
      if(g.amount!==oldAmount)dirty=true;
      const pressed=id===downKey||(id===pulseKey&&now<pulseUntil)?1:0;
      const px=wanted?pointer.x:0,py=wanted?pointer.y:0;
      const tx=reduced?0:py*(.12+pressed*.09)+body.tiltX,tz=reduced?0:-px*(.12+pressed*.09)+body.tiltZ;
      if(reduced){g.ax={x:0,v:0};g.az={x:0,v:0};g.press={x:0,v:0};g.lift={x:0,v:0};g.posX={x:g.base.x,v:0};g.posZ={x:g.base.z,v:0};g.reveal={x:0,v:0};}
      else{
        moving=advanceMotion(g.ax,tx,elapsed,MOTION.hover)||moving;moving=advanceMotion(g.az,tz,elapsed,MOTION.hover)||moving;
        moving=advanceMotion(g.press,pressed,elapsed,MOTION.press)||moving;moving=advanceMotion(g.lift,wanted*1.5,elapsed,MOTION.hover)||moving;
        const x=advanceMotion(g.posX,g.base.x,elapsed,MOTION.layout),z=advanceMotion(g.posZ,g.base.z,elapsed,MOTION.layout),birth=advanceMotion(g.reveal,0,elapsed,MOTION.reveal);
        reflowing=x||z||birth||reflowing;moving=reflowing||moving;
      }
      if(pressed)moving=true;
      g.outline.material.opacity=id===selectedKey?1:g.amount;
      g.group.rotation.set(g.ax.x,0,g.az.x);
      const extent=(g.stack?13.4:4.5)*Math.cos(g.ax.x)*Math.cos(g.az.x)+(g.base.size-2)/2*(depthScale*Math.abs(Math.sin(g.ax.x))+Math.abs(Math.sin(g.az.x)));
      g.group.scale.set(1,1,depthScale);
      g.group.position.set(g.posX.x+body.x,Math.max((g.stack?14:5.4)+g.lift.x-g.press.x*1.2,extent+.35)+g.reveal.x*7,g.posZ.x+body.y*depthScale);
      g.introOpacity=1;
      if(g.arrival&&!reduced){
        const pose=arrivalPose(now-introStart,g.arrival.index);g.introOpacity=pose.opacity;
        g.group.position.x+=pose.x;g.group.position.z+=pose.y*depthScale;
        g.group.position.y+=pose.height;g.group.rotation.z+=pose.tilt;
        if(pose.landed&&!g.arrival.contacted){
          g.arrival.contacted=true;
          const visible=g.base.top+g.base.size>scroll&&g.base.top<scroll+height;
          if(contactIsCurrent(now-introStart,g.arrival.index,visible,document.hidden))onContact({key:id,index:g.arrival.index,now});
        }
        if(pose.done){g.arrival=null;dirty=true;}else moving=true;
      }else if(reduced)g.arrival=null;
      const opacity=g.introOpacity*(1-g.reveal.x);g.group.visible=opacity>0;
      for(const part of g.parts)part.mat.opacity=opacity;
      g.outline.material.opacity*=opacity;
    }
    if(introStart!==null&&!introItems.some(item=>groups.get(item.key)?.arrival))introStart=null;
    onMotionFrame({...carryState,collectionMoving:carryState.moving||carryState.dragging||carryState.scrolling||reflowing||introStart!==null,now,elapsed});
    if(dirty||moving){
      const center=(scroll+height/2)*depthScale;
      camera.left=-width/2;camera.right=width/2;camera.top=height/2;camera.bottom=-height/2;
      camera.position.set(0,1200+faceLevel,center+1200*viewSlope);camera.lookAt(0,faceLevel,center);camera.updateProjectionMatrix();camera.updateMatrixWorld();
      floor.position.z=center;key.position.z=center-400;key.target.position.set(0,0,center);
      scene.updateMatrixWorld();for(const g of groups.values())alignPrint(g);
      renderer.render(scene,camera);projectionScroll=scroll;dirty=false;
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
  return{
    layout,setPatina,setFrameHook(fn){frameHook=fn;},
    startIntro(){
      if(reducedMotion.matches)return;
      windowMotion.reset();
      for(const g of groups.values()){g.arrival=null;g.introOpacity=1;g.reveal={x:0,v:0};g.posX={x:g.base.x,v:0};g.posZ={x:g.base.z,v:0};}
      introItems=arrivalPlan([...groups].map(([key,g])=>({key,x:g.base.left,y:g.base.top,size:g.base.size})),height,scroll);
      introStart=performance.now();for(const item of introItems){const g=groups.get(item.key);g.arrival={index:item.index,contacted:false};}dirty=true;
    },
    cancelIntro(){introStart=null;introItems=[];for(const g of groups.values()){g.arrival=null;g.introOpacity=1;}dirty=true;},
    finishCollectionMotion(){for(const g of groups.values()){g.posX={x:g.base.x,v:0};g.posZ={x:g.base.z,v:0};g.reveal={x:0,v:0};}reflowing=false;dirty=true;},
    get introPlaying(){return introStart!==null;},
    receiveWindowMotion(packet,now=performance.now(),wallTime=Date.now()){
      if(reducedMotion.matches){windowMotion.reset();return false;}
      const accepted=windowMotion.receive(packet,now,wallTime);if(accepted)dirty=true;return accepted;
    },
    resetWindowMotion(){windowMotion.reset();carryState={moving:false,dragging:false};dirty=true;},
    get collectionMoving(){return carryState.moving||carryState.dragging||carryState.scrolling||reflowing||introStart!==null;},
    get windowMotionState(){return carryState.dragging?'dragging':carryState.scrolling?'scrolling':carryState.moving?'settling':'idle';},
    setScroll(value){if(value!==scroll){scroll=value;windowMotion.setView(scroll,height);dirty=true;}},
    hover(id){targetKey=id;if(!id)pointer={x:0,y:0};dirty=true;},
    pointer(id,x,y){if(id===targetKey){x=clamp(x,-1,1);y=clamp(y,-1,1);const radius=Math.max(1,Math.hypot(x,y));pointer={x:x/radius,y:y/radius};dirty=true;}},
    press(id,value){downKey=value?id:null;if(value){pulseKey=null;pulseUntil=0;}dirty=true;},
    select(id,keyboard=false){selectedKey=id;if(keyboard){pulseKey=id;pulseUntil=performance.now()+55;}dirty=true;}
  };
}
