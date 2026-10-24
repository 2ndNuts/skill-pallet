import * as THREE from 'three';

// A continuous section: flat bowl → shallow scoop → rolled lip → rounded outside.
// Heights use the same physical units as the grid; horizontal positions are normalized.
export const DISH_FLOOR=1.8;
export const DISH_LIP=6.2;
const profile=[
  [.425,DISH_FLOOR],[.433,DISH_FLOOR],[.441,2.32],[.452,3.80],
  [.464,5.30],[.477,6.10],[.486,DISH_LIP],[.496,6.10],
  [.502,5.80],[.505,5.05],[.506,3.90],[.506,-2.70],
  [.503,-3.50],[.495,-4.05],[.480,-4.30]
];
function outline(half){
  const r=Math.max(.045,.145-(.506-half)),points=[];
  const corners=[[half-r,half-r],[-half+r,half-r],[-half+r,-half+r],[half-r,-half+r]];
  for(let corner=0;corner<4;corner++)for(let step=0;step<=12;step++){
    const angle=corner*Math.PI/2+step/12*Math.PI/2,[cx,cz]=corners[corner];
    points.push([cx+Math.cos(angle)*r,cz+Math.sin(angle)*r]);
  }
  return points;
}
export function createRimLineGeometry(){
  const outer=outline(.492),inner=outline(.480),positions=[],indices=[],n=outer.length;
  for(const ring of[outer,inner])for(const[x,z]of ring)positions.push(x,DISH_LIP+.08,z);
  for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,n+i,j,n+j,n+i);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
export function createDishGeometry(){
  const positions=[],uvs=[],indices=[],geometry=new THREE.BufferGeometry();
  for(const[half,y]of profile)for(const[x,z]of outline(half)){positions.push(x,y,z);uvs.push(x+.5,z+.5);}
  const n=outline(profile[0][0]).length,top=positions.length/3;
  positions.push(0,DISH_FLOOR,0);uvs.push(.5,.5);
  const bottom=positions.length/3;positions.push(0,profile.at(-1)[1],0);uvs.push(.5,.5);
  // Material indices: outside 0, flat name surface 1, scooped rim 2.
  let start=0;
  for(let i=0;i<n;i++)indices.push(top,(i+1)%n,i);
  geometry.addGroup(start,indices.length-start,1);start=indices.length;
  for(let ring=0;ring<profile.length-1;ring++){
    const mat=ring<1?1:ring<9?2:0;
    for(let i=0;i<n;i++){
      const a=ring*n+i,b=ring*n+(i+1)%n,c=(ring+1)*n+i,d=(ring+1)*n+(i+1)%n;
      indices.push(a,b,c,b,d,c);
    }
    geometry.addGroup(start,indices.length-start,mat);start=indices.length;
  }
  const last=(profile.length-1)*n;for(let i=0;i<n;i++)indices.push(bottom,last+i,last+(i+1)%n);
  geometry.addGroup(start,indices.length-start,0);
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);
  const groups=[];for(const group of geometry.groups){const previous=groups.at(-1);if(previous&&previous.materialIndex===group.materialIndex)previous.count+=group.count;else groups.push({...group});}
  geometry.clearGroups();for(const group of groups)geometry.addGroup(group.start,group.count,group.materialIndex);
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}
