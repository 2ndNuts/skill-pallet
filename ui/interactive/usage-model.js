import palette from '../patina/palette.json' with {type:'json'};

export const WINDOW_MS=30*24*60*60*1000;
export const PREVIEW_USAGE_KEY='skillPallet.previewUsage.v1';
export const STAGES=Object.freeze(palette.stages.map(stage=>Object.freeze({...stage})));
export const usageIdentity=skill=>`${skill.invocation}\u001f${skill.source}`;
export const stageFor=count=>STAGES.findLast(stage=>count>=stage.minimum)||STAGES[0];

export function readUsage(raw){
  if(raw===null||raw===undefined)return{version:1,events:{}};
  const data=typeof raw==='string'?JSON.parse(raw):raw;
  if(data?.version!==1||!data.events||typeof data.events!=='object'||Array.isArray(data.events))throw new Error('使用履歴の形式が対応していません。');
  const events=Object.create(null);
  for(const[key,values]of Object.entries(data.events)){
    if(!Array.isArray(values)||!values.every(value=>Number.isSafeInteger(value)&&value>=0))throw new Error('使用履歴を読み込めません。');
    events[key]=[...values];
  }
  return{version:1,events};
}
export function countsAt(data,now=Date.now()){
  const counts=Object.create(null),cutoff=now-WINDOW_MS;
  for(const[key,events]of Object.entries(data.events)){
    const count=events.filter(timestamp=>timestamp>cutoff&&timestamp<=now).length;
    if(count)counts[key]=count;
  }
  return counts;
}
export function addUse(data,key,now=Date.now()){
  if(!key||!Number.isSafeInteger(now)||now<0)throw new Error('使用履歴に記録できません。');
  const events=Object.create(null),cutoff=now-WINDOW_MS;
  for(const[name,timestamps]of Object.entries(data.events)){
    const active=timestamps.filter(timestamp=>timestamp>cutoff);
    if(active.length)events[name]=active;
  }
  events[key]=[...(events[key]||[]),now];
  return{version:1,events};
}
export function createPreviewUsage({storage,now=Date.now,lock=async fn=>fn()}={}){
  const load=()=>readUsage(storage.getItem(PREVIEW_USAGE_KEY));
  return{
    snapshot:()=>({windowDays:30,counts:countsAt(load(),now())}),
    record(key){return lock(async()=>{
      const data=addUse(load(),key,now());
      storage.setItem(PREVIEW_USAGE_KEY,JSON.stringify(data));
      return{windowDays:30,counts:countsAt(data,now())};
    });}
  };
}
