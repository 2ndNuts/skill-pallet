import {createPreviewUsage,PREVIEW_USAGE_KEY,usageIdentity} from './usage-model.js';
import {PREVIEW_SOUND_VOLUME_KEY,SOUND_VOLUMES,soundVolume} from './sound-volume.js';

export function nativeCatalog(skills,metadata=[]){
  const exact=new Map(metadata.map(s=>[usageIdentity(s),s]));
  const invocation=new Map();
  for(const skill of metadata){
    const list=invocation.get(skill.invocation)||[];list.push(skill);invocation.set(skill.invocation,list);
  }
  return skills.map(skill=>{
    const candidates=invocation.get(skill.invocation)||[];
    const detail=exact.get(usageIdentity(skill))||(candidates.length===1?candidates[0]:null);
    return{...detail,...skill,key:skill.id||skill.key,
      genres:skill.genres?.length?skill.genres:detail?.genres||['organize'],tags:skill.tags||detail?.tags||[]};
  });
}

export async function createRuntime(){
  const handler=window.webkit?.messageHandlers?.skillPallet,isNative=!!handler;
  const listeners=new Set();
  let current={},preview;
  const publish=next=>{current=next;for(const listener of listeners)listener(current);return current;};
  const request=async(action,payload={})=>{
    const result=await handler.postMessage({action,...payload});
    publish(result.state||result);
    if(result.ok===false)throw new Error(result.message||'操作を完了できませんでした。');
    return current;
  };
  async function refreshUsage(){
    if(isNative||!preview)return current;
    try{publish({...current,usage:preview.snapshot(),usageError:''});}
    catch(error){publish({...current,usageError:error.message||'使用回数を保存できません。'});}
    return current;
  }
  if(isNative){
    document.documentElement.classList.add('native-app');
    window.addEventListener('skill-pallet-state',event=>publish(event.detail));
    await request('bootstrap');
  }else{
    const response=await fetch(new URL('../grid/skills-data.js',document.baseURI));
    if(!response.ok)throw new Error('試作用のカタログを読み込めませんでした。');
    const raw=(await response.text()).replace(/^\s*const gridCatalog\s*=\s*/,'').replace(/;\s*$/,'');
    const skills=JSON.parse(raw).skills;
    try{
      preview=createPreviewUsage({storage:window.localStorage,lock:fn=>navigator.locks?navigator.locks.request('skill-pallet-preview-usage',fn):fn()});
      current={skills,usage:preview.snapshot(),usageError:''};
    }catch(error){current={skills,usage:{windowDays:30,counts:{}},usageError:'使用回数を保存できません。ブラウザの保存設定を確認してください。'};}
    let previewVolume=0;
    try{previewVolume=soundVolume(JSON.parse(window.localStorage.getItem(PREVIEW_SOUND_VOLUME_KEY))).value;}catch{}
    current={...current,sound:previewVolume>0,soundVolume:previewVolume};
    window.addEventListener('storage',event=>{if(event.key===PREVIEW_USAGE_KEY||event.key===null)refreshUsage();});
    window.addEventListener('focus',refreshUsage);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshUsage();});
    setInterval(refreshUsage,60_000);
  }
  function setSoundVolume(value){
    if(!SOUND_VOLUMES.some(level=>level.value===value))return Promise.reject(new Error('音量の設定が正しくありません。'));
    if(isNative)return request('soundVolume',{value});
    try{window.localStorage.setItem(PREVIEW_SOUND_VOLUME_KEY,JSON.stringify(value));}
    catch{return Promise.reject(new Error('音量の設定を保存できませんでした。'));}
    return Promise.resolve(publish({...current,sound:value>0,soundVolume:value}));
  }
  return{
    native:isNative,get state(){return current;},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    async invoke(entry){
      if(isNative)return request('invoke',{key:usageIdentity(entry)});
      if(!preview)throw new Error('使用回数を保存できません。ブラウザの保存設定を確認してください。');
      try{return publish({...current,usage:await preview.record(usageIdentity(entry)),usageError:''});}
      catch(error){publish({...current,usageError:'使用回数を保存できませんでした。'});throw error;}
    },
    favorite(entry){return request('favorite',{key:usageIdentity(entry)});},
    format(value){return request('format',{value});},
    permission(){return request('permission');},
    updateCatalog(){return request('updateCatalog');},
    refresh(){return request('refresh');},
    sound(value){return isNative?request('sound',{value}):setSoundVolume(value?(current.soundVolume||1):0);},
    soundVolume:setSoundVolume,
    pin(value){return request('pin',{value});},
    soundCue(kind,take,strength=1){if(isNative&&current.sound)handler.postMessage({action:'soundCue',kind,take,strength}).catch(()=>{});}
  };
}
